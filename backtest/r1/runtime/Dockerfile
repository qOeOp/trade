FROM ghcr.io/astral-sh/uv:0.12.1@sha256:cf4eedcaa81655197f625739489effcbe71b61ceb1506f332c3facae5deceded AS uv
FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/trade
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache
COPY backtest/__init__.py ./backtest/__init__.py
COPY backtest/r1/*.py ./backtest/r1/
COPY backtest/r1/checks/__init__.py backtest/r1/checks/audit_tiered_native.py backtest/r1/checks/compare_node.py ./backtest/r1/checks/
ENV PATH="/opt/trade/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
LABEL org.opencontainers.image.title="Trade R1 native research runtime" trade.runtime.contract="r1-native-v1"
CMD ["python", "-m", "backtest.r1.runtime_identity"]
