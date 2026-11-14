"""Skill paragraph heat: how often the identifiers a skill paragraph names show up in later tool calls.

Each run reads this repository's Claude Code and Codex transcripts still on disk, merges what each session did
into the store (one JSON line per session: skill files it loaded and when, and per loaded file the identifiers
of that file it then used), and draws the current skill text against every session in the store. A session
stays counted after its transcript is deleted; one deleted before any run is lost.

A paragraph's opportunity is a session that loaded its file after the paragraph took its current wording
(newest first-parent commit time of its lines); a hit is one of those sessions using an identifier of the
paragraph that no other paragraph mentions. Maintenance sessions (editing skills or evals, running `plugin
eval`) are marked, and a session that loaded product-doctor, or its sub-agents, counts only for
product-doctor's files. Stored identifiers follow this file's extraction rules: a change to them leaves
older records counted the old way. A renamed skill file starts without sessions; --until cuts by session
start, so a session crossing it brings its later calls.

    uv run --frozen python .agents/skills/product-doctor/assets/skill_heat.py \\
        --store docs/plans/doctor/skill-heat.jsonl --output /tmp/skill-heat [--compare DATE] [--until DATE]

writes data.json and index.html into --output. Heat is a reading for picking candidates, never a verdict.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable, Iterator
from compression import zstd
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import IO, Any

SKILLS = ".agents/skills/"
DOCTOR = "product-doctor/"
TEMPLATE = Path(__file__).with_name("skill_heat.html")
HOSTS = ("claude", "codex")
SKILL_FILE = re.compile(r"(?:\.agents|\.claude)/skills/([a-z0-9-]+)/((?:SKILL|(?:references|templates)/[\w.-]+)\.md)")
BASE_DIRECTORY = re.compile(r"Base directory for this skill: \S*/skills/([a-z0-9-]+)")
TOUCHES_SKILL_TEXT = re.compile(r"(?:\.agents|\.claude)/(?:skills|evals)/|plugin eval")
EDITS_SKILL_TEXT = re.compile(r"\*\*\* (?:Update|Add|Delete) File: \S*(?:\.agents|\.claude)/(?:skills|evals)/|plugin eval")
COMMAND_PREFIX = re.compile(r"^(?:uv run (?:--frozen )?)?(?:python3? -m cli\.main |python3? -m |cli\.main )")
PLACEHOLDER = re.compile(r"[A-Z][A-Z_]+")
CWD = re.compile(r'"cwd":\s*"([^"]*)"')
Record = dict[str, Any]


def git(checkout: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=checkout, check=True, capture_output=True, text=True).stdout


def iso(stamp: str | float) -> str:
    """A timestamp (ISO text or Unix seconds) as UTC `YYYY-MM-DDTHH:MM:SS.mmmZ`, so stored times compare as
    strings. Milliseconds tell a transcript's copy (same times as its original) from another session."""
    moment = (datetime.fromtimestamp(stamp, UTC) if isinstance(stamp, float | int)
              else datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(UTC))
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"


