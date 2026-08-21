# Qualification

## Responsibility

Independently decide whether a frozen candidate satisfies preregistered evidence, holdout, cost, capacity, and operational conditions. Qualification owns deployability evidence, not strategy design, activation, or recovery.

## Authoritative facts owned

- Durable principal/scope protected-feedback history and its opaque resolution frontier. A pre-Research read is
  bound to one exact R&D Independence Basis Receipt and resolves only as `GENESIS_EMPTY`, `FRONTIER(ref, cut)`, or
  `UNAVAILABLE` with source sequence/cut, clock epoch, and half-open validity.
- Write-once Candidate Intake Receipt for one stable Qualification Review Request and canonical typed meaning,
  the R&D-owned Candidate, its terminal `SELECTED_FOR_QUALIFICATION` Research Selection Disposition, and
  its immutable exhaustive TrialFamily Census Frontier plus exact preregistered protected decision-policy identity
  and version: `NOT_ADMITTED` or `ADMITTED`. Evaluation progress never
  mutates this request-correlated receipt.
- Protected evaluation rules with immutable policy identity and version, holdout budget and cumulative disposition,
  embargo, costs, capacity assumptions, trial-family bounds, cross-family predecessor frontier, and protected-feedback observation frontier.
- Protected Robustness Assessment bound to the Candidate's frozen Protected Robustness Plan and request-equal
  terminal result. It repeats the exact plan-cell-set digest and enumerates every plan-required cell exactly once
  as `PASS`, `FAIL`,
  `NOT_APPLICABLE_ACCEPTED`, `NOT_APPLICABLE_REJECTED`, or `MISSING`, with exact applicability, evidence,
  policy, and Time Evidence bindings. One axis may contain multiple required cells. It is categorical Eligibility
  evidence and never a protected-detail feedback channel to Research.
- Frozen Protected Replay Request identity: exact protected decision-policy identity and version, Strategy Artifact,
  requested PIT scope, exact PIT Market Snapshot identity, snapshot and correction rule, replay-configuration digest,
  Runtime kernel, simulator, and cost, slippage, and capacity model versions.
- Protected Attempt Disposition: `REPLAY_REJECTED`, `REPLAY_INVALID`, or `ASSESSMENT_INVALID`, bound to the intake,
  replay request, terminal result, and preregistered holdout closure; it is not Eligibility.
- Each initial or renewed Eligibility Fact cross-bound to the exact Protected Replay Request, exact
  `TERMINAL_RESULT` Protected Run Result, protected decision-policy identity and version, and verified request/result equality.
- Current Eligibility State with conditions, expiry, evidence references, revocation history, one downstream-enforceable economic-condition version, the evaluated cost/capacity-model version, and a qualified capacity ceiling for `QUALIFIED`.

## Modules

- **Candidate Intake** - write one receipt for the immutable Candidate and evidence pack; `NOT_ADMITTED` creates no protected attempt and consumes no holdout.
- **Protected Evaluation** - request and assess isolated protected replay; only a matching `TERMINAL_RESULT`
  evaluated under the bound protected decision-policy version can commit an Eligibility Fact. Rejected, invalid,
  nonterminal, or mismatched evidence commits no Eligibility.
- **Eligibility State** - publish current ineligible, qualified, expired, or revoked deployability facts, their
  conditions, revocation history, and the bounded economic-capacity contract Governance and Risk must enforce.
  It owns revocation as an Eligibility transition without taking over Runtime recovery.

## Pre-Research protected-feedback resolution

Qualification accepts no caller assertion of genesis, emptiness, or current feedback. It directly resolves the
exact R&D Independence Basis Receipt, locks its complete durable history for the trusted principal and Research
request scope, and commits one genesis frontier only when that history is empty. Existing history returns the
complete current opaque frontier; missing, stale, malformed, conflicting, cross-principal, cross-scope, or
cross-basis input returns `UNAVAILABLE` and creates no frontier transition.

The projection exposes only its resolution state, opaque frontier reference and digest, basis reference and
digest, principal, scope, source sequence/cut, clock epoch, projection time, and half-open validity. It contains no
protected payload, outcome, measurement, parameter, holdout detail, or dereferenceable evidence. Any later
protected-feedback write must repeat the precommitted basis relation. Same basis and canonical source cut replay
byte-identically; a changed basis or source cut cannot join.

