"""If this fails, an audit can again claim what its own commands did not show (.agents/skills/product-doctor)."""

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

    def test_a_refutation_is_a_probe_of_its_own_beside_the_claim(self):
        text = "from shop import price\ndef probe(): return price.total(2), 4\ndef control(): return price.total(0), 0\n"
        with self.assertRaises(SystemExit):
            self.probed(text, "--tree", self.broken, "--refutes")
        self.probed(text, "--tree", self.broken)
        with self.assertRaises(SystemExit):
            self.probed(text, "--tree", self.broken, "--refutes")
        self.assertIn("| none |", self.call("report", "--tree", "HEAD"))
        row = self.probed(text.replace("(2), 4", "(3), 6"), "--tree", self.broken, "--refutes")
        self.assertEqual((row["kind"], row["verdict"]), ("refutation", "shown"))
        text = self.call("report", "--tree", "HEAD")
        self.assertIn("Shown: 1 of 1 probed.", text)
        self.assertIn("Shown by a refuter's own probe too: 1.", text)

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
        for item, subject, artifact, code in (("pages", "shop:empty", page, draw + "; print(1)"),
                                              ("pages", "shop:records", page, draw + "; print(2)"),
                                              ("pages", "shop:reload", page, "print(5)"),
                                              ("gates", "shop:empty", None, ""), ("gates", "shop:failed", None, "print('skipped=3')"),
                                              ("faults", "shop:live", None, "print('x'); raise SystemExit(1)"),
                                              ("faults", "shop:docker", self.home / "none", "print(3)"),
                                              ("consumers", "shop:cli", None, "print(4)")):
            option = ("--artifact", artifact) if artifact else ()
            self.call("run", item, subject, *option, "--", *shell, code)
        said = {(row["item"], row["subject"]): doctor.state(row, doctor.rows(self.evidence))
                for row in doctor.rows(self.evidence)}
        self.assertEqual(said, {("pages", "shop:empty"): "same as another", ("pages", "shop:records"): "same as another",
                                ("pages", "shop:reload"): "no artifact",
                                ("gates", "shop:empty"): "empty", ("gates", "shop:failed"): "skipped tests",
                                ("faults", "shop:live"): "failed", ("faults", "shop:docker"): "no artifact",
                                ("consumers", "shop:cli"): "examined"})
        text = self.call("report", "--tree", "HEAD")
        self.assertTrue(text.startswith("# Partial audit"))
        for missing in ("pages/empty", "gates/partial", "cost/replay", "interrupt", "governance", "tests (object)"):
            self.assertIn(missing, text.splitlines()[2])
        self.assertNotIn("faults/live", text.splitlines()[2])
        self.assertIn("| faults | shop:live | failed |", text)

    def test_everything_recorded_is_a_full_audit(self):
        for item, subjects in doctor.items().items():
            for subject in ["shop:x"] if subjects == ["any"] else [f"shop+tests:{scenario}" for scenario in subjects]:
                doctor.keep(self.evidence, {"kind": "run", "item": item, "subject": subject, "command": ["true"],
                                            "checkout": "c" * 40, "dirty": False, "exit": 0, "output_bytes": 1,
                                            "output_sha256": subject, "skipped": 0, "artifact": None,
                                            "artifact_sha256": None})
        self.assertTrue(self.call("report", "--tree", "HEAD").startswith("# Full audit"))
        self.call("unexamined", "parity", "@redis:restart", "no server")
        self.assertIn("| parity | @redis:restart | not examined | no server |", self.call("report", "--tree", "HEAD"))
        self.assertTrue(self.call("report", "--tree", "HEAD").startswith("# Partial audit"))
        self.call("run", "parity", "@redis:restart", "--", sys.executable, "-c", "print('restarted')")
        self.assertTrue(self.call("report", "--tree", "HEAD").startswith("# Full audit"))
        kept = self.evidence / "evidence.jsonl"
        kept.write_text("".join(line for line in kept.read_text().splitlines(True) if '"governance"' not in line))
        self.assertTrue(self.call("report", "--tree", "HEAD").startswith("# Partial audit\n\nNot exercised: governance."))
        kept.write_text("".join(line for line in kept.read_text().splitlines(True) if "shop+tests" not in line))
        self.assertIn("tests (object)", self.call("report", "--tree", "HEAD").splitlines()[2])

    def test_a_subject_names_an_object_of_the_tree_or_one_outside_it(self):
        for subject in ("empty", "nowhere:x", "shop/none.py:x", "@:x", "shop:", "shop+tests+@redis:x", "shop/../tests:x"):
            with self.assertRaises(SystemExit):
                self.call("run", "parity", subject, "--", sys.executable, "-c", "print(1)")
        for subject in ("shop/price.py:x", "shop+@redis:x"):
            self.call("run", "parity", subject, "--", sys.executable, "-c", "print(1)")
            self.assertIn("shop", doctor.covers(subject, doctor.objects("HEAD")))

    def test_a_themed_audit_is_judged_only_against_the_scope_it_declared_first(self):
        with self.assertRaises(SystemExit):
            self.call("scope", "slim", "--tree", "HEAD")
        self.call("scope", "slim", "--items", "size,pages/empty", "--objects", "shop", "--tree", "HEAD")
        shell = ("--", sys.executable, "-c")
        self.call("run", "size", "shop:lines", *shell, "print(1)")
        text = self.call("report", "--tree", "HEAD")
        self.assertTrue(text.startswith("# Partial themed audit: slim"))
        self.assertIn("Not exercised: pages/empty.", text)
        self.call("run", "pages", "tests:empty", *shell, "print('elsewhere')")
        self.assertIn("Not exercised: pages/empty.", self.call("report", "--tree", "HEAD"))
        for _ in range(2):
            self.call("run", "pages", "shop:empty", "--artifact", self.home / "none", *shell, "print(0)")
        self.call("run", "pages", "shop:empty", *shell, "print(2); raise SystemExit(1)")
        self.call("run", "pages", "shop:empty", *shell, "print(3)")
        text = self.call("report", "--tree", "HEAD")
        self.assertTrue(text.startswith("# Themed audit: slim"))
        self.assertIn("(of 4 attempts: 2 no artifact)", text)
        self.assertEqual(text.count("| pages | shop:empty | failed |"), 1)  # a later success hides no failure
        with self.assertRaises(SystemExit):
            self.call("scope", "slim", "--items", "size", "--objects", "shop", "--tree", "HEAD")

    def test_a_harm_audit_without_a_probe_is_partial(self):
        self.call("scope", "harm", "--objects", "shop", "--tree", "HEAD")
        self.probed("raise SystemExit", "--tree", "HEAD")
        self.assertTrue(self.call("report", "--tree", "HEAD").startswith("# Partial themed audit: harm"))

    def test_scan_lists_the_tree_and_when_the_records_last_exercised_it(self):
        self.commit({"README.md": "a\n", "notes/a.md": "a\n", "docs/x.mdx": "a\n",
                     "docs/plans/doctor/2026-01-02-a.zh.md": "| results | shop:sum | examined | x |\n"
                                                             "| cost | tests:t | noisy | x |\n"
                                                             "| external | gone/part+@venue:x | examined | x |\n"})
        os.chdir(self.repo / "shop")
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["scan", "--tree", "HEAD"])
        read = json.loads(out.getvalue())
        self.assertEqual({name: row["examined"] for name, row in read["objects"].items() if "/" not in name},
                         {"docs": None, "notes": None, ".": None, "shop": "2026-01-02", "tests": None})
        self.assertEqual((read["items"]["results"], read["items"]["cost"]), ("2026-01-02", None))
        self.assertEqual(read["objects"]["shop"]["commits"], 2)
        self.assertEqual(read["outside"], {"@venue": "2026-01-02"})
        self.assertIn("in earlier records but not here: @venue.", self.call("report", "--tree", "HEAD"))

    def test_scan_queues_what_records_left_unexamined_until_a_later_one_exercises_it(self):
        self.commit({"docs/plans/doctor/2026-01-02-a.zh.md": "| gates | shop:partial | not examined | no fake |\n"
                                                             "| parity | gone:x | not examined | moved |\n"
                                                             "| cost | shop:a\\|b | not examined | big \\| slow |\n"
                                                             "| results | shop:sum | examined | x |\n",
                     "docs/plans/doctor/2026-01-05-b.zh.md": "| gates | shop:partial | examined | x |\n"
                                                             "| words | tests:help | not examined | no time |\n"})

        def queued():
            out = io.StringIO()
            with redirect_stdout(out):
                doctor.main(["scan", "--tree", "HEAD"])
            return [(row["item"], row["subject"], row["since"], row["why"]) for row in json.loads(out.getvalue())["unexamined"]]

        self.assertEqual(queued(), [("cost", "shop:a|b", "2026-01-02", "big | slow"), ("words", "tests:help", "2026-01-05", "no time")])
        self.commit({"docs/plans/doctor/2026-01-09-c.zh.md": "| words | tests:help | failed | x |\n"})
        self.assertEqual([row[0] for row in queued()], ["cost"])

    def test_every_file_belongs_to_one_object_in_any_layout(self):
        self.git("rm", "-qr", ".")
        big, small, tiny = "x\n" * 300, "x\n" * 30, "x\n"
        rev = self.commit({"src/a/m.py": big, "src/b/deep/m.py": big, "src/c/m.py": small, "src/d/m.py": tiny,
                           "src/top.py": tiny, "rules/only.md": tiny, "empty/.keep": "", "a name.txt": tiny})
        found = doctor.objects(rev)
        self.assertLessEqual({".", "rules", "src", "src/a", "src/c"}, set(found))
        self.assertEqual((found["src"]["folded"], found["."]["folded"]), (["src/d"], ["empty"]))
        paths = self.git("ls-tree", "-r", "--name-only", rev).splitlines()
        self.assertEqual(sum(row["lines"] for row in found.values()), sum((self.repo / p).read_text().count("\n") for p in paths))
        self.assertEqual(doctor.owner("src/d/m.py", found), "src")
        self.assertNotIn("src/a", doctor.covers("src/top.py:x", found))

    def test_names_growth_and_moves_hide_no_file_and_credit_no_other(self):
        self.git("rm", "-qr", ".")
        rev = self.commit({"doc/a": "x\n", "docs": "x\n", "é/x": "x\n", "a+b/x": "x\n", "a/x": "x\n", "@x/y": "x\n",
                           "root/x": "x\n", "new\nline": "x\n", "app/x": "x\n",
                           **{f"many/p{n}/m.py": "x\n" * 20 for n in range(200)},
                           "docs2/x": "x\n", ".gitattributes": "a/** binary\n"})
        found = doctor.objects(rev)
        self.assertEqual(sum(row["lines"] for row in found.values()), sum(doctor.tracked(rev).values()))
        self.assertLessEqual({".", "doc", "é", "a%2Bb", "a", "%40x", "root", "many/p0", "many/p199"}, set(found))
        self.assertEqual(doctor.covers("a%2Bb:s", found), {"a%2Bb"})
        self.git("rm", "-qr", "doc", "docs")
        self.commit({doctor.RECORDS + "2026-01-02 b.md": "", doctor.RECORDS + "2026-01-02-b.md":
                     "| results | app/gone:s | examined | x |\n| results | a:s | examined | x |\n"})
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["scan", "--tree", "HEAD"])
        read = json.loads(out.getvalue())["objects"]
        self.assertEqual((read["app"]["examined"], read["a"]["examined"], read["é"]["added"]), (None, "2026-01-02", 1))

    def test_a_cost_is_a_growth_rate_only_when_the_sizes_are_apart(self):
        quadratic = doctor.read_cost({n: [9.0, n * n, n * n * 1.01, n * n * 1.02] for n in (1, 2, 4)})
        self.assertEqual((quadratic["verdict"], round(quadratic["exponent"])), ("measured", 2))
        cold_start = doctor.read_cost({3: [0.19, 0.04, 0.05, 0.04], 6: [0.04, 0.04, 0.05, 0.04], 12: [.04, .04, .05, .04]})
        self.assertEqual((cold_start["verdict"], cold_start["exponent"]), ("noisy", None))
        steep = doctor.read_cost({1: [1, .172, .190, .172], 8: [1, 1.238, 1.267, 1.237], 64: [1, 13.894, 15.133, 12.91]})
        self.assertEqual((steep["verdict"], steep["exponent"]), ("measured", 1.06))

    def test_a_repair_of_a_skill_script_is_rechecked(self):
        path = ".agents/skills/s/assets/tool.py"
        test = ("import pathlib, unittest\nclass T(unittest.TestCase):\n"
                "    def test_it(self): self.assertIn('2', pathlib.Path('" + path + "').read_text())\n")
        self.commit({path: "x = 1\n"})
        repair = self.commit({path: "x = 2\n", "tests/test_tool.py": test})
        self.call("recheck", repair, "--tree", "HEAD")
        self.assertEqual(doctor.rows(self.evidence)[-1]["verdict"], "confirmed")

    def test_the_real_audit_list_is_readable(self):
        self.assertIn("interrupt", doctor.items())
