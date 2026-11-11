"""Throwaway Dolt services for the ledger package's integration tests; never the active ledger.

Tests find Dolt 2.7.2 through `RESEARCH_DOLT_BINARY` (or `dolt` on PATH) and skip without it.
A `Service` lives under /tmp with its own profile directory (`TRADE_LEDGER_HOME`), holds one
isolated database per `ledger()` call, and `close()` stops it and deletes everything.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
from datetime import date
import tempfile
from unittest.mock import patch

import pymysql

from ledger import db
from shared.errors import Refusal


def _binary() -> str | None:
    """The named Dolt (refused loudly when it is not one), else a matching one on PATH, else none."""
    if os.environ.get("RESEARCH_DOLT_BINARY"):
        return db._binary(None)
    try:
        return db._binary(None) if shutil.which("dolt") else None
    except Refusal:
        return None


BINARY = _binary()
SKIP = f"needs Dolt {db.DOLT_VERSION} (RESEARCH_DOLT_BINARY or dolt on PATH)"

SOURCE = b"from nautilus_trader.trading import Strategy\n\n\nclass Fixture(Strategy):\n    pass\n"
IMAGE_DIGEST = "sha256:" + "b" * 64
IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@" + IMAGE_DIGEST, "image_digest": IMAGE_DIGEST,
            "platform": "linux/arm64", "runtime_contract": "replay-contract@v7"}
RUNTIME = {**IDENTITY, "inspection": {"runtime_contract": "replay-contract@v7", "engine_version": "fixture"}}
MARKET_COMMIT = "m" * 32
DAY = 86_400 * 10**9
JAN = 1_767_225_600 * 10**9  # 2026-01-01T00:00:00Z in nanoseconds


def source(tag: str) -> bytes:
    return SOURCE + f"# {tag}\n".encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


SYMBOLS = ["AAAUSDT-PERP.BINANCE", "BBBUSDT-PERP.BINANCE"]
ACCOUNT = {"starting_balance_usdt": "100000", "execution": "bars", "oms_type": "NETTING", "fees": "assumed-v1"}


def coverage(market_day: str = MARKET_COMMIT, *, effective_config: dict | None = None, receipts: dict | None = None,
             membership: dict | None = None, **identity) -> bytes:
    """input-coverage.json as replay.input_coverage writes it: the effective configuration, the export receipts by
    symbol, the input identity (`identity` overrides its keys: symbols, universe_rule, export_content_sha256,
    lifecycle_bundle) and, when given, the membership file's content."""
    input_identity = {"market_database": "market", "market_day": market_day, "universe_rule": "pool-v1",
                      "symbols": list(SYMBOLS), "export_content_sha256": "e" * 64, **identity}
    effective = effective_config or {"runtime_contract": IDENTITY["runtime_contract"], **window(),
                                     "execution_bar_minutes": 1440, "symbols": list(input_identity["symbols"]),
                                     "account": dict(ACCOUNT)}
    return json.dumps({"format": "execution-input-coverage-v1", "effective_config": effective,
                       "export_receipts": receipts or {}, "input_identity": input_identity,
                       **({"membership": membership} if membership is not None else {})}).encode()


def window(start_day: int = 0, days: int = 31) -> dict:
    return {"start": JAN + start_day * DAY, "trade_start": JAN + (start_day + 1) * DAY,
            "end": JAN + (start_day + days) * DAY}


def context(data: bytes, workdir: str | None = None) -> dict:
    """A trial's start context; with `workdir` (an existing directory) open_trial marks it as the trial's."""
    return {"argv": ["python", "-m", "engine.run"], "workdir": workdir, "source_bytes": data}


class Service:
    """One throwaway Dolt service; each `ledger()` adds an isolated research (or, with `holds`, Paper) database."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="lg-", dir="/tmp"))
        self.home = self.root / "home"
        self.service_root = self.root / "s"
        self._environment = patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(self.home)})
        self._environment.start()
        self.count = 0

    def ledger(self, name: str | None = None, holds: str = "research") -> db.LedgerProfile:
        self.count += 1
        name = name or f"t{self.count}"
        return db.init(name, f"test_{name.replace('-', '_')}", self.service_root, "isolated",
                       dolt_binary=BINARY, holds=holds)["profile"]

    def admin(self, profile: db.LedgerProfile, branch: str | None = None):
        config = db._service(profile.service_root)
        return pymysql.connect(unix_socket=config["socket"], user="root", password=config["root_password"],
                               database=f"{profile.database}/{branch or db.BRANCH}", autocommit=True)

    def sql(self, profile: db.LedgerProfile, statement: str, params=None) -> list[tuple]:
        conn = self.admin(profile)
        try:
            with conn.cursor() as cursor:
                cursor.execute(statement, params)
                return list(cursor.fetchall())
        finally:
            conn.close()

    def close(self) -> None:
        try:
            if (self.service_root / "service.json").exists():
                db.stop_service(self.service_root)
        finally:
            self._environment.stop()
            shutil.rmtree(self.root, ignore_errors=True)


def market(commit: str = MARKET_COMMIT, latest_complete_day=None, universe_rule: str | None = "pool-v1",
           first_day=date(2019, 9, 1)):
    """A stand-in for the market's resolve_commit and freshness, covered from `first_day`."""

    def facts(market_at: str) -> dict:
        return {"commit": commit, "universe_rule": universe_rule,
                "latest_complete_day": latest_complete_day or date(2026, 3, 31),
                "first_day": first_day, "first_months": {"BTCUSDT": first_day}}
    return facts


