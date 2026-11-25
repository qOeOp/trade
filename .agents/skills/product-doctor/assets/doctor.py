"""Run an audit's commands and probes and derive its claims from what they returned, so that the audit does not grade
itself. Evidence is kept in one directory under the temporary root; nothing else is written. Advice only: it edits no
issue and gates nothing.

Run from a checkout under the project environment: `uv run --frozen python .agents/skills/product-doctor/assets/doctor.py`.
Trees are `git archive` copies, so a probe never sees uncommitted changes or the checkout the environment points at.

A probe is a Python file whose `probe()` returns (observed, expected): equal means the property holds, unequal shows
the defect, an exception or exit means the probe is broken. Its `control()` returns the same for an input on
which both the state and the observed reading must be the other: one reading for every input proves nothing. A cost probe's `setup(n)` returns the callable to time at size n.

A SUBJECT is OBJECT:SCENARIO. An object is a path of the tree, two joined with `+` for the contract between them, or
`@name` for something outside the tree (`@binance`). Every path counts for its top-level directory; the files of the
root are `root`. `scan` lists those from the tree, so an audit does not choose what it could have examined.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
import tarfile
import tempfile
import time
from typing import Any

LENSES = Path(__file__).resolve().parents[1] / "references/lenses.md"
ITEM = re.compile(r"^- \*\*([a-z]+)\*\* \[([a-z ]+)\]:", re.MULTILINE)
ANY = "any"
ROOT = "root"
THEMES = ("harm", "slim", "find", "friction")
RECORDS = "docs/plans/doctor/"
RECORDED = re.compile(r"^\| ([a-z]+) \| ([^|]+) \| (?:examined|failed) \|", re.MULTILINE)
NOT_PRODUCT = ("tests/", "docs/", "changelog.d/", ".agents/evals/")
REPEATS = 3
SHOWN = 400  # characters of a value kept

# Runs in a child process: argv is (tree, result file, probe file, function, size or "").
CHILD = r'''
import json, pathlib, runpy, sys, time
tree, out, probe, name, size = sys.argv[1:]
found = runpy.run_path(probe, run_name="doctor_probe")
if size:
    call, seconds = found["setup"](int(size)), []
    for _ in range(int(name) + 1):
        began = time.perf_counter(); call(); seconds.append(time.perf_counter() - began)
    result = {"seconds": seconds}
elif name not in found:
    result = {"state": "none"}
else:
    observed, expected = found[name]()
    result = {"state": "holds" if observed == expected else "defect",
              "observed": repr(observed)[:SHOWN], "expected": repr(expected)[:SHOWN]}
root = pathlib.Path(tree).resolve()
names = {path.name for path in root.iterdir() if path.is_dir()}
for module in list(sys.modules.values()):
    file = getattr(module, "__file__", None)
    if file and module.__name__.split(".")[0] in names and not pathlib.Path(file).resolve().is_relative_to(root):
        raise SystemExit(f"{module.__name__} was imported from {file}, not from {root}")
pathlib.Path(out).write_text(json.dumps(result))
'''.replace("SHOWN", str(SHOWN))

# Runs in a child process: argv is (result file, test module...). Every test's own outcome.
TESTS = r'''
import json, pathlib, sys, unittest
seen = {}
class Result(unittest.TestResult):
    def put(self, test, state):
        order = ("ok", "skip", "fail", "error")
        seen[test.id()] = max(seen.get(test.id(), "ok"), state, key=order.index)
    def addSuccess(self, test): self.put(test, "ok")
    def addFailure(self, test, err): self.put(test, "fail")
    def addError(self, test, err): self.put(test, "error")
    def addSkip(self, test, reason): self.put(test, "skip")
    def addSubTest(self, test, subtest, err):
        if err: self.put(test, "fail" if issubclass(err[0], test.failureException) else "error")
    def addExpectedFailure(self, test, err): self.put(test, "ok")
    def addUnexpectedSuccess(self, test): self.put(test, "fail")
unittest.defaultTestLoader.loadTestsFromNames(sys.argv[2:]).run(Result())
pathlib.Path(sys.argv[1]).write_text(json.dumps(seen))
'''


def git(*args: str) -> bytes:
    done = subprocess.run(["git", *args], capture_output=True, check=False)
    if done.returncode:
        raise SystemExit(f"git {' '.join(args)}: {done.stderr.decode().strip()}")
    return done.stdout


def commit(rev: str) -> str:
    return git("rev-parse", "--verify", rev + "^{commit}").decode().strip()


@contextmanager
def tree(rev: str, reverted: Sequence[str] = ()) -> Iterator[Path]:
    """A copy of `rev`, with the paths in `reverted` as its parent holds them."""
    with tempfile.TemporaryDirectory(prefix="doctor-tree-") as name:
        root = Path(name).resolve()
        with tarfile.open(fileobj=io.BytesIO(git("archive", rev))) as archive:
            archive.extractall(root, filter="data")
        for path in reverted:
            (root / path).unlink(missing_ok=True)
        before = [path for path in reverted if git("ls-tree", "--name-only", f"{rev}^", "--", path).strip()]
        if before:
            with tarfile.open(fileobj=io.BytesIO(git("archive", f"{rev}^", "--", *before))) as archive:
                archive.extractall(root, filter="data")
        yield root


def child(root: Path, code: str, args: Sequence[str], timeout: float) -> tuple[Any, str]:
    """(the child's result or None, the end of its output); only `root` is importable as product code."""
    environment = {key: value for key, value in os.environ.items() if not key.startswith(("PYTHON", "GIT_"))}
    with tempfile.TemporaryDirectory(prefix="doctor-out-") as name:
        out = Path(name) / "result.json"
        argv = [sys.executable, "-c", code, *(str(out) if arg == "OUT" else arg for arg in args)]
        try:
            done = subprocess.run(argv, cwd=root, capture_output=True, text=True, errors="replace", check=False,
                                  timeout=timeout, env={**environment, "PYTHONPATH": str(root)})
        except subprocess.TimeoutExpired:
            return None, f"timed out after {timeout:g} s"
        result = json.loads(out.read_text()) if out.exists() else None
        return result, (done.stdout + done.stderr)[-SHOWN:].strip()


def ask(root: Path, probe: Path, name: str, timeout: float) -> dict:
    result, tail = child(root, CHILD, [str(root), "OUT", str(probe.resolve()), name, ""], timeout)
    return result or {"state": "broken", "why": tail or "it returned nothing"}


def verdict(main: dict, control: dict | None) -> str:
    if main["state"] == "broken" or (control and control["state"] == "broken"):
        return "broken"
    if control is None:
        return "uncontrolled"
    if main["state"] == control["state"] or main["observed"] == control["observed"]:
        return "indiscriminate"  # one reading for both inputs may be a constant, whatever was expected of each
    return "shown" if main["state"] == "defect" else "absent"


def keep(directory: Path, row: dict) -> None:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (directory / "evidence.jsonl").open("a") as stream:
        stream.write(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **row}) + "\n")
    print(json.dumps(row, ensure_ascii=False, indent=1))


