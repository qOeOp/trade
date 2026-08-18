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

## Input handoffs

- Scheduler supplies the fixed periodic trigger; it has no deployment authority.
- [Strategy Governance](./strategy-governance/) supplies governed ArtifactRefs, activation conditions, and lifecycle constraints.
- [Market Data](./market-data/) supplies the timestamped market and instrument facts required by those conditions.
- [Portfolio](./portfolio/) may supply a bounded Capacity View for proposal sizing hints. It is optional unless the published activation condition explicitly requires it.

## Output handoffs

- To [Strategy Governance](./strategy-governance/): exactly one terminal Scanner Receipt for every scheduled ScanId.
- To Product Edge: direct read access to the Scanner-owned terminal receipt for every ScheduledScanId. Product
  Edge reads its exact completion state, mutually exclusive expected-set branch, terminal reason, and proposal
  members only when `PROPOSED`; it stores no competing Scanner-owned projection.

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