## Incident-specific Owner reconstruction

Qualification alone may execute the sealed `qualification-owner-incident-v1-01a02194-139a-7281-9d2b-a87ab29d67ba`
reconstruction authorized for the 2026-08-21 local protected-feedback loss. This is a one-incident
`DETERMINISTIC_CANONICAL_RECONSTRUCTION_NO_BACKUP` contract, not a general restore or import API. It accepts only
the exact evidence-session resource locator, incident identity, authorization locator, and target database
resource locator. Projection rows, JSON values, timestamps, digests, genesis state, and current validity are never
caller inputs.

Before any insert, Qualification strictly revalidates the bound JSONL record bytes, call/output/turn pairing,
frozen canonical generator identity, complete expected semantic vector, surviving R&D basis/receipt/head/outbox,
target fingerprint, global empty Qualification history, absent recovery receipt, and inactive outbox publisher.
One serializable transaction takes the principal/scope advisory lock and exclusive table locks, then inserts the
original projection, head, original domain outbox row, and a separate Qualification custody/audit receipt. The
receipt emits no domain wake and states that no physical backup was restored, original JSONB storage bytes were
not observed, and no new validity was minted. Exact completed replay returns the same receipt without writes;
partial, conflicting, stale, malformed, or non-empty state fails closed. The reconstructed projection retains its
original half-open interval, so a normal resolver at the current cut remains `UNAVAILABLE`.

## Input handoffs

- [R&D](./rd/) submits the frozen Candidate only with a terminal `SELECTED_FOR_QUALIFICATION`
  Research Selection Disposition. Candidate, disposition, and intake cross-bind the exact frozen Intent falsifier
  and stop rule, exploratory request/result frontier, costs, capacity assumptions, and immutable exhaustive
  TrialFamily Census Frontier with consumed budget through the Candidate cut, plus one exact preregistered
  protected decision-policy identity and version and one frozen Protected Robustness Plan.
- Product Edge submits one stable review request binding the originating Research request, Candidate, canonical typed meaning, and origin-to-current protected-feedback observation frontiers.
- [Backtest](./backtest/) returns the requested protected Run Result and consumed-input receipt; every consumed execution-defining field must exactly equal its request counterpart.
- Committed evidence changes may trigger re-evaluation; wake-up channels never replace owner fact reads.

## Output handoffs

- To [Strategy Governance](./strategy-governance/): categorical Eligibility State facts, including revocation,
  with exact Candidate and fact versions, economic-condition version, evaluated cost/capacity-model version,
  qualified capacity ceiling, effective time, and non-dereferenceable committed evidence references only.
  Expiry, revocation, missing-current, and unknown-current are explicit downstream states; none permits Governance
  to silently retain add-risk authority for an active generation.
- To Event Rail: a wake-up hint only after the qualification fact is committed. Its protected payload contains
  only the public terminal outcome, a type-opaque non-dereferenceable reference, and source-frontier freshness.
  Protected phase, latency, terminal timing, and timing-derived fields are forbidden. It never emits internal
  `INELIGIBLE` or another protected terminal disposition.
- To Product Edge: before Research admission, the basis-bound opaque `GENESIS_EMPTY`, `FRONTIER`, or
  `UNAVAILABLE` protected-feedback projection. For Candidate Intake, first the committed write-once
  `NOT_ADMITTED` or `ADMITTED` receipt that authoritatively closes the exact review request; separately, a
  request-correlated Qualification Status Summary. Receipt absence remains `SUBMITTED_OR_UNKNOWN`, and the summary
  cannot replace or fabricate it. The summary advances the bounded protected-feedback observation frontier before
  a successor review is admitted. `EVALUATING` derives from an `ADMITTED` receipt plus a Protected Replay Request
  in `IN_PROGRESS_OR_UNKNOWN`; every negative internal attempt disposition or `INELIGIBLE` fact projects only
  `CLOSED_NOT_QUALIFIED`, while a positive Eligibility Fact projects `QUALIFIED`. References are type-opaque and
  non-dereferenceable. `UNAVAILABLE` binds only the unresolved request and phase identity. Later phases never
  rewrite prior facts.

## Rejections and prohibitions

