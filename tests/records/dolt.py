"""A throwaway Dolt service and ledger for integration tests; never the active ledger.

The tests find Dolt 2.4.2 through `RESEARCH_DOLT_BINARY` (or `dolt` on PATH) and skip without it.
Each fixture starts its own service under /tmp with its own profile directory, and stops and
deletes both afterwards. It refuses to run when the profile directory in use holds an active
ledger, so a test can never write to it.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
from unittest.mock import patch

from research.records import ledger


def _binary() -> str | None:
    candidate = os.environ.get("RESEARCH_DOLT_BINARY") or shutil.which("dolt")
    if not candidate:
        return None
    checked = subprocess.run([candidate, "version"], capture_output=True, text=True, check=False)
    return candidate if checked.stdout.startswith("dolt version 2.4.2") else None


BINARY = _binary()
SKIP = "needs Dolt 2.4.2 (RESEARCH_DOLT_BINARY or dolt on PATH)"


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class TemporaryLedger:
    """Start a service with one ledger named `name`; `close()` stops and deletes everything."""

    def __init__(self, name: str = "test", *, role: str = "isolated"):
        existing = os.environ.get("TRADE_LEDGER_HOME")
        if any(value["role"] == "active" for value in ledger.profiles().values()) and existing:
            raise RuntimeError(f"TRADE_LEDGER_HOME={existing} holds an active ledger; refusing to run tests on it")
        self.root = Path(tempfile.mkdtemp(prefix="tl-", dir="/tmp"))
        self.home = self.root / "ledgers"
        self._environment = patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(self.home)})
        self._environment.start()
        try:
            # An active-role fixture lives under /tmp too; only its private profile directory makes it active.
            with patch("research.records.ledger._is_temporary_path", return_value=False):
                ledger.init(name=name, database=f"test_{name.replace('-', '_')}", service_root=self.root / "s",
                            binary=BINARY, port=_free_port(), role=role, backup_root=self.root / "backup")
        except BaseException:
            self.close()
            raise
        self.profile = ledger.profile(name)

    def admin(self):
        from research.records import db
        return db.connect(self.profile, "admin")

    def close(self) -> None:
        try:
            if (self.root / "s" / "service.json").exists():
                ledger.stop_service(self.root / "s")
        finally:
            self._environment.stop()
            shutil.rmtree(self.root, ignore_errors=True)
