---
title: Configuration
description: The chart/values.yaml surface — NebariApp block, scheduler proxy exposure, and the dask-gateway subchart passthrough.
sidebar:
  order: 4
---

The chart lives under `chart/` and wraps the upstream dask-gateway chart as a
pinned dependency. Values fall into three groups.

## `nebariapp` — Nebari integration

Creates the `NebariApp` CR the nebari-operator reconciles into routing, TLS,
a Keycloak client, and a landing-page card. Disabled by default so the chart
lints and installs standalone; enable it on Nebari.

```yaml
nebariapp:
  enabled: true
  hostname: dask-gateway.<your-domain>   # required when enabled (FQDN)

  service:
    name: ""     # defaults to api-<computed dask-gateway fullname>
    port: 8000

  routing:
    routes:
      - pathPrefix: /        # OIDC-protected root (SecurityPolicy anchor)
        pathType: PathPrefix
    publicRoutes:
      - pathPrefix: /api     # token-authenticated by dask-gateway itself
        pathType: PathPrefix
    tls:
      enabled: true

  auth:
    enabled: true
    provider: keycloak
    provisionClient: true
    enforceAtGateway: true
    scopes: [openid, profile, email]
    # groups: []             # restrict access to specific Keycloak groups

  gateway: public            # or "internal"

  landingPage:
    enabled: true
    displayName: Dask Gateway
    category: compute
    healthCheck:
      enabled: true
      path: /api/health      # public route, reachable without OIDC
```

This is the **hybrid Model A** described in
[Architecture](/architecture/#auth-model-hybrid-model-a): the operator's
SecurityPolicy covers browser traffic on `/`, while `/api` bypasses OIDC at
the gateway and is protected by dask-gateway's own JupyterHub token auth.

## `schedulerProxy.external` — opt-in off-cluster scheduler access

Default **off**. When enabled, the pack renders one extra Service
(default `LoadBalancer`) selecting the Traefik pods and exposing **only**
the dedicated scheduler tcp entrypoint (:8786) — never the dashboards/web
port. Scheduler connections are mutual TLS terminated at the scheduler, so
no Nebari auth is bypassed.

```yaml
schedulerProxy:
  external:
    enabled: false
    type: LoadBalancer       # LoadBalancer | NodePort
    port: 8786
    annotations: {}          # cloud LB annotations
    # loadBalancerIP: ""
    # loadBalancerSourceRanges: []
    # nodePort: 30786        # only for type: NodePort
```

This is an interim mechanism — see [Roadmap & Limitations](/roadmap/) for
the operator feature that replaces it.

## `dask-gateway` — upstream subchart passthrough

Everything under `dask-gateway:` flows to the upstream chart
([full schema](https://github.com/dask/dask-gateway/blob/2026.3.0/resources/helm/dask-gateway/values.yaml)).
The pack's notable defaults:

### JupyterHub token auth

```yaml
dask-gateway:
  gateway:
    prefix: /
    auth:
      type: jupyterhub
      jupyterhub:
        # Same-namespace default: read the token z2jh generated for the
        # registered hub service "dask-gateway".
        apiTokenFromSecretName: hub
        apiTokenFromSecretKey: hub.services.dask-gateway.apiToken
        # Cross-namespace installs set these two instead:
        # apiToken: "<token registered with the hub>"
        # apiUrl: http://hub.<jupyterhub-namespace>:8081/hub/api
```

### Scheduler/worker image

```yaml
    backend:
      image:
        name: quay.io/nebari/dask-gateway-pack-cluster   # pixi-locked, first-party
        tag: "2026.3.0"
```

The image is built from `images/cluster/pixi.toml` — the pack's source of
truth for the dask/distributed/dask-gateway version triplet. See
[Using from the Data Science Pack](/consuming-from-data-science-pack/#matching-client-and-worker-versions).

### Cluster options exposed to users

`gateway.extraConfig` appends Python to `dask_gateway_config.py` — the place
for user-facing profiles, idle timeouts, custom options:

```yaml
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
            Select("profile", ["Small", "Medium", "Large"], default="Small",
                   label="Cluster Profile"),
            handler=options_handler,
        )
      idle: |
        c.KubeClusterConfig.idle_timeout = 1800
```

### Traefik (internal proxy)

```yaml
  traefik:
    installTraefik: true
    service:
      type: ClusterIP        # never a LoadBalancer — Envoy is the public entrypoint
      ports:
        web:
          port: 80           # REST api + dashboards (in-cluster)
        tcp:
          port: 8786         # DEDICATED scheduler entrypoint (TLS/SNI passthrough)
```

The dedicated tcp port (any non-`"web"` value) makes the upstream chart add
a separate Traefik entrypoint/containerPort and Service port, and the
controller's per-cluster `IngressRouteTCP`s target it. Do not set it back to
`web` — `schedulerProxy.external` requires the separation and will refuse to
render without it.
