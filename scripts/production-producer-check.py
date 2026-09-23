#!/usr/bin/env python3
"""
Answer, for one Rust type or function, whether production code produces or calls it.

Two questions come up repeatedly and get re-derived by hand, differently each time:

  * every site that produces this type - is any of them outside a cfg gate?
  * every caller of this function - is any of them outside tests and outside a gate?

A "no" to either is a claim that something exists only for tests, so the cost of a
broken pattern is a clean-looking zero that reads as a finding. This prints a control
alongside every answer: the same two numbers for a name known to have the opposite
answer, plus a bare-name count that proves the search reached the file at all.

Gates are read from the chain of enclosing `impl` / `mod` / `fn` blocks and from the
`mod x;` declaration in the parent file, because the nearest attribute above a line
frequently belongs to the item before it.

This answers one symbol at a time, and that is the usage it holds up under. Callers and
producers are matched by name, so a name carried by more than one declaration collects all
of them and the tool says so rather than guessing; over a list, those rows are the result.

Another lane ran 31 lead symbols from a dead-code census through it and abandoned the batch
for a compiler-based classification. Counted from their logs rather than from the report
they first wrote:

    22  attributable
     6  name declared more than once     - 19%, and the reason they stopped
     2  outside what this models         - a const and an enum variant
     1  never queried                    - their own omission, not a property of the tool
    --
    31

So: use it to answer a symbol you are already asking about, and before using it over a
list, run the list and read the two rates separately. Ambiguity and being asked about the
wrong kind of symbol have different repairs, and adding them together overstates the first
while hiding the second.

Usage:
    scripts/production-producer-check.py SourceIntakeRetrievalTimeEvidenceV1
    scripts/production-producer-check.py commit_source_intake_success_terminal_in_transaction
    scripts/production-producer-check.py MyTypeV1 --rev origin/main --control StrategyPlanV2

"""

import argparse
import functools
import os
import re
import shutil
import subprocess
import sys


# `git grep -E` is POSIX ERE, and whether `\b` and `\s` match there is a property of the
# platform's regex library rather than of the pattern: glibc takes them as extensions,
# BSD does not and matches nothing, silently. Measured at git 2.54 on Linux and 2.55 on
# macOS, same tree, same command: `\b` finds the symbol on the first and not on the
# second. A pattern validated in CI can therefore return nothing on a developer's machine,
# so every pattern below uses bracket expressions, which mean the same thing everywhere.
NOT_WORD = "[^A-Za-z0-9_]"
SPACE = "[[:space:]]"