- Never accept a mutable artifact, post-result preregistration, hidden trial family, missing or non-exhaustive Census Frontier, late family divergence, unresolved cross-family predecessor, late independence basis, stale feedback frontier, incomplete protected-attempt frontier, or unbounded holdout reuse.
- Never admit a missing or mismatched selected-only Research Selection Disposition. A Research terminal stop has
  no Selection or Candidate and never reaches intake. Such an invalid request
  closes as `NOT_ADMITTED` and creates no protected request or holdout consumption.
- Never send protected outcomes back to the submitted candidate's R&D loop.
- Never copy protected measurements, parameters, results, holdout details, or evaluation output into Governance facts or rationale.
- Never expose protected measurements, parameters, holdout details, or evaluation outputs through Product Edge; its evidence references cannot dereference protected detail.
- Never equate qualification with activation, capital allocation, runtime start, or trade permission.
- Never infer that an active generation remains qualified from silence, a wake event, or a previously valid fact.
- Never stop orders or declare a Recovery Case closed.

## Failure and recovery

Missing or mutable preregistration; a missing, mutable, non-exhaustive, or late-divergent TrialFamily Census Frontier; unresolved predecessor correlation; a late independence basis; or incomplete feedback, attempt, and cumulative holdout frontiers produce `NOT_ADMITTED` before evaluation and consume no holdout. A missing or mismatched protected decision-policy identity/version or Protected Robustness Plan also produces `NOT_ADMITTED`. Qualification creates a frozen Protected Replay Request only after the write-once request-correlated `ADMITTED` receipt and holdout reservation, and repeats that exact policy pair and plan identity. The request is never rejected in place: any Backtest admission rejection after creation commits a request-bound `RUN_REJECTED` Protected Run Result. Qualification verifies exact request-to-result equality for Artifact, PIT scope, PIT Market Snapshot identity, snapshot rule, replay configuration, Runtime kernel, simulator, cost, slippage, capacity model, Protected Robustness Plan, and plan-cell identity. Any omission, substitution, or mismatch is `INVALID_REPLAY_EVIDENCE`, closes under preregistered holdout treatment, and emits no Eligibility Fact.

Before reserving holdout, Candidate Intake validates the submitted plan against the exact Qualification-owned,
versioned robustness-adequacy policy. Time coverage requires at least two non-overlapping preregistered windows;
regime coverage requires at least two materially distinct regimes including a non-favourable/adverse regime;
instrument non-applicability is permitted only for a frozen single-instrument scope; perturbations cover every
material input class; and every tunable parameter has bounded neighbours or an accepted no-tunable-parameter basis.
An inadequate or policy-mismatched plan is `NOT_ADMITTED` and never reserves holdout.

For a request-equal `TERMINAL_RESULT`, Qualification first consumes Backtest's complete finite non-empty protected
`diagnosticCategorySet`, content digest, and per-category decisive evidence. It preserves all independently
supported members, then validates one duplicate-free subset of the canonical category set before applying any
per-category disposition. Empty, duplicate, unknown, `NO_EXECUTION_DEFECT`-mixed, or
`UNRESOLVED_FAILURE`-mixed input closes as `DIAGNOSTIC_UNRESOLVED`. Only a structurally valid set containing
`MARKET_DATA`, `ARTIFACT`, `RUNTIME_KERNEL`, `BACKTEST_OPERATIONAL`, `SIMULATOR`, or `REPLAY_CONFIGURATION` closes as
`DIAGNOSTIC_INVALID`; `UNRESOLVED_FAILURE` closes as `DIAGNOSTIC_UNRESOLVED`; neither creates an assessment or
Eligibility Fact. `BACKTEST_OPERATIONAL` remains a sealed Backtest runner/service category: Qualification closes
holdout custody but returns neither its operational evidence nor protected detail to R&D, Product Edge, or
Governance. A set containing `VALID_ECONOMIC_FAILURE` without a defect must produce a failed assessment and
`INELIGIBLE`. `UNRESOLVED_FAILURE` and `NO_EXECUTION_DEFECT` are each valid only as singleton sets, and only
singleton `NO_EXECUTION_DEFECT` may proceed to a passing assessment. Qualification then derives one complete Protected Robustness Assessment under the frozen
adjudication and protected-decision policy versions. The assessment repeats the exact frozen plan-cell-set digest
and accounts for every plan-required cell exactly once; an axis may contain multiple cells. An explicit
pre-result non-applicability basis becomes `NOT_APPLICABLE_ACCEPTED` only when that policy accepts it; missing,
stale, rejected, or policy-mismatched basis is `NOT_APPLICABLE_REJECTED`. Any missing, duplicate, unknown,
request/result-mismatched, or policy-mismatched cell-or an all-not-applicable census-is `INCOMPLETE_INVALID` and
commits `ASSESSMENT_INVALID` with preregistered holdout closure and no Eligibility Fact. A complete census is
`COMPLETE_PASS` only when the plan was admitted as `PLAN_ADEQUATE`, the diagnostic set is singleton `NO_EXECUTION_DEFECT`, at least one cell is applicable, every
applicable cell passes, and every non-applicable cell is accepted; any applicable failure or rejected
non-applicability is `COMPLETE_FAIL`. `COMPLETE_PASS` produces `QUALIFIED`; `COMPLETE_FAIL` produces `INELIGIBLE`
under the frozen policy. The Eligibility Fact repeats the exact intake, policy pair, plan, request, result, verified
equality, cell census, coverage, tolerances, thresholds, aggregation, and missing-cell disposition.

