"""Exercise the actual path selector and gate commands at their failure boundaries."""

import itertools
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
SELECTOR = ROOT / ".github/scripts/ci-paths.py"
WORKFLOWS = ("docs-pages", "ide-web", "runtime-image", "ide-image", "quality")
TESTED = "**\n!docs/**\n!.agents/evals/**"


class CiPathsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("-c", "user.name=CI", "-c", "user.email=ci@example.com", "commit", "--allow-empty", "-qm", "base")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True, text=True)

    def commit_files(self, *names):
        for name in names:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("changed\n", encoding="utf-8")
        self.git("add", ".")
        self.git("-c", "user.name=CI", "-c", "user.email=ci@example.com", "commit", "-qm", "change")

    def select(self, paths, *, base=None, event="pull_request"):
        output = self.repo / ".git/ci-output"
        output.unlink(missing_ok=True)
        result = subprocess.run(
            [sys.executable, str(SELECTOR)],
            cwd=self.repo,
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "CI_EVENT_NAME": event,
                "CI_BASE_SHA": self.base if base is None else base,
                "CI_PATHS": paths,
                "GITHUB_OUTPUT": str(output),
            },
        )
        return result.returncode, output.read_text() if output.exists() else ""

    def test_unrelated_change_is_explicitly_skippable(self):
        self.commit_files("README.md")
        self.assertEqual(self.select("docs/**\ndocs-site/**"), (0, "changed=false\n"))

    def test_direct_nested_and_deleted_inputs_are_detected(self):
        for name in ("engine/run.py", "engine/nested/run.py", "engine/runtime/Dockerfile"):
            with self.subTest(name=name):
                self.commit_files(name)
                self.assertEqual(self.select("engine/**/*.py\nengine/**/Dockerfile*"), (0, "changed=true\n"))
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("rm", "engine/run.py")
        self.git("-c", "user.name=CI", "-c", "user.email=ci@example.com", "commit", "-qm", "delete")
        self.assertEqual(self.select("engine/**/*.py"), (0, "changed=true\n"))

    def test_paths_after_the_first_300_files_are_not_lost(self):
        self.commit_files(*(f"aaa/{n:03}.txt" for n in range(350)), "docs/last.md")
        self.assertEqual(self.select("docs/**"), (0, "changed=true\n"))

    def test_only_a_change_inside_the_left_out_trees_skips_the_tests(self):
        self.commit_files("docs/plans/note.md", ".agents/evals/skill/case/prompt.md")
        self.assertEqual(self.select(TESTED), (0, "changed=false\n"))
        for name in ("new/file.txt", ".agents/skills/skill/SKILL.md", "docs.py", ".github/workflows/quality.yml"):
            with self.subTest(name=name):
                self.base = self.git("rev-parse", "HEAD").stdout.strip()
                self.commit_files(name)
                self.assertEqual(self.select(TESTED), (0, "changed=true\n"))

    def test_code_moved_into_a_left_out_tree_runs_the_tests(self):
        self.commit_files("engine/run.py")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        (self.repo / "docs").mkdir()
        self.git("mv", "engine/run.py", "docs/run.py")
        self.git("-c", "user.name=CI", "-c", "user.email=ci@example.com", "commit", "-qm", "move")
        self.assertEqual(self.select(TESTED), (0, "changed=true\n"))

    def test_bad_base_and_empty_patterns_fail_without_output(self):
        for paths, base in (("docs/**", "missing-ref"), ("", self.base), ("docs/**", "")):
            with self.subTest(paths=paths, base=base):
                code, output = self.select(paths, base=base)
                self.assertNotEqual(code, 0)
                self.assertEqual(output, "")

    def test_push_and_dispatch_run_without_a_pr_diff(self):
        for event in ("push", "workflow_dispatch"):
            self.assertEqual(self.select("", base="", event=event), (0, "changed=true\n"))


@unittest.skipUnless(shutil.which("jq"), "CI gate probes require jq (present on CI runners)")
class CiGateTests(unittest.TestCase):
    def test_actual_gates_fail_closed_for_failed_cancelled_or_unexpectedly_skipped_jobs(self):
        for name in WORKFLOWS:
            source = (ROOT / f".github/workflows/{name}.yml").read_text()
            gate = source.split("\n  gate:\n", 1)[1]
            command = textwrap.dedent(gate.split("        run: |\n", 1)[1])
            jobs = {"ide-web": ("build", "agent"), "docs-pages": ("build",), "quality": ("tests",)}.get(name, ("image",))
            always = {"quality": ("skill-names",)}.get(name, ())  # run on every PR whatever the selector says
            for changed, selector_result in itertools.product(
                ("true", "false", "", "invalid"), ("success", "failure", "cancelled", "skipped")
            ):
                outcomes = ("success", "failure", "cancelled", "skipped")
                for results in itertools.product(outcomes, repeat=len(jobs) + len(always)):
                    needs = {"changes": {"result": selector_result, "outputs": {"changed": changed}}}
                    needs.update({job: {"result": result} for job, result in zip(jobs + always, results, strict=True)})
                    selected, unconditional = results[:len(jobs)], results[len(jobs):]
                    expected = selector_result == "success" and all(r == "success" for r in unconditional) and (
                        (changed == "true" and all(r == "success" for r in selected))
                        or (changed == "false" and all(r == "skipped" for r in selected))
                    )
                    with self.subTest(workflow=name, changed=changed, selector=selector_result, results=results):
                        result = subprocess.run(
                            ["bash", "-e", "-c", command],
                            env={**os.environ, "NEEDS": json.dumps(needs)},
                            capture_output=True,
                            text=True,
                        )
                        self.assertEqual(result.returncode == 0, expected)
