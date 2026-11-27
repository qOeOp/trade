"""Tests for product-doctor v3.1 silent production invariants, read-only prod-snapshot collector,
secret refusal, malformed JSON resilience, and un-coolable advise/--auto preemption."""

from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / ".agents/skills/product-doctor/assets"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ASSETS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


doctor = _load("doctor")
friction = _load("friction")
prod_invariants = _load("prod_invariants")
scheduler = _load("scheduler")


class ProdInvariantsUnitTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()

    def _write_state(self, name: str, payload) -> Path:
        path = self.home / name
        path.parent.mkdir(parents=True, exist_ok=True)
        text = payload if isinstance(payload, str) else json.dumps(payload)
        path.write_text(text, encoding="utf-8")
        return path

    def test_invariant_1_market_head_staleness_positive_and_boundaries(self):
        clean_boundary = self._write_state("m_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "market": {"latest_day": "2026-11-25", "halted": False},
        })
        halted = self._write_state("m_halted.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "market": {"latest_day": "2026-11-10", "halted": True},
        })
        stale = self._write_state("m_stale.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "market": {"latest_day": "2026-11-24", "halted": False},
        })
        custom_thresh = self._write_state("m_custom.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "thresholds": {"market_head_max_lag_days": 1},
            "market": {"head": "2026-11-25"},
        })

        self.assertEqual(prod_invariants.analyze_prod_states([clean_boundary, halted])["triggers"], [])

        res_stale = prod_invariants.analyze_prod_states([stale])
        self.assertEqual(res_stale["affected_objects"], ["market"])
        self.assertEqual(len(res_stale["triggers"]), 1)
        self.assertTrue(res_stale["triggers"][0].startswith("prod_invariant:market_head_staleness"))

        res_custom = prod_invariants.analyze_prod_states([custom_thresh])
        self.assertEqual(res_custom["affected_objects"], ["market"])
        self.assertTrue(res_custom["triggers"][0].startswith("prod_invariant:market_head_staleness"))

    def test_invariant_2_paper_checkpoint_stall_running_and_warming(self):
        clean = self._write_state("p_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "paper": {
                "runs": [
                    {"id": "r1", "state": "RUNNING", "alive_s": 7200, "checkpoint_age_s": 7200},
                    {"id": "r2", "state": "WARMING", "warming_age_s": 900, "warmup_budget_s": 900},
                    {"id": "r3", "state": "SEALED", "alive_s": 99999, "checkpoint_age_s": 99999},
                    {"id": "r4", "state": "RUNNING", "alive_s": 3600, "checkpoint_age_s": 7500},
                ]
            },
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean])["triggers"], [])

        stalled = self._write_state("p_stalled.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "paper": {
                "runs": [
                    {"id": "p-ckpt", "state": "RUNNING", "alive_s": 7300, "checkpoint_age_s": 7201},
                    {"id": "p-warm", "state": "WARMING", "warming_age_s": 901},
                    {
                        "id": "p-ts", "state": "RUNNING",
                        "started_at": "2026-11-27T08:00:00Z", "last_checkpoint_at": "2026-11-27T09:00:00Z",
                    },
                ]
            },
        })
        res = prod_invariants.analyze_prod_states([stalled])
        self.assertEqual(res["affected_objects"], ["paper"])
        self.assertEqual(len(res["violations"]), 3)
        self.assertTrue(all(t.startswith("prod_invariant:paper_checkpoint_stall") for t in res["triggers"]))

    def test_invariant_3_orphan_unsealed_age(self):
        clean = self._write_state("o_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "unsealed_orphans": [
                {"id": "ok-1", "service": "paper", "age_s": 600},
                {"id": "sealed-1", "service": "live", "age_s": 9999, "sealed": True},
            ],
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean])["triggers"], [])

        stale = self._write_state("o_stale.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "unsealed_orphans": [
                {"id": "orphan-paper", "service": "paper", "age_s": 601},
                {"id": "orphan-live", "service": "live", "ended_at": "2026-11-27T11:40:00Z"},
            ],
        })
        res = prod_invariants.analyze_prod_states([stale])
        self.assertEqual(res["affected_objects"], ["live", "paper"])
        self.assertEqual(len(res["violations"]), 2)
        self.assertTrue(all(t.startswith("prod_invariant:orphan_unsealed_age") for t in res["triggers"]))

    def test_invariant_4_compare_unexplained_drift(self):
        clean = self._write_state("c_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "compare": [
                {"service": "paper", "unexplained": [], "unexplained_count": 0, "orders_differ": False, "positions_differ": False},
            ],
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean])["triggers"], [])

        drifted = self._write_state("c_drift.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "compare": [
                {"service": "live", "unexplained": [{"at": "2026-11-27T01:00:00Z"}]},
                {"service": "paper", "orders_differ": True},
                {"positions_differ": True},
            ],
        })
        res = prod_invariants.analyze_prod_states([drifted])
        self.assertEqual(res["affected_objects"], ["engine", "live", "paper"])
        self.assertEqual(len(res["violations"]), 3)
        self.assertTrue(all(t.startswith("prod_invariant:compare_unexplained_drift") for t in res["triggers"]))

    def test_invariant_5_notify_heartbeat_missing_including_quiet_days(self):
        clean = self._write_state("n_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "notify": [
                {"service": "live", "active": True, "trades_today": 0, "last_daily_summary_age_h": 26.0},
                {"service": "paper", "active": False, "last_daily_summary_age_h": 80.0},
            ],
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean])["triggers"], [])

        missing = self._write_state("n_missing.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "notify": [
                {"service": "live", "active": True, "trades_today": 0, "last_daily_summary_age_h": 26.1},
                {"service": "paper", "active": True, "last_daily_summary_at": "2026-11-26T04:00:00Z"},
            ],
        })
        res = prod_invariants.analyze_prod_states([missing])
        self.assertEqual(res["affected_objects"], ["live", "paper"])
        self.assertEqual(len(res["violations"]), 2)
        self.assertTrue(all(t.startswith("prod_invariant:notify_heartbeat_missing") for t in res["triggers"]))

    def test_invariant_6_ledger_backup_or_mirror_drift(self):
        clean = self._write_state("l_clean.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "ledger": {
                "backup_behind_commits": 2,
                "backup_lag_s": 3600,
                "mirror_diverged": False,
                "mirror_lag_s": 3600,
            },
        })
        clean_zero_behind = self._write_state("l_zero.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "ledger": {"backup_behind_commits": 0, "backup_lag_s": 99999, "mirror_diverged": False, "mirror_lag_s": 100},
        })
        self.assertEqual(prod_invariants.analyze_prod_states([clean, clean_zero_behind])["triggers"], [])

        b_drift = self._write_state("l_backup.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "ledger": {"backup_behind_commits": 1, "backup_lag_s": 3601},
        })
        m_div = self._write_state("l_div.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "ledger": {"mirror_diverged": True},
        })
        m_lag = self._write_state("l_lag.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "ledger": {"mirror_lag_s": 3601},
        })
        res = prod_invariants.analyze_prod_states([b_drift, m_div, m_lag])
        self.assertEqual(res["affected_objects"], ["ledger"])
        self.assertEqual(len(res["violations"]), 3)
        self.assertTrue(all(t.startswith("prod_invariant:ledger_backup_or_mirror_drift") for t in res["triggers"]))

    def test_malformed_null_missing_and_wrong_types_emit_unreadable_without_crash(self):
        null_sections = self._write_state("null_sections.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "market": None, "paper": None, "unsealed_orphans": None,
            "compare": None, "notify": None, "ledger": None,
        })
        self.assertEqual(prod_invariants.analyze_prod_states([null_sections])["triggers"], [])

        bad_json = self._write_state("bad.json", "{not valid json")
        null_root = self._write_state("null_root.json", "null")
        list_root = self._write_state("list_root.json", "[]")
        missing = self.home / "does-not-exist.json"
        wrong_types = self._write_state("wrong_types.json", {
            "as_of": "2026-11-27T12:00:00Z",
            "market": {"latest_day": 12345},
            "paper": {"runs": "not-a-list"},
            "unsealed_orphans": "nope",
            "compare": {"unexplained_count": True, "unexplained": "nope"},
            "notify": {"last_daily_summary_age_h": "thirty"},
            "ledger": {"backup_behind_commits": "two"},
        })

        res = prod_invariants.analyze_prod_states([bad_json, null_root, list_root, missing, self.home, wrong_types])
        self.assertEqual(len(res["triggers"]), 6)
        self.assertTrue(all(t.startswith("prod_state:prod_state_unreadable") for t in res["triggers"]))

    def test_secret_files_refused_and_summaries_sanitized(self):
        env_file = self._write_state(".env", "BINANCE_API_KEY=supersecretvalue1234567890\n")
        dolt_svc = self._write_state("dolt/service.json", '{"password": "do-not-read-password"}')
        tg_file = self._write_state("notify/telegram.json", '{"bot_token": "123456789:AABBCCDDEEFFGGHHIIJJKKLLMM"}')
        key_file = self._write_state("exchange_api_key.json", '{"market": {"latest_day": "2020-01-01"}}')
        secret_file = self._write_state("my_secret.json", '{"market": {"latest_day": "2020-01-01"}}')
        cred_file = self._write_state("credentials.json", '{"market": {"latest_day": "2020-01-01"}}')
        tok_file = self._write_state("auth_token.json", '{"market": {"latest_day": "2020-01-01"}}')
        link_to_env = self.home / "innocent.json"
        link_to_env.symlink_to(env_file)

        for secret_path in (env_file, dolt_svc, tg_file, key_file, secret_file, cred_file, tok_file, link_to_env):
            self.assertTrue(prod_invariants.is_secret_path(secret_path), f"must refuse {secret_path}")

        res = prod_invariants.analyze_prod_states([env_file, dolt_svc, tg_file, key_file, link_to_env])
        serialized = json.dumps(res)
        self.assertNotIn("supersecretvalue1234567890", serialized)
        self.assertNotIn("do-not-read-password", serialized)
        self.assertNotIn("AABBCCDDEEFFGGHHIIJJKKLLMM", serialized)
        self.assertEqual(len(res["triggers"]), 5)
        self.assertTrue(all("secret file refused" in t for t in res["triggers"]))

        scrubbed = prod_invariants.sanitize_text(
            "https://user:pass@host/x Authorization: Bearer tok123456789 "
            "12345678:AABBCCDDEEFFGGHHIIJJKKLL api_key=mysecretval"
        )
        self.assertNotIn("pass@", scrubbed)
        self.assertNotIn("tok123456789", scrubbed)
        self.assertNotIn("AABBCCDDEEFFGGHHIIJJKKLL", scrubbed)
        self.assertNotIn("mysecretval", scrubbed)

    def test_prod_snapshot_readonly_collector_round_trip(self):
        as_of = "2026-11-27T12:00:00Z"
        market_dir = self.home / "market_data"
        (market_dir / "head.json").parent.mkdir(parents=True)
        (market_dir / "head.json").write_text(json.dumps({"latest_day": "2026-11-23", "halted": False}), encoding="utf-8")
        (market_dir / ".env").write_text("SECRET=never-read-me\n", encoding="utf-8")

        paper_root = self.home / "paper_runs"
        p_running = paper_root / "db1" / "run_101"
        p_running.mkdir(parents=True)
        (p_running / "status.json").write_text(json.dumps({
            "paper_id": "run_101", "state": "RUNNING",
            "started_at": "2026-11-27T08:00:00Z", "last_checkpoint_at": "2026-11-27T09:00:00Z",
        }), encoding="utf-8")
        p_orphan = paper_root / "db1" / "run_102"
        p_orphan.mkdir(parents=True)
        (p_orphan / "status.json").write_text(json.dumps({
            "paper_id": "run_102", "state": "UNSEALED", "ended_at": "2026-11-27T11:30:00Z",
        }), encoding="utf-8")
        p_sealed = paper_root / "db1" / "run_103"
        p_sealed.mkdir(parents=True)
        (p_sealed / "seal.json").write_text("{}", encoding="utf-8")

        live_root = self.home / "live_runs"
        (live_root / "notify").mkdir(parents=True)
        (live_root / "notify" / "telegram.json").write_text('{"token":"99999999:SECRETTELEGRAMTOKEN123456"}', encoding="utf-8")
        (live_root / "notify" / "state.json").write_text(json.dumps({
            "live:daily_summary:2026-11-25": True,
        }), encoding="utf-8")
        l_orphan = live_root / "live_run_9"
        l_orphan.mkdir(parents=True)
        (l_orphan / "status.json").write_text(json.dumps({
            "run_id": "live_run_9", "state": "ENDED", "ended_at": "2026-11-27T11:45:00Z",
        }), encoding="utf-8")

        compare_json = self._write_state("live-compare.json", {
            "service": "live", "unexplained": [{"at": "2026-11-27T01:00:00Z"}], "orders_differ": True,
        })
        ledger_json = self._write_state("ledger-status.json", {
            "backup_behind_commits": 3, "backup_lag_s": 5400, "mirror_diverged": True,
        })
        out_path = self.home / "out" / "state.json"

        buf = io.StringIO()
        with redirect_stdout(buf):
            doctor.main([
                "prod-snapshot",
                "--market-dir", str(market_dir),
                "--paper-root", str(paper_root),
                "--live-root", str(live_root),
                "--compare-json", str(compare_json),
                "--ledger-status-json", str(ledger_json),
                "--as-of", as_of,
                "--out", str(out_path),
            ])
        self.assertTrue(out_path.is_file())
        snap_text = out_path.read_text(encoding="utf-8")
        self.assertNotIn("SECRETTELEGRAMTOKEN123456", snap_text)
        self.assertNotIn("never-read-me", snap_text)

        # Feed collected snapshot straight into `doctor.py friction --prod-state`.
        fbuf = io.StringIO()
        with redirect_stdout(fbuf):
            doctor.main(["friction", "--prod-state", str(out_path)])
        fric = json.loads(fbuf.getvalue())
        self.assertTrue(fric["prod_state_provided"])
        self.assertTrue(fric["has_friction"])
        summary = fric["prod_state_summary"]
        invariants = {v["invariant"] for v in summary["violations"]}
        self.assertEqual(invariants, {
            "market_head_staleness",
            "paper_checkpoint_stall",
            "orphan_unsealed_age",
            "compare_unexplained_drift",
            "notify_heartbeat_missing",
            "ledger_backup_or_mirror_drift",
        })
        self.assertEqual(summary["affected_objects"], ["ledger", "live", "market", "paper"])

        # Writing --out to a secret path must be refused.
        with self.assertRaises(SystemExit):
            doctor.main(["prod-snapshot", "--as-of", as_of, "--out", str(self.home / ".env")])

        # Passing dolt/service.json to --ledger-status-json must be refused without reading it.
        dolt_secret = self._write_state("dolt/service.json", '{"password": "secret-dolt-password"}')
        snap_refused = prod_invariants.collect_prod_snapshot(ledger_status_json=dolt_secret, as_of=as_of)
        self.assertNotIn("ledger", snap_refused)
        self.assertNotIn("secret-dolt-password", json.dumps(snap_refused))
        self.assertTrue(any("secret file refused" in n for n in snap_refused.get("collector_notes", [])))

    def test_notify_text_log_streaming_collector(self):
        as_of = "2026-11-27T12:00:00Z"
        log_path = self.home / "paper-notify.log"
        log_path.write_text("\n".join([
            "2026-11-25T00:05:00Z INFO sent daily summary for 2026-11-24 (UTC)",
            "2026-11-27T11:00:00Z INFO fill event btc",
        ]) + "\n", encoding="utf-8")
        snap = prod_invariants.collect_prod_snapshot(notify_logs=[log_path], as_of=as_of)
        self.assertEqual(len(snap["notify"]), 1)
        self.assertEqual(snap["notify"][0]["service"], "paper")
        self.assertGreater(snap["notify"][0]["last_daily_summary_age_h"], 26.0)


