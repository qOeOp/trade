#!/usr/bin/env python3
"""
Find the R&D chain entries that load a package from the Dashboard's node_modules.

A shard installs the Dashboard's npm dependencies only when one of its entries is
declared to need them (`chain_dashboard_node_entries`, or `chain_browser_entries`,
which implies them). An entry that needs them and is not declared runs in a shard
without them and fails there with Node's own `ERR_MODULE_NOT_FOUND`, which names a
package, not the missing declaration - and passes on any machine that has
`product/dashboard/node_modules`, which is every developer's.

This reads it from the source instead. For each chain entry it finds the test
function, the functions in the same file that function reaches by name, the script
literals (`*.mjs`, `*.js`, `*.ts`) those functions hold, and the import graph of
each script: relative `import ... from`, `export ... from`, side-effect `import`,
`await import(...)` and `require(...)`. A statement that imports only types
(`import type`, `export type`) is erased before Node runs it and does not count; one
with inline type specifiers (`import { type A } from`) is not erased and does. A
bare specifier that is not a Node builtin means the entry needs node_modules.

Where it cannot decide, it refuses rather than passing: a test function it cannot
find, or a script literal that names no file. A helper in another Rust file is what
it does not follow; the chain names such an entry when it fails for this reason.

Usage: chain-node-entries.py --check <chain script>   refuses undeclared entries by name
       chain-node-entries.py --list <chain script>    prints the entries that need node_modules
       chain-node-entries.py --self-test               runs the reader against fixtures
       chain-node-entries.py --hook                    both, on this repository's chain

"""

from __future__ import annotations

import functools
import re
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = Path("product/dashboard")
SCRIPT_LITERAL = re.compile(r"^[\w./-]+\.(?:mjs|js|ts)$")
RAW_STRING = re.compile(r'b?r(#*)"')
CHAR_LITERAL = re.compile(r"'(?:\\.|[^\\'])'")
FN_NAME = re.compile(r"\bfn\s+(\w+)\s*[<(]")
IDENTIFIER = re.compile(r"[A-Za-z_]\w*")
FN_HEAD = re.compile(r"\bfn\s+(\w+)\s*(?:<[^>{}]*>)?\s*\(")
# Strings are masked to `"<n>"` before these run, so a specifier is always a masked literal.
IMPORT_FROM = re.compile(r"\b(import|export)\s+(type\s+)?([^\";]*?)\bfrom\s*\"(\d+)\"", re.DOTALL)
SIDE_EFFECT_IMPORT = re.compile(r"(?:^|[;\n])\s*import\s*\"(\d+)\"")
CALL_IMPORT = re.compile(r"\b(?:import|require)\s*\(\s*(\"(\d+)\"\s*\)|[^)\s])")
# A package used by path rather than imported: `node_modules/next/dist/bin/next`, or npm itself.
NODE_MODULES_PATH = re.compile(r"node_modules/((?:@[^/\s]+/)?[^/\s\"'`]+)")
PACKAGE_RUNNERS = frozenset({"npm", "npx"})
BUILTINS = frozenset(
    [
        "assert",
        "async_hooks",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "constants",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "domain",
        "events",
        "fs",
        "http",
        "http2",
        "https",
        "inspector",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "repl",
        "stream",
        "string_decoder",
        "sys",
        "timers",
        "tls",
        "trace_events",
        "tty",
        "url",
        "util",
        "v8",
        "vm",
        "wasi",
        "worker_threads",
        "zlib",
        "test",
    ],
)
RESOLUTION_SUFFIXES = ("", ".ts", ".mts", ".mjs", ".js", "/index.ts", "/index.mjs", "/index.js")


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def shown(path: Path) -> str:
    return str(path.relative_to(ROOT)) if ROOT in path.parents else str(path)


# --- Rust side ------------------------------------------------------------------------------


