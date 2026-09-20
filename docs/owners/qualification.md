# Qualification

## Responsibility

Independently decide whether a frozen candidate satisfies preregistered evidence, holdout, cost, capacity, and operational conditions. Qualification owns deployability evidence, not strategy design, activation, or recovery.

## Eligibility terminal status

This section is an implementation status record, not contract. It grants no permission by itself, and a step
listed here is not authority to build, deploy, or drive a protected evaluation. The contract below is unchanged by
whether a step has a caller.

**The eligibility terminal has never been driven.** Every step below is implemented and none has a
caller, so no Protected Replay Request Set, Attempt Frontier, Robustness Assessment or Eligibility
Fact has ever existed. The ordered PostgreSQL gate reaches only an `ADMITTED` intake and an Origin
(`schema_version=1`) replay request, and its two closing entries assert that Eligibility is **absent**.

| Step                                            | State     |
| ----------------------------------------------- | --------- |
| `submit_protected_replay_request_v2`            | no caller |
| `seal_protected_replay_request_set_v1`          | no caller |
| `produce_and_commit_protected_replay_result_v3` | no caller |
| `close_protected_replay_attempt_frontier_v1`    | no caller |
| `close_economic_pass_assessment_v1`             | no caller |

The steps are strictly serial, and the first one is blocked on **a missing Owner input** rather than on a
missing driver. A V2 request is a V1 proposal plus a `ClockHeadHandoff`, the shared-time resolver is
built from `DEPLOYMENT_STORE_ADMISSION_MODE`, and the gate does not set it, so the resolver yields
nothing and no V2 request can be constructed there at all. Set sealing then admits only
`schema_version=2` members - Origin rows carry a different canonical encoding and would strand the
frontier - so an Origin-only gate seals an empty set even if it were called.

Admitting shared-time evidence into the gate environment is therefore the first prerequisite for the
terminal, before any driver is worth writing.

**TARGET - the deployment-authorized terminal, and what it waits for:** this terminal is TARGET, not
unfinished work. `DEPLOYMENT_STORE_ADMISSION_MODE` stays `disabled` until a deployment authority
exists to issue what `required` demands: a custodian signature history, an anti-rollback witness, a
credential lease and direct measurement. None of those exist here, and no real trading or production
write is authorized, so a resolver that yields nothing is the correct closed state rather than a
defect. Nothing else in Qualification waits behind it - the attempt frontier, the candidate and
evaluation rules, and the protected-replay custody above are separable work, and treating this
terminal as a blocker on them was a misreading of the dependency rather than a property of it.

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
  Runtime kernel, simulator, and cost, slippage, and capacity model versions. It declares
  `PROTECTED_EVALUATION` as its canonical `timeEvidenceCutKind` and seals the request-stage root cut.
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

## Implementation status ledger

This ledger records only what the repository has reached at this cut. It uses the status vocabulary of the
[Market Data](./market-data/) ledger, with `CURRENT_PARTIAL` as the merged-but-unreachable form, and grants no
permission by itself. No row here is `IMPLEMENTATION_ADMITTED`: this Owner has no admitted slice, and widening
that requires changing this document first. Where a fact already has a section of its own, the row points at it
rather than repeating it, so there is one place to keep in step.

- **CURRENT_PARTIAL - Candidate Intake:** `submit_candidate_intake_v1` in `crates/qualification/src/postgres.rs`
  writes the receipt under a Candidate advisory lock and returns a typed conflict for a second review request of
  an already-intaken Candidate. It has no production caller: every call outside this Owner is in the
  `sealed-develop-composer-acceptance` test module of `crates/strategy_factory/src/iteration_decision_postgres.rs`.
- **CURRENT_PARTIAL - Protected Evaluation:** every protected terminal is driven end to end by the ordered
  PostgreSQL gate and by nothing else. The entries, the sealed evidence that admits each terminal, and the two
  behaviours the gate cannot reach are recorded under Eligibility terminal status above.
- **CURRENT_PARTIAL - Pre-Research protected-feedback resolution:** this is the one capability with production
  callers. `resolve_or_create_for_basis` and `admit_in_transaction` are called from
  `crates/strategy_factory/src/product_edge_postgres.rs`, and `admit_historical_projection_in_transaction` from
  `crates/strategy_factory/src/rd_owner_postgres_custody.rs`, all outside any test module. Its readback proof is
  an ordered-chain entry; the response-cut rollback has none, for the reason recorded above.
