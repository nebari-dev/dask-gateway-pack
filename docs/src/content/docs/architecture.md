---
title: Architecture
description: REST API via Envoy, in-cluster Traefik proxy for scheduler traffic, dashboards via dask-labextension — and why there is no fork.
sidebar:
  order: 2
---

## Exposure map

| Traffic | Path | Exposure |
|---|---|---|
| Gateway REST API | NebariApp → operator `HTTPRoute` → `api-<fullname>:8000` | public (via the shared Envoy Gateway) |
| Scheduler TCP (client ↔ scheduler, TLS+SNI) | upstream Traefik, dedicated `tcp` entrypoint :8786 (`IngressRouteTCP` per cluster, SNI passthrough) | in-cluster (ClusterIP) by default; opt-in external LoadBalancer via `schedulerProxy.external` |
| Per-cluster dashboards | upstream Traefik `web` entrypoint (`IngressRoute` per cluster) → rendered in JupyterLab via dask-labextension | in-cluster only |

## Components

| Component | Workload | Image |
|---|---|---|
| Gateway server | `api-<fullname>` Deployment + Service :8000 | upstream `ghcr.io/dask/dask-gateway-server` |
| Kube controller | `controller-<fullname>` Deployment | upstream `ghcr.io/dask/dask-gateway-server` |
| Traefik proxy (internal) | `traefik-<fullname>` Deployment + **ClusterIP** Service | upstream `docker.io/traefik` |
| Scheduler/worker pods | created per DaskCluster | first-party `quay.io/nebari/dask-gateway-pack-cluster` (`images/cluster/`, pixi-locked) |

The cluster image is the pack's only first-party image — the same split
classic Nebari made (upstream gateway/controller images, first-party
`nebari-dask-worker` built from the `nebari-dask` metapackage).

## Why this shape (source-verified)

These three facts, verified against dask-gateway 2026.3.0 source, drive the
whole design:

1. **The proxy is mandatory.** The `dask_gateway` client always reaches
   schedulers through a proxy — it dials `gateway://<proxy-address>/<cluster>`
   with TLS SNI `daskgateway-<ns>.<name>` (`dask_gateway/client.py`,
   `comm.py`); scheduler connections are mutual TLS terminated **at the
   scheduler pod** with per-cluster certificates. There is no
   direct-to-scheduler mode.
2. **The upstream kube-controller is hard-wired to Traefik.** It creates
   `traefik.io/v1alpha1` `IngressRoute` (dashboard,
   `/clusters/<ns>.<name>/` → scheduler :8787) and `IngressRouteTCP` (SNI
   passthrough → scheduler :8786) per DaskCluster
   (`backends/kubernetes/controller.py`). `traefik.installTraefik: false`
   only skips the Traefik *workload*, not the CR creation — removing Traefik
   entirely would mean replacing the controller, i.e. a fork. So the pack
   keeps Traefik, but **internal-only**: a ClusterIP Service is fully
   supported upstream, and nothing about the controller/Traefik pair needs
   external exposure when clients are in-cluster.
3. **Dashboards need no ingress for JupyterLab users.** dask-labextension
   proxies the dashboard through the user's own Jupyter server
   (`dask_labextension/dashboardhandler.py`, a `jupyter_server_proxy`
   handler): the singleuser pod fetches the in-cluster dashboard URL and the
   browser only ever talks to the Jupyter server — already exposed and
   hub-authenticated.

Traefik's scheduler traffic runs on a **dedicated tcp entrypoint (:8786)**
rather than sharing the web port (`dask-gateway.traefik.service.ports.tcp.port:
8786`). That separation is what lets the opt-in
[external scheduler proxy](/roadmap/#off-cluster-dask-clients-interim-opt-in)
expose scheduler TCP without ever exposing dashboards.

## Auth model (hybrid Model A)

- `auth.enabled: true`, `enforceAtGateway: true` — the operator creates an
  Envoy `SecurityPolicy` + Keycloak client; browser traffic on the root
  route goes through Keycloak SSO, and the landing-page card is private.
- `routing.publicRoutes: [/api]` — the REST API bypasses OIDC at Envoy
  because the `dask_gateway` client is programmatic. It is **not**
  unauthenticated: the gateway runs `gateway.auth.type: jupyterhub` and
  validates every request's JupyterHub API token against the hub REST API.
  Since the data-science-pack hub authenticates users through
  `KeyCloakOAuthenticator`, identity still chains back to Keycloak.
- Dashboards are reachable only in-cluster, at unguessable
  `/clusters/<ns>.<uuid>/` paths on Traefik's ClusterIP (classic-Nebari
  parity); browser access goes through the user's hub-authenticated Jupyter
  server.

## Explicit non-goals (no fork, no shared-Gateway mutation)

- **No forked controller image.** An earlier design replaced the upstream
  kube-controller with a Gateway-API-emitting subclass; it was rejected in
  favor of keeping Traefik internal. If upstream ever grows a pluggable
  route backend, the pack can drop Traefik without a fork.
- **No mutation of NIC's shared Gateway.** The ongoing gateway rework
  (ADR-0011 / per-app `ListenerSet`) removes exactly that co-ownership
  pattern; L4 exposure through the platform gateway is
  [operator work](/roadmap/), not pack work.
