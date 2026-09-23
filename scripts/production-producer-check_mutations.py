#!/usr/bin/env python3
"""
Reintroduce each defect the calibration claims to catch, and watch it be caught.

A calibration that has only ever passed says nothing about what it would catch. Running it
against a deliberately broken copy of the tool says exactly that, for one named defect at a
time, and the table below is the only place where "this check defends against that" is
written down in a form that is executed rather than described. One case can catch
several defects, so what is pinned is that the case which caught it names the symbol
the defect is about - not that the pairing is one to one.

The step that matters is the second one. A mutation that fails to apply - a stale anchor, a
pattern that matches nothing - leaves the tool intact, the calibration passes, and that reads
as "the check cannot catch this defect". The two are indistinguishable from the output alone,
so every mutation first has to move a reading of its own before its calibration result counts.

Run: python3 -B scripts/production-producer-check_mutations.py

"""

import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).parent
TOOL = HERE / "production-producer-check.py"
CALIBRATION = HERE / "production-producer-check_test.py"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def definition_gates(module, rev, name):
    """
    Return the gates on the first definition of `name`, located by symbol not by line.
    """
    pattern = rf"(^|{module.NOT_WORD})fn {name}{module.SPACE}*[(<]"
    for path, lineno, _text in module.grep(rev, pattern):
        return module.gates(rev, path, lineno)
    return None


def producers(module, rev, name):
    sites = module.producer_sites(rev, name)
    return len(sites), len([s for s in sites if not module.gates(rev, s[0], s[1])])


MUTATIONS = [
    {
        # `\s` would be the truer defect, but whether it matches is a property of the
        # platform's regex library - glibc takes it, BSD does not - so a mutation built on
        # it moves a reading on one machine and none on the other. What the calibration has
        # to catch is that the whitespace class stopped matching whitespace, and that is
        # the same defect on both.
        "label": "the whitespace class no longer matches whitespace",
        "old": 'SPACE = "[[:space:]]"',
        "new": 'SPACE = "[[:alpha:]]"',
        "probe": lambda m, rev: producers(m, rev, "SourceIntakeRetrievalTimeEvidenceV1"),
        "expect": "SourceIntakeRetrievalTimeEvidenceV1: 1 ungated producers, expected 0",
    },
    {
        "label": "gates read from the file alone, not from the parent's `mod`",
        "old": "return ([module_gate] if module_gate else []) + enclosing_cfgs(rev, path, lineno)",
        "new": "return enclosing_cfgs(rev, path, lineno)",
        "probe": lambda m, rev: producers(
            m,
            rev,
            "SealedAcceptanceProtectedEvaluationSharedTimeV1",
        ),
        "expect": "a file gated by its parent's `mod` declaration was read as ungated",
    },
    {
        "label": "attributes taken from a fixed window above the item",
        "old": '        if text == "" or text.endswith(("}", ";")):\n            break',
        "new": "        if cursor < index - 6:\n            break",
        "probe": lambda m, rev: definition_gates(m, rev, "compile_from_owner_source_resolution"),
        "expect": "compile_from_owner_source_resolution: it inherited the previous item's",
    },
    {
        "label": "an item's own gate dropped on its signature line",
        "old": "        if index + 1 == lineno:",
        "new": "        if index + 2 == lineno:",
        "probe": lambda m, rev: producers(m, rev, "SourceIntakeRetrievalTimeEvidenceV1"),
        "expect": "SourceIntakeRetrievalTimeEvidenceV1: 1 ungated producers, expected 0",
    },
    {
        "label": "a decode into an annotated binding is not a producer",
        "old": '        rf"|:{SPACE}*(crate::)?([a-z_]+::)*{name}{SPACE}*="',
        "new": '        rf"|(?!x)x"',
        "probe": lambda m, rev: producers(m, rev, "SourceIntakeResearchAncestryProposalV1"),
        "expect": "a type produced only by an ungated decode was read as having no ungated producer",
    },
    {
        "label": "a name in a doc comment counts as a mention",
        "old": 'elif name in COMMENT_RE.sub("", line):',
        "new": "elif True:",
        "probe": lambda m, rev: m.occurrences(
            rev,
            "issue_native_replay_execution_input_binding_v2_in_transaction",
        ),
        "expect": "issue_native_replay_execution_input_binding_v2_in_transaction: 1 mentions outside its declaration, expected 0",
    },
]


def main():
    baseline = load(TOOL, "baseline")
    rev = baseline.resolve("HEAD")
    if not rev:
        print("HEAD does not resolve", file=sys.stderr)
        return 2

    source = TOOL.read_text()
    failures = []
    for mutation in MUTATIONS:
        label = mutation["label"]
        if mutation["old"] not in source:
            failures.append(
                f"{label}: its anchor is no longer in the tool, so it was never applied",
            )
            continue
        with tempfile.TemporaryDirectory() as directory:
            broken = Path(directory) / "production-producer-check.py"
            broken.write_text(source.replace(mutation["old"], mutation["new"], 1))
            mutant = load(broken, f"mutant_{len(failures)}_{abs(hash(label))}")

            # Before the calibration result counts for anything, the mutation has to have
            # changed something. An anchor that matched but changed no behaviour produces
            # a passing calibration, which is the same output as a check that cannot catch
            # the defect.
            before, after = mutation["probe"](baseline, rev), mutation["probe"](mutant, rev)
            if before == after:
                failures.append(
                    f"{label}: the probe reads {before!r} with and without the mutation,"
                    f" so this run proves nothing about the calibration",
                )
                continue

            result = subprocess.run(
                [sys.executable, "-B", str(CALIBRATION)],
                capture_output=True,
                text=True,
                check=False,
                env={**os.environ, "PRODUCTION_PRODUCER_CHECK_TOOL": str(broken)},
                cwd=str(HERE.parent),
            )
            if result.returncode == 0:
                failures.append(
                    f"{label}: probe moved {before!r} -> {after!r}, calibration still passed",
                )
            elif mutation["expect"] not in result.stdout:
                failures.append(
                    f"{label}: calibration failed but not on the expected case"
                    f" ({mutation['expect']!r} not in its output)",
                )

    if failures:
        print("production-producer-check mutation harness FAILED:")
        for message in failures:
            print(f"  {message}")
        return 1
    print(
        f"production-producer-check mutations: {len(MUTATIONS)} defects reintroduced,"
        f" each moved a reading of its own and each was caught by a case naming"
        f" the symbol it concerns",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
