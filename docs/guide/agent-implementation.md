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

## Why the old guides stay outside product authority

Product users need stable Owner journeys rather than every engine API. Development Agents need both: the stable
contract that constrains the change and precise current implementation knowledge that makes the change feasible.
Keeping the layers explicit preserves the useful Developer Guide while preventing historical design or example
code from overriding R&D, Backtest, Qualification, Market Data, Risk, Execution, Recovery, or Observability
boundaries.
