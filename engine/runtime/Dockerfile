FROM ghcr.io/astral-sh/uv:0.12.1@sha256:cf4eedcaa81655197f625739489effcbe71b61ceb1506f332c3facae5deceded AS uv
FROM redis:8.2.1-alpine@sha256:987c376c727652f99625c7d205a1cba3cb2c53b92b0b62aade2bd48ee1593232 AS paper-cache
FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2

COPY --from=uv /uv /usr/local/bin/uv
# Isolated native caches for execution runners. The musl loader keeps these libraries separate from Python's.
COPY --from=paper-cache /usr/local/bin/redis-server /opt/trade/redis/redis-server
COPY --from=paper-cache /lib/ld-musl-*.so.1 /opt/trade/redis/
COPY --from=paper-cache /lib/ /opt/trade/redis/lib/
COPY --from=paper-cache /usr/lib/ /opt/trade/redis/lib/
RUN /opt/trade/redis/ld-musl-*.so.1 --library-path /opt/trade/redis/lib /opt/trade/redis/redis-server --version
WORKDIR /opt/trade
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache --no-install-project
COPY engine/*.py ./engine/
COPY engine/live_runtime/*.py ./engine/live_runtime/
# The image carries only the runtime package; this path entry makes it importable from any
# directory or script, as the host's editable project install does.
RUN echo /opt/trade > "$(/opt/trade/.venv/bin/python -c 'import sysconfig; print(sysconfig.get_path("purelib"))')/trade-runtime.pth"
ENV PATH="/opt/trade/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
LABEL org.opencontainers.image.title="Trade native research runtime" trade.runtime.contract="replay-contract@v7"
CMD ["python", "-m", "engine.run", "--help"]
