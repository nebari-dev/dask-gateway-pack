---
title: Deploying alongside the data-science-pack
description: Cross-namespace Helm wiring, the shared JupyterHub service token, and the NetworkPolicy and route-timeout stopgaps needed to use dask-gateway from a data-science-pack JupyterLab session.
sidebar:
  order: 4
---

This guide covers everything needed to make dask-gateway usable from a Nebari
data-science-pack (ds-pack) JupyterLab session on a Nebari-operator / Envoy
Gateway deployment: the pack's own configuration, the JupyterHub wiring on the
ds-pack side, the shared service token, and the network/timeout workarounds that
are currently required until the operator grows the matching features.

It was validated on a k3s (hetzner-k3s) cluster with the Nebari operator, Envoy
Gateway, Keycloak OIDC, ds-pack, and nebi all deployed. Substitute your own
hostname and namespaces for the example values used below:

- gateway hostname: `dask-gateway.<domain>`
- gateway namespace: `dask-gateway`
- hub namespace: `jupyterhub`
- worker/cluster image version: `2026.3.0`

Items are tagged **[config]** (permanent, correct configuration) or
**[stopgap]** (a manual workaround for a gap that the operator or a pack should
own; each links the upstream issue that would remove it).

## How the pieces fit

- **dask-gateway-pack** deploys the gateway API server, a Traefik web proxy, and
  a controller in the `dask-gateway` namespace. The Traefik proxy serves both
  the REST API under `/api` and each cluster's Bokeh dashboard under
  `/clusters/<name>/*`, and terminates the scheduler L4 (TLS/SNI) connection on
  `:8786`.
- **The Nebari operator** turns the pack's NebariApp into a Keycloak client, an
  Envoy `SecurityPolicy` (OIDC), and HTTPRoutes: `/api` is a token-auth public
  route, everything under `/` is OIDC-guarded.
- **ds-pack JupyterHub** is the identity source. The gateway authenticates users
  by validating their notebook's JupyterHub token against the hub API, so the
  gateway must be registered as a hub service and must be able to reach the hub.
- **nebi** is only indirectly involved: the dask client runs inside a
  nebi-managed pixi workspace, so the workspace's `python` and `dask` versions
  must match the worker image (see "Client environment alignment").

The two packs live in different namespaces, which is the source of most of the
wiring below: nothing auto-injects the gateway address into the notebook, the
hub API is not reachable cross-namespace by default, and the service token has
to be shared across the namespace boundary by hand.

## 1. dask-gateway-pack Application

```yaml
helm:
  values: |
    nebariapp:
      enabled: true
      hostname: dask-gateway.<domain>
      # [config] Back the NebariApp with the pack's Traefik web proxy, NOT the
      # api-server. Traefik routes BOTH /api -> api-server AND
      # /clusters/<name>/* -> the scheduler Bokeh dashboards, so a single
      # hostname exposes the REST API (token-auth public route) and the cluster
      # dashboards (under the OIDC-guarded / route). The pack default backs the
      # NebariApp with the api-server, which is REST-only and 404s the dashboard.
      service:
        name: traefik-dask-gateway-pack
        port: 80
    dask-gateway:
      gateway:
        # [config] Restore a worker-profile form. The pack default is
        # extraConfig: {}, so cluster_options() returns nothing, unlike legacy
        # Nebari which exposed a profile selector. (Requesting worker COUNT is
        # separate: cluster.scale(n) / cluster.adapt(); the interactive slider
        # also needs ipywidgets in the client env.)
        extraConfig:
          clusteroptions: |
            from dask_gateway_server.options import Options, Select
            def options_handler(options, user):
                profiles = {
                    "Small":  {"worker_cores": 1, "worker_memory": "2 G"},
                    "Medium": {"worker_cores": 2, "worker_memory": "4 G"},
                    "Large":  {"worker_cores": 4, "worker_memory": "8 G"},
                }
                return profiles[options.profile]
            c.Backend.cluster_options = Options(
                Select("profile", ["Small", "Medium", "Large"], default="Small", label="Cluster profile"),
                handler=options_handler,
            )
            c.KubeClusterConfig.idle_timeout = 1800
        backend:
          # [stopgap] The pack's first-party cluster image
          # (quay.io/nebari/dask-gateway-pack-cluster:<ver>) is an unpublished
          # pre-release placeholder, so the default pulls into ImagePullBackOff.
          # Use the upstream stock image until the pack ships its first cluster
          # image release. Whatever you pick here defines the worker Python/dask
          # versions the client must match.
          image:
            name: ghcr.io/dask/dask-gateway
            tag: "2026.3.0"
        auth:
          # [config] type=jupyterhub + apiTokenFromSecret* come from pack
          # defaults. apiUrl must be set explicitly: the gateway runs in a
          # different namespace than the hub, so the chart's HUB_SERVICE_* auto
          # inference does not apply. Point it at the hub Service in the hub ns.
          jupyterhub:
            apiUrl: http://hub.jupyterhub:8081/hub/api
```

