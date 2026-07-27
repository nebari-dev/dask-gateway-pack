---
title: NebariApp CRD Reference
description: The NebariApp fields dask-gateway-pack uses, and how the nebari-operator reconciles them.
sidebar:
  order: 5
---

`apiVersion: reconcilers.nebari.dev/v1`, `kind: NebariApp` (namespaced,
shortName `nebariapp`). A NebariApp declares "expose and secure me": the
[nebari-operator](https://github.com/nebari-dev/nebari-operator) reconciles
it into an `HTTPRoute` on the shared Envoy Gateway, a cert-manager
`Certificate` + per-app HTTPS listener, a Keycloak OIDC client, and a
landing-page entry. Authoritative source:
[`api/v1/nebariapp_types.go`](https://github.com/nebari-dev/nebari-operator/blob/main/api/v1/nebariapp_types.go).

## The CR this pack renders

```yaml
apiVersion: reconcilers.nebari.dev/v1
kind: NebariApp
metadata:
  name: dask-gateway-pack
spec:
  hostname: dask-gateway.example.com   # REQUIRED, FQDN
  service:                             # REQUIRED - one backend Service
    name: api-dask-gateway-pack        # the gateway REST api
    port: 8000
  routing:
    routes:
      - pathPrefix: /
        pathType: PathPrefix
    publicRoutes:                      # bypass OIDC at the gateway
      - pathPrefix: /api
        pathType: PathPrefix
    tls:
      enabled: true
  auth:
    enabled: true
    provider: keycloak
    provisionClient: true
    enforceAtGateway: true
    scopes: [openid, profile, email]
  gateway: public
  landingPage:
    enabled: true
    displayName: Dask Gateway
    category: compute
    healthCheck:
      enabled: true
      path: /api/health
```

## Field reference (fields this pack uses)

| Field | Type | Notes |
|---|---|---|
| `hostname` | string (required) | FQDN; drives the HTTPRoute and the Certificate. |
| `service` | object (required) | `name` + `port` of the backend Service (the api Service here). |
| `routing.routes` | list | Path rules for the main, OIDC-protected `<name>-route`. |
| `routing.publicRoutes` | list | Paths routed via a separate `<name>-public-route` the SecurityPolicy does not cover — how `/api` stays reachable for programmatic clients. |
| `routing.tls.enabled` | bool (default true) | cert-manager Certificate + per-app HTTPS listener. `routing.tls.secretName` selects a pre-provisioned secret instead. |
| `auth.enabled` | bool | OIDC via the platform Keycloak. |
| `auth.provisionClient` | bool (default true) | Operator creates the Keycloak client and stores credentials in Secret `<name>-oidc-client`. |
| `auth.enforceAtGateway` | bool (default true) | Model A: an Envoy `SecurityPolicy` does the whole OIDC dance at the gateway (this pack's choice for browser traffic). `false` = Model B (app-managed OAuth). |
| `auth.scopes` / `auth.groups` | list | Requested scopes; optional group allow-list. |
| `gateway` | `public` \| `internal` | Which shared Gateway the route attaches to. |
| `landingPage` | object | Card metadata + health check. Card visibility is derived from `spec.auth` (auth on = private). |

## Operational notes

- **Namespace opt-in is mandatory:** the namespace must carry
  `nebari.dev/managed=true` or the NebariApp is held at
  `NamespaceNotOptedIn`.
- **Status:** conditions `RoutingReady`, `TLSReady`, `AuthReady`, and the
  aggregate `Ready`; `kubectl get nebariapp -o wide` shows them. Common
  failure reasons: `NamespaceNotOptedIn`, `ServiceNotFound`,
  `GatewayNotFound`, `CertificateNotReady`.
- **Derived names:** route `<name>-route`, public route
  `<name>-public-route`, SecurityPolicy `<name>-security`, OIDC secret
  `<name>-oidc-client`, Keycloak client id `<namespace>-<name>`.
- **What NebariApp cannot express (yet):** L4/TLS-passthrough routing — the
  reason scheduler TCP is not routed through Envoy today. See
  [Roadmap & Limitations](/roadmap/).
