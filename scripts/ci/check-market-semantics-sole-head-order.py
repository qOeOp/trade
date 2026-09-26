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

A function admits when it calls `admit_market_semantics_fact_v1`, sends a request naming the Owner
route `/v1/market-data/market-semantics` (the route's own `.route(...)` definition does not) directly
or through a constant or static holding it, or builds a `MarketSemanticsFactSubmissionV1`, which every
typed admission, through any trait or route, needs. It
registers when it calls the registration. Either holds for every function that calls one that does,
across every file of the crates the chain's packages depend on, so a helper in another module or
crate counts.

Calls are matched by name. A name defined in up to three places makes every caller of any of them
count, which can refuse a safe order but never passes an unsafe one. A name defined more often than
that is a dispatch name (`admit`, `new`, `run`) and carries nothing: through one, every function would
count and the check would refuse every order. A seed's own name carries only when it is unique, since
a trait method's production implementation is a seed and shares its name with other traits' methods. What it can miss is an admission reached only through
such a name, and that path still builds the submission type somewhere a seed sees. A handler passed to
a router as a value is not called by it, so composing the route admits nothing.

This check stands in for the registration taking its corpus snapshot from its caller instead of
reading the sole head. When the registration does that, this check and its call go.

Usage: check-market-semantics-sole-head-order.py <chain script>
       check-market-semantics-sole-head-order.py --self-test

"""

from __future__ import annotations

import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGISTERS = "register_bar_joined_cut_declarations_for_published_design_v1"
ADMITS_CALL = "admit_market_semantics_fact_v1"
ADMITS_ROUTE = "/v1/market-data/market-semantics"
ADMITS_TYPE = "MarketSemanticsFactSubmissionV1"
AMBIGUITY_LIMIT = 3
IDENTIFIER = re.compile(r"[A-Za-z_]\w*")
FN_HEAD = re.compile(r"\bfn\s+(\w+)\s*(?:<[^>{}]*>)?\s*\(")
# A call: a name followed by `(`, optionally through a turbofish.
CALL = re.compile(r"\b([A-Za-z_]\w*)\s*(?:::\s*<[^;{}()]*>\s*)?\(")
TOKENS = re.compile(
    r"""(?P<line>//[^\n]*)"""
    r"""|(?P<block>/\*.*?\*/)"""
    r"""|(?P<raw>\bb?r(?P<hashes>\#*)"(?P<raw_body>.*?)"(?P=hashes))"""
    r"""|(?P<string>\bb?"(?P<string_body>(?:\\.|[^"\\])*)"|"(?P<plain_body>(?:\\.|[^"\\])*)")"""
    r"""|(?P<char>'(?:\\.|[^\\'\n])')""",
    re.DOTALL,
)
ROUTE_DEFINITION = re.compile(r"\.\s*route\s*\(\s*$")


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def masked(source: str) -> tuple[str, list[tuple[int, str]]]:
    """
    Return the source with comments and literals blanked (offsets and newlines kept),
    and the string literals with their offsets.
    """
    literals: list[tuple[int, str]] = []

    def blank(match: re.Match[str]) -> str:
        body = match.group("raw_body")
        if body is None:
            body = match.group("string_body")
        if body is None:
            body = match.group("plain_body")
        if body is not None:
            literals.append((match.start(), body))
        return "".join(c if c == "\n" else " " for c in match.group(0))

    return TOKENS.sub(blank, source), literals


@dataclass(frozen=True)
class Function:
    name: str
    path: Path
    calls: frozenset[str]
    names: frozenset[str]
    requests_route: bool


ITEM_HEAD = re.compile(r"\b(?:const|static)\s+([A-Za-z_]\w*)\s*:")


def functions_of(path: Path) -> tuple[list[Function], set[str]]:
    """
    Return the file's functions, and the names of its `const` and `static` items whose value names
    the Owner route: a function naming one of those sends the request as surely as one holding
    the literal itself.
    """
    code, literals = masked(path.read_text(encoding="utf-8"))
    closing: dict[int, int] = {}
    stack: list[int] = []
    for brace in re.finditer(r"[{}]", code):
        if brace.group() == "{":
            stack.append(brace.start())
        elif stack:
            closing[stack.pop()] = brace.start()
    found = []
    for head in FN_HEAD.finditer(code):
        opening = code.find("{", head.end())
        semicolon = code.find(";", head.end())
        if opening == -1 or (semicolon != -1 and semicolon < opening) or opening not in closing:
            continue
        end = closing[opening]
        calls = frozenset(match.group(1) for match in CALL.finditer(code, opening, end))
        names = frozenset(IDENTIFIER.findall(code, opening, end))
        requests = any(
            opening < offset < end
            and ADMITS_ROUTE in text
            and not ROUTE_DEFINITION.search(code[max(0, offset - 40) : offset])
            for offset, text in literals
        )
        found.append(Function(head.group(1), path, calls, names, requests))
    route_items = set()
    for offset, text in literals:
        if ADMITS_ROUTE not in text:
            continue
        statement = code[max(code.rfind(";", 0, offset), code.rfind("}", 0, offset)) + 1 : offset]
        item = ITEM_HEAD.search(statement)
        if item:
            route_items.add(item.group(1))
    return found, route_items


def tainted(functions: list[Function], seed: callable) -> set[Function]:
    """
    Every function that is a seed or calls, by a name defined at most AMBIGUITY_LIMIT
    times, one that is tainted.
    """
    definitions: dict[str, int] = {}
    for function in functions:
        definitions[function.name] = definitions.get(function.name, 0) + 1
    carries = {name for name, count in definitions.items() if count <= AMBIGUITY_LIMIT}
    marked = {function for function in functions if seed(function)}
    # A seed's own name carries only when it names nothing else: the production implementation of
    # a trait method such as `admit_fact` is a seed, and every other `admit_fact` would otherwise
    # carry its taint. Its real callers build the submission type and are seeds themselves.
    names = {function.name for function in marked if definitions[function.name] == 1}
    changed = True
    while changed:
        changed = False
        for function in functions:
            if function not in marked and function.calls & names:
                marked.add(function)
                if function.name in carries:
                    names.add(function.name)
                changed = True
    return marked


def violations(
    entries: list[tuple[str, Function]],
    functions: list[Function],
    route_items: set[str] = frozenset(),
) -> list[str]:
    """
    Name every registering entry that an admitting entry precedes, by chain position.
    """
    admitting = tainted(
        functions,
        lambda function: (
            ADMITS_CALL in function.calls
            or function.requests_route
            or ADMITS_TYPE in function.names
            or bool(function.names & route_items)
        ),
    )
    registering = tainted(functions, lambda function: REGISTERS in function.calls)
    first_admitter: tuple[int, str] | None = None
    registers_seen = 0
    found = []
    for position, (label, function) in enumerate(entries, start=1):
        if function in registering:
            registers_seen += 1
            if first_admitter is not None:
                found.append(
                    f"entry {position} ({label}) finds its corpus as the sole Market Semantics "
                    f"head, but entry {first_admitter[0]} ({first_admitter[1]}) admits a production "
                    "Market Semantics fact before it; move the admitting entry after every "
                    "registering one",
                )
        if function in admitting and first_admitter is None:
            first_admitter = (position, label)
    if not registers_seen:
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


def workspace_crates(root: Path) -> dict[str, tuple[Path, set[str]]]:
    """
    Every workspace crate by package name, with the names its manifest depends on.
    """
    crates = {}
    for manifest in root.glob("crates/**/Cargo.toml"):
        text = manifest.read_text(encoding="utf-8")
        name = re.search(r'^name\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if name:
            depends = set(re.findall(r"^([A-Za-z0-9_-]+)\s*=", text, re.MULTILINE))
            crates[name.group(1)] = (manifest.parent, depends)
    return crates


def closure(crates: dict[str, tuple[Path, set[str]]], packages: set[str]) -> list[Path]:
    reached = set()
    frontier = list(packages)
    while frontier:
        package = frontier.pop()
        if package in reached or package not in crates:
            continue
        reached.add(package)
        frontier.extend(crates[package][1] & crates.keys())
    return [crates[package][0] for package in sorted(reached)]


def check(chain: Path, root: Path = ROOT) -> None:
    crates = workspace_crates(root)
    rows = chain_entries(chain)
    missing = sorted({package for package, _ in rows} - crates.keys())
    if missing:
        fail(f"the chain names packages with no crate: {', '.join(missing)}")
    functions: list[Function] = []
    route_items: set[str] = set()
    for directory in closure(crates, {package for package, _ in rows}):
        for path in sorted(directory.rglob("*.rs")):
            found, items = functions_of(path)
            functions += found
            route_items |= items
    entries = []
    for package, test in rows:
        name = test.rsplit("::", 1)[-1]
        directory = crates[package][0]
        matches = [f for f in functions if f.name == name and directory in f.path.parents]
        if len(matches) != 1:
            fail(f"test {test} is defined exactly once in {directory}, found {len(matches)}")
        entries.append((test, matches[0]))
    found = violations(entries, functions, route_items)
    for message in found:
        print(f"ERROR: {message}", file=sys.stderr)
    if found:
        raise SystemExit(1)


def self_test() -> None:
    sources = {
        "registration.rs": """
fn register_through_a_helper() { register_bar_joined_cut_declarations_for_published_design_v1(); }
""",
        "fixture.rs": """
fn ensure_admitted() { owner.admit_market_semantics_fact_v1(x); }
fn ensure_through_the_route() { post("/v1/market-data/market-semantics"); }
fn router() -> Router {
    Router::new().route("/v1/market-data/market-semantics", post(admit_semantics))
}
fn admit_semantics() { admission.admit_market_semantics_fact_v1(x); }
fn ensure_through_a_trait() {
    let submission = MarketSemanticsFactSubmissionV1 { value };
    semantics.admit_fact(submission);
}
fn run() {}
fn admit_fact() { owner.admit_market_semantics_fact_v1(x); }
""",
        "scanner.rs": """
fn admit_fact() {}
fn uses_the_other_admit_fact() { admit_fact(); }
""",
        "route_constant.rs": """
const SEMANTICS_ROUTE: &str = "/v1/market-data/market-semantics";
fn ensure_through_a_route_constant() { client.post(SEMANTICS_ROUTE).json(&json!({})); }
""",
        "other_fixture.rs": """
fn run() { ensure_admitted(); }
fn helper_twice() { ensure_admitted(); }
""",
        "third_fixture.rs": """
fn run() {}
fn helper_twice() {}
""",
        "fourth_fixture.rs": """
fn run() {}
""",
        "tests.rs": """
fn registers() { register_through_a_helper(); }
fn admits_through_another_file() { ensure_admitted(); }
fn admits_through_the_route_in_another_file() { ensure_through_the_route(); }
fn composes_only() { let app = router(); }
fn admits_through_a_trait_in_another_file() { ensure_through_a_trait(); }
fn admits_through_a_name_defined_twice() { helper_twice(); }
fn calls_a_dispatch_name() { run(); }
fn admits_through_a_route_constant() { ensure_through_a_route_constant(); }
fn calls_another_traits_method() { uses_the_other_admit_fact(); }
fn names_it_in_a_comment() { // ensure_admitted()
}
fn names_it_in_a_string() { let s = "ensure_admitted()"; }
""",
    }
    with tempfile.TemporaryDirectory() as directory:
        functions = []
        route_items: set[str] = set()
        for name, text in sources.items():
            path = Path(directory) / name
            path.write_text(text, encoding="utf-8")
            found, items = functions_of(path)
            functions += found
            route_items |= items
        by_name = {function.name: function for function in functions}

        def order(*tests: str) -> list[str]:
            return violations([(test, by_name[test]) for test in tests], functions, route_items)

        assert order("registers", "admits_through_another_file") == [], "admitting after is fine"
        assert order("admits_through_another_file") == [
            f"no chain entry calls {REGISTERS}; this check has nothing to order",
        ], "a chain with no registering entry is refused, not passed"
        assert len(order("admits_through_another_file", "registers")) == 1, (
            "a call in a helper of another file, before, is refused"
        )
        assert len(order("admits_through_the_route_in_another_file", "registers")) == 1, (
            "a request to the route from a helper of another file, before, is refused"
        )
        assert order("composes_only", "registers") == [], "composing the route admits nothing"
        assert len(order("admits_through_a_trait_in_another_file", "registers")) == 1, (
            "building the submission for a trait admission, before, is refused"
        )
        assert len(order("admits_through_a_name_defined_twice", "registers")) == 1, (
            "a name defined in a few places carries: every caller counts"
        )
        assert len(order("admits_through_a_route_constant", "registers")) == 1, (
            "a request naming the route through a constant, with an untyped body, is refused"
        )
        assert order("calls_another_traits_method", "registers") == [], (
            "a seed's name shared with another trait's method carries nothing"
        )
        assert order("calls_a_dispatch_name", "registers") == [], (
            "a name defined in more than AMBIGUITY_LIMIT places carries nothing"
        )
        assert order("names_it_in_a_comment", "registers") == [], "a comment calls nothing"
        assert order("names_it_in_a_string", "registers") == [], "a string calls nothing"
        refused = order("admits_through_another_file", "registers")[0]
        assert "entry 2 (registers)" in refused, refused
        assert "entry 1 (admits_through_another_file)" in refused, refused
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
