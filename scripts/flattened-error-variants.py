#!/usr/bin/env python3
"""
List public error-enum variants whose every production site is flattened before a
caller.

A variant is flattened when the cause it names is discarded on the way out: an
`Err(Conflict)` that passes through `.map_err(|_| Unavailable)` reaches its caller as
`Unavailable`, and a caller told "unavailable" about a permanent refusal retries it
forever. This walks upward from every production site of every variant, one call edge at
a time, and reports the variants for which every path it can follow ends at a step that
discards the cause.

Which ruler, and where it is blind
----------------------------------

The walk is by name, over source text, transitively. That choice is forced: the compiler
never calls a `pub` item dead and has no notion of an error's cause, and nothing else in
the tree follows a value through `?`. What that costs, stated so the list is not read as
more than it is:

- A function name declared more than once is attributed by crate - if exactly one
  declaration sits in the crate the walk came from, only that crate's call sites count.
  Otherwise the path is not followed. Callers in other crates are missed, which reads as
  reaching a boundary: that keeps a variant off the list, never puts one on it.
- Trait dispatch, closures, function pointers and macro expansion are invisible. A function
  called only through them looks like it has no callers.
- A result that is bound to a name, or matched, is not followed past that point.
- `?` is taken as propagating. A `From` impl that ignores its argument is a discard this
  does not see.
- Discards recognised: `.map_err(|_ ..| ..)`, `.ok()`, `.is_ok()`, `.is_err()`,
  `.unwrap_or*`, `if let Ok(..)` and `let Ok(..) else`. Anything else is not.
- A variant named in a pattern outside its own enum's impls is taken as observed by some
  caller, and never listed. A match that names it and then flattens it anyway is missed.
- A discard closure that names the cause, `.map_err(|e| ..)`, is taken as keeping it - even
  when it only writes the cause to a diagnostic log and returns a fixed variant. The caller
  sees the same flattening, but here it reads as passed on, so it keeps a variant off the
  list. Whether a logged cause is enough is the Owner's channel rule, not this walk's.

So the list is a lower bound: every entry has been followed along every path the walk
could follow and each one ended in a discard. What it could not follow is counted and
reported beside it, not guessed at.

Usage:
    scripts/flattened-error-variants.py                           # full report, HEAD
    scripts/flattened-error-variants.py --rev ba8f9bf5f           # full report at a rev
    scripts/flattened-error-variants.py Enum::Variant --rev <rev>  # one variant, every path

"""

import argparse
import collections
import functools
import importlib.util
import re
import sys
from pathlib import Path


_spec = importlib.util.spec_from_file_location(
    "production_producer_check",
    Path(__file__).with_name("production-producer-check.py"),
)
ppc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ppc)

DEPTH = 8

DISCARDS = [
    (re.compile(r"\.map_err\(\s*\|\s*_[A-Za-z0-9_]*\s*\|"), "map_err(|_| ..)"),
    (re.compile(r"\.ok\(\)"), ".ok()"),
    (re.compile(r"\.is_ok\(\)|\.is_err\(\)"), ".is_ok() / .is_err()"),
    (
        re.compile(r"\.unwrap_or\(|\.unwrap_or_default\(\)|\.unwrap_or_else\(\s*\|\s*_"),
        ".unwrap_or*",
    ),
]
LET_OK = re.compile(r"\bif let Ok\(|\blet Ok\(")
KEEPS_CAUSE = [
    re.compile(r"\.map_err\(\s*\|\s*[a-z][A-Za-z0-9_]*\s*\|"),
    re.compile(r"\.map_err\(\s*[A-Z][A-Za-z0-9_:]*::from\s*\)"),
    re.compile(r"\.map_err\(\s*(Into::into|From::from)\s*\)"),
]
ENUM_RE = re.compile(r"^\s*pub enum ([A-Za-z0-9_]*Error[A-Za-z0-9_]*)\b")
VARIANT_RE = re.compile(r"^\s*([A-Z][A-Za-z0-9_]*)\s*(?:[,({]|$)")
IMPL_RE = re.compile(r"^\s*impl(?:<[^>]*>)?\s+(?:([A-Za-z0-9_:<>, ]+?)\s+for\s+)?([A-Za-z0-9_]+)")
TOKEN_RE = re.compile(r"\b([A-Z][A-Za-z0-9_]*)::([A-Z][A-Za-z0-9_]*)\b")