A terminal `RUN_REJECTED` or `INVALID_REPLAY_EVIDENCE` produces `REPLAY_REJECTED` or `REPLAY_INVALID`:
Qualification binds the intake, request, result, and preregistered holdout closure, emits no Eligibility Fact, and
never calls it `INELIGIBLE`. Only `IN_PROGRESS_OR_UNKNOWN` projects `EVALUATING` from the unchanged `ADMITTED`
receipt and protected request while holdout custody remains reserved and counted in the cumulative frontier.
`REVOKED` is reserved for a previously effective qualification that later loses validity. The Eligibility State
module owns `INELIGIBLE`, `QUALIFIED`, `EXPIRED`, and `REVOKED`; attempt-only `ASSESSMENT_INVALID` is not an
Eligibility state. A revocation transition informs Governance but does not cancel orders itself.

Eligibility replay is frontier-bound. The same Fact identity and content digest join without extending its
effective interval or `valid-through`. Changed state, interval, predecessor, policy, evidence, or frontier under
the same identity is conflicting replay. Renewal creates a new immutable Fact that binds its predecessor and a
new interval; once a successor, expiry, or revocation becomes the Qualification head, the predecessor can never
be current again. Governance may consume one still-current Fact once per distinct authorized lifecycle request,
evaluation, and decision frontier, while duplicates inside that frontier join and never restore capital.

## Decision contract

- **Inputs** - one selected Candidate with exact `READY_FOR_SELECTION` lineage, exhaustive TrialFamily Census,
  preregistered protected policy, holdout ancestry, frozen Replay Request, and sealed Run Result.
- **Diagnosis and decision** - admit or reject intake, isolate protected evaluation, verify exact request-result
  equality, apply the frozen policy, and commit attempt disposition or Eligibility State transition.
- **Conflict resolution** - protected policy and cumulative holdout frontier are immutable; duplicate request joins
  once, changed meaning is rejected, and no later policy reinterprets an earlier result.
- **Outputs and terminal negatives** - Intake Receipt, Protected Attempt Disposition, or Eligibility State;
  `NOT_ADMITTED`, replay rejected/invalid, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, `IN_PROGRESS_OR_UNKNOWN`, and `INELIGIBLE` stay distinct.
- **Feedback and economic meaning** - independently reject overfit or uneconomic candidates while exposing only
  the public terminal outcome, non-dereferenceable reference, and source-frontier freshness, preserving the value
  of scarce protected evidence.
- **Prohibitions** - no R&D tuning feedback, artifact mutation, lifecycle, capital widening, Runtime
  activation, order, account effect, or protected-detail Product view.

## Subsequent implementation acceptance

- Candidate and evaluation rules are immutable before protected evidence is revealed.
- The incident recovery binary is feature-gated, closed to the exact incident and four resource locators, and
  cannot accept reconstructed facts or freshness claims from its caller.
