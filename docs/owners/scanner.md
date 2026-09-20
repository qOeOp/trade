# Scanner

## Responsibility

Run a scheduled slow-track match between governed strategies and current market conditions, then submit evidence-bound deployment proposals to Strategy Governance. Scanner never activates Runtime and never owns strategy lifecycle state.

## Authoritative facts owned

- Versioned Scanner Schedule Definition binding scan-scope identity and version, calendar, time zone, cadence,
  time-zone rules, fold/gap disposition, due-slot derivation, misfire/backfill policy, shared clock, and validity.
  One stable attempt identity derives only from that definition version, exact scan-scope identity and version,
  and canonical unambiguous due-slot boundary. Clock epoch and continuity are admission evidence, not identity.
  Duplicate delivery, concurrency, restart, or a late trigger joins the same attempt and terminal receipt.
- One terminal Scanner Strategy Disposition for every considered strategy: `MATCHED`, `NO_MATCH`, `INSUFFICIENT_DATA`,
  `INPUT_UNAVAILABLE`, or `CONDITION_FAILED`; `FAILED` is never a per-strategy state. Each disposition binds its
  ArtifactRef, condition version, and consumed inputs.
- One terminal batch Scanner Receipt: `PROPOSED`, `NO_MATCH`, `INSUFFICIENT_DATA`,
  `COMPLETED_NO_PROPOSAL`, or `FAILED`; only `PROPOSED` carries exactly the strategies with complete matching
  evidence. A complete set with no `MATCHED` strategy and at least one local `CONDITION_FAILED` is
  `COMPLETED_NO_PROPOSAL` and retains every member disposition.
- Negative per-strategy dispositions remain visible even when other strategies make the batch `PROPOSED`.
- A complete receipt binds equal expected and observed strategy sets. An incomplete `FAILED` receipt uses one mutually exclusive branch: when expected membership is known it binds exact expected, observed, and `missing = expected − observed`; when membership is unresolved it binds the authoritative unresolved-set disposition, observed facts, an explicit missing-members-unavailable marker, and immutable terminal reason without inventing members.

## Modules

- **Strategy Loader** - load deployable ArtifactRefs, activation conditions, data needs, versions, and lifecycle limits from the governed registry.
- **Market Snapshot** - derive each strategy's supplied universe-selection rule, required instruments and windows,
  then bind PIT market, calendar, session/time-zone, corporate-action, historical-membership, and semantics inputs
  or an explicit negative disposition.
- **Strategy Matcher** - evaluate each activation condition against its bound inputs; one strategy's missing data or condition failure cannot suppress complete matches for others.
- **Proposal Builder** - package matched strategies, evidence, optional Capacity View identity, and stop conditions into an auditable proposal.

## Implementation status ledger

This ledger records only what the repository has reached at this cut. It uses the status vocabulary of the
[Market Data](./market-data/) ledger, with `CURRENT_PARTIAL` as the merged-but-unreachable form, and grants no
permission by itself: what is `IMPLEMENTATION_ADMITTED` at this cut is exactly the terminal-receipt custody
slice the Product Edge output handoff names, and widening the admitted set requires changing this document first
under the Architecture authority rule in `AGENTS.md`. A merged crate, a named type, a green job, or a row here is
not implementation authority, never proves a production consumer, and never authorizes a production effect, a
deployment cutover, or real trading.

- **CURRENT_PARTIAL - deterministic Scanner core:** `crates/scanner` owns `ScheduleDefinition` with fold, gap, and
  misfire dispositions, due-slot derivation and the stable `AttemptId`, per-strategy `StrategyDisposition`, the
  terminal `ScannerReceipt` with its five statuses and mutually exclusive membership branches,
  `BatchOperationalFailure` categories, the `Scanner` service whose source-Owner admission of Time and Governance
  membership is crate-private, the `TerminalReceiptStore` port, and the `ProductEdgeTerminalReceiptReader` read seam.
  `crates/scanner/src/tests.rs`, `crates/scanner/tests/public_owner_admission.rs`, and the compile-fail tests prove
  the fail-closed shape.
- **TARGET - production composition:** no scheduler trigger, no production constructor for the sealed source-Owner
  admission, no durable receipt custody behind `TerminalReceiptStore`, and no Product Edge consumer exist; the only
  external use is a type import in `crates/testkit/tests/f1_current_workspace.rs`. The durable custody and the
  Product Edge consumer named in this row are the admitted slice; the scheduler trigger and the sealed-admission
  constructor are not.