def strings(value: Any) -> str:
    """Every string inside a tool input, one per line, so an identifier at a line start stays a whole word."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        value = list(value.values())
    return "\n".join(strings(item) for item in value) if isinstance(value, list) else ""


# Skill text

def blocks(lines: list[str]) -> Iterator[tuple[int, int, str]]:
    """(first line, end line, heading) of each paragraph: blank lines and headings separate them, and each
    top-level list item starts one."""
    heading, start, fenced = "", None, False
    for number, line in enumerate([*lines, ""]):
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and line.startswith("#"):
            if start is not None:
                yield start, number, heading
            heading, start = line.lstrip("#").strip(), None
        elif not fenced and not line.strip():
            if start is not None:
                yield start, number, heading
            start = None
        elif not fenced and start is not None and re.match(r"(?:\d+\.|[-*]) ", line):
            yield start, number, heading
            start = number
        elif start is None:
            start = number


def terms_of(text: str, skill_names: set[str]) -> set[str]:
    """The identifiers a paragraph names in inline code spans that a tool call could repeat: no placeholders,
    plain words, literals, record or run numbers, skill names, skill file paths, or upper-case codes such as
    refusal codes (a tool's output shows them; no call input does)."""
    found = set()
    for span in re.findall(r"`([^`]+)`", re.sub(r"\s*\n\s*", " ", re.sub(r"```.*?```", " ", text, flags=re.S))):
        span = COMMAND_PREFIX.sub("", re.sub(r"<[^>]*>|\{[^}]*\}|…|\.\.\.", " ", span).strip()).strip()
        for part in re.split(r"\s\|\s", span):
            words = part.strip(" .,;:").split()
            while len(words) > 1 and PLACEHOLDER.fullmatch(words[-1]):
                words.pop()
            term = " ".join(words)
            if (len(term) < 4 or re.fullmatch(r"[a-z]+|True|False|None|[\d.,%]+|--?[a-z]{1,4}|[A-Z][A-Z0-9_]+", term)
                    or re.search(r"(?:^|\s)\d[\d.]*(?:\s|$)|@\d", term) or term in skill_names
                    or re.search(r"skills/|SKILL\.md|^references/|^templates/|\.md$", term)):
                continue
            found.add(term)
    return found


def placeholder(word: str, term: str) -> bool:
    """An upper-case word inside a command (`replay report --trial-id RUN`) stands for any argument; in
    `WARMUP = {"15-MINUTE": 30}` it is the identifier itself."""
    return " " in term and term[0].islower() and bool(PLACEHOLDER.fullmatch(word))


def pattern(term: str) -> re.Pattern[str]:
    """The term as a whole word."""
    words = [r"\S+" if placeholder(word, term) else re.escape(word) for word in term.split()]
    return re.compile(r"(?<![\w-])" + r"\s+".join(words) + r"(?![\w-])")


def literal(term: str) -> str:
    """The longest word of the term a matching call must contain (a cheap filter before the pattern)."""
    return max((word for word in term.split() if not placeholder(word, term)), key=len)


def paragraphs(checkout: Path) -> list[Record]:
    files = sorted(path for path in git(checkout, "ls-files", "-z", "--", SKILLS).split("\0") if path.endswith(".md"))
    skill_names = {path.split("/")[2] for path in files}
    found: list[Record] = []
    for path in files:
        lines = (checkout / path).read_text(encoding="utf-8").split("\n")
        front = lines.index("---", 1) + 1 if lines and lines[0] == "---" else 0
        # The working tree, so uncommitted lines count as written now; first parent, so a merged line dates
        # from its merge into this branch.
        times = [float(line.split()[1]) for line in git(checkout, "blame", "--first-parent", "--line-porcelain",
                                                         "--", path).splitlines() if line.startswith("committer-time ")]
        for start, end, heading in blocks(lines):
            text = "\n".join(lines[start:end]).strip()
            if start >= front and text:
                flat = re.sub(r"\s+", " ", text)
                found.append({"file": path, "line": start + 1, "heading": heading, "text": text,
                              "words": len(text.split()), "since": iso(max(times[start:end])), "flat": flat,
                              # a term emptied by removing placeholders matches not even its own paragraph
                              "terms": sorted(t for t in terms_of(text, skill_names) if pattern(t).search(flat))})
    for paragraph in found:  # a term other paragraphs also mention cannot tell which one was followed
        paragraph["shared"] = {term: sum(1 for other in found if pattern(term).search(other["flat"]))
                               for term in paragraph["terms"]}
    return found


# Transcripts

def transcripts(claude: Path, codex: Path, checkout: Path) -> Iterator[tuple[str, Path]]:
    """(host, path) of each transcript that may belong to this repository: Claude project directories named
    after the main checkout or its worktrees, and every Codex rollout (`observe` checks where each ran)."""
    main = Path(git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir").strip()).parent
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(main))
    for project in sorted(claude.glob("*")):
        if project.name == slug or project.name.startswith(slug + "-"):
            yield from (("claude", path) for path in sorted(project.glob("*.jsonl")))
            yield from (("claude", path) for path in sorted(project.glob("*/subagents/*.jsonl")))
    for pattern_ in ("sessions/**/*.jsonl", "archived_sessions/*.jsonl", "archived_sessions/*.jsonl.zst"):
        yield from (("codex", path) for path in sorted(codex.glob(pattern_)))


def open_transcript(path: Path) -> IO[str]:
    """A transcript's text; Codex archives some as `.jsonl.zst`."""
    if path.suffix == ".zst":
        return zstd.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open(encoding="utf-8", errors="replace")


def remote(url: str) -> str:
    """A remote URL without scheme, user and `.git`: `github.com/owner/name`."""
    return re.sub(r"(?:\.git)?/?$", "", re.sub(r"^\w+://|^git@", "", url).replace(":", "/"))


def same_repository(cwd: str, url: str, main: Path, origin: str) -> bool:
    """A session ran in the main checkout, under it (its worktrees), or in a Codex worktree of the same remote."""
    return cwd == str(main) or cwd.startswith(f"{main}/") or bool(origin and url and remote(url) == remote(origin))


Event = tuple[int, str, str | None, str, str]


def claude_calls(lines: Iterable[str]) -> Iterator[Event]:
    """(line number, time, call id, kind, text): kind is `load` with the skill name, or `call` or `edit` with the
    tool input."""
    for number, line in enumerate(lines):
        if '"tool_use"' not in line and "Base directory for this skill" not in line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = item.get("message") if isinstance(item, dict) else None
        if not isinstance(message, dict):
            continue
        stamp, content = str(item.get("timestamp") or ""), message.get("content")
        if item.get("type") == "user":
            for match in BASE_DIRECTORY.finditer(strings(content)):
                yield number, stamp, None, "load", match.group(1)
            continue
        for block in content if isinstance(content, list) else ():
            if isinstance(block, dict) and block.get("type") == "tool_use":
                arguments: dict[str, Any] = block["input"] if isinstance(block.get("input"), dict) else {}
                if block.get("name") == "Skill":
                    yield number, stamp, block.get("id"), "load", str(arguments.get("skill", "")).split(":")[-1]
                else:
                    text = strings(arguments)
                    edit = block.get("name") in ("Edit", "Write", "MultiEdit", "NotebookEdit")
                    yield number, stamp, block.get("id"), "edit" if edit and TOUCHES_SKILL_TEXT.search(text) else "call", text


def codex_calls(lines: Iterable[str]) -> Iterator[Event]:
    for number, line in enumerate(lines):
        if '"custom_tool_call"' not in line and '"function_call"' not in line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict) or item.get("type") != "response_item" or not isinstance(item.get("payload"), dict):
            continue
        payload = item["payload"]
        if payload.get("type") == "custom_tool_call":  # JavaScript source: its strings escape their line breaks
            text = str(payload.get("input") or "").replace("\\n", "\n")
        elif payload.get("type") == "function_call":
            try:
                text = strings(json.loads(str(payload.get("arguments") or "")))
            except json.JSONDecodeError:
                text = str(payload.get("arguments"))
        else:
            continue
        kind = "edit" if EDITS_SKILL_TEXT.search(text) else "call"
        yield number, str(item.get("timestamp") or ""), payload.get("call_id"), kind, text


