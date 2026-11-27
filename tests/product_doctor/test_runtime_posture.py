"""Tests for product-doctor v3.2 runtime posture, cost baseline gate, security/supply-chain audit, and docs drift."""

from __future__ import annotations

from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
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


doctor = _load_module("doctor_under_test_posture", ASSETS_DIR / "doctor.py")
runtime_posture = _load_module("runtime_posture_under_test", ASSETS_DIR / "runtime_posture.py")
telemetry = _load_module("telemetry_under_test_posture", ASSETS_DIR / "telemetry.py")


class CostBaselineGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.baseline = {
            "subject": "engine:replay",
            "exponent": 1.02,
            "heap_exponent": 0.12,
            "warm_s": {"100": [0.02, 0.021, 0.02], "1000": [0.20, 0.21, 0.20]},
            "median_peak_rss_mib": {"100": 80.0, "1000": 100.0},
        }

    def test_clean_match_has_no_regression(self) -> None:
        current = {
            "exponent": 1.08,
            "heap_exponent": 0.15,
            "warm_s": {100: [0.021, 0.022, 0.021], 1000: [0.22, 0.23, 0.22]},
            "median_peak_rss_mib": {100: 82.0, 1000: 108.0},
        }
        res = runtime_posture.compare_cost_baseline(current, self.baseline)
        self.assertFalse(res["regression"])
        self.assertEqual(res["violations"], [])

    def test_time_exponent_jump_triggers_only_above_after_threshold(self) -> None:
        # delta > 0.25 and after > 1.35 -> triggers
        bad = {**self.baseline, "exponent": 1.65}
        res = runtime_posture.compare_cost_baseline(bad, self.baseline)
        self.assertTrue(res["regression"])
        self.assertEqual([v["kind"] for v in res["violations"]], ["time_exponent_regression"])

        # delta > 0.25 but after <= 1.35 -> does not trigger
        mild = {**self.baseline, "exponent": 1.30}
        res_mild = runtime_posture.compare_cost_baseline(mild, {**self.baseline, "exponent": 0.90})
        self.assertFalse(res_mild["regression"])

    def test_heap_exponent_leak_jump_triggers(self) -> None:
        bad = {**self.baseline, "heap_exponent": 0.95}
        res = runtime_posture.compare_cost_baseline(bad, self.baseline)
        self.assertTrue(res["regression"])
        self.assertEqual([v["kind"] for v in res["violations"]], ["heap_exponent_regression"])

        # Flat baseline (heap_exponent=None with measured median_peak_heap_kib) jumping to 0.85 -> triggers
        flat_base = {**self.baseline, "heap_exponent": None, "median_peak_heap_kib": {"100": 12.0, "1000": 12.1}}
        res_flat = runtime_posture.compare_cost_baseline({**self.baseline, "heap_exponent": 0.85}, flat_base)
        self.assertTrue(res_flat["regression"])
        self.assertEqual([v["kind"] for v in res_flat["violations"]], ["heap_exponent_regression"])

    def test_rss_and_wall_time_blowup_triggers_with_delta_floors(self) -> None:
        bad = {
            **self.baseline,
            "median_peak_rss_mib": {100: 90.0, 1000: 165.0},
            "warm_s": {100: [0.02, 0.02, 0.02], 1000: [0.40, 0.42, 0.41]},
        }
        res = runtime_posture.compare_cost_baseline(bad, self.baseline)
        self.assertTrue(res["regression"])
        self.assertEqual(
            {v["kind"] for v in res["violations"]},
            {"rss_regression", "wall_time_regression"},
        )

        # Small absolute deltas (<= 32 MiB RSS, <= 0.05s wall) stay below noise floors
        tiny_base = {
            "exponent": 1.0,
            "median_peak_rss_mib": {"100": 20.0},
            "median_s": {"100": 0.01},
        }
        tiny_cur = {
            "exponent": 1.0,
            "median_peak_rss_mib": {"100": 45.0},  # 2.25x but +25 MiB <= 32 MiB
            "median_s": {"100": 0.04},  # 4x but +0.03s <= 0.05s
        }
        res_tiny = runtime_posture.compare_cost_baseline(tiny_cur, tiny_base)
        self.assertFalse(res_tiny["regression"])

    def test_cli_cost_write_baseline_and_baseline_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory(prefix="doctor-cost-bl-") as tmp:
            home = Path(tmp).resolve()
            repo = home / "repo"
            evidence = home / "evidence"
            repo.mkdir()
            git = lambda *args: subprocess.run(
                ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(repo), *args],
                check=True, capture_output=True, text=True,
            ).stdout.strip()
            git("init", "-q")
            git("config", "gc.auto", "0")
            git("config", "maintenance.auto", "false")
            (repo / "pkg").mkdir()
            (repo / "pkg/__init__.py").write_text("", encoding="utf-8")
            (repo / "pkg/work.py").write_text("def run(n):\n    return sum(range(n))\n", encoding="utf-8")
            git("add", "-A")
            git("commit", "-qm", "init")

            probe_path = home / "probe_fast.py"
            probe_path.write_text(
                "import time\n"
                "def setup(n):\n"
                "    return lambda: time.sleep(n * 0.0002)\n",
                encoding="utf-8",
            )
            baseline_file = home / "baseline.json"

            prev_cwd = Path.cwd()
            os.chdir(repo)
            try:
                out1 = io.StringIO()
                with redirect_stdout(out1):
                    doctor.main([
                        "cost", str(evidence), "pkg:replay", str(probe_path),
                        "--sizes", "10,40,160", "--tree", "HEAD",
                        "--write-baseline", str(baseline_file),
                    ])
                self.assertTrue(baseline_file.is_file())
                saved = json.loads(baseline_file.read_text(encoding="utf-8"))
                self.assertIn("median_s", saved)
                self.assertIn("160", saved["median_s"])

                # Compare against same baseline -> clean (no regression)
                out2 = io.StringIO()
                with redirect_stdout(out2):
                    doctor.main([
                        "cost", str(evidence), "pkg:replay", str(probe_path),
                        "--sizes", "10,40,160", "--tree", "HEAD",
                        "--baseline", str(baseline_file),
                    ])
                row_clean = doctor.rows(evidence)[-1]
                self.assertFalse(row_clean["regression"])
                self.assertEqual(row_clean["violations"], [])

                # Compare against an artificially tighter baseline -> triggers wall_time & exponent regression
                tight = {
                    **saved,
                    "exponent": 0.50,
                    "median_s": {"10": 0.0001, "40": 0.0005, "160": 0.001},
                }
                tight_file = home / "tight_baseline.json"
                tight_file.write_text(json.dumps(tight), encoding="utf-8")
                probe_slow = home / "probe_slow.py"
                probe_slow.write_text(
                    "import time\n"
                    "def setup(n):\n"
                    "    return lambda: time.sleep((n ** 2) * 0.000004)\n",
                    encoding="utf-8",
                )
                out3 = io.StringIO()
                with redirect_stdout(out3):
                    doctor.main([
                        "cost", str(evidence), "pkg:replay", str(probe_slow),
                        "--sizes", "10,40,160", "--tree", "HEAD",
                        "--baseline", str(tight_file),
                    ])
                row_reg = doctor.rows(evidence)[-1]
                self.assertTrue(row_reg["regression"])
                kinds = {v["kind"] for v in row_reg["violations"]}
                self.assertIn("wall_time_regression", kinds)
            finally:
                os.chdir(prev_cwd)


