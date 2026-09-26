#!/usr/bin/env python3
"""
Refuse a script that creates, clones or configures a git repository without isolating
git first.

Such a script, run as a commit hook in a linked worktree, inherits GIT_DIR and GIT_INDEX_FILE and
acts on the shared repository instead (scripts/lib/git-isolation.bash says what that did, twice).
So a shell script that runs `git init`, `git clone`, `git worktree add` or `git config user.*`
must source scripts/lib/git-isolation.bash, and a Python script that passes "init" or "clone" to
git must import git_isolation.

What this reads, and so what it cannot see:
- it matches the text of the file, line by line, and skips comment lines;
- it does not see git reached through a variable (`$GIT init`), `eval`, an alias, or a program in
  another language;
- a Python script is flagged when it names git and passes "init" or "clone" as a string literal.

A file that cannot source the helper is listed below, with the line that must stay in it instead.

"""

from __future__ import annotations

import re
import sys
from pathlib import Path


SHELL_TRIGGERS = [
    re.compile(r"(^|[^\w.$/-])git(\s+-[Cc]\s+\S+)*\s+(init|clone)\b"),
    re.compile(r"(^|[^\w.$/-])git(\s+-[Cc]\s+\S+)*\s+worktree\s+add\b"),
    re.compile(r"(^|[^\w.$/-])git(\s+-[Cc]\s+\S+)*\s+config\s+(--local\s+)?user\."),
]
PYTHON_NAMES_GIT = re.compile(r"""["']git["']|which\(["']git["']\)""")
PYTHON_TRIGGER = re.compile(r"""["'](init|clone)["']""")
SHELL_ISOLATED = re.compile(r"^\s*(source|\.)\s.*lib/git-isolation\.bash")
PYTHON_ISOLATED = re.compile(r"^\s*(import git_isolation|from git_isolation import)")
# The helpers themselves, and this check, whose text describes the calls it looks for.
EXEMPT = {
    "scripts/lib/git-isolation.bash",
    "scripts/lib/git_isolation.py",
    "scripts/check-git-isolation.py",
}
# include_bytes! embeds this script in the crate and runs it from a scratch directory, so it cannot
# source anything; it clears GIT_* itself, and this line must stay.
SELF_CONTAINED = {
    "crates/strategy_factory/tools/seal-program.sh": 'GIT_*) unset "$name" ;;',
}


def code_lines(text: str) -> list[tuple[int, str]]:
    return [
        (n, line)
        for n, line in enumerate(text.splitlines(), 1)
        if not line.lstrip().startswith("#")
    ]


def refusals(path: str, text: str) -> list[str]:
    if path in EXEMPT:
        return []
    lines = code_lines(text)
    if path.endswith(".py"):
        hits = [
            (n, "passes init or clone to git")
            for n, line in lines
            if PYTHON_TRIGGER.search(line) and PYTHON_NAMES_GIT.search(text)
        ]
        hits += [
            (n, line.strip()) for n, line in lines if any(t.search(line) for t in SHELL_TRIGGERS)
        ]
        isolated = any(PYTHON_ISOLATED.search(line) for _, line in lines)
        helper = "import git_isolation (scripts/lib/git_isolation.py)"
    else:
        hits = [
            (n, line.strip()) for n, line in lines if any(t.search(line) for t in SHELL_TRIGGERS)
        ]
        isolated = any(SHELL_ISOLATED.search(line) for _, line in lines)
        helper = "source scripts/lib/git-isolation.bash"
    if not hits or isolated:
        return []
    if path in SELF_CONTAINED:
        if SELF_CONTAINED[path] in text:
            return []
        return [
            f"{path}: lost its own GIT_* clearing ({SELF_CONTAINED[path]!r}) and cannot source the helper",
        ]
    return [f"{path}:{n}: {what} - {helper} before the first git call" for n, what in hits]


def main(paths: list[str]) -> int:
    found = []
    for path in paths:
        try:
            text = Path(path).read_text()
        except (OSError, UnicodeDecodeError):
            continue
        found += refusals(path, text)
    for line in found:
        print(f"ERROR: {line}", file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