# --- the enums -----------------------------------------------------------------------


def public_error_enums(rev):
    """
    Map enum name -> [(path, line, [(variant, line)])] for ungated production enums.
    """
    enums = collections.defaultdict(list)
    for path, lineno, text in ppc.grep(rev, r"^[[:space:]]*pub enum [A-Za-z0-9_]*Error"):
        match = ENUM_RE.match(text)
        if not match or not ppc.is_production_file(path) or ppc.gates(rev, path, lineno):
            continue
        lines = ppc.file_lines(rev, path)
        depth, started, variants = 0, False, []
        for index in range(lineno - 1, min(lineno + 400, len(lines))):
            code = ppc.strip_literals(lines[index])
            if depth == 1 and started and not code.strip().startswith("#"):
                found = VARIANT_RE.match(code)
                if found:
                    variants.append((found.group(1), index + 1))
            depth += code.count("{") - code.count("}")
            started = started or "{" in code
            if started and depth <= 0:
                break
        enums[match.group(1)].append((path, lineno, variants))
    return dict(enums)


@functools.cache
def impl_blocks(rev, path):
    lines = ppc.file_lines(rev, path)
    stack, out, depth = [], [], 0
    for index, line in enumerate(lines):
        code = ppc.strip_literals(line)
        match = IMPL_RE.match(code)
        if match and "{" in code:
            stack.append((depth, index + 1, match.group(2)))
        depth += code.count("{") - code.count("}")
        while stack and depth <= stack[-1][0]:
            opened_at, start, self_type = stack.pop()
            out.append((start, index + 1, self_type))
            del opened_at
    return out


def impl_type_at(rev, path, lineno):
    best = None
    for start, end, self_type in impl_blocks(rev, path):
        if start <= lineno <= end and (best is None or start > best[0]):
            best = (start, self_type)
    return best[1] if best else None


def is_pattern(code, end):
    stripped = code.strip()
    return (
        "=>" in code[end:]
        or stripped.startswith("|")
        or "matches!(" in code
        or re.search(r"\bif let\b|\bwhile let\b", code[:end]) is not None
    )


def index_sites(rev, unique):
    """
    Return the construction and observation sites of every variant of the unique-name
    enums.
    """
    constructs, observes = collections.defaultdict(list), collections.defaultdict(list)
    for path, lineno, text in ppc.grep(rev, r"[A-Z][A-Za-z0-9_]*::[A-Z]"):
        if not ppc.is_production_file(path):
            continue
        code = ppc.strip_literals(text)
        for match in TOKEN_RE.finditer(code):
            owner, variant = match.group(1), match.group(2)
            if owner == "Self":
                owner = impl_type_at(rev, path, lineno)
            if owner not in unique or variant not in unique[owner]:
                continue
            if ppc.gates(rev, path, lineno) or ppc.under_test_attribute(rev, path, lineno):
                continue
            if is_pattern(code, match.end()):
                if impl_type_at(rev, path, lineno) != owner:
                    observes[(owner, variant)].append((path, lineno))
            else:
                constructs[(owner, variant)].append((path, lineno))
    return constructs, observes


# --- one call edge ---------------------------------------------------------------------


def _past_group(text, index):
    depth = 0
    while index < len(text):
        depth += (text[index] == "(") - (text[index] == ")")
        index += 1
        if depth == 0:
            return index
    return index


def call_chain(rev, path, line, name):
    """
    Return (text before the call on its line, method chain after it, next character).
    """
    lines = ppc.file_lines(rev, path)
    text = "\n".join(ppc.strip_literals(item) for item in lines[line - 1 : line + 40])
    match = re.search(rf"(^|[^A-Za-z0-9_]){re.escape(name)}\s*\(", text)
    if not match:
        return None, None, None
    head = text[: match.start() + len(match.group(1))].split("\n")[-1]
    index, chain = _past_group(text, match.end() - 1), []
    while True:
        cursor = index
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        if text.startswith("?", cursor):
            chain.append("?")
            index = cursor + 1
            continue
        method = re.match(r"\.\s*([A-Za-z_][A-Za-z0-9_]*)", text[cursor:])
        if not method:
            break
        after = cursor + len(method.group(0))
        while after < len(text) and text[after].isspace():
            after += 1
        if after < len(text) and text[after] == "(":
            end = _past_group(text, after)
            chain.append(text[cursor:end])
            index = end
        else:
            chain.append(method.group(0))
            index = after
    while index < len(text) and text[index].isspace():
        index += 1
    return head, chain, text[index] if index < len(text) else ""


