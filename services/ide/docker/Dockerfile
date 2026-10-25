# The trade IDE service (the research graph is its first view): the product at the commit it was built from, Dolt, and the built page.
# CI builds it (.github/workflows/ide-image.yml); the context is the repository root with
# its shallow .git, since the product reads its own revision with `git rev-parse HEAD`.
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS web
WORKDIR /web
COPY services/ide/web/ ./
RUN npm ci --no-audit --no-fund && npm run build

FROM ghcr.io/astral-sh/uv:0.12.1@sha256:cf4eedcaa81655197f625739489effcbe71b61ceb1506f332c3facae5deceded AS uv
FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2

ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:c1c610e22c6bacd4c5b2fbf5697a0f453d759d075c4abff380c6e646553e22d8 \
    https://github.com/dolthub/dolt/releases/download/v2.4.2/dolt-linux-arm64.tar.gz /tmp/dolt.tar.gz
RUN [ "$TARGETARCH" = arm64 ] && tar -xzf /tmp/dolt.tar.gz -C /tmp && mv /tmp/dolt-linux-arm64/bin/dolt /usr/local/bin/dolt \
    && rm -rf /tmp/dolt.tar.gz /tmp/dolt-linux-arm64 && dolt version | grep -q 'dolt version 2.4.2'

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/trade
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache --no-install-project
COPY . ./
RUN uv sync --frozen --no-dev --no-cache && git rev-parse HEAD
COPY --from=web /web/dist services/ide/web/dist/
# The page was built from exactly these sources; record their digest as the renderer does.
RUN python3 -c "import sys; sys.path.insert(0, 'services/ide'); from research_graph.renderers.web import render as r; \
(r.PAGE.parent / r.BUILT_FROM).write_text(r.digest(r.sources()) + '\n'); r.built_page()"
COPY services/ide/docker/entrypoint.sh /usr/local/bin/trade-ide-entrypoint
COPY services/ide/docker/pull.sh /usr/local/bin/trade-ide-pull

ENV PATH="/opt/trade/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_NO_SYNC=1 \
    TRADE_LEDGER_HOME=/data/ledgers DOLT_ROOT_PATH=/data/dolt/home
VOLUME /data
EXPOSE 8765
LABEL org.opencontainers.image.title="Trade IDE"
ENTRYPOINT ["trade-ide-entrypoint"]
