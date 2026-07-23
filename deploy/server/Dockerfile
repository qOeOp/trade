# syntax=docker/dockerfile:1.7

ARG RUST_VERSION=1.97.1
ARG BUN_VERSION=1.3.13

FROM rust:${RUST_VERSION}-bookworm AS l2-builder
WORKDIR /build
COPY modules/market-data-products/l2-order-book-core modules/market-data-products/l2-order-book-core
COPY modules/market-data-products/l2-order-book-service modules/market-data-products/l2-order-book-service
RUN cargo build \
    --locked \
    --release \
    --bins \
    --manifest-path modules/market-data-products/l2-order-book-service/Cargo.toml

FROM oven/bun:${BUN_VERSION}-debian AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates procps tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY AGENTS.md README.md toolset.json ./
COPY docs docs
COPY modules modules
COPY profile profile
COPY schemas schemas
COPY scripts scripts
COPY strategies strategies
COPY --from=l2-builder \
    /build/modules/market-data-products/l2-order-book-service/target/release/l2-order-book-service \
    /app/modules/market-data-products/l2-order-book-service/target/release/l2-order-book-service
COPY --from=l2-builder \
    /build/modules/market-data-products/l2-order-book-service/target/release/l2-order-book-query \
    /app/modules/market-data-products/l2-order-book-service/target/release/l2-order-book-query

RUN groupadd --gid 10001 trade \
    && useradd --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin trade \
    && mkdir -p /app/data/l2 /app/tmp/artifacts /app/tmp/panels /app/tmp/server-runtime/logs \
    && chown -R trade:trade /app/data /app/tmp

ENV NODE_ENV=production
ENV TRADE_REPO_ROOT=/app
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "modules/orchestration-ops/trade-flow/src/scripts/server-runtime-container-foreground.ts", "--profile", "profile/server-runtime.json"]
