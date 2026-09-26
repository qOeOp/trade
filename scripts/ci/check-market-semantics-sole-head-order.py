#!/usr/bin/env python3
"""
Refuse an R&D chain array in which an entry that admits a production Market Semantics
fact runs before an entry that finds its acceptance corpus as the sole head of a
compatibility scope.

`register_bar_joined_cut_declarations_for_published_design_v1` finds the corpus a later Design binds
to as the only Market Semantics chain its scope holds. In the shared chain database that chain is the
market base's (entry 6's), and it is the only one exactly as long as nothing has admitted a production
fact under the same scope before the registration runs. A production admission for the chain fixtures'
instrument does exactly that. Entries of one shard component run in chain-array order, so the
constraint is positional: every entry that registers that way must come before every entry that
admits production Market Semantics. This names the pair that breaks it.

An entry registers when its test function, or a function of the same file it names, calls the
registration. It admits when one of them calls `admit_market_semantics_fact_v1` or names the Owner
route `/v1/market-data/market-semantics`. Composing the route without calling it does not admit.

This check stands in for the registration taking its corpus snapshot from its caller instead of
reading the sole head. When the registration does that, this check and its call go.

Usage: check-market-semantics-sole-head-order.py <chain script>
       check-market-semantics-sole-head-order.py --self-test

"""

from __future__ import annotations

import functools
import re
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGISTERS = "register_bar_joined_cut_declarations_for_published_design_v1"
ADMITS_CALL = "admit_market_semantics_fact_v1"
ADMITS_ROUTE = "/v1/market-data/market-semantics"
FN_HEAD = re.compile(r"\bfn\s+(\w+)\s*(?:<[^>{}]*>)?\s*\(")
IDENTIFIER = re.compile(r"[A-Za-z_]\w*")
RAW_STRING = re.compile(r'b?r(#*)"')
CHAR_LITERAL = re.compile(r"'(?:\\.|[^\\'])'")


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def masked(source: str) -> tuple[str, list[tuple[int, str]]]:
    """
    Return the source with comments and string literals blanked, and the string
    literals.

    Blanking keeps offsets, so the braces left are the code's own and a name inside a
    comment or a string is not read as a call.

    """
    code = list(source)
    literals: list[tuple[int, str]] = []
    at = 0
    while at < len(source):
        if source.startswith("//", at):
            end = source.find("\n", at)
            end = len(source) if end == -1 else end
            code[at:end] = " " * (end - at)
            at = end
            continue
        if source.startswith("/*", at):
            end = source.find("*/", at + 2)
            end = len(source) if end == -1 else end + 2
            code[at:end] = [c if c == "\n" else " " for c in source[at:end]]
            at = end
            continue
        raw = RAW_STRING.match(source, at) if source[at] in "br" else None
        if raw and (at == 0 or not (source[at - 1].isalnum() or source[at - 1] == "_")):
            closing = '"' + raw.group(1)
            end = source.find(closing, raw.end())
            end = len(source) if end == -1 else end
            literals.append((at, source[raw.end() : end]))
            stop = end + len(closing)
            code[at:stop] = [c if c == "\n" else " " for c in source[at:stop]]
            at = stop
            continue
        if source[at] == '"':
            end = at + 1
            while end < len(source) and source[end] != '"':
                end += 2 if source[end] == "\\" else 1
            literals.append((at, source[at + 1 : end]))
            code[at : end + 1] = [c if c == "\n" else " " for c in source[at : end + 1]]
            at = end + 1
            continue
        char = CHAR_LITERAL.match(source, at) if source[at] == "'" else None
        if char:
            code[at : char.end()] = " " * (char.end() - at)
            at = char.end()
            continue
        at += 1
    return "".join(code), literals


def function_bodies(code: str) -> dict[str, list[tuple[int, int]]]:
    bodies: dict[str, list[tuple[int, int]]] = {}
    for head in FN_HEAD.finditer(code):
        opening = code.find("{", head.end())
        semicolon = code.find(";", head.end())
        if opening == -1 or (semicolon != -1 and semicolon < opening):
            continue
        depth = 0
        for offset in range(opening, len(code)):
            if code[offset] == "{":
                depth += 1
            elif code[offset] == "}":
                depth -= 1
                if depth == 0:
                    bodies.setdefault(head.group(1), []).append((opening, offset))
                    break
    return bodies


@functools.cache
def parsed(path: Path) -> tuple[str, tuple[tuple[int, str], ...], dict[str, list[tuple[int, int]]]]:
    code, literals = masked(path.read_text(encoding="utf-8"))
    return code, tuple(literals), function_bodies(code)


def reached(path: Path, test: str) -> tuple[set[str], list[str]]:
    """
    Return the names and string literals the test function reaches within its own file.
    """
    code, literals, bodies = parsed(path)
    if test not in bodies:
        fail(f"{path} defines no test function {test}")
    named = {
        name: {word for a, b in spans for word in IDENTIFIER.findall(code, a, b)}
        for name, spans in bodies.items()
    }
    seen = {test}
    frontier = [test]
    while frontier:
        for other in named.get(frontier.pop(), set()) & bodies.keys() - seen:
            seen.add(other)
            frontier.append(other)
    spans = [span for name in seen for span in bodies[name]]
    words = {word for name in seen for word in named[name]}
    texts = [text for offset, text in literals if any(a < offset < b for a, b in spans)]
    return words, texts


