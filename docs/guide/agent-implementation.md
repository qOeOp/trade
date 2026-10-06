# Agent implementation guide

This guide explains how to change the current engine under the product design. Use the [capability extension map](../architecture/capability-adoption/) to select a native integration point, then locate its contract and consumer below.
Source, examples and reachable APIs grant no product authority. Internal and direct MCP calls enforce the same admission, budget, protected-read and recovery checks.

## Two documentation layers

The normative layer is the published `guide`, `architecture`, `owners`, and `scenarios` roots plus the canonical
architecture contract. It decides the writer, consumer, identity, accepted, rejected, unknown, and replay
behavior of a change.

The implementation-reference layer remains in the repository. It explains the current toolchain, APIs, engine
mechanics, test harnesses, extension points, and examples. These pages are not deleted, but they are not product
authority and are not automatically current merely because the files exist.

## Research task entry map

First inspect this checkout's Nautilus APIs, extension points and native consumers. Reuse existing mechanisms; choose the smallest missing extension and update the design.
Ask the user only when existing stories leave intent unclear or measurements reveal a product tradeoff. Explain the available mechanism, gap and choice.
Verify native capability, current source and product wiring separately; newer official documentation does not prove this candidate is implemented.
Reuse must preserve Owner authority, frozen research protocols and protected boundaries.

Start with the [Research scenario](../scenarios/research/) and the exact current candidate. Select the earliest
missing transition, then read its producer, consumer, and boundary dependencies through this map.

| Bounded outcome                                                    | Owning design                                                                | Acceptance consumer                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Register a family and resume counted experiments within user scope | R&D Intent, census, data‑read lineage, spend cap; Product Edge authorization | Agent registers before outcome reads and resumes a trial by native identity                                 |
| Seal and load native R‑1u and R‑1s Strategies                      | R&D authoring; Strategy Factory shared lifecycle/order contract              | Real simulator exercises resting entries, expiry, protection, partial exits, fill feedback, and event order |
| Produce an asynchronous perpetual research report                  | Market Data custody; R&D run admission; Backtest Result                      | Native report includes funding, costs, portfolio risk/return, overlap, comparisons, and trade diagnostics   |
| Diagnose, park, stop, or review new evidence                       | R&D Iteration Decision and knowledge ledger                                  | Losing and unresolved trials remain visible; nonqualification does not close a mechanism                    |
| Qualify and maintain record‑only forward evidence                  | Qualification; Backtest shared replay semantics                              | Binary public verdict, protected internal detail, persistent simulated orders, and no trading effect        |
| Reproduce dynamic B3 and multi‑leg carry after R‑1                 | Strategy Factory dynamic universe; Market Data and Backtest                  | Continuous equity/state through membership changes; multi‑leg capital, funding, and margin                  |

This map does not claim implemented maturity or admit a Dashboard route. Verify the chosen producer and readback
at the current candidate; an old `CURRENT` label is not evidence. Each task names one user-visible outcome, one
Owner, the existing path it extends or replaces, and positive/refusal readbacks. Change disproved design details
with their measurements in the same delivery. Do not create a second registry, simulator, or task ledger to bridge
a missing native operation.

## Development workflow

1. Select one observable outcome from a user story. Identify its Owner, inputs, consumer and prohibited writes.
2. Verify native APIs, relevant source, `Makefile`, pre-commit and CI at the current candidate. Read only relevant implementation references.
3. Reuse Nautilus or existing infrastructure first. The Agent chooses the smallest integration; add an extension only when existing mechanisms cannot satisfy the story.
4. Verify results, refusals, unknown states and same-identity recovery through the real consumer. Choose checks for actual risks rather than generating the same test suite for every edit.
5. Update affected documentation in the same delivery. Preserve the exact candidate, executed commands, terminal results and capabilities still unproven.

When source and reference disagree, locate the gap in current source and change the design or implementation.
Do not copy obsolete APIs or treat missing evidence as a pass. Evidence must identify the actual candidate and inputs;
"checked" alone is insufficient. Agent work records and real checks carry these requirements without another JSON planning
package, per-field receipts or mandatory homepage diagram IDs. [Development chunks](./development-chunk-contract/)
provides a short scope check.

Implementation references grant no business-fact write authority, Market Data access, protected evidence access or
Paper/Live effect permission. Services still enforce authorization, input identity, isolation and actual consumption;
simplifying development cannot bypass those boundaries.

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

## Verification notes

- Search tracked source with `git grep` or explicitly scoped `rg -uu` so ignore rules do not hide workflows, migrations or tests.
- After CI reruns, read the latest result per check name at the exact PR head; an old green result is not current acceptance.
- Verify squash merges through the actual `mergeCommit` and file content, not ancestry of the original PR head.
- Check callable native APIs, deployed image features and actual consumers separately. A test-only helper does not prove a reachable service.
- Measure resources and latency on the actual task. A successful build does not prove the intended workload can run.
- Validate localized docs, diagrams and routes with current gates. Locate actual differences rather than locking blueprint wording with keyword tests.

## Capability checks and development entry

| Development outcome            | Inspect                                    | Evidence of availability                                    |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| Data reads and preparation     | Market Data, native catalog and DataClient | Exact readable bindings and named gaps                      |
| Native strategy custody        | R&D, Strategy package and loader           | Actual source closure and environment sealed and loaded     |
| Native replay and reports      | Backtest, native results and durable reads | Real service request executed with complete result readback |
| Research records and knowledge | R&D MCP/API                                | Exact project, experiment and references durably queryable  |
| UI and operation               | Dashboard, Governance and native node      | Owning route admission and actual consumer acceptance       |

Target design does not claim current implementation parity. Check exact source, wiring and consumers for each task;
close the earliest missing dependency without replacement engines. Integrate document changes into owning chapters
and direct links, without revision diaries or competing blueprints.