- **TARGET - Strategy Loader, Market Snapshot, and Capacity View input:** the `StrategyLoader` and `MarketSnapshot`
  ports have no implementation over the governed registry, Market Data PIT facts, or a Portfolio Capacity View.
- **TARGET - handoffs and persistence:** no terminal receipt reaches Governance or Product Edge, and no Scanner fact
  is persisted. The Product Edge half of this row is admitted; the Governance handoff is not.

## Input handoffs

Each contract below states what Scanner requires and refuses, not what an upstream returns. None of the four
seams exists at this cut, as the ledger entry for the `StrategyLoader`, `MarketSnapshot`, and Capacity View
inputs records; satisfying a contract is a condition on a future implementation and never evidence that one is
admitted.

- Scheduler supplies the fixed periodic trigger and no fact; it has no deployment authority. The trigger carries
  no identity Scanner trusts: the attempt identity derives only from the Schedule Definition version, the exact
  scan-scope identity and version, and the canonical unambiguous due-slot boundary. A duplicate, concurrent,
  restarted, or late trigger joins the same attempt and the same terminal receipt. An absent trigger produces no
  attempt at all, because a receipt without an attempt would assert that a scan happened. Scanner never lets a
  trigger create a due slot the definition does not derive, and never admits a trigger's clock epoch into the
  stable identity.
- [Strategy Governance](./strategy-governance/) supplies the governed strategy frontier for one due slot: for
  every member the exact ArtifactRef, Eligibility, activation-condition version, capital-envelope version,
  declared data needs, and effective interval, correlated to the due slot and carrying the frontier's own
  identity and content digest. Scanner requires an answer that either binds an expected membership set it may
  account against, or binds the authoritative reason membership cannot be resolved; it refuses everything else.
  Only the first admits an expected set, so only the first can reach a complete receipt of any status. The
  second, and an absent answer, both close the attempt as `INCOMPLETE_FAILED` on the unresolved-set branch.
  Scanner never reconstructs membership from a previous frontier, from the strategies it happens to have
  observed, or from a partial answer, and never treats a smaller frontier as a complete one.
