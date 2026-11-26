"""Tests for product-doctor v2 closed-loop telemetry, scheduling, anti-bloat, and stopping gates (#3785)."""

import ast
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
scheduler = _load("scheduler")
telemetry = _load("telemetry")


CLONE_A = """def compute_alpha(items, limit):
    total = 0
    seen = []
    for item in items:
        if item > 0 and item < limit:
            total += item * 2
            seen.append(item)
        elif item == limit:
            total += 1
        else:
            continue
    return total, len(seen)
"""

CLONE_B = """def evaluate_beta(records, cap):
    acc = 0
    kept = []
    for rec in records:
        if rec > 10 and rec < cap:
            acc += rec * 5
            kept.append(rec)
        elif rec == cap:
            acc += 9
        else:
            continue
    return acc, len(kept)
"""

TINY_OVERRIDE_A = '''def cancel_order(self, order):
    """Docstring must not inflate clone node count."""
    return self._cancel(order)
'''

TINY_OVERRIDE_B = '''def cancel_orders(self, orders):
    """Docstring must not inflate clone node count."""
    return self._cancel(orders)
'''

TS_COMPLEX = """export function renderGraph(nodes: Node[], flag: boolean) {
  // TODO: simplify branchy layout
  let acc = 0;
  for (const n of nodes) {
    if (n.active && (flag || n.weight > 3)) {
      if (n.children && n.children.length > 0) {
        for (const c of n.children) {
          if (c.ready ? c.score > 1 : false) {
            acc += c.score;
          }
        }
      }
    }
  }
  return acc;
}
"""

COMPLEX_BLOB = """def tangled(a, b, c, xs):
    # TODO: split this giant handler
    res = 0
    for x in xs:
        if a and b or c:
            for y in range(x):
                if y > 2:
                    try:
                        if x % 2 == 0:
                            res += y if y < 10 else tangled(a, b, c, [])
                        elif x % 3 == 0:
                            res -= 1
                        else:
                            res += 2
                    except ValueError:
                        if res < 0:
                            res = 0
    return res
"""


class TelemetryUnitTests(unittest.TestCase):
    def test_cognitive_complexity_scores_nesting_boolops_and_recursion(self):
        simple = ast.parse("def f(x):\n    return x + 1\n").body[0]
        self.assertEqual(telemetry.cognitive_complexity(simple), 0)

        # Nested BoolOp outside `if.test` must NOT be double-counted.
        bool_assign = ast.parse("def g(a, b, c):\n    return a and b or c\n").body[0]
        self.assertEqual(telemetry.cognitive_complexity(bool_assign), 2)

        # Comprehension `if` filter adds cognitive complexity.
        comp = ast.parse("def h(xs):\n    return [x for x in xs if x > 0 and x < 10]\n").body[0]
        self.assertEqual(telemetry.cognitive_complexity(comp), 2)

        nested = ast.parse(COMPLEX_BLOB).body[0]
        score = telemetry.cognitive_complexity(nested)
        self.assertGreaterEqual(score, 25)

    def test_ast_clone_ignores_tiny_overrides_and_js_ts_gets_real_health(self):
        tiny_a = telemetry.analyze_python_source(TINY_OVERRIDE_A)
        tiny_b = telemetry.analyze_python_source(TINY_OVERRIDE_B)
        self.assertEqual(tiny_a["clone_hashes"], [])
        self.assertEqual(tiny_b["clone_hashes"], [])

        a_info = telemetry.analyze_python_source(CLONE_A)
        b_info = telemetry.analyze_python_source(CLONE_B)
        self.assertTrue(a_info["clone_hashes"])
        self.assertEqual(a_info["clone_hashes"][0][0], b_info["clone_hashes"][0][0])

        ts_info = telemetry.analyze_js_ts_source(TS_COMPLEX)
        self.assertEqual(ts_info["satd"], 1)
        self.assertGreater(ts_info["max_cognitive"], 5)

        clean_health = telemetry.compute_health_score(
            lines=80, max_cognitive=6, top3_cognitive=4.0, max_fn_lines=25, duplicate_fns=0, satd=0
        )
        self.assertGreaterEqual(clean_health, 9.5)

        tangled_info = telemetry.analyze_python_source(COMPLEX_BLOB)
        self.assertEqual(tangled_info["satd"], 1)
        bad_health = telemetry.compute_health_score(
            lines=950, max_cognitive=55, top3_cognitive=35.0, max_fn_lines=200, duplicate_fns=4, satd=3
        )
        self.assertLess(bad_health, telemetry.BREAK_EVEN_HEALTH)


class ClosedLoopSchedulerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.repo, self.evidence = self.home / "repo", self.home / "evidence"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "gc.auto", "0")
        self.git("config", "maintenance.auto", "false")
        here = Path.cwd()
        self.addCleanup(os.chdir, here)
        os.chdir(self.repo)
        self.commit({
            "alpha/__init__.py": "",
            "alpha/core.py": CLONE_A,
            "beta/__init__.py": "",
            "beta/worker.py": CLONE_B,
            "cold/__init__.py": "",
            "cold/stable.py": "def ok(v):\n    return v\n",
            "tests/alpha/__init__.py": "",
            "tests/alpha/test_core.py": "def test_ok():\n    assert True\n",
            "docs/readme.md": "# Notes\n",
        }, message="feat: initial modules")

    def git(self, *args, env_extra=None):
        env = {**os.environ, **(env_extra or {})}
        return subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", self.repo, *args],
            check=True, capture_output=True, text=True, env=env,
        ).stdout.strip()

    def commit(self, files: dict[str, str], message: str = "chore: update") -> str:
        for name, text in files.items():
            (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
            (self.repo / name).write_text(text, encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", message)
        return self.git("rev-parse", "HEAD")

    def call_json(self, *args) -> dict:
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main([*map(str, args)])
        return json.loads(out.getvalue())

    def test_telemetry_detects_fix_bursts_clones_and_cross_package_coupling(self):
        for i in range(4):
            self.commit({
                "alpha/core.py": CLONE_A + f"# fix {i}\n",
                "beta/worker.py": CLONE_B + f"# sync {i}\n",
            }, message=f"fix(alpha): patch burst {i}")

        data = self.call_json("telemetry", "--tree", "HEAD", "--days", "14")
        self.assertEqual(data["objects"]["alpha"]["kind"], "code")
        self.assertEqual(data["objects"]["docs"]["kind"], "docs")
        self.assertEqual(data["objects"]["alpha"]["fixes_short"], 4)
        self.assertEqual(data["summary"]["fix_burst_file_count"], 2)
        self.assertGreaterEqual(data["summary"]["duplicate_clone_groups"], 1)
        pairs = {c["pair"]: c["cochanges"] for c in data["couplings"]}
        self.assertEqual(pairs.get("alpha+beta"), 5)  # 1 initial + 4 fix commits

    def test_advise_excludes_authority_from_harm_and_triggers_slim_on_burst(self):
        for i in range(4):
            self.commit({"alpha/core.py": CLONE_A + f"# patch {i}\n"}, message=f"fix(alpha): hotfix {i}")

        # Open authority-only issue referencing alpha/core.py must NOT hijack Stop harm.
        issues_path = self.home / "issues.json"
        issues_path.write_text(json.dumps([
            {
                "number": 101,
                "title": "alpha/core.py bypasses refusal check on empty input",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
                "updatedAt": "2020-01-01T00:00:00Z",
                "body": "See alpha/core.py:1",
                "comments": [],
            }
        ]), encoding="utf-8")

        plan = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertEqual(plan["issues_summary"]["actionable_harm"], [])
        self.assertEqual(len(plan["issues_summary"]["authority_drifted"]), 1)
        self.assertEqual(plan["recommended_theme"], "slim")
        self.assertEqual(plan["recommended_scope"]["objects"][0], "alpha")

        # Adding an unclaimed non-authority harm issue DOES select harm.
        issues_path.write_text(json.dumps([
            {
                "number": 102,
                "title": "alpha/core.py silently drops order fills",
                "labels": [{"name": "agent-finding"}],
                "updatedAt": "2026-11-26T00:00:00Z",
                "body": "See alpha/core.py:1",
                "comments": [],
            }
        ]), encoding="utf-8")
        plan_harm = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertEqual(plan_harm["recommended_theme"], "harm")
        self.assertEqual(plan_harm["issues_summary"]["actionable_harm"][0]["number"], 102)

    def test_advise_pairs_hot_and_cold_objects_then_converges_to_steady(self):
        # One non-burst commit on alpha so slim does not trigger; all code objects still unexamined.
        self.commit({"alpha/core.py": CLONE_A + "# minor\n"}, message="feat(alpha): small tweak")
        issues_path = self.home / "empty_issues.json"
        issues_path.write_text("[]", encoding="utf-8")

        plan_find = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertEqual(plan_find["recommended_theme"], "find")
        # Must pair highest-risk (alpha) with a cold unexamined object (beta or cold).
        self.assertEqual(len(plan_find["recommended_scope"]["objects"]), 2)
        self.assertEqual(plan_find["recommended_scope"]["objects"][0], "alpha")
        self.assertIn(plan_find["recommended_scope"]["objects"][1], ("beta", "cold"))

        # Now record two recent zero-finding audits covering all code objects -> STEADY gate must fire!
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        rec1 = (
            "# Themed audit: find\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:check | examined | ok |\n"
            "| results | beta:check | examined | ok |\n\n"
            "Shown: 0 of 0 probed. Shown by a refuter's own probe too: 0.\n"
        )
        rec2 = (
            "# Themed audit: find\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | cold:check | examined | ok |\n\n"
            "Shown: 0 of 0 probed. Shown by a refuter's own probe too: 0.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-audit-a.zh.md": rec1,
            f"docs/plans/doctor/{today}-audit-b.zh.md": rec2,
        }, message="docs(doctor): record clean audits")

        plan_steady = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertEqual(plan_steady["recommended_theme"], "steady")
        self.assertTrue(all(plan_steady["stopping_checks"].values()))

        # Recording a steady scope must produce a clean `Themed audit: steady` report.
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["scope", str(self.evidence), "steady", "--tree", "HEAD"])
            doctor.main(["report", str(self.evidence), "--tree", "HEAD"])
        text = out.getvalue()
        self.assertIn("# Themed audit: steady", text)
        self.assertIn("Not exercised: nothing listed.", text)
        # Steady scope must reject non-empty --objects or --items.
        with self.assertRaises(SystemExit):
            doctor.main(["scope", str(self.home / "bad-steady"), "steady", "--objects", "alpha", "--tree", "HEAD"])

    def test_v2_2_steady_anti_gaming_and_unrefuted_bugs(self):
        """P0-1 & P0-2: unrefuted bugs, 0-probe empty records, partial records, and steady records
        must never game `steady` or falsely penalize buggy objects."""
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        issues_path = self.home / "empty_issues.json"
        issues_path.write_text("[]", encoding="utf-8")

        # 1. Two audits with 10/10 and 7/7 shown defects where NO refuter ran (`Refuters ran on 0`).
        unref1 = (
            "# 2026-11-25 audit\n\n| Item | Value |\n|---|---|\n"
            "| Coverage | `# Themed audit: find` |\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:check | examined | ok |\n"
            "| results | beta:check | examined | ok |\n"
            "| results | cold:check | examined | ok |\n\n"
            "Shown: 10 of 10 probed. Shown by a refuter's own probe too: 0. Refuters ran on 0.\n"
        )
        unref2 = (
            "# 2026-11-26 audit\n\n| Item | Value |\n|---|---|\n"
            "| Coverage | `# Partial themed audit: find` |\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:check | examined | ok |\n\n"
            "Shown: 7 of 7 probed. Shown by a refuter's own probe too: 0. Refuters ran on 0.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-unref-1.zh.md": unref1,
            f"docs/plans/doctor/{today}-unref-2.zh.md": unref2,
        }, message="docs(doctor): record unrefuted bug audits")

        plan = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        # P0-2: record.md Coverage table & lowercase `Partial themed audit:` must both parse as `find`.
        self.assertEqual(plan["last_two_themes"], ["find", "find"])
        # P0-1: unrefuted bugs must NOT trigger steady or penalize alpha!
        self.assertNotEqual(plan["recommended_theme"], "steady")
        self.assertFalse(plan["stopping_checks"]["marginal_yield_saturated"])
        alpha_row = next(r for r in plan["ranked_code_objects"] if r["object"] == "alpha")
        self.assertEqual(alpha_row["saturation_penalty"], 0.0)

        # 2. Recording two `steady` audits after bug audits must NOT erase prior bugs and self-perpetuate steady!
        steady_rec = (
            "# Themed audit: steady\n\n"
            "Shown: 0 of 0 probed. Shown by a refuter's own probe too: 0. Refuters ran on 0.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-steady-1.zh.md": steady_rec,
            f"docs/plans/doctor/{today}-steady-2.zh.md": steady_rec,
        }, message="docs(doctor): record two steady audits")
        plan2 = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertNotEqual(plan2["recommended_theme"], "steady")
        self.assertFalse(plan2["stopping_checks"]["marginal_yield_saturated"])

    def test_v2_2_js_ts_urls_types_clones_and_colocated_tests(self):
        """Round 3A: JS/TS lexer ignores https:// URLs and TS ?: / ?. / ??, skips pure type files,
        detects Type-2 clones, excludes co-located *.test.ts from prod, and maps tests/subpkg/."""
        ts_urls_and_types = """export interface Config {
  host?: string;
  port?: number;
  fallback?: string;
}
export function load(cfg?: Config) {
  const url = { base: "https://example.com/path", api: "wss://stream.example.com" };
  return cfg?.host ?? cfg?.fallback ?? url.base;
}
"""
        ts_clone_1 = """export function renderAlpha(items: number[], cap: number) {
  let sum = 0;
  for (const x of items) {
    if (x > 0 && x < cap) {
      sum += x.toFixed(2).length;
    } else if (x === cap) {
      sum += 1;
    }
  }
  return sum;
}
"""
        ts_clone_2 = """export function renderBeta(rows: number[], limit: number) {
  let acc = 0;
  for (const r of rows) {
    if (r > 10 && r < limit) {
      acc += r.toFixed(4).length;
    } else if (r === limit) {
      acc += 2;
    }
  }
  return acc;
}
"""
        self.commit({
            "web/src/config.ts": ts_urls_and_types,
            "web/src/a.ts": ts_clone_1,
            "web/src/b.ts": ts_clone_2,
            "web/src/config.test.ts": ts_urls_and_types + "\n// test\n",
            "alpha/submod/helper.py": "def h():\n    return 1\n",
            "tests/submod/test_helper.py": "def test_h():\n    assert True\n",
        }, message="feat(web): add ts modules and colocated test")

        data = self.call_json("telemetry", "--tree", "HEAD", "--days", "14")
        web_key = "web/src" if "web/src" in data["objects"] else "web"
        web_obj = data["objects"][web_key]
        self.assertEqual(web_obj["kind"], "code")
        # Pure type/URL/?. file must stay healthy (no brace drift or ? inflation).
        self.assertGreaterEqual(web_obj["min_health"], 9.5)
        # Co-located config.test.ts must be counted as tests, NOT prod analyzed_files!
        self.assertEqual(web_obj["analyzed_files"], 3)
        self.assertGreater(web_obj["test_lines"], 0)
        # Type-2 JS/TS clone must be detected across a.ts and b.ts.
        self.assertGreaterEqual(data["summary"]["duplicate_clone_groups"], 1)
        # Subpackage test dir tests/submod/ must map to alpha (or alpha/submod if split).
        alpha_test_lines = sum(
            o["test_lines"] for n, o in data["objects"].items()
            if n == "alpha" or n.startswith("alpha/")
        )
        self.assertGreaterEqual(alpha_test_lines, 4)

    def test_v2_2_redteam_regressions(self):
        """P0-3, P1-2, P1-3, P1-4, P1-5, P1-6, P2-1, P2-3 regressions."""
        # P1-3: clone skeleton must preserve attribute names (start_service vs stop_service must NOT collide).
        svc_a = """def start_service(client, cfg):
    results = []
    if cfg and client.is_ready():
        client.connect(cfg)
        for item in cfg:
            results.append(client.start_stream(item))
        return client.status(), len(results)
    return None, 0
"""
        svc_b = """def stop_service(client, cfg):
    results = []
    if cfg and client.is_closed():
        client.disconnect(cfg)
        for item in cfg:
            results.append(client.flush_buffer(item))
        return client.exit_code(), len(results)
    return None, 0
"""
        info_a = telemetry.analyze_python_source(svc_a)
        info_b = telemetry.analyze_python_source(svc_b)
        self.assertTrue(info_a["clone_hashes"] and info_b["clone_hashes"])
        self.assertNotEqual(info_a["clone_hashes"][0][0], info_b["clone_hashes"][0][0])

        # P0-3: commit-time anchored window on historical backdated commits.
        old_env = {"GIT_AUTHOR_DATE": "2024-06-15T12:00:00Z", "GIT_COMMITTER_DATE": "2024-06-15T12:00:00Z"}
        (self.repo / "alpha" / "special file%.py").write_text("def sp():\n    return 1\n", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", 'Revert "fix(alpha): bad patch"', env_extra=old_env)
        rev_old = self.git("rev-parse", "HEAD")
        # P1-4 & P1-5: special filename with space and `%` AND Revert commit must be captured at `rev_old`.
        data_old = self.call_json("telemetry", "--tree", rev_old, "--days", "14", "--long-days", "30")
        self.assertGreaterEqual(data_old["objects"]["alpha"]["reverts_short"], 1)
        self.assertGreaterEqual(data_old["objects"]["alpha"]["analyzed_files"], 2)

        # P1-6: malformed issues JSON raises clean SystemExit; stale claim >= 2d re-enters actionable_harm;
        # older comment must NOT override newer updatedAt.
        bad_json = self.home / "bad.json"
        bad_json.write_text("{}", encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.call_json("advise", "--tree", "HEAD", "--issues-json", bad_json)

        issues_edge = self.home / "edge_issues.json"
        issues_edge.write_text(json.dumps([
            {
                "number": 501,
                "title": "alpha/core.py skips check on startup",
                "labels": [{"name": "agent-finding"}, {"name": "claimed"}],
                "updatedAt": "2020-01-01T00:00:00Z",
                "body": "Causes phantom position and money loss in live trading.",
                "comments": [],
            },
            {
                "number": 502,
                "title": "docs/readme.md spells live order example with extra space",
                "labels": [{"name": "agent-finding"}],
                "updatedAt": "2026-11-26T00:00:00Z",
                "body": "Typo in docs/readme.md only.",
                "comments": [],
            },
        ]), encoding="utf-8")
        plan_edge = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_edge)
        actionable_nums = [i["number"] for i in plan_edge["issues_summary"]["actionable_harm"]]
        self.assertIn(501, actionable_nums)
        self.assertNotIn(502, actionable_nums)

        # P2-3: PEP 526 AnnAssign in tests/test_package_layers.py must be parsed.
        self.commit({
            "tests/test_package_layers.py": 'ISOLATED: frozenset[str] = frozenset({"ide"})\nRANK: dict[str, int] = {"deploy": 0}\n',
        }, message="test: annassign layers")
        data_ann = self.call_json("telemetry", "--tree", "HEAD")
        self.assertEqual(data_ann["summary"]["isolated_roots"], ["deploy", "ide"])

    def test_v2_3_per_object_slim_cooldown_and_post_audit_freshness(self):
        """Round 4: once a bursting object is slimmed with no new fixes, it enters per-object slim
        cooldown; once all code objects are examined after their latest commit, `advise` converges to steady."""
        for i in range(4):
            self.commit({"alpha/core.py": CLONE_A + f"# burst {i}\n"}, message=f"fix(alpha): burst {i}")
        issues_path = self.home / "empty_issues.json"
        issues_path.write_text("[]", encoding="utf-8")

        # Before slimming: alpha triggers `slim`.
        p1 = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertEqual(p1["recommended_theme"], "slim")
        self.assertEqual(p1["recommended_scope"]["objects"], ["alpha"])

        # Record complete slim audit on alpha + find audit on beta & cold on the same day.
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        rec_slim = (
            "# Themed audit: slim\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| size | alpha:check | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_find = (
            "# Themed audit: find\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | beta:check | examined | ok |\n"
            "| results | cold:check | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-slim-alpha.zh.md": rec_slim,
            f"docs/plans/doctor/{today}-find-rest.zh.md": rec_find,
        }, message="docs(doctor): record slim on alpha and find on beta/cold")

        # Now alpha is in per-object slim cooldown, all objects are fresh -> must converge cleanly to `steady`!
        p2 = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertIn("alpha", p2["slim_cooled_objects"])
        self.assertEqual(p2["slim_total_count"], 0)
        self.assertEqual(p2["recommended_theme"], "steady")
        alpha_rank = next(r for r in p2["ranked_code_objects"] if r["object"] == "alpha")
        self.assertTrue(alpha_rank["unchanged_since_examined"])
        self.assertEqual(alpha_rank["risk_prior"], 0.0)

        # Landing a NEW fix commit 2 days later (still within 14d burst window & 21d SLA) wakes alpha right back up!
        from datetime import UTC, datetime, timedelta
        next_dt = (datetime.fromisoformat(f"{today}T12:00:00+00:00") + timedelta(days=2)).astimezone(UTC)
        next_iso = next_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        (self.repo / "alpha" / "core.py").write_text(CLONE_A + "# fresh fix after slim\n", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", "fix(alpha): regression after slim",
                 env_extra={"GIT_AUTHOR_DATE": next_iso, "GIT_COMMITTER_DATE": next_iso})
        p3 = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path)
        self.assertNotIn("alpha", p3["slim_cooled_objects"])
        self.assertEqual(p3["recommended_theme"], "slim")

    def test_v2_1_folded_tests_boundary_clones_and_report_folding(self):
        # Add package layer isolation boundary + isolated `ide` copy of CLONE_A + folded test dir.
        self.commit({
            "tests/test_package_layers.py": 'RANK = {"deploy": 0, "alpha": 1}\nISOLATED = frozenset({"ide"})\n',
            "ide/server.py": CLONE_A,
            "tests/cold/test_stable.py": "def test_cold():\n    assert True\n",
        }, message="feat: add isolated ide copy and folded cold test")

        data = self.call_json("telemetry", "--tree", "HEAD", "--days", "14")
        # `cold` tests must be counted even when tests/cold is tiny/folded.
        self.assertGreater(data["objects"]["cold"]["test_lines"], 0)
        self.assertIsNotNone(data["objects"]["cold"]["test_to_prod_ratio"])
        # Cross-isolation clone involving `ide` is separated into `boundary_clones`.
        self.assertGreaterEqual(data["summary"]["boundary_isolation_clones"], 1)
        # Docs object has no analyzed source files -> min_health must be None, not fake 10.0.
        self.assertIsNone(data["objects"]["docs"]["min_health"])

        # Verify `run` records `output_file` and `report` truncates long commands while keeping failed visible.
        ev = self.home / "ev-fold"
        long_script = "print('" + "x" * 160 + "')"
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["run", str(ev), "results", "alpha:check", "--", "python3", "-c", "print('oops'); raise SystemExit(1)"])
            doctor.main(["run", str(ev), "results", "alpha:check", "--", "python3", "-c", long_script])
        rows = doctor.rows(ev)
        self.assertTrue(Path(rows[-1]["output_file"]).is_file())
        rep = io.StringIO()
        with redirect_stdout(rep):
            doctor.main(["report", str(ev), "--tree", "HEAD"])
        rep_text = rep.getvalue()
        self.assertIn("| results | alpha:check | failed |", rep_text)
        self.assertIn("| results | alpha:check | examined |", rep_text)
        self.assertIn("...` exit 0", rep_text)

    def test_v2_4_friction_ci_and_transcript_signals(self):
        """Round 5: CI workflow grouping (`workflowName`), nearest-rank p90, wait growth, and privacy-safe
        Antigravity + Claude Code transcript telemetry."""
        ci_runs = [
            # Custom per-PR `name` must group by `workflowName`, and 2 runs must satisfy p90 >= median.
            {"workflowName": "quality", "name": "PR #1", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-20T00:00:00Z", "updatedAt": "2026-11-20T00:10:00Z"},
            {"workflowName": "quality", "name": "PR #2", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-21T00:00:00Z", "updatedAt": "2026-11-21T00:10:00Z"},
            {"workflowName": "quality", "name": "PR #3", "status": "completed", "conclusion": "failure",
             "createdAt": "2026-11-22T00:00:00Z", "updatedAt": "2026-11-22T00:10:00Z"},
            {"workflowName": "quality", "name": "PR #4", "status": "completed", "conclusion": "failure",
             "createdAt": "2026-11-23T00:00:00Z", "updatedAt": "2026-11-23T00:22:00Z"},
            {"workflowName": "quality", "name": "PR #5", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-24T00:00:00Z", "updatedAt": "2026-11-24T00:24:00Z"},
            {"workflowName": "quality", "name": "PR #6", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-25T00:00:00Z", "updatedAt": "2026-11-25T00:26:00Z"},
            {"workflowName": "fast", "name": "Push 1", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-24T00:00:00Z", "updatedAt": "2026-11-24T00:02:00Z"},
            {"workflowName": "fast", "name": "Push 2", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-25T00:00:00Z", "updatedAt": "2026-11-25T00:04:00Z"},
        ]
        ci = friction.analyze_ci_runs(ci_runs)
        self.assertIn("quality", ci["workflows"])
        self.assertNotIn("PR #1", ci["workflows"])
        self.assertGreaterEqual(ci["workflows"]["fast"]["p90_minutes"], ci["workflows"]["fast"]["median_minutes"])
        q = ci["workflows"]["quality"]
        self.assertGreaterEqual(q["failure_rate"], 0.33)
        self.assertGreaterEqual(q["p90_minutes"], 24.0)
        self.assertGreater(q["wait_growth_pct"], 100.0)
        self.assertTrue(any("ci_failure_rate" in t for t in ci["triggers"]))
        self.assertTrue(any("ci_long_wait" in t for t in ci["triggers"]))
        self.assertTrue(any("ci_wait_growth" in t for t in ci["triggers"]))

        # Privacy-safe Antigravity + Claude Code transcripts.
        ag_tx = self.home / "ag.jsonl"
        ag_lines = [
            json.dumps({"type": "USER_INPUT", "created_at": "2026-11-25T10:00:00Z", "content": "SECRET_USER_PROMPT_XYZ"}),
            json.dumps({"type": "PLANNER_RESPONSE", "created_at": "2026-11-25T10:01:00Z", "tool_calls": [
                {"name": "read_file", "args": {"Path": '"/repo/.agents/skills/product-doctor/SKILL.md"'}},
            ]}),
        ]
        for i in range(4):
            ag_lines.append(json.dumps({"type": "PLANNER_RESPONSE", "created_at": f"2026-11-25T10:0{i+2}:00Z", "tool_calls": [
                {"name": "run_command", "args": {"toolSummary": '"Retry broken build"'}},
            ]}))
            ag_lines.append(json.dumps({"type": "GENERIC", "status": "DONE", "content": "Command exited with code 127.\n"}))
        ag_tx.write_text("\n".join(ag_lines) + "\n", encoding="utf-8")

        cc_tx = self.home / "cc.jsonl"
        cc_lines = [
            json.dumps({"role": "user", "timestamp": "2026-11-25T11:00:00Z", "content": "hello"}),
            json.dumps({"timestamp": "2026-11-25T11:01:00Z", "message": {"content": [
                {"type": "tool_use", "name": "Skill", "input": {"skill": "research-round"}},
            ]}}),
        ]
        cc_lines.extend(
            json.dumps({"timestamp": f"2026-11-25T11:{i + 2:02d}:00Z", "message": {"content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "pytest"}},
                {"type": "tool_result", "is_error": True},
            ]}})
            for i in range(10)
        )
        cc_tx.write_text("\n".join(cc_lines) + "\n", encoding="utf-8")

        tx = friction.analyze_transcripts([ag_tx, cc_tx])
        self.assertNotIn("SECRET_USER_PROMPT_XYZ", json.dumps(tx))
        self.assertEqual(tx["sessions"][0]["skills_loaded"], ["product-doctor"])
        self.assertEqual(tx["sessions"][0]["tool_errors"], 4)
        self.assertEqual(tx["sessions"][1]["skills_loaded"], ["research-round"])
        self.assertTrue(any("agent_tool_error_rate" in t for t in tx["triggers"]))
        self.assertTrue(any("agent_repeated_action" in t for t in tx["triggers"]))

    def test_v2_4_advise_friction_routing_cooldown_and_low_yield_lenses(self):
        """Round 5: `advise` schedules `friction` when harm & slim are clear, yields to SLA breaches
        during cooldown, blocks `steady` when friction triggers hold, and surfaces `low_yield_lenses`."""
        issues_path = self.home / "empty_issues.json"
        issues_path.write_text("[]", encoding="utf-8")
        ci_path = self.home / "bad_ci.json"
        ci_path.write_text(json.dumps([
            {"workflowName": "quality", "status": "completed", "conclusion": "failure",
             "createdAt": f"2026-11-2{i}T00:00:00Z", "updatedAt": f"2026-11-2{i}T00:25:00Z"}
            for i in range(1, 6)
        ]), encoding="utf-8")

        # 0 harm, 0 slim, bad CI -> `advise` picks `friction` targeting `delivery`!
        p1 = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path, "--ci-json", ci_path)
        self.assertEqual(p1["recommended_theme"], "friction")
        self.assertFalse(p1["stopping_checks"]["no_friction_triggers"])
        self.assertEqual(p1["recommended_scope"]["items"], ["delivery"])

        # After 2 consecutive zero-yield `friction` audits (with `delivery` run twice with 0 shown),
        # `friction` enters cooldown while SLA breaches remain, AND `delivery` shows up in `low_yield_lenses`!
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        rec = (
            "# Themed audit: friction\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| delivery | alpha:ci | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-friction-1.zh.md": rec,
            f"docs/plans/doctor/{today}-friction-2.zh.md": rec,
        }, message="docs(doctor): two zero-yield friction audits")
        p2 = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path, "--ci-json", ci_path)
        self.assertEqual(p2["recommended_theme"], "find")
        low_items = {row["item"]: row["zero_yield_streak"] for row in p2["low_yield_lenses"]}
        self.assertGreaterEqual(low_items.get("delivery", 0), 2)

    def test_v2_4_delta_pareto_gate_and_tangled_refactor_risk(self):
        """Round 5: `doctor.py delta` classifies improved / moved_only / regressed and flags Refactoring Runaway."""
        base = self.git("rev-parse", "HEAD")

        # 1) Pure move of a >20-line module -> `moved_only` (not `improved`, and not false `regressed`).
        big_fn = "def helper(x):\n" + "".join(f"    x += {i}\n" for i in range(25)) + "    return x\n"
        self.commit({"alpha/mod_a.py": big_fn}, message="feat(alpha): add mod_a")
        pre_move = self.git("rev-parse", "HEAD")
        (self.repo / "alpha" / "mod_a.py").unlink()
        (self.repo / "alpha" / "mod_b.py").write_text(big_fn, encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", "refactor(alpha): move mod_a to mod_b")
        post_move = self.git("rev-parse", "HEAD")
        d_move = self.call_json("delta", pre_move, post_move)
        self.assertEqual(d_move["pareto_verdict"], "moved_only")
        self.assertEqual(d_move["new_break_even_regressions"], [])

        # 2) Genuine deletion/simplification -> `improved`.
        (self.repo / "alpha" / "mod_b.py").write_text("def helper(x):\n    return x + 300\n", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", "refactor(alpha): fold arithmetic loop")
        post_slim = self.git("rev-parse", "HEAD")
        d_imp = self.call_json("delta", post_move, post_slim)
        self.assertEqual(d_imp["pareto_verdict"], "improved")
        self.assertLess(d_imp["prod_lines"]["net"], 0)

        # 3) Deeply nested logic spike -> `regressed` with break-even entry.
        ugly = (
            "def tangle(xs):\n    out = 0\n    for a in xs:\n        if a > 0:\n"
            "            for b in xs:\n                if b > 0 and b < a:\n"
            "                    for c in xs:\n                        if c == a or c == b:\n"
            "                            if c % 2 == 0:\n                                out += c\n"
            "                            elif c % 3 == 0:\n                                out -= c\n"
            "    return out\n"
        )
        self.commit({"alpha/mod_b.py": ugly * 3}, message="fix(alpha): pile nested conditionals")
        post_reg = self.git("rev-parse", "HEAD")
        d_reg = self.call_json("delta", post_slim, post_reg)
        self.assertEqual(d_reg["pareto_verdict"], "regressed")
        self.assertGreaterEqual(d_reg["max_cognitive"]["delta"], 5)

        # 4) Refactoring Runaway: a `fix(...)` commit churning >=300 lines across >=6 prod files & >=3 packages.
        pre_tangle = self.git("rev-parse", "HEAD")
        filler = "\n".join(f"V_{i} = {i}" for i in range(60)) + "\n"
        self.commit({
            "alpha/t1.py": filler, "alpha/t2.py": filler,
            "beta/t3.py": filler, "beta/t4.py": filler,
            "cold/t5.py": filler, "cold/t6.py": filler,
        }, message="fix(alpha): sprawling tangled rewrite")
        post_tangle = self.git("rev-parse", "HEAD")
        d_tangle = self.call_json("delta", pre_tangle, post_tangle)
        self.assertTrue(d_tangle["tangled_refactor_risk"])
        self.assertGreaterEqual(d_tangle["touched_prod_files"], 6)
        self.assertNotEqual(base, post_tangle)

    def test_v2_4_scope_contracts_and_run_tree_drift(self):
        """Round 5: `scope --contracts A+B` is enforced by `report`, and `run --tree` logs `tree_drift`."""
        ev = self.home / "ev-contracts"
        with self.assertRaises(SystemExit):
            doctor.main(["scope", str(ev), "steady", "--contracts", "alpha+beta", "--tree", "HEAD"])
        doctor.main(["scope", str(ev), "find", "--objects", "alpha,beta",
                     "--items", "results", "--contracts", "alpha+beta", "--tree", "HEAD"])

        # Run only alpha -> `alpha+beta (contract)` must still appear in Not exercised!
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["run", str(ev), "results", "alpha:unit", "--tree", "HEAD", "--", "python3", "-c", "print('ok')"])
        self.assertFalse(doctor.rows(ev)[-1]["tree_drift"])

        rep1 = io.StringIO()
        with redirect_stdout(rep1):
            doctor.main(["report", str(ev), "--tree", "HEAD"])
        self.assertIn("alpha+beta (contract)", rep1.getvalue())

        # Modify alpha/core.py in a new commit and probe against parent rev -> `tree_drift: True`,
        # and name both alpha and beta in `alpha+beta:pipe` to satisfy the contract!
        prev_rev = self.git("rev-parse", "HEAD")
        self.commit({"alpha/core.py": CLONE_A + "# drift\n"}, message="feat(alpha): drift")
        with redirect_stdout(out):
            doctor.main(["run", str(ev), "results", "alpha+beta:pipe", "--tree", prev_rev,
                         "--", "python3", "-c", "print('both')"])
        self.assertTrue(doctor.rows(ev)[-1]["tree_drift"])

        rep2 = io.StringIO()
        with redirect_stdout(rep2):
            doctor.main(["report", str(ev), "--tree", prev_rev])
        self.assertNotIn("alpha+beta (contract)", rep2.getvalue())

        # Uncommitted working-tree edit to alpha/core.py must ALSO trigger `tree_drift: True` against HEAD
        # and render `[tree_drift]` in `report`.
        (self.repo / "alpha" / "core.py").write_text(CLONE_A + "# dirty\n", encoding="utf-8")
        with redirect_stdout(out):
            doctor.main(["run", str(ev), "results", "alpha:dirty-check", "--tree", "HEAD",
                         "--", "python3", "-c", "print('dirty')"])
        self.assertTrue(doctor.rows(ev)[-1]["tree_drift"])
        rep3 = io.StringIO()
        with redirect_stdout(rep3):
            doctor.main(["report", str(ev), "--tree", "HEAD"])
        self.assertIn("[tree_drift]", rep3.getvalue())

    def test_v2_5_recheck_cross_language_js_ts_and_error_vs_fail(self):
        """Round 6: `recheck` verifies JS/TS `node:test` repairs (confirmed + regressed) and treats
        import/load errors in `reverted` as `error` -> `undecided` (never false `fail` -> `confirmed`)."""
        import shutil
        if not shutil.which("node"):
            self.skipTest("node is required for cross-language recheck tests")

        ev = self.home / "ev-recheck-js"

        # 1) ESM `.mjs` repair: confirmed while held, regressed after a breaking commit.
        self.commit({"alpha/calc.mjs": "export const add = (a, b) => a - b;\n"}, message="feat(alpha): buggy add")
        repair_mjs = self.commit({
            "alpha/calc.mjs": "export const add = (a, b) => a + b;\n",
            "alpha/calc.test.mjs": (
                'import assert from "node:assert/strict";\n'
                'import { test } from "node:test";\n'
                'import { add } from "./calc.mjs";\n'
                'test("adds two numbers", () => { assert.equal(add(2, 3), 5); });\n'
            ),
        }, message="fix(alpha): fix add operator")
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["recheck", str(ev), repair_mjs, "--tree", "HEAD"])
        r1 = doctor.rows(ev)[-1]
        self.assertEqual(r1["verdict"], "confirmed")
        self.assertEqual(r1["js_tests"], ["alpha/calc.test.mjs"])
        self.assertEqual(r1["outcomes"]["reverted"]["fail"], 1)

        # Break it later -> `regressed`.
        self.commit({"alpha/calc.mjs": "export const add = (a, b) => a * b;\n"}, message="fix(alpha): accidentally break add")
        with redirect_stdout(out):
            doctor.main(["recheck", str(ev), repair_mjs, "--tree", "HEAD"])
        r2 = doctor.rows(ev)[-1]
        self.assertEqual(r2["verdict"], "regressed")

        # 2) TypeScript `.ts` repair introducing a NEW export: reverted tree throws SyntaxError (import error),
        # which MUST be classified as `error` -> `undecided` with sanitized `why`, NOT false `confirmed`.
        self.commit({"alpha/helper.ts": "export function existing(x: number): number { return x; }\n"},
                    message="feat(alpha): add helper.ts")
        repair_ts = self.commit({
            "alpha/helper.ts": (
                "export function existing(x: number): number { return x; }\n"
                "export function added(x: number): number { return x + 1; }\n"
            ),
            "alpha/helper.test.ts": (
                'import assert from "node:assert/strict";\n'
                'import { test } from "node:test";\n'
                'import { added } from "./helper.ts";\n'
                'test("calls new export", () => { assert.equal(added(1), 2); });\n'
            ),
        }, message="fix(alpha): add helper export")
        with redirect_stdout(out):
            doctor.main(["recheck", str(ev), repair_ts, "--tree", "HEAD"])
        r3 = doctor.rows(ev)[-1]
        self.assertEqual(r3["verdict"], "undecided")
        self.assertEqual(r3["outcomes"]["fixed"]["ok"], 1)
        self.assertEqual(r3["outcomes"]["reverted"]["fail"], 0)
        self.assertEqual(r3["outcomes"]["reverted"]["error"], 1)
        self.assertIn("added", r3["outcomes"]["reverted"].get("why", ""))

    def test_v2_6_combined_slim_friction_cooldown_prevents_find_starvation(self):
        """Round 7: alternating `slim` and `friction` cannot starve `find` while SLA breaches remain,
        and a zero-yield `friction` audit enters 7-day per-object cooldown instead of ping-ponging."""
        for i in range(4):
            self.commit({"alpha/core.py": CLONE_A + f"# burst {i}\n"}, message=f"fix(alpha): burst {i}")
        issues_path = self.home / "empty_issues.json"
        issues_path.write_text("[]", encoding="utf-8")
        ci_path = self.home / "bad_ci.json"
        ci_path.write_text(json.dumps([
            {"workflowName": "quality", "status": "completed", "conclusion": "failure",
             "createdAt": f"2026-11-2{i}T00:00:00Z", "updatedAt": f"2026-11-2{i}T00:25:00Z"}
            for i in range(1, 6)
        ]), encoding="utf-8")

        today = self.git("show", "-s", "--format=%cs", "HEAD")
        rec_slim = (
            "# Themed audit: slim\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| size | beta:check | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_fric = (
            "# Themed audit: friction\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| delivery | alpha:ci | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-1-slim.zh.md": rec_slim,
            f"docs/plans/doctor/{today}-2-friction.zh.md": rec_fric,
        }, message="docs(doctor): slim then friction while cold remains unexamined")

        # Both `alpha` (still bursting!) and CI friction are active, yet `last_two_themes` is `["slim", "friction"]`
        # while `cold` breaches SLA -> MUST yield to `find` instead of starving cold coverage!
        plan = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_path, "--ci-json", ci_path)
        self.assertEqual(plan["recommended_theme"], "find")
        self.assertIn("cold", plan["recommended_scope"]["objects"])

    def test_v2_7_friction_excludes_cancelled_and_redacts_secrets(self):
        """Round 8 (H8.1): cancelled/skipped/neutral CI runs must not dilute failure_rate or durations,
        and transcript toolSummary strings must scrub credentials before emitting triggers."""
        ci_runs = [
            {"workflowName": "quality", "status": "completed", "conclusion": "cancelled",
             "createdAt": f"2026-11-2{i}T00:00:00Z", "updatedAt": f"2026-11-2{i}T00:00:10Z"}
            for i in range(5)
        ] + [
            {"workflowName": "quality", "status": "completed", "conclusion": "skipped",
             "createdAt": "2026-11-25T00:00:00Z", "updatedAt": "2026-11-25T00:00:02Z"},
            {"workflowName": "quality", "status": "completed", "conclusion": "neutral",
             "createdAt": "2026-11-25T01:00:00Z", "updatedAt": "2026-11-25T01:00:03Z"},
            {"workflowName": "quality", "status": "completed", "conclusion": "failure",
             "createdAt": "2026-11-26T00:00:00Z", "updatedAt": "2026-11-26T00:25:00Z"},
            {"workflowName": "quality", "status": "completed", "conclusion": "failure",
             "createdAt": "2026-11-26T01:00:00Z", "updatedAt": "2026-11-26T01:25:00Z"},
            {"workflowName": "quality", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-26T02:00:00Z", "updatedAt": "2026-11-26T02:20:00Z"},
            {"workflowName": "quality", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-26T03:00:00Z", "updatedAt": "2026-11-26T03:20:00Z"},
        ]
        ci = friction.analyze_ci_runs(ci_runs)
        q = ci["workflows"]["quality"]
        self.assertEqual(q["runs"], 4)
        self.assertEqual(q["failures"], 2)
        self.assertEqual(q["cancelled"], 5)
        self.assertEqual(q["failure_rate"], 0.5)
        self.assertEqual(q["median_minutes"], 22.5)
        self.assertEqual(q["p90_minutes"], 25.0)
        self.assertTrue(any("ci_failure_rate" in t for t in ci["triggers"]))
        self.assertTrue(any("ci_long_wait" in t for t in ci["triggers"]))

        tx_path = self.home / "secret_tx.jsonl"
        tx_rows = [
            json.dumps({"type": "PLANNER_RESPONSE", "created_at": f"2026-11-26T00:0{i}:00Z", "tool_calls": [
                {"name": "run_command", "args": {
                    "toolSummary": '"curl https://u:pass99@x.io -H Authorization: Bearer eyJhbGciOi.secret123 sk-ant-api03-SECRET999 token=ghp_abc1234567890"'
                }},
            ]})
            for i in range(4)
        ] + [
            json.dumps({"type": "PLANNER_RESPONSE", "created_at": f"2026-11-26T01:0{i}:00Z", "tool_calls": [
                {"name": "run_command", "args": {"toolSummary": '"Count token usage"'}},
            ]})
            for i in range(4)
        ]
        tx_path.write_text("\n".join(tx_rows) + "\n", encoding="utf-8")
        tx = friction.analyze_transcripts([tx_path])
        dumped = json.dumps(tx)
        for leak in ("pass99", "eyJhbGciOi", "secret123", "SECRET999", "ghp_abc1234567890"):
            self.assertNotIn(leak, dumped)
        self.assertIn("<REDACTED>", dumped)
        self.assertIn("Count token usage", dumped)
        for act in tx["sessions"][0]["repeated_actions"]:
            self.assertLessEqual(len(act["action"]), friction.MAX_SUMMARY_LEN)

    def test_v2_7_delta_docs_bypass_self_contract_and_js_nested_subtests(self):
        """Round 8 (H8.2 & H8.3): docs/chore commit cannot bypass tangled_refactor_risk, self-contract
        A+A is rejected by scope, and Node node:test nested subtests do not record spurious parent error."""
        import shutil

        # H8.2: fix(...) + docs: must still trigger tangled_refactor_risk; explicit refactor: clears it.
        base = self.git("rev-parse", "HEAD")
        filler = "\n".join(f"V_{i} = {i}" for i in range(60)) + "\n"
        self.commit({
            "alpha/t1.py": filler, "alpha/t2.py": filler,
            "beta/t3.py": filler, "beta/t4.py": filler,
            "cold/t5.py": filler, "cold/t6.py": filler,
        }, message="fix(alpha): sprawling tangled rewrite")
        after_docs = self.commit({"docs/readme.md": "# Updated\n"}, message="docs: update readme")
        d_bypass = self.call_json("delta", base, after_docs)
        self.assertTrue(d_bypass["tangled_refactor_risk"])

        after_ref = self.commit({"cold/stable.py": "def ok(v):\n    return v + 0\n"}, message="refactor(cold): cleanup")
        d_explicit = self.call_json("delta", base, after_ref)
        self.assertFalse(d_explicit["tangled_refactor_risk"])

        # H8.3b: self-contract A+A must be rejected.
        with self.assertRaises(SystemExit):
            doctor.main([
                "scope", str(self.home / "ev-self-contract"), "find",
                "--objects", "alpha", "--items", "results", "--contracts", "alpha+alpha", "--tree", "HEAD",
            ])

        # H8.3a: Node node:test nested subtest failure records only child fail, zero parent error.
        if shutil.which("node"):
            self.commit({"alpha/math.mjs": "export const dbl = (x) => x + 1;\n"}, message="feat(alpha): buggy dbl")
            repair_nested = self.commit({
                "alpha/math.mjs": "export const dbl = (x) => x * 2;\n",
                "alpha/math.test.mjs": (
                    'import assert from "node:assert/strict";\n'
                    'import { test } from "node:test";\n'
                    'import { dbl } from "./math.mjs";\n'
                    'test("dbl suite", async (t) => {\n'
                    '  await t.test("zero", () => { assert.equal(dbl(0), 0); });\n'
                    '  await t.test("nonzero", () => { assert.equal(dbl(3), 6); });\n'
                    '});\n'
                ),
            }, message="fix(alpha): fix dbl")
            ev_nested = self.home / "ev-recheck-nested"
            out = io.StringIO()
            with redirect_stdout(out):
                doctor.main(["recheck", str(ev_nested), repair_nested, "--tree", "HEAD"])
            row = doctor.rows(ev_nested)[-1]
            self.assertEqual(row["verdict"], "confirmed")
            self.assertEqual(row["outcomes"]["reverted"]["error"], 0)
            self.assertEqual(row["outcomes"]["reverted"]["fail"], 2)

    def test_v2_9_round10_redteam_codex_env_secrets_traversal_closed_and_friction_steady(self):
        """Round 10 (H10.1–H10.5): ENV_VAR secret redaction, Codex rollout JSONL parsing, probe id path
        traversal rejection, CLOSED issue filtering, and cooled-friction steady wait."""
        # H10.1: underscore-prefixed env var secrets must be redacted.
        for sample, leak in (
            ("Run BINANCE_API_SECRET=supersecret999 uv run", "supersecret999"),
            ("OPENAI_API_KEY=customkey987654321 python run.py", "customkey987654321"),
            ("export DB_PASSWORD=my_db_pass_123", "my_db_pass_123"),
        ):
            sanitized = friction._sanitize_summary(sample)
            self.assertNotIn(leak, sanitized)
            self.assertIn("<REDACTED>", sanitized)

        # H10.2: Codex rollout JSONL (`{timestamp, type, payload}`) extracts turns, calls, errors & skills safely.
        codex_tx = self.home / "rollout-codex.jsonl"
        codex_tx.write_text("\n".join(json.dumps(r) for r in [
            {"timestamp": "2026-11-26T10:00:00Z", "type": "response_item",
             "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "SECRET_CODEX_PROMPT"}]}},
            {"timestamp": "2026-11-26T10:01:00Z", "type": "response_item",
             "payload": {"type": "function_call", "name": "exec_command",
                         "arguments": json.dumps({"cmd": "cat .agents/skills/product-doctor/SKILL.md"})}},
            {"timestamp": "2026-11-26T10:01:05Z", "type": "response_item",
             "payload": {"type": "function_call_output", "output": "Process exited with code 0\nok"}},
            {"timestamp": "2026-11-26T10:02:00Z", "type": "response_item",
             "payload": {"type": "custom_tool_call", "name": "shell", "input": json.dumps({"cmd": "pytest"})}},
            {"timestamp": "2026-11-26T10:02:05Z", "type": "response_item",
             "payload": {"type": "custom_tool_call_output", "output": "Process exited with code 1\nFAILED"}},
        ]) + "\n", encoding="utf-8")
        tx = friction.analyze_transcripts([codex_tx])
        self.assertNotIn("SECRET_CODEX_PROMPT", json.dumps(tx))
        s0 = tx["sessions"][0]
        self.assertEqual((s0["user_turns"], s0["tool_calls"], s0["tool_errors"]), (1, 2, 1))
        self.assertEqual(s0["skills_loaded"], ["product-doctor"])

        # H10.3: probe id path traversal must raise SystemExit without writing outside evidence dir.
        probe_f = self.home / "p.py"
        probe_f.write_text("def probe(): return 1, 2\ndef control(): return 3, 3\n", encoding="utf-8")
        for bad_id in ("../escaped", "sub/id", "..", "a\\b"):
            with self.assertRaises(SystemExit):
                doctor.main(["probe", str(self.evidence), bad_id, str(probe_f), "--tree", "HEAD"])
        self.assertFalse((self.home / "escaped.py").exists())

        # H10.4 & H10.5: CLOSED harm issues are ignored; once all code objects are fresh/unchanged and
        # persistent CI friction is in 7d zero-yield cooldown, advise enters `steady` instead of busy-looping `find`.
        self.commit({".github/workflows/ci.yml": "name: quality\n"}, message="ci: add workflow")
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        rec_find = (
            "# Themed audit: find\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:check | examined | ok |\n"
            "| results | beta:check | examined | ok |\n"
            "| results | cold:check | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_fric = (
            "# Themed audit: friction\n\n"
            "| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| delivery | .github:ci | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-1-find.zh.md": rec_find,
            f"docs/plans/doctor/{today}-2-friction.zh.md": rec_fric,
        }, message="docs(doctor): cover all code objects and zero-yield friction")

        issues_closed = self.home / "closed.json"
        issues_closed.write_text(json.dumps([{
            "number": 901, "state": "CLOSED", "title": "alpha/core.py silently drops order fills",
            "labels": [{"name": "agent-finding"}], "updatedAt": f"{today}T00:00:00Z", "body": "alpha/core.py:1",
        }]), encoding="utf-8")
        ci_path = self.home / "slow_ci.json"
        ci_path.write_text(json.dumps([
            {"workflowName": "quality", "status": "completed", "conclusion": "failure",
             "createdAt": f"2026-11-2{i}T00:00:00Z", "updatedAt": f"2026-11-2{i}T00:25:00Z"}
            for i in range(1, 6)
        ]), encoding="utf-8")

        plan = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_closed, "--ci-json", ci_path)
        self.assertEqual(plan["issues_summary"]["actionable_harm"], [])
        self.assertTrue(plan["friction_summary"]["in_cooldown"])
        self.assertFalse(plan["stopping_checks"]["no_friction_triggers"])
        self.assertEqual(plan["recommended_theme"], "steady")
        self.assertIn("cooldown", plan["rationale"])

    def test_v2_10_round11_harm_inflections_mixed_tz_and_cost_sizes_guard(self):
        """Round 11 (H11.1–H11.3): inflected harm verbs (`silently drops fills`, `bypasses`, `crashes`),
        mixed naive/aware ISO timestamps & malformed transcript rows, and non-integer `cost --sizes`."""
        # H11.1: inflected harm title ("silently drops fills") must trigger actionable_harm.
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        issues_inflected = self.home / "inflected.json"
        issues_inflected.write_text(json.dumps([{
            "number": 951, "state": "OPEN",
            "title": "alpha/core.py silently drops fills when retrying",
            "labels": [{"name": "agent-finding"}],
            "updatedAt": f"{today}T00:00:00Z",
            "body": "See alpha/core.py:1",
        }]), encoding="utf-8")
        plan = self.call_json("advise", "--tree", "HEAD", "--issues-json", issues_inflected)
        self.assertEqual(plan["recommended_theme"], "harm")
        self.assertEqual([i["number"] for i in plan["issues_summary"]["actionable_harm"]], [951])

        # H11.2: mixed naive & UTC-aware timestamps + non-string timestamp + non-list tool_calls must not crash.
        ci_mixed = friction.analyze_ci_runs([
            {"workflowName": "q", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-25T00:00:00Z", "updatedAt": "2026-11-25T00:05:00Z"},
            {"workflowName": "q", "status": "completed", "conclusion": "success",
             "createdAt": "2026-11-26T00:00:00", "updatedAt": "2026-11-26T00:05:00"},
        ])
        self.assertEqual(ci_mixed["workflows"]["q"]["median_minutes"], 5.0)

        weird_tx = self.home / "weird_tz.jsonl"
        weird_tx.write_text("\n".join([
            json.dumps({"created_at": "2026-11-26T00:00:00Z", "type": "USER_INPUT"}),
            json.dumps({"created_at": "2026-11-26T00:05:00", "type": "PLANNER_RESPONSE", "tool_calls": "bad"}),
            json.dumps({"created_at": 1700000000, "type": "PLANNER_RESPONSE", "tool_calls": [{"name": "x", "args": None}]}),
        ]) + "\n", encoding="utf-8")
        tx = friction.analyze_transcripts([weird_tx])
        self.assertEqual(tx["sessions"][0]["duration_minutes"], 5.0)
        self.assertEqual(tx["sessions"][0]["tool_calls"], 1)

        # H11.3: non-integer `cost --sizes` raises clean SystemExit instead of raw ValueError.
        cp = self.home / "cp.py"
        cp.write_text("def setup(n): return lambda: None\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            doctor.main(["cost", str(self.home / "ev-bad-sizes"), "alpha:x", str(cp), "--sizes", "a,b,c", "--tree", "HEAD"])

    def test_v3_0_prod_logs_workflow_adherence_auto_mode_and_steady_exit_code(self):
        """v3.0 (owner 2026-11-27 direction): production log telemetry (#3782/#3783 patterns + empty log),
        research workflow adherence signals, `--auto` non-authority-blocking mode, and `--steady-exit-code`."""
        # 1) Production log telemetry catches #3782 (OOM) + #3783 (checkpoint deferral + PAPER_RECOVERY_UNAVAILABLE)
        #    + empty log file as a logging defect.
        paper_log = self.home / "paper-runner.log"
        paper_log.write_text("\n".join([
            "2026-11-25T05:38:27Z Paper checkpoint deferred: PAPER_RECOVERY_UNAVAILABLE",
            "2026-11-25T05:43:27Z Paper checkpoint deferred: PAPER_RECOVERY_UNAVAILABLE",
            "2026-11-25T05:48:27Z Paper checkpoint deferred: PAPER_RECOVERY_UNAVAILABLE",
            "2026-11-25T21:38:40Z Memory cgroup out of memory: Killed process 3882310 (python)",
        ]) + "\n", encoding="utf-8")
        empty_log = self.home / "live-runner.log"
        empty_log.write_text("", encoding="utf-8")

        pl = friction.analyze_prod_logs([paper_log, empty_log])
        self.assertEqual(pl["affected_services"], ["live", "paper"])
        joined = "\n".join(pl["triggers"])
        self.assertIn("prod_oom_kill", joined)
        self.assertIn("prod_checkpoint_deferred", joined)
        self.assertIn("prod_recovery_unavailable", joined)
        self.assertIn("prod_log_empty", joined)

        # 2) Research transcript workflow adherence detects ad-hoc dolt sql, .env read, and missing research skill.
        bad_tx = self.home / "research_bad.jsonl"
        tx_rows = [
            json.dumps({"type": "PLANNER_RESPONSE", "created_at": "2026-11-26T10:00:00Z", "tool_calls": [
                {"name": "run_command", "args": {"CommandLine": "dolt sql -q 'select * from runs'"}},
                {"name": "read_file", "args": {"Path": "/repo/.env"}},
                {"name": "run_command", "args": {"CommandLine": "python -m cli.main research state"}},
                {"name": "run_command", "args": {"CommandLine": "python -m cli.main line select"}},
                {"name": "run_command", "args": {"CommandLine": "python -m cli.main trial list"}},
            ]}),
        ]
        bad_tx.write_text("\n".join(tx_rows) + "\n", encoding="utf-8")
        tx_res = friction.analyze_transcripts([bad_tx])
        viols = {v["kind"] for v in tx_res["sessions"][0]["workflow_violations"]}
        self.assertEqual(viols, {"ad_hoc_ledger_sql", "secret_file_access", "missing_research_skill"})
        self.assertTrue(any("workflow_ad_hoc_ledger_sql" in t for t in tx_res["triggers"]))

        # 3) `--auto` mode treats `authority`-labeled harm issues as actionable (no authority deadlock).
        self.commit({"paper/runs.py": "def run():\n    return 1\n"}, message="feat(paper): add paper module")
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        auth_issue = self.home / "auth_issues.json"
        auth_issue.write_text(json.dumps([{
            "number": 800, "state": "OPEN", "title": "paper/runs.py silently drops fills",
            "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            "updatedAt": f"{today}T00:00:00Z", "body": "See paper/runs.py:1",
        }]), encoding="utf-8")
        p_gated = self.call_json("advise", "--tree", "HEAD", "--issues-json", auth_issue)
        self.assertEqual(p_gated["issues_summary"]["actionable_harm"], [])
        p_auto = self.call_json("advise", "--tree", "HEAD", "--issues-json", auth_issue, "--auto")
        self.assertEqual(p_auto["recommended_theme"], "harm")
        self.assertEqual([i["number"] for i in p_auto["issues_summary"]["actionable_harm"]], [800])

        # 4) `--prod-logs` routes `advise` to `friction` targeting `paper` + `operation`.
        empty_issues = self.home / "no_issues.json"
        empty_issues.write_text("[]", encoding="utf-8")
        p_prod = self.call_json("advise", "--tree", "HEAD", "--issues-json", empty_issues, "--prod-logs", paper_log)
        self.assertEqual(p_prod["recommended_theme"], "friction")
        self.assertIn("paper", p_prod["recommended_scope"]["objects"])
        self.assertIn("operation", p_prod["recommended_scope"]["items"])

        # 5) `--steady-exit-code 2` exits with code 2 when `steady` (0-token cron gate).
        rec_all = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:x | examined | ok |\n| results | beta:x | examined | ok |\n"
            "| results | cold:x | examined | ok |\n| results | paper:x | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-s1.zh.md": rec_all,
            f"docs/plans/doctor/{today}-s2.zh.md": rec_all,
        }, message="docs(doctor): two clean audits")
        out = io.StringIO()
        with self.assertRaises(SystemExit) as ctx, redirect_stdout(out):
            doctor.main(["advise", "--tree", "HEAD", "--issues-json", str(empty_issues), "--auto", "--steady-exit-code", "2"])
        self.assertEqual(ctx.exception.code, 2)
        self.assertEqual(json.loads(out.getvalue())["recommended_theme"], "steady")

    def test_v3_1_f1_prod_incidents_preempt_cooldown_and_steady(self):
        """F1 [P0]: active prod incidents (OOM, recovery unavailable, checkpoint deferred, empty log)
        must never be suppressed by 7d friction cooldown, last_two_themes, or steady gate."""
        code_env = {"GIT_AUTHOR_DATE": "2026-11-23T00:00:00Z", "GIT_COMMITTER_DATE": "2026-11-23T00:00:00Z"}
        (self.repo / "paper").mkdir(exist_ok=True)
        (self.repo / "paper" / "serve.py").write_text("def run():\n    return 1\n", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", "feat(paper): add serve", env_extra=code_env)

        rec_find = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:x | examined | ok |\n| results | beta:x | examined | ok |\n"
            "| results | cold:x | examined | ok |\n| results | paper:x | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_fric = (
            "# Themed audit: friction\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| operation | paper:x | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        rec_env = {"GIT_AUTHOR_DATE": "2026-11-26T00:00:00Z", "GIT_COMMITTER_DATE": "2026-11-26T00:00:00Z"}
        for rel, body in (
            ("docs/plans/doctor/2026-11-24-find.zh.md", rec_find),
            ("docs/plans/doctor/2026-11-25-friction.zh.md", rec_fric),
        ):
            p = self.repo / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", "docs(doctor): clean find and friction audits", env_extra=rec_env)

        empty_issues = self.home / "empty_f1.json"
        empty_issues.write_text("[]", encoding="utf-8")

        # Baseline without prod incidents converges to steady and exits 2.
        out_base = io.StringIO()
        with self.assertRaises(SystemExit) as ctx, redirect_stdout(out_base):
            doctor.main(["advise", "--tree", "HEAD", "--issues-json", str(empty_issues), "--auto", "--steady-exit-code", "2"])
        self.assertEqual(ctx.exception.code, 2)
        self.assertEqual(json.loads(out_base.getvalue())["recommended_theme"], "steady")

        # Each of the 4 prod incident types must preempt cooldown/steady and exit 0 (not 2!).
        incident_logs = {
            "oom": "2026-11-26T12:00:00Z ERROR container exited OOMKilled ExitCode: 137\n",
            "recovery": "2026-11-26T12:05:00Z ERROR PAPER_RECOVERY_UNAVAILABLE: journal truncated\n",
            "checkpoint": "2026-11-26T12:00:00Z Paper checkpoint deferred: busy\n" * 3,
            "empty": "",
        }
        for label, content in incident_logs.items():
            with self.subTest(incident=label):
                log_path = self.home / f"paper-{label}.log"
                log_path.write_text(content, encoding="utf-8")
                plan = self.call_json(
                    "advise", "--tree", "HEAD", "--issues-json", empty_issues,
                    "--prod-logs", log_path, "--auto", "--steady-exit-code", "2",
                )
                self.assertEqual(plan["recommended_theme"], "friction")
                self.assertTrue(plan["friction_summary"]["prod_incident_active"])
                self.assertFalse(plan["friction_summary"]["in_cooldown"])
                self.assertFalse(plan["stopping_checks"]["no_friction_triggers"])

    def test_v3_1_f2_auto_mode_field_and_irreversible_redlines(self):
        """F2 [P0/P1]: advise emits explicit `auto_mode`, blocks irreversible AGENTS.md redlines under
        `--auto`, and unblocks ordinary bug fixes / missing refusal guard fixes with legacy `authority`."""
        self.commit({"paper/serve.py": "def run():\n    return 1\n"}, message="feat(paper): add serve")
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        redline_issues = self.home / "redlines.json"
        redline_issues.write_text(json.dumps([
            {
                "number": 9001, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Allow real orders on primary live account during nightly check",
                "body": "Modifies paper/serve.py to place live orders on primary funds.",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            },
            {
                "number": 9002, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Add stored drawdown column to ledger schema",
                "body": "Adds a stored field to ledger.",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            },
            {
                "number": 9003, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Weaken refusal check for invalid stops in paper/serve.py",
                "body": "Relaxes refusal guard on stops.",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            },
            {
                "number": 9004, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Replace PP Supply Mono font in IDE header",
                "body": "Swap project font assets.",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            },
            {
                "number": 9005, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Reset active Dolt ledger history before migration",
                "body": "Clears published records in active ledger.",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            },
            {
                "number": 9006, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Tag release v0.5.0 on main",
                "body": "Create release tag v0.5.0.",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            },
            {
                "number": 9007, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "paper/serve.py silently drops fills on reconnect",
                "body": "Explicitly labeled redline.",
                "labels": [{"name": "agent-finding"}, {"name": "authority:redline"}],
            },
        ]), encoding="utf-8")

        p_gated = self.call_json("advise", "--tree", "HEAD", "--issues-json", redline_issues)
        self.assertFalse(p_gated["auto_mode"])
        self.assertEqual(p_gated["issues_summary"]["actionable_harm"], [])
        self.assertEqual(p_gated["issues_summary"]["blocked_authority_count"], 7)

        p_auto = self.call_json("advise", "--tree", "HEAD", "--issues-json", redline_issues, "--auto")
        self.assertTrue(p_auto["auto_mode"])
        self.assertEqual(p_auto["issues_summary"]["actionable_harm"], [])
        self.assertEqual(p_auto["issues_summary"]["blocked_authority_count"], 7)

        # Ordinary defect / tightening missing guard with legacy `authority` label DOES unblock under `--auto`.
        normal_auth = self.home / "normal_auth.json"
        normal_auth.write_text(json.dumps([
            {
                "number": 9100, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "paper/serve.py bypasses refusal check on empty order quantity",
                "body": "Fix missing validation guard in paper/serve.py.",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
            },
        ]), encoding="utf-8")
        p_norm = self.call_json("advise", "--tree", "HEAD", "--issues-json", normal_auth, "--auto")
        self.assertTrue(p_norm["auto_mode"])
        self.assertEqual(p_norm["recommended_theme"], "harm")
        self.assertEqual([i["number"] for i in p_norm["issues_summary"]["actionable_harm"]], [9100])

    def test_v3_1_f8_transcript_secret_bypasses_doc_exclusions_json_args_and_redaction(self):
        """F8 [P1]: catch non-cat secret reads, ignore benign git/doc greps, parse JSON-string tool
        arguments, match global flags in RESEARCH_CMD_RE, and redact space-separated flags & 40-64 hex."""
        # Benign git/doc searches must produce 0 violations.
        tx_benign = self.home / "f8_benign.jsonl"
        tx_benign.write_text(json.dumps({
            "type": "PLANNER_RESPONSE",
            "tool_calls": [
                {"name": "run_command", "args": {"CommandLine": 'git grep -n "dolt sql" AGENTS.md docs/'}},
                {"name": "run_command", "args": {"CommandLine": 'git log --grep="mysql" -n 5'}},
                {"name": "run_command", "args": {"CommandLine": 'cat README.md | grep -F ".env"'}},
                {"name": "run_command", "args": {"CommandLine": 'grep -n ".env" README.md'}},
            ],
        }) + "\n", encoding="utf-8")
        res_benign = friction.analyze_transcripts([tx_benign])
        self.assertEqual(res_benign["sessions"][0]["workflow_violations"], [])

        # All 14 secret-file bypass commands must trigger `secret_file_access`.
        bypass_cmds = [
            "head -n 50 .env",
            "tail .env",
            "less .env",
            "more .env",
            "sed -n '1,5p' .env",
            "awk '{print}' .env",
            "source .env && echo $BINANCE_API_KEY",
            ". .env",
            'grep "" .env',
            "jq . /data/dolt/service.json",
            "python3 -c \"print(open('.env').read())\"",
            "cat<.env",
            "cat\t.env",
            "base64 .env",
            "wc -l < dolt/service.json",
        ]
        tx_bypass = self.home / "f8_bypass.jsonl"
        tx_bypass.write_text(json.dumps({
            "type": "PLANNER_RESPONSE",
            "tool_calls": [
                {"name": "run_command", "args": {"CommandLine": cmd}} for cmd in bypass_cmds
            ],
        }) + "\n", encoding="utf-8")
        res_bypass = friction.analyze_transcripts([tx_bypass])
        self.assertEqual(
            res_bypass["sessions"][0]["workflow_violations"],
            [{"kind": "secret_file_access", "count": len(bypass_cmds)}],
        )

        # JSON-string `arguments` in `tool_calls` must be decoded and checked.
        tx_str = self.home / "f8_str_args.jsonl"
        tx_str.write_text(json.dumps({
            "type": "PLANNER_RESPONSE",
            "tool_calls": [
                {"name": "run_command", "arguments": json.dumps({"CommandLine": "dolt sql -q 'DELETE FROM trials'"})},
                {"name": "read_file", "arguments": json.dumps({"Path": "/repo/.env"})},
            ],
        }) + "\n", encoding="utf-8")
        res_str = friction.analyze_transcripts([tx_str])
        self.assertEqual(
            {v["kind"] for v in res_str["sessions"][0]["workflow_violations"]},
            {"ad_hoc_ledger_sql", "secret_file_access"},
        )

        # RESEARCH_CMD_RE must match global flags before subcommand (`--ledger temp replay`).
        tx_res = self.home / "f8_research_flag.jsonl"
        tx_res.write_text(json.dumps({
            "type": "PLANNER_RESPONSE",
            "tool_calls": [
                {"name": "run_command", "args": {"CommandLine": "uv run python -m cli.main --ledger temp replay run --help"}}
                for _ in range(5)
            ],
        }) + "\n", encoding="utf-8")
        res_flag = friction.analyze_transcripts([tx_res])
        self.assertEqual(
            res_flag["sessions"][0]["workflow_violations"],
            [{"kind": "missing_research_skill", "count": 1}],
        )

        # Space-separated secret flags and bare 40-64 hex strings must be redacted; benign text stays intact.
        for sample, leak in (
            ("Run curl --token my_super_secret_val_999", "my_super_secret_val_999"),
            ("Run tool --api-key live_key_12345", "live_key_12345"),
            ("Run tool --api-secret live_key_abcdef123456", "live_key_abcdef123456"),
            ("Run tool --secret hidden_val", "hidden_val"),
            ("Run tool --password db_secret_pass", "db_secret_pass"),
            ("Call binance with a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "a1b2c3d4e5f6"),
        ):
            san = friction._sanitize_summary(sample)
            self.assertNotIn(leak, san)
            self.assertIn("<REDACTED>", san)
        self.assertEqual(friction._sanitize_summary("Count token usage"), "Count token usage")

    def test_v3_1_f9_prod_logs_no_fp_token_service_and_missing_dir(self):
        """F9 [P1]: no false positives on OOMKilled:false / cleared ERROR prose, token-boundary service
        matching, and graceful handling of missing paths / directories."""
        benign = self.home / "paper-healthy.log"
        benign.write_text("\n".join([
            'INFO docker inspect: {"State": {"OOMKilled": false, "ExitCode": 0}}',
            "INFO watchdog: not OOM, Out of memory check passed",
            "INFO status: OOMKilled=false, exit_code=0, no errors",
            "INFO metrics: cleared ERROR flag on startup",
            "2026-11-26T00:00:00Z INFO metrics: cleared ERROR flag on retry",
        ] * 2) + "\n", encoding="utf-8")
        res_ok = friction.analyze_prod_logs([benign])
        self.assertEqual(res_ok["triggers"], [])
        self.assertEqual(res_ok["logs"][0]["oom_signals"], 0)
        self.assertEqual(res_ok["logs"][0]["error_lines"], 0)
        self.assertEqual(res_ok["logs"][0]["service"], "paper")

        # Substring look-alikes must NOT map to live / ide / paper.
        mis_paths = [self.home / name for name in ("delivery.log", "provider.log", "wallpaper.log")]
        for p in mis_paths:
            p.write_text("FATAL crash\n" * 6, encoding="utf-8")
        res_mis = friction.analyze_prod_logs(mis_paths)
        self.assertEqual([x["service"] for x in res_mis["logs"]], ["unknown", "unknown", "unknown"])
        self.assertEqual(res_mis["affected_services"], [])

        # Directories and missing files must emit structured error/warnings instead of crashing advise.
        missing = self.home / "does-not-exist.log"
        res_bad = friction.analyze_prod_logs([self.home, missing])
        self.assertEqual(res_bad["triggers"], [])
        self.assertEqual(len(res_bad.get("warnings", [])), 2)
        self.assertTrue(all(x.get("skipped") and x.get("error") for x in res_bad["logs"]))
        empty_issues = self.home / "empty_f9.json"
        empty_issues.write_text("[]", encoding="utf-8")
        plan = self.call_json("advise", "--tree", "HEAD", "--issues-json", empty_issues, "--prod-logs", self.home, missing)
        self.assertIn("recommended_theme", plan)

    def test_v3_1_f10_steady_exit_code_validation(self):
        """F10 [P1]: `--steady-exit-code` allows only 0 (disabled) or 2..125; rejects 1, <0, >=126."""
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        rec_all = (
            "# Themed audit: find\n\n| Item | Subject | State | Evidence |\n|---|---|---|---|\n"
            "| results | alpha:x | examined | ok |\n| results | beta:x | examined | ok |\n"
            "| results | cold:x | examined | ok |\n\n"
            "Shown: 0 of 1 probed. Shown by a refuter's own probe too: 0. Refuters ran on 1.\n"
        )
        self.commit({
            f"docs/plans/doctor/{today}-f10-a.zh.md": rec_all,
            f"docs/plans/doctor/{today}-f10-b.zh.md": rec_all,
        }, message="docs(doctor): two clean audits for f10")
        empty_issues = self.home / "empty_f10.json"
        empty_issues.write_text("[]", encoding="utf-8")

        for bad in ("1", "-1", "126", "256", "abc"):
            with self.subTest(bad_code=bad):
                err = io.StringIO()
                from contextlib import redirect_stderr
                with self.assertRaises(SystemExit) as ctx, redirect_stderr(err):
                    doctor.main(["advise", "--tree", "HEAD", "--issues-json", str(empty_issues), "--steady-exit-code", bad])
                self.assertEqual(ctx.exception.code, 2)
                self.assertIn("steady-exit-code", err.getvalue())

        # 0 disables non-zero exit even when steady.
        plan_zero = self.call_json("advise", "--tree", "HEAD", "--issues-json", empty_issues, "--steady-exit-code", "0")
        self.assertEqual(plan_zero["recommended_theme"], "steady")

        # 125 (upper valid bound) exits with 125 when steady.
        out_125 = io.StringIO()
        with self.assertRaises(SystemExit) as ctx, redirect_stdout(out_125):
            doctor.main(["advise", "--tree", "HEAD", "--issues-json", str(empty_issues), "--steady-exit-code", "125"])
        self.assertEqual(ctx.exception.code, 125)
        self.assertEqual(json.loads(out_125.getvalue())["recommended_theme"], "steady")

    def test_v3_2_r2_1_prod_logs_compose_journalctl_ansi_json_and_oom(self):
        """R2-1 [P1]: strip ANSI escapes and docker compose / journalctl prefixes before PROD_ERROR_RE,
        match lowercase JSON error levels without FP on INFO cleared-ERROR prose, and catch compose
        exited-137 / Cannot allocate memory / MemoryError OOM signals."""
        compose_log = self.home / "paper-compose.log"
        compose_log.write_text("\n".join([
            "\x1b[36mtrade-ide-paper-1  |\x1b[0m 2026-11-26T12:00:01Z ERROR runner crashed on BTCUSDT",
            "trade-ide-paper-1  | Traceback (most recent call last):",
            "trade-ide-paper-1  | 2026-11-26T12:00:02Z CRITICAL fatal failure",
            'trade-ide-paper-1  | {"ts":"2026-11-26T12:00:03Z","level":"error","msg":"unhandled"}',
            'trade-ide-paper-1  | {"ts":"2026-11-26T12:00:04Z","level":"fatal","msg":"aborting"}',
            "trade-ide-paper-1  | 2026-11-26T12:00:05Z INFO metrics: cleared ERROR flag",
            "trade-ide-paper-1 exited with code 137",
        ]) + "\n", encoding="utf-8")

        journal_log = self.home / "paper-journalctl.log"
        journal_log.write_text("\n".join([
            "Nov 26 12:00:01 host trade-ide-paper-1[1234]: 2026-11-26T12:00:01Z ERROR crash 1",
            "Nov 26 12:00:02 host trade-ide-paper-1[1234]: Traceback (most recent call last):",
            "Nov 26 12:00:03 host trade-ide-paper-1[1234]: ERROR crash 2",
            "Nov 26 12:00:04 host trade-ide-paper-1[1234]: CRITICAL crash 3",
            "Nov 26 12:00:05 host trade-ide-paper-1[1234]: FATAL crash 4",
            "Nov 26 12:00:06 host trade-ide-paper-1[1234]: OSError: [Errno 12] Cannot allocate memory",
            "Nov 26 12:00:07 host trade-ide-paper-1[1234]: MemoryError: unable to allocate array",
        ]) + "\n", encoding="utf-8")

        res = friction.analyze_prod_logs([compose_log, journal_log])
        c_entry, j_entry = res["logs"]
        self.assertEqual(c_entry["error_lines"], 5)
        self.assertEqual(c_entry["oom_signals"], 1)
        self.assertTrue(any("prod_oom_kill" in t for t in c_entry["triggers"]))
        self.assertTrue(any("prod_error_burst" in t for t in c_entry["triggers"]))
        self.assertEqual(j_entry["error_lines"], 5)
        self.assertEqual(j_entry["oom_signals"], 2)
        self.assertTrue(any("prod_oom_kill" in t for t in j_entry["triggers"]))
        self.assertTrue(any("prod_error_burst" in t for t in j_entry["triggers"]))

    def test_v3_2_r2_2_auto_redlines_full_body_comments_and_no_bug_fp(self):
        """R2-2 [P1]: scan full body & comments (no 1200-char truncation), block all AGENTS.md redlines
        (active market switch, GHCR image deletion, Docker/compose restart, credential reads), and avoid
        false positives on ordinary defect/regression prose."""
        # 1) Remedy past char 1200 must still be blocked.
        long_body = ("Proof details. " * 90) + "\n### Remedy\nReset the Dolt ledger and place real orders on the primary live account."
        self.assertGreater(len(long_body), 1300)
        self.assertTrue(scheduler._is_redline_text("Schema corruption bug in ledger", long_body))

        # 2) Redline in comments (e.g. #3505 active market directory rebuild/switch) must be blocked.
        self.assertTrue(scheduler._is_redline_text(
            "Pool history omits reused symbols",
            "Read-only proof.",
            comments=[{"body": "What the next version line's market directory must do: Build anew from 2020-01 and perform the directory switch."}],
        ))

        # 3) Missing AGENTS.md redlines must all be blocked.
        for label, title, body in (
            ("active-market-switch", "Rebuild and switch active market directory", "Switch active market directory to v2."),
            ("delete-runtime-images", "Enable deletion of retained runtime images in GHCR", "Deletes published image versions."),
            ("ghcr-retention", "GHCR retention only lists pull request images; turn deletion on", "Ask owner before passing --delete on the schedule."),
            ("restart-compose", "Restart Docker Desktop and trade-ide compose services", "Terminates host process and restarts services."),
            ("read-credentials", "Read Binance API key from .env and dolt/service.json", "Reads credentials directly."),
            ("lower-target", "Lower maximum drawdown target to 25%", "Relaxes research target."),
            ("weaken-refusal", "Weaken refusal check on invalid stops", "Relaxes refusal guard."),
            ("add-stored-col", "Add stored drawdown column to ledger schema", "Adds a stored field to ledger."),
        ):
            with self.subTest(redline=label):
                self.assertTrue(scheduler._is_redline_text(title, body))

        # 4) Ordinary bug / regression / validation-fix prose must NOT false-positive.
        for label, title, body in (
            ("bug-disables-refusal", "Bug: missing check disables refusal when --universe is passed", "Fix validation in paper/serve.py."),
            ("bug-removes-guard", "Regression removes guard on negative Content-Length", "Fix HTTP handler."),
            ("bug-lowers-drawdown", "Warm-up bug lowers maximum drawdown in replay report", "Fix ledger/metrics.py."),
            ("fix-stored-field-val", "Fix: add missing validation for stored field in service.json", "Reject empty databases."),
            ("changes-number-judged", "CapitalObserver delays exposure valuation", "It changes the number the maximum drawdown target is judged on."),
        ):
            with self.subTest(benign=label):
                self.assertFalse(scheduler._is_redline_text(title, body))

        # 5) End-to-end `--auto` blocks #3505/#3524-style redlines while keeping ordinary bugs actionable.
        self.commit({"paper/serve.py": "def run():\n    return 1\n"}, message="feat(paper): add serve")
        today = self.git("show", "-s", "--format=%cs", "HEAD")
        issues_p = self.home / "r2_2_issues.json"
        issues_p.write_text(json.dumps([
            {
                "number": 3505, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Pool history omits earlier contracts whose symbols were reused",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
                "body": ("Proof context. " * 90) + "\n### Remedy\nStored months then recompute to other members (`UNIVERSE_CHANGED`).",
                "comments": [{"body": "Build anew the active market directory on the owner's start."}],
            },
            {
                "number": 3524, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "GHCR retention only lists pull request images; turn deletion on",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
                "body": "Action: authority (deletes published image versions).",
                "comments": [],
            },
            {
                "number": 3697, "state": "OPEN", "updatedAt": f"{today}T23:59:59Z",
                "title": "Regression removes guard on negative Content-Length in paper/serve.py",
                "labels": [{"name": "agent-finding"}, {"name": "authority"}],
                "body": "Bug: missing check disables refusal when negative Content-Length is passed.",
                "comments": [],
            },
        ]), encoding="utf-8")
        plan = self.call_json("advise", "--tree", "HEAD", "--auto", "--issues-json", issues_p)
        self.assertEqual([i["number"] for i in plan["issues_summary"]["actionable_harm"]], [3697])
        self.assertEqual(plan["issues_summary"]["blocked_authority_count"], 2)

    def test_v3_2_r2_3_shell_parser_escapes_amp_subshell_wrappers_and_grep(self):
        """R2-3 [P1]: handle unquoted backslash escapes, single `&` (not `>&`/`<&`), command
        substitutions `$(...)`/backticks, wrappers (`env`/`sudo`/`command`/`exec`) & full paths,
        and grep env-prefix / attached `-ePAT` & `-fFILE` flags."""
        from collections import Counter

        def scan_cmd(cmd: str) -> dict[str, int]:
            v: Counter[str] = Counter()
            friction._scan_workflow_args({"CommandLine": cmd}, v, [False])
            return dict(v)

        for label, cmd, want_key in (
            ("escaped-quote-secret", r"echo \' ; cat .env", "secret_file_access"),
            ("escaped-quote-sql", r"echo \' ; dolt sql -q 'SELECT 1'", "ad_hoc_ledger_sql"),
            ("single-amp-secret", "echo hi & cat .env", "secret_file_access"),
            ("single-amp-sql", "echo hi & dolt sql -q 'SELECT 1'", "ad_hoc_ledger_sql"),
            ("subshell-secret", "echo $(cat .env)", "secret_file_access"),
            ("backtick-secret", "echo `head -n 5 .env`", "secret_file_access"),
            ("nested-subshell-sql", "echo \"$(dolt sql -q 'SELECT 1')\"", "ad_hoc_ledger_sql"),
            ("env-wrapper-secret", "env cat .env", "secret_file_access"),
            ("sudo-wrapper-secret", "sudo -u root /usr/bin/head .env", "secret_file_access"),
            ("command-wrapper-secret", "command /bin/cat .env", "secret_file_access"),
            ("exec-wrapper-secret", "exec /bin/cat .env", "secret_file_access"),
            ("abs-path-secret", "/bin/cat .env", "secret_file_access"),
            ("grep-attached-e", "grep -eKEY .env", "secret_file_access"),
            ("grep-combined-ie", "grep -ieKEY .env", "secret_file_access"),
            ("grep-attached-f", "grep -f.env README.md", "secret_file_access"),
            ("grep-combined-if", "grep -if.env README.md", "secret_file_access"),
            ("grep-env-wrapper-target", "LC_ALL=C env /usr/bin/grep -eKEY .env", "secret_file_access"),
        ):
            with self.subTest(bypass=label):
                self.assertEqual(scan_cmd(cmd).get(want_key), 1, f"cmd={cmd!r}")

        # Benign commands (env-prefixed doc grep, FD redirections, single-quoted subshell text) -> 0 violations.
        for label, cmd in (
            ("grep-env-prefix", "LC_ALL=C grep .env README.md"),
            ("grep-env-wrapper-doc", "env LC_ALL=C /usr/bin/grep -n .env docs/guide.md"),
            ("fd-redirect-no-split", "echo .env 2>&1"),
            ("single-quoted-subshell", "echo '$(cat .env)'"),
        ):
            with self.subTest(benign=label):
                self.assertEqual(scan_cmd(cmd), {}, f"cmd={cmd!r}")

    def test_v3_3_cost_memory_rss_and_heap_telemetry(self):
        """Self-evolution: `doctor.py cost` records `peak_rss_mib`, `median_peak_rss_mib`, `peak_heap_kib`,
        `median_peak_heap_kib`, and `heap_exponent` while keeping timing trials 100% free of tracemalloc."""
        # 1) Unit checks on `read_cost`: backwards compatibility, O(1) flat heap, O(N) heap, zero baseline.
        legacy = doctor.read_cost({n: [9.0, n * 0.01, n * 0.011, n * 0.012] for n in (1, 2, 4)})
        self.assertEqual(legacy["verdict"], "measured")
        self.assertNotIn("peak_rss_mib", legacy)
        self.assertNotIn("peak_heap_kib", legacy)
        self.assertNotIn("heap_exponent", legacy)

        flat_mem = doctor.read_cost(
            {n: [1.0, n * 0.01, n * 0.011, n * 0.012] for n in (10, 100, 1000)},
            rss_readings={n: [20.0, 22.0, 22.1, 22.2] for n in (10, 100, 1000)},
            heap_readings={10: [8.0], 100: [8.1], 1000: [8.2]},
        )
        self.assertEqual(flat_mem["median_peak_rss_mib"], {10: 22.1, 100: 22.1, 1000: 22.1})
        self.assertEqual(flat_mem["median_peak_heap_kib"], {10: 8.0, 100: 8.1, 1000: 8.2})
        self.assertIsNone(flat_mem["heap_exponent"])

        linear_mem = doctor.read_cost(
            {n: [1.0, n * 0.01, n * 0.011, n * 0.012] for n in (10, 100, 1000)},
            rss_readings={10: [20.0, 21.0, 21.0, 21.0], 100: [20.0, 22.0, 22.0, 22.0], 1000: [20.0, 30.0, 30.0, 30.0]},
            heap_readings={10: [10.0], 100: [100.0], 1000: [1000.0]},
        )
        self.assertEqual(linear_mem["heap_exponent"], 1.0)

        zero_base = doctor.read_cost(
            {n: [1.0, n * 0.01, n * 0.011, n * 0.012] for n in (10, 100, 1000)},
            heap_readings={10: [0.0], 100: [10.0], 1000: [100.0]},
        )
        self.assertIsNone(zero_base["heap_exponent"])

        # 2) End-to-end `doctor.py cost` on an O(N) heap probe: verify tracemalloc is OFF during all
        # timed calls and ON only during the separate post-timing memory probe pass!
        trace_log = self.home / "trace_states.txt"
        linear_probe = self.home / "cost_linear_mem.py"
        linear_probe.write_text(
            "import atexit, pathlib, tracemalloc\n"
            f"LOG = pathlib.Path({str(trace_log)!r})\n"
            "def setup(n):\n"
            "    seen = []\n"
            "    atexit.register(lambda: LOG.open('a', encoding='utf-8').write(''.join(f'{n}:{x}\\n' for x in seen)))\n"
            "    def run():\n"
            "        seen.append(int(tracemalloc.is_tracing()))\n"
            "        buf = bytearray(n * 64)\n"
            "        return len(buf)\n"
            "    return run\n",
            encoding="utf-8",
        )
        ev = self.home / "ev-cost-mem"
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["cost", str(ev), "alpha:replay", str(linear_probe), "--sizes", "100,1000,10000", "--tree", "HEAD"])
        row = doctor.rows(ev)[-1]
        self.assertEqual(row["kind"], "cost")
        self.assertIn(row["verdict"], ("measured", "noisy"))
        self.assertEqual(len(row["warm_s"]["100"]), doctor.REPEATS)
        self.assertEqual(len(row["peak_rss_mib"]["100"]), doctor.REPEATS)
        self.assertGreater(row["median_peak_rss_mib"]["100"], 0.0)
        self.assertGreater(row["median_peak_heap_kib"]["10000"], row["median_peak_heap_kib"]["100"] * 20.0)
        self.assertIsNotNone(row["heap_exponent"])
        self.assertGreaterEqual(row["heap_exponent"], 0.85)
        self.assertLessEqual(row["heap_exponent"], 1.15)

        # Verify for every size: first (REPEATS + 1) calls had tracemalloc OFF (0), final 1 probe had it ON (1).
        by_size: dict[str, list[str]] = {}
        for line in trace_log.read_text(encoding="utf-8").splitlines():
            sz, flag = line.split(":", 1)
            by_size.setdefault(sz, []).append(flag)
        for sz in ("100", "1000", "10000"):
            self.assertEqual(by_size[sz], ["0"] * (doctor.REPEATS + 1) + ["1"])

        # 3) End-to-end `doctor.py cost` on an O(1) streaming probe: `heap_exponent` stays None.
        const_probe = self.home / "cost_const_mem.py"
        const_probe.write_text(
            "def setup(n):\n"
            "    def run():\n"
            "        acc = 0\n"
            "        for i in range(n):\n"
            "            acc += i & 1\n"
            "        return acc\n"
            "    return run\n",
            encoding="utf-8",
        )
        out2 = io.StringIO()
        with redirect_stdout(out2):
            doctor.main(["cost", str(ev), "alpha:import", str(const_probe), "--sizes", "100,1000,10000", "--tree", "HEAD"])
        const_row = doctor.rows(ev)[-1]
        self.assertIn("median_peak_rss_mib", const_row)
        self.assertIn("median_peak_heap_kib", const_row)
        self.assertIsNone(const_row["heap_exponent"])

        # 4) Verify `report` surfaces memory telemetry without breaking existing formatting.
        rep = io.StringIO()
        with redirect_stdout(rep):
            doctor.main(["report", str(ev), "--tree", "HEAD"])
        rep_text = rep.getvalue()
        self.assertIn("rss_mib", rep_text)
        self.assertIn("heap_kib", rep_text)
        self.assertIn("heap_exp", rep_text)