def rows(directory: Path) -> list[dict]:
    path = directory / "evidence.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def items() -> dict[str, list[str]]:
    """lenses.md's full-audit list: {item: what it must cover}."""
    found = ITEM.findall(LENSES.read_text())
    if not found or len({name for name, _ in found}) != len(found):
        raise SystemExit(f"{LENSES} names no audit items, or one twice")
    return {name: subjects.split() for name, subjects in found}


def objects(rev: str) -> list[str]:
    """The tree's top-level directories that hold more than Markdown and links, and the files of its root."""
    found = set()
    for line in git("ls-tree", "-r", "-z", rev).decode().split("\0")[:-1]:
        mode, path = line.split(" ", 1)[0], line.split("\t", 1)[1]
        if "/" not in path:
            found.add(ROOT)
        elif mode.startswith("100") and not path.endswith(".md"):
            found.add(path.split("/", 1)[0])
    return sorted(found)


def split(subject: str) -> tuple[list[str], str]:
    """(the subject's objects, its scenario); no object without both."""
    named, _, scenario = subject.partition(":")
    return [part for part in named.split("+") if scenario.strip()], scenario


def covers(subject: str) -> set[str]:
    """The top-level objects a subject counts for."""
    return {part.split("/", 1)[0] for part in split(subject)[0] if not part.startswith("@")}


