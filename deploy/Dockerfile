# The trade IDE service (the research graph is its first view): the product at the commit it was built from, Dolt, the built page and the chat service.
# The `service` target runs the compose project's other two product services, each with its own command: the
# Dolt service of the research ledger (`ledger service run`) and the paper daemon, which reaches Docker only
# through the project's restricted API proxy (docs/plans/paper-compose-deployment.zh.md,
# docs/plans/ledger-compose-service.zh.md). The `docker-api` target is that proxy, on its own.
# CI builds all three (.github/workflows/ide-image.yml); the context is the repository root with
# its shallow .git, since the product reads its own revision with `git rev-parse HEAD`.
ARG TARGETARCH

# One static binary and nothing else in the container that holds the engine's socket. Its tests run here.
FROM golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS docker-api-build
WORKDIR /src
COPY deploy/docker-api/ ./
RUN go vet ./... && go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /docker-api .

FROM scratch AS docker-api
COPY --from=docker-api-build /docker-api /docker-api
EXPOSE 2375
LABEL org.opencontainers.image.title="Trade Docker API proxy"
ENTRYPOINT ["/docker-api"]

FROM scratch AS dolt-arm64
ADD --checksum=sha256:5498898fdb4b93ce69deb9e32fb9e0fbaceb734657e6013afc0e914ae9c10afe \
    https://github.com/dolthub/dolt/releases/download/v2.7.2/dolt-linux-arm64.tar.gz /dolt.tar.gz
FROM scratch AS dolt-amd64
ADD --checksum=sha256:72825a65d96bf0a0967ec408ad43bc21afc9b1c899b84cb84344a35f567fb11f \
    https://github.com/dolthub/dolt/releases/download/v2.7.2/dolt-linux-amd64.tar.gz /dolt.tar.gz
FROM dolt-${TARGETARCH} AS dolt-download

FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS web
WORKDIR /web
# The required ide-web check already ran tsc, the rules check and the web tests on this source.
COPY ide/web/ ./
RUN npm ci --no-audit --no-fund && npx vite build

# The chat service's production dependencies; it runs on the same Node, which strips types itself.
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS agent
WORKDIR /agent
COPY ide/agent/package.json ide/agent/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM ghcr.io/astral-sh/uv:0.12.1@sha256:cf4eedcaa81655197f625739489effcbe71b61ceb1506f332c3facae5deceded AS uv
FROM docker:29.1.3-cli@sha256:4fa0ee1f3a7e4354c4ea34558b6d4ee32859baf4973d4c8ccc8e7fe3dd730c04 AS docker

# The product at this commit, with Dolt: what both targets share.
FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2 AS product

ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates procps && rm -rf /var/lib/apt/lists/*
COPY --from=dolt-download /dolt.tar.gz /tmp/dolt.tar.gz
RUN tar -xzf /tmp/dolt.tar.gz -C /tmp && mv /tmp/dolt-linux-${TARGETARCH}/bin/dolt /usr/local/bin/dolt \
    && rm -rf /tmp/dolt.tar.gz /tmp/dolt-linux-${TARGETARCH} && dolt version | grep -q 'dolt version 2.7.2'

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/trade
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache --no-install-project
COPY . ./
RUN uv sync --frozen --no-dev --no-cache && git rev-parse HEAD
# Each product command the services start is a new process, and none may write bytecode where it runs (the base
# image ships none): compile the interpreter's library, the environment and the product once, here.
RUN python -m compileall -q -j 0 "$(python -c 'import sysconfig; print(sysconfig.get_paths()["stdlib"])')" /opt/trade
# The services run as the host user, not the owner of /opt/trade: git reads the revision there only when it is
# a safe directory.
ENV PATH="/opt/trade/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_NO_SYNC=1 \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=/opt/trade

# The ledger service and the paper daemon; compose names each one's command, environment and the host paths
# at their own place. The Dolt data lives in a volume mounted at /var/lib/trade-dolt, and the reader-only
# service file in one at /var/lib/trade-readers, which the service's user (the host user's uid, unknown
# here) must be able to fill on first start.
FROM product AS service
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /var/lib/trade-dolt /var/lib/trade-readers /var/lib/trade-controllers \
    && chmod 1777 /var/lib/trade-dolt /var/lib/trade-readers /var/lib/trade-controllers
EXPOSE 8767 13330
LABEL org.opencontainers.image.title="Trade services"

# The IDE service (the default target).
FROM product AS ide
COPY --from=web /web/dist ide/web/dist/
COPY --from=agent /usr/local/bin/node /usr/local/bin/node
COPY --from=agent /agent/node_modules ide/agent/node_modules/
# The page was built from exactly these sources; record their digest as the renderer does.
RUN python3 -c "import sys; sys.path.insert(0, 'ide'); from research_graph import render as r; \
(r.PAGE.parent / r.BUILT_FROM).write_text(r.digest(r.sources()) + '\n'); r.built_page()"
COPY deploy/entrypoint.sh /usr/local/bin/trade-ide-entrypoint

# The profiles are compose configs here; the chat service's agents and threads live in /data/agent.
ENV TRADE_LEDGER_HOME=/run/trade/ledgers
VOLUME /data/agent
EXPOSE 8765
LABEL org.opencontainers.image.title="Trade IDE"
ENTRYPOINT ["trade-ide-entrypoint"]
