"""Refuse skill text and package docs that name product things which do not exist
(docs/plans/skill-continuous-audit.zh.md).

Rule 1, on the checked-out tree: a command-line call written in a skill resolves in `cli.main`'s parser, and a
relative link or references/, templates/ or assets/ path in a skill names a file.
Rule 2, with --base: no name that skill or eval text cites stops occurring in the repository's other files
between the base commit and HEAD (a rename or removal that leaves the skills behind).
Rule 3, on the checked-out tree: in the package READMEs and docs/operator, a command-line call resolves as in rule 1,
a repository path exists and an identifier names something the repository's code holds (0.5.0 re-judge A-81;
docs/rd, the design site, is a specification and is not checked).

Run from the repository root under the project environment: `uv run --frozen python .github/scripts/skill-names.py
[--base COMMIT]`. Exit status 1 lists each finding as `path:line: name: reason`.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable, Iterator
import os
from pathlib import Path, PurePosixPath
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
    from registration import runner

    def children(parser: argparse.ArgumentParser) -> dict[str, argparse.ArgumentParser]:
        for action in parser._actions:
            if isinstance(action, argparse._SubParsersAction):
                return dict(action.choices)
        return {}

    def options(parser: argparse.ArgumentParser) -> set[str]:
        return {option for action in parser._actions for option in action.option_strings}

    tree, runners = {}, set()
    for noun, noun_parser in children(cli.build_parser()).items():
        tree[noun] = {}
        for verb, verb_parser in children(noun_parser).items():
            tree[noun][verb] = options(verb_parser)
            if verb_parser.get_default("takes_runner"):
                runners.add(f"{noun} {verb}")
    runner_options = (options(config.build_parser()) | set(runner.ENTRY_OPTIONS) | set(runner.ENTRY_FLAGS)) - set(
        runner.RESERVED_RUNNER_OPTIONS)
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


# Rule 3

DOC_FILE = re.compile(r"[\w-][\w.-]*\.(?:py|md|mdx|jsonl?|toml|ya?ml|sh|mjs|ts|tsx|css|lock|html|sql|csv|gz|txt)")
CODE_FILE = re.compile(r"[\w-][\w.-]*\.(?:py|mjs|ts|tsx|css|sh|mdx)")
REPO_PATH = re.compile(r"(?:\.{1,2}/)?[\w.*-]+(?:/[\w.*-]+)+/?")
DOTTED = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+")
SNAKE = re.compile(r"[A-Za-z0-9]*_[A-Za-z0-9_]*")


def doc_files() -> list[Path]:
    """The package READMEs and the operator guide (docs/rd, the design site, is a specification, not checked)."""
    return sorted(Path(path) for path in git("ls-files", "-z", "--", "*README.md", "docs/operator/*.md").split("\0")
                  if path and not path.startswith(".agents/"))


class Repository:
    """The checked-out tree's tracked paths, directory names and code words (rule 2's words, at HEAD)."""

    def __init__(self) -> None:
        self.paths = [path for path in git("ls-files", "-z").split("\0") if path]
        self.directories = {part for path in self.paths for part in path.split("/")[:-1]}
        self.names = {path.rsplit("/", 1)[-1] for path in self.paths}
        self.tails = {"/".join(parts[i:j]) for parts in (path.split("/") for path in self.paths)
                      for i in range(len(parts)) for j in range(i + 1, len(parts) + 1)}
        self.words = words_at("HEAD")

    def ignored(self, path: str) -> bool:
        return any(subprocess.run(["git", "check-ignore", "-q", "--no-index", candidate]).returncode == 0
                   for candidate in (path, f"{path}/x"))

    def path_reason(self, doc: Path, span: str) -> str | None:
        """Why a repository path a doc names does not exist: tracked (whole, or the tail of a tracked path, as a
        README names files of its package), on disk or ignored. A path whose first part is no repository directory
        (a URL path, a platform, a branch) and a bare file name other than source code are not followed."""
        path = span.rstrip("/")
        if path.startswith(("/", "~", "$")) or "<" in path or path.split("/")[0].isupper() \
                or (path.startswith(".") and "/" not in path):
            return None
        if "/" not in path:
            return None if not CODE_FILE.fullmatch(path) or path in self.names else "no such file"
        first = path.removeprefix("./").split("/")[0]
        if first not in self.directories and not (doc.parent / first).exists():
            return None
        if "*" in path:
            found = list(doc.parent.glob(path)) or list(Path().glob(path))
            return None if found or any(PurePosixPath(tracked).match(path) for tracked in self.paths) else "no such path"
        relative = os.path.normpath(doc.parent / path)
        if path.removeprefix("./") in self.tails or Path(relative).exists() or Path(path).exists() \
                or self.ignored(path) or self.ignored(relative):
            return None
        return "no such path"

    def name_reason(self, span: str) -> str | None:
        """Why an identifier a doc names occurs nowhere: a dotted name rooted in a module of this repository names
        something that module's file holds (a package's, any of its modules, as `engine.write_reports` names
        engine/report.py's); another dotted name's last part, or a snake_case name, occurs in the repository
        outside Markdown."""
        if DOTTED.fullmatch(span):
            parts = span.split(".")
            for end in range(len(parts), 0, -1):
                for module in (Path(*parts[:end]).with_suffix(".py"), Path(*parts[:end], "__init__.py")):
                    if str(module) in self.paths:
                        rest = parts[end:]
                        text = "\n".join(path.read_text(encoding="utf-8") for path in (
                            sorted(module.parent.rglob("*.py")) if module.name == "__init__.py" else [module]))
                        return None if not rest or re.search(rf"\b{re.escape(rest[0])}\b", text) else \
                            f"{module} has no {rest[0]}"
            return None if parts[-1] in self.words else "no such name"
        return None if not SNAKE.fullmatch(span) or span in self.words else "no such name"


def alternatives(span: str) -> list[str]:
    """`noun a|b|c ...` as one call per verb."""
    match = re.match(r"(.*?\S+ )([a-z-]+(?:\|[a-z-]+)+)(.*)", span)
    return [match[1] + verb + match[3] for verb in match[2].split("|")] if match else [span]


def rule_three(files: Iterable[Path]) -> list[str]:
    tree, runners, runner_options = command_tree()
    repository = Repository()
    findings = []
    for doc in files:
        text = doc.read_text(encoding="utf-8")
        own = set(WORD.findall(" ".join(re.findall(r"```.*?```", text, flags=re.S))))  # names its own scripts set
        for line, span in spans(text):
            reason = next(filter(None, (check_call(call, tree, runners, runner_options) for call in alternatives(span))),
                          None)
            name = span.removesuffix("()")
            if reason is None and " " not in name:
                if REPO_PATH.fullmatch(name) or DOC_FILE.fullmatch(name):
                    reason = repository.path_reason(doc, name)
                elif name not in own:
                    reason = repository.name_reason(name)
            if reason:
                findings.append(f"{doc}:{line}: {span}: {reason}")
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", help="rule 2: the commit HEAD is compared with (a PR's base)")
    args = parser.parse_args(argv)
    files = sorted(Path(path) for path in git("ls-files", "-z", "--", f"{SKILLS}**.md").split("\0") if path)
    docs = doc_files()
    findings = rule_one(files) + rule_three(docs)
    if args.base:
        findings += rule_two(git("rev-parse", "--verify", f"{args.base}^{{commit}}").strip(), git("rev-parse", "HEAD").strip())
    print("\n".join(findings) or f"skill names: {len(files)} skill files and {len(docs)} package docs checked"
          + ("" if args.base else " (rule 1 only)"))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
