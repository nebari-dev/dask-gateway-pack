---
title: Roadmap & Limitations
description: Off-cluster clients today (interim opt-in), what waits on the nebari-operator ListenerSet/TLSRoute work, and the migration plan.
sidebar:
  order: 7
---

## Off-cluster dask clients (interim, opt-in)

Off-cluster `dask_gateway` clients are supported via
`schedulerProxy.external` (default **off**): a separate pack-owned Service
(default `LoadBalancer`) that selects the Traefik pods and exposes **only**
the dedicated scheduler tcp entrypoint (:8786). Dashboards/web stay on the
ClusterIP Service. No Nebari auth is bypassed: scheduler connections are
mutually-authenticated TLS with per-cluster certificates terminated at the
scheduler — Traefik (and any LB in front of it) only routes on SNI, and the
REST API (cluster creation, credential handout) still goes through the Envoy
NebariApp route with dask-gateway's own token auth.

```yaml
schedulerProxy:
  external:
    enabled: true
    # type: LoadBalancer | NodePort, cloud annotations, source ranges, ...
```

Off-cluster client config (SNI + per-cluster certs are handled by the
dask-gateway client itself):

```python
from dask_gateway import Gateway
gw = Gateway(
    address="https://dask-gateway.<your-domain>",   # REST api via Envoy
    proxy_address="tls://<lb-address>:8786",        # scheduler TCP via the interim LB
    auth=...,                                       # e.g. JupyterHubAuth(api_token=...)
)
```

## The operator feature this waits on

The target design is
[nebari-operator#169](https://github.com/nebari-dev/nebari-operator/issues/169)
(the source of truth for this work): **TLS-passthrough (TLSRoute /
`routing.tcp`) support in NebariApp**.

Why the pack cannot do this itself:

- dask-gateway's scheduler protocol is TLS end-to-end and routed purely by
  SNI (`daskgateway-<namespace>.<cluster-name>`), which maps 1:1 onto a
  Gateway API `TLSRoute` attached to a `TLS`/`Passthrough` listener. The
  varying SNI label is the *second* DNS label, so no listener hostname
  wildcard can cover it — a passthrough listener needs a dedicated port,
  with exact hostnames on per-cluster routes.
- The NebariApp CRD is HTTP-only today (one hostname, one backend Service,
  `HTTPRoute`s, Terminate listeners); it cannot express a passthrough
  listener or TLSRoutes.
- A pack must **not** patch NIC's shared Gateway to add such a listener:
  the in-flight gateway rework
  ([nebari-operator#168](https://github.com/nebari-dev/nebari-operator/issues/168),
  ADR-0011 Option 2) moves per-app listeners *off* the shared Gateway into
  an operator-owned per-app **`ListenerSet`** (attached via
  `spec.parentRef`, authorized by `Gateway.spec.allowedListeners`) —
  eliminating exactly that co-ownership pattern.

The revised #169 therefore rebuilds the request on the ListenerSet
primitive, converged with
[nebari-infrastructure-core#403](https://github.com/nebari-dev/nebari-infrastructure-core/issues/403)
("listener-only TLS") into one shape: *the operator owns a listener
(Terminate or Passthrough) + cert; routes are optionally app-managed.* For
dask, the operator would own the stable Passthrough listener in the pack's
ListenerSet and the pack would attach namespace-local `TLSRoute`s.

On API maturity: `TLSRoute` is **GA (`v1`) since Gateway API v1.6.0** — not
an experimental API. The real gate is a version lag: Envoy Gateway v1.8.x
pins Gateway API v1.5.1 (where TLSRoute is still `v1alpha2`); EG v1.9.0
(~Aug 2026) closes it.

### Migration plan

When #169 lands, the pack drops the `schedulerProxy.external` Service and
attaches app-owned `TLSRoute`s to the operator's Passthrough listener. The
routing layer (Traefik and the upstream controller) is unchanged by the
swap — only the exposure mechanism moves.

## Other current limitations

- **No externally shareable dashboard URLs.** Dashboards are viewable only
  through each user's Jupyter server (dask-labextension) or in-cluster.
  External dashboard routing (per-cluster HTTPRoutes) rides on the same
  operator ListenerSet work.
- **DSP JupyterLab image lacks dask-labextension/dask-gateway** — see
  [Using from the Data Science Pack](/consuming-from-data-science-pack/#known-prerequisite-dsp-image-gap).
- **Traefik is an internal implementation detail** of the upstream chart
  (its kube-controller only knows Traefik CRs). If upstream ever grows a
  pluggable route backend, the pack can drop Traefik without a fork.
