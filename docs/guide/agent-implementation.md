# Agent implementation guide

This page bridges the target product architecture to the current VibeTrading engine. It preserves useful
developer knowledge without turning legacy prose, crate layout, examples, or reachable APIs into a second
source of product authority.

The user-confirmed product foundation is native Nautilus data/backtest services extended in place and exposed
through separate MCPs, plus a custom R&D service. Owner labels define internal fact and permission boundaries;
they are not instructions to build replacement engines. R&D internal calls and direct MCP calls use identical
admission, budget, protected-read and recovery checks. Follow the [capability extension map](../architecture/capability-adoption/).

## Two documentation layers

The normative layer is the published `guide`, `architecture`, `owners`, and `scenarios` roots plus the canonical
architecture contract. It decides the writer, consumer, identity, accepted, rejected, unknown, and replay
behavior of a change.

The implementation-reference layer remains in the repository. It explains the current toolchain, APIs, engine
mechanics, test harnesses, extension points, and examples. These pages are not deleted, but they are not product
authority and are not automatically current merely because the files exist.

## Research task entry map

The implementation contract requires filtering design questions first: inspect Nautilus mechanisms retained in
the current repository, native extension points and official documentation; adopt mature existing mechanisms
rather than turn standard engine behavior into user choices or strategy parameters. Ask only when user intent
cannot be established from existing stories or measurements show a native capability gap; explain the available
mechanism, exact gap and user-relevant tradeoff. Verify framework capability, current-version code and product
consumer wiring separately. Newer official docs do not prove this candidate is implemented. Reuse preserves Owner
authority, frozen research protocols and protected boundaries.

Start with the [Research scenario](../scenarios/research/) and the exact current candidate. Select the earliest
missing transition, then read its producer, consumer, and boundary dependencies through this map.

| Bounded outcome                                                    | Owning design                                                                | Acceptance consumer                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Register a family and resume counted experiments within user scope | R&D Intent, census, data‑read lineage, spend cap; Product Edge authorization | Agent registers before outcome reads and resumes a trial by native identity                                 |
| Compile R‑1u and R‑1s JSON into immutable artifacts                | R&D authoring; Strategy Factory shared lifecycle/order contract              | Real simulator exercises resting entries, expiry, protection, partial exits, fill feedback, and event order |
| Produce an asynchronous perpetual research report                  | Market Data custody; R&D run admission; Backtest Result                      | Native report includes funding, costs, portfolio risk/return, overlap, comparisons, and trade diagnostics   |
| Diagnose, park, stop, or review new evidence                       | R&D Iteration Decision and knowledge ledger                                  | Losing and unresolved trials remain visible; nonqualification does not close a mechanism                    |
| Qualify and maintain record‑only forward evidence                  | Qualification; Backtest shared replay semantics                              | Binary public verdict, protected internal detail, persistent simulated orders, and no trading effect        |
| Reproduce dynamic B3 and multi‑leg carry after R‑1                 | Strategy Factory dynamic universe; Market Data and Backtest                  | Continuous equity/state through membership changes; multi‑leg capital, funding, and margin                  |

This map does not claim implemented maturity or admit a Dashboard route. Verify the chosen producer and readback
at the current candidate; an old `CURRENT` label is not evidence. Each task names one user-visible outcome, one
Owner, the existing path it extends or replaces, and positive/refusal readbacks. Change disproved design details
with their measurements in the same delivery. Do not create a second registry, simulator, or task ledger to bridge
a missing native operation.

## Required Agent workflow

1. Select and validate one [Development Chunk Contract](./development-chunk-contract/).
2. Resolve the relevant source capability and destination Owner in [Capability Adoption](../architecture/capability-adoption/).
3. Inspect the current source, `Makefile`, pre-commit configuration, and CI workflow at the exact candidate revision.
4. Open only the implementation references relevant to that bounded chunk and verify every named path, symbol,
   command, and prerequisite against the same revision.
5. Classify a verified page as `CURRENT_IMPLEMENTATION_REFERENCE` for that chunk. Classify a mismatched or
   superseded page as `LEGACY_REFERENCE` and do not copy its command, writer, topology, or API assumption.
6. Record every source locator in the chunk `evidence-receipt.implementationReferenceBindings` list. The list is
   required and non-empty even when the bounded chunk uses only one reference.
7. Freeze one exact `evidence-receipt.candidateRevision`. Every binding repeats that exact revision. Missing,
   conflicting, stale, or differently versioned evidence stops implementation and returns to Main for replanning.

Each locator uses one exact classification branch:

- `CURRENT_IMPLEMENTATION_REFERENCE` requires `VERIFIED_AT_CANDIDATE_REVISION`, a typed immutable
  `verificationReceipt`, exact revision equality with the receipt, and a JSON `null` `mismatchDisposition`.
- `LEGACY_REFERENCE` requires `MISMATCHED_OR_SUPERSEDED`, the same typed immutable receipt, exact revision equality
  with the receipt, and the terminal `DO_NOT_USE_AND_REPLAN` disposition.

Free-text claims such as "checked" are not evidence. The typed receipt repeats the resolved candidate revision,
binds the exact normalized repository-relative locator to a Git blob and SHA-256 content identity, and contains
exactly one result for each of `PATHS`, `SYMBOLS`, `COMMANDS`, and `PREREQUISITES`. Its locator identity has the
strict form `tree-path:<locator>@git-blob:<40 lowercase hex>@content-sha256:<64 lowercase hex>`, and
`contentSha256` repeats the same digest as `sha256:<64 lowercase hex>`.

The record is not self-proving. Main must separately supply the immutable 40-hex Git tree and a per-locator
verification-context digest. The public validator verifies that the object exists as a tree, resolves the exact
path with `git ls-tree`, reads the blob with `git cat-file`, recomputes both the Git blob ID and SHA-256 from the
actual bytes, and compares every identity with the typed receipt. A well-formed self-consistent record with no
resolver, the wrong or stale tree, an absent locator, fabricated IDs, or different bytes is invalid.

Each check is either `PASS`, with concrete evidence and a null basis, or `NOT_APPLICABLE_WITH_BASIS`, with null
evidence and a concrete basis. Missing, duplicated, unknown, reordered, or extra check kinds fail closed. Both
CURRENT and LEGACY entries require the same immutable Git resolution and externally supplied context digest.
There is no unresolved LEGACY exception: an unavailable or deleted locator is invalid and returns to Main.
LEGACY means the resolved content must not be used.

Unknown classifications, an empty list, duplicate locators, partial entries, malformed identities or digests,
revision/content/locator mutation, or extra entry fields are invalid.
`LEGACY_REFERENCE` is never a degraded execution path: the Agent must not use the locator and must return to Main.

An implementation reference may explain how to call or extend the engine. It cannot create an Owner, change a
business-fact writer, bypass Market Data or effect admission, expose protected Qualification detail, authorize
Paper or Live effects, or replace the chunk's accepted, rejected, unknown, and replay semantics.

## Reference map

| Development need                 | Repository implementation references                                                                                         | Required interpretation                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Environment and toolchain        | `docs/developer_guide/environment_setup.md`                                                                                  | Verify commands against the current project pin, `Makefile`, and CI before use.                      |
| Rust, Python, and FFI boundaries | `docs/developer_guide/rust.md`, `docs/developer_guide/python.md`, `docs/developer_guide/ffi.md`                              | Reuse language and memory‑safety guidance without moving Owner authority across bindings.            |
| Adapter implementation           | `docs/developer_guide/adapters.md`, `docs/developer_guide/spec_data_testing.md`, `docs/developer_guide/spec_exec_testing.md` | Split Market Data and Execution ports; a provider crate never gains product authority.               |
| Testing and datasets             | `docs/developer_guide/testing.md`, `docs/developer_guide/test_datasets.md`                                                   | Use current harnesses and fixtures as evidence, never as production capability or economic proof.    |
| Performance work                 | `docs/developer_guide/benchmarking.md`                                                                                       | Preserve the selected contract while measuring a bounded implementation seam.                        |
| Extensions and plugins           | `docs/developer_guide/plugins.md`                                                                                            | Treat reachability as infrastructure; every business effect still passes through its Owner contract. |
| Documentation work               | `docs/developer_guide/docs.md`, `docs/developer_guide/markdown_style.md`                                                     | Follow current repository gates while keeping the canonical projection single‑sourced.               |
| Engine semantics                 | `docs/concepts/` and crate `README.md` files                                                                                 | Use as explanations of current mechanics, then confirm the exact source symbols and behavior.        |
| Task examples                    | `docs/how_to/`, `docs/getting_started/`, and `examples/`                                                                     | Treat examples as reference inputs, not architecture, production admission, or Live authority.       |

## Conflict and staleness rules

Read the documented Owner contract as the current design, then test it against the real consumer and current
source. A reference naming an obsolete symbol or command is stale; reachable source or an old successful example
does not prove the target product path. A design that cannot satisfy the requested story is changed explicitly,
with the observation that forced that change, rather than treated as a final blueprint.

