"""Exercise the actual path selector and gate commands at their failure boundaries."""

import itertools
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
SELECTOR = ROOT / ".github/scripts/ci-paths.py"
GATE = ROOT / ".github/actions/gate/action.yml"
# workflow: (gate job name, a required status check on main; jobs that run on every event; jobs left out of the gate)
GATES = {
    "docs-pages": ("docs-gate", "", {"deploy"}),  # main only, after the gate reported
    "ide-web": ("ide-web-gate", "", set()),
    "ide-image": ("ide-image-gate", "", set()),
    "quality": ("quality", "skill-names", set()),
    "remote-paper-auth": ("remote-paper-auth-gate", "", set()),
}
PUSH_FILTERED = ("docs-pages", "ide-web", "ide-image", "runtime-image", "remote-paper-auth")
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


def section(source, start, end="\n  [a-z-]+:\n"):
    """The text after the first `start` up to the next match of `end` (by default the next job)."""
    return re.split(end, source.split(start, 1)[1], maxsplit=1)[0]


class WorkflowWiringTests(unittest.TestCase):
    def test_each_gate_keeps_its_check_name_and_hands_every_other_job_to_the_shared_gate(self):
        for name, (check, always, outside) in GATES.items():
            jobs = (ROOT / f".github/workflows/{name}.yml").read_text().split("\njobs:\n", 1)[1]
            gate = jobs.split("\n  gate:\n", 1)[1]
            needs = re.fullmatch(r"    name: (\S+)\n    if: always\(\)\n    needs: \[(.*)\]", "\n".join(gate.splitlines()[:3]))
            with self.subTest(workflow=name):
                self.assertEqual(needs[1], check)
                self.assertEqual(set(needs[2].split(", ")), set(re.findall(r"^  ([a-z-]+):$", jobs, re.M)) - {"gate"} - outside)
                self.assertIn("      - uses: ./.github/actions/gate\n        with:\n          needs: ${{ toJSON(needs) }}\n"
                              + (f"          always: {always}\n" if always else ""), gate)

    def test_push_paths_equal_the_paths_the_changes_job_selects(self):
        # release-ready.cjs reads "no push run" as "nothing to release", so the two lists must not drift apart.
        for name in PUSH_FILTERED:
            source = (ROOT / f".github/workflows/{name}.yml").read_text()
            push = re.findall(r"^      - (\S+)$", section(source, "\n  push:\n", "\n  [a-z_]+:\n"), re.M)
            selected = section(section(source, "\n  changes:\n"), "          paths: |\n", "\n(?! {12})")
            with self.subTest(workflow=name):
                self.assertTrue(push)
                self.assertEqual(push, [line.strip() for line in selected.splitlines()])