def violations(entries: list[tuple[str, Path, str]]) -> list[str]:
    """
    Name every registering entry that an admitting entry precedes, by chain position.
    """
    first_admitter: tuple[int, str] | None = None
    registering = 0
    found = []
    for position, (label, path, test) in enumerate(entries, start=1):
        words, texts = reached(path, test)
        registering += REGISTERS in words
        if REGISTERS in words and first_admitter is not None:
            found.append(
                f"entry {position} ({label}) finds its corpus as the sole Market Semantics head, "
                f"but entry {first_admitter[0]} ({first_admitter[1]}) admits a production Market "
                "Semantics fact before it; move the admitting entry after every registering one",
            )
        admits = ADMITS_CALL in words or any(ADMITS_ROUTE in text for text in texts)
        if admits and first_admitter is None:
            first_admitter = (position, label)
    if not registering:
        # A check that finds nothing to order passes whatever the order is. No entry registering
        # means the registration was renamed or replaced: follow it, or remove this check with it.
        found.append(f"no chain entry calls {REGISTERS}; this check has nothing to order")
    return found


def chain_entries(chain: Path) -> list[tuple[str, str]]:
    source = chain.read_text(encoding="utf-8")
    opening = "readonly rd_owner_postgres_tests=(\n"
    if source.count(opening) != 1:
        fail("the chain array is unavailable")
    body = source[source.index(opening) + len(opening) :]
    rows = [line.strip().strip("'") for line in body[: body.index("\n)\n")].splitlines()]
    return [(row.split("|")[0], row.split("|")[2]) for row in rows if row]


def crate_directories(root: Path) -> dict[str, Path]:
    crates = {}
    for manifest in root.glob("crates/**/Cargo.toml"):
        match = re.search(
            r'^name\s*=\s*"([^"]+)"',
            manifest.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
        if match:
            crates[match.group(1)] = manifest.parent
    return crates


@functools.cache
def crate_functions(crate: Path) -> dict[str, tuple[Path, ...]]:
    """
    Every function name the crate's files define, with the files that define it.
    """
    index: dict[str, list[Path]] = {}
    for path in sorted(crate.rglob("*.rs")):
        for name in set(re.findall(r"\bfn\s+(\w+)\s*[<(]", path.read_text(encoding="utf-8"))):
            index.setdefault(name, []).append(path)
    return {name: tuple(paths) for name, paths in index.items()}


def test_file(crate: Path, test: str) -> Path:
    matches = crate_functions(crate).get(test.rsplit("::", 1)[-1], ())
    if len(matches) != 1:
        fail(f"test {test} is defined in exactly one file of {crate}, found {len(matches)}")
    return matches[0]


def check(chain: Path, root: Path = ROOT) -> None:
    crates = crate_directories(root)
    entries = []
    for package, test in chain_entries(chain):
        if package not in crates:
            fail(f"the chain names a package with no crate: {package}")
        entries.append((test, test_file(crates[package], test), test.rsplit("::", 1)[-1]))
    found = violations(entries)
    for message in found:
        print(f"ERROR: {message}", file=sys.stderr)
    if found:
        raise SystemExit(1)


def self_test() -> None:
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "tests.rs"
        source.write_text(
            """
fn helper() { register_bar_joined_cut_declarations_for_published_design_v1(); }
fn registers() { helper(); }
fn admits_by_call() { owner.admit_market_semantics_fact_v1(x); }
fn admits_by_route() { post("/v1/market-data/market-semantics"); }
fn composes_only() { let r = router(bootstrap_market_data_market_semantics_admission()); }
fn names_it_in_a_comment() { // admit_market_semantics_fact_v1
}
fn names_it_in_a_string() { let s = "admit_market_semantics_fact_v1"; }
""",
            encoding="utf-8",
        )

        def order(*tests: str) -> list[str]:
            return violations([(test, source, test) for test in tests])

        assert order("registers", "admits_by_call") == [], "admitting after registering is fine"
        assert order("admits_by_call") == [
            f"no chain entry calls {REGISTERS}; this check has nothing to order",
        ], "a chain with no registering entry is refused, not passed"
        assert len(order("admits_by_call", "registers")) == 1, "a call before is refused"
        assert len(order("admits_by_route", "registers")) == 1, "the route before is refused"
        assert order("composes_only", "registers") == [], "composing the route admits nothing"
        assert order("names_it_in_a_comment", "registers") == [], "a comment admits nothing"
        assert order("names_it_in_a_string", "registers") == [], "a plain string admits nothing"
        refused = order("admits_by_route", "registers")[0]
        assert "entry 2 (registers)" in refused, refused
        assert "entry 1 (admits_by_route)" in refused, refused
    print("market semantics sole-head order self-test: passed")


def main() -> None:
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif len(sys.argv) == 2:
        check(Path(sys.argv[1]))
    else:
        fail("usage: check-market-semantics-sole-head-order.py <chain script> | --self-test")


if __name__ == "__main__":
    main()