STRING_RE = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)\'')
COMMENT_RE = re.compile(r"//.*$")
ITEM_RE = re.compile(
    r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:unsafe\s+)?(?:async\s+)?"
    r"(?:impl|mod|fn|trait|struct|enum)\b",
)
FN_RE = re.compile(
    r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(",
)
CFG_RE = re.compile(r"#\[\s*cfg\s*\((.*?)\)\s*\]")
MOD_DECL_RE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([a-z_][a-z0-9_]*)\s*;")
TEST_ATTR_RE = re.compile(r"#\[(?:tokio::)?(?:rstest::)?(?:test|rstest)")

DEFAULT_CONTROLS = {
    "type": "StrategyPlanV2",
    "function": "admit_market_data_universe_program_event_v2",
}


def git(*args):
    return subprocess.run(
        [shutil.which("git") or "git", *args],
        capture_output=True,
        text=True,
        check=False,
    ).stdout


@functools.cache
def resolve(rev):
    """
    Resolve a rev to its commit id.

    A rev spelled `HEAD` or `origin/main` prefixes `git grep` output with that spelling,
    which a commit-shaped parser silently drops - every hit, as a clean zero.

    """
    return git("rev-parse", rev).strip()


@functools.cache
def file_lines(rev, path):
    return git("show", f"{rev}:{path}").split("\n")


def strip_literals(line):
    return COMMENT_RE.sub("", STRING_RE.sub('""', line))


def attributes_above(lines, index):
    """
    Return the attribute block attached to the item declared at `index`.

    Walk to the previous item boundary - a blank line, or a line ending in `}` or `;` -
    rather than a fixed number of lines, so that a multi-line `#[cfg(any(...))]` between
    the attribute and the signature does not hide it.

    """
    out = []
    cursor = index - 1
    while cursor >= 0:
        text = lines[cursor].strip()
        if text == "" or text.endswith(("}", ";")):
            break
        out.append(text)
        cursor -= 1
    return " ".join(out)


def enclosing_cfgs(rev, path, lineno):
    """
    Every cfg predicate on the chain of item blocks that contains `lineno`.
    """
    lines = file_lines(rev, path)
    stack = []
    pending = None
    depth = 0
    for index, line in enumerate(lines):
        code = strip_literals(line)
        if pending is not None and "{" in code:
            # A signature spanning several lines opens its block further down; keying on
            # `{` being on the signature line loses that item's own attributes.
            stack.append((depth, pending))
            pending = None
        elif ITEM_RE.match(line):
            cfgs = CFG_RE.findall(attributes_above(lines, index))
            governing = "; ".join(cfgs) if cfgs else None
            if "{" in code:
                stack.append((depth, governing))
            elif not code.rstrip().endswith(";"):
                pending = governing
        if index + 1 == lineno:
            # After this line's own item is on the stack: a producer found by its return
            # type always sits on the signature line, and that item's gate governs it.
            return [cfg for _, cfg in stack if cfg]
        depth += code.count("{") - code.count("}")
        while stack and depth <= stack[-1][0]:
            stack.pop()
    return []


def occurrences(rev, name):
    """
    Every line carrying the name, split into its own declaration and everything else.

    A symbol that appears only where it is declared has no consumers, which looks
    exactly like a pattern that matched nothing; separating the two is what tells them
    apart.

    """
    declaration_re = re.compile(
        rf"(^|{NOT_WORD})(fn|struct|enum|trait|const|static|type|mod|use) +{name}\b",
    )

    own, other = 0, 0
    for line in git("grep", "-n", name, rev, "--", "*.rs").split("\n"):
        if not line.strip():
            continue
        if declaration_re.search(line):
            own += 1
        elif name in COMMENT_RE.sub("", line):
            # A doc comment naming a symbol is not a consumer of it. Counting one makes
            # a symbol nothing calls look like a symbol whose callers the search missed.
            other += 1
    return own, other


@functools.cache
def gated_module_files(rev):
    """
    Map each file to the cfg on the `mod x;` declaration that brought it in, if any.

    A module gated in its parent is gated throughout, and nothing inside the file says so.
    Only files that declare a submodule are read: finding them by reading every `.rs` file
    costs one `git show` each and dominates the runtime of everything else here.

    """
    pattern = rf"^{SPACE}*(pub({SPACE}*\([^)]*\))?{SPACE}+)?mod{SPACE}+[a-z_][a-z0-9_]*{SPACE}*;"
    declaring = {path for path, _lineno, _text in grep(rev, pattern) if path.endswith(".rs")}
    out = {}
    for path in sorted(declaring):
        lines = file_lines(rev, path)
        directory = os.path.dirname(path)
        stem = os.path.basename(path)[:-3]
        root = directory if stem in ("mod", "lib", "main") else f"{directory}/{stem}"
        for index, line in enumerate(lines):
            match = MOD_DECL_RE.match(line)
            if not match:
                continue
            cfgs = CFG_RE.findall(attributes_above(lines, index))
            if not cfgs:
                continue
            for candidate in (
                f"{root}/{match.group(1)}.rs",
                f"{root}/{match.group(1)}/mod.rs",
            ):
                out.setdefault(candidate, "; ".join(cfgs))
    return out


def gates(rev, path, lineno):
    module_gate = gated_module_files(rev).get(path)
    return ([module_gate] if module_gate else []) + enclosing_cfgs(rev, path, lineno)


def grep(rev, pattern):
    lines = git("grep", "-nE", pattern, rev, "--", "*.rs").split("\n")
    out = []
    for line in lines:
        match = re.match(r"^[0-9a-f]+:([^:]+):(\d+):(.*)$", line)
        if match:
            out.append((match.group(1), int(match.group(2)), match.group(3)))
    return out


def is_production_file(path):
    return "/src/" in path and not path.endswith("_tests.rs")


def producer_sites(rev, name):
    pattern = (
        rf"(^|{NOT_WORD}){name}{SPACE}*\{{"
        rf"|(^|{NOT_WORD}){name}::[a-z_]+{SPACE}*\("
        rf"|->{SPACE}*(anyhow::)?(Result<)?{SPACE}*{name}(<|{SPACE}|,|>|$)"
        # A value decoded into an annotated binding or a turbofish is produced there too,
        # and a type whose only production producer is a decode has none by the three
        # patterns above - which reads as a finding rather than as a missing spelling.
        rf"|:{SPACE}*(crate::)?([a-z_]+::)*{name}{SPACE}*="
        rf"|::<[^>]*{name}[^>]*>"
    )
    out = []
    for path, lineno, text in grep(rev, pattern):
        if re.search(rf"(struct|enum|trait|impl|use) +{name}\b", text):
            continue
        if is_production_file(path):
            out.append((path, lineno, text.strip()))
    return out


def call_sites(rev, name):
    out = []
    for path, lineno, text in grep(rev, rf"(^|{NOT_WORD}){name}{SPACE}*\("):
        if re.search(rf"fn +{name}\b", text):
            continue
        out.append((path, lineno, text.strip()))
    return out


def under_test_attribute(rev, path, lineno):
    lines = file_lines(rev, path)
    for index in range(min(lineno, len(lines)) - 1, -1, -1):
        if not FN_RE.match(lines[index]):
            continue
        cursor = index - 1
        while cursor >= 0:
            text = lines[cursor].strip()
            if text == "" or text.endswith(("}", ";")):
                break
            if TEST_ATTR_RE.search(text):
                return True
            cursor -= 1
        return False
    return False


def classify_callers(rev, name):
    production, other = [], []
    for path, lineno, text in call_sites(rev, name):
        in_test_tree = "/tests/" in path or path.endswith("_tests.rs")
        gate = ["tests tree"] if in_test_tree else gates(rev, path, lineno)
        if in_test_tree or gate or under_test_attribute(rev, path, lineno):
            other.append((path, lineno, gate, text))
        else:
            production.append((path, lineno, gate, text))
    return production, other


def bare_name_files(rev, name):
    """
    Count files carrying the name with a pattern that cannot miss.

    This is the instrument's own positive control.

    """
    return len([line for line in git("grep", "-l", name, rev, "--", "*.rs").split("\n") if line])


MODELLED = ("fn", "struct", "enum", "trait", "type")


def declaration_kind(rev, name):
    """
    Return the keyword that declares `name`, or None if nothing declares it.

    A const, a static and an enum variant are none of the things this tool models, and
    saying so is different from saying the search failed.

    """
    pattern = rf"(^|{NOT_WORD})(fn|struct|enum|trait|const|static|type) +{name}{NOT_WORD}"
    for _path, _lineno, text in grep(rev, pattern):
        match = re.search(rf"(fn|struct|enum|trait|const|static|type) +{name}{NOT_WORD}", text)
        if match:
            return match.group(1)
    return None


def looks_like_type(name):
    return name[:1].isupper()


def report(rev, name, indent=""):
    files = bare_name_files(rev, name)
    declarations, mentions = occurrences(rev, name)
    sites = producer_sites(rev, name)
    ungated = [(p, l, t) for p, l, t in sites if not gates(rev, p, l)]
    production, other = classify_callers(rev, name)
    print(f"{indent}{name}")
    # Every stage, so that a zero from a probe that returned early is distinguishable
    # from a zero from a probe that walked the whole way and found nothing.
    print(
        f"{indent}  reached: {files} file(s) -> {declarations} declaration(s)"
        f" -> {mentions} other mention(s) -> {len(sites)} producer site(s),"
        f" {len(production) + len(other)} call site(s)",
    )
    if files == 0:
        print(f"{indent}  NOT FOUND at this rev. Check the spelling before reading anything below.")
        return files, sites, ungated, production, other
    print(f"{indent}  producers in production modules: {len(sites)}, ungated: {len(ungated)}")
    for path, lineno, text in sites:
        print(
            f"{indent}    {path}:{lineno}  gates={gates(rev, path, lineno) or 'NONE'}  {text[:70]}",
        )
    print(f"{indent}  callers: {len(production)} production, {len(other)} test or gated")
    for path, lineno, _gate, text in production:
        print(f"{indent}    production caller  {path}:{lineno}  {text[:60]}")
    if mentions and not sites and not production and not other:
        kind = declaration_kind(rev, name)
        if kind is not None and kind not in MODELLED:
            # Its own domain limit, not a defect: producers and callers are not defined
            # for a constant, and reporting a broken search here sends the reader looking
            # for a pattern that was never missing.
            print(
                f"{indent}  This name declares a `{kind}`. Producers and callers are defined"
                f" for types and\n{indent}  functions; for a {kind} the {mentions} mention(s)"
                f" above are its uses, and that is all\n{indent}  this tool can say about it.",
            )
        elif kind is None:
            print(
                f"{indent}  Nothing declares this name as a fn, struct, enum, trait or type."
                f"\n{indent}  If it is an enum variant, a macro or a field, this tool does not"
                f" model it; if it\n{indent}  should be one of the five, the {mentions} mention(s)"
                f" above are a broken search.",
            )
        else:
            print(
                f"{indent}  WARNING: {mentions} mention(s) outside the declaration, and no pattern"
                f" matched any of them.\n{indent}  That is a broken search, not an absent producer.",
            )
    if declarations and not mentions:
        print(f"{indent}  Declared here and mentioned nowhere else at this rev.")
    if declarations > 1:
        # Callers are found by name. A name declared more than once collects the callers
        # of every declaration, and nothing in the count says so: `new` answers with
        # thousands of production callers, none of which are attributable.
        print(
            f"{indent}  WARNING: {declarations} declarations carry this name, so the caller"
            f" counts above\n{indent}  belong to all of them together and to none of them"
            f" in particular.",
        )
    return files, sites, ungated, production, other


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.strip().split("\n")[0])
    parser.add_argument("name", help="Rust type or function name")
    parser.add_argument("--rev", default="HEAD", help="git rev to read (default HEAD)")
    parser.add_argument("--control", help="name known to have the opposite answer")
    args = parser.parse_args(argv)

    kind = "type" if looks_like_type(args.name) else "function"
    control = args.control or DEFAULT_CONTROLS[kind]
    rev = resolve(args.rev)
    if not rev:
        print(f"cannot resolve rev {args.rev!r}", file=sys.stderr)
        return 2

    print(f"target ({kind}) at {args.rev} = {rev[:9]}:")
    files, _sites, _ungated, _production, _other = report(rev, args.name, "  ")
    print("\ncontrol, same visibility shape, known to answer the other way:")
    report(rev, control, "  ")
    print(
        "\nA zero above means something only if the control on the same line is non-zero."
        "\nAn ungated producer is not the same as a reached one: read its callers too.",
    )
    return 0 if files else 2


if __name__ == "__main__":
    sys.exit(main())
