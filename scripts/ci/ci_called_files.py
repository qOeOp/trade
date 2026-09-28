#!/usr/bin/env python3
"""
Print every repository file a CI workflow can execute, one path per line.

A script that lists test names selects nothing unless something runs it, and "a file names this
script" is not "CI runs this script": a comment, an echo or a usage line names it just as well.
So this follows invocations only, from the workflows outward:

- a workflow or composite action is always reached;
- a reached file reaches a repository file it invokes: `bash`, `sh`, `python`/`python3`, `node`,
  `source` or `.` followed by the path, or the path as the command of a `run:` or `entry:` line or
  of a line inside a YAML `run:` block;
- a reached file reaches a Makefile target it invokes: `make <target>` or `$(MAKE) <target>`, and a
  reached Python file also reaches a target named at the start of a string literal, which is how
  `scripts/ci/owner-chain-matrix.py` hands a leg's target to `make ${{ matrix.chain.make }}`;
- a reached target reaches its prerequisites, and its recipe is read like a reached file;
- a reached file that runs `prek run` or `pre-commit run` reaches `.pre-commit-config.yaml`, whose
  hook `entry:` lines are read as invocations.

Comment lines are not read. The rule errs toward "not called": an invocation spelled in a way it
does not recognise reads as absent, and the caller then refuses to count that file as a selector,
which is loud, instead of counting a file nothing runs, which is silent.

"""

import pathlib
import re
import shutil
import subprocess
import sys


ROOTS = (".github/workflows", ".github/actions")
PATH = r"((?:\.github|\.pre-commit-hooks|scripts|crates|product|python)/[A-Za-z0-9_./-]+\.(?:bash|sh|py|mjs|js))"
INVOKED_PATH = re.compile(
    r"(?:^|[\s;&|(`])(?:bash|sh|python3?|node|source|\.)\s+(?:-[A-Za-z]+\s+)*"
    r"""["']?(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/|\.\./)?""" + PATH,
)
RUN_PATH = re.compile(r"^\s*(?:-\s+)?(?:run:|entry:)\s*(?:\./)?" + PATH)
MAKE_TARGET = re.compile(
    r"(?:\bmake|\$\(MAKE\))\s+(?:-[A-Za-z-]+(?:=\S+)?\s+)*([a-z][a-z0-9_.-]*)",
)
PY_LITERAL = re.compile(r"""["']([a-z][a-z0-9_.-]*)(?=[\s"'])""")
RUN_BLOCK = re.compile(r"^(\s*)(?:-\s+)?run:\s*[|>][-+]?\s*$")
BLOCK_COMMAND = re.compile(r"^\s*(?:\./)?" + PATH + r"(?:\s|$)")
HOOK_RUNNER = re.compile(r"\b(?:prek|pre-commit)\s+run\b")
HOOK_CONFIG = ".pre-commit-config.yaml"
TARGET_LINE = re.compile(r"^([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+)*)\s*:(?!=)(.*)$")


def tracked_files() -> set[str]:
    git = shutil.which("git")
    if git is None:
        sys.exit("ERROR: git is not on PATH, so no tracked file can be listed.")
    proc = subprocess.run([git, "ls-files"], capture_output=True, text=True, check=True)
    files = set(proc.stdout.splitlines())
    if not files:
        sys.exit(
            "ERROR: git ls-files listed nothing, so no invocation can be resolved.",
        )
    return files


def makefile_targets() -> dict[str, tuple[list[str], str]]:
    """
    Each Makefile target with its prerequisites and its recipe text.
    """
    targets: dict[str, tuple[list[str], str]] = {}
    current: list[str] = []
    for line in pathlib.Path("Makefile").read_text(encoding="utf-8").splitlines():
        if line.startswith("\t"):
            for name in current:
                prerequisites, recipe = targets[name]
                targets[name] = (prerequisites, recipe + line + "\n")
            continue
        match = TARGET_LINE.match(line)
        if match is None or line.startswith((".PHONY", "#")) or "=" in match.group(1):
            if line.strip() and not line.startswith("#"):
                current = []
            continue
        names = match.group(1).split()
        # `target: export VAR := ...` is a target-specific variable, not a prerequisite list.
        rest = match.group(2).split("#", 1)[0]
        prerequisites = [] if re.match(r"\s*(export\s|\S+\s*[:?+]?=)", rest) else rest.split()
        for name in names:
            known = targets.get(name, ([], ""))
            targets[name] = (known[0] + prerequisites, known[1])
        current = names
    if not targets:
        sys.exit(
            "ERROR: no Makefile target was parsed. The parser is broken, not the Makefile.",
        )
    return targets


def uncommented(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def block_commands(body: str) -> set[str]:
    """
    Paths that are the command of a line inside a YAML `run:` block scalar.
    """
    found = set()
    indent = None
    for line in body.splitlines():
        if indent is not None:
            if line.strip() and len(line) - len(line.lstrip()) <= indent:
                indent = None
            elif match := BLOCK_COMMAND.match(line):
                found.add(match.group(1))
                continue
            else:
                continue
        if match := RUN_BLOCK.match(line):
            indent = len(match.group(1))
    return found


def invocations(text: str, python: bool, files: set[str], targets: set[str]):
    body = uncommented(text)
    paths = {m.group(1) for m in INVOKED_PATH.finditer(body)}
    paths |= {m.group(1) for line in body.splitlines() if (m := RUN_PATH.match(line))}
    paths |= block_commands(body)
    called = {m.group(1) for m in MAKE_TARGET.finditer(body)}
    if python:
        called |= {m.group(1) for m in PY_LITERAL.finditer(body)}
    if HOOK_RUNNER.search(body):
        paths.add(HOOK_CONFIG)
    return {p for p in paths if p in files}, {t for t in called if t in targets}


def ci_called_files() -> set[str]:
    files = tracked_files()
    targets = makefile_targets()
    reached = {f for f in files if f.startswith(ROOTS) and f.endswith((".yml", ".yaml"))}
    if not reached:
        sys.exit("ERROR: no workflow was found, so nothing can be reached from one.")
    pending_files = list(reached)
    reached_targets: set[str] = set()
    pending_targets: list[str] = []
    while pending_files or pending_targets:
        if pending_files:
            name = pending_files.pop()
            text = pathlib.Path(name).read_text(encoding="utf-8", errors="replace")
            paths, called = invocations(text, name.endswith(".py"), files, set(targets))
        else:
            target = pending_targets.pop()
            prerequisites, recipe = targets[target]
            paths, called = invocations(recipe, False, files, set(targets))
            called |= {p for p in prerequisites if p in targets}
        for path in paths - reached:
            reached.add(path)
            pending_files.append(path)
        for target in called - reached_targets:
            reached_targets.add(target)
            pending_targets.append(target)
    return reached


def main() -> int:
    for path in sorted(ci_called_files()):
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
