# The execution image for Paper and Live: the replay image's steps unchanged (replay.Dockerfile; a test keeps them
# equal), then Redis and the rest of engine/.
FROM ghcr.io/astral-sh/uv:0.12.1@sha256:cf4eedcaa81655197f625739489effcbe71b61ceb1506f332c3facae5deceded AS uv
FROM redis:8.2.1-alpine@sha256:987c376c727652f99625c7d205a1cba3cb2c53b92b0b62aade2bd48ee1593232 AS paper-cache
FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/trade
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache --no-install-project
# The replay closure: the import closure of engine.run, engine.audit and engine.compare (engine/config.py
# RUNTIME_SOURCE_PATHS and AUDIT_PATH; tests/runtime/test_replay_closure.py keeps the lists equal).
COPY engine/__init__.py engine/audit.py engine/compare.py engine/config.py engine/fill.py engine/history.py engine/klines.py engine/live_errors.py engine/load.py engine/native_csv.py engine/order_rules.py engine/protection.py engine/report.py engine/run.py engine/strategy.py engine/warmup.py ./engine/
# The image carries only the runtime package; this path entry makes it importable from any
# directory or script, as the host's editable project install does.
RUN echo /opt/trade > "$(/opt/trade/.venv/bin/python -c 'import sysconfig; print(sysconfig.get_path("purelib"))')/trade-runtime.pth"
ENV PATH="/opt/trade/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONHASHSEED=0
# Isolated native caches for execution runners. The musl loader keeps these libraries separate from Python's.
COPY --from=paper-cache /usr/local/bin/redis-server /opt/trade/redis/redis-server
COPY --from=paper-cache /lib/ld-musl-*.so.1 /opt/trade/redis/
COPY --from=paper-cache /lib/ /opt/trade/redis/lib/
COPY --from=paper-cache /usr/lib/ /opt/trade/redis/lib/
RUN /opt/trade/redis/ld-musl-*.so.1 --library-path /opt/trade/redis/lib /opt/trade/redis/redis-server --version
COPY engine/*.py ./engine/
LABEL org.opencontainers.image.title="Trade native execution runtime" trade.runtime.contract="replay-contract@v8"
CMD ["python", "-m", "engine.run", "--help"]
