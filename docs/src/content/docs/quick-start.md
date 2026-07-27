---
title: Quick Start
description: Deploy dask-gateway-pack on a Nebari cluster via ArgoCD, or standalone with Helm.
sidebar:
  order: 1
---

## On Nebari (ArgoCD)

Packs deploy as ArgoCD `Application`s in the **`nebari-apps`** project,
pointing at this repo's `chart/` directory (or the published chart from the
[Nebari helm-repository](https://github.com/nebari-dev/helm-repository)).
The one required value beyond enabling the NebariApp is the hostname:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dask-gateway-pack
  namespace: argocd
spec:
  project: nebari-apps
  source:
    repoURL: https://github.com/nebari-dev/dask-gateway-pack
    targetRevision: main
    path: chart
    helm:
      releaseName: dask-gateway-pack
      values: |
        nebariapp:
          enabled: true
          hostname: dask-gateway.<your-domain>
  destination:
    server: https://kubernetes.default.svc
    namespace: dask-gateway
  syncPolicy:
    managedNamespaceMetadata:
      labels:
        nebari.dev/managed: "true"
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
      - SkipDryRunOnMissingResource=true
```

Two operational must-knows:

- **Namespace opt-in.** The nebari-operator only reconciles NebariApps in
  namespaces labeled `nebari.dev/managed=true`. The
  `managedNamespaceMetadata` block above does it declaratively; manually it
  is `kubectl label namespace dask-gateway nebari.dev/managed=true`.
  Without it the NebariApp sits at `NamespaceNotOptedIn`.
- **Same namespace as the data-science-pack** is the supported default: the
  gateway then reads the JupyterHub service token straight from the `hub`
  Secret and infers the hub API URL from the environment. See
  [Using from the Data Science Pack](/consuming-from-data-science-pack/).

Verify:

```sh
kubectl get nebariapp dask-gateway-pack -n dask-gateway   # wait for Ready
curl https://dask-gateway.<your-domain>/api/health         # 200, no login
```

## Standalone (plain Helm, no Nebari)

The chart installs on any Kubernetes cluster with `nebariapp.enabled=false`
(the default). Without a JupyterHub to validate tokens, switch the gateway
to simple auth:

```sh
helm install dask-gateway chart \
  --create-namespace --namespace dask-gateway \
  --set dask-gateway.gateway.auth.type=simple \
  --set dask-gateway.gateway.auth.simple.password=<password>
```

Then, from inside the cluster (or via `kubectl port-forward svc/traefik-dask-gateway 8080:80 8786:8786`):

```python
from dask_gateway import Gateway, BasicAuth
gw = Gateway("http://localhost:8080",
             proxy_address="tcp://localhost:8786",
             auth=BasicAuth(password="<password>"))
cluster = gw.new_cluster()
cluster.scale(2)
client = cluster.get_client()
```

See [Configuration](/configuration/) for the full values surface.