- **TARGET - Eligibility State:** the module owns `INELIGIBLE`, `QUALIFIED`, `EXPIRED`, and `REVOKED`, and only
  the first two have any implementation. `EligibilityState::Expired` and `::Revoked` in
  `crates/strategy_governance/src/model.rs` have no producer anywhere, `QualificationPublicStatusV1` carries five
  variants and neither of those two, no relation named for expiry or revocation exists among this Owner's
  `qualification_*_v1` tables, and no successor chain prevents predecessor revival. The consumer type exists in
  Governance and every `UntrustedEligibilityReadback` is constructed in that crate's own tests, so the shape of a
  read port is present while nothing on either side has written such a fact.
- **TARGET - the deployment-authorized terminal:** `DEPLOYMENT_STORE_ADMISSION_MODE` stays `disabled`, and what
  it waits for is recorded under Eligibility terminal status above.
- **CURRENT, and permanently unprovable - Incident-specific Owner reconstruction:** the machinery is merged -
  `crates/qualification/src/recovery.rs`, exported as `run_owner_recovery_cli` and shipped as the
  `qualification-owner-recovery` binary behind the `owner-recovery` feature - and its only proof can never pass.
  The measurement is recorded under Incident-specific Owner reconstruction below.

## Pre-Research protected-feedback resolution

Qualification accepts no caller assertion of genesis, emptiness, or current feedback. It directly resolves the
exact R&D Independence Basis Receipt, locks its complete durable history for the trusted principal and Research
request scope, and commits one genesis frontier only when that history is empty. Existing history returns the
complete current opaque frontier; missing, stale, malformed, conflicting, cross-principal, cross-scope, or
cross-basis input returns `UNAVAILABLE` and creates no frontier transition.

Ordinary create, resolve, and in-transaction admission accept no caller time. After direct basis resolution, the
principal/scope advisory lock, and complete canonical Qualification history verification, Qualification samples
PostgreSQL `clock_timestamp()` inside the same transaction. Existing-read freshness uses that Owner cut. A new
projection takes its single sample at the final write edge and uses only that cut for projection time, half-open
`valid_through`, receipt commit time, and their identities and digests. After persisting and canonically rereading
the new history, Qualification samples a distinct Owner response cut immediately before freshness validation and
commit; crossing `valid_through` rolls back projection, head, and outbox atomically.

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
global empty Qualification history, absent recovery receipt, and inactive outbox publisher. The closed incident
contract binds PostgreSQL cluster `system_identifier`, database name/OID, and role name/OID as typed fields with a
domain-separated digest. Qualification compares that semantic target under transaction custody before any DDL or
write and repeats the comparison immediately before the first DDL.
One serializable transaction takes the principal/scope advisory lock and exclusive table locks, then inserts the
original projection, head, original domain outbox row, and a separate Qualification custody/audit receipt. The
receipt emits no domain wake and states that no physical backup was restored, original JSONB storage bytes were
not observed, and no new validity was minted. Exact completed replay returns the same receipt without writes;
partial, conflicting, stale, malformed, or non-empty state fails closed. The reconstructed projection retains its
original half-open interval, so a normal resolver at the current cut remains `UNAVAILABLE`.

Executable provenance is a separate effect boundary. Qualification records the executable hash actually used and
verifies database semantics; it does not claim that repository code can independently prove its own executable
bytes. The Hub-owned external effect controller binds the reviewed Origin ancestry, candidate commit/tree,
executable path, and SHA-256 before it releases the database capability and executes this worker.

This section is an implementation status record, not contract. The contract above is unchanged by it. The bound
evidence-session resource no longer exists, so this repository can neither execute this reconstruction again nor
re-prove it. Two measured facts make that permanent rather than temporary. The resource locator is an absolute
path under one developer home directory and `verify_evidence` rejects every other path, so the proof could only
ever run on that one machine and never on Linux CI. The same function also pins the SHA-256 of named lines of
that file, so no substitute file can satisfy it. The file itself is gone from that machine: no Time Machine
destination is configured, no local snapshot holds it, nothing under the home directory or any mounted volume
carries that session identifier, and the artifact was never committed. Its proof,
`isolated_postgres_recovery_is_atomic_fail_closed_and_replay_safe`, therefore cannot pass anywhere. The contract
above stays as the record of a closed one-incident reconstruction; it does not widen into a general restore path
because it can no longer be exercised, and nothing here authorizes substituting a fixture for the sealed
evidence.

