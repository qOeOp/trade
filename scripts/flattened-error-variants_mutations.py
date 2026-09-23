#!/usr/bin/env python3
"""
Reintroduce each defect the flattened-error-variants calibration claims to catch.

Each mutation is applied to a copy of the tool, must first move a reading of its own on the
calibration's synthetic repository, and only then is the calibration run against the copy and
required to fail on the message that names what the defect breaks. A mutation that matches no
text, or matches and changes nothing, stops at the second step and says so - otherwise it would
pass silently and read as a check that cannot catch the defect.

Readings are taken on the same synthetic repository the calibration builds, so neither depends
on the state of this one.

Run: python3 -B scripts/flattened-error-variants_mutations.py

"""

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).parent
TOOL = HERE / "flattened-error-variants.py"
PRIMITIVES = HERE / "production-producer-check.py"
CALIBRATION = HERE / "flattened-error-variants_test.py"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


calibration = load(CALIBRATION, "calibration")
LIB = calibration.LIB


def edge(module, rev, name):
    line = next(n for p, n, _t in module.ppc.call_sites(rev, name) if p == LIB)
    return module.classify_edge(rev, LIB, line, name)


def flat_line(module, rev, name):
    return next(n for p, n, _t in module.ppc.call_sites(rev, name) if p == LIB)


def bucket(module, rev, key):
    return module.classify_all(rev)[1][key][0]


MUTATIONS = [
    {
        "label": "`.map_err(|_| ..)` is not recognised as a discard",
        "old": '    (re.compile(r"\\.map_err\\(\\s*\\|\\s*_[A-Za-z0-9_]*\\s*\\|"), "map_err(|_| ..)"),\n',
        "new": "",
        "probe": lambda m, rev: edge(m, rev, "two_arguments")[0],
        "expect": "`.map_err(|_| ..)` after a multi-line call",
    },
    {
        "label": "`.ok()` is not recognised as a discard",
        "old": '    (re.compile(r"\\.ok\\(\\)"), ".ok()"),\n',
        "new": "",
        "probe": lambda m, rev: edge(m, rev, "maybe_again")[0],
        "expect": "`.ok()` on a result",
    },
    {
        "label": "a call returned as the tail expression is not followed",
        "old": 'if following == "}":',
        "new": 'if following == "never":',
        "probe": lambda m, rev: edge(m, rev, "produce_refused"),
        "expect": "a call returned as the tail expression",
    },
    {
        "label": "`let Ok(..) = .. else` is not recognised as a discard",
        "old": 'LET_OK = re.compile(r"\\bif let Ok\\(|\\blet Ok\\(")',
        "new": 'LET_OK = re.compile(r"(?!x)x")',
        "probe": lambda m, rev: edge(m, rev, "maybe")[0],
        "expect": "`let Ok(..) = .. else`",
    },
    {
        "label": "`main` is not a boundary",
        "old": 'if name == "main":',
        "new": 'if name == "never-main":',
        "probe": lambda m, rev: m._follow(rev, "main", ("main",), {}, LIB)[0][0][0],
        "expect": "`main` was not treated as a boundary",
    },
    {
        "label": "a value sharing its discard with another is renamed as if it were alone",
        "old": "alone = alone and known == {key[1]}",
        "new": "alone = True",
        "probe": lambda m, rev: bucket(m, rev, ("PairError", "First")),
        "expect": "PairError::First: renamed, expected listed",
    },
    {
        "label": "a value alone at its discard is never renamed",
        "old": 'if bucket == "listed" and sites and alone and (closed or ruled):',
        "new": "if False:",
        "probe": lambda m, rev: bucket(m, rev, ("SingleError", "Only")),
        "expect": "SingleError::Only: listed, expected renamed",
    },
    {
        "label": "a block-bodied discard closure is not read for what the cause becomes",
        "old": "return index + 1, first.group(1) if first else",
        "new": "return index + 1, None if first else",
        "probe": lambda m, rev: m.discard_site(rev, LIB, flat_line(m, rev, "produce_only")),
        "expect": "a block-bodied discard closure becomes",
    },
]


def try_mutation(index, mutation, source, baseline, rev):
    """
    Return a failure message for one mutation, or None when it behaved.
    """
    label = mutation["label"]
    if mutation["old"] not in source:
        return f"{label}: its anchor is no longer in the tool, so it was never applied"
    with tempfile.TemporaryDirectory() as directory:
        broken = Path(directory) / TOOL.name
        broken.write_text(source.replace(mutation["old"], mutation["new"], 1))
        (Path(directory) / PRIMITIVES.name).write_text(PRIMITIVES.read_text())
        mutant = load(broken, f"mutant_{index}")
        before, after = mutation["probe"](baseline, rev), mutation["probe"](mutant, rev)
        if before == after:
            return f"{label}: reads {before!r} with and without the mutation; proves nothing"
        result = subprocess.run(
            [sys.executable, "-B", str(CALIBRATION)],
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "FLATTENED_ERROR_VARIANTS_TOOL": str(broken)},
            cwd=str(HERE.parent),
        )
    if result.returncode == 0:
        return f"{label}: moved {before!r} -> {after!r}, calibration still passed"
    if mutation["expect"] not in result.stdout:
        return f"{label}: calibration failed, but not with {mutation['expect']!r}"
    return None


def main():
    source = TOOL.read_text()
    enclosing = calibration.guard_enclosing_repository()
    home = Path.cwd()
    directory, rev = calibration.fixture_repository()
    try:
        os.chdir(directory)
        baseline = load(TOOL, "baseline")
        failures = [
            message
            for index, mutation in enumerate(MUTATIONS)
            if (message := try_mutation(index, mutation, source, baseline, rev))
        ]
    finally:
        os.chdir(home)
        shutil.rmtree(directory, ignore_errors=True)
    failures += enclosing()
    if failures:
        print("flattened-error-variants mutation harness FAILED:")
        for message in failures:
            print(f"  {message}")
        return 1
    print(
        f"flattened-error-variants mutations: {len(MUTATIONS)} defects reintroduced,"
        f" each moved a reading of its own and each was caught by the case that names it",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