class PostureAuditTests(unittest.TestCase):
    def _make_git_repo(self, files: dict[str, str]) -> Path:
        tmp = tempfile.TemporaryDirectory(prefix="doctor-posture-")
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
            cwd=repo, check=True, capture_output=True,
        )
        return repo

    def test_runtime_posture_detects_floating_latest_and_unpinned_nautilus(self) -> None:
        repo = self._make_git_repo({
            "pyproject.toml": '[project]\nname = "x"\ndependencies = ["nautilus_trader>=2.0"]\n',
            "uv.lock": '[[package]]\nname = "nautilus-trader"\nversion = "2.0.0rc7"\n',
            "engine/runtime/replay.Dockerfile": "FROM python:latest\nRUN uv sync\nCOPY engine/missing.py ./engine/\n",
            "engine/runtime/Dockerfile": "FROM python:3.14-slim\n",
            "runtime/image.py": "",
            "runtime/container.py": "",
            "runtime/identity.py": "",
        })
        res = runtime_posture.check_runtime_posture(repo)
        self.assertEqual(res["status"], "fail")
        kinds = {v["kind"] for v in res["violations"]}
        self.assertIn("floating_latest_base_image", kinds)
        self.assertIn("unpinned_base_image_digest", kinds)
        self.assertIn("nautilus_unpinned", kinds)
        self.assertIn("nautilus_pyproject_not_exact", kinds)
        self.assertIn("missing_replay_closure_test", kinds)
        self.assertIn("replay_dockerfile_missing_copy_source", kinds)

    def test_runtime_posture_passes_on_real_repo(self) -> None:
        res = runtime_posture.check_runtime_posture(ROOT)
        self.assertEqual(res["status"], "ok", res)
        self.assertTrue(res["nautilus"]["pinned"])
        self.assertTrue(res["nautilus"]["sdist_locked"])
        self.assertTrue(res["nautilus"]["all_wheels_hashed"])
        self.assertTrue(res["replay_closure"]["test_present"])
        self.assertEqual(res["violations"], [])

    def test_security_posture_detects_dangerous_ast_wildcards_and_secrets(self) -> None:
        repo = self._make_git_repo({
            "pyproject.toml": '[project]\nname = "x"\ndependencies = ["requests", "foo==1.*"]\n',
            "ide/web/package.json": json.dumps({
                "name": "web",
                "dependencies": {"left-pad": "latest", "bad-star": "*"},
            }),
            "pkg/danger.py": (
                "import pickle, subprocess, yaml\n"
                "def bad(data, url, http):\n"
                "    subprocess.run('ls', shell=True)\n"
                "    eval('1+1')\n"
                "    exec('pass')\n"
                "    pickle.loads(data)\n"
                "    yaml.load(data)\n"
                "    yaml.load(data, Loader=yaml.SafeLoader)\n"
                "    http.get(url, verify=False)\n"
            ),
            "tests/test_ignored.py": "import pickle\npickle.loads(b'x')\n",
            ".env": "DUMMY=1\n",
            "dolt/service.json": "{}\n",
            "certs/private.key": "not-real\n",
            "certs/public.pem": "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n",
            "certs/secret.pem": "-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n",
        })
        res = runtime_posture.check_security_posture(repo)
        self.assertEqual(res["status"], "fail")
        ast_patterns = {hit["pattern"] for hit in res["ast_findings"]}
        self.assertEqual(
            ast_patterns,
            {"subprocess_shell_true", "eval", "exec", "pickle_deserialize", "unsafe_yaml_load", "tls_verify_disabled"},
        )
        # SafeLoader yaml.load must not be flagged (only 1 unsafe_yaml_load hit)
        self.assertEqual(sum(1 for h in res["ast_findings"] if h["pattern"] == "unsafe_yaml_load"), 1)
        # tests/ is excluded from prod AST scan
        self.assertTrue(all(not h["file"].startswith("tests/") for h in res["ast_findings"]))
        # Wildcard/unpinned deps and missing lockfiles caught
        self.assertGreaterEqual(len(res["dependency_findings"]), 4)
        self.assertIn("uv.lock", res["missing_lockfiles"])
        self.assertIn("ide/web/package-lock.json", res["missing_lockfiles"])
        # Tracked secret files caught, while public cert bundle is not flagged
        secret_paths = {s["file"] for s in res["tracked_secret_files"]}
        self.assertEqual(secret_paths, {".env", "dolt/service.json", "certs/private.key", "certs/secret.pem"})
        self.assertEqual(res["public_cert_bundles"], ["certs/public.pem"])

    def test_security_posture_passes_on_real_repo(self) -> None:
        res = runtime_posture.check_security_posture(ROOT)
        self.assertEqual(res["status"], "ok", res)
        self.assertEqual(res["ast_findings"], [])
        self.assertEqual(res["tracked_secret_files"], [])
        self.assertEqual(res["dependency_findings"], [])
        self.assertEqual(res["missing_lockfiles"], [])
        self.assertTrue(any(h["file"] == "engine/load.py" and h["pattern"] == "exec" for h in res["allowlisted_ast_findings"]))

    def test_docs_posture_detects_broken_links_and_phantom_paths(self) -> None:
        repo = self._make_git_repo({
            "README.md": (
                "# Repo\n"
                "See [real](docs/real.md), [broken](docs/missing.md), and [ext](https://example.com/x).\n"
                "Check `docs/plans/phantom.md` and `engine/exists.py`.\n"
                "```md\n"
                "[ignored](docs/in-fence.md) `docs/plans/ignored.md`\n"
                "```\n"
            ),
            "docs/real.md": "# Real\n",
            "engine/exists.py": "",
            ".agents/skills/demo/SKILL.md": "Read [bad ref](references/none.md) and `cli/nope.py`.\n",
        })
        res = runtime_posture.check_docs_posture(repo)
        self.assertEqual(res["status"], "fail")
        broken = {(r["file"], r["kind"], r["target"]) for r in res["broken_doc_refs"]}
        self.assertEqual(
            broken,
            {
                ("README.md", "markdown_link", "docs/missing.md"),
                ("README.md", "backtick_path", "docs/plans/phantom.md"),
                (".agents/skills/demo/SKILL.md", "markdown_link", "references/none.md"),
                (".agents/skills/demo/SKILL.md", "backtick_path", "cli/nope.py"),
            },
        )

    def test_cli_posture_all_passes_on_real_repo(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["posture", "--root", str(ROOT)])
        payload = json.loads(out.getvalue())
        self.assertEqual(payload["status"], "ok", payload)
        self.assertEqual(payload["triggers"], [])
        for key in ("runtime", "security", "docs"):
            self.assertIn(key, payload)
            self.assertEqual(payload[key]["status"], "ok")

    def test_all_product_doctor_assets_stay_pure_stdlib_and_within_cognitive_limit(self) -> None:
        asset_names = {p.stem for p in ASSETS_DIR.glob("*.py")}
        for path in sorted(ASSETS_DIR.glob("*.py")):
            src = path.read_text(encoding="utf-8")
            info = telemetry.analyze_python_source(src)
            self.assertLessEqual(info["max_cognitive"], 47, f"{path.name}: {info['hot_functions']}")
            tree = __import__("ast").parse(src, str(path))
            for node in __import__("ast").walk(tree):
                if isinstance(node, __import__("ast").Import):
                    tops = [a.name.split(".")[0] for a in node.names]
                elif isinstance(node, __import__("ast").ImportFrom) and node.level == 0 and node.module:
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
