"""If this fails, an audit can again claim what its own commands did not show (.agents/skills/product-doctor)."""

from contextlib import redirect_stdout
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("doctor", ROOT / ".agents/skills/product-doctor/assets/doctor.py")
assert SPEC is not None and SPEC.loader is not None
doctor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(doctor)

TEST = """import unittest
from shop import price
class T(unittest.TestCase):
    def test_total(self):
        self.assertEqual(price.total(2), 4)
    def test_same(self):
        self.assertEqual(price.total(0), 0)
"""


class DoctorTests(unittest.TestCase):
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
        self.broken = self.commit({"shop/__init__.py": "", "shop/price.py": "def total(n): return n\n"})
        self.fixed = self.commit({"shop/price.py": "def total(n): return n * 2\n", "tests/__init__.py": "",
                                  "tests/test_price.py": TEST})

    def git(self, *args):
        return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", self.repo, *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, files: dict[str, str]) -> str:
        for name, text in files.items():
            (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
            (self.repo / name).write_text(text)
        self.git("add", "-A")
        self.git("commit", "-qm", "change")
        return self.git("rev-parse", "HEAD")

    def call(self, name: str, *args) -> str:
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main([name, str(self.evidence), *map(str, args)])
        return out.getvalue()

    def probed(self, text: str, *args) -> dict:
        path = self.home / "probe.py"
        path.write_text(text)
        self.call("probe", "f", path, *args)
        return doctor.rows(self.evidence)[-1]

    def test_a_probe_proves_a_defect_only_against_a_control_that_answers_otherwise(self):
        text = "from shop import price\ndef probe(): return price.total(2), 4\n"
        controlled = text + "def control(): return price.total(0), 0\n"
        for source, tree, found in ((text, self.broken, "uncontrolled"), (controlled, self.broken, "shown"),
                                    (controlled, self.fixed, "indiscriminate"),
                                    (text + "def control(): return price.total(2), 4\n", self.broken, "indiscriminate"),
                                    (text + "def control(): return 2, 2\n", self.broken, "indiscriminate"),
                                    (text + "def control(): raise KeyError('x')\n", self.broken, "broken")):
            with self.subTest(found=found):
                self.assertEqual(self.probed(source, "--tree", tree)["verdict"], found)
        row = self.probed(text, "--tree", self.broken, "--control-tree", self.fixed, "--before", self.broken)
        self.assertEqual((row["verdict"], row["before"]), ("shown", "present"))
        self.assertEqual(self.probed(text, "--tree", self.fixed, "--control-tree", self.broken)["verdict"], "absent")

    def test_a_probe_that_crashes_exits_or_hangs_proves_nothing(self):
        for body in ("raise KeyError('prediction')", "raise SystemExit(0)", "__import__('os')._exit(0)",
                     "__import__('time').sleep(60)"):
            with self.subTest(body=body):
                row = self.probed(f"def probe(): {body}\ndef control(): return 1, 1\n", "--tree", self.fixed,
                                  "--timeout", "5")
                self.assertEqual(row["verdict"], "broken")

    def test_a_probe_reads_the_named_tree_and_no_other(self):
        self.commit({"shop/price.py": "def total(n): return 7\n"})
        text = "from shop import price\ndef probe(): return price.total(2), 4\n"
        self.assertEqual(self.probed(text, "--tree", self.broken)["main"]["observed"], "2")
        outside = f"import sys; sys.path.insert(0, {str(self.repo)!r})\n" + text
        self.assertIn("was imported from", self.probed(outside, "--tree", self.broken)["main"]["why"])

    def test_a_repair_is_confirmed_only_by_its_own_test_failing_without_it(self):
        self.call("recheck", self.fixed, "--tree", self.fixed)
        row = doctor.rows(self.evidence)[-1]
        self.assertEqual((row["verdict"], row["tests"]), ("confirmed", ["tests.test_price.T.test_total"]))
        later = self.commit({"shop/price.py": "def total(n): return n\n"})
        self.call("recheck", self.fixed, "--tree", later)
        self.assertEqual(doctor.rows(self.evidence)[-1]["verdict"], "regressed")
        self.call("recheck", later, "--tree", later)
        self.assertEqual(doctor.rows(self.evidence)[-1]["verdict"], "no test")

    def test_a_repair_whose_reverted_tree_cannot_import_or_whose_tests_skip_is_undecided(self):
        repaired = self.commit({"shop/tax.py": "def rate(): return 1\n", "tests/test_tax.py":
                                "import unittest\nfrom shop.tax import rate\nclass T(unittest.TestCase):\n"
                                "    def test_rate(self): self.assertEqual(rate(), 1)\n"})
        self.call("recheck", repaired, "--tree", repaired)
        row = doctor.rows(self.evidence)[-1]
        self.assertEqual((row["verdict"], row["outcomes"]["reverted"]["error"]), ("undecided", 1))
        skipped = {"t": "skip"}
        self.assertEqual(doctor.judge(skipped, {"t": "fail"}, skipped), ("undecided", []))
        self.assertEqual(doctor.judge({"t": "ok"}, {"t": "fail"}, {}), ("undecided", ["t"]))

    def test_coverage_counts_only_commands_that_ran_and_showed_something_of_their_own(self):
        page = self.home / "page.txt"
        draw = f"open({str(page)!r}, 'w').write('the first page')"
        shell = (sys.executable, "-c")
        for item, subject, artifact, code in (("pages", "empty", page, draw + "; print(1)"),
                                              ("pages", "records", page, draw + "; print(2)"),
                                              ("pages", "reload", page, "print(5)"),
                                              ("gates", "empty", None, ""), ("gates", "failed", None, "print('skipped=3')"),
                                              ("faults", "live", None, "print('x'); raise SystemExit(1)"),
                                              ("faults", "docker", self.home / "none", "print(3)"),
                                              ("consumers", "cli", None, "print(4)")):
            option = ("--artifact", artifact) if artifact else ()
            self.call("run", item, subject, *option, "--", *shell, code)
        said = {(row["item"], row["subject"]): doctor.state(row, doctor.rows(self.evidence))
                for row in doctor.rows(self.evidence)}
        self.assertEqual(said, {("pages", "empty"): "same as another", ("pages", "records"): "same as another",
                                ("pages", "reload"): "no artifact",
                                ("gates", "empty"): "empty", ("gates", "failed"): "skipped tests",
                                ("faults", "live"): "failed", ("faults", "docker"): "no artifact",
                                ("consumers", "cli"): "examined"})
        text = self.call("report")
        self.assertTrue(text.startswith("# Partial audit"))
        for missing in ("pages/empty", "gates/partial", "cost/replay", "interrupt", "governance"):
            self.assertIn(missing, text.splitlines()[2])
        self.assertNotIn("faults/live", text.splitlines()[2])
        self.assertIn("| faults | live | failed |", text)
        with self.assertRaises(SystemExit):
            self.call("run", "pages", "market", "--", *shell, "1")

    def test_everything_recorded_is_a_full_audit(self):
        for item, subjects in doctor.items().items():
            for subject in ["x"] if subjects == ["any"] else subjects:
                doctor.keep(self.evidence, {"kind": "run", "item": item, "subject": subject, "command": ["true"],
                                            "checkout": "c" * 40, "dirty": False, "exit": 0, "output_bytes": 1,
                                            "output_sha256": subject, "skipped": 0, "artifact": None,
                                            "artifact_sha256": None})
        self.assertTrue(self.call("report").startswith("# Full audit"))
        kept = self.evidence / "evidence.jsonl"
        kept.write_text("".join(line for line in kept.read_text().splitlines(True) if '"governance"' not in line))
        self.assertTrue(self.call("report").startswith("# Partial audit\n\nNot exercised: governance."))

    def test_a_cost_is_a_growth_rate_only_when_the_sizes_are_apart(self):
        quadratic = doctor.read_cost({n: [9.0, n * n, n * n * 1.01, n * n * 1.02] for n in (1, 2, 4)})
        self.assertEqual((quadratic["verdict"], round(quadratic["exponent"])), ("measured", 2))
        cold_start = doctor.read_cost({3: [0.19, 0.04, 0.05, 0.04], 6: [0.04, 0.04, 0.05, 0.04], 12: [.04, .04, .05, .04]})
        self.assertEqual((cold_start["verdict"], cold_start["exponent"]), ("noisy", None))

    def test_the_real_audit_list_is_readable(self):
        self.assertIn("interrupt", doctor.items())
