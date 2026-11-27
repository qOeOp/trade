"""Tests for L4 research-session quality telemetry and methodology lens SLA (product-doctor v3.1)."""

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
research_quality = _load("research_quality")
scheduler = _load("scheduler")


def _ag_cmd(cmd: str, content: str = "") -> str:
    row: dict = {
        "type": "PLANNER_RESPONSE",
        "tool_calls": [{"name": "run_command", "args": {"CommandLine": cmd}}],
    }
    if content:
        row["content"] = content
    return json.dumps(row)


def _ag_out(text: str, *, error: bool = False) -> str:
    return json.dumps({
        "type": "GENERIC",
        "status": "ERROR" if error else "DONE",
        "content": text,
    })


def _ag_text(text: str) -> str:
    return json.dumps({"type": "PLANNER_RESPONSE", "content": text})


def _claude_tool(name: str, inp: dict) -> str:
    return json.dumps({
        "type": "assistant",
        "message": {"role": "assistant", "content": [{"type": "tool_use", "name": name, "input": inp}]},
    })


def _claude_result(text: str, *, is_error: bool = False) -> str:
    return json.dumps({
        "type": "user",
        "message": {"role": "user", "content": [{"type": "tool_result", "content": text, "is_error": is_error}]},
    })


def _claude_text(text: str) -> str:
    return json.dumps({
        "type": "assistant",
        "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
    })


def _codex_cmd(cmd: str) -> str:
    return json.dumps({
        "type": "response_item",
        "payload": {
            "type": "function_call",
            "name": "exec_command",
            "arguments": json.dumps({"cmd": cmd}),
        },
    })


def _codex_out(text: str) -> str:
    return json.dumps({
        "type": "response_item",
        "payload": {"type": "function_call_output", "output": text},
    })


def _codex_text(text: str) -> str:
    return json.dumps({
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": text}],
        },
    })


class ResearchQualityUnitTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()

    def _write_lines(self, name: str, lines: list[str]) -> Path:
        p = self.home / name
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return p

    def test_ordinary_coding_session_is_not_research_and_has_zero_triggers(self):
        tx = self._write_lines("coding.jsonl", [
            _ag_cmd("uv run --frozen python -m unittest tests.test_metrics"),
            _ag_out("Ran 12 tests in 0.4s OK"),
            _ag_cmd("uv run --frozen python -m cli.main replay run --help"),
            _ag_out("usage: replay run"),
            _ag_cmd('git grep -n "Sharpe" report/'),
            _ag_text(
                "Updated unit tests: Sharpe ratio test expects 1.85, CAGR 32.0%, max drawdown 12.5%, win rate 58.0%."
            ),
        ])
        res = research_quality.analyze_research_quality([tx])
        self.assertEqual(res["research_session_count"], 0)
        self.assertFalse(res["sessions"][0]["research_session"])
        self.assertEqual(res["sessions"][0]["evidence_gap_claims"], 0)
        self.assertEqual(res["triggers"], [])

    def test_clean_research_session_produces_zero_triggers(self):
        # Proper prereg -> replay -> report/analysis -> distinct hypothesis -> multiple-testing check -> cited metrics.
        lines = [
            json.dumps({
                "type": "PLANNER_RESPONSE",
                "tool_calls": [{"name": "read_file", "args": {"Path": ".agents/skills/research-round/SKILL.md"}}],
            }),
            _ag_cmd(
                "python -m cli.main registration add --line L1 --candidate trend@1 "
                "--hypothesis 'Donchian channel breakout entry' --symbol BTCUSDT "
                "--start 2024-01-01 --end 2024-06-30 --execution bars"
            ),
            _ag_cmd(
                "python -m cli.main replay run --line L1 --candidate trend@1 --registration R1 "
                "-- --symbol BTCUSDT --start 2024-01-01 --end 2024-06-30 --execution bars"
            ),
            _ag_out(json.dumps({"outcome": "failed", "meets_targets": False})),
            json.dumps({
                "type": "PLANNER_RESPONSE",
                "tool_calls": [{"name": "read_file", "args": {"Path": ".agents/skills/nautilus-report-analysis/SKILL.md"}}],
            }),
            _ag_cmd("python -m cli.main replay report --trial-id 1 --tables"),
            _ag_out(json.dumps({"annual_return": 0.12, "max_drawdown": 0.28})),
            _ag_cmd(
                "python -m cli.main registration add --line L1 --candidate carry@1 "
                "--hypothesis 'Funding rate carry with volatility cap' --symbol BTCUSDT "
                "--start 2024-01-01 --end 2024-06-30 --execution bars"
            ),
            _ag_cmd(
                "python -m cli.main replay run --line L1 --candidate carry@1 --registration R2 "
                "-- --symbol BTCUSDT --start 2024-01-01 --end 2024-06-30 --execution bars"
            ),
            _ag_out(json.dumps({"outcome": "completed", "meets_targets": True})),
            _ag_cmd("python -m cli.main replay report --trial-id 2"),
            _ag_out(json.dumps({"sharpe": 1.92, "annual_return": 0.41, "max_drawdown": 0.11})),
            _ag_cmd("python -m cli.main hypothesis compare --registration R2 --trial-id 2"),
            _ag_cmd("python -m cli.main research status --line L1"),
            _ag_text(
                "Trial 2 passed: Sharpe ratio 1.92, annual return 41.0%, max drawdown 11.0%, "
                "win rate 54.5%, PnL +22.4% (with target annual return >= 30%)."
            ),
        ]
        tx = self._write_lines("clean_research.jsonl", lines)
        res = research_quality.analyze_research_quality([tx])
        sess = res["sessions"][0]
        self.assertTrue(sess["research_session"])
        self.assertEqual(sess["trial_count"], 2)
        self.assertEqual(sess["param_churn_ratio"], 0.0)
        self.assertEqual(sess["unattributed_pivot_count"], 0)
        self.assertEqual(sess["prereg_drift_count"], 0)
        self.assertEqual(sess["evidence_gap_claims"], 0)
        self.assertFalse(sess["multi_trial_overfit_risk"])
        self.assertEqual(res["triggers"], [])

    def test_param_churn_and_multi_trial_overfit_antigravity(self):
        lines = []
        for i in range(1, 7):
            lines.append(_ag_cmd(
                f"python -m cli.main replay run --line L1 --candidate ema@{i} "
                f"--lookback {10 + i * 2} --stop {0.01 * i:.2f} "
                "-- --symbol BTCUSDT --start 2024-01-01 --end 2024-06-30 --execution bars"
            ))
            lines.append(_ag_out(json.dumps({"outcome": "completed", "trial_id": i})))
        tx = self._write_lines("churn_ag.jsonl", lines)
        res = research_quality.analyze_research_quality([tx])
        sess = res["sessions"][0]
        self.assertTrue(sess["research_session"])
        self.assertEqual(sess["trial_count"], 6)
        self.assertEqual(sess["param_churn_ratio"], 1.0)
        self.assertTrue(sess["multi_trial_overfit_risk"])
        joined = "\n".join(res["triggers"])
        self.assertIn("research_quality:param_churn_ratio", joined)
        self.assertIn("research_quality:multi_trial_overfit", joined)

    def test_unattributed_pivots_claude_code_format(self):
        lines = [
            _claude_tool("Bash", {"command": "python -m cli.main replay run --line L1 --candidate alpha@1"}),
            _claude_result('{"outcome": "failed", "meets_targets": false}'),
            # Pivot 1 directly to beta without report/analysis
            _claude_tool("Bash", {"command": "python -m cli.main candidate new --strategy beta"}),
            _claude_tool("Bash", {"command": "python -m cli.main replay run --line L1 --candidate beta@1"}),
            _claude_result("Command exited with code 1", is_error=True),
            # Pivot 2 directly to gamma without report/analysis
            _claude_tool("Bash", {"command": "python -m cli.main replay run --line L1 --candidate gamma@1"}),
            _claude_result('{"outcome": "completed", "meets_targets": true}'),
        ]
        tx = self._write_lines("pivots_claude.jsonl", lines)
        res = research_quality.analyze_research_quality([tx])
        sess = res["sessions"][0]
        self.assertTrue(sess["research_session"])
        self.assertEqual(sess["unattributed_pivot_count"], 2)
        self.assertTrue(any("research_quality:unattributed_pivot" in t for t in res["triggers"]))

    def test_prereg_drift_codex_format_symbol_period_and_execution(self):
        lines = [
            _codex_cmd(
                "python -m cli.main registration add --line L1 --candidate trend@1 "
                "--symbol BTCUSDT --start 2024-01-01 --end 2024-06-30 --execution bars"
            ),
            _codex_out('{"registration_id": "R1"}'),
            # Drift 1: undeclared symbol ETHUSDT
            _codex_cmd(
                "python -m cli.main replay run --line L1 --candidate trend@1 --registration R1 "
                "-- --symbol ETHUSDT --start 2024-01-01 --end 2024-06-30 --execution bars"
            ),
            _codex_out('{"outcome": "completed"}'),
            # Drift 2: undeclared execution quotes
            _codex_cmd(
                "python -m cli.main replay run --line L1 --candidate trend@1 --registration R1 "
                "-- --symbol BTCUSDT --start 2024-01-01 --end 2024-06-30 --execution quotes"
            ),
            _codex_out('{"outcome": "completed"}'),
            # Drift 3: undeclared period
            _codex_cmd(
                "python -m cli.main replay run --line L1 --candidate trend@1 --registration R1 "
                "-- --symbol BTCUSDT --start 2023-01-01 --end 2024-06-30 --execution bars"
            ),
            _codex_out('{"outcome": "completed"}'),
            # New preregistration updates scope -> subsequent matching run has 0 additional drift!
            _codex_cmd(
                "python -m cli.main registration add --line L1 --candidate trend@2 "
                "--symbol ETHUSDT --start 2023-01-01 --end 2024-06-30 --execution quotes"
            ),
            _codex_cmd(
                "python -m cli.main replay run --line L1 --candidate trend@2 --registration R2 "
                "-- --symbol ETHUSDT --start 2023-01-01 --end 2024-06-30 --execution quotes"
            ),
        ]
        tx = self._write_lines("drift_codex.jsonl", lines)
        res = research_quality.analyze_research_quality([tx])
        sess = res["sessions"][0]
        self.assertEqual(sess["prereg_drift_count"], 3)
        self.assertTrue(any("research_quality:prereg_drift" in t for t in res["triggers"]))

    def test_evidence_gap_claims_without_backing_report_and_no_secret_leak(self):
        # Claude Code transcript: only candidate publish + precheck (no economic replay/report), then fabricates metrics.
        lines = [
            _claude_tool("Bash", {
                "command": "API_KEY=sk-ant-secret99999 python -m cli.main candidate publish --candidate ghost@1",
            }),
            _claude_result('{"candidate": "ghost@1"}'),
            _claude_tool("Bash", {"command": "python -m cli.main replay precheck --candidate ghost@1"}),
            _claude_result('{"stages": "ok"}'),
            _claude_text(
                "Final summary (ignoring sk-ant-secret99999): ghost@1 delivers Sharpe ratio 2.45, "
                "CAGR 62.5%, max drawdown 7.8%, win rate 66.0%, and net PnL +44.2%."
            ),
        ]
        tx = self._write_lines("gap_claude.jsonl", lines)
        res = research_quality.analyze_research_quality([tx])
        sess = res["sessions"][0]
        self.assertTrue(sess["research_session"])
        self.assertGreaterEqual(sess["evidence_gap_claims"], 4)
        self.assertTrue(any("research_quality:evidence_gap" in t for t in res["triggers"]))
        # Verify zero secret retention in output JSON.
        self.assertNotIn("sk-ant-secret99999", json.dumps(res))

    def test_codex_evidence_gap_when_replay_failed_and_no_report(self):
        lines = [
            _codex_cmd("python -m cli.main replay run --line L1 --candidate crash@1"),
            _codex_out("Command exited with code 1\nRuntimeError: boom"),
            _codex_text("Strategy crash@1 achieved Sharpe 1.75 and annual return 38.0%."),
        ]
        tx = self._write_lines("gap_codex_failed.jsonl", lines)
        res = research_quality.analyze_research_quality([tx])
        self.assertEqual(res["sessions"][0]["evidence_gap_claims"], 2)
        self.assertTrue(any("research_quality:evidence_gap" in t for t in res["triggers"]))

    def test_ledger_summary_json_detects_all_ledger_derivable_degradations(self):
        summary = self.home / "ledger_summary.json"
        summary.write_text(json.dumps({
            "line": "line-42",
            "window": "2024-01-01..2024-06-30",
            "preregistered_scope": {"symbols": ["BTCUSDT"], "execution": "bars", "window": "2024-01-01..2024-06-30"},
            "trials": [
                {"candidate": "mom@1", "hypothesis": "EMA 10/30", "params": {"fast": 10, "slow": 30},
                 "symbol": "BTCUSDT", "execution": "bars", "outcome": "completed"},
                {"candidate": "mom@2", "hypothesis": "EMA 12/32", "params": {"fast": 12, "slow": 32},
                 "symbol": "BTCUSDT", "execution": "bars", "outcome": "completed"},
                {"candidate": "mom@3", "hypothesis": "EMA 14/34", "params": {"fast": 14, "slow": 34},
                 "symbol": "BTCUSDT", "execution": "bars", "outcome": "completed"},
                {"candidate": "mom@4", "hypothesis": "EMA 16/36", "params": {"fast": 16, "slow": 36},
                 "symbol": "BTCUSDT", "execution": "bars", "outcome": "completed"},
                {"candidate": "mom@5", "hypothesis": "EMA 18/38", "params": {"fast": 18, "slow": 38},
                 "symbol": "ETHUSDT", "execution": "bars", "outcome": "failed", "analyzed": False},
                {"candidate": "carry@1", "hypothesis": "Funding carry", "params": {"cap": 2},
                 "symbol": "BTCUSDT", "execution": "bars", "outcome": "failed", "analyzed": False},
                {"candidate": "vol@1", "hypothesis": "ATR breakout", "params": {"mult": 3},
                 "symbol": "BTCUSDT", "execution": "bars", "outcome": "completed"},
            ],
        }), encoding="utf-8")

        res = friction.collect_friction(ledger_summary_paths=[summary])
        self.assertTrue(res["ledger_summaries_provided"])
        self.assertTrue(res["has_friction"])
        rq = res["research_quality"]
        ls = rq["ledger_summaries"][0]
        self.assertEqual(ls["trial_count"], 7)
        self.assertEqual(ls["unattributed_pivot_count"], 2)
        self.assertEqual(ls["prereg_drift_count"], 1)
        self.assertTrue(ls["multi_trial_overfit_risk"])
        joined = "\n".join(res["triggers"])
        self.assertIn("research_quality:unattributed_pivot", joined)
        self.assertIn("research_quality:prereg_drift", joined)
        self.assertIn("research_quality:multi_trial_overfit", joined)

        # Clean ledger summary with control comparisons and distinct hypotheses -> 0 triggers.
        clean_summary = self.home / "ledger_clean.json"
        clean_summary.write_text(json.dumps({
            "line": "line-99",
            "deflated_sharpe_checked": True,
            "preregistered_scope": {"symbols": ["BTCUSDT"], "execution": "bars", "window": "2024-01-01..2024-06-30"},
            "trials": [
                {"candidate": f"strat_{k}@1", "hypothesis": f"Distinct mechanism {name}",
                 "params": {"p": k}, "symbol": "BTCUSDT", "execution": "bars",
                 "outcome": "failed" if k == 0 else "completed", "analyzed": True}
                for k, name in enumerate(["breakout", "carry", "reversion", "regime", "micro", "basis"])
            ],
        }), encoding="utf-8")
        res_clean = friction.collect_friction(ledger_summary_paths=[clean_summary])
        self.assertFalse(res_clean["has_friction"])
        self.assertEqual(res_clean["triggers"], [])


