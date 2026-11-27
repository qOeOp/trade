"""Unit and integration tests for product-doctor v3.2 L4 ops invariants (Dimensions 1, 4 & 8):
- market_archive_integrity (pure-stdlib Parquet PAR1+Thrift footer, month partitions, symbol drop, delisted/schema drift)
- ledger_public_hygiene (public export private table/marker/secret leaks, restore drill staleness/failure, backup divergence)
- ops_disk_and_deploy_health (disk/free GiB, retained images/GHCR drift, restart loops, AST deploy/ stdlib purity)
- End-to-end `prod-snapshot` -> `friction` -> `advise --auto` un-coolable preemption to `market`, `ledger`, `deploy`.
"""

import ast
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / ".agents/skills/product-doctor/assets"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ASSETS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


doctor = _load("doctor")
ops_invariants = _load("ops_invariants")
prod_invariants = _load("prod_invariants")
telemetry = _load("telemetry")


def _write_parquet(path: Path, n_rows: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tbl = pa.table({"ts": pa.array(list(range(n_rows)), type=pa.int64())})
    pq.write_table(tbl, path)
    return path


class OpsInvariantsUnitTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()

    def _write_state(self, name: str, payload) -> Path:
        path = self.home / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")
        return path

    def test_ops_invariants_module_is_pure_stdlib_and_under_cognitive_budget(self):
        src = (ASSETS / "ops_invariants.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        stdlib = set(sys.stdlib_module_names) | set(sys.builtin_module_names) | {"__future__"}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertIn(alias.name.split(".")[0], stdlib)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                self.assertIn(node.module.split(".")[0], stdlib)
        metrics = telemetry.analyze_python_source(src)
        self.assertLessEqual(metrics["max_cognitive"], 47)

    def test_pure_stdlib_parquet_inspector_valid_zero_row_zero_byte_and_corrupt(self):
        valid_pq = _write_parquet(self.home / "valid.parquet", 25)
        zero_row_pq = _write_parquet(self.home / "zero_row.parquet", 0)
        zero_byte_pq = self.home / "zero_byte.parquet"
        zero_byte_pq.write_bytes(b"")
        tiny_pq = self.home / "tiny.parquet"
        tiny_pq.write_bytes(b"PAR1")
        bad_magic_pq = self.home / "bad_magic.parquet"
        bad_magic_pq.write_bytes(b"NOPE" + b"\x00" * 16 + b"PAR1")
        bad_flen_pq = self.home / "bad_flen.parquet"
        bad_flen_pq.write_bytes(b"PAR1" + b"\x00\x00\x00\x00" + struct.pack("<I", 9999) + b"PAR1")
        garbage_footer_pq = self.home / "garbage_footer.parquet"
        garbage_footer_pq.write_bytes(b"PAR1" + b"\xff\xfe\xfd\xfc" + struct.pack("<I", 4) + b"PAR1")

        self.assertEqual(ops_invariants.inspect_parquet_file(valid_pq), {"status": "ok", "reason": None, "num_rows": 25})
        self.assertEqual(ops_invariants.inspect_parquet_file(zero_row_pq)["status"], "zero_row")
        self.assertEqual(ops_invariants.inspect_parquet_file(zero_row_pq)["num_rows"], 0)
        self.assertEqual(ops_invariants.inspect_parquet_file(zero_byte_pq)["status"], "zero_byte")
        for corrupt in (tiny_pq, bad_magic_pq, bad_flen_pq, garbage_footer_pq):
            self.assertEqual(ops_invariants.inspect_parquet_file(corrupt)["status"], "corrupt", corrupt.name)

    def test_dim1_market_archive_integrity_clean_boundaries_and_violations(self):
        clean = self._write_state("m_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "market": {
                "latest_day": "2026-11-26",
                "corrupt_files": 0,
                "zero_byte_files": 0,
                "zero_row_files": 0,
                "non_monotonic_months": 0,
                "duplicate_months": 0,
                "month_partitions": ["2026-08", "2026-09", "2026-10"],
                "active_symbols_drop_pct": 20.0,
                "delisted_blocking_head": 0,
                "schema_drift_count": 0,
            },
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean])["triggers"], [])

        cases = [
            ("corrupt", {"corrupt_files": 1}),
            ("zero_byte", {"zero_byte_files": 2}),
            ("zero_row", {"zero_row_files": 1}),
            ("non_mono_list", {"month_partitions": ["2026-08", "2026-10", "2026-09"]}),
            ("dup_list", {"month_partitions": ["2026-08", "2026-08", "2026-09"]}),
            ("drop_pct", {"active_symbols_drop_pct": 20.1}),
            ("drop_derived", {"prev_active_symbols": 100, "active_symbols": 79}),
            ("delisted", {"delisted_blocking_head": 1}),
            ("schema_drift", {"schema_drift_count": 2}),
        ]
        for label, market_body in cases:
            with self.subTest(case=label):
                st = self._write_state(f"m_{label}.json", {"as_of": "2026-11-27T12:00:00Z", "market": market_body})
                res = prod_invariants.analyze_prod_states([st])
                self.assertEqual(res["affected_objects"], ["market"])
                self.assertEqual(len(res["violations"]), 1)
                self.assertEqual(res["violations"][0]["invariant"], "market_archive_integrity")
                self.assertTrue(res["triggers"][0].startswith("prod_invariant:market_archive_integrity"))

    def test_dim4_ledger_public_hygiene_clean_boundaries_and_violations(self):
        clean = self._write_state("l_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "ledger": {
                "exported_tables": ["line", "candidate", "trial", "judgment"],
                "public_export_private_tables": [],
                "public_export_private_markers": [],
                "credential_leaks": 0,
                "last_restore_ok": True,
                "last_restore_drill_age_days": 30.0,
                "backup_diverged": False,
                "backup_checksum_mismatch": False,
                "mirror_checksum_mismatch": False,
                "backup_missing": False,
            },
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean])["triggers"], [])

        cases = [
            ("private_table", {"exported_tables": ["trial", "paper_runs"]}),
            ("live_table", {"public_export_private_tables": ["live_runs"]}),
            ("private_marker", {"public_export_private_markers": ["private_root"]}),
            ("cred_leak", {"credential_leaks": 1}),
            ("restore_failed", {"last_restore_ok": False}),
            ("restore_stale_days", {"last_restore_drill_age_days": 30.1}),
            ("restore_stale_ts", {"last_restore_drill_at": "2026-10-20T00:00:00Z"}),
            ("backup_diverged", {"backup_diverged": True}),
            ("backup_checksum", {"backup_checksum_mismatch": True}),
            ("mirror_checksum", {"mirror_checksum_mismatch": True}),
            ("backup_missing", {"backup_missing": True}),
        ]
        for label, ledger_body in cases:
            with self.subTest(case=label):
                st = self._write_state(f"l_{label}.json", {"as_of": "2026-11-27T12:00:00Z", "ledger": ledger_body})
                res = prod_invariants.analyze_prod_states([st])
                self.assertEqual(res["affected_objects"], ["ledger"])
                self.assertEqual(len(res["violations"]), 1)
                self.assertEqual(res["violations"][0]["invariant"], "ledger_public_hygiene")
                self.assertTrue(res["triggers"][0].startswith("prod_invariant:ledger_public_hygiene"))

    def test_dim8_ops_disk_and_deploy_health_clean_boundaries_and_violations(self):
        clean = self._write_state("o_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "ops": {
                "disk_used_pct": 84.9,
                "free_gib": 10.0,
                "unpruned_images_count": 10,
                "max_retained": 10,
                "ghcr_cleanup_overdue_days": 35.0,
                "restart_count_24h": 4,
                "deploy_non_stdlib_imports": 0,
            },
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean])["triggers"], [])

        cases = [
            ("disk_pct_boundary", {"disk_used_pct": 85.0}),
            ("free_gib_boundary", {"free_gib": 9.9}),
            ("per_mount_disk", {"disks": [{"mount": "/data", "disk_used_pct": 91.2, "free_gib": 6.4}]}),
            ("unpruned_default", {"unpruned_images_count": 11}),
            ("unpruned_custom", {"unpruned_images_count": 4, "max_retained": 3}),
            ("ghcr_days", {"ghcr_cleanup_overdue_days": 35.1}),
            ("ghcr_ts", {"last_ghcr_cleanup_at": "2026-10-15T00:00:00Z"}),
            ("restart_boundary", {"restart_count_24h": 5}),
            ("container_restarts", {"containers": [{"name": "paper-runner", "restart_count_24h": 7}]}),
            ("deploy_non_stdlib", {"deploy_non_stdlib_imports": 1, "deploy_non_stdlib_details": ["deploy/x.py:2:yaml"]}),
        ]
        for label, ops_body in cases:
            with self.subTest(case=label):
                st = self._write_state(f"o_{label}.json", {"as_of": "2026-11-27T12:00:00Z", "ops": ops_body})
                res = prod_invariants.analyze_prod_states([st])
                self.assertEqual(res["affected_objects"], ["deploy"])
                self.assertEqual(len(res["violations"]), 1)
                self.assertEqual(res["violations"][0]["invariant"], "ops_disk_and_deploy_health")
                self.assertTrue(res["triggers"][0].startswith("prod_invariant:ops_disk_and_deploy_health"))

    def test_deploy_ast_stdlib_purity_checker_on_real_repo_and_synthetic_violation(self):
        real_res = ops_invariants.scan_deploy_stdlib_purity(ROOT)
        self.assertGreater(real_res["deploy_py_files_scanned"], 0)
        self.assertEqual(real_res["deploy_non_stdlib_imports"], 0)

        fake_repo = self.home / "fake_repo"
        (fake_repo / "deploy").mkdir(parents=True)
        (fake_repo / "deploy" / "clean.py").write_text(
            "from __future__ import annotations\nimport json\nfrom pathlib import Path\nimport deploy.helper\n",
            encoding="utf-8",
        )
        (fake_repo / "deploy" / "helper.py").write_text("import os\n", encoding="utf-8")
        (fake_repo / "deploy" / "bad.py").write_text(
            "import requests\nfrom market import follow\nimport helper\n",
            encoding="utf-8",
        )
        bad_res = ops_invariants.scan_deploy_stdlib_purity(fake_repo)
        self.assertEqual(bad_res["deploy_py_files_scanned"], 3)
        self.assertEqual(bad_res["deploy_non_stdlib_imports"], 2)
        self.assertIn("deploy/bad.py:1:requests", bad_res["deploy_non_stdlib_details"])
        self.assertIn("deploy/bad.py:2:market", bad_res["deploy_non_stdlib_details"])

    def test_prod_snapshot_collects_market_parquet_ledger_export_and_ops_without_leaking_secrets(self):
        as_of = "2026-11-27T12:00:00Z"
        # Market dir with valid daily parquets (no false positive), plus corrupt, 0-byte, 0-row, and dup month.
        mkt = self.home / "market_dir"
        (mkt / "head.json").parent.mkdir(parents=True)
        (mkt / "head.json").write_text(json.dumps({
            "latest_day": "2026-11-26", "halted": False, "delisted_blocking_head": 1,
        }), encoding="utf-8")
        _write_parquet(mkt / "daily" / "BTCUSDT-2026-11-25.parquet", 10)
        _write_parquet(mkt / "daily" / "BTCUSDT-2026-11-26.parquet", 10)
        _write_parquet(mkt / "monthly" / "ETHUSDT-2026-10.parquet", 5)
        _write_parquet(mkt / "monthly" / "ETHUSDT-2026-10.copy.parquet", 5)
        _write_parquet(mkt / "monthly" / "SOLUSDT-2026-10.parquet", 0)
        (mkt / "monthly" / "XRPUSDT-2026-10.parquet").write_bytes(b"")
        (mkt / "monthly" / "ADAUSDT-2026-10.parquet").write_bytes(b"PAR1broken" + b"PAR1")

        # Ledger export dir with private table, private_root marker, credential pattern, and forbidden .env file.
        exp = self.home / "ledger_export"
        exp.mkdir(parents=True)
        (exp / "dump.sql").write_text(
            "CREATE TABLE paper_runs (id INT);\n"
            "-- path=/srv/private_root/live\n"
            "-- api_key=SUPERSECRETTOKENVALUE99999\n",
            encoding="utf-8",
        )
        (exp / ".env").write_text("BINANCE_API_SECRET=NEVERREADTHISSECRETVALUE\n", encoding="utf-8")
        ledger_status = self._write_state("ledger_status.json", {
            "backup_behind_commits": 0, "backup_lag_s": 60, "mirror_diverged": False, "mirror_lag_s": 60,
            "last_restore_ok": True, "last_restore_drill_at": "2026-10-01T00:00:00Z",
        })

        # Ops status + fake repo with bad deploy import.
        ops_json = self._write_state("ops_status.json", {
            "disk_used_pct": 87.5, "free_gib": 8.2,
            "unpruned_images_count": 14, "max_retained": 8,
            "last_ghcr_cleanup_at": "2026-10-10T00:00:00Z",
            "restart_count_24h": 6,
        })
        fake_repo = self.home / "repo_bad_deploy"
        (fake_repo / "deploy").mkdir(parents=True)
        (fake_repo / "deploy" / "drift.py").write_text("import pandas\n", encoding="utf-8")

        out_path = self.home / "state.json"
        buf = io.StringIO()
        with redirect_stdout(buf):
            doctor.main([
                "prod-snapshot",
                "--market-dir", str(mkt),
                "--ledger-status-json", str(ledger_status),
                "--ledger-export-dir", str(exp),
                "--ops-status-json", str(ops_json),
                "--repo-root", str(fake_repo),
                "--as-of", as_of,
                "--out", str(out_path),
            ])

        snap_text = out_path.read_text(encoding="utf-8")
        self.assertNotIn("NEVERREADTHISSECRETVALUE", snap_text)
        self.assertNotIn("SUPERSECRETTOKENVALUE99999", snap_text)
        snap = json.loads(snap_text)
        self.assertEqual(snap["market"]["zero_byte_files"], 1)
        self.assertEqual(snap["market"]["corrupt_files"], 2)
        self.assertEqual(snap["market"]["zero_row_files"], 1)
        self.assertEqual(snap["market"]["duplicate_months"], 1)
        self.assertEqual(snap["ops"]["deploy_non_stdlib_imports"], 1)

        fbuf = io.StringIO()
        with redirect_stdout(fbuf):
            doctor.main(["friction", "--prod-state", str(out_path)])
        fric = json.loads(fbuf.getvalue())
        self.assertNotIn("NEVERREADTHISSECRETVALUE", fbuf.getvalue())
        self.assertNotIn("SUPERSECRETTOKENVALUE99999", fbuf.getvalue())
        invariants = {v["invariant"] for v in fric["prod_state_summary"]["violations"]}
        self.assertEqual(invariants, {
            "market_archive_integrity",
            "ledger_public_hygiene",
            "ops_disk_and_deploy_health",
        })
        self.assertEqual(fric["prod_state_summary"]["affected_objects"], ["deploy", "ledger", "market"])

    def test_malformed_new_fields_emit_prod_state_unreadable_without_crash(self):
        bad = self._write_state("bad_ops.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "market": {"corrupt_files": "two", "month_partitions": ["not-a-month"]},
            "ledger": {"last_restore_ok": "yes", "last_restore_drill_age_days": "old"},
            "ops": {"disk_used_pct": "full", "restart_count_24h": True},
        })
        res = prod_invariants.analyze_prod_states([bad])
        self.assertEqual(len(res["triggers"]), 1)
        self.assertTrue(res["triggers"][0].startswith("prod_state:prod_state_unreadable"))


class OpsInvariantsSchedulerPreemptionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()
        self.repo = self.home / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "gc.auto", "0")
        self.git("config", "maintenance.auto", "false")
        here = Path.cwd()
        self.addCleanup(os.chdir, here)
        os.chdir(self.repo)

        base_env = {"GIT_AUTHOR_DATE": "2026-11-24T00:00:00Z", "GIT_COMMITTER_DATE": "2026-11-24T00:00:00Z"}
        self.commit({
            "market/__init__.py": "",
            "market/store.py": "def read_month():\n    return 1\n",
            "ledger/__init__.py": "",
            "ledger/publish.py": "def export():\n    return 1\n",
            "deploy/__init__.py": "",
            "deploy/update.py": "def prune():\n    return 1\n",
        }, message="feat: market ledger deploy baseline", env_extra=base_env)

        rec_find = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | market:x | examined | ok |\n| results | ledger:x | examined | ok |\n"
            "| results | deploy:x | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_fric = (
            "# Themed audit: friction\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| operation | market:x | examined | ok |\n| operation | ledger:x | examined | ok |\n"
            "| operation | deploy:x | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_env = {"GIT_AUTHOR_DATE": "2026-11-26T12:00:00Z", "GIT_COMMITTER_DATE": "2026-11-26T12:00:00Z"}
        self.commit({
            "docs/plans/doctor/2026-11-25-find.zh.md": rec_find,
            "docs/plans/doctor/2026-11-26-fric1.zh.md": rec_fric,
            "docs/plans/doctor/2026-11-26-fric2.zh.md": rec_fric,
        }, message="docs(doctor): steady baseline with active friction cooldown", env_extra=rec_env)

        self.empty_issues = self.home / "issues.json"
        self.empty_issues.write_text("[]", encoding="utf-8")

    def git(self, *args, env_extra=None):
        env = {**os.environ, **(env_extra or {})}
        return subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", self.repo, *args],
            check=True, capture_output=True, text=True, env=env,
        ).stdout.strip()

    def commit(self, files: dict[str, str], message: str, env_extra=None) -> str:
        for name, text in files.items():
            (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
            (self.repo / name).write_text(text, encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", message, env_extra=env_extra)
        return self.git("rev-parse", "HEAD")

    def call_advise(self, *extra_args) -> dict:
        buf = io.StringIO()
        with redirect_stdout(buf):
            doctor.main([
                "advise", "--tree", "HEAD", "--issues-json", str(self.empty_issues),
                "--auto", "--steady-exit-code", "2", *map(str, extra_args),
            ])
        return json.loads(buf.getvalue())

    def test_clean_l4_ops_snapshot_exits_2_steady(self):
        clean_state = self.home / "clean_l4.json"
        clean_state.write_text(json.dumps({
            "as_of": "2026-11-27T12:00:00Z",
            "market": {"latest_day": "2026-11-26", "corrupt_files": 0, "zero_row_files": 0, "active_symbols_drop_pct": 2.0},
            "ledger": {"last_restore_ok": True, "last_restore_drill_age_days": 14.0, "backup_diverged": False},
            "ops": {"disk_used_pct": 62.0, "free_gib": 48.0, "unpruned_images_count": 4, "max_retained": 10,
                    "ghcr_cleanup_overdue_days": 10.0, "restart_count_24h": 0, "deploy_non_stdlib_imports": 0},
        }), encoding="utf-8")

        buf = io.StringIO()
        with self.assertRaises(SystemExit) as ctx, redirect_stdout(buf):
            doctor.main([
                "advise", "--tree", "HEAD", "--issues-json", str(self.empty_issues),
                "--auto", "--steady-exit-code", "2", "--prod-state", str(clean_state),
            ])
        self.assertEqual(ctx.exception.code, 2)
        plan = json.loads(buf.getvalue())
        self.assertEqual(plan["recommended_theme"], "steady")
        self.assertFalse(plan["friction_summary"]["prod_incident_active"])

    def test_each_new_l4_invariant_preempts_cooldown_and_routes_to_owning_object(self):
        cases = [
            ("market", "market_archive_integrity", {"market": {"zero_row_files": 1, "active_symbols_drop_pct": 25.0}}),
            ("ledger", "ledger_public_hygiene", {"ledger": {"public_export_private_tables": ["paper_runs"], "last_restore_ok": False}}),
            ("deploy", "ops_disk_and_deploy_health", {"ops": {"disk_used_pct": 89.0, "deploy_non_stdlib_imports": 1}}),
        ]
        for expected_obj, expected_inv, body in cases:
            with self.subTest(invariant=expected_inv):
                st = self.home / f"{expected_inv}.json"
                st.write_text(json.dumps({"as_of": "2026-11-27T12:00:00Z", **body}), encoding="utf-8")
                plan = self.call_advise("--prod-state", st)
                self.assertEqual(plan["recommended_theme"], "friction")
                self.assertTrue(plan["friction_summary"]["prod_incident_active"])
                self.assertFalse(plan["friction_summary"]["in_cooldown"])
                self.assertIn(expected_obj, plan["recommended_scope"]["objects"])
                self.assertIn("operation", plan["recommended_scope"]["items"])
                self.assertIn(expected_inv, plan["friction_summary"]["prod_state_summary"]["invariants_triggered"])


if __name__ == "__main__":
    unittest.main()