## Input handoffs

- [R&D](./rd/) submits the frozen Candidate only with a terminal `SELECTED_FOR_QUALIFICATION`
  Research Selection Disposition. Candidate, disposition, and intake cross-bind the exact frozen Intent falsifier
  and stop rule, exploratory request/result frontier, costs, capacity assumptions, and immutable exhaustive
  TrialFamily Census Frontier with consumed budget through the Candidate cut, plus one exact preregistered
  protected decision-policy identity and version and one frozen Protected Robustness Plan.
- Product Edge submits one stable review request binding the originating Research request, Candidate, canonical typed meaning, and origin-to-current protected-feedback observation frontiers.
- [Backtest](./backtest/) returns the requested protected Run Result and consumed-input receipt; every consumed
  execution-defining field must exactly equal its request counterpart. The Result carries the protected economic
  measurement, which repeats the metric identity and digest, the unit and the scale of the frozen
  `ProtectedEconomicPolicyBundleV1` this Owner sealed with the request set; a measurement that does not repeat
  them exactly is not a measurement of the sealed policy and closes the attempt.
- Operator Authorization is the upstream of the deployment-authorized terminal. What
  it must issue, and why this handoff is TARGET, is stated once under Eligibility terminal status and is not
  repeated here.
- Committed evidence changes may trigger re-evaluation; wake-up channels never replace owner fact reads.

Implementation status of these handoffs, which is a record and not contract. Only the Product Edge handoff has a
production caller: `resolve_or_create_for_basis` and `admit_in_transaction` are called from production code in
vibe-strategy-factory, and `admit_historical_projection_in_transaction` from its R&D custody path. The R&D
Candidate handoff has none: every call of `submit_candidate_intake_v1` outside this Owner is in one sealed
acceptance test module. Backtest cannot perform its half of the economic measurement in production, because it
has no admitted read of the frozen metric reference: not of the R&D plan, whose only sealed read returns native
replay source storage, and not of `qualification_protected_economic_policy_bundles_v1`, whose grant is revoked.
The ordered gate reaches the measurement only because the gate step reads the Candidate under this Owner's own
role, which is fixture discovery, not a path Backtest has. Closing that gap needs a handoff of the frozen metric and
coverage-policy references, with the unit and the scale, that Backtest may actually read - inside the request set
seal, or as a sealed `qualification_api` read - and it is a cross-Owner contract change, not a proof.

## Output handoffs

- To [Backtest](./backtest/): one frozen Protected Replay Request, created only after the write-once
  request-correlated `ADMITTED` receipt and the holdout reservation, with every execution-defining identity and
  the exact Candidate/Intake protected policy pair fixed. Each request addresses one declared Protected Robustness
  Plan cell or the exact frozen bounded matrix, so no cell may be chosen after a result is observed. The request
  set seals the frozen `ProtectedEconomicPolicyBundleV1` whose measurement the returned Result must repeat
  exactly. A request this Owner did not create is not a protected request, and a Backtest admission rejection
  closes it as a request-bound `RUN_REJECTED` Protected Run Result rather than leaving it open.
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
singleton `NO_EXECUTION_DEFECT` may proceed to a passing assessment. Qualification first resolves the exact sealed
Backtest per-cell results against its frozen plan into one complete, duplicate-free result census. The resulting
assessment atomically embeds its census-finalization proof, bound to the frozen stop and missing-cell policies,
assessment-stage Time Evidence, and a sealed Backtest attempt frontier proving no requested cell remains
nonterminal; without that proof no assessment exists and the attempt stays `IN_PROGRESS_OR_UNKNOWN`. It derives
the complete Protected Robustness Assessment under the frozen
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

The Protected Robustness Assessment declares `PROTECTED_EVALUATION` as its canonical `timeEvidenceCutKind`,
directly binds every admitted result-stage Time Evidence, and seals one assessment-stage cut. Qualification rejects
missing, expired, unproved or mutually incomparable epochs, skipped-stage, or non-advancing Time Evidence before
categorical assessment and before any holdout closure or Eligibility write. A direct proved request-to-result epoch
transition is valid, but every result in one assessment shares one result epoch and the assessment advances there.

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
- A copied-anchor store with a different cluster/database/role identity and an R&D head whose canonically decoded
  request scope differs from the frozen scope both fail before Qualification DDL or rows.
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