class ResearchQualitySchedulerAndMethodologyTests(unittest.TestCase):
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
        self.commit({
            "alpha/__init__.py": "",
            "alpha/core.py": "def run(x):\n    return x + 1\n",
            ".agents/skills/research-round/SKILL.md": "# Research round\n",
            ".agents/skills/nautilus-report-analysis/SKILL.md": "# Report analysis\n",
        }, message="feat: initial tree", date="2026-09-01T00:00:00Z")

    def git(self, *args, env_extra=None):
        env = {**os.environ, **(env_extra or {})}
        return subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", self.repo, *args],
            check=True, capture_output=True, text=True, env=env,
        ).stdout.strip()

    def commit(self, files: dict[str, str], message: str = "chore: update", date: str | None = None) -> str:
        for name, text in files.items():
            (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
            (self.repo / name).write_text(text, encoding="utf-8")
        self.git("add", "-A")
        env_extra = {"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date} if date else None
        self.git("commit", "-qm", message, env_extra=env_extra)
        return self.git("rev-parse", "HEAD")

    def call_json(self, *args) -> dict:
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main([*map(str, args)])
        return json.loads(out.getvalue())

    def test_methodology_lens_present_and_uses_60_day_sla(self):
        # Verify `methodology` is registered in real lenses.md.
        self.assertIn("methodology", doctor.items())

        # Record clean code audits on 2026-11-25, plus a methodology audit 30 days prior (2026-10-26).
        rec_meth_30d = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| methodology | .agents:benchmark | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_recent = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:check | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            "docs/plans/doctor/2026-10-26-methodology.zh.md": rec_meth_30d,
            "docs/plans/doctor/2026-11-24-clean-a.zh.md": rec_recent,
            "docs/plans/doctor/2026-11-25-clean-b.zh.md": rec_recent,
        }, message="docs(doctor): audits with 30d-old methodology", date="2026-11-25T12:00:00Z")

        empty_issues = self.home / "empty_issues.json"
        empty_issues.write_text("[]", encoding="utf-8")

        plan_30d = self.call_json("advise", "--tree", "HEAD", "--issues-json", empty_issues, "--auto")
        self.assertEqual(plan_30d["lens_sla_overrides"]["methodology"], 60)
        self.assertNotIn("methodology", plan_30d["lens_sla_breaches"])
        self.assertTrue(plan_30d["stopping_checks"]["no_overdue_lens_sla"])
        self.assertEqual(plan_30d["recommended_theme"], "steady")

        # Now advance HEAD by 35 days (methodology is 65 days old, while code audits are fresh on 2026-12-30).
        self.commit({
            "docs/plans/doctor/2026-12-29-clean-c.zh.md": rec_recent,
            "docs/plans/doctor/2026-12-30-clean-d.zh.md": rec_recent,
        }, message="docs(doctor): audits with 65d-old methodology", date="2026-12-30T12:00:00Z")

        plan_65d = self.call_json("advise", "--tree", "HEAD", "--issues-json", empty_issues, "--auto")
        self.assertIn("methodology", plan_65d["lens_sla_breaches"])
        self.assertFalse(plan_65d["stopping_checks"]["no_overdue_lens_sla"])
        self.assertEqual(plan_65d["recommended_theme"], "find")
        self.assertIn("methodology", plan_65d["recommended_scope"]["items"])

    def test_research_quality_triggers_route_to_research_skills_and_respect_cooldown(self):
        # Make code objects fresh & saturated so only research_quality friction drives scheduling.
        rec_recent = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:check | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            "docs/plans/doctor/2026-11-24-clean-a.zh.md": rec_recent,
            "docs/plans/doctor/2026-11-25-clean-b.zh.md": rec_recent,
        }, message="docs(doctor): fresh code audits", date="2026-11-25T12:00:00Z")

        empty_issues = self.home / "empty_issues.json"
        empty_issues.write_text("[]", encoding="utf-8")

        # Create a degraded ledger summary (param churn + overfit).
        summary = self.home / "degraded_ledger.json"
        summary.write_text(json.dumps({
            "line": "line-7",
            "trials": [
                {"candidate": f"ema@{i}", "hypothesis": f"EMA fast={5 + i} slow={20 + i}",
                 "params": {"fast": 5 + i, "slow": 20 + i}, "outcome": "completed"}
                for i in range(1, 7)
            ],
        }), encoding="utf-8")

        # Verify `doctor.py friction --ledger-summary` CLI works end-to-end.
        fric_out = self.call_json("friction", "--ledger-summary", summary)
        self.assertTrue(fric_out["has_friction"])
        self.assertTrue(any("research_quality:param_churn_ratio" in t for t in fric_out["triggers"]))

        # Verify `doctor.py advise --ledger-summary` routes to research-round + nautilus-report-analysis.
        plan = self.call_json("advise", "--tree", "HEAD", "--issues-json", empty_issues, "--ledger-summary", summary)
        self.assertEqual(plan["recommended_theme"], "friction")
        self.assertEqual(
            plan["recommended_scope"]["objects"],
            [".agents/skills/research-round", ".agents/skills/nautilus-report-analysis"],
        )
        self.assertIn("agents", plan["recommended_scope"]["items"])
        rq_summary = plan["friction_summary"]["research_quality"]
        self.assertEqual(
            rq_summary["targets"],
            [".agents/skills/research-round", ".agents/skills/nautilus-report-analysis"],
        )
        self.assertTrue(any("research_quality:param_churn_ratio" in t for t in rq_summary["triggers"]))
        self.assertFalse(plan["friction_summary"]["in_cooldown"])

        # After a recent 0-finding friction audit on `.agents`, normal cooldown suppresses spam -> steady.
        rec_fric_zero = (
            "# Themed audit: friction\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| agents | .agents/skills/research-round:quality | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            "docs/plans/doctor/2026-11-25-fric-zero.zh.md": rec_fric_zero,
        }, message="docs(doctor): clean friction audit on research skills", date="2026-11-25T18:00:00Z")
        plan_cooled = self.call_json(
            "advise", "--tree", "HEAD", "--issues-json", empty_issues, "--ledger-summary", summary,
        )
        self.assertTrue(plan_cooled["friction_summary"]["in_cooldown"])
        self.assertEqual(plan_cooled["recommended_theme"], "steady")


if __name__ == "__main__":
    unittest.main()