def known(item: str, subject: str, rev: str) -> None:
    subjects = items().get(item)
    if subjects is None:
        raise SystemExit(f"{item} is not an audit item: {', '.join(items())}")
    parts, scenario = split(subject)
    if not parts or len(parts) > 2 or "|" in subject:
        raise SystemExit(f"{subject} is not OBJECT:SCENARIO, with one object or two joined by +")
    tops = objects(rev)
    for part in parts:
        if re.fullmatch(r"@[\w.-]+", part) or part == ROOT:
            continue
        if part.split("/", 1)[0] not in tops or not git("ls-tree", rev, "--", part.rstrip("/")).strip():
            raise SystemExit(f"{part} is no path under {', '.join(tops)}; something outside the tree is written @name")
    if subjects != [ANY] and scenario not in subjects:
        raise SystemExit(f"{item} covers OBJECT:{', OBJECT:'.join(subjects)}, not {subject}")


def history(rev: str) -> tuple[dict[str, str], dict[str, str]]:
    """({top-level object: date}, {item: date}) last exercised, from the audit records in the tree."""
    by_object: dict[str, str] = {}
    by_item: dict[str, str] = {}
    for path in sorted(git("ls-tree", "--name-only", rev, "--", RECORDS).decode().split()):
        date = Path(path).name[:10]
        if not re.fullmatch(r"\d{4}-\d\d-\d\d", date):
            continue
        for item, subject in RECORDED.findall(git("show", f"{rev}:{path}").decode()):
            by_item[item] = date
            by_object.update(dict.fromkeys(covers(subject.strip()), date))
    return by_object, by_item


def scan(args: argparse.Namespace) -> None:
    rev = commit(args.tree)
    by_object, by_item = history(rev)
    table: dict[str, dict[str, Any]] = {name: {"commits": 0, "fixes": 0, "added": 0, "removed": 0, "examined": by_object.get(name)}
                                        for name in objects(rev)}
    fixed: dict[str, int] = {}
    log = git("log", "--no-renames", f"--since={args.days} days ago", "--numstat", "--format=\x01%s", rev)
    for change in log.decode(errors="replace").split("\x01")[1:]:
        title, _, body = change.partition("\n")
        is_fix = bool(re.match(r"fix(\(|:|!)", title))
        touched = set()
        for line in filter(None, body.splitlines()):
            added, removed, path = line.split("\t", 2)
            name = path.split("/", 1)[0] if "/" in path else ROOT
            if name not in table:
                continue
            touched.add(name)
            table[name]["added"] += int(added) if added.isdigit() else 0
            table[name]["removed"] += int(removed) if removed.isdigit() else 0
            if is_fix:
                fixed[path] = fixed.get(path, 0) + 1
        for name in touched:
            table[name]["commits"] += 1
            table[name]["fixes"] += is_fix
    print(json.dumps({"tree": rev, "days": args.days, "objects": table,
                      "fixed_files": dict(sorted(fixed.items(), key=lambda pair: (-pair[1], pair[0]))[:20]),
                      "items": {name: by_item.get(name) for name in items()}}, indent=1))


def scope(args: argparse.Namespace) -> None:
    """What a themed audit is judged against; declared before its evidence, so that it cannot shrink to what was done."""
    if rows(args.directory):
        raise SystemExit("the scope comes before any evidence, once")
    rev = commit(args.tree)
    listed, tops = items(), objects(rev)
    for name in args.objects:
        if name not in tops:
            raise SystemExit(f"{name} is not an object of scan: {', '.join(tops)}")
    for wanted in args.items:
        item, _, scenario = wanted.partition("/")
        if item not in listed or scenario and scenario not in listed[item]:
            raise SystemExit(f"{wanted} is not an audit item, or ITEM/SCENARIO")
    if args.theme != "harm" and not (args.items and args.objects):
        raise SystemExit(f"{args.theme} names the items and objects it examines")
    keep(args.directory, {"kind": "scope", "theme": args.theme, "items": args.items, "objects": args.objects, "tree": rev})


def written(path: Path | None) -> int | None:
    return path.stat().st_mtime_ns if path and path.is_file() else None


