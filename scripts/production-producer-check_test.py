#!/usr/bin/env python3
r"""
Calibrate production-producer-check.py against the repository, in both directions.

Every assertion here has a counterpart that must answer the other way. A search that
silently matches nothing produces the same clean zero as a real absence, so a case that
only ever answers "none" proves nothing about the answer "none"; the paired case is what
makes the zero mean something.

Each pair also names the defect it pins, all of which were observed producing quiet zeros:
POSIX ERE has no `\\b` or `\\s`; the nearest attribute above a line often belongs to the
item before it; a `mod x;` in the parent file gates a child file that says nothing itself;
and an item whose signature spans lines opens its block further down.

Run: python3 -B scripts/production-producer-check_test.py

"""

import importlib.util
import re
import subprocess
import sys
from pathlib import Path


TOOL = Path(__file__).with_name("production-producer-check.py")

spec = importlib.util.spec_from_file_location("production_producer_check", TOOL)
ppc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ppc)

REV = ppc.resolve("HEAD")

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


def definition_gates(name):
    """
    Return the cfg gates governing where `name` is defined.

    Located by symbol rather than by line, because a line number is only valid for the
    tree it was read from.

    """
    out = subprocess.run(
        [
            ppc.shutil.which("git") or "git",
            "grep",
            "-nE",
            rf"(^|{ppc.NOT_WORD})fn {name}{ppc.SPACE}*[(<]",
            REV,
            "--",
            "*.rs",
        ],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.splitlines()
    sites = []
    for line in out:
        match = re.match(r"^[0-9a-f]+:([^:]+):(\d+):", line)
        if match:
            sites.append(ppc.gates(REV, match.group(1), int(match.group(2))))
    return sites


def producers(name):
    sites = ppc.producer_sites(REV, name)
    ungated = [s for s in sites if not ppc.gates(REV, s[0], s[1])]
    return len(sites), len(ungated)


def main():
    # The instrument reaches the tree at all. Without this, everything below can pass
    # by finding nothing anywhere.
    check(bool(REV), "HEAD does not resolve; the checks below would all read an empty tree")
    check(ppc.bare_name_files(REV, "StrategyPlanV2") > 0, "bare-name search reaches no file")

    # Producers, both directions. Left: every producer is behind a gate. Right: most are
    # not. A pattern broken by `\b` or `\s` gives zero for both.
    gated_total, gated_ungated = producers("SourceIntakeRetrievalTimeEvidenceV1")
    open_total, open_ungated = producers("StrategyPlanV2")
    check(gated_total > 0, "SourceIntakeRetrievalTimeEvidenceV1: no producer sites found at all")
    check(
        gated_ungated == 0,
        f"SourceIntakeRetrievalTimeEvidenceV1: {gated_ungated} ungated producers, expected 0",
    )
    check(open_total > 0, "StrategyPlanV2: no producer sites found at all")
    check(
        open_ungated > 0,
        "StrategyPlanV2: 0 ungated producers, so the ungated branch never fired",
    )

    # Callers, both directions. Left: a public, ungated writer nothing in production calls.
    # Right: an ordinary production function with production callers.
    silent, silent_other = ppc.classify_callers(
        REV,
        "commit_source_intake_success_terminal_in_transaction",
    )
    loud, _ = ppc.classify_callers(REV, "admit_market_data_universe_program_event_v2")
    check(
        len(silent_other) > 0,
        "commit_source_intake_success_terminal_in_transaction: no callers found at all",
    )
    check(
        len(silent) == 0,
        f"commit_source_intake_success_terminal_in_transaction: {len(silent)} production callers, expected 0",
    )
    check(
        len(loud) > 0,
        "admit_market_data_universe_program_event_v2: 0 production callers, so that branch never fired",
    )

    # A value produced by decoding into an annotated binding, against one that has no such
    # site. A type whose only production producer is a decode looks producerless to a search
    # that only knows struct literals, associated functions and return types.
    decoded_total, decoded_ungated = producers("SourceIntakeResearchAncestryProposalV1")
    check(
        decoded_total > 0,
        "SourceIntakeResearchAncestryProposalV1: no producer sites found at all",
    )
    check(
        decoded_ungated > 0,
        "a type produced only by an ungated decode was read as having no ungated producer",
    )

    # A `mod x;` gated in the parent file. Nothing inside sealed_acceptance.rs says it is
    # gated; reading the file alone answers "ungated" for every item in it.
    sealed_total, sealed_ungated = producers("SealedAcceptanceProtectedEvaluationSharedTimeV1")
    check(
        sealed_total > 0,
        "SealedAcceptanceProtectedEvaluationSharedTimeV1: no producer sites found at all",
    )
    check(sealed_ungated == 0, "a file gated by its parent's `mod` declaration was read as ungated")

    # A symbol declared once and mentioned nowhere else. Its zero callers must not be
    # reported as a broken search, and the probe must be seen to walk the whole way
    # rather than return early - which is the other way a zero arises.
    lonely = "issue_native_replay_execution_input_binding_v2_in_transaction"
    lonely_declarations, lonely_mentions = ppc.occurrences(REV, lonely)
    busy_declarations, busy_mentions = ppc.occurrences(
        REV,
        "admit_market_data_universe_program_event_v2",
    )
    check(lonely_declarations > 0, f"{lonely}: not declared anywhere, so the case below is vacuous")
    check(
        lonely_mentions == 0,
        f"{lonely}: {lonely_mentions} mentions outside its declaration, expected 0",
    )
    check(
        busy_mentions > 0,
        "admit_market_data_universe_program_event_v2: 0 mentions, so that branch never fired",
    )
    check(
        busy_declarations > 0,
        "admit_market_data_universe_program_event_v2: not declared anywhere",
    )
    check(
        not any(g for g in definition_gates(lonely)),
        f"{lonely}: read as gated; it is ungated, which is what makes it a zero worth reading",
    )

    # A name declared once, against a name declared many times. Callers are matched by
    # name, so a count for an ambiguous name belongs to every declaration at once; the
    # tool has to say so, and it can only say so if it counts declarations correctly.
    unique_declarations, _ = ppc.occurrences(
        REV,
        "commit_source_intake_success_terminal_in_transaction",
    )
    common_declarations, _ = ppc.occurrences(REV, "new")
    check(
        unique_declarations == 1,
        f"commit_source_intake_success_terminal_in_transaction: {unique_declarations} declarations, expected 1",
    )
    check(
        common_declarations > 1,
        "new: not seen as declared more than once, so the ambiguity warning never fires",
    )

    # An attribute directly above an item belongs to that item, and an attribute a few
    # lines above usually belongs to the item before it. Both must be distinguished.
    inner = definition_gates("for_verified_test")
    outer = definition_gates("compile_from_owner_source_resolution")
    check(
        inner and all(g for g in inner),
        "for_verified_test: its own #[cfg(test)] was not attributed to it",
    )
    check(
        outer and not any(g for g in outer),
        "compile_from_owner_source_resolution: it inherited the previous item's #[cfg(test)]",
    )

    if failures:
        print("production-producer-check calibration FAILED:")
        for message in failures:
            print(f"  {message}")
        print(
            "\nThree things produce a failure here, and they are worth telling apart by"
            "\nrunning the tool on the named symbol and reading the sites it prints:"
            "\n  the repository really changed - update the expectation, and read the change;"
            "\n  the tool's search regressed - the sites will be missing or wrong;"
            "\n  the tool met an input shape it had never met - the sites will look right and"
            "\n  the count will not. The last one is why these cases are paired: a case that"
            "\n  has only ever seen one shape cannot be wrong about the other.",
        )
        return 1
    print(
        f"production-producer-check calibration passed at {REV[:9]}: 21 checks, both directions exercised",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