Main may correct in-scope stale design and implementation in the same reviewable delivery. Record the mismatch,
replan the dependent slice, and verify the resulting contract; a separate documentation-only PR is not required.
The user-authorization boundaries in `AGENTS.md` still apply to a purpose or route change, production effects, and
removing a refusal, seal, bound, or invariant. Preserve unrelated work.

## Instruments that read wrong in this repository

Each entry below is a measurement taken against this repository, with what the tool returns and what
answers the same question instead. They are recorded because each cost a wrong conclusion once, and
because a wrong reading here lands inside the legal range of the answer rather than as an error.

- **`grep` in an agent shell resolves to ugrep.** A three-branch ERE alternation
  (`grep -rl "a\|b\|c"`) returned zero files across the whole crate tree, where the same three words
  searched one at a time returned 46, 17 and 13. A pattern beginning `^+++` is a syntax error there,
  because `+` is a quantifier. Searching one term per invocation, or using `rg` or a small script,
  answers it. A zero from an alternation is worth a second engine before it is worth believing.
- **`repos/O/R/commits/<sha>/check-runs` returns the checks of every run on that commit**, not the
  newest. After a re-run, the earlier run's failures are still in the list, while the merge state
  that GitHub itself computes uses the latest run per check name. Grouping by `.name` and taking the
  last by `.started_at` gives the same view the merge button uses.
- **A pull request head commit is never an ancestor of `main` after a squash merge.** Asking
  `git merge-base --is-ancestor <pr-head> <tree>` therefore answers "not contained" for every
  squash-merged change, including trees that do contain it, so it cannot separate the two cases. The
  commit that does land is `gh pr view <n> --json mergeCommit`. A check for a string the change
  introduced - `git show <tree>:<file> | grep -q <marker>` - needs no commit identity at all and
  survives rebase and cherry-pick.
- **This repository squashes with `squash_merge_commit_message: COMMIT_MESSAGES`.** The pull request
  body never reaches `main`; the commit messages do. Editing a description after review leaves the
  original claim in the branch, and `gh pr merge --squash --body-file` replaces the message at merge
  time without a force push.
- **`sysctl vm.swapusage` reports used swap that does not fall** when memory pressure is relieved on
  macOS: pages already written out are not reclaimed, so the figure stays near its peak on a machine
  that is no longer under pressure. `vm_stat`'s free page count moves with the actual state.
- **`rg` does not see 179 of this repository's 6145 tracked files, for two independent reasons.**
  Ninety-nine sit under a dotted path, which ripgrep skips by default: all 21 of
  `.github/workflows`, nine of `.github/actions`, five of `.docker`. Seventy-nine are excluded by
  `.gitignore` while still being tracked, which ripgrep also skips: 28 under `scripts/ci`, the
  `postgres-init` scripts holding every `CREATE TABLE`, migration and `GRANT`, and about 45 test
  fixtures. One file needs both switches. Searching one string that appears twice shows why a
  single switch is not the fix:

  ```text
  rg -l <pattern> .              0    both reasons hide both hits
  rg -l <pattern> .github/       1    naming a dotted path defeats the first reason
  rg -l --hidden <pattern> .     1    defeats the first, not the second
  rg -l --no-ignore <pattern> .  1    defeats the second, not the first
  rg -l -uu <pattern> .          2
  git grep -l <pattern>          2
  ```

  `git check-ignore` predicts only the second reason, and not even reliably: an ignore rule does
  not apply to a tracked file, so git correctly answers "not ignored" while ripgrep filters its
  walk by the ignore text without consulting tracked state. `git grep` and `rg -uu` answer the
  question; `rg --files <dir> | wc -l` says whether a zero was searched for. A negative claim from
  a walk is worth recording with the command that produced it, the way a count is worth recording
  with its revision - and a claim that no workflow, CI script or migration mentions something is
  worth re-running, because those three are exactly what a default walk cannot read.

- **`\b` and `\s` in an `-E` pattern work on Linux and match nothing on macOS**, and the direction
  is what makes it dangerous. They are GNU extensions, not POSIX ERE: glibc's matcher accepts them,
  BSD's ignores them and reports no match rather than an error. The same file tree, the same
  command, on git 2.54.0 under Linux and git 2.55.0 on macOS 26.6:

  ```text
  pattern                    Linux   macOS
  \bBindingDigest\b            1       0
  \s                           1       0
  [[:space:]]                  1       1
  ```

  **So a pattern written and checked on Linux or in CI comes back empty on a developer's machine,
  while one written on macOS fails loudly enough to be caught.** The broken side is the side that
  was already verified, and CI being green proves nothing about the same pattern locally. The
  partial case is worse than the total one: on macOS `git grep -cE '^\s*pub fn'` returns 540 files
  and `'^[[:space:]]*pub fn'` returns 1503, so
  **the broken pattern returns a number large enough to look like an answer**.
  Write `[[:space:]]`, `[[:alnum:]]` and an explicit `(^|[^A-Za-z0-9_])`, which both matchers read,
  or pass `-P`. The macOS column above and the two 540/1503 counts are measured on this machine;
  the Linux column is a second lane's measurement inside a container, on a tree built for the
  comparison.

