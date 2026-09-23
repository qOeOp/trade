# Agent implementation guide

This page bridges the target product architecture to the current VibeTrader engine. It preserves useful
developer knowledge without turning legacy prose, crate layout, examples, or reachable APIs into a second
source of product authority.

## Two documentation layers

The normative layer is the published `guide`, `architecture`, `owners`, and `scenarios` roots plus the canonical
architecture contract. It decides the writer, consumer, identity, accepted, rejected, unknown, and replay
behavior of a change.

The implementation-reference layer remains in the repository. It explains the current toolchain, APIs, engine
mechanics, test harnesses, extension points, and examples. These pages are not deleted, but they are not product
authority and are not automatically current merely because the files exist.

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

The canonical Owner contract wins when a reference conflicts with the new architecture. The current source and
repository checks win when a reference names an obsolete symbol or command. Neither source reachability nor an
old successful example proves the target contract is implemented.

Do not silently repair a stale page while implementing another chunk. Record the mismatch, keep the bounded
implementation stopped where it depends on that mismatch, and create a separate documentation correction when
Main admits it. This prevents an Agent from widening one task into an undocumented migration.

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

## Why the old guides stay outside product authority

Product users need stable Owner journeys rather than every engine API. Development Agents need both: the stable
contract that constrains the change and precise current implementation knowledge that makes the change feasible.
Keeping the layers explicit preserves the useful Developer Guide while preventing historical design or example
code from overriding R&D, Backtest, Qualification, Market Data, Risk, Execution, Recovery, or Observability
boundaries.
