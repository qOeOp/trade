#!/usr/bin/env python3
"""
Refuse a chain entry whose test returns before it drives anything when an input is
unset.

An entry that opens with `if env::var("X") != Ok("1") { return; }` passes in a few milliseconds
wherever X is missing, and its PASS reads the same as one that drove the whole test. The ordered
chain's gate refuses a CI run without the Dashboard browser inputs, but a local preflight run, or
any runner outside that gate, reports it green. Read the input with `.expect(...)` instead, so a run
without it fails and names it.

This judges the source, not the duration. On CI the fastest entries that genuinely drive PostgreSQL
finish in 53-175 ms (entries 63, 93, 95, 96 and 97 on build run 36345566217 and owner-chains run
36344301072), while a local early return of entry 28 took 11 ms: near 50 ms the two cannot be told
apart by time, so a duration threshold would either pass an early return or refuse a real test.

The rule: a `return` in the test function's own body (a nested `fn` is its own function) whose
innermost enclosing block is headed by an `if`, `let ... else` or `match` that reads the
environment. A `return` inside a helper the test calls is not followed; this reads only the test
function, which is where the entries that did this put it.

Usage: chain-entry-early-return.py --check <chain script>   refuses such entries by name
       chain-entry-early-return.py --self-test               runs the rule against fixtures
       chain-entry-early-return.py --hook                    both, on this repository's chain

"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("chain_node_entries", HERE / "chain-node-entries.py")
if _spec is None or _spec.loader is None:
    sys.exit("ERROR: chain-node-entries.py, whose Rust reader this uses, could not be loaded")
reader = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reader)

RETURN = re.compile(r"\breturn\b")
ENVIRONMENT = re.compile(r"\benv::var(?:_os)?\s*\(")


def early_returns(code: str, body: tuple[int, int], nested: list[tuple[int, int]]) -> list[int]:
    """
    Return the offsets of the returns in `body` that an environment read decides.
    """
    opening, closing = body
    found = []
    for match in RETURN.finditer(code, opening + 1, closing):
        at = match.start()
        if any(a < at < b for a, b in nested):
            continue
        # The innermost block around the return, and the header in front of it: back to the
        # statement boundary before the block's opening brace.
        depth, block = 0, None
        for offset in range(at - 1, opening - 1, -1):
            if code[offset] == "}":
                depth += 1
            elif code[offset] == "{":
                if depth == 0:
                    block = offset
                    break
                depth -= 1
        if block is None or block == opening:
            continue
        start = max(code.rfind(";", opening, block), code.rfind("}", opening, block), opening)
        # A block opened directly after another (`else {` after `}`) still has its header before
        # the brace that closed the previous one; `start` stops at that brace, which is enough for
        # `if` and `let ... else`, whose condition is in the text this reads.
        if ENVIRONMENT.search(code, start, block):
            found.append(at)
    return found


def problems(path: Path, test: str) -> list[str]:
    code, _literals, functions = reader.parsed_rust(path)
    spans = functions.get(test, [])
    if len(spans) != 1:
        return [f"{reader.shown(path)} defines {len(spans)} bodies named {test}, not one"]
    body = spans[0]
    nested = [
        span
        for name, others in functions.items()
        for span in others
        if span != body and body[0] < span[0] < body[1]
    ]
    source = path.read_text(encoding="utf-8")
    return [
        f"{reader.shown(path)}:{source.count(chr(10), 0, at) + 1}"
        for at in early_returns(code, body, nested)
    ]


def check(chain: Path) -> int:
    crates = reader.crate_directories()
    entries = reader.chain_array(chain.read_text(encoding="utf-8"), "rd_owner_postgres_tests")
    if not entries:
        reader.fail("the chain script names no entry; nothing here was read")
    refused = []
    for number, entry in enumerate(entries, 1):
        package, _binary, test_path = entry.split("|")
        if package not in crates:
            reader.fail(
                f"chain entry {test_path} names the package {package}, which no crate defines",
            )
        path = reader.test_file(crates[package], test_path)
        refused.extend(
            (number, test_path, where) for where in problems(path, test_path.rsplit("::", 1)[-1])
        )
    for number, test_path, where in refused:
        print(
            f"ERROR: chain entry {number} {test_path} returns before it drives anything when an "
            f"environment input is unset ({where}), so a run without that input reports PASS. "
            "Read the input with .expect(...) so its absence fails and names it.",
            file=sys.stderr,
        )
    if refused:
        return 1
    print(f"ok: none of the {len(entries)} chain entries returns early on an unset input")
    return 0


FIXTURES = {
    "opening if": (
        'fn t() {\n    if env::var("X").as_deref() != Ok("1") {\n        return;\n    }\n    drive();\n}\n',
        1,
    ),
    "let else": (
        'fn t() {\n    let Ok(url) = std::env::var("X") else {\n        return;\n    };\n    drive(url);\n}\n',
        1,
    ),
    "match arm": (
        'fn t() {\n    let url = match env::var("X") {\n        Ok(url) => url,\n'
        "        Err(_) => return,\n    };\n    drive(url);\n}\n",
        1,
    ),
    "var_os": (
        'fn t() {\n    if std::env::var_os("X").is_none() {\n        return;\n    }\n}\n',
        1,
    ),
    "expect": ('fn t() {\n    let url = env::var("X").expect("X");\n    drive(url);\n}\n', 0),
    "return decided by something else": (
        "fn t() {\n    loop {\n        match attempt() {\n"
        "            Ok(_) => return,\n            Err(_) => continue,\n        }\n    }\n}\n",
        0,
    ),
    "a nested fn's own return": (
        'fn t() {\n    fn helper() {\n        if env::var("X").is_err() {\n            return;\n'
        "        }\n    }\n    helper();\n}\n",
        0,
    ),
    "the variable named only in a comment or string": (
        'fn t() {\n    // env::var("X") is not read here\n    if flag("env::var(") {\n'
        "        return;\n    }\n}\n",
        0,
    ),
}


def self_test() -> int:
    import tempfile

    failures = []
    with tempfile.TemporaryDirectory() as scratch:
        for label, (source, want) in FIXTURES.items():
            path = Path(scratch) / f"{len(label)}_{abs(hash(label))}.rs"
            path.write_text(source, encoding="utf-8")
            reader.parsed_rust.cache_clear()
            got = len(problems(path, "t"))
            if got != want:
                failures.append(f"{label}: found {got}, expected {want}")
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(f"ok: the early-return rule reads {len(FIXTURES)} fixtures as written")
    return 0


def main() -> int:
    if sys.argv[1:2] == ["--self-test"] and len(sys.argv) == 2:
        return self_test()
    if sys.argv[1:2] == ["--check"] and len(sys.argv) == 3:
        return check(Path(sys.argv[2]))
    if sys.argv[1:] == ["--hook"]:
        return self_test() or check(reader.ROOT / "scripts/ci/test-rd-owner-postgres.bash")
    print(__doc__.split("Usage: ")[1], file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