- Faults after each recovery write roll back projection, head, outbox, receipt, and transactional DDL together;
  isolated PostgreSQL verification uses an explicitly disposable database and role distinct from every default
  Owner database.
- A successful reconstruction has global counts exactly `1/1/1` plus one recovery receipt, reproduces the frozen
  canonical verifier's identities/digests/times, emits no additional domain outbox event, and remains stale to the
  ordinary current-cut resolver.
- Candidate, Intake, Protected Replay Request, Protected Run Result, Protected Robustness Assessment, and every
  Eligibility Fact repeat the same Protected Robustness Plan identity and version.
- Every `ADMITTED` Intake Receipt cross-binds the exact `SELECTED_FOR_QUALIFICATION` disposition and its frozen
  Intent falsifier. Any other disposition produces only `NOT_ADMITTED` and consumes no holdout.
- Holdout consumption and trial-family budget are measurable and cannot be reset by renaming a candidate.
- Every stable review request resolves to exactly one Intake Receipt; changed meaning or a naked identity retry cannot create another intake or holdout attempt.
- Cumulative holdout disposition includes rejected, invalid, unknown, and terminal protected attempts across related TrialFamilies; renaming cannot reset it.
- Omitted losing siblings, renamed trials, budget mismatch, or a new family member after the frozen cut are rejected; the new member requires a successor Candidate.
- Every protected request either has no identity because intake failed before reservation, or closes through a request-bound Protected Run Result; no request-level rejection can strand holdout custody.
- Protected request and result match exactly across all 16 canonical execution-defining identity pairs; omission or substitution deterministically closes as `REPLAY_INVALID` with no Eligibility Fact. The number is derived from the canonical `crossBindEquality` set rather than maintained as a second list.
- Every initial or renewed Eligibility Fact binds the exact Candidate/Intake policy identity and version, exact
  request, exact `TERMINAL_RESULT`, and verified equality; rejected, invalid, nonterminal, or mismatched evidence cannot
  create one.
- Same-identity replay never extends an Eligibility interval. Renewal is a new predecessor-bound fact; successor,
  expiry, and revocation heads permanently prevent predecessor revival, and duplicate consumption within one
  Governance lifecycle frontier cannot create another decision.
- `QUALIFIED` requires every plan-required time, regime, instrument, perturbation, and parameter-neighborhood cell
  to satisfy the frozen coverage, tolerance, threshold, aggregation, and missing-cell rules. A single attractive
  aggregate or one terminal result cannot substitute for the plan.
- Every frozen plan-required cell resolves exactly once and every axis may contain multiple cells. Missing,
  duplicate, unknown, mismatched, or all-not-applicable assessments are `INCOMPLETE_INVALID`, commit
  `ASSESSMENT_INVALID`, close holdout custody, and emit no Eligibility Fact; accepted non-applicability requires
  the exact frozen basis and policy.
- Protected outcomes have no dependency path into the same candidate build.
- Governance can read one current eligibility fact and its complete revocation history.
- Eligibility expiry or revocation is sufficient to end add-risk retention; Governance must enter its
  `DE_RISK_PENDING` path without waiting for capacity or performance evidence needed only for risk increases.
- A Risk or Governance capital envelope wider than the exact current Qualification capacity ceiling, or bound to another Candidate, condition, model, or fact version, fails closed.

## Observability and persistence

Qualification persists intake, holdout reservation/consumption, protected request/result correlation, robustness assessment, attempt disposition, Eligibility, expiry, and revocation as its native audit chain. Shared telemetry contains only the public terminal outcome, a type-opaque non-dereferenceable fact reference, and source-frontier freshness. Protected phase, latency, terminal timing, and timing-derived fields are forbidden. `REPLAY_REJECTED`, `REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, and `INELIGIBLE` all project byte-equivalently as `CLOSED_NOT_QUALIFIED`; `QUALIFIED` remains exact. Protected measurements, parameters, cell outcomes, holdout contents, internal terminal dispositions, negative reasons, and evaluator detail never enter Event Rail, traces, logs, metrics, alerts, or Dashboard. In particular, no internal `INELIGIBLE` event exists outside Qualification. Dashboard totals distinguish only `QUALIFIED`, `CLOSED_NOT_QUALIFIED`, expired, and revoked; all negative protected terminals share byte-equivalent labels and aggregates.
