"""Existing private record writes and frozen native strategy identity."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
from nautilus_trader.model import InstrumentId, StrategyId
from engine.config import instrument_id
from engine.load import strategy_id

def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name("." + path.name + ".partial")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, default=str)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def strategy_ids(manifest: dict) -> dict[str, StrategyId]:
    """Each contract's instance has its own native identity, LIVE-<run>-<coin> (the user, 2026-11-13); fresh
    construction and observation-only recovery share it."""
    run = hashlib.sha256(manifest["run_id"].encode()).hexdigest()[:12]
    return {symbol: StrategyId(f"LIVE-{run}-{strategy_id(symbol).split('-', 1)[1]}") for symbol in manifest["symbols"]}


def contract(symbol: str) -> InstrumentId:
    return InstrumentId.from_str(instrument_id(symbol))


def owned(query, manifest: dict, **filters) -> list:
    """`query` (a native cache method taking strategy_id) over every instance of the run."""
    return [item for strategy in strategy_ids(manifest).values() for item in query(strategy_id=strategy, **filters)]
