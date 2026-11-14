"""Refuse skill text that names product things which do not exist (docs/plans/skill-continuous-audit.zh.md).

Rule 1, on the checked-out tree: a command-line call written in a skill resolves in `cli.main`'s parser, and a
relative link or references/, templates/ or assets/ path in a skill names a file.
Rule 2, with --base: no name that skill or eval text cites stops occurring in the repository's other files
between the base commit and HEAD (a rename or removal that leaves the skills behind).

Run from the repository root under the project environment: `uv run --frozen python .github/scripts/skill-names.py
[--base COMMIT]`. Exit status 1 lists each finding as `path:line: name: reason`.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable, Iterator
from pathlib import Path
import re
import subprocess
import sys

SKILLS = ".agents/skills/"
EVALS = ".agents/evals/"
PREFIX = re.compile(r"^(?:uv run (?:--frozen )?)?python3? -m cli\.main(?:\s+|$)")
VERB = re.compile(r"[a-z][a-z-]+")
SPAN = re.compile(r"`([^`]+)`")
LINK = re.compile(r"\]\(([\w./#~:-]+)\)")
SKILL_PATH = re.compile(r"(?:references|templates|assets)/[\w./-]+")
# Rule 2 follows names of these shapes; prose, commands and placeholders are left to rule 1 and to review.
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*")
FLAG = re.compile(r"--[a-z0-9][a-z0-9-]*")
WORD = re.compile(r"[A-Za-z0-9_]+(?:\.[A-Za-z_][A-Za-z0-9_]*)*|--[a-z0-9][a-z0-9-]*")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def blank(match: re.Match[str]) -> str:
    return re.sub(r"[^\n]", " ", match.group(0))


def unfenced(text: str) -> str:
    """The text with fenced code blocks blanked, line numbers kept."""
    return re.sub(r"```.*?```", blank, text, flags=re.S)


def spans(text: str) -> Iterator[tuple[int, str]]:
    """(line, text) of each inline code span outside fenced blocks; a span may wrap onto the next line."""
    body = unfenced(text)
    for match in SPAN.finditer(body):
        if "\n\n" not in match.group(1):
            yield body.count("\n", 0, match.start()) + 1, " ".join(match.group(1).split())


# Rule 1

def command_tree() -> tuple[dict[str, dict[str, set[str]]], set[str], set[str]]:
    """Nouns to verbs to options, the runner verbs, and the runner options a call may pass after `--`."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # this checkout's product, whatever the cwd
    from cli import main as cli
    from engine import config
    from registration import seams

    def children(parser: argparse.ArgumentParser) -> dict[str, argparse.ArgumentParser]:
        for action in parser._actions:
            if isinstance(action, argparse._SubParsersAction):
                return dict(action.choices)
        return {}

    def options(parser: argparse.ArgumentParser) -> set[str]:
        return {option for action in parser._actions for option in action.option_strings}

    tree, runners = {}, set()
    for noun, noun_parser in children(cli._parser()).items():
        tree[noun] = {}
        for verb, verb_parser in children(noun_parser).items():
            tree[noun][verb] = options(verb_parser)
            if verb_parser.get_default("takes_runner"):
                runners.add(f"{noun} {verb}")
    runner_options = (options(config.build_parser()) | set(seams.ENTRY_OPTIONS) | set(seams.ENTRY_FLAGS)) - set(
        seams.RESERVED_RUNNER_OPTIONS)
    return tree, runners, runner_options


def check_call(span: str, tree: dict[str, dict[str, set[str]]], runners: set[str], runner_options: set[str]) -> str | None:
    """Why a command-line call does not resolve, None when it does or when the span is not a call."""
    prefixed = PREFIX.match(span)
    words = span[prefixed.end():].split() if prefixed else span.split()
    flagged = any(word.startswith("-") for word in words)
    if not words or words[0] not in tree:
        placeholder = not words or "<" in words[0] or words[0].isupper()
        return None if not prefixed or placeholder else f"no command `{words[0]}`"
    if not prefixed and (len(words) < 2 or not VERB.fullmatch(words[1]) or (len(words) > 3 and not flagged)):
        return None
    noun = words[0]
    if len(words) == 1:
        return None
    if words[1].startswith("-"):
        return None if words[1] in ("-h", "--help") else f"`{noun}` takes a verb before {words[1]}"
    if "<" in words[1] or words[1].isupper():
        return None
    if words[1] not in tree[noun]:
        return f"no verb `{noun} {words[1]}`"
    own, runner = words[2:], []
    if "--" in own:
        own, runner = own[:own.index("--")], own[own.index("--") + 1:]
    allowed = tree[noun][words[1]] | {"-h", "--help"}
    bad = [word for word in own if re.match(r"-[-a-z]", word) and word.split("=")[0] not in allowed]
    if runner:
        if f"{noun} {words[1]}" not in runners:
            return f"`{noun} {words[1]}` takes no runner arguments"
        bad += [word for word in runner if word.startswith("--") and word.split("=")[0] not in runner_options]
    return f"`{noun} {words[1]}` has no {', '.join(bad)}" if bad else None