class ProdInvariantsSchedulerPreemptionTests(unittest.TestCase):
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
            "market/follow.py": "def head():\n    return '2026-11-27'\n",
            "paper/__init__.py": "",
            "paper/runs.py": "def checkpoint():\n    return 1\n",
            "live/__init__.py": "",
            "live/notify.py": "def send_daily():\n    return True\n",
            "ledger/__init__.py": "",
            "ledger/publish.py": "def backup():\n    return True\n",
            "engine/__init__.py": "",
            "engine/run.py": "def compare():\n    return []\n",
        }, message="feat: core prod packages", env_extra=base_env)

        # Put every package in examined + steady state AND put friction in active 7d cooldown
        # with last_two_themes == ["friction", "friction"] to prove silent invariants are un-coolable!
        rec_find = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | market:x | examined | ok |\n| results | paper:x | examined | ok |\n"
            "| results | live:x | examined | ok |\n| results | ledger:x | examined | ok |\n"
            "| results | engine:x | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_fric = (
            "# Themed audit: friction\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| operation | market:x | examined | ok |\n| operation | paper:x | examined | ok |\n"
            "| operation | live:x | examined | ok |\n| operation | ledger:x | examined | ok |\n"
            "| operation | engine:x | examined | ok |\n\n"
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

    def test_clean_prod_state_allows_steady_exit_code_2(self):
        clean_state = self.home / "clean.json"
        clean_state.write_text(json.dumps({
            "as_of": "2026-11-27T12:00:00Z",
            "market": {"latest_day": "2026-11-26", "halted": False},
            "paper": {"runs": [{"id": "p1", "state": "RUNNING", "alive_s": 9000, "checkpoint_age_s": 120}]},
            "unsealed_orphans": [],
            "compare": [{"service": "live", "unexplained_count": 0, "orders_differ": False, "positions_differ": False}],
            "notify": [{"service": "live", "active": True, "last_daily_summary_age_h": 12.0}],
            "ledger": {"backup_behind_commits": 0, "backup_lag_s": 60, "mirror_diverged": False, "mirror_lag_s": 60},
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
        self.assertEqual(plan["friction_summary"]["prod_state_summary"]["violation_count"], 0)

    def test_each_silent_invariant_preempts_cooldown_and_steady_to_owning_object(self):
        cases = [
            ("market", "market_head_staleness", {"market": {"latest_day": "2026-11-20"}}),
            ("paper", "paper_checkpoint_stall", {"paper": {"runs": [{"id": "r1", "state": "WARMING", "warming_age_s": 1200}]}}),
            ("live", "notify_heartbeat_missing", {"notify": [{"service": "live", "active": True, "last_daily_summary_age_h": 30.0}]}),
            ("ledger", "ledger_backup_or_mirror_drift", {"ledger": {"mirror_diverged": True}}),
            ("engine", "compare_unexplained_drift", {"compare": [{"positions_differ": True}]}),
        ]
        for expected_obj, expected_inv, body in cases:
            with self.subTest(invariant=expected_inv):
                state_path = self.home / f"{expected_inv}.json"
                state_path.write_text(json.dumps({"as_of": "2026-11-27T12:00:00Z", **body}), encoding="utf-8")
                plan = self.call_advise("--prod-state", state_path)
                self.assertEqual(plan["recommended_theme"], "friction")
                self.assertTrue(plan["friction_summary"]["prod_incident_active"])
                self.assertFalse(plan["friction_summary"]["in_cooldown"])
                self.assertIn(expected_obj, plan["recommended_scope"]["objects"])
                self.assertIn("operation", plan["recommended_scope"]["items"])
                self.assertIn(expected_inv, plan["friction_summary"]["prod_state_summary"]["invariants_triggered"])

    def test_unreadable_prod_state_also_blocks_steady_and_preempts_cooldown(self):
        corrupt = self.home / "corrupt.json"
        corrupt.write_text("{broken", encoding="utf-8")
        plan = self.call_advise("--prod-state", corrupt)
        self.assertEqual(plan["recommended_theme"], "friction")
        self.assertTrue(plan["friction_summary"]["prod_incident_active"])
        self.assertFalse(plan["friction_summary"]["in_cooldown"])
        self.assertIn("prod_state_unreadable", plan["friction_summary"]["prod_state_summary"]["invariants_triggered"])


if __name__ == "__main__":
    unittest.main()
