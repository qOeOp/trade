#!/usr/bin/env python3
"""
Prove that `ci_called_files.py` follows invocations and not mentions.

`check-owner-custody-proof-selection.bash` once counted a proof as selected because a script listed
its name, and no CI job ran that script. Its caller now asks this helper which scripts CI runs, so
the helper has to tell the two apart in both directions: a script CI does run reads as called, and
one that is only named reads as not called. A helper that called everything reachable would pass
the first half and prove nothing.

"""

import importlib.util
import pathlib
import sys


HERE = pathlib.Path(__file__).resolve().parent
HELPER = HERE / "ci_called_files.py"

# Run by the Owner chains, the toolchain proofs and the Market Data chain, each through a Makefile
# target a workflow invokes, one of them only through `scripts/ci/owner-chain-matrix.py`.
CALLED = (
    "scripts/ci/test-rd-owner-postgres.bash",
    "scripts/ci/test-toolchain-proofs.bash",
    "crates/data/tests/run_market_data_owner_postgres.bash",
)

# Lists a proof by name and is run by hand only. If this ever reads as called, either a workflow
# started running it - worth noticing - or the helper stopped telling an invocation from a mention.
NAMED_ONLY = "scripts/ci/test-qualification-owner-recovery-postgres.bash"


def load() -> object:
    """
    Import the helper, whose file name is an identifier but not on the import path.
    """
    spec = importlib.util.spec_from_file_location("ci_called_files", HELPER)
    if spec is None or spec.loader is None:
        sys.exit(f"ERROR: cannot load {HELPER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    helper = load()
    failures = []

    files = {"scripts/ci/run.bash", "scripts/ci/named.bash"}
    targets = {"cargo-test-thing"}
    for text, python, expected in (
        ("bash scripts/ci/run.bash --flag\n", False, ({"scripts/ci/run.bash"}, set())),
        ("  run: scripts/ci/run.bash\n", False, ({"scripts/ci/run.bash"}, set())),
        (
            "  run: |\n    scripts/ci/run.bash --x\n",
            False,
            ({"scripts/ci/run.bash"}, set()),
        ),
        (
            'bash "${repo_root}/scripts/ci/run.bash"\n',
            False,
            ({"scripts/ci/run.bash"}, set()),
        ),
        ("  - scripts/ci/named.bash\n", False, (set(), set())),
        ("  scripts/ci/named.bash; do\n", False, (set(), set())),
        ("# bash scripts/ci/named.bash\n", False, (set(), set())),
        ('echo "see scripts/ci/named.bash"\n', False, (set(), set())),
        ("\t$(MAKE) cargo-test-thing X=1\n", False, (set(), {"cargo-test-thing"})),
        (
            'LEG = "cargo-test-thing NEXTEST_PROFILE=ci"\n',
            True,
            (set(), {"cargo-test-thing"}),
        ),
        ('LEG = "cargo-test-thing NEXTEST_PROFILE=ci"\n', False, (set(), set())),
    ):
        found = helper.invocations(text, python, files, targets)
        if found != expected:
            failures.append(
                f"{text!r} (python={python}) read as {found}, expected {expected}",
            )

    called = helper.ci_called_files()
    failures += [
        f"{path} is run by CI and reads as not called" for path in CALLED if path not in called
    ]
    if NAMED_ONLY in called:
        failures.append(f"{NAMED_ONLY} is only named, and reads as called")

    for failure in failures:
        print(f"ERROR: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(
        f"ok: {len(CALLED)} chain scripts read as called, and `{NAMED_ONLY}` does not",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
