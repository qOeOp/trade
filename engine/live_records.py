"""Existing private record writes and frozen native strategy identity."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
from nautilus_trader.model import InstrumentId, StrategyId
from engine.config import instrument_id
from engine.load import read_regular_file, strategy_id

def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name("." + path.name + ".partial")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, default=str)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def keep(output: Path, prefix: str, snapshot: dict) -> str:
    """Keep an account read in the run's directory as <prefix>-<observed_ns>.json; returns that name."""
    name = f"{prefix}-{snapshot['observed_ns']}.json"
    write_json(output / name, snapshot)
    return name


def journal(output: Path) -> list[dict]:
    """The run's events.jsonl (engine.live_session.Session.event), row by row. An unreadable file, or a line that is
    not a JSON object, raises: each caller decides what a damaged journal means for it."""
    rows = [json.loads(line) for line in read_regular_file(output / "events.jsonl").decode().splitlines() if line]
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("a journal line is not a JSON object")
    return rows


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
