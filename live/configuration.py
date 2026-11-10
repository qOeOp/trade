"""Deployment-owned Live inputs. Browser requests can choose IDs, never host paths."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import hashlib
from pathlib import Path
import re

from live import state


SOURCE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
RUNTIME = re.compile(r"ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}\Z")
CONFIG_KEYS = frozenset({"budget_usdt", "max_loss_usdt", "duration_seconds", "leverage"})
LEVERAGE = re.compile(r"[1-9][0-9]{0,2}\Z")  # Binance: 1 to 125


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


def run_config(value) -> dict:
    value = fields(value, CONFIG_KEYS)
    result: dict = {}
    for name in CONFIG_KEYS - {"duration_seconds", "leverage"}:
        item = value[name]
        try:
            if not isinstance(item, str) or len(item) > 64:
                raise ValueError
            number = Decimal(item)
            if not number.is_finite() or number <= 0:
                raise ValueError
        except (InvalidOperation, ValueError):
            raise fail() from None
        result[name] = str(number)
    duration = value["duration_seconds"]
    if type(duration) is not int or duration < 1:
        raise fail()
    result["duration_seconds"] = duration
    # The account's Binance leverage: the venue's symbol leverage must equal it (engine.live_venue).
    if not isinstance(value["leverage"], str) or not LEVERAGE.fullmatch(value["leverage"]) \
            or int(value["leverage"]) > 125:
        raise fail()
    result["leverage"] = value["leverage"]
    return result


@dataclass(frozen=True)
class Source:
    source_id: str
    candidate: str
    strategy_file: Path
    source_sha256: str
    entry_class: str
    purpose: str
    single_order_source_reviewed: bool

    def available(self) -> bool:
        try:
            from engine.load import read_regular_file
            return hashlib.sha256(read_regular_file(self.strategy_file)).hexdigest() == self.source_sha256
        except (OSError, ValueError):
            return False

    def view(self) -> dict:
        available = self.available()
        return {"source_id": self.source_id, "origin_candidate": self.candidate,
                "source_sha256": self.source_sha256, "entry_class": self.entry_class,
                "purpose": self.purpose, "available": available,
                "code": None if available else "LIVE_SOURCE_MISSING"}


@dataclass(frozen=True)
class Configuration:
    root: Path
    socket: Path
    research_ledger: Path
    research_at: str
    runtime: str
    universe_file: Path
    symbols: list[str]
    sources: dict[str, Source]
    defaults: dict
    memory: str
    market_root: Path  # the market directory, mounted read-only: the contract terms Live compares (TERMS_CHANGED)


def load(path: Path) -> Configuration:
    value = fields(state.read(path), {"format", "root", "socket", "research_ledger", "research_at", "runtime",
                                     "universe_file", "symbols", "sources", "defaults", "memory", "market_root"})
    if value["format"] != "live-control-v1":
        raise fail()
    symbols = value["symbols"]
    if not isinstance(symbols, list) or len(symbols) != 1:
        raise fail()
    text(symbols[0], re.compile(r"[A-Z0-9]+USDT\Z"))
    rows = value["sources"]
    if not isinstance(rows, list) or not rows:
        raise fail()
    sources = {}
    for row in rows:
        row = fields(row, {"source_id", "candidate", "strategy_file", "source_sha256", "entry_class", "purpose",
                           "single_order_source_reviewed"})
        source_id = text(row["source_id"], SOURCE_ID)
        if (source_id in sources or row["purpose"] not in ("natural", "controlled")
                or type(row["single_order_source_reviewed"]) is not bool):
            raise fail()
        sources[source_id] = Source(source_id, text(row["candidate"], re.compile(r"[a-zA-Z0-9_.-]+@[1-9][0-9]*\Z")),
                                    absolute(row["strategy_file"]), text(row["source_sha256"], DIGEST),
                                    text(row["entry_class"], re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")), row["purpose"],
                                    row["single_order_source_reviewed"])
    return Configuration(root=absolute(value["root"]), socket=absolute(value["socket"]),
                         research_ledger=absolute(value["research_ledger"]),
                         research_at=text(value["research_at"], re.compile(r"[0-9a-v]{32}\Z")),
                         runtime=text(value["runtime"], RUNTIME), universe_file=absolute(value["universe_file"]),
                         symbols=symbols, sources=sources, defaults=run_config(value["defaults"]),
                         memory=text(value["memory"], re.compile(r"[1-9][0-9]*[mg]\Z")),
                         market_root=absolute(value["market_root"]))
