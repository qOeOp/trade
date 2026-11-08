"""Existing private record writes and frozen native strategy identity."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
from nautilus_trader.model import StrategyId

def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name("." + path.name + ".partial")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, default=str)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def source_strategy_id(manifest: dict) -> StrategyId:
    """Fresh construction and observation-only recovery share the immutable v1 identity."""
    return StrategyId("LIVE-" + hashlib.sha256(manifest["run_id"].encode()).hexdigest()[:12])