@unittest.skipUnless(shutil.which("jq"), "CI gate probes require jq (present on CI runners)")
class CiGateTests(unittest.TestCase):
    OUTCOMES = ("success", "failure", "cancelled", "skipped")

    def passes(self, command, needs, always=""):
        result = subprocess.run(
            ["bash", "-e", "-c", command],
            env={**os.environ, "NEEDS": json.dumps(needs), "ALWAYS": always},
            capture_output=True,
            text=True,
        )
        return result.returncode == 0

    def assert_fails_closed(self, command, jobs, always=()):
        """Every selector state and job outcome: pass only on a clean selector with each job as it selected."""
        for changed, selector_result, results in itertools.product(
            ("true", "false", "", "invalid"), self.OUTCOMES,
            itertools.product(self.OUTCOMES, repeat=len(jobs) + len(always)),
        ):
            needs = {"changes": {"result": selector_result, "outputs": {"changed": changed}}}
            needs.update({job: {"result": result} for job, result in zip(jobs + always, results, strict=True)})
            selected, unconditional = results[:len(jobs)], results[len(jobs):]
            expected = selector_result == "success" and all(r == "success" for r in unconditional) and (
                (changed == "true" and all(r == "success" for r in selected))
                or (changed == "false" and all(r == "skipped" for r in selected))
            )
            with self.subTest(changed=changed, selector=selector_result, results=results, always=always):
                self.assertEqual(self.passes(command, needs, " ".join(always)), expected)

    def test_the_shared_gate_fails_closed_for_failed_cancelled_or_unexpectedly_skipped_jobs(self):
        command = textwrap.dedent(GATE.read_text().split("      run: |\n", 1)[1])
        self.assert_fails_closed(command, ("build",))
        self.assert_fails_closed(command, ("tests",), ("skill-names",))
        selector = {"result": "success", "outputs": {"changed": "true"}}
        for needs, always in (
            ({"changes": selector, "build": {"result": "success"}, "agent": {"result": "skipped"}}, ""),
            ({"changes": selector, "tests": {"result": "success"}}, "skill-names"),  # a named job that is not needed
            ({"changes": selector, "image": {"result": "success"}, "replay-image": {"result": "failure"}}, " image\n"),
        ):
            with self.subTest(needs=needs, always=always):
                self.assertFalse(self.passes(command, needs, always))

    def test_the_runtime_image_gate_requires_each_selected_image_and_skips_each_unselected_one(self):
        source = (ROOT / ".github/workflows/runtime-image.yml").read_text()
        command = textwrap.dedent(source.split("\n  gate:\n", 1)[1].split("        run: |\n", 1)[1])
        images = {"replay": ("replay-image", "replay-manifest"), "execution": ("image", "manifest")}
        outcomes = ("success", "failure", "cancelled", "skipped")
        for replay, execution, selector_result in itertools.product(
            ("true", "false", "invalid"), ("true", "false", ""), ("success", "failure")
        ):
            for results in itertools.product(outcomes, repeat=4):
                needs = {"changes": {"result": selector_result, "outputs": {"replay": replay, "execution": execution}}}
                jobs = dict(zip((*images["replay"], *images["execution"]), results, strict=True))
                needs.update({job: {"result": result} for job, result in jobs.items()})

                def selected(changed, names):
                    return ((changed == "true" and all(jobs[name] == "success" for name in names))
                            or (changed == "false" and all(jobs[name] == "skipped" for name in names)))
                expected = (selector_result == "success" and selected(replay, images["replay"])
                            and selected(execution, images["execution"]))
                with self.subTest(replay=replay, execution=execution, selector=selector_result, results=results):
                    self.assertEqual(self.passes(command, needs), expected)


class ReplaySelectorTests(unittest.TestCase):
    """.github/scripts/replay-changed.py: a push compares with the revision the current replay image was built from."""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("replay_changed", ROOT / ".github/scripts/replay-changed.py")
        self.selector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.selector)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.base = self.commit("README.md")
        self.built = self.commit("engine/run.py")
        self.other = self.commit("engine/paper.py")
        cwd = os.getcwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, cwd)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, name):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{name} {len(list(self.repo.rglob('*')))}\n")
        self.git("add", ".")
        self.git("-c", "user.name=CI", "-c", "user.email=ci@example.com", "commit", "-qm", name)
        return self.git("rev-parse", "HEAD")

    def select(self, event, base="", built=None):
        self.selector.built_from = lambda image: built
        return self.selector.changed(event, ["engine/run.py"], base, "registry.example/name:main")

    def test_a_push_builds_only_when_a_replay_input_differs_from_the_image_build(self):
        self.assertFalse(self.select("push", built=self.built))  # only engine/paper.py changed since that build
        self.commit("engine/run.py")
        self.assertTrue(self.select("push", built=self.built))
        self.assertTrue(self.select("push", built=None))  # no readable image: build
        self.assertTrue(self.select("push", built="f" * 40))  # a revision this history lacks: build

    def test_a_pull_request_compares_with_its_base_and_other_events_build(self):
        self.assertFalse(self.select("pull_request", base=self.built))
        self.assertTrue(self.select("pull_request", base=self.base))
        self.assertTrue(self.select("workflow_dispatch"))
        with self.assertRaises(ValueError):
            self.select("pull_request")