## 2. data-science-pack (JupyterHub side)

```yaml
helm:
  values: |
    jupyterhub:
      hub:
        # [config] Token for the gateway's hub service (see section 3).
        extraEnv:
          DASK_GATEWAY_API_TOKEN:
            valueFrom:
              secretKeyRef:
                name: dask-gateway-hub-token
                key: token
        extraConfig:
          # [config] Register the gateway as a JupyterHub service so its
          # JupyterHubAuthenticator can validate user tokens against the hub.
          # The os.environ.get guard is REQUIRED: the jhub_apps launchpad
          # re-execs this config in a process WITHOUT the env var, and a bare
          # os.environ[...] would KeyError and abort loading the rest of the hub
          # config there. Loads before 99- (z2jh sorts extraConfig by key).
          00-dask-gateway-service.py: |
            import os
            _tok = os.environ.get("DASK_GATEWAY_API_TOKEN")
            if _tok:
                c.JupyterHub.services = (c.JupyterHub.services or []) + [
                    {"name": "dask-gateway", "api_token": _tok},
                ]
                c.JupyterHub.load_roles = (c.JupyterHub.load_roles or []) + [
                    {
                        "name": "dask-gateway",
                        "services": ["dask-gateway"],
                        "scopes": ["read:users", "read:groups", "read:services"],
                    },
                ]
      singleuser:
        # [config] With the packs split across namespaces, nothing injects the
        # gateway address into the notebook, so a bare Gateway() has nothing to
        # read. Inject the addresses + jupyterhub auth (uses the notebook's own
        # JUPYTERHUB_API_TOKEN, no password).
        extraEnv:
          # REST API -> the Envoy public route (the NebariApp /api public route).
          # NOT the internal traefik ClusterIP: the singleuser egress
          # NetworkPolicy only permits the Envoy gateway, so a notebook cannot
          # reach traefik's cluster IP on an enforcing cluster.
          DASK_GATEWAY__ADDRESS: "https://dask-gateway.<domain>"
          # Scheduler proxy (L4 TLS/SNI) has no Envoy path yet (no TCP/TLS
          # passthrough listener), so it stays on the pack's traefik :8786,
          # reachable via the egress stopgap in section 4.
          DASK_GATEWAY__PROXY_ADDRESS: "tls://traefik-dask-gateway-pack.dask-gateway.svc.cluster.local:8786"
          DASK_GATEWAY__PUBLIC_ADDRESS: "https://dask-gateway.<domain>"
          DASK_GATEWAY__AUTH__TYPE: "jupyterhub"
```

## 3. Shared service token (cross-namespace)