def classify_edge(rev, path, line, name):
    """
    Return (discard | propagate | unknown, why) for the call of `name` on `line`.
    """
    head, chain, following = call_chain(rev, path, line, name)
    if chain is None:
        return "unknown", "call not found at the line"
    joined = " ".join(chain)
    if LET_OK.search(head):
        return "discard", "if let Ok(..) / let Ok(..) else"
    for pattern, label in DISCARDS:
        if pattern.search(joined):
            return "discard", label
    if any(pattern.search(joined) for pattern in KEEPS_CAUSE):
        return "propagate", "map_err keeps the cause"
    if "?" in chain:
        return "propagate", "?"
    if re.search(r"\breturn\s*$", head):
        return "propagate", "return"
    if following == "}":
        return "propagate", "tail expression"
    if re.search(r"\bmatch\s*$", head):
        return "unknown", "matched; arms not followed"
    return "unknown", "result bound or passed on; not followed"


def discard_site(rev, path, line):
    """
    Return the line carrying the discard, and what the cause becomes there.
    """
    lines = ppc.file_lines(rev, path)
    for index in range(line - 1, min(line + 40, len(lines))):
        code = ppc.strip_literals(lines[index])
        becomes = re.search(
            r"\.map_err\(\s*\|\s*_[A-Za-z0-9_]*\s*\|\s*([^;]*?)\)\s*\??\s*[;,]?$",
            code,
        )
        if becomes:
            return index + 1, becomes.group(1).strip() or "?"
        if re.search(r"\.map_err\(\s*\|\s*_[A-Za-z0-9_]*\s*\|\s*\{$", code):
            # The closure body opens a block: what the cause becomes is the block's first path.
            body = ppc.strip_literals(lines[index + 1]) if index + 1 < len(lines) else ""
            first = re.match(r"\s*([A-Za-z_][A-Za-z0-9_:]*)", body)
            return index + 1, first.group(1) if first else "?"
        if ".ok()" in code:
            return index + 1, "None"
        if LET_OK.search(code):
            return index + 1, "the else branch"
        for pattern, label in DISCARDS:
            if pattern.search(code):
                return index + 1, label
    return line, "?"


# --- the walk --------------------------------------------------------------------------


def crate_of(path):
    parts = path.split("/")
    return "/".join(parts[:2]) if parts[0] == "crates" else parts[0]


@functools.cache
def declarations(rev, name):
    pattern = rf"(^|{ppc.NOT_WORD})fn[[:space:]]+{name}[[:space:]]*[(<]"
    return tuple((p, n) for p, n, _t in ppc.grep(rev, pattern) if ppc.is_production_file(p))


@functools.cache
def callers_of(rev, name, from_path):
    """
    Return the production callers of the declaration of `name` the walk arrived at, or
    None.

    The ambiguity is decided before any call site is classified: classifying every call of
    a name like `new` costs more than the rest of the walk put together.

    """
    decls = declarations(rev, name)
    if len(decls) == 1:
        return ppc.classify_callers(rev, name)[0], "unique"
    here = crate_of(from_path)
    local = [d for d in decls if crate_of(d[0]) == here]
    if len(local) != 1:
        return None, f"`{name}` has {len(decls)} declarations, {len(local)} in {here}"
    production = []
    for path, line, text in ppc.call_sites(rev, name):
        if crate_of(path) != here:
            continue
        in_test_tree = "/tests/" in path or path.endswith("_tests.rs")
        if in_test_tree or ppc.gates(rev, path, line) or ppc.under_test_attribute(rev, path, line):
            continue
        production.append((path, line, [], text))
    return production, "crate-local"


