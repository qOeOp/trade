#!/usr/bin/env python3
"""
Calibrate check-chain-channel-environment.py in both directions, on workflows it owns.

The fixtures are strings, not the real workflows, so a change to `build.yml` or `owner-chains.yml`
cannot move the calibration: the real files are what the check itself reads. Each mutation first
proves it changed the fixture, because a replacement that matched nothing leaves an agreeing pair
and the "refused" case would then fail for the wrong reason, or pass for none.

Run: python3 -B scripts/ci/check-chain-channel-environment_test.py

"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path


TOOL = Path(
    os.environ.get("CHECK_CHAIN_CHANNEL_ENVIRONMENT_TOOL")
    or Path(__file__).with_name("check-chain-channel-environment.py"),
)

BUILD = """\
name: build
jobs:
  postgres-owner-chains-linux-x86:
    name: ${{ matrix.chain.name }}
    env:
      # A comment line inside the block.
      CARGO_CI_PROFILE: >-
        ${{ (github.event_name == 'pull_request'
        || github.event_name == 'merge_group'
        || github.ref_name == 'main' || github.ref_name == 'test-ci')
        && 'ci-pr' || 'nextest' }}
      CARGO_TARGET_DIR: >-
        ${{ (github.event_name == 'pull_request'
        || github.event_name == 'merge_group'
        || github.ref_name == 'main' || github.ref_name == 'test-ci')
        && 'target/rust-tests-linux-x86'
        || '/home/runner/.cache/cargo-target/rust-tests-linux-x86' }}
      RUST_TEST_EXTRA_FEATURES: capnp,hypersync
      RUST_BACKTRACE: 1
      VIBE_TEST_DATA_BASE_URL: ${{ vars.VIBE_TEST_DATA_BASE_URL }}
    steps:
      - run: make chain
  quality:
    env:
      CARGO_CI_PROFILE: other
"""

CHAINS = """\
name: owner-chains
jobs:
  owner-chain:
    name: ${{ matrix.chain.name }}
    env:
      CARGO_CI_PROFILE: ci-pr
      CARGO_TARGET_DIR: target/rust-tests-linux-x86
      RUST_TEST_EXTRA_FEATURES: capnp,hypersync
      RUST_BACKTRACE: 1
      VIBE_TEST_DATA_BASE_URL: something else entirely
    steps:
      - run: make chain

  venue-end-to-end:
    env:
      CARGO_CI_PROFILE: ci-pr
      CARGO_TARGET_DIR: target/rust-tests-linux-x86
      RUST_BACKTRACE: 1
    steps:
      - run: make venue
"""


def run(build: str, chains: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as root:
        workflows = Path(root) / ".github/workflows"
        workflows.mkdir(parents=True)
        (workflows / "build.yml").write_text(build)
        (workflows / "owner-chains.yml").write_text(chains)
        return subprocess.run(
            [sys.executable, "-B", str(TOOL), root],
            capture_output=True,
            text=True,
            check=False,
        )


def mutate(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise SystemExit(
            f"FAIL: mutation target {old!r} occurs {text.count(old)} times, expected once",
        )
    return text.replace(old, new)


def main() -> int:
    failures = []

    agreeing = run(BUILD, CHAINS)
    if agreeing.returncode != 0:
        failures.append(f"agreeing pair was refused:\n{agreeing.stderr}")

    refused = {
        "owner-chain profile back to nextest": (
            BUILD,
            mutate(
                CHAINS,
                "      CARGO_CI_PROFILE: ci-pr\n      CARGO_TARGET_DIR: target/rust-tests-linux-x86\n      RUST_TEST",
                "      CARGO_CI_PROFILE: nextest\n      CARGO_TARGET_DIR: target/rust-tests-linux-x86\n      RUST_TEST",
            ),
            "job `owner-chain` sets CARGO_CI_PROFILE='nextest'",
        ),
        "venue leg profile back to nextest": (
            BUILD,
            mutate(
                CHAINS,
                "    env:\n      CARGO_CI_PROFILE: ci-pr\n      CARGO_TARGET_DIR: target/rust-tests-linux-x86\n      RUST_BACKTRACE",
                "    env:\n      CARGO_CI_PROFILE: nextest\n      CARGO_TARGET_DIR: target/rust-tests-linux-x86\n      RUST_BACKTRACE",
            ),
            "job `venue-end-to-end` sets CARGO_CI_PROFILE='nextest'",
        ),
        "owner-chain target directory moved off the cached one": (
            BUILD,
            mutate(
                CHAINS,
                "ci-pr\n      CARGO_TARGET_DIR: target/rust-tests-linux-x86\n      RUST_TEST",
                "ci-pr\n      CARGO_TARGET_DIR: /tmp/elsewhere\n      RUST_TEST",
            ),
            "sets CARGO_TARGET_DIR='/tmp/elsewhere'",
        ),
        "owner-chain features differ": (
            BUILD,
            mutate(
                CHAINS,
                "RUST_TEST_EXTRA_FEATURES: capnp,hypersync",
                "RUST_TEST_EXTRA_FEATURES: capnp",
            ),
            "sets RUST_TEST_EXTRA_FEATURES='capnp'",
        ),
        "owner-chain adds a Cargo variable build lacks": (
            BUILD,
            mutate(
                CHAINS,
                "      RUST_BACKTRACE: 1\n      VIBE",
                "      RUST_BACKTRACE: 1\n      CARGO_INCREMENTAL: 1\n      VIBE",
            ),
            "sets CARGO_INCREMENTAL, which build.yml's chain job does not",
        ),
        "build's acceptance value changes and owner-chains does not follow": (
            mutate(BUILD, "&& 'ci-pr' || 'nextest' }}", "&& 'nextest' || 'nextest' }}"),
            CHAINS,
            "builds with 'nextest' on a pull request",
        ),
        "build's condition stops naming test-ci": (
            mutate(
                BUILD,
                "|| github.ref_name == 'main' || github.ref_name == 'test-ci')\n        && 'ci-pr'",
                "|| github.ref_name == 'main')\n        && 'ci-pr'",
            ),
            CHAINS,
            "no longer takes its CARGO_CI_PROFILE branch on github.ref_name == 'test-ci'",
        ),
        "build's expression takes an unreadable form": (
            mutate(
                BUILD,
                "&& 'ci-pr' || 'nextest' }}",
                "&& format('{0}', 'ci-pr') || 'nextest' }}",
            ),
            CHAINS,
            "spells CARGO_CI_PROFILE as an expression this check cannot read",
        ),
    }
    for name, (build, chains, expected) in refused.items():
        result = run(build, chains)
        if result.returncode == 0 or expected not in result.stderr:
            failures.append(
                f"{name}: expected a refusal naming {expected!r}, got exit {result.returncode}:\n{result.stderr}",
            )

    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(
        f"check-chain-channel-environment: 1 agreeing pair accepted, {len(refused)} mutations refused by name.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