**[stopgap]** (nebari-infrastructure-core#551 cross-namespace grant convention)

The gateway and the hub need the *same* JupyterHub API token for the
`dask-gateway` service, but they live in different namespaces, so the token has
to exist as a secret in both:

- `jupyterhub/dask-gateway-hub-token`, key `token` - consumed by the hub
  `extraEnv` above; the hub registers the service with this token.
- `dask-gateway/hub`, key `hub.services.dask-gateway.apiToken` - consumed by the
  gateway's JupyterHub authenticator.

Generate one token (e.g. `openssl rand -hex 32`) and put the same value in both
secrets. Until the operator provides a cross-namespace grant, this is manual and
lives outside the pack charts.

## 4. NetworkPolicy stopgaps

On a cluster that enforces NetworkPolicies (k3s uses kube-router), the ds-pack
default policies isolate the hub and the singleuser pods, and neither knows
about the gateway in another namespace. Two additions are needed.

**[stopgap]** singleuser -> scheduler egress. The client's `PROXY_ADDRESS`
opens a TLS connection to the pack's Traefik on `:8786`; the default singleuser
egress policy only allows the Envoy gateway, so this is blocked.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: singleuser-dask-scheduler-egress
  namespace: jupyterhub
spec:
  podSelector:
    matchLabels: {app: jupyterhub, component: singleuser-server}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: dask-gateway
      ports:
        - {protocol: TCP, port: 8786}
```

**[stopgap]** hub ingress from the gateway. The gateway's authenticator calls
`http://hub.jupyterhub:8081/hub/api`, but the default hub ingress policy only
admits same-namespace pods labeled `hub.jupyter.org/network-access-hub=true`, so
a cross-namespace gateway is denied.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hub-ingress-from-dask-gateway
  namespace: jupyterhub
spec:
  podSelector:
    matchLabels: {app: jupyterhub, component: hub}
  policyTypes: [Ingress]
  ingress:
    - ports:
        - {protocol: TCP, port: 8081}
```

Note (kube-router): kube-router does not honor an ingress `from` that is
`namespaceSelector`-only or has an empty `podSelector`. A rule written that way
silently drops the traffic. The working form is port-scoped with no `from`
(port `8081` only), as above. On a CNI that honors selectors you can and should
scope `from` to the gateway namespace/pods instead.

## 5. Envoy Gateway route timeouts

**[stopgap]** (nebari-operator#120 routing.streaming)

Envoy Gateway applies a default 15s route timeout. Two dask-gateway flows exceed
it and fail:

- REST long-poll: `GET /api/v1/clusters/<name>?wait` blocks until the cluster is
  ready; at 15s the client gets `504 Gateway Timeout`.
- Streaming responses over the hub route (the live dashboard, and unrelated
  ds-pack streams like the gallery git-clone) are cut mid-response
  (`ERR_INCOMPLETE_CHUNKED_ENCODING`).

Raise the timeout with a `BackendTrafficPolicy` targeting each route:

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: dask-gateway-longpoll-timeout
  namespace: dask-gateway
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: dask-gateway-pack-public-route
  timeout:
    http:
      requestTimeout: 300s
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: jupyter-streaming-timeout
  namespace: jupyterhub
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: data-science-pack-nebari-data-science-pack-route
  timeout:
    http:
      requestTimeout: 600s
```

The HTTPRoute names are the ones the operator generates for each NebariApp;
confirm with `kubectl get httproute -A`. When nebari-operator#120 lands, a
`routing.streaming` field on the NebariApp replaces both of these.

## 6. Client environment alignment (avoiding KilledWorker)

The dask client (in the notebook / nebi workspace) and the workers (the cluster
image from section 1) must run compatible `python` and `dask`. A mismatch shows
up as `KilledWorker` on the first task, because cross-version cloudpickle fails
on the worker. The version warning that dask prints on `client = cluster.get_client()`
tells you the skew.

With nebi, the client lives in a pixi workspace, so pin it there to match the
worker image. For the `2026.3.0` cluster image above:

```toml
[dependencies]
python = "==3.13"
dask = "==2026.3.0"
dask-gateway = "*"
ipykernel = "*"
ipywidgets = "*"   # for the interactive cluster_options / scale widgets
```

Then re-solve the workspace and restart the kernel. (When the pack publishes its
own pixi-locked cluster image, matching the client to that lock is the durable
fix.)

## Verification

1. `from dask_gateway import Gateway; g = Gateway()` - no address needed, it
   reads the injected env.
2. `g.cluster_options()` renders the profile form (section 1).
3. `cluster = g.new_cluster(...)` reaches `running` (long-poll survives, section 5).
4. `client = cluster.get_client()` - check the printed version table matches
   (section 6).
5. `client.submit(...).result()` returns instead of `KilledWorker`.
6. The dashboard link opens under the gateway hostname behind OIDC (section 1).

## Summary: what the operator/packs should eventually own

| Currently manual | Removed by |
| --- | --- |
| Two route-timeout `BackendTrafficPolicy` objects | nebari-operator#120 (`routing.streaming`) |
| Shared service token in two namespaces | nebari-infrastructure-core#551 (cross-namespace grant) |
| singleuser->scheduler egress + hub ingress NetworkPolicies | nebari-infrastructure-core#551 / pack-managed policies |
| `PROXY_ADDRESS` pinned to traefik `:8786` instead of Envoy | nebari-operator#168/#169 (TCP/TLS passthrough listener) |
| Cluster image override | dask-gateway-pack publishing its first cluster image |
| Empty `cluster_options()` | pack shipping a default profile handler |