def _follow(rev, name, trail, origin, site_path):
    """
    Return (finished paths, next steps) for the callers of one function on the walk.
    """
    if name == "main":
        return [("boundary", "binary entry point `main`", trail)], []
    callers, how = callers_of(rev, name, origin.get(name, site_path))
    if callers is None:
        return [("unknown", how, trail)], []
    if not callers:
        return [("boundary", f"nothing in production calls `{name}` ({how})", trail)], []
    finished, steps = [], []
    for path, line, _gate, _text in callers:
        kind, why = classify_edge(rev, path, line, name)
        if kind == "discard":
            where, becomes = discard_site(rev, path, line)
            finished.append(("flat", (path, where, why, becomes), trail))
        elif kind == "propagate":
            host = ppc.enclosing_function(rev, path, line)
            if host:
                origin.setdefault(host, path)
            steps.append((host, (*trail, host or "?")))
        else:
            finished.append(("unknown", f"{path}:{line}  {why}", trail))
    return finished, steps


def walk(rev, site_path, site_line):
    """Return every path from one production site upward: (flat | boundary | unknown, detail, trail)."""
    start = ppc.enclosing_function(rev, site_path, site_line)
    results, seen, origin = [], set(), {start: site_path}
    frontier = [(start, (start,))]
    while frontier:
        name, trail = frontier.pop()
        if name is None:
            results.append(("unknown", "no enclosing function", trail))
        elif len(trail) > DEPTH:
            results.append(("unknown", f"deeper than {DEPTH} calls", trail))
        elif name not in seen:
            seen.add(name)
            finished, steps = _follow(rev, name, trail, origin, site_path)
            results.extend(finished)
            frontier.extend(steps)
    return results


def classify(rev, key, constructs, observes):
    """
    Return (bucket, evidence) for one variant.
    """
    if key not in constructs:
        return "unconstructed", []
    if key in observes:
        return "observed", observes[key]
    paths = [(p, n, *r) for p, n in constructs[key] for r in walk(rev, p, n)]
    kinds = {r[2] for r in paths}
    if "boundary" in kinds:
        return "reaches-boundary", paths
    if kinds == {"flat"}:
        return "listed", paths
    if "flat" in kinds:
        return "flat-where-followed", paths
    return "undetermined", paths


# --- reporting -------------------------------------------------------------------------


def _unknown_reason(detail):
    if "declarations" in detail:
        return "a name with several declarations, none attributable by crate"
    if "matched" in detail:
        return "the result is matched; arms not followed"
    if "not followed" in detail:
        return "the result is bound or passed on; not followed"
    if "enclosing" in detail:
        return "the site is not inside a function"
    if "deeper" in detail:
        return f"deeper than {DEPTH} calls"
    return detail


def _row(rev, key, evidence):
    producers = sorted({(p, n) for p, n, *_ in evidence})
    flats = sorted({r[3] for r in evidence if r[2] == "flat"})
    return producers, flats


BUCKETS = (
    "listed",
    "renamed",
    "flat-where-followed",
    "undetermined",
    "reaches-boundary",
    "observed",
    "unconstructed",
)
SECTIONS = (
    ("listed", "Flattened on every path", "Every path the walk could follow ended in a discard."),
    (
        "renamed",
        "Renamed, not lost",
        "Every path ends in a discard, but only this one value of its enum reaches each of them,"
        " so no information is dropped there - only its name. What it becomes still matters: a"
        " permanent failure renamed as a transient one misleads a caller as much as a flattening.",
    ),
    (
        "flat-where-followed",
        "Flattened wherever followed",
        "Every path the walk could follow ended in a discard, and at least one path could not be followed.",
    ),
)


def _print_section(results, values, bucket, heading, note):
    counts, how = values
    rows = sorted(k for k, v in results.items() if v[0] == bucket)
    print(f"## {heading} ({len(rows)})\n\n{note}\n")
    for key in rows:
        evidence = results[key][1]
        print(f"- `{key[0]}::{key[1]}`" + (f" - single value {how[key]}" if key in how else ""))
        for path, line in sorted({(p, n) for p, n, *_ in evidence}):
            print(f"  - produced at `{path}:{line}`")
        for path, line, why, becomes in sorted({r[3] for r in evidence if r[2] == "flat"}):
            tail = ""
            if (key, (path, line)) in counts:
                known, open_ = counts[(key, (path, line))]
                tail = f", {known} value(s) of it reach here" + (
                    f", {open_} sibling(s) the walk could not finish" if open_ else ""
                )
            print(f"  - flattened at `{path}:{line}` by {why}, becomes `{becomes}`{tail}")
        if key in DISPOSITIONS:
            print(f"  - **ruling:** {DISPOSITIONS[key]['note']}")
    if rows:
        print()


