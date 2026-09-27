#!/usr/bin/env python3
"""
Name the path-filtered workflows a pull request's diff would trigger, so quality can
require them.

docs-pages, product-packages and bilibili-note-mcp run on a pull request only when its diff touches
their `pull_request.paths`, and nothing required their result. #1100 turned docs-pages red and
could still have merged, because the ruleset requires `quality` alone.

This reads each workflow's own `paths` list from the file, so there is no second copy to drift. It
matches the diff GitHub filters on, from the merge base to the pull request head, with GitHub's
glob rules: `**` crosses `/`, `*` and `?` do not.

Whatever it cannot decide counts as "would trigger", and quality then waits for a run:
- a negated pattern (`!`), a character class, a brace, or `paths-ignore`;
- more than 300 changed files (GitHub filters only the first 300);
- an unreadable workflow file.
A missing PyYAML is an error, not a doubt: it is a declared dependency.
A wrong "would trigger" costs a timeout that a `workflow_dispatch` of the same head clears. A wrong
"would not" lets a red check merge, so every doubt goes the first way.

Usage: path_triggered_workflows.py <merge base sha> <head sha> <workflow file>...
Prints one workflow file name per line.

"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

# A declared dependency, not an optional one: without it no filter can be read, and counting every
# workflow as triggered would make the gate permanently strict. The plan job's python3 has it; the
# pre-commit hook declares it (additional_dependencies, PyYAML as python/uv.lock pins it).
import yaml


GIT = shutil.which("git") or "git"
GITHUB_FILTER_LIMIT = 300
UNDECIDABLE = re.compile(r"[!\[\]{}]")


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def triggers(filters: object, changed: list[str]) -> tuple[bool, str]:
    """
    Return whether GitHub would run a workflow with these pull_request filters, and why.
    """
    if not isinstance(filters, dict):
        return True, "the pull_request filters are not a mapping"
    if "paths-ignore" in filters:
        return True, "paths-ignore is not evaluated here"
    paths = filters.get("paths")
    if paths is None:
        return True, "no paths filter"
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        return True, "paths is not a list of strings"
    if any(UNDECIDABLE.search(p) for p in paths):
        return True, "a pattern uses syntax not evaluated here"
    if len(changed) > GITHUB_FILTER_LIMIT:
        return (
            True,
            f"{len(changed)} changed files, over GitHub's {GITHUB_FILTER_LIMIT}-file filter",
        )
    patterns = [(p, glob_to_regex(p)) for p in paths]
    for path in changed:
        for text, regex in patterns:
            if regex.match(path):
                return True, f"{path} matches {text}"
    return False, "no changed path matches"


NOT_ON_PULL_REQUESTS = object()


def pull_request_filters(workflow: Path) -> object:
    document = yaml.safe_load(workflow.read_text())
    on = document.get(True, document.get("on"))
    if isinstance(on, str):
        on = {on: None}
    elif isinstance(on, list):
        on = dict.fromkeys(on)
    if not isinstance(on, dict):
        return {}
    if "pull_request" not in on:
        return NOT_ON_PULL_REQUESTS
    return on["pull_request"] or {}


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__.strip().splitlines()[-2], file=sys.stderr)
        return 2
    base, head, workflows = sys.argv[1], sys.argv[2], [Path(p) for p in sys.argv[3:]]
    changed = subprocess.run(
        [GIT, "diff", "--name-only", "--no-renames", base, head],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    for workflow in workflows:
        try:
            filters = pull_request_filters(workflow)
            if filters is NOT_ON_PULL_REQUESTS:
                decision, why = False, "has no pull_request trigger, so never runs on one"
            else:
                decision, why = triggers(filters, changed)
        except (OSError, ValueError, yaml.YAMLError) as e:
            decision, why = True, f"unreadable ({e})"
        print(
            f"{workflow.name}: {'required' if decision else 'not triggered'} - {why}",
            file=sys.stderr,
        )
        if decision:
            print(workflow.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
