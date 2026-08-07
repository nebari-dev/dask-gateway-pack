---
title: Using from the Data Science Pack
description: The notebook-side view - reach the gateway, render dashboards in JupyterLab, and keep client and worker dask versions matched.
sidebar:
  order: 3
---

This is the **notebook-side** view. For the **operator-side** deployment wiring
(Helm values on both packs, the shared service token, and the NetworkPolicy and
route-timeout workarounds that a cross-namespace install needs), see
[Deploying alongside the data-science-pack](/deploying-alongside-data-science-pack/).

Once that wiring is in place, the gateway address and auth are injected into
every singleuser pod, so notebook code is just:

```python
from dask_gateway import Gateway
gw = Gateway()            # reads the injected DASK_GATEWAY__* config
cluster = gw.new_cluster()
cluster.scale(2)
client = cluster.get_client()
```

## dask-labextension in the sidebar

To make the JupyterLab clusters sidebar create GatewayClusters from its "NEW"
button, set two more env vars on the data-science-pack singleuser pods:

```yaml
jupyterhub:
  singleuser:
    extraEnv:
      DASK_LABEXTENSION__FACTORY__MODULE: "dask_gateway"
      DASK_LABEXTENSION__FACTORY__CLASS: "GatewayCluster"
```

Leave `DASK_GATEWAY__PUBLIC_ADDRESS` unset (or pointed at the in-cluster
address) so the client derives `cluster.dashboard_link` from an address
dask-labextension's server-side proxy can actually reach.

## Dashboards inside JupyterLab

dask-labextension proxies dashboards **through the user's own Jupyter server**
(its `dashboardhandler` is a `jupyter_server_proxy` handler): the singleuser pod
fetches the in-cluster dashboard URL, and the browser only ever talks to the
Jupyter server, which is already exposed through Envoy and hub-authenticated.
Dashboards therefore need no ingress of their own.

## Matching client and worker versions

DSP kernels come from **nebi-managed pixi workspaces**
([nb-nebi-kernels](https://github.com/nebari-dev/nb-nebi-kernels) exposes each
workspace environment as a Jupyter kernel), so "client environment" means two
different things:

1. **The kernel environment (nebi pixi workspace)** - where notebook code runs
   `from dask_gateway import Gateway`. Its dask/distributed/dask-gateway pins
   must match the worker image, or the first task fails with `KilledWorker`
   (cross-version cloudpickle). The pack's cluster image is pixi-built from
   `images/cluster/pixi.toml`; copy its three pins into your workspace's
   `pixi.toml` and compatibility holds by construction:

   ```toml
   [dependencies]
   dask = "==2026.3.0"
   distributed = "==2026.3.0"
   dask-gateway = "==2026.3.0"
   ```

2. **The JupyterLab server environment** - where dask-labextension (the clusters
   sidebar + inline dashboard panes) runs.

## Known prerequisite: DSP image gap

:::caution[DSP change required]
The data-science-pack JupyterLab image does **not** currently ship
`dask-labextension` or `dask-gateway` - its pixi lock carries only a transitive
`dask-core`, older than this pack's `2026.3.0` triplet. Until `dask-labextension`
(and `dask-gateway`, which its cluster factory imports) are added to
`images/jupyterlab/pixi.toml` in data-science-pack, the in-lab clusters sidebar
and inline dashboard panes are unavailable. Notebook code using the
`dask_gateway` client from a properly-pinned nebi workspace kernel works
regardless.
:::