def _print_stops(results):
    stopped = collections.Counter()
    for bucket, evidence in results.values():
        if bucket in ("undetermined", "flat-where-followed"):
            first = next((r for r in evidence if r[2] == "unknown"), None)
            if first:
                stopped[_unknown_reason(first[3])] += 1
    print("## Where the walk stopped\n")
    print(
        "First unfollowable step, for variants that are undetermined or flattened wherever followed:\n",
    )
    print("```text")
    for reason, count in stopped.most_common():
        print(f"{count:5d}  {reason}")
    print("```")


def site_values(rev, results, constructs):
    """
    Return which values of each enum reach each discard, and which variants the walk
    left open.

    Only enums with a flattened variant are walked in full; an observed variant is
    walked here too, since whether it reaches a discard is exactly what the count needs.

    """
    wanted = {k[0] for k, v in results.items() if v[0] in ("listed", "flat-where-followed")}
    reach, incomplete = collections.defaultdict(set), set()
    for key, (bucket, evidence) in results.items():
        if key[0] not in wanted or key not in constructs:
            continue
        paths = evidence
        if bucket == "observed":
            paths = [(p, n, *r) for p, n in constructs[key] for r in walk(rev, p, n)]
        for _p, _n, kind, what, _trail in paths:
            if kind == "flat":
                reach[(key[0], what[0], what[1])].add(key[1])
            elif kind == "unknown":
                incomplete.add(key)
    return reach, incomplete


def rename_single_values(results, reach, incomplete):
    """
    Move a listed variant to `renamed` when it is the only value reaching every one of
    its discards.

    Proven by the walk when every sibling is accounted for; proven by a ruling when the
    walk left a sibling open and a ruling says the value is single anyway. Return
    (counts, how) for reporting; counts cover every discard of a listed or flat-where-
    followed variant, but only a listed one can be renamed, since a path the walk could
    not follow may end anywhere.

    """
    counts, how = {}, {}
    for key, (bucket, evidence) in list(results.items()):
        if bucket not in ("listed", "flat-where-followed"):
            continue
        sites = {(r[3][0], r[3][1]) for r in evidence if r[2] == "flat"}
        alone, closed = True, True
        for site in sites:
            known = reach.get((key[0], *site), set())
            open_ = {v for e, v in incomplete if e == key[0] and v not in known and v != key[1]}
            counts[(key, site)] = (len(known), len(open_))
            alone = alone and known == {key[1]}
            closed = closed and not open_
        ruled = DISPOSITIONS.get(key, {}).get("single_valued", False)
        if bucket == "listed" and sites and alone and (closed or ruled):
            results[key] = ("renamed", evidence)
            how[key] = "by the walk" if closed else "by ruling; the walk could not finish a sibling"
    return counts, how


def classify_all(rev):
    """
    Return (enums, results, (counts, how)) for every unique-name enum.
    """
    enums = public_error_enums(rev)
    unique = {n: {v for v, _ in d[0][2]} for n, d in enums.items() if len(d) == 1}
    constructs, observes = index_sites(rev, unique)
    results = {
        (name, variant): classify(rev, (name, variant), constructs, observes)
        for name in sorted(unique)
        for variant in sorted(unique[name])
    }
    reach, incomplete = site_values(rev, results, constructs)
    return enums, results, rename_single_values(results, reach, incomplete)


HISTORY = (
    "At `ba8f9bf5f` this listed `NativeReplayExecutionInputBindingErrorV1::Conflict`, flattened"
    " at `crates/strategy_factory/src/native_replay_initial_binding_issuance_v1.rs:122` by"
    " `.map_err(|_| ..)` into a unit struct, so a refusal reached its caller as a 503; #894 made"
    " it reach its caller as a conflict."
)

CALIBRATED = (
    "The tool is calibrated on synthetic source by `scripts/flattened-error-variants_test.py`, not"
    " on this repository; what follows is output, and nothing in it is a gate."
)

NOTE = (
    "The list finds cases where the cause never reaches the caller. Whether that is a defect has"
    " to be judged against the channel scope rule of the Owner that holds it. Some flattenings"
    " are deliberate fail-closed contracts."
)