def run(args: argparse.Namespace) -> None:
    known(args.item, args.subject, commit("HEAD"))
    before = written(args.artifact)
    began = time.monotonic()
    try:
        done = subprocess.run(args.command, capture_output=True, timeout=args.timeout, check=False)
        status, output = done.returncode, done.stdout + done.stderr
    except subprocess.TimeoutExpired as late:
        status, output = None, (late.stdout or b"") + (late.stderr or b"")
    except OSError as error:
        status, output = None, str(error).encode()
    digest = hashlib.sha256(output).hexdigest()
    args.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    (args.directory / f"{digest[:16]}.out").write_bytes(output)
    # A file the command did not write (its own script, an earlier run's page) shows nothing of this run.
    shown = args.artifact.read_bytes() if written(args.artifact) != before else None
    keep(args.directory, {
        "kind": "run", "item": args.item, "subject": args.subject, "command": args.command, "cwd": str(Path.cwd()),
        "checkout": commit("HEAD"), "dirty": bool(git("status", "--porcelain").strip()), "exit": status,
        "seconds": round(time.monotonic() - began, 2), "output_bytes": len(output), "output_sha256": digest,
        "skipped": sum(int(count) for count in re.findall(rb"skipped=(\d+)", output)),
        "artifact": str(args.artifact) if args.artifact else None,
        "artifact_sha256": None if not shown else hashlib.sha256(shown).hexdigest()})


def unexamined(args: argparse.Namespace) -> None:
    if args.item not in items():
        raise SystemExit(f"{args.item} is not an audit item: {', '.join(items())}")
    if not args.why.strip():
        raise SystemExit("say what stopped it")
    keep(args.directory, {"kind": "unexamined", "item": args.item, "subject": args.subject, "why": args.why})


def probe(args: argparse.Namespace) -> None:
    data = args.probe.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if args.refutes and not any(row["kind"] == "probe" and row["id"] == args.id for row in rows(args.directory)):
        raise SystemExit(f"{args.id} names no claim")
    if args.refutes and any(row["kind"] == "probe" and row["id"] == args.id and row["probe_sha256"] == digest
                            for row in rows(args.directory)):
        raise SystemExit("this is the claim's own probe; a refutation is written without it")
    main_rev = commit(args.tree)
    with tree(main_rev) as root:
        main = ask(root, args.probe, "probe", args.timeout)
        control = None if args.control_tree else ask(root, args.probe, "control", args.timeout)
        if control and control["state"] == "none":
            control = None
    control_rev = commit(args.control_tree) if args.control_tree else None
    if control_rev:
        with tree(control_rev) as root:
            control = ask(root, args.probe, "probe", args.timeout)
    before = None
    if args.before:
        with tree(commit(args.before)) as root:
            before = ask(root, args.probe, "probe", args.timeout)["state"]
    args.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = f"{args.id}{'.refutes' if args.refutes else ''}.py"
    (args.directory / name).write_bytes(data)
    keep(args.directory, {
        "kind": "refutation" if args.refutes else "probe", "id": args.id, "probe": name, "probe_sha256": digest,
        "tree": main_rev, "main": main, "control_tree": control_rev, "control": control,
        "verdict": verdict(main, control),
        # A probe an older tree cannot run says nothing about it.
        "before": None if before is None else {"defect": "present", "holds": "absent"}.get(before, "unknown")})


def growth(sizes: Sequence[int], medians: Sequence[float]) -> float:
    """The slope of log time over log size."""
    xs, ys = [math.log(size) for size in sizes], [math.log(max(value, 1e-9)) for value in medians]
    middle_x, middle_y = statistics.fmean(xs), statistics.fmean(ys)
    return (sum((x - middle_x) * (y - middle_y) for x, y in zip(xs, ys, strict=True))
            / sum((x - middle_x) ** 2 for x in xs))


def read_cost(readings: dict[int, list[float]]) -> dict:
    """The first call of each size apart (cold); over the later ones the medians, their growth, and whether
    neighbouring sizes can be told apart at all: none of their readings overlap."""
    sizes = sorted(readings)
    warm = {size: readings[size][1:] for size in sizes}
    medians = [statistics.median(warm[size]) for size in sizes]
    noisy = any(max(warm[a]) >= min(warm[b]) and max(warm[b]) >= min(warm[a])
                for a, b in zip(sizes, sizes[1:], strict=False))
    return {"cold_s": {size: round(readings[size][0], 6) for size in sizes},
            "warm_s": {size: [round(value, 6) for value in warm[size]] for size in sizes},
            "verdict": "noisy" if noisy else "measured",
            "exponent": None if noisy else round(growth(sizes, medians), 2)}


