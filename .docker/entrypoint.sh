#!/bin/bash
set -e

echo "=== Vibe Trader Development Environment ==="
echo "Rust version: $(rustc --version)"
echo "uv version: $(uv --version)"
echo "Working directory: $(pwd)"
echo

export PYO3_PYTHON=/workspace/.venv/bin/python3
echo "PYO3_PYTHON: $PYO3_PYTHON"
echo

echo "Available checks:"
echo "  make install-debug"
echo "  make cargo-test"
echo "  make pytest"
echo "  uv run --project python python -c \"from vibe_trader.core import UUID4; print(UUID4())\""
echo

if [ "$#" -eq 0 ]; then
  if [ -t 0 ]; then
    exec bash
  fi
  echo "No TTY detected; pass a command or use docker run -it."
else
  exec "$@"
fi
