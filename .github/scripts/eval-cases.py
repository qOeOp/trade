"""List the eval cases a skill change should also run: the cases whose `prompt.md` or a grader cite a backticked
name from a paragraph the change touches (docs/plans/probes-0.5-20261121.zh.md, C-005).

A name cited by more than `--max` cases is too common to select by and is left out. Run from the repository root:
`python .github/scripts/eval-cases.py [--base origin/main] [--max 5]`; prints `suite/case: name, ...` per case.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path
import re
import subprocess

SKILLS = ".agents/skills/"
EVALS = Path(".agents/evals")
SPAN = re.compile(r"`([^`\n]+)`")
NAME = re.compile(r"--[a-z0-9][a-z0-9-]*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+|[A-Za-z_]*_[A-Za-z0-9_]*")
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", re.MULTILINE)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def paragraphs(text: str, lines: set[int]) -> str:
    """The blank-line-separated paragraphs of `text` holding any of the 1-based `lines`."""
    picked: list[str] = []
    block: list[str] = []
    touched = False
    for number, line in enumerate([*text.split("\n"), ""], 1):
        if line.strip():
            block.append(line)
            touched |= number in lines
        else:
            if touched:
                picked.append("\n".join(block))
            block, touched = [], False
    return "\n".join(picked)


def changed_names(base: str) -> set[str]:
    """The backticked names (flags, dotted or snake_case identifiers) of the changed paragraphs on both sides."""
    found: set[str] = set()
    merge_base = git("merge-base", base, "HEAD").strip()
    for path in git("diff", "--name-only", merge_base, "HEAD", "--", SKILLS).split():
        old_lines: set[int] = set()
        new_lines: set[int] = set()
        for old, old_n, new, new_n in HUNK.findall(git("diff", "-U0", merge_base, "HEAD", "--", path)):
            # a side with no lines (count 0) names the line before the change, kept with its paragraph
            old_lines.update(range(int(old), int(old) + max(int(old_n or 1), 1)))
            new_lines.update(range(int(new), int(new) + max(int(new_n or 1), 1)))
        for rev, lines in ((merge_base, old_lines), ("HEAD", new_lines)):
            try:
                text = git("show", f"{rev}:{path}")
            except subprocess.CalledProcessError:  # added or deleted on this side
                continue
            found |= {span for span in SPAN.findall(paragraphs(text, lines)) if NAME.fullmatch(span)}
    return found


def cases(names: set[str], most: int) -> dict[str, list[str]]:
    """Each case citing a name that at most `most` cases cite, with those names."""
    citing: dict[str, set[str]] = defaultdict(set)
    for case in sorted(path.parent for path in EVALS.glob("*/*/prompt.md")):
        text = "\n".join(path.read_text(encoding="utf-8") for path in [case / "prompt.md",
                                                                       *(case / "graders").glob("*.md")])
        for name in names:
            if re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", text):
                citing[name].add(f"{case.parent.name}/{case.name}")
    selected: dict[str, list[str]] = defaultdict(list)
    for name, found in sorted(citing.items()):
        if len(found) <= most:
            for case_name in found:
                selected[case_name].append(name)
    return dict(sorted(selected.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--max", type=int, default=5, dest="most")
    args = parser.parse_args()
    for case, names in cases(changed_names(args.base), args.most).items():
        print(f"{case}: {', '.join(sorted(names))}")


if __name__ == "__main__":
    main()