def cost(args: argparse.Namespace) -> None:
    rev, readings = commit(args.tree), {}
    known("cost", args.subject, rev)
    sizes = sorted({int(size) for size in args.sizes.split(",")})
    if len(sizes) < 3 or sizes[0] < 1:
        raise SystemExit("a growth rate needs three different sizes of at least 1")
    with tree(rev) as root:
        for size in sizes:
            result, tail = child(root, CHILD, [str(root), "OUT", str(args.probe.resolve()), str(REPEATS), str(size)],
                                 args.timeout)
            if result is None:
                keep(args.directory, {"kind": "cost", "item": "cost", "subject": args.subject, "tree": rev,
                                      "verdict": "broken", "why": f"size {size}: {tail}"})
                return
            readings[size] = result["seconds"]
    keep(args.directory, {"kind": "cost", "item": "cost", "subject": args.subject, "tree": rev,
                          "probe": str(args.probe), **read_cost(readings)})


def judge(fixed: dict[str, str], reverted: dict[str, str], now: dict[str, str]) -> tuple[str, list[str]]:
    """(verdict, the tests that decide it). Only a test that passes with the repair and fails its assertion without it
    speaks: an import error, another error or a skip says nothing."""
    telling = sorted(name for name, state in fixed.items() if state == "ok" and reverted.get(name) == "fail")
    if not telling:
        return "undecided", []
    broken = [name for name in telling if now.get(name) == "fail"]
    if broken:
        return "regressed", broken
    held = [name for name in telling if now.get(name) == "ok"]
    return ("confirmed", held) if held else ("undecided", telling)


def recheck(args: argparse.Namespace) -> None:
    rev, main_rev = commit(args.commit), commit(args.tree)
    paths = git("diff-tree", "-r", "--no-renames", "--no-commit-id", "--name-only", f"{rev}^", rev).decode().splitlines()
    product = [path for path in paths if not path.startswith(NOT_PRODUCT) and not path.endswith(".md")]
    modules = [path[:-3].replace("/", ".") for path in paths
               if path.startswith("tests/") and Path(path).name.startswith("test_") and path.endswith(".py")]
    row = {"kind": "recheck", "item": "fixed", "subject": rev[:9], "tree": main_rev, "modules": modules}
    if not product or not modules:
        keep(args.directory, {**row, "verdict": "no test", "tests": []})
        return
    found: list[dict[str, str]] = []
    notes: dict[str, dict[str, Any]] = {}
    for name, at, paths_back in (("fixed", rev, ()), ("reverted", rev, product), ("now", main_rev, ())):
        with tree(at, paths_back) as root:
            here = [module for module in modules if (root / (module.replace(".", "/") + ".py")).exists()]
            result, tail = child(root, TESTS, ["OUT", *here], args.timeout) if here else ({}, "")
        found.append(result or {})
        notes[name] = {state: list((result or {}).values()).count(state) for state in ("ok", "fail", "error", "skip")}
        if result is None:
            notes[name]["why"] = tail
    decided, tests = judge(*found)
    keep(args.directory, {**row, "verdict": decided, "tests": tests, "outcomes": notes})


def state(row: dict, seen: list[dict]) -> str:
    """What one recorded row says about its subject; only `examined` and `failed` mean it was exercised."""
    if row["kind"] == "cost":
        return "examined" if row["verdict"] == "measured" else row["verdict"]
    if row["kind"] == "recheck":
        return "examined" if row["verdict"] in ("confirmed", "regressed") else row["verdict"]
    if row["exit"] is None:
        return "not run"
    if not row["output_bytes"] and not row["artifact_sha256"]:
        return "empty"
    if row["artifact"] and not row["artifact_sha256"]:
        return "no artifact"
    mark = row["artifact_sha256"] or row["output_sha256"]
    if any(other["subject"] != row["subject"] and mark == (other["artifact_sha256"] or other["output_sha256"])
           for other in seen if other["kind"] == "run" and other["item"] == row["item"]):
        return "same as another"
    if row["skipped"]:
        return "skipped tests"
    return "failed" if row["exit"] else "examined"


