---
title: Using from the Data Science Pack
description: Wire JupyterHub token auth, point notebook clients at the gateway, render dashboards in JupyterLab, and keep client/worker dask versions matched.
sidebar:
  order: 3
---

The pack is designed to be installed **in the same namespace** as the
[data-science-pack](https://github.com/nebari-dev/data-science-pack)
(JupyterHub/JupyterLab). Two upstream conveniences then work with zero token
plumbing: the z2jh chart auto-generates an API token for every registered hub
service (stored in the `hub` Secret), and the hub API URL is inferred from
the in-namespace `hub` Service environment.

## DSP-side configuration

Register the hub service and point the dask client config at the in-cluster
Traefik (values for the data-science-pack's `jupyterhub:` block):

```yaml
jupyterhub:
  hub:
    services:
      dask-gateway: {}   # token appears in Secret "hub" under hub.services.dask-gateway.apiToken

  singleuser:
    extraEnv:
      # dask config env convention: DASK_GATEWAY__<KEY> => gateway.<key>.
      # With these set, notebook code is just:
      #   from dask_gateway import Gateway; gw = Gateway(); gw.new_cluster()
      DASK_GATEWAY__ADDRESS: "http://traefik-dask-gateway-pack.<namespace>"
      DASK_GATEWAY__PROXY_ADDRESS: "tcp://traefik-dask-gateway-pack.<namespace>:8786"
      # Send the JUPYTERHUB_API_TOKEN every singleuser pod already carries:
      DASK_GATEWAY__AUTH__TYPE: "jupyterhub"
      # dask-labextension "NEW" button -> GatewayCluster:
      DASK_LABEXTENSION__FACTORY__MODULE: "dask_gateway"
      DASK_LABEXTENSION__FACTORY__CLASS: "GatewayCluster"
```

Notes:

- Replace `traefik-dask-gateway-pack` with the actual Traefik Service
  (`kubectl get svc -l app.kubernetes.io/name=dask-gateway`); it is
  `traefik-<fullname>`.
- Leave `DASK_GATEWAY__PUBLIC_ADDRESS` **unset**: the client then derives
  `cluster.dashboard_link` from the in-cluster address, which is exactly
  what dask-labextension's server-side proxy needs to reach.
- If the z2jh singleuser NetworkPolicy restricts egress, allow egress to the
  gateway namespace on ports 80 and 8786.
- Classic Nebari achieved the same discovery by mounting a `dask-etc`
  ConfigMap at `/etc/dask`; env vars are equivalent (dask reads both) and
  avoid cross-chart ConfigMap coupling.

## Dashboards inside JupyterLab

dask-labextension proxies dashboards **through the user's own Jupyter
server** (its `dashboardhandler` is a `jupyter_server_proxy` handler): the
singleuser pod fetches the in-cluster dashboard URL, and the browser only
talks to the Jupyter server — already exposed through Envoy and
hub-authenticated. Dashboards therefore need no ingress of their own.

## Matching client and worker versions

DSP kernels come from **nebi-managed pixi workspaces**
([nb-nebi-kernels](https://github.com/nebari-dev/nb-nebi-kernels) exposes
each workspace environment as a Jupyter kernel), so "client environment"
means two different environments:

1. **The kernel environment (nebi pixi workspace)** — where notebook code
   runs `from dask_gateway import Gateway`. Its dask/distributed/dask-gateway
   pins must match the worker image. The pack's cluster image is pixi-built
   from `images/cluster/pixi.toml`; copy its three pins into your
   workspace's `pixi.toml` and compatibility holds by construction:

   ```toml
   [dependencies]
   dask = "2026.3.0"
   distributed = "2026.3.0"
   dask-gateway = "2026.3.0"
   ```

2. **The JupyterLab server environment** — where dask-labextension (the
   clusters sidebar + inline dashboard panes) runs.

## Known prerequisite: DSP image gap

:::caution[DSP change required]
The data-science-pack JupyterLab image does **not** currently ship
`dask-labextension` or `dask-gateway` — its pixi lock carries only a
transitive `dask-core 2025.2.0`, versus this pack's `2026.3.0` triplet.
Until `dask-labextension` (and `dask-gateway`, which its cluster factory
imports) are added to `images/jupyterlab/pixi.toml` in data-science-pack,
the in-lab clusters sidebar and inline dashboard panes are unavailable —
notebook code using the `dask_gateway` client from a properly-pinned nebi
workspace kernel works regardless.
:::
