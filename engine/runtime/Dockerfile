FROM ghcr.io/astral-sh/uv:0.12.1@sha256:cf4eedcaa81655197f625739489effcbe71b61ceb1506f332c3facae5deceded AS uv
FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/trade
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache --no-install-project
COPY engine/__init__.py engine/config.py engine/load.py engine/run.py engine/report.py engine/audit.py \
     engine/compare.py engine/compare_reports.py ./engine/
# The image carries only the runtime package; this path entry makes it importable from any
# directory or script, as the host's editable project install does.
RUN echo /opt/trade > "$(/opt/trade/.venv/bin/python -c 'import sysconfig; print(sysconfig.get_path("purelib"))')/trade-runtime.pth"
ENV PATH="/opt/trade/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
LABEL org.opencontainers.image.title="Trade native research runtime" trade.runtime.contract="replay-contract@v6"
CMD ["python", "-m", "engine.run", "--help"]
