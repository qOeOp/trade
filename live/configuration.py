"""Deployment-owned Live inputs. Browser requests can choose IDs, never host paths."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re

from engine.config import is_leverage
from engine.live_brake import BRAKE_MAX
from live import state


SOURCE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
SYMBOL = re.compile(r"[A-Z0-9]+USDT\Z")
DEFAULT_KEYS = frozenset({"duration_seconds", "leverage"})  # the operator's defaults
# A run's choices: also its drawdown brake, which defaults to the user's maximum-drawdown target and can only be
# tighter (engine.live_brake). Its cash floor is a share of the wallet at its first arming, not a choice.
CONFIG_KEYS = DEFAULT_KEYS | {"drawdown_brake"}
BRAKE_DEFAULT = str(BRAKE_MAX)


def fail():
    return state.fail("LIVE_CONFIG", "the Live control configuration or request fields are invalid")


def fields(value, names: set | frozenset) -> dict:
    if not isinstance(value, dict) or set(value) != names:
        raise fail()
    return value


def text(value, pattern: re.Pattern) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise fail()
    return value


def absolute(value) -> Path:
    if not isinstance(value, str) or not value or not Path(value).is_absolute():
        raise fail()
    return Path(value)


def run_config(value, keys: frozenset = CONFIG_KEYS) -> dict:
    value = fields(value, keys)
    result: dict = {}
    if "drawdown_brake" in keys:
        item = value["drawdown_brake"]
        try:
            if not isinstance(item, str) or len(item) > 64:
                raise ValueError
            number = Decimal(item)
            if not number.is_finite() or not 0 < number <= Decimal(BRAKE_DEFAULT):
                raise ValueError
        except (InvalidOperation, ValueError):
            raise fail() from None
        result["drawdown_brake"] = str(number)
    duration = value["duration_seconds"]  # None: the run goes on until it is stopped
    if duration is not None and (type(duration) is not int or duration < 1):
        raise fail()
    result["duration_seconds"] = duration
    # The account's Binance leverage: the venue's symbol leverage must equal it (engine.live_venue).
    if not is_leverage(value["leverage"]):
        raise fail()
    result["leverage"] = value["leverage"]
    return result


@dataclass(frozen=True)
class Source:
    """A candidate Live may run: preparation reads its bytes from the research ledger at research_at and refuses
    any other source hash or entry class (live.runs.prepare_locked). `symbols` are the contracts it trades, one
    instance each: those of its replay evidence (the user, 2026-11-13)."""
    source_id: str
    candidate: str
    source_sha256: str
    entry_class: str
    purpose: str
    symbols: tuple[str, ...]

    def view(self) -> dict:
        return {"source_id": self.source_id, "candidate": self.candidate, "source_sha256": self.source_sha256,
                "entry_class": self.entry_class, "purpose": self.purpose, "symbols": list(self.symbols)}


def source_of(sources: dict[str, Source], run_source: dict) -> Source | None:
    """The configured source a run was prepared from (its manifest's source_sha256 and entry_class), if any."""
    return next((source for source in sources.values() if source.source_sha256 == run_source.get("source_sha256")
                 and source.entry_class == run_source.get("entry_class")), None)


@dataclass(frozen=True)
class Configuration:
    root: Path
    socket: Path
    research_ledger: Path
    research_at: str
    runtime: str
    universe_file: Path
    sources: dict[str, Source]
    defaults: dict
    memory: str
    market_root: Path  # the market directory, mounted read-only: the contract terms Live compares (TERMS_CHANGED)


def parse(value: dict) -> Configuration:
    """The control's installed snapshot, whose fields, format and runtime digest deploy.live_configuration.snapshot
    already checked, as typed values."""
    rows = value["sources"]
    if not isinstance(rows, list) or not rows:
        raise fail()
    sources = {}
    for row in rows:
        row = fields(row, {"source_id", "candidate", "source_sha256", "entry_class", "purpose", "symbols"})
        source_id = text(row["source_id"], SOURCE_ID)
        symbols = row["symbols"]
        if source_id in sources or row["purpose"] not in ("natural", "controlled") or not isinstance(symbols, list) \
                or not symbols or len(set(symbols)) != len(symbols):
            raise fail()
        sources[source_id] = Source(source_id, text(row["candidate"], re.compile(r"[a-zA-Z0-9_.-]+@[1-9][0-9]*\Z")),
                                    text(row["source_sha256"], DIGEST),
                                    text(row["entry_class"], re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")), row["purpose"],
                                    tuple(text(symbol, SYMBOL) for symbol in symbols))
    return Configuration(root=absolute(value["root"]), socket=absolute(value["socket"]),
                         research_ledger=absolute(value["research_ledger"]),
                         research_at=text(value["research_at"], re.compile(r"[0-9a-v]{32}\Z")),
                         runtime=value["runtime"], universe_file=absolute(value["universe_file"]),
                         sources=sources, defaults=run_config(value["defaults"], DEFAULT_KEYS),
                         memory=text(value["memory"], re.compile(r"[1-9][0-9]*[mg]\Z")),
                         market_root=absolute(value["market_root"]))