Terms = dict[str, list[tuple[str, str, re.Pattern[str]]]]  # file: (term, its literal, its pattern)
Used = dict[str, dict[str, dict[str, str]]]  # file: term: call id: time


def observe(host: str, path: Path, terms: Terms, main: Path, origin: str) -> tuple[Record, Used] | None:
    """One session's record, and per loaded file the calls behind each identifier it used (to credit a call
    that another transcript copied only once); None for another repository's or an empty session."""
    session, parent, inherited = path.name.removesuffix(".zst").removesuffix(".jsonl"), None, 0
    if host == "claude" and path.parent.name == "subagents":
        parent = path.parent.parent.name
        session = f"{parent}/{session}"
    with open_transcript(path) as handle:
        first = handle.readline()
        if host == "codex":  # the first line says where the session ran: skip other repositories unread
            try:
                meta = json.loads(first).get("payload")
            except (json.JSONDecodeError, AttributeError):
                return None
            git_meta = meta.get("git") if isinstance(meta, dict) else None
            url = str(git_meta.get("repository_url") or "") if isinstance(git_meta, dict) else ""
            if not isinstance(meta, dict) or not same_repository(str(meta.get("cwd") or ""), url, main, origin):
                return None
            session, parent = str(meta.get("id") or session), meta.get("parent_thread_id")
            inherited = int(meta.get("subagent_history_start_ordinal") or 0)  # lines a fork copied from its parent
        lines = [first, *handle]
    if host == "claude":  # a project directory's name can also fit a sibling checkout (`trade-graph`)
        cwd = next((match.group(1) for line in lines for match in [CWD.search(line)] if match), None)
        if cwd is not None and not same_repository(cwd, "", main, origin):
            return None
    stamps: list[str] = []
    loads: dict[str, str] = {}
    used: Used = {}
    maintenance = False
    for number, stamp, call, kind, text in (claude_calls if host == "claude" else codex_calls)(lines):
        if not stamp:
            continue
        stamp = iso(stamp)
        stamps.append(stamp)
        if kind == "load":
            loads.setdefault(f"{text}/SKILL.md", stamp)
            continue
        read = SKILL_FILE.findall(text)
        for skill, relative in read:  # reading a skill file loads it; it is not following it
            loads.setdefault(f"{skill}/{relative}", stamp)
        if number < inherited:  # the fork has its parent's skill text, but the parent made these calls
            continue
        if kind == "edit" or "plugin eval" in text:
            maintenance = True
            continue
        if read or TOUCHES_SKILL_TEXT.search(text):
            continue
        for file in loads:
            for term, word, matcher in terms.get(file, ()):
                if word in text and matcher.search(text):
                    used.setdefault(file, {}).setdefault(term, {})[call or f"{session}@{stamp}"] = stamp
    loads = {file: stamp for file, stamp in loads.items() if file in terms}
    if not loads and not maintenance:
        return None
    record = {"id": session, "host": host, "parent": parent, "start": min(stamps), "end": max(stamps),
              "maintenance": maintenance, "loads": {file: [stamp, []] for file, stamp in sorted(loads.items())}}
    return record, {file: calls for file, calls in used.items() if file in loads}