- **`scripts/ci/test-rd-owner-postgres.bash` exits 1 on a non-Linux host.** A local ordered-chain run
  is therefore a modified copy, and which modification was made decides what the run means: changing
  the comparison keeps the container, the databases, the role grants and every earlier entry, while
  invoking the test binary directly skips all of them. A failure from the second is not a failure of
  the entry.
- **`cargo`'s `--message-format` decides how many dead items the same run can report, and two of the
  three formats undercount without saying so.** `--message-format=short` folds every dead member of
  one implementation into a single `multiple associated items are never used` line, anchored at the
  first member and carrying no member names; the rendered default prints one `-->` per diagnostic,
  not per member, so counting `-->` lines also counts diagnostics. Only `--message-format=json`
  reports each folded member as its own primary span. One `cargo check -p vibe-data --lib` at
  `3560a3aa1` answers 387 or 623 for `crates/data/src` depending on which is counted, because 68 of
  its diagnostics carry more than one primary span. Count by deduplicating primary spans from the
  JSON output; to ask whether one item is in the set, search for its name instead of comparing
  counts.
- **`--all-targets` enables a feature that no command line mentions.** `crates/qualification` and
  `crates/backtest_owner` take `sealed-strategy-input-acceptance` in `[dev-dependencies]`, so
  `cargo check --workspace` leaves it off while `cargo clippy --workspace --all-targets` turns it
  on. The common "dead in the first, alive in the second" diff therefore moves two variables at once
  and cannot separate a `cfg(test)` caller from a caller inside a feature-gated module. Enabling the
  feature in its own build, holding the target set fixed, separates them: on the Market Data set
  that turned "six of ninety-two sit behind a non-default feature" into "all 163 do, and none has a
  `cfg(test)` caller".
- **A `#[allow(dead_code)]` whose comment names the condition that would retire it keeps silencing
  the lint after that condition is met.** Seven of this repository's suppressions had outlived their
  stated reason when they were measured, and nothing had failed, because the suppression is the
  instrument that would have reported it. `#[expect(dead_code)]` is the same note with an expiry: it
  fails the build once the item stops being dead. It fits only where the item is dead in every
  target configuration, though - converting three that tests use produced three unfulfilled
  expectations and five errors under `--all-targets` while `cargo check` stayed green, which is
  exactly where a test is the only caller.

## Capability maturity and development entry

| Capability           | Current scope                                                                                                               | Task entry                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Domain MCPs          | Data, strategy authoring and backtest have independent workspaces; research MCP remains a target                            | Product Edge service contracts and corresponding `services` source    |
| JSON authoring       | Bounded T0 subset exists; full R‑1 orders, conditional cancel and staged exits require extension                            | R&D authoring and Strategy Factory typed BFP                          |
| Native replay        | Input custody, execution service and Result identity branches exist; feature/wiring determines reachability                 | Backtest and R&D run composition                                      |
| Reports              | Current run report route still returns `RUN_HAS_NO_RESULT`                                                                  | Durable Result to served report, never operational logs               |
| Multi‑timeframe data | Native series and PIT custody have defined integration; served series do not imply execution admission                      | Market Data; execution whitelist `1w/1d/4h/1h`                        |
| Complex strategies   | Direct BFP Host, independent trades, portfolios, dynamic universe, staged protection and local refinement have dependencies | Owning chapter prerequisites and positive/failure acceptance          |
| UI                   | Custom Dashboard preview admits individual routes/atoms                                                                     | Exact Dashboard contract, not implicit wider implementation           |
| Trading node         | Native node/trust layer is a target; Paper/Live not admitted                                                                | Architecture rules and unique Runtime/Risk/Execution responsibilities |

Verify status against exact source, wiring and consumer results. A merged fragment, target or open PR is not a
complete feature. Deliver the earliest missing dependency: data coverage → request/authoring → native execution →
Result/report → research decision. Do not invert dependencies or create replacement engines. Integrate document
changes into their owning body and direct links, retaining no revision diary or competing blueprint.
