"""Tests for product-doctor `journey` lens and `doctor.py gates-map` static Gate & Refusal Map."""

from __future__ import annotations

import ast
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ASSETS_DIR = ROOT / ".agents/skills/product-doctor/assets"
if str(ASSETS_DIR) not in sys.path:
    sys.path.insert(0, str(ASSETS_DIR))


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


doctor = _load_module("doctor_under_test_journey", ASSETS_DIR / "doctor.py")
journey_gates = _load_module("journey_gates_under_test", ASSETS_DIR / "journey_gates.py")
telemetry = _load_module("telemetry_under_test_journey", ASSETS_DIR / "telemetry.py")


class JourneyGatesSyntheticTests(unittest.TestCase):
    def _make_git_repo(self, files: dict[str, str]) -> Path:
        tmp = tempfile.TemporaryDirectory(prefix="doctor-gates-map-")
        self.addCleanup(tmp.cleanup)
        repo = Path(tmp.name).resolve()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(["git", "config", "gc.auto", "0"], cwd=repo, check=True)
        subprocess.run(["git", "config", "maintenance.auto", "false"], cwd=repo, check=True)
        for rel, content in files.items():
            target = repo / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"],
            cwd=repo,
            check=True,
            capture_output=True,
        )
        return repo

    def test_extracts_ordered_gate_chains_wrappers_and_return_dicts(self) -> None:
        repo = self._make_git_repo({
            "cli/main.py": (
                "import argparse\n"
                "def build():\n"
                "    p = argparse.ArgumentParser()\n"
                "    nouns = p.add_subparsers()\n"
                "    live = nouns.add_parser('live')\n"
                "    lsub = live.add_subparsers()\n"
                "    lsub.add_parser('stop')\n"
                "    lsub.add_parser('web-command')\n"
                "    return p\n"
            ),
            "live/check.py": (
                "MISSING_MSG = 'missing evidence for live run'\n"
                "def _invalid(msg):\n"
                "    return refuse('LIVE_CONFIG', msg)\n"
                "def _helper(x):\n"
                "    if x < 0:\n"
                "        raise state.fail('LIVE_FUNDS', 'insufficient balance')\n"
                "def check_admission(x, has_ev, ok):\n"
                "    if x is None:\n"
                "        raise _invalid('x is required')\n"
                "    _helper(x)\n"
                "    if not has_ev:\n"
                "        raise state.fail('LIVE_EVIDENCE_MISSING', MISSING_MSG)\n"
                "    if not ok:\n"
                "        return {'ok': False, 'code': 'LIVE_STATE_REJECTED', 'message': 'not ok'}\n"
                "    return {'ok': True}\n"
            ),
            "tests/test_live.py": (
                "CODES = ('LIVE_CONFIG', 'LIVE_FUNDS', 'LIVE_EVIDENCE_MISSING', 'LIVE_STATE_REJECTED')\n"
            ),
        })
        res = journey_gates.build_gates_map(repo, packages=("live",))
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["untested_refusal_codes"], [])
        self.assertEqual(res["phantom_remedy_commands"], [])
        self.assertEqual(res["dead_or_shadowed_candidates"]["dead_unreachable_gates"], [])
        by_fn = {c["function"]: c for c in res["chains"]}
        chain = by_fn["check_admission"]
        self.assertEqual(
            [g["code"] for g in chain["gates"]],
            ["LIVE_CONFIG", "LIVE_EVIDENCE_MISSING", "LIVE_STATE_REJECTED"],
        )
        self.assertEqual([g["order"] for g in chain["gates"]], [1, 2, 3])
        self.assertEqual(chain["gates"][1]["message_template"], "missing evidence for live run")
        self.assertIn("_helper", chain["calls_local_gate_helpers"])
        self.assertEqual(res["cli_inventory"]["nouns"], {"live": ["stop", "web-command"]})

    def test_detects_phantom_remedies_and_untested_codes(self) -> None:
        repo = self._make_git_repo({
            "cli/commands.py": (
                "COMMANDS = [\n"
                "    command(fn, 'candidate', 'export', 'h', ()),\n"
                "    command(fn, 'paper', 'start', 'h', ()),\n"
                "    command(fn, 'validation', 'registration', 'h', ()),\n"
                "    command(fn, 'live', 'stop', 'h', ()),\n"
                "]\n"
            ),
            "shared/refusals.py": (
                "CATALOGUE = {\n"
                "    'PAPER_BAD_REMEDY': ('Run `paper run` first; valid `paper start` is ok.',),\n"
                "    'CANDIDATE_OK': ('Use `candidate export` or `validation registration`.',),\n"
                "}\n"
            ),
            "paper/runs.py": (
                "def start(flag):\n"
                "    if not flag:\n"
                "        raise refuse('PAPER_BAD_REMEDY', 'Try `live prepare` or python -m cli.main ghost verb')\n"
                "    if flag == 'other':\n"
                "        raise refuse('PAPER_UNTESTED_GATE', 'run `live stop` to clear')\n"
            ),
            "tests/test_paper.py": "assert 'PAPER_BAD_REMEDY'\n",
        })
        res = journey_gates.build_gates_map(repo, packages=("paper",))
        self.assertEqual(res["status"], "fail")
        self.assertIn("gates:phantom_remedy_commands", res["triggers"])
        self.assertIn("gates:untested_refusal_codes", res["triggers"])
        untested = [u["code"] for u in res["untested_refusal_codes"]]
        self.assertEqual(untested, ["PAPER_UNTESTED_GATE"])
        phantoms = {(p["code"], p["command"], p["source"]) for p in res["phantom_remedy_commands"]}
        self.assertEqual(
            phantoms,
            {
                ("PAPER_BAD_REMEDY", "paper run", "catalogue"),
                ("PAPER_BAD_REMEDY", "live prepare", "raise_message"),
                ("PAPER_BAD_REMEDY", "ghost verb", "raise_message"),
            },
        )

    def test_detects_dead_unreachable_and_shadowed_gates_without_false_positives(self) -> None:
        repo = self._make_git_repo({
            "registration/checks.py": (
                "def broken_gates(x, y):\n"
                "    if False:\n"
                "        raise refuse('DEAD_FALSE_BRANCH', 'never runs')\n"
                "    if x > 0:\n"
                "        raise refuse('DUP_ELIF_A', 'first')\n"
                "    elif x > 0:\n"
                "        raise refuse('DUP_ELIF_B', 'shadowed elif')\n"
                "    if y is None:\n"
                "        raise refuse('SHADOWED_A', 'same guard first')\n"
                "    if y is None:\n"
                "        raise refuse('SHADOWED_B', 'same guard second')\n"
                "    if True:\n"
                "        raise refuse('ALWAYS_TRUE_GATE', 'always fires')\n"
                "    else:\n"
                "        raise refuse('DEAD_ELSE_GATE', 'unreachable else')\n"
                "    raise refuse('POST_TERM_GATE', 'unreachable tail')\n"
                "\n"
                "def mutated_guard_is_not_dead(z):\n"
                "    if z < 0:\n"
                "        raise refuse('NEG_BEFORE', 'negative before update')\n"
                "    z = z - 10\n"
                "    if z < 0:\n"
                "        raise refuse('NEG_AFTER', 'negative after update')\n"
                "\n"
                "def duplicate_code_same_msg(a, b):\n"
                "    if a:\n"
                "        raise refuse('SAME_CODE', 'duplicate reason')\n"
                "    if b:\n"
                "        raise refuse('SAME_CODE', 'duplicate reason')\n"
            ),
            "tests/test_checks.py": (
                "TESTED = (\n"
                "    'DEAD_FALSE_BRANCH', 'DUP_ELIF_A', 'DUP_ELIF_B', 'SHADOWED_A', 'SHADOWED_B',\n"
                "    'ALWAYS_TRUE_GATE', 'DEAD_ELSE_GATE', 'POST_TERM_GATE',\n"
                "    'NEG_BEFORE', 'NEG_AFTER', 'SAME_CODE',\n"
                ")\n"
            ),
        })
        res = journey_gates.build_gates_map(repo, packages=("registration",))
        self.assertEqual(res["status"], "fail")
        self.assertIn("gates:dead_unreachable_gates", res["triggers"])
        self.assertIn("gates:high_risk_duplicate_codes", res["triggers"])

        dead = res["dead_or_shadowed_candidates"]["dead_unreachable_gates"]
        dead_kinds = {d["kind"] for d in dead}
        self.assertTrue(
            {
                "always_false_gate_branch",
                "duplicate_elif_condition",
                "shadowed_identical_guard",
                "always_true_shadows_else_gate",
                "post_terminator_unreachable_gate",
            }
            <= dead_kinds,
            dead,
        )
        # Mutated guard variable between two `if z < 0:` checks must NOT be falsely flagged.
        self.assertFalse(any(d["function"] == "mutated_guard_is_not_dead" for d in dead))

        dups = res["dead_or_shadowed_candidates"]["duplicate_codes_in_chain"]
        self.assertEqual(len(dups), 1)
        self.assertEqual(dups[0]["function"], "duplicate_code_same_msg")
        self.assertEqual(dups[0]["severity"], "high")
        self.assertTrue(dups[0]["identical_message"])