def scan(claude: Path, codex: Path, checkout: Path, found: list[Record], stored: dict[str, Record]) -> list[Record]:
    """Records of every session on disk, each identifier credited once.

    A Claude transcript copied from another (a resumed or forked session, about 40 file pairs by 2026-11)
    keeps the original's times, so both start on the same millisecond. Within such a group the stored session,
    then the one ending first, is the original; the others count only calls after its last call, whether or
    not its transcript is still on disk. A call id seen in two transcripts counts for the first one read.
    Codex forks are cut by their history start in `observe`."""
    main = Path(git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir").strip()).parent
    try:
        origin = git(checkout, "remote", "get-url", "origin").strip()
    except subprocess.CalledProcessError:
        origin = ""
    terms: Terms = {}
    for paragraph in found:
        terms.setdefault(paragraph["file"].removeprefix(SKILLS), []).extend(
            (term, literal(term), pattern(term)) for term in paragraph["terms"])
    observed = [result for host, path in transcripts(claude, codex, checkout)
                for result in [observe(host, path, terms, main, origin)] if result]
    groups: dict[tuple[str, str], dict[str, tuple[int, str]]] = {}  # (host, start): id: (read before, end)
    for record in stored.values():
        groups.setdefault((record["host"], record["start"]), {})[record["id"]] = (0, record["end"])
    for record, _ in observed:
        members = groups.setdefault((record["host"], record["start"]), {})
        before = members.get(record["id"], (1, ""))
        members[record["id"]] = (before[0], max(before[1], record["end"]))

    def rank(record: Record) -> tuple[int, str, str]:
        return (*groups[record["host"], record["start"]][record["id"]], record["id"])

    observed.sort(key=lambda pair: (pair[0]["start"], rank(pair[0])))
    seen: set[str] = set()
    records = []
    for record, used in observed:
        mine = rank(record)
        copied_until = max((end for other, (read, end) in groups[record["host"], record["start"]].items()
                            if (read, end, other) < mine), default="")
        for file, by_term in used.items():
            record["loads"][file][1] = sorted(
                term for term, calls in by_term.items()
                if any(call not in seen and stamp > copied_until for call, stamp in calls.items()))
        seen.update(call for by_term in used.values() for calls in by_term.values() for call in calls)
        records.append(record)
    return records


# Store

def merge(stored: Record, new: Record) -> Record:
    """A session read again: the earlier first load of each file, every identifier either reading saw used."""
    loads = dict(stored["loads"])
    for file, (stamp, used) in new["loads"].items():
        before = loads.get(file, [stamp, []])
        loads[file] = [min(stamp, before[0]), sorted({*before[1], *used})]
    return {**stored, **new, "start": min(stored["start"], new["start"]), "end": max(stored["end"], new["end"]),
            "maintenance": stored["maintenance"] or new["maintenance"], "loads": dict(sorted(loads.items()))}


def read_store(path: Path) -> dict[str, Record]:
    if not path.exists():
        return {}
    return {record["id"]: record for line in path.read_text(encoding="utf-8").splitlines() if line
            for record in [json.loads(line)]}


def write_store(path: Path, records: dict[str, Record]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text("".join(json.dumps(records[key], ensure_ascii=False, sort_keys=True) + "\n"
                                 for key in sorted(records)), encoding="utf-8")
    os.replace(temporary, path)


# Heat

def group(record: Record, maintenance: bool) -> int:
    """Page filter slot: host, main session or sub-agent, maintenance."""
    return HOSTS.index(record["host"]) * 4 + (2 if record["parent"] else 0) + (1 if maintenance else 0)


def heat(found: list[Record], records: dict[str, Record], until: str | None, compare: str | None) -> Record:
    sessions = [record for record in records.values() if not until or record["start"] < until]
    by_id = {record["id"]: record for record in records.values()}
    loaded_by_file: dict[str, list[tuple[int, str, str, set[str]]]] = {}
    counts = [0] * 8
    for record in sessions:
        parent = by_id.get(record["parent"] or "")
        doctor = any(file.startswith(DOCTOR) for file in [*record["loads"], *(parent or {}).get("loads", ())])
        slot = group(record, record["maintenance"] or bool(parent and parent["maintenance"]))
        counts[slot] += 1
        for file, (stamp, used) in record["loads"].items():
            if not doctor or file.startswith(DOCTOR):
                loaded_by_file.setdefault(SKILLS + file, []).append((slot, stamp, record["start"], set(used)))
    files = {paragraph["file"]: [0] * 8 for paragraph in found}
    for file, loads in loaded_by_file.items():
        for slot, _, _, _ in loads:
            if file in files:
                files[file][slot] += 1
    rows = []
    for paragraph in found:
        unique = {term for term in paragraph["terms"] if paragraph["shared"][term] == 1}
        reading: dict[str, list[int]] = {key: [0] * 8 for key in ("opp", "hit", "opp_before", "hit_before")}
        by_term = {term: [0] * 8 for term in paragraph["terms"]}
        for slot, stamp, start, used in loaded_by_file.get(paragraph["file"], ()):
            if stamp < paragraph["since"]:
                continue
            before = compare is not None and start < compare
            for key, counted in (("opp", True), ("hit", bool(used & unique))):
                reading[key][slot] += counted
                reading[key + "_before"][slot] += counted and before
            for term in used & set(paragraph["terms"]):
                by_term[term][slot] += 1
        rows.append({"file": paragraph["file"], "line": paragraph["line"], "heading": paragraph["heading"],
                     "words": paragraph["words"], "since": paragraph["since"][:10], "text": paragraph["text"],
                     "terms": [[term, paragraph["shared"][term], by_term[term]] for term in paragraph["terms"]],
                     **reading})
    starts = sorted(record["start"] for record in sessions)
    meta = {"until": until or iso(datetime.now(UTC).isoformat()), "compare": compare,
            "first": starts[0][:10] if starts else "", "last": starts[-1][:10] if starts else "", "groups": counts}
    return {"meta": meta, "files": files, "paras": rows}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--store", type=Path, required=True, help="JSON lines, one per session; merged in place")
    parser.add_argument("--output", type=Path, required=True, help="directory for data.json and index.html")
    parser.add_argument("--checkout", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--claude", type=Path, default=Path.home() / ".claude/projects")
    parser.add_argument("--codex", type=Path, default=Path.home() / ".codex")
    parser.add_argument("--until", help="count sessions that started before this UTC date or time")
    parser.add_argument("--compare", help="also count the sessions that started before this date, for the change")
    parser.add_argument("--no-scan", action="store_true", help="draw the store as it is, reading no transcript")
    args = parser.parse_args(argv)
    until, compare = (iso(value + ("T00:00:00Z" if len(value) == 10 else "")) if value else None
                      for value in (args.until, args.compare))
    found = paragraphs(args.checkout)
    records = read_store(args.store)
    added = 0
    if not args.no_scan:
        for record in scan(args.claude, args.codex, args.checkout, found, records):
            added += record["id"] not in records
            records[record["id"]] = merge(records[record["id"]], record) if record["id"] in records else record
        write_store(args.store, records)
    data = heat(found, records, until, compare)
    data["meta"]["head"] = git(args.checkout, "rev-parse", "--short", "HEAD").strip()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    page = TEMPLATE.read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False)
                                                         .replace("</", "<\\/"))
    (args.output / "index.html").write_text(page, encoding="utf-8")
    print(f"skill heat: {len(found)} paragraphs, {len(records)} stored sessions ({added} new), "
          f"{sum(data['meta']['groups'])} counted; {args.output / 'index.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