- [Market Data](./market-data/) supplies, for each strategy and its declared data needs, one sealed PIT readback
  correlated to the exact request identity and content digest, carrying that Owner's published six-state
  disposition `AVAILABLE`, `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, or `UNAVAILABLE`, together with
  the exact Universe Selection Record identity and digest, Instrument Master, calendar, session and time zone,
  corporate-action and historical-membership cuts, and Market Semantics Compatibility identity. Only `AVAILABLE`
  may carry a strategy to `MATCHED`. `INSUFFICIENT` commits that strategy's `INSUFFICIENT_DATA`; the other four
  each commit its `INPUT_UNAVAILABLE`, and so does an absent answer, for that strategy alone. None of these is a
  batch failure: one strategy's missing input can never suppress another strategy's complete match. Scanner
  never repairs a semantics mismatch, never substitutes a neighbouring cut, and never reads a negative
  disposition as an absence of adverse data.
- [Portfolio](./portfolio/) supplies a bounded Capacity View only where a published activation condition
  requires it. Scanner binds the candidate-neutral Capacity Scope, the exact account-fact, valuation and
  liquidity cuts, the pool methodology and assumption versions, the measurement time, and the validity deadline.
  Only an `AVAILABLE` view whose Capacity Scope, cuts, versions and freshness all match the condition may carry
  that strategy
  to `MATCHED`; a partial, expired, unavailable, cross-scope, or methodology-, assumption-, or
  input-cut-mismatched view commits `INPUT_UNAVAILABLE`, and so does an absent answer. Where the condition does
  not require capacity, an absent view is not a defect and never changes a disposition. Scanner never accepts a
  strategy- or generation-bearing scope, a Paper/Live alias, or an unresolved shared-constraint overlap as the
  candidate-neutral scope the condition names.

## Output handoffs

- To [Strategy Governance](./strategy-governance/): exactly one terminal Scanner Receipt for every scheduled
  ScanId, bound to the stable attempt identity and carrying exactly one of `PROPOSED`, `NO_MATCH`,
  `INSUFFICIENT_DATA`, `COMPLETED_NO_PROPOSAL`, or `FAILED`. Only `PROPOSED` carries proposal members, and
  Governance may consider only a member whose strategy entry, ArtifactRef and condition version exactly equal
  its decision target. An absent receipt remains unknown: never read as `NO_MATCH`, never as a completed scan,
  never as permission to proceed without Scanner evidence where the activation is condition-dependent. A
  receipt is evidence and never authorization.
- To Product Edge: direct read access to the Scanner-owned terminal receipt for every ScheduledScanId, keyed by
  that identity and returning the receipt's exact completion state, its mutually exclusive expected-set branch,
  its terminal reason, and its proposal members only when `PROPOSED`. A read either returns exactly one terminal
  receipt bound to the requested attempt, or refuses. It refuses separately when no receipt exists for that
  attempt, when the store returns a receipt bound to a different attempt, when the store reports a semantic
  conflict, and when the store is unavailable; the middle two are **detected custody faults** and are never
  displayed as an absent or unknown outcome. Product Edge stores no competing Scanner-owned projection, derives
  no status of its own, and never labels an incomplete `FAILED` set as complete or renders an unresolved
  expected set as an empty one.
  **IMPLEMENTATION_ADMITTED, terminal receipt custody and its Product Edge readback:** one production
  implementation behind `TerminalReceiptStore` that durably holds exactly one terminal Scanner Receipt per
  stable `AttemptId` - the Schedule Definition version, the exact scan-scope identity and version, and the
  canonical due-slot boundary, which is what ScheduledScanId names throughout this document and the only key
  the port takes - and one `ProductEdgeTerminalReceiptReader` over it that answers a read with exactly that
  receipt or with one of the four refusals above, the middle two still distinguished as detected custody faults.
  The slice is bounded because both ends already exist as ports inside `crates/scanner` and neither name is
  referenced anywhere outside that crate, so it waits on no seam that does not yet exist.
  **NOT_ADMITTED:** the scheduler trigger, a production constructor for the sealed source-Owner admission, any
  `StrategyLoader`, `MarketSnapshot` or Capacity View implementation, the Governance receipt handoff, any Scanner
  fact other than the terminal receipt, and every production effect, deployment cutover and real trade.

## Rejections and prohibitions

- A Scanner proposal is evidence only. It cannot create an authorization lineage, approve unattended operation,
  or lawfully continue to Runtime by itself. Governance may consider it only inside an already authorized
  unattended lifecycle lineage and must commit a separate lifecycle decision.
- Never start, stop, or mutate a Runtime strategy instance.
- Never change Strategy Registry, lifecycle state, Qualification, or capital policy.
- Never treat missing history or low-quality data as a false activation match.
- Never emit Trade Intent, Risk Decision, Reservation, or order command.
- Never treat a partial, expired, unavailable, cross-scope, or economic-condition-, methodology-, assumption-, or input-cut-mismatched Capacity View as an available required input.

## Failure and recovery

One unavailable strategy input or condition error closes only that strategy as `INPUT_UNAVAILABLE` or
`CONDITION_FAILED`; neither can manufacture a batch operational failure. A complete set with no `MATCHED` and at
least one `CONDITION_FAILED` closes as `COMPLETED_NO_PROPOSAL`, retaining every member. Batch `FAILED` is reserved
for `INCOMPLETE_FAILED` or an independently evidenced `BATCH_OPERATIONAL_FAILED`. The latter binds exactly one
`SCHEDULER_ORCHESTRATION_FAILURE`, `SCANNER_SERVICE_FAILURE`, or
`SHARED_DEPENDENCY_OPERATIONAL_FAILURE` category plus its failure identity, evidence source cuts, and Time
Evidence. A known incomplete expected set records exact missing members; an unresolved expected set records why
membership is unavailable and never fabricates missing members. No failed branch carries a proposal even if an
observed strategy matched. Total precedence is independently proven batch `FAILED`, complete `PROPOSED`, complete
`COMPLETED_NO_PROPOSAL`, `INSUFFICIENT_DATA`, then `NO_MATCH`.

The schedule definition determines due slots before execution. The same definition version, scan-scope identity
and version, and canonical boundary always resolve to one attempt and one terminal receipt. A changed cadence,
calendar, time zone, time-zone rules, fold/gap, misfire, or backfill rule creates a successor definition. Missing
clock continuity, or conflicting or unresolvable scope or slot evidence, creates no attempt; wall-clock retries
cannot invent a new slot or put a new clock epoch into the stable identity.

## Decision contract

- **Inputs** - one due slot, complete governed registry frontier, strategy activation conditions, required PIT
  snapshots and optional condition-required Capacity View.
- **Diagnosis and decision** - evaluate each strategy independently, account for the complete expected set, and
  commit one per-strategy disposition plus one terminal batch receipt.
- **Conflict resolution** - due-slot identity joins duplicates; total precedence is independently proven batch
  `FAILED`, complete `PROPOSED`, complete `COMPLETED_NO_PROPOSAL` for local `CONDITION_FAILED`,
  `INSUFFICIENT_DATA`, then `NO_MATCH`. Incomplete membership is `INCOMPLETE_FAILED`; an independent typed batch
  operational failure is `BATCH_OPERATIONAL_FAILED`.
- **Outputs and terminal negatives** - evidence-only proposal or exact no-match, insufficiency, failure, and unknown
  membership evidence; none is deployment authority.
- **Feedback and economic meaning** - periodically surface strategies whose frozen activation evidence currently
  matches while avoiding wasteful always-on instances and false matches from insufficient data.
- **Prohibitions** - no lifecycle, allocation, Runtime application, Trade Intent, risk, order, account, or effect.

## Subsequent implementation acceptance

- Every scheduled tick has exactly one terminal `PROPOSED`, `NO_MATCH`, `INSUFFICIENT_DATA`,
  `COMPLETED_NO_PROPOSAL`, or `FAILED` receipt.
- Every attempt and receipt repeat the exact schedule-definition version, scan-scope identity and version, and
  canonical due-slot boundary; clock-epoch changes require continuity or new admission proof but never rename it.
- Every considered strategy has one terminal disposition bound to its versioned condition and consumed facts or explicit negative dispositions.
- A batch may be `PROPOSED` while retaining condition failures or insufficiency for unrelated strategies. Without
  a match, any local `CONDITION_FAILED` produces `COMPLETED_NO_PROPOSAL`, never `FAILED`, before data insufficiency
  and no-match.
- `PROPOSED` is impossible until the complete per-strategy disposition set is committed. `FAILED` means only
  `INCOMPLETE_FAILED` or an independently evidenced `BATCH_OPERATIONAL_FAILED` with one admitted batch category;
  no per-strategy disposition can create or substitute it.
- Product Edge must show the exact completion state and branch: exact expected observed and missing members when known, or the unresolved-set disposition observed facts and missing-members-unavailable marker when unknown. It cannot label an incomplete `FAILED` set as complete.
- Governance may activate only a proposal member whose strategy entry, ArtifactRef, and condition version exactly match its decision target.
- Strategy Loader and Market Snapshot both feed Strategy Matcher; only matches feed Proposal Builder.
- When an activation condition requires capacity, `MATCHED` binds the candidate-neutral Capacity Scope, exact
  account-fact, valuation, and liquidity cuts, pool methodology and assumption versions, measurement time, and freshness;
  generation-specific condition evidence remains separately bound to that strategy. Any missing or mismatch commits
  `INPUT_UNAVAILABLE`.
- Every match binds the exact Universe Selection Record, Instrument Master, calendar/session/time-zone,
  corporate-action and historical-membership cuts, and Market Semantics Compatibility identity required by the
  Strategy Artifact. Scanner does not invent membership or repair a semantics mismatch.
- Replaying the same registry version, snapshot, and condition versions reproduces the same match results.
- No Scanner path can activate Runtime without a separate Governance decision.
- A Governance decision derived from a proposal binds the exact due slot, terminal receipt, proposal member, and
  pre-existing unattended authorization lineage; evidence-only Scanner output is never treated as authorization.

## Observability and persistence

Scanner persists Schedule Definition, stable due-slot Attempt, exact input frontier, per-strategy disposition,
terminal Scanner Receipt, and Proposal as native facts. For `BATCH_OPERATIONAL_FAILED` it additionally persists
the batch failure identity, one admitted category, evidence source cuts, and Time Evidence. Telemetry covers
scheduling delay, attempt duration, per-strategy isolation, missing-input category, aggregation completeness, and
typed independent batch operational failure. Dashboard separately counts condition-failed members,
`COMPLETED_NO_PROPOSAL`, and typed batch `FAILED` receipts; a retry joins the same stable attempt and never
increments a second scan or proposal.
