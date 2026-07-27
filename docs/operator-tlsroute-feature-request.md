# Operator TLS-passthrough support: filed as nebari-operator#169

> This document was the pre-filing draft of the feature request. It has
> since been **filed and revised as
> [nebari-operator#169](https://github.com/nebari-dev/nebari-operator/issues/169)**
> — that issue is the source of truth now; this file is kept only as a
> pointer plus the pack-local context.

## Where the request landed (summary of the revised issue)

- The original draft proposed upserting a Passthrough listener onto NIC's
  shared Gateway. That is exactly the co-ownership pattern the gateway
  rework removes, so #169 was rebased: the Passthrough listener must live
  in the **operator-owned per-app `ListenerSet`** introduced by
  [nebari-operator#168](https://github.com/nebari-dev/nebari-operator/issues/168)
  (ADR-0011 Option 2 — operator never mutates NIC's Gateway; apps attach
  via `ListenerSet.spec.parentRef`, NIC authorizes via
  `Gateway.spec.allowedListeners`).
- It converges with
  [nebari-infrastructure-core#403](https://github.com/nebari-dev/nebari-infrastructure-core/issues/403)
  ("listener-only TLS") into one primitive: *operator owns a listener
  (Terminate or Passthrough) + cert; routes optionally app-managed*.
- `TLSRoute` is **GA (`v1`) since Gateway API v1.6.0**. The gate is a
  version lag, not API maturity: Envoy Gateway v1.8.x pins Gateway API
  v1.5.1 (`TLSRoute` still `v1alpha2`); EG v1.9.0 (~Aug 2026) closes it.
  Preferred split keeps the operator's contract stable regardless: the
  operator owns the Passthrough listener; the app owns the `TLSRoute`s in
  its own namespace.

## What dask-gateway-pack does meanwhile / will do then

- **Now (interim):** `schedulerProxy.external` (default off) exposes only
  Traefik's dedicated scheduler tcp entrypoint (:8786, TLS/SNI passthrough,
  mTLS end-to-end) through a pack-owned LoadBalancer Service
  (`chart/templates/scheduler-proxy-lb.yaml`). No shared-Gateway patching, no
  forks.
- **Then (migration):** delete that Service; attach app-owned `TLSRoute`s
  to the operator's ListenerSet Passthrough listener. Traefik and the
  upstream controller are unchanged by the swap — only the exposure
  mechanism moves.