def coverage(found: list[dict], tops: list[str]) -> tuple[dict[tuple[str, str], list[tuple[dict, str]]], list[str]]:
    """({(item, subject): [(row, state)]}, what of the declared scope, or of everything, is missing)."""
    listed = items()
    table: dict[tuple[str, str], list[tuple[dict, str]]] = {}
    for row in found:
        if row.get("item") in listed and row["kind"] != "unexamined":
            table.setdefault((row["item"], row["subject"]), []).append((row, state(row, found)))
    done = {key for key, entries in table.items() if any(said in ("examined", "failed") for _, said in entries)}
    declared = next((row for row in found if row["kind"] == "scope"), None)
    missing = []
    for wanted in declared["items"] if declared else listed:
        item, _, only = wanted.partition("/")
        if listed[item] == [ANY]:
            missing += [] if any(name == item for name, _ in done) else [item]
        else:
            reached = {split(subject)[1] for name, subject in done if name == item}
            missing += [f"{item}/{scenario}" for scenario in ([only] if only else listed[item]) if scenario not in reached]
    reached = {top for _, subject in done for top in covers(subject)}
    missing += [f"{top} (object)" for top in (declared["objects"] if declared else tops) if top not in reached]
    if declared and declared["theme"] == "harm" and not any(row["kind"] == "probe" for row in found):
        missing.append("a probe of an open finding")
    return table, missing


def stopped(found: list[dict]) -> list[dict]:
    """The subjects named unexamined that no later row exercised."""
    late = {}
    for row in found:
        if row["kind"] == "unexamined":
            late[row["item"], row["subject"]] = row
        elif row.get("item") and state(row, found) in ("examined", "failed"):
            late.pop((row["item"], row["subject"]), None)
    return list(late.values())


def spent(found: list[dict]) -> str:
    if not found:
        return "no evidence"
    first, final = (datetime.strptime(found[at]["at"], "%Y-%m-%dT%H:%M:%SZ") for at in (0, -1))
    return f"{found[0]['at']} to {found[-1]['at']}, {(final - first).total_seconds() / 60:.0f} minutes"


def cell(value: object) -> str:
    return " ".join(str(value).split()).replace("|", "\\|")


def last(reading: dict) -> str:
    """A broken reading's own error; the traceback above it names local paths, which a public record does not carry."""
    return (reading.get("why") or "none").splitlines()[-1]