# Rulings on listed entries, by the Owner or the hub that dispatches them. A ruling whose
# variant is no longer listed is stale and fails the run, so a ruling cannot outlive the code
# it was made about.
DISPOSITIONS = {
    ("SourceIntakeError", "ResponseBoundExceeded"): {
        "note": (
            "flattened on purpose: every path refuses explicitly as `Malformed` and none returns a"
            " truncated body; distinguishing it needs a schema change to the persisted"
            " `AcquisitionTerminalV1`"
        ),
    },
    ("InstrumentMasterV2Error", "SuccessorMismatch"): {
        "note": (
            "flattened on purpose: a meaning refusal, which Market Data's channel rule excludes,"
            " and `ChainMismatch` is the Owner's own name for it"
        ),
    },
}


def _ruler_text():
    """
    Return the module's own account of its blind spots, as Markdown.
    """
    doc = __doc__ or ""
    body = doc.split("Which ruler, and where it is blind", 1)[1].split("Usage:", 1)[0]
    return "## Which ruler, and where it is blind\n" + body.split("\n", 2)[2].rstrip()


def _stale_dispositions(results):
    listed = {k for k, v in results.items() if v[0] in ("listed", "renamed", "flat-where-followed")}
    return sorted(key for key in DISPOSITIONS if key not in listed)


def report(rev, command):
    enums, results, values = classify_all(rev)
    buckets = collections.Counter(bucket for bucket, _ in results.values())
    unique = sum(1 for d in enums.values() if len(d) == 1)
    print("# Flattened public error variants\n")
    print(
        "Public error-enum variants whose cause never reaches a caller: every production site of"
        " the variant is separated from the edge by a step that discards it.\n",
    )
    print(f"{NOTE}\n")
    print(f"Measured at `{rev[:9]}` by regenerating this whole file with:\n")
    print(f"```text\n{command}\n```\n")
    print(f"{CALIBRATED}\n")
    print(f"{HISTORY}\n")
    stale = _stale_dispositions(results)
    if stale:
        print("## Stale rulings\n")
        for key in stale:
            print(
                f"- `{key[0]}::{key[1]}` has a ruling but is no longer listed. Remove or revise it.",
            )
        print()
    print(
        f"{len(enums)} public error enum names in production modules; "
        f"{len(enums) - unique} are declared more than once and are skipped; "
        f"{len(results)} variants in the rest.\n",
    )
    print("```text")
    for bucket in BUCKETS:
        print(f"{buckets.get(bucket, 0):5d}  {bucket}")
    print(f"{'-' * 5}\n{len(results):5d}\n```\n")
    for section in SECTIONS:
        _print_section(results, values, *section)
    _print_stops(results)
    print()
    print(_ruler_text())
    return not stale


def detail(rev, key):
    enums = public_error_enums(rev)
    unique = {n: {v for v, _ in d[0][2]} for n, d in enums.items() if len(d) == 1}
    if key[0] not in unique or key[1] not in unique[key[0]]:
        print(
            f"{key[0]}::{key[1]} is not a variant of a unique-name public error enum at {rev[:9]}",
        )
        return None
    constructs, observes = index_sites(rev, {key[0]: unique[key[0]]})
    bucket, evidence = classify(rev, key, constructs, observes)
    print(f"{key[0]}::{key[1]} at {rev[:9]}: {bucket}")
    if bucket == "observed":
        for path, line in evidence:
            print(f"  named in a pattern at {path}:{line}")
    for path, line, kind, what, trail in evidence if bucket != "observed" else []:
        where = f"{what[0]}:{what[1]} by {what[2]}, becomes `{what[3]}`" if kind == "flat" else what
        print(
            f"  from {path}:{line}\n    {kind:9s} {where}\n              via {' <- '.join(trail)}",
        )
    return bucket


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.strip().split("\n")[0])
    parser.add_argument("variant", nargs="?", help="Enum::Variant for one variant's paths")
    parser.add_argument("--rev", default="HEAD")
    args = parser.parse_args(argv)
    rev = ppc.resolve(args.rev)
    if not rev:
        print(f"cannot resolve rev {args.rev!r}", file=sys.stderr)
        return 2
    if args.variant:
        name, _, variant = args.variant.partition("::")
        return 0 if detail(rev, (name, variant)) else 2
    command = f"scripts/flattened-error-variants.py --rev {rev[:9]} > docs/developer_guide/flattened_error_variants.md"
    return 0 if report(rev, command) else 1


if __name__ == "__main__":
    sys.exit(main())
