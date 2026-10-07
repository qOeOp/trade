# Scanner

## Product responsibility

The product has no independent Scanner service, periodic proposal route or Scanner ledger. Ordinary discovery queries Market Data; path-dependent signals use frozen native Backtest, with task/conclusion references retained by [R&D](./rd.md#on-demand-read-only-opportunity-discovery) when needed. Governance consumes eligibility, accounts and frozen conditions for queues, promotion, exit and protection of real positions.

Old `ScannerConditional` still returns `ConditionalScannerNotAdmitted`. Removing the target department cannot silently make it unconditional. Condition migration remains versioned and preserves eligibility, authorization, capital, recovery and real-effect boundaries.

## Sealed compatibility contract

`crates/scanner` retains a deterministic core and `TerminalReceiptStore` / `ProductEdgeTerminalReceiptReader` ports, with tests proving local fail-closed behavior. Its only external use is a type import in `crates/testkit/tests/f1_current_workspace.rs`. There is no scheduler, production admission constructor, Loader/MarketSnapshot/Capacity input, database role/schema, durable receipt or Governance/Product Edge consumer. This page admits no new scheduling, proposals, reconstruction reader or storage.

### Old identities and records

- Schedule Definition version, exact scan-scope identity/version and canonical unambiguous due-slot boundary uniquely derive AttemptId/ScheduledScanId. Clock epoch is outside identity; duplicates, concurrency, restart and late delivery join the original attempt. Cadence/calendar/time-zone/fold/gap/misfire/backfill changes create a successor definition. Missing continuity or conflicting scope/slot evidence creates no attempt; wall-clock retry cannot invent a slot.
- Member dispositions are only MATCHED / NO_MATCH / INSUFFICIENT_DATA / INPUT_UNAVAILABLE / CONDITION_FAILED, binding ArtifactRef, condition version and consumed facts. FAILED is not a member state. Unresolved source membership cannot invent expected/missing sets or use earlier/partial frontiers.
- Each attempt has one terminal PROPOSED / NO_MATCH / INSUFFICIENT_DATA / COMPLETED_NO_PROPOSAL / FAILED. Precedence is independently proven batch FAILED, complete PROPOSED, complete COMPLETED_NO_PROPOSAL, INSUFFICIENT_DATA, NO_MATCH. No match with a local CONDITION_FAILED means COMPLETED_NO_PROPOSAL. Other members' negative facts remain.
- PROPOSED requires a complete matching set. FAILED is only INCOMPLETE_FAILED or independently evidenced BATCH_OPERATIONAL_FAILED, retaining SCHEDULER_ORCHESTRATION_FAILURE / SCANNER_SERVICE_FAILURE / SHARED_DEPENDENCY_OPERATIONAL_FAILURE, failure identity, source cut and Time Evidence. Failed branches never contain proposals.
- Complete expected/observed sets match. Known incomplete sets retain missing = expected − observed; unresolved sets retain authoritative unresolved disposition, observed facts and missing-members-unavailable, never rendered empty or complete.

### Old readers and refusals

A read returns exactly one terminal for the requested identity. Missing receipt, wrong-attempt, semantic-conflict and store-unavailable refuse separately; the middle two are custody faults, not unknown state. Terminal reread never reruns current clock admission. It validates only retained source/frontier/scope/requirements, market/capacity cross-cuts, due boundary and identical clock epoch/Time Evidence across facts in that slot, without inventing absent counterpart evidence.

Only AVAILABLE input matching PIT/Universe Selection/Instrument Master/calendar/session/time-zone/corporate-action/membership/semantics can MATCHED. INSUFFICIENT becomes member INSUFFICIENT_DATA; other negative states or absence become INPUT_UNAVAILABLE. Do not fill gaps, replace neighboring cuts or interpret a negative state as absence of adverse facts. Capacity is required only by the frozen condition, with matching Capacity Scope, account/valuation/liquidity, methods/assumptions, measurement/validity and AVAILABLE state. Cross-mode, strategy-specific scope, unknown overlap or missing fields cannot match.

Receipt construction remains crate-private with no public Deserialize; external bytes cannot mint authority. A proposal is evidence only: it cannot create authorization, mutate Registry/eligibility/capital, start Runtime, generate Trade Intent/Risk Decision/Reservation/orders or production effects. Old matched members must equal strategy, ArtifactRef and condition version and remain under the original autonomous authorization lineage with an independent Governance decision. The current conditional path still refuses.

### Current persistence boundary

No durable Scanner history or reachable terminal-read consumer exists. Recorded old identities, receipts and refusals cannot be rewritten. This page requires no new schedules/attempts/proposals database or test workflow. New discovery retains Backtest jobs and R&D conclusion references; Governance consumes existing source facts for frozen conditions. References themselves convey no trading authority.