def rust_strings_and_code(source: str) -> tuple[str, list[tuple[int, str]]]:
    """
    Return the source with every string literal and comment blanked, and the literals.

    Blanking keeps offsets, so braces found in the result are the code's own braces.
    Raw strings (`r"..."`, `r#"..."#`) and escapes are handled; a quote after a letter
    other than `r` or `b`, or a lone apostrophe (a lifetime), is code.

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
            start = raw.end()
            end = source.find(closing, start)
            end = len(source) if end == -1 else end
            literals.append((at, source[start:end]))
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


def rust_functions(code: str) -> dict[str, list[tuple[int, int]]]:
    """
    Return every function with a body, by name: the span of the body.

    A name defined more than once keeps every span.

    """
    functions: dict[str, list[tuple[int, int]]] = {}
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
                    functions.setdefault(head.group(1), []).append((opening, offset))
                    break
    return functions


def reached_functions(
    code: str,
    functions: dict[str, list[tuple[int, int]]],
    start: str,
) -> set[str]:
    """
    Return the functions `start` reaches by naming them in its body, in this file only.

    Naming is read loosely - any mention of the name as a word - so a helper passed as
    a value counts too. Reading too much makes an entry need a declaration it did not;
    reading too little would let one pass without it.

    """
    named = {
        name: {
            word
            for opening, closing in spans
            for word in IDENTIFIER.findall(code, opening, closing)
        }
        for name, spans in functions.items()
    }
    reached = {start}
    frontier = [start]
    while frontier:
        for other in named.get(frontier.pop(), set()) & functions.keys() - reached:
            reached.add(other)
            frontier.append(other)
    return reached


@functools.cache
def parsed_rust(
    path: Path,
) -> tuple[str, tuple[tuple[int, str], ...], dict[str, list[tuple[int, int]]]]:
    code, literals = rust_strings_and_code(path.read_text(encoding="utf-8"))
    return code, tuple(literals), rust_functions(code)


def scripts_of(path: Path, test: str, root: Path = ROOT) -> tuple[list[Path], set[str]]:
    """
    Return the scripts the test function `test` in `path` launches, through any function
    of the same file it reaches, and the packages those functions use by path or runner.
    """
    code, literals, functions = parsed_rust(path)
    if test not in functions:
        fail(f"{shown(path)} defines no test function {test}")
    spans = [span for name in reached_functions(code, functions, test) for span in functions[name]]
    reached = [literal for offset, literal in literals if any(a < offset < b for a, b in spans)]
    scripts = [
        script_path(literal, path, root) for literal in reached if SCRIPT_LITERAL.match(literal)
    ]
    return scripts, packages_by_path(reached)


def script_path(literal: str, origin: Path, root: Path) -> Path:
    for base in (root, root / DASHBOARD):
        candidate = (base / literal).resolve()
        if candidate.is_file():
            return candidate
    fail(f"{shown(origin)} launches {literal!r}, which names no file")
    return Path()


# --- JavaScript side ------------------------------------------------------------------------


def js_masked(source: str) -> tuple[str, list[str]]:
    """
    Return the source without comments and with every string and template literal
    replaced by `"<n>"`, and the literals in order.

    Masking keeps a specifier-shaped text inside a string from being read as an import,
    while the literals themselves are still read for packages used by path.

    """
    out: list[str] = []
    strings: list[str] = []
    at = 0
    while at < len(source):
        if source.startswith("//", at):
            end = source.find("\n", at)
            at = len(source) if end == -1 else end
            continue
        if source.startswith("/*", at):
            end = source.find("*/", at + 2)
            at = len(source) if end == -1 else end + 2
            continue
        if source[at] in "'\"`":
            quote = source[at]
            end = at + 1
            while end < len(source) and source[end] != quote:
                end += 2 if source[end] == "\\" else 1
            out.append(f'"{len(strings)}"')
            strings.append(source[at + 1 : end])
            at = end + 1
            continue
        out.append(source[at])
        at += 1
    return "".join(out), strings


def runtime_specifiers(source: str, name: str) -> tuple[list[str], set[str]]:
    """
    Return the specifiers the module loads when Node runs it, type-only statements
    excluded, and the packages it uses by path.

    A dynamic `import(...)` or `require(...)` of anything but a literal cannot be read,
    so it is refused by name rather than assumed to load nothing.

    """
    code, strings = js_masked(source)
    specifiers = [strings[int(m.group(4))] for m in IMPORT_FROM.finditer(code) if not m.group(2)]
    specifiers += [strings[int(m.group(1))] for m in SIDE_EFFECT_IMPORT.finditer(code)]
    for call in CALL_IMPORT.finditer(code):
        if call.group(2) is None:
            fail(f"{name} imports something that is not a literal, which this check cannot follow")
        specifiers.append(strings[int(call.group(2))])
    return specifiers, packages_by_path(strings)


def packages_by_path(strings: list[str]) -> set[str]:
    packages = {match.group(1) for text in strings for match in NODE_MODULES_PATH.finditer(text)}
    return packages | {
        f"{runner} (runs packages)" for runner in PACKAGE_RUNNERS if runner in strings
    }


def resolve_relative(specifier: str, importer: Path) -> Path:
    base = (importer.parent / specifier).resolve()
    for suffix in RESOLUTION_SUFFIXES:
        candidate = Path(f"{base}{suffix}")
        if candidate.is_file():
            return candidate
    # A `.js` specifier naming a `.ts` source, as TypeScript's own resolution allows.
    if base.suffix == ".js" and base.with_suffix(".ts").is_file():
        return base.with_suffix(".ts")
    fail(f"{shown(importer)} imports {specifier!r}, which resolves to no file")
    return Path()


def bare_packages(script: Path, root: Path) -> set[tuple[str, Path]]:
    """
    Return every bare, non-builtin specifier the script's import graph reaches, with the
    file that imports it.
    """
    seen: set[Path] = set()
    packages: set[tuple[str, Path]] = set()
    frontier = [script]
    while frontier:
        current = frontier.pop()
        if current in seen:
            continue
        seen.add(current)
        specifiers, by_path = runtime_specifiers(current.read_text(encoding="utf-8"), str(current))
        packages |= {(package, current) for package in by_path}
        for specifier in specifiers:
            if specifier.startswith((".", "/")):
                frontier.append(resolve_relative(specifier, current))
            elif not specifier.startswith("node:") and specifier.split("/")[0] not in BUILTINS:
                packages.add((specifier, current))
    for specifier, importer in packages:
        if root not in importer.parents:
            fail(
                f"{shown(importer)} imports the package {specifier!r} from outside "
                f"{shown(root)}, which needs a node_modules this chain does not install",
            )
    return packages


# --- chain ----------------------------------------------------------------------------------


def chain_array(source: str, name: str) -> list[str]:
    opening = f"readonly {name}=(\n"
    if source.count(opening) != 1:
        fail(f"the chain script defines no {name}")
    body = source[source.index(opening) + len(opening) :]
    if body.startswith(")\n"):
        return []
    return [
        line.strip().strip("'") for line in body[: body.index("\n)\n")].splitlines() if line.strip()
    ]


def crate_directories() -> dict[str, Path]:
    crates = {}
    for manifest in ROOT.glob("crates/**/Cargo.toml"):
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
    Return every function name the crate's files define, with the files that define it.
    """
    index: dict[str, list[Path]] = {}
    for path in sorted(crate.rglob("*.rs")):
        for name in set(FN_NAME.findall(path.read_text(encoding="utf-8"))):
            index.setdefault(name, []).append(path)
    return {name: tuple(paths) for name, paths in index.items()}


