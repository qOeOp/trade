# Contributing to Vibe Trading

This repository is an internal development base. Keep changes focused on product code,
builds, tests, runtime behavior, architecture, or migration work.

## Set up the workspace

Use the pinned Rust, Python, uv, and tool versions from `rust-toolchain.toml`,
`python/pyproject.toml`, `Cargo.lock`, `python/uv.lock`, and `tools.toml`.

```bash
cargo install cargo-binstall --locked
make install-tools
make build
```

The Rust workspace is under `crates/`; the Python package and tests are under `python/`.
See [the environment guide](docs/developer_guide/environment_setup.md) for platform details.

## Make a change

- Preserve the existing crate, module, and ownership boundaries.
- Add or update tests for changed behavior.
- Keep generated PyO3 stubs synchronized with their Rust owners.
- Use `vibe-*`, `vibe_*`, and `vibe_trading` consistently; do not add compatibility aliases.
- Keep package and repository metadata limited to facts consumed by current tooling.

Run the smallest affected checks while developing, then the applicable repository gates:

```bash
make cargo-test
make pytest
make format
make pre-commit
```

Use the [developer guide](docs/developer_guide/index.md) for coding, testing, adapter,
documentation, and FFI conventions.

## Merge your PR

Base every PR on `main`, never on another open PR's branch. GitHub's auto-merge resolves to
whatever branch the PR's base names at merge time, and stacking changes that whenever the base
PR merges first - an auto-merge queued against a stacked PR can land on the wrong parent once the
base PR disappears. If a change genuinely depends on another PR's content, wait for that PR to
merge to `main`, then branch from the new `main` tip; don't open the dependent PR until then.

Once your PR is green, queue it yourself:

```bash
gh pr merge <N> --auto --squash
```

`--squash` keeps `main`'s history one commit per PR, matching what `main-compile-check.yml` (below)
and the chain-report tooling both expect. `--auto` waits for the required check (`quality`) and
merges as soon as it passes - you don't need anyone else to click merge, and you don't need the
repository's own merge button for required checks `strict`: the ruleset only requires `quality` to
be green, not every job on `main`'s tip at merge time.

**A PR that needs another Owner's review waits for that review before auto-merge is enabled, not
after.** This covers a change to `crates/data` from outside Market Data, an H-series change needing
Lane 6's review, or a change to CI infrastructure - not every PR, just the ones whose correctness
depends on a reviewer who isn't the PR's own author. `quality` passing is necessary but not
sufficient there: CI can turn green before the review lands, and `--auto` does not know the
difference - it merges the instant the check passes, review or no review. Open the PR, get the
review, and only then run `gh pr merge --auto --squash`. Everything else - a PR scoped to one lane's
own crate, with no other Owner's correctness at stake - follows the plain flow above.

Every commit that lands on `main` - not just the tip, and not on any fixed schedule - gets a fast
`cargo check --workspace --all-targets` from `.github/workflows/main-compile-check.yml`. It is
queued, not cancelled, so a run behind an earlier one still completes and names its own commit (the
job name and its first step both print the commit SHA, subject, and author) once its turn comes.
This is separate from `build.yml`'s own scheduled full build/test verification of `main`'s tip, and
deliberately so: that schedule answers "is `main` good right now," while this answers "which commit
broke it," fast enough to matter.

**If `main-compile-check` goes red, fixing it is the next thing whoever's lane caused it does -
ahead of other work, including more of the same lane's own feature work.** A red main-compile-check
means some combination of green PR merges doesn't actually compile together; every PR branched from
that point inherits the breakage, and it compounds the longer it sits. Open the fix as its own PR,
based on the current `main` tip, following the same base-on-`main`/`--auto --squash` flow above.