def report(args: argparse.Namespace) -> None:
    found = rows(args.directory)
    table, missing = coverage(found, objects(commit(args.tree)))
    late = stopped(found)
    declared = next((row for row in found if row["kind"] == "scope"), None)
    whole = not missing and not late
    title = (f"{'Themed' if whole else 'Partial themed'} audit: {declared['theme']}" if declared
             else "Full audit" if whole else "Partial audit")
    print(f"# {title}\n")
    if declared:
        print(f"Scope, declared first: {', '.join(declared['items']) or 'no item'}; "
              f"{', '.join(declared['objects']) or 'no object'}. Nothing else is judged here.\n")
    print("Not exercised: " + (", ".join(missing) if missing else "nothing listed") + ".\n")
    print("Not examined: " + ("; ".join(f"{row['item']}/{cell(row['subject'])} ({cell(row['why'])})" for row in late)
                              or "nothing named") + ".\n")
    print(f"Evidence: {spent(found)}.\n")
    print("| Item | Subject | State | Evidence |\n|---|---|---|---|")
    order = list(items())
    for (item, subject), entries in sorted(table.items(), key=lambda pair: order.index(pair[0][0])):
        # The last attempt that exercised it speaks, else the last one; the others are counted.
        row, said = ([entry for entry in entries if entry[1] in ("examined", "failed")] or entries)[-1]
        evidence = (f"`{cell(' '.join(row['command']))}` exit {row['exit']}, {row['checkout'][:9]}"
                    f"{' with changes' if row['dirty'] else ''}" if row["kind"] == "run"
                    else f"exponent {row.get('exponent')}, warm {row.get('warm_s')}" if row["kind"] == "cost"
                    else f"{len(row['tests'])} telling tests")
        states = [entry[1] for entry in entries]
        tried = ", ".join(f"{states.count(one)} {one}" for one in dict.fromkeys(states))
        print(f"| {item} | {cell(subject)} | {said} | {evidence}{f' ({tried})' if len(states) > 1 else ''} |")
    probes = [row for row in found if row["kind"] == "probe"]
    latest = {row["id"]: row for row in probes}
    reruns = {row["id"]: row for row in found if row["kind"] == "refutation"}
    print("\n| Finding | Verdict | Observed | Expected | Control | At the last audit | Refuter's probe |\n"
          "|---|---|---|---|---|---|---|")
    for name, row in latest.items():
        main, control = row["main"], row["control"] or {}
        print(f"| {cell(name)} | {row['verdict']} | {cell(main.get('observed', last(main)))} | "
              f"{cell(main.get('expected', '-'))} | {cell(control.get('observed', last(control)))} | "
              f"{row['before'] or '-'} | {reruns[name]['verdict'] if name in reruns else 'none'} |")
    old = [row["before"] for row in latest.values() if row["verdict"] == "shown" and row["before"] not in (None, "unknown")]
    print(f"\nShown: {sum(row['verdict'] == 'shown' for row in latest.values())} of {len(latest)} probed. "
          f"Of {len(old)} datable ones, the last audit already had {old.count('present')}. "
          f"Shown by a refuter's own probe too: "
          f"{sum(row['verdict'] == 'shown' and name in reruns and reruns[name]['verdict'] == 'shown' for name, row in latest.items())}.")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(required=True)

    def add(name: str, function, text: str, seconds: float) -> argparse.ArgumentParser:
        added = commands.add_parser(name, help=text, description=text)
        added.add_argument("directory", type=Path, help="the audit's evidence directory, under the temporary root")
        added.add_argument("--timeout", type=float, default=seconds, help="seconds per process (default: %(default)g)")
        added.set_defaults(function=function)
        return added

    def named(text: str) -> list[str]:
        return [part for part in text.split(",") if part]

    zero = commands.add_parser("scan", help="list the tree's objects with what changed and when each was last examined")
    zero.add_argument("--days", type=int, default=14)
    zero.set_defaults(function=scan)
    declared = add("scope", scope, "declare a themed audit's items and objects, before any evidence", 0)
    declared.add_argument("theme", choices=THEMES)
    declared.add_argument("--items", type=named, default=[], help="comma-separated: ITEM, or ITEM/SCENARIO of a listed one")
    declared.add_argument("--objects", type=named, default=[], help="comma-separated, of those scan lists")
    one = add("run", run, "record a command that exercises an audit item; after `--`, the command", 3600)
    one.add_argument("item")
    one.add_argument("subject")
    one.add_argument("--artifact", type=Path, help="the file the command writes that shows the result (a page's text)")
    one = add("probe", probe, "judge a finding's probe against its control", 600)
    one.add_argument("id")
    one.add_argument("probe", type=Path)
    one.add_argument("--control-tree", metavar="REV", help="run probe() there instead of control() here")
    one.add_argument("--before", metavar="REV", help="the last full audit's checkout: was it already there?")
    one.add_argument("--refutes", action="store_true", help="a refuter's own probe of claim ID, beside the claim's")
    two = add("cost", cost, "time a cost probe at three or more sizes", 600)
    two.add_argument("subject")
    two.add_argument("probe", type=Path)
    two.add_argument("--sizes", required=True, help="comma-separated")
    three = add("recheck", recheck, "whether a repair's own tests fail without it and pass now", 1800)
    three.add_argument("commit")
    for parsed in (one, two, three):
        parsed.add_argument("--tree", default="origin/main", metavar="REV", help="product tree (default: %(default)s)")
    four = add("unexamined", unexamined, "name what a pass did not reach; the audit is then partial", 0)
    four.add_argument("item")
    four.add_argument("subject")
    four.add_argument("why", help="what stopped it")
    final = add("report", report, "print coverage and findings from the evidence", 0)
    for parsed in (zero, declared, final):
        parsed.add_argument("--tree", default="origin/main", metavar="REV", help="product tree (default: %(default)s)")
    given = list(sys.argv[1:] if argv is None else argv)
    command: list[str] = []
    if given[:1] == ["run"] and "--" in given:
        given, command = given[:given.index("--")], given[given.index("--") + 1:]
    args = parser.parse_args(given)
    args.command = command
    if args.function is run and not command:
        raise SystemExit("run needs `-- COMMAND`")
    if args.function is scan:
        return scan(args)
    args.directory = args.directory.resolve()
    roots = {Path(tempfile.gettempdir()).resolve(), Path("/tmp").resolve()}
    if not any(args.directory.is_relative_to(root) for root in roots):
        raise SystemExit(f"{args.directory} is not under the temporary root")
    args.function(args)


if __name__ == "__main__":
    main()