def test_file(crate: Path, test_path: str) -> Path:
    """
    Return the one file of the crate that defines the test's function.
    """
    matches = crate_functions(crate).get(test_path.rsplit("::", 1)[-1], ())
    if len(matches) != 1:
        found = ", ".join(str(path.relative_to(ROOT)) for path in matches) or "none"
        fail(
            f"test {test_path} is defined in exactly one file of {crate.relative_to(ROOT)}, found: {found}",
        )
    return matches[0]


def entries_needing_node(chain: Path) -> dict[str, set[str]]:
    """
    Return the chain entries whose scripts reach a package, each with the packages.
    """
    crates = crate_directories()
    needing: dict[str, set[str]] = {}
    for entry in chain_array(chain.read_text(encoding="utf-8"), "rd_owner_postgres_tests"):
        package, _binary, test_path = entry.split("|")
        if package not in crates:
            fail(f"chain entry {test_path} names the package {package}, which no crate defines")
        path = test_file(crates[package], test_path)
        scripts, packages = scripts_of(path, test_path.rsplit("::", 1)[-1])
        for script in scripts:
            packages |= {name for name, _ in bare_packages(script, ROOT / DASHBOARD)}
        if packages:
            needing[test_path] = packages
    return needing


def declaration_problems(source: str) -> list[str]:
    """
    Name each declaration that is no chain entry, is declared twice, or is both a node
    and a browser entry: the plan would say nothing true about it.
    """
    entries = {entry.split("|")[2] for entry in chain_array(source, "rd_owner_postgres_tests")}
    node = chain_array(source, "chain_dashboard_node_entries")
    browser = chain_array(source, "chain_browser_entries")
    problems = [
        f"{name} is declared in chain_dashboard_node_entries but is no chain entry"
        for name in node
        if name not in entries
    ]
    problems += [
        f"{name} is declared as both a node and a browser entry; a browser entry implies node"
        for name in node
        if name in browser
    ]
    problems += [f"{name} is declared twice" for name in {n for n in node if node.count(n) > 1}]
    return problems


def check(chain: Path) -> int:
    source = chain.read_text(encoding="utf-8")
    problems = declaration_problems(source)
    for problem in problems:
        print(f"ERROR: {problem}.", file=sys.stderr)
    declared = set(chain_array(source, "chain_dashboard_node_entries"))
    declared |= set(chain_array(source, "chain_browser_entries"))
    missing = {
        name: packages
        for name, packages in entries_needing_node(chain).items()
        if name not in declared
    }
    for name, packages in sorted(missing.items()):
        print(
            f"ERROR: chain entry {name} loads {', '.join(sorted(packages))} from the Dashboard's "
            "node_modules, which a shard installs only for a declared entry: add it to "
            "chain_dashboard_node_entries.",
            file=sys.stderr,
        )
    return 1 if missing or problems else 0