class JourneyGatesRealRepoTests(unittest.TestCase):
    def test_journey_lens_registered_in_lenses_md(self) -> None:
        listed = doctor.items()
        self.assertIn("journey", listed)
        self.assertEqual(listed["journey"], ["satisfiability", "independence", "remedy"])

    def test_cli_gates_map_on_real_repo_and_out_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="doctor-gates-out-") as tmp:
            out_path = Path(tmp) / "gates-map.json"
            buf = io.StringIO()
            with redirect_stdout(buf):
                doctor.main(["gates-map", "--root", str(ROOT), "--out", str(out_path)])
            payload = json.loads(buf.getvalue())
            self.assertEqual(payload, json.loads(out_path.read_text(encoding="utf-8")))

        self.assertIn(payload["status"], ("ok", "warn"))
        self.assertEqual(payload["phantom_remedy_commands"], [])
        self.assertEqual(payload["dead_or_shadowed_candidates"]["dead_unreachable_gates"], [])
        self.assertGreater(payload["summary"]["files_scanned"], 100)
        self.assertGreater(payload["summary"]["chains_found"], 200)
        self.assertGreater(payload["summary"]["cli_commands"], 50)

        codes = payload["codes"]
        self.assertTrue(any(c.startswith("LIVE_") for c in codes))
        self.assertTrue(any(c.startswith("PAPER_") for c in codes))
        self.assertIn("REGISTRATION_INVALID", codes)
        self.assertIn("CANDIDATE_FALSIFIED", codes)
        self.assertIn("HISTORY_UNDECIDED", codes)

        chain_keys = {(c["file"], c["function"]) for c in payload["chains"]}
        self.assertIn(("live/runs.py", "prepare_locked"), chain_keys)
        self.assertIn(("live/runs.py", "launch_locked"), chain_keys)
        self.assertIn(("paper/runs.py", "start"), chain_keys)
        self.assertIn(("registration/register.py", "validate"), chain_keys)

    def test_cli_gates_map_refuses_secret_out_path(self) -> None:
        with tempfile.TemporaryDirectory(prefix="doctor-gates-sec-") as tmp:
            for name in (".env", "service.json", "private.key", "cert.pem"):
                with self.assertRaises(SystemExit):
                    doctor.main([
                        "gates-map",
                        "--root",
                        str(ROOT),
                        "--packages",
                        "live",
                        "--out",
                        str(Path(tmp) / name),
                    ])

    def test_all_eleven_assets_pure_stdlib_and_within_cognitive_limit(self) -> None:
        asset_files = sorted(ASSETS_DIR.glob("*.py"))
        self.assertGreaterEqual(len(asset_files), 11)
        asset_names = {p.stem for p in asset_files}
        for path in asset_files:
            src = path.read_text(encoding="utf-8")
            info = telemetry.analyze_python_source(src)
            self.assertLessEqual(info["max_cognitive"], 47, f"{path.name}: {info['hot_functions']}")
            if path.name == "journey_gates.py":
                self.assertLessEqual(info["max_cognitive"], 30, f"journey_gates.py: {info['hot_functions']}")
            if path.name == "doctor.py":
                self.assertLessEqual(info["max_cognitive"], 32, f"doctor.py: {info['hot_functions']}")
            tree = ast.parse(src, str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    tops = [alias.name.split(".")[0] for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                    tops = [node.module.split(".")[0]]
                else:
                    continue
                for top in tops:
                    self.assertTrue(
                        top in sys.stdlib_module_names or top in asset_names,
                        f"{path.name} imports non-stdlib module {top!r}",
                    )


if __name__ == "__main__":
    unittest.main()