def check_path(target: str, source: Path) -> str | None:
    """Why a relative path written in a skill names no file: relative to the file, or to its skill's directory."""
    path = target.split("#")[0].rstrip("/")
    if not path or re.match(r"[a-z]+:|/|~|\$", target) or "<" in path or "*" in path:
        return None
    skill = Path(*source.parts[:3])
    if (source.parent / path).exists() or (skill / path).exists():
        return None
    return "no such file"


def rule_one(files: Iterable[Path]) -> list[str]:
    tree, runners, runner_options = command_tree()
    findings = []
    for source in files:
        text = source.read_text(encoding="utf-8")
        for line, span in spans(text):
            reason = check_call(span, tree, runners, runner_options)
            if reason is None and " " not in span and SKILL_PATH.fullmatch(span):
                reason = check_path(span, source)
            if reason:
                findings.append(f"{source}:{line}: {span}: {reason}")
        prose = SPAN.sub(blank, unfenced(text))
        for match in LINK.finditer(prose):
            reason = check_path(match.group(1), source)
            if reason:
                findings.append(f"{source}:{prose.count(chr(10), 0, match.start()) + 1}: {match.group(1)}: {reason}")
    return findings


# Rule 2

def followed(span: str) -> str | None:
    """The name rule 2 follows in a span: an identifier (`tables()` counts as `tables`) or a long option."""
    name = span.removesuffix("()")
    return name if IDENTIFIER.fullmatch(name) or FLAG.fullmatch(name) else None


def outside_skill_text(path: str) -> bool:
    """Files whose words keep a name alive: everything but skill and eval text, design pages and other Markdown."""
    if path.startswith((EVALS, "docs/")) or (path.startswith(SKILLS) and path.endswith(".md")):
        return False
    return not path.endswith(".md") or path.startswith("cli/templates/")


def words_at(commit: str) -> set[str]:
    """Every identifier, dotted name and long option in the commit's files outside skill text."""
    batch = ""
    for entry in git("ls-tree", "-r", "-z", commit).split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            if meta.split()[1] == "blob" and outside_skill_text(path):
                batch += meta.split()[2] + "\n"
    blobs = subprocess.run(["git", "cat-file", "--batch"], input=batch.encode(), check=True, capture_output=True).stdout
    words: set[str] = set()
    position = 0
    while position < len(blobs):
        header_end = blobs.index(b"\n", position)
        size = int(blobs[position:header_end].split()[2])
        body = blobs[header_end + 1:header_end + 1 + size]
        position = header_end + 2 + size
        if b"\0" not in body[:8000]:
            for word in WORD.findall(body.decode("utf-8", "replace")):
                words.add(word)
                words.update(word.split("."))
                words.update(p for i in range(1, word.count(".") + 1) for p in [word.rsplit(".", i)[0]])
    return words


def rule_two(base: str, head: str) -> list[str]:
    cited: dict[str, list[str]] = {}
    for path in git("ls-tree", "-r", "--name-only", "-z", head, "--", SKILLS, EVALS).split("\0"):
        if not path or (path.startswith(SKILLS) and not path.endswith(".md")):
            continue
        text = git("show", f"{head}:{path}")
        for line, span in spans(text):
            name = followed(span)
            if name:
                cited.setdefault(name, []).append(f"{path}:{line}")
    before, after = words_at(base), words_at(head)
    return [f"{place}: {name}: no longer in the repository outside skill text (present at {base[:12]})"
            for name, places in sorted(cited.items()) if name in before and name not in after for place in places]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", help="rule 2: the commit HEAD is compared with (a PR's base)")
    args = parser.parse_args(argv)
    files = sorted(Path(path) for path in git("ls-files", "-z", "--", f"{SKILLS}**.md").split("\0") if path)
    findings = rule_one(files)
    if args.base:
        findings += rule_two(git("rev-parse", "--verify", f"{args.base}^{{commit}}").strip(), git("rev-parse", "HEAD").strip())
    print("\n".join(findings) or f"skill names: {len(files)} skill files checked"
          + ("" if args.base else " (rule 1 only)"))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