def reviewed(*sources: bytes):
    """A stand-in for registration.precheck.review_records: one passed product review of each source."""
    def records(conn, source_sha256: str | None = None) -> list[dict]:
        item = {"status": "passed", "note": "fixture"}
        return [{"review_id": 0, "trial_id": 0, "source_sha256": sha(data), "verdict": "passed", "reviewer": "fixture",
                 "created_at": None, "image_digest": IMAGE_DIGEST, "api": item, "causal": item, "activity": item,
                 "readiness": item} for data in sources if source_sha256 in (None, sha(data))]
    return records


def pinned(start=None, end=None):
    """Pin the development period (ledger.lines.development_period, whose rule test_lines tests) to [start, end),
    default January 2026: the fixtures' market and windows are a month or two, the rule's period three years
    before a two-year holdout."""
    from datetime import date
    from ledger import lines
    period = (start or date(2026, 1, 1), end or date(2026, 2, 1))
    return patch.object(lines, "development_period", lambda today, latest, covered: period)


# The market days line close reads (first day, day after the latest complete day): January 2026, the pinned period.
MARKET_DAYS = (date(2026, 1, 1), date(2026, 2, 1))


def january():
    return pinned()


def select_line(conn, start: str = "rsi@1", slug: str = "rsi-root", start_source: bytes | None = None) -> dict:
    """A research line from `start` over January 2026 on MARKET_COMMIT (ledger.lines.select_line)."""
    from ledger import lines
    with january():
        return lines.select_line(conn, MARKET_COMMIT, start, slug=slug, market=market(),
                                 reviews=reviewed(start_source or source("root")))


def grid_point(conn, line_id: int, data: bytes, receipt: bytes | None = None, runtime: dict | None = None) -> int:
    """A research registration on `line_id` whose one grid point is the published source `data`, with its passed
    precheck and source review, execution identity that of `receipt` (default coverage()); written directly,
    as tests of the ledger alone need no registration rules (registration.register has those). Returns its ID."""
    from ledger import trials
    receipt = receipt or coverage()
    runtime = runtime or RUNTIME
    precheck = trials.open_trial(conn, "precheck", sha(data), runtime, receipt, window(), context(data))["trial_id"]
    columns = trials.execution_identity(receipt)

    def insert(c, op):
        c.rows("INSERT INTO source_review (trial_id, source_sha256, verdict, api_status, api_note, causal_status, "
               "causal_note, activity_status, activity_note, readiness_status, readiness_note, reviewer, op_id) VALUES "
               "(%s, %s, 'passed', 'passed', 'fixture', 'passed', 'fixture', 'passed', 'fixture', 'passed', 'fixture', "
               "'fixture', %s)", (precheck, sha(data), op + ":review"))
        (review_id,), = c.rows("SELECT LAST_INSERT_ID()")
        c.rows("INSERT INTO research_registration (line_id, image_ref, market_day, universe_rule, lifecycle_bundle, "
               "export_sha256, comparable_config_sha256, body, op_id) VALUES (%s, %s, %s, %s, %s, %s, %s, '{}', %s)",
               (line_id, runtime["image_ref"], columns["market_day"], columns["universe_rule"],
                columns["lifecycle_bundle"], columns["export_sha256"], columns["comparable_config_sha256"], op))
        (registration_id,), = c.rows("SELECT LAST_INSERT_ID()")
        c.rows("INSERT INTO registration_grid_point (registration_id, source_sha256, source_review_id) "
               "VALUES (%s, %s, %s)", (registration_id, sha(data), review_id))
        return {"registration_id": registration_id}

    return db.write(conn, "grid_point_fixture", {"line_id": line_id, "source": sha(data), "precheck": precheck},
                    "research_registration", insert)["record"]["registration_id"]


def binder(line_id: int, registration_id: int):
    """A stand-in for registration.register.binder: the trial's line and research registration, unchecked."""
    def bind(conn, row) -> dict:
        return {"line_id": line_id, "research_registration_id": registration_id}
    bind.registration = registration_id  # type: ignore[attr-defined]
    return bind


def product_bundle(conn, bundle: str, files: dict[str, bytes], kind: str = "agent", trial_id: int | None = None) -> dict:
    """Write a bundle the way product code does (ledger.evidence.write_files)."""
    from ledger import evidence
    return db.write(conn, "product_bundle", {"bundle": bundle, "files": evidence.digests(files)}, "evidence_bundle",
                    lambda c, op: evidence.write_files(c, bundle, files, kind=kind, trial_id=trial_id, op_id=op))