# --- self-test ------------------------------------------------------------------------------


SELF_TEST_RUST = r"""
fn helper() -> std::process::Command {
    let mut c = std::process::Command::new("node");
    c.arg("tests/reaches-package.mjs");
    c
}
fn launches_nothing() { let _ = "not a script"; }
// fn commented_out() { "tests/reaches-package.mjs" }
#[tokio::test]
async fn needs_node() { let _ = helper(); let lifetime: &'static str = "x"; }
#[tokio::test]
async fn needs_only_builtins() { std::process::Command::new("node").arg("tests/builtins-only.mjs"); }
#[tokio::test]
async fn needs_nothing() { launches_nothing(); }
#[tokio::test]
async fn needs_inline_type_import() { std::process::Command::new("node").arg("tests/inline-type.mjs"); }
#[tokio::test]
async fn needs_dynamic_import() { std::process::Command::new("node").arg("tests/dynamic.mjs"); }
#[tokio::test]
async fn needs_a_package_by_path() { std::process::Command::new("node").arg("tests/spawns-next.mjs"); }
#[tokio::test]
async fn runs_npx_from_rust() { std::process::Command::new("npx").arg("tsc"); }
"""

SELF_TEST_SCRIPTS = {
    "tests/reaches-package.mjs": 'import { a } from "../lib/relative.ts";\n',
    "lib/relative.ts": (
        'import type {\n  Only,\n  Types,\n} from "type-only-package";\n'
        'export type { More } from "another-type-only-package";\n'
        'import { Client } from "pg";\nexport const a = 1;\n'
    ),
    "tests/builtins-only.mjs": (
        'import { createHash } from "node:crypto";\nimport fs from "fs";\n'
        '// import x from "commented-package";\nconst s = "import y from \'in-a-string\'";\n'
    ),
    "tests/inline-type.mjs": 'import { type Row } from "lossless-json";\n',
    "tests/dynamic.mjs": 'const m = await import("dynamic-package");\n',
    "tests/spawns-next.mjs": 'import { spawn } from "node:child_process";\nspawn(process.execPath, ["node_modules/next/dist/bin/next", "build"]);\n',
}


def self_test() -> int:
    """
    Run the reader against fixtures that name what each rule must find, in both
    directions.
    """
    expected = {
        "needs_node": {"pg"},
        "needs_only_builtins": set(),
        "needs_nothing": set(),
        "needs_inline_type_import": {"lossless-json"},
        "needs_dynamic_import": {"dynamic-package"},
        "needs_a_package_by_path": {"next"},
        "runs_npx_from_rust": {"npx (runs packages)"},
    }
    failures = []
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        for relative, text in SELF_TEST_SCRIPTS.items():
            path = root / DASHBOARD / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        rust = root / "fixture.rs"
        rust.write_text(SELF_TEST_RUST, encoding="utf-8")
        for test, packages in expected.items():
            scripts, found = scripts_of(rust, test, root)
            found |= {
                name for script in scripts for name, _ in bare_packages(script, root / DASHBOARD)
            }
            if found != packages:
                failures.append(f"{test}: expected {sorted(packages)}, found {sorted(found)}")
        outside = root / "product/rd-owner-client/outside.ts"
        outside.parent.mkdir(parents=True)
        outside.write_text('import x from "outside-package";\n', encoding="utf-8")
        unreadable = root / DASHBOARD / "tests/computed-import.mjs"
        unreadable.write_text("const m = await import(pathToFileURL(x).href);\n", encoding="utf-8")
        for refused, what in (
            (outside, "a package imported from outside the Dashboard"),
            (unreadable, "an import of a computed specifier"),
        ):
            try:
                bare_packages(refused, root / DASHBOARD)
                failures.append(f"{what} was not refused")
            except SystemExit:
                pass
    parsed_rust.cache_clear()
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    return 1 if failures else 0


def main() -> int:
    if sys.argv[1:] == ["--self-test"]:
        return self_test()
    if sys.argv[1:] == ["--hook"]:
        return self_test() or check(ROOT / "scripts/ci/test-rd-owner-postgres.bash")
    if len(sys.argv) == 3 and sys.argv[1] in ("--check", "--list"):
        chain = Path(sys.argv[2]).resolve()
        if sys.argv[1] == "--check":
            return check(chain)
        for name, packages in sorted(entries_needing_node(chain).items()):
            print(f"{name}\t{','.join(sorted(packages))}")
        return 0
    fail("usage: chain-node-entries.py --check|--list <chain script> | --self-test | --hook")
    return 2


if __name__ == "__main__":
    sys.exit(main())
