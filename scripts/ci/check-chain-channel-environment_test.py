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
  postgres-owner-chain-archive-linux-x86:
    name: rd owner archive
    env:
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
    steps:
      - uses: ./.github/actions/common-setup
        with:
          python-version: "3.13"
          rust-cache-enabled: ${{ runner.environment == 'github-hosted' && 'true' || 'false' }}
          rust-cache-shared-key: rd-owner-chain-archive-linux-x86
          rust-cache-workspaces: . -> target/rust-tests-linux-x86
          rust-cache-on-failure: "false"
          rust-cache-workspace-crates: "false"
          rust-cache-save-if: ${{ env.SAVE_BUILD_CACHES }}
      - run: make archive
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
  rd-owner-archive:
    env:
      CARGO_CI_PROFILE: ci-pr
      CARGO_TARGET_DIR: target/rust-tests-linux-x86
      RUST_TEST_EXTRA_FEATURES: capnp,hypersync
      RUST_BACKTRACE: 1
    steps:
      - uses: ./.github/actions/common-setup
        with:
          python-version: "3.13"
          rust-cache-enabled: "true"
          rust-cache-shared-key: rd-owner-chain-archive-linux-x86
          rust-cache-workspaces: . -> target/rust-tests-linux-x86
          rust-cache-on-failure: "false"
          rust-cache-workspace-crates: "false"
          rust-cache-save-if: "false"
      - run: make archive

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


def within(text: str, job_header: str, old: str, new: str) -> str:
    """
    Apply `mutate` inside one job's block only, so the same line in another job stays.
    """
    start = text.index(job_header)
    following = [text.find("\n  ", start + len(job_header))]
    end = following[0] if following[0] != -1 else len(text)
    while end != len(text) and text[end + 3] == " ":
        nxt = text.find("\n  ", end + 1)
        end = nxt if nxt != -1 else len(text)
    return text[:start] + mutate(text[start:end], old, new) + text[end:]


def main() -> int:
    failures = []

    agreeing = run(BUILD, CHAINS)
    if agreeing.returncode != 0:
        failures.append(f"agreeing pair was refused:\n{agreeing.stderr}")

    refused = {
        "owner-chain profile back to nextest": (
            BUILD,
            within(
                CHAINS,
                "  owner-chain:\n",
                "      CARGO_CI_PROFILE: ci-pr\n",
                "      CARGO_CI_PROFILE: nextest\n",
            ),
            "job `owner-chain` sets CARGO_CI_PROFILE='nextest'",
        ),
        "owner-chains archive job builds with nextest": (
            BUILD,
            within(
                CHAINS,
                "  rd-owner-archive:\n",
                "      CARGO_CI_PROFILE: ci-pr\n",
                "      CARGO_CI_PROFILE: nextest\n",
            ),
            "job `rd-owner-archive` sets CARGO_CI_PROFILE='nextest'",
        ),
        "venue leg profile back to nextest": (
            BUILD,
            within(
                CHAINS,
                "  venue-end-to-end:\n",
                "      CARGO_CI_PROFILE: ci-pr\n",
                "      CARGO_CI_PROFILE: nextest\n",
            ),
            "job `venue-end-to-end` sets CARGO_CI_PROFILE='nextest'",
        ),
        "owner-chain target directory moved off the cached one": (
            BUILD,
            within(
                CHAINS,
                "  owner-chain:\n",
                "      CARGO_TARGET_DIR: target/rust-tests-linux-x86\n",
                "      CARGO_TARGET_DIR: /tmp/elsewhere\n",
            ),
            "sets CARGO_TARGET_DIR='/tmp/elsewhere'",
        ),
        "owner-chain features differ": (
            BUILD,
            within(
                CHAINS,
                "  owner-chain:\n",
                "RUST_TEST_EXTRA_FEATURES: capnp,hypersync",
                "RUST_TEST_EXTRA_FEATURES: capnp",
            ),
            "sets RUST_TEST_EXTRA_FEATURES='capnp'",
        ),
        "owner-chain adds a Cargo variable build lacks": (
            BUILD,
            within(
                CHAINS,
                "  owner-chain:\n",
                "      RUST_BACKTRACE: 1\n",
                "      RUST_BACKTRACE: 1\n      CARGO_INCREMENTAL: 1\n",
            ),
            "sets CARGO_INCREMENTAL, which build.yml's chain job does not",
        ),
        "build's archive job builds with another profile": (
            within(
                BUILD,
                "  postgres-owner-chain-archive-linux-x86:\n",
                "&& 'ci-pr' || 'nextest' }}",
                "&& 'nextest' || 'nextest' }}",
            ),
            CHAINS,
            "build.yml job `postgres-owner-chain-archive-linux-x86` sets CARGO_CI_PROFILE='nextest'",
        ),
        "build's archive job restores rust tests's entry": (
            within(
                BUILD,
                "  postgres-owner-chain-archive-linux-x86:\n",
                "rust-cache-shared-key: rd-owner-chain-archive-linux-x86",
                "rust-cache-shared-key: rust-tests-linux-x86",
            ),
            CHAINS,
            "job `postgres-owner-chain-archive-linux-x86` restores `rust tests`'s cache entry",
        ),
        "owner-chains archive job saves from a test-chain push": (
            BUILD,
            within(
                CHAINS,
                "  rd-owner-archive:\n",
                'rust-cache-save-if: "false"',
                'rust-cache-save-if: "true"',
            ),
            "job `rd-owner-archive` sets rust-cache-save-if='\"true\"', expected '\"false\"'",
        ),
        "owner-chains archive job caches workspace crates too": (
            BUILD,
            within(
                CHAINS,
                "  rd-owner-archive:\n",
                'rust-cache-workspace-crates: "false"',
                'rust-cache-workspace-crates: "true"',
            ),
            "sets rust-cache-workspace-crates='\"true\"', expected '\"false\"'",
        ),
        "build's archive job drops the cache": (
            within(
                BUILD,
                "  postgres-owner-chain-archive-linux-x86:\n",
                "          rust-cache-enabled: ${{ runner.environment == 'github-hosted' && 'true' || 'false' }}\n",
                "",
            ),
            CHAINS,
            "sets rust-cache-enabled='unset'",
        ),
        "build's acceptance value changes and owner-chains does not follow": (
            within(
                BUILD,
                "  postgres-owner-chains-linux-x86:\n",
                "&& 'ci-pr' || 'nextest' }}",
                "&& 'nextest' || 'nextest' }}",
            ),
            CHAINS,
            "builds with 'nextest' on a pull request",
        ),
        "build's condition stops naming test-ci": (
            within(
                BUILD,
                "  postgres-owner-chains-linux-x86:\n",
                "|| github.ref_name == 'main' || github.ref_name == 'test-ci')\n        && 'ci-pr'",
                "|| github.ref_name == 'main')\n        && 'ci-pr'",
            ),
            CHAINS,
            "no longer takes its CARGO_CI_PROFILE branch on github.ref_name == 'test-ci'",
        ),
        "build's expression takes an unreadable form": (
            within(
                BUILD,
                "  postgres-owner-chains-linux-x86:\n",
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
