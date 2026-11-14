"""The replay image holds exactly the import closure of what a replay runs (docs/plans/replay-image-20261111.zh.md).

A file missing from any of the four lists below either leaves a replay change out of the main build's source proof
or out of the image; an extra one rebuilds the replay image, and so moves research's identity, for a change no replay
executes.
"""

import ast
from pathlib import Path
import re
import shlex
import textwrap
import sys
import subprocess
import unittest

from engine.config import AUDIT_PATH, RUNTIME_CONTRACT, RUNTIME_SOURCE_PATHS
from runtime import image


ROOT = Path(__file__).resolve().parents[2]
ENTRIES = ("engine.run", "engine.audit", "engine.compare")
REPLAY_DOCKERFILE = ROOT / "engine/runtime/replay.Dockerfile"
EXECUTION_DOCKERFILE = ROOT / "engine/runtime/Dockerfile"
WORKFLOW = ROOT / ".github/workflows/runtime-image.yml"
FIRST_PARTY = frozenset(path.parent.name for path in ROOT.glob("*/__init__.py"))


def imports(module: str) -> set[str]:
    """The first-party modules `module` imports, at any depth of its source."""
    found = set()
    for node in ast.walk(ast.parse((ROOT / (module.replace(".", "/") + ".py")).read_text())):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise AssertionError(f"{module} uses a relative import")
            base = node.module or ""
            names = [base]
            if base == "engine":
                names = [f"engine.{alias.name}" for alias in node.names]
        else:
            continue
        found.update(name for name in names if name.split(".")[0] in FIRST_PARTY)
    return found


def closure() -> set[str]:
    seen, pending = set(), list(ENTRIES)
    while pending:
        module = pending.pop()
        if module in seen:
            continue
        outside = {name for name in imports(module) if name.split(".")[0] != "engine"}
        if outside:
            raise AssertionError(f"{module} imports {sorted(outside)}, which the replay image does not hold")
        seen.add(module)
        pending.extend(imports(module))
    return {module.replace(".", "/") + ".py" for module in seen} | {"engine/__init__.py"}


def instructions(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text().splitlines() if line.strip() and not line.startswith("#")]


def local_copies(path: Path) -> set[str]:
    sources = set()
    for line in instructions(path):
        words = shlex.split(line)
        if words[0] == "COPY" and not words[1].startswith("--from="):
            sources.update(words[1:-1])
    return sources


def workflow_list(marker: str) -> list[str]:
    """The indented lines under the first `marker` line of the workflow."""
    lines = WORKFLOW.read_text().splitlines()
    start = next(index for index, line in enumerate(lines) if line.strip() == marker)
    indent = len(lines[start + 1]) - len(lines[start + 1].lstrip())
    found = []
    for line in lines[start + 1:]:
        if len(line) - len(line.lstrip()) != indent or not line.strip():
            break
        found.append(line.strip().removeprefix("- "))
    return found


class ReplayClosureTests(unittest.TestCase):
    def test_the_four_lists_are_the_replay_closure(self):
        expected = closure()
        layout = image.layout(RUNTIME_CONTRACT)
        engine_paths = {path for path in workflow_list("CI_PATHS: |") if path.startswith("engine/")
                        and path.endswith(".py")}
        engine_copies = {path for path in local_copies(REPLAY_DOCKERFILE) if path.startswith("engine/")}
        for name, listed in (("RUNTIME_SOURCE_PATHS", {*RUNTIME_SOURCE_PATHS.values(), AUDIT_PATH}),
                             ("LAYOUTS", {*layout["source_paths"].values(), layout["audit_path"]}),
                             ("replay.Dockerfile COPY", engine_copies),
                             ("replay path filter", engine_paths)):
            with self.subTest(name=name):
                self.assertEqual(listed, expected)

    def test_the_replay_image_copies_nothing_else_and_the_filter_names_its_build_inputs(self):
        self.assertEqual(local_copies(REPLAY_DOCKERFILE) - closure(), {"pyproject.toml", "uv.lock"})
        others = {path for path in workflow_list("CI_PATHS: |") if not path.startswith("engine/") or
                  not path.endswith(".py")}
        self.assertEqual(others, {".github/workflows/runtime-image.yml", "engine/runtime/replay.Dockerfile",
                                  "engine/runtime/replay.Dockerfile.dockerignore", "pyproject.toml", "uv.lock"})

    def test_fresh_install_waits_for_a_replay_image_only_when_the_replay_inputs_changed(self):
        """ide-image's fresh-install replays on this commit's replay image when its replay inputs changed, else on
        `main`: it must read runtime-image.yml's replay filter and select with replay-changed.py, or a change to the
        execution image or to pyproject's build backend alone would leave it waiting for a replay image no build makes."""
        job = (ROOT / ".github/workflows/ide-image.yml").read_text().split("\n  fresh-install:\n", 1)[1]
        script = textwrap.dedent(job.split("python3 -c '", 1)[1].split("\n          ')\"", 1)[0])
        found = subprocess.run([sys.executable, "-c", script], cwd=ROOT, capture_output=True, text=True, check=True)
        self.assertEqual(found.stdout.split(), workflow_list("CI_PATHS: |"))
        selectors = re.findall(r"python3 (\.github/scripts/\S+\.py)", job.split("\n  gate:\n", 1)[0])
        self.assertEqual(selectors, [".github/scripts/replay-changed.py"])

    def test_pyproject_holds_only_the_project_and_its_dependencies(self):
        # pyproject.toml is copied into the replay image, so a change to it selects a replay build unless only its
        # version or build backend changed (replay-changed.py): tool configuration (ruff.toml, mypy.ini) stays out.
        tables = {line.strip("[] ") for line in (ROOT / "pyproject.toml").read_text().splitlines()
                  if line.startswith("[")}
        self.assertEqual(tables, {"project", "dependency-groups", "build-system", "tool.uv.build-backend"})

    def test_the_execution_image_repeats_the_replay_image_steps_before_its_own(self):
        replay = [line for line in instructions(REPLAY_DOCKERFILE) if not line.startswith(("LABEL", "CMD"))]
        execution = [line for line in instructions(EXECUTION_DOCKERFILE) if " AS paper-cache" not in line]
        self.assertEqual(execution[:len(replay)], replay)
        self.assertIn("COPY engine/*.py ./engine/", execution[len(replay):])

    def test_every_replay_input_also_triggers_the_workflow_and_the_execution_build(self):
        push = workflow_list("paths:")
        execution = workflow_list("paths: |")
        self.assertEqual(push, execution)
        for path in workflow_list("CI_PATHS: |"):
            with self.subTest(path=path):
                self.assertTrue(any(Path(path).full_match(pattern) for pattern in execution), path)
