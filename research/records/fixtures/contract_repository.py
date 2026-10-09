"""Small synthetic Git repository for records contracts, never research evidence.

H/F labels describe the lineage shapes tested by the original boundary suite.
Every source, account metric, source observation and result below is invented;
the fixture neither copies historical run data nor executes a native replay.
"""

from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch


SOURCE_CASES = "research/r1_native/SOURCE_CASES.md"
EXPERIMENTS = "research/r1_native/RD_EXPERIMENTS.md"
OLD_CASES = b"# Cases\n\n## C02 - original\nUnverified source interpretation.\n"
CURRENT_CASES = b"# Cases\n\n## C02 - corrected\nThe observation does not prove an order.\n"
OBSERVATIONS = (
    b"# Observations\n\n## S01 - first media read\nA source observation.\n\n"
    b"## S15 - repeated media read\nThe same media was processed again.\n\n"
    b"## S46 - source recheck\nC02 needs Agent interpretation, not an inferred correction.\n"
)


class ContractRepository:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="records-contract-")
        self.root = Path(self.temp.name).resolve()
        self.records = self.root / "research/records"
        self.git("init", "-q")
        self.git("config", "user.name", "Synthetic record fixture")
        self.git("config", "user.email", "records-fixture@example.invalid")
        self.git("config", "core.hooksPath", str(self.root / "no-hooks"))
        self.write("README.md", "# Synthetic records contract fixture\n")
        self.write(SOURCE_CASES, OLD_CASES)
        self.write("strategies/r1/strategy.py", "# Synthetic source: no native replay.\nVALUE = 1\n")
        self.write("strategies/r1/tiered_retracement_strategy.py", "# Synthetic source closure.\nVALUE = 2\n")
        self.historical_commit = self.commit("Original synthetic source")
        self.write(SOURCE_CASES, CURRENT_CASES)
        self.write(EXPERIMENTS, OBSERVATIONS)
        self.current_source_commit = self.commit("Synthetic source revision")
        self._records()
        self.head = self.commit("Synthetic record and result contracts")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root).decode().strip()

    def write(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value if isinstance(value, bytes) else value.encode())

    def json(self, path, value):
        self.write(path, json.dumps(value, sort_keys=True, ensure_ascii=False) + "\n")
        return {"path": path, "sha256": hashlib.sha256((self.root / path).read_bytes()).hexdigest()}

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)
        return self.git("rev-parse", "HEAD")

    def close(self):
        self.temp.cleanup()

    def patches(self):
        """Redirect Git/evidence readers, while retaining the real schema files."""
        stack = ExitStack()
        for module in ("common", "cli", "store", "artifacts"):
            stack.enter_context(patch(f"research.records.{module}.ROOT", self.root))
        stack.enter_context(patch("research.records.store.RECORDS", self.records))
        return stack

    def historical_refs(self):
        return [{"commit": self.historical_commit, "paths": [SOURCE_CASES]}]

    def _records(self):
        def parent(identity, relationship="hypothesis_extension"):
            return {"attempt_id": identity, "relationship": relationship,
                    "difference": "Synthetic bounded mechanism change."}

        attempts = {}
        for identity in ("H08", "H13", "H13b", "H13c", "H15a", "H18a", "H19a", "F01", "H27a"):
            attempts[identity] = {
                "schema_version": 1, "attempt_id": identity, "goal_id": "SYNTHETIC-CONTRACT",
                "kind": "strategy", "question": "Synthetic records API boundary?",
                "mechanism": "Synthetic mechanism", "hypothesis": "A bounded contract can be tested.",
                "parents": [], "code_parent": self.current_source_commit,
                "registration": {"status": "retrospective", "reference": EXPERIMENTS},
                "decision": {"layer": "source", "outcome": "failed", "scope": "Synthetic fixture only.",
                             "next_action": "No research decision or trading claim."},
                "evidence_refs": [],
            }
        attempts["H13b"]["parents"] = [parent("H13")]
        attempts["H13c"]["parents"] = [parent("H13b")]
        attempts["H18a"].update(parents=[parent("H15a")], composition_mode="dependent", mechanism_refs=[{
            "attempt_id": "H08", "relationship": "component_reuse", "component": "FixtureSignal",
            "boundary": "Reuse source component, not its rejected hypothesis.",
        }])
        attempts["F01"].update(parents=[parent("H19a", "composition"), parent("H18a", "composition")],
                               composition_mode="factorial")
        attempts["F01"]["registration"].update(status="preregistered",
                                               original_registration_commit=self.current_source_commit)
        attempts["F01"]["decision"].update(layer="economics", outcome="failed")

        audit_ref = self.json("evidence/audit.json", {"passed": True, "findings": [], "nature": "synthetic"})
        analysis_ref = self.json("evidence/comparison.json", {"nature": "synthetic four-cell comparison"})
        source_files = {"strategy_source_sha256": "strategies/r1/strategy.py",
                        "tiered_strategy_source_sha256": "strategies/r1/tiered_retracement_strategy.py"}
        source_hashes = {field: hashlib.sha256((self.root / path).read_bytes()).hexdigest()
                         for field, path in source_files.items()}
        window = {"input_start_utc": "2024-01-01T00:00:00Z", "trade_start_utc": "2024-01-02T00:00:00Z",
                  "end_utc": "2024-01-03T00:00:00Z", "bar_minutes": 5}
        account = {"model": "Synthetic native report contract", "starting_balance_usdt": "100000",
                   "sizing": {"risk_budget_bps": 25.0, "coin_notional_cap_pct": 5.0}}
        specs = (
            ("H15a-paired-2026-10-08", "H15a", "control", None, "100000"),
            ("H18a-2026-10-08", "H18a", "candidate", "H15a-paired-2026-10-08", "100010.25"),
            ("H18a-paired-2026-10-08", "H18a", "control", None, "100010.25"),
            ("H19a-2026-10-08", "H19a", "candidate", "H18a-paired-2026-10-08", "100020"),
            ("F01-00-20261008", "H15a", "control", None, "100000"),
            ("F01-10-20261008", "H19a", "control", None, "100020"),
            ("F01-01-20261008", "H18a", "control", None, "100010.25"),
            ("F01-11-20261008", "F01", "candidate", "F01-10-20261008", "100014.50"),
        )
        for identity, attempt_id, role, control, equity in specs:
            summary = {
                "input_start_utc": window["input_start_utc"], "period_start_utc": window["trade_start_utc"],
                "period_end_utc": window["end_utc"], "data_interval_minutes": 5,
                "account_model": account["model"], "starting_balance_usdt": account["starting_balance_usdt"],
                "sizing": account["sizing"], "integrity_passed": True, **source_hashes,
                "final_equity_usdt": equity, "annualized_return_pct": 1,
                "closed_trade_win_rate": 0.5, "native_sharpe_365": 0.5,
                "native_max_drawdown_daily_close": -0.01,
                "per_coin": [{"instrument": "BTCUSDT.BINANCE"}], "nature": "synthetic, not a replay",
            }
            summary_ref = self.json(f"evidence/{identity}.json", summary)
            self.json(f"research/records/runs/{identity}/run.json", {
                "schema_version": 1, "run_id": identity, "attempt_id": attempt_id, "role": role,
                "nautilus_version": "2.0.0rc3", "input_identity_sha256": "a" * 64,
                "source_files_sha256": source_hashes,
                "source_revision": {"commit": self.current_source_commit, "files": source_files},
                "window": window, "account": account, "cost_model": "Synthetic frozen cost contract",
                "summary_ref": summary_ref, "audit_ref": audit_ref, "integrity": "passed",
                "evidence_grade": "development_exposed", "raw_reports": "temporary", "control_run_id": control,
            })
        attempts["F01"]["comparison_family"] = {
            "family_id": "F01", "origin_attempt_id": "H15a", "factor_a_attempt_id": "H19a",
            "factor_b_attempt_id": "H18a", "cells": {cell: f"F01-{cell}-20261008" for cell in ("00", "10", "01", "11")},
            "primary_response": "final_equity_usdt", "analysis_ref": analysis_ref,
        }
        attempts["F01"]["evidence_refs"] = [{"kind": "comparison", **analysis_ref}]
        for identity, body in attempts.items():
            self.json(f"research/records/attempts/{identity}/attempt.json", body)
        self.json("research/r1_native/results/media.json", {
            "media_sha256": "b" * 64, "independent_source_case": False,
            "s01_media_stage_id": "fixture-first", "s15_media_stage_id": "fixture-repeat",
        })
        self.json("research/r1_native/results/recheck.json", {
            "case": "S46", "source_reads": {"C02": "A source interpretation needs review."},
            "prior_experiments": ["H27a"], "status": "source recheck, not an automatic correction",
        })
