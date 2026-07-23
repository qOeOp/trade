# syntax=docker/dockerfile:1.7

ARG RUST_VERSION=1.97.1
ARG BUN_VERSION=1.3.13
ARG GO_VERSION=1.25

FROM rust:${RUST_VERSION}-bookworm AS l2-builder
WORKDIR /build
COPY modules/market-data-products/l2-order-book-core modules/market-data-products/l2-order-book-core
COPY modules/market-data-products/l2-order-book-service modules/market-data-products/l2-order-book-service
RUN cargo build \
    --locked \
    --release \
    --bins \
    --manifest-path modules/market-data-products/l2-order-book-service/Cargo.toml

FROM golang:${GO_VERSION}-bookworm AS indicator-builder
WORKDIR /build/modules/market-data-products/tech-indicators
COPY modules/market-data-products/tech-indicators/go.mod ./
COPY modules/market-data-products/tech-indicators/src ./src
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o target/release/tech-indicators ./src/scripts

FROM oven/bun:${BUN_VERSION}-debian AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git procps tini \
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
COPY --from=indicator-builder \
    /build/modules/market-data-products/tech-indicators/target/release/tech-indicators \
    /app/modules/market-data-products/tech-indicators/target/release/tech-indicators

ARG TRADE_SOURCE_REVISION=container-local
RUN case "${TRADE_SOURCE_REVISION}" in \
      *[!A-Za-z0-9._+-]*|"") exit 1 ;; \
    esac \
    && git init \
    && git config user.email container-source@example.invalid \
    && git config user.name "Trade Container Source" \
    && git add -A \
    && GIT_AUTHOR_DATE=2000-01-01T00:00:00Z \
       GIT_COMMITTER_DATE=2000-01-01T00:00:00Z \
       git commit -m "container source snapshot" \
    && internal_commit="$(git rev-parse HEAD)" \
    && printf '{"schema_version":"trade.container-source-revision.v1","source_revision":"%s","internal_commit":"%s"}\n' \
       "${TRADE_SOURCE_REVISION}" "${internal_commit}" \
       > /app/.trade-source-revision.json

RUN groupadd --gid 10001 trade \
    && useradd --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin trade \
    && mkdir -p /app/data/l2 /app/data/ops /app/data/artifacts/agent-runs /app/data/artifacts/market-data /app/tmp/artifacts /app/tmp/panels /app/tmp/server-runtime/logs /app/tmp/agent-workspace-slots \
    && chown -R trade:trade /app/data /app/tmp \
    && chown -R trade:trade /app/.git /app/tmp/agent-workspace-slots

ENV NODE_ENV=production
ENV TRADE_REPO_ROOT=/app
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "modules/orchestration-ops/trade-flow/src/scripts/server-runtime-container-foreground.ts", "--profile", "profile/server-runtime-container.json"]

FROM runtime AS developer
USER 0:0
RUN bun install --frozen-lockfile
USER 10001:10001
