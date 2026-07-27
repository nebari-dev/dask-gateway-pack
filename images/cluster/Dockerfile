# dask-gateway-pack cluster image (scheduler + worker pods)
#
# pixi-built from the locked manifest in this directory — the same
# build discipline as the data-science-pack images (images/Dockerfile there),
# so the dask/distributed/dask-gateway triplet is pinned by pixi.lock and
# client environments can reproduce it exactly (see pixi.toml header).
ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

# Pin the pixi installer for reproducible builds (override at build time if needed).
ARG PIXI_VERSION=0.73.0

LABEL org.opencontainers.image.source="https://github.com/nebari-dev/dask-gateway-pack"
LABEL org.opencontainers.image.description="Dask scheduler/worker image for dask-gateway-pack (pixi-locked)"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://pixi.sh/install.sh | PIXI_VERSION=v${PIXI_VERSION} PIXI_HOME=/usr/local bash

ENV DEFAULT_ENV=default

COPY pixi.toml pixi.lock /opt/dask-cluster/
RUN --mount=type=cache,target=/root/.cache/rattler/cache,sharing=locked \
    pixi install --manifest-path /opt/dask-cluster/ -e ${DEFAULT_ENV} --locked

# Run as non-root, matching the upstream ghcr.io/dask/dask-gateway image.
# ubuntu:24.04 ships a default "ubuntu" user at uid 1000; remove it so dask
# can own that uid (matches upstream and keeps file perms predictable).
RUN userdel --remove ubuntu 2>/dev/null || true; \
    useradd --create-home --user-group --uid 1000 dask
USER dask:dask
WORKDIR /home/dask/

ENV PATH=/opt/dask-cluster/.pixi/envs/${DEFAULT_ENV}/bin:${PATH}

# CMD is supplied at runtime by dask-gateway-server (scheduler/worker cmd).
ENTRYPOINT ["tini", "-g", "--"]
