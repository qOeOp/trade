"""Throwaway Dolt services for the ledger package's integration tests; never the active ledger.

Tests find Dolt 2.4.2 through `RESEARCH_DOLT_BINARY` (or `dolt` on PATH) and skip without it.
A `Service` lives under /tmp with its own profile directory (`TRADE_LEDGER_HOME`), holds one
isolated database per `ledger()` call, and `close()` stops it and deletes everything.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from unittest.mock import patch

import pymysql

from ledger import db


def _binary() -> str | None:
    candidate = os.environ.get("RESEARCH_DOLT_BINARY") or shutil.which("dolt")
    if not candidate:
        return None
    checked = subprocess.run([candidate, "version"], capture_output=True, text=True, check=False)
    return candidate if checked.stdout.startswith(f"dolt version {db.DOLT_VERSION}") else None


BINARY = _binary()
SKIP = f"needs Dolt {db.DOLT_VERSION} (RESEARCH_DOLT_BINARY or dolt on PATH)"

SOURCE = b"from nautilus_trader.trading import Strategy\n\n\nclass Fixture(Strategy):\n    pass\n"
IMAGE_DIGEST = "sha256:" + "b" * 64
IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@" + IMAGE_DIGEST, "image_digest": IMAGE_DIGEST,
            "platform": "linux/arm64", "runtime_contract": "r1-native-v6"}
RUNTIME = {**IDENTITY, "inspection": {"runtime_contract": "r1-native-v6", "engine_version": "fixture"}}
MARKET_COMMIT = "m" * 32
DAY = 86_400 * 10**9
JAN = 1_767_225_600 * 10**9  # 2026-01-01T00:00:00Z in nanoseconds


def source(tag: str) -> bytes:
    return SOURCE + f"# {tag}\n".encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inputs(market_commit: str = MARKET_COMMIT) -> dict:
    return {"identity": {"market_database": "market", "market_commit": market_commit, "universe_rule": "pool-v1",
                         "symbols": ["AAAUSDT-PERP.BINANCE", "BBBUSDT-PERP.BINANCE"],
                         "export_content_sha256": "e" * 64},
            "input_coverage": b'{"format":"execution-input-coverage-v1"}'}


def window(start_day: int = 0, days: int = 31) -> dict:
    return {"start": JAN + start_day * DAY, "trade_start": JAN + (start_day + 1) * DAY,
            "end": JAN + (start_day + days) * DAY}


def context(data: bytes, workdir: str = "/tmp/replay-1") -> dict:
    return {"argv": ["python", "-m", "engine.run"], "mounts": [{"source": workdir, "target": "/work"}],
            "workdir": workdir, "source_bytes": data}


class Service:
    """One throwaway Dolt service; each `ledger()` adds an isolated research database to it."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="lg-", dir="/tmp"))
        self.home = self.root / "home"
        self.service_root = self.root / "s"
        self._environment = patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(self.home)})
        self._environment.start()
        self.count = 0

    def ledger(self, name: str | None = None) -> db.LedgerProfile:
        self.count += 1
        name = name or f"t{self.count}"
        return db.init(name, f"test_{name.replace('-', '_')}", self.service_root, "isolated",
                       dolt_binary=BINARY)["profile"]

    def admin(self, profile: db.LedgerProfile, branch: str | None = None):
        config = db._service(profile.service_root)
        return pymysql.connect(unix_socket=config["socket"], user="root", password=config["root_password"],
                               database=f"{profile.database}/{branch or profile.research_branch}", autocommit=True)

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


def market(commit: str = MARKET_COMMIT, latest_complete_day=None, universe_rule: str | None = "pool-v1"):
    """A stand-in for market.resolve_commit and market.freshness (a later phase)."""
    from datetime import date

    def facts(market_database: str, market_at: str) -> dict:
        return {"commit": commit, "universe_rule": universe_rule,
                "latest_complete_day": latest_complete_day or date(2026, 3, 31)}
    return facts


def attempt_binder(registration_bundle: str, source_sha256: str):
    """A stand-in for registration.bind (phase 2): consume one grid point for the trial."""
    def bind(conn, trial_id: int) -> None:
        conn.rows("INSERT INTO registration_attempt (registration_bundle, source_sha256, trial_id) VALUES (%s, %s, %s)",
                  (registration_bundle, source_sha256, trial_id))
    return bind


def product_bundle(conn, bundle: str, files: dict[str, bytes]) -> dict:
    """Write a product-namespace bundle the way product code does (registration is phase 2)."""
    from ledger import evidence
    return db.write(conn, "product_bundle", {"bundle": bundle, "files": evidence.digests(files)}, "evidence_bundle",
                    lambda c, op: evidence.write_files(c, bundle, files, op))
