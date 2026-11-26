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
