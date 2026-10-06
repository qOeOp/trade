# Qualification

## Responsibility

Independently decide whether a frozen candidate satisfies preregistered evidence, holdout, cost, capacity, and operational conditions. Qualification owns deployability evidence, not strategy design, activation, or recovery.

## TARGET - Early protected scope and later assessment

V0.1 reserves protected scope before opening research data. Market Data retains user-approved access partitions
and enforces reads; R&D retains project references and exposures. V0.3 Qualification owns independent
assessment protocols, protected consumption and eligibility facts. Partitioning is not qualification, grants
neither a passing conclusion nor trading authority, and does not advance the complete assessment workflow into V0.1.
Projects may continue iterating within approved research scope without sufficient unseen protected data, retaining
the eligibility evidence gap explicitly. That gap prevents qualification, not research. Subsequent qualification
requires new evidence meeting the applicable independence requirements.

Assessment checks exact scope, research/external exposure and required independence evidence. Reserved data
already used in development is not unseen merely because of its partition label. Preparation, imports, caching,
renaming and project switching never reset exposure; insufficient evidence remains unavailable. Approve and
freeze scope before initial research reads, preregister assessment methods before qualification execution,
and retain exact links between their respective versions.

## TARGET - Public outcomes and display boundary

External Agents and the Dashboard share the same bounded public feedback: qualification terminals expose only
`QUALIFIED` or `CLOSED_NOT_QUALIFIED`. Internal three-level judgments, protected-period returns/drawdown, equity,
order/fill detail and diagnostics remain in isolated assessment. The user identity grants no Dashboard unsealing
entry; details, exports, charts, filters and alerts cannot bypass this boundary. Task state and evidence availability
use only existing permitted projections without exposing protected measurements or negative reasons. Permitted
ordinary research, real trial and production trading reports remain fully displayable.

## TARGET - Composition eligibility

Member economic qualification assesses the complete frozen strategy. Hedging rules and trading legs may be
internal constituents, without each leg independently making a profit. Assess spot-long/perpetual-short carry by
complete-strategy net return, risk, costs and capital usage; the complete strategy must independently demonstrate
economic advantage. Member and joint eligibility bind their own assessed objects/scopes and cannot be inferred
from each other. Do not issue composition-only eligibility to independently ineligible members or standalone
operation authority to internal hedging legs.

In addition to member eligibility, independently admit the frozen composition selected by R&D and assess it
through the same native shared-account Backtest semantics. Independently validate joint operation and frozen
member-exit plans on protected data not exposed to research, rather than reusing the research-selected runs as
qualification evidence. Qualification owns the protected protocol and evaluation references; Market Data
supplies validated inputs and exposure lineage, and isolated Backtest executes them.

Prior exposure from member development, composition search, discovery and imported sources must be accounted
for; a different request or newly downloaded copy does not make seen data independent. Member passes do not
prove composition independence. If admissible protected evidence is unavailable, retain that state without
granting composition eligibility. This does not repeat each member's complete qualification automatically or
expose protected runs/results to research.

Consume the exact immutable R&D composition configuration reference; Qualification owns its assessment and
eligibility facts, not the configuration definition. Bind composition eligibility to its version/hash, member
hashes/Artifacts, account and allocation/risk configuration, protocol, data/cost/execution versions and
applicability scope. Assess the resulting whole-account composition before a candidate subset is adopted
alongside other running members. AB-only evidence cannot authorize AB alongside C/D without matching
whole-account scope coverage.

The account has one effective composition across trial/formal pools; assessed transition scope includes
protected residual exposure after unload. Individual passes cannot be assembled into a composition pass.
Composition identity neither rewrites strategy versions nor authorizes activation or allocation. Preserve
separate protected credentials, inputs, caches and outputs and binary permitted public feedback. Extend the
current single-Artifact candidate binding rather than interpreting its eligibility as evidence for arbitrary
compositions.

Assess preregistered joint-operation and member-exit plans before a new member joins. Eligibility coverage names
member versions, permitted transitions, allocation rules and capital/risk bounds backed by replay evidence, including
protected residual positions after unload. Separate the joint-entry comparison goal from exit continuation constraints;
a safe exit plan need not outperform the intact composition. A set of independent terminal runs does not prove
transition coverage. Missing/unverified states do not inherit eligibility, and mere formula equality does not establish
scope reuse. Preserve binary research feedback while providing Governance the permitted scope/evidence binding.

Deployment evidence also binds sizing templates/parameters, member-entry/waiting rules, initial capital,
account risk and execution configuration. Strategy hash alone cannot transfer a pass across funding conditions.
Isolated diagnostics remain research evidence, not a substitute for declared deployment-context assessment.
Uncovered policies/scopes require assessment. Handle trial-divergence evidence under frozen methods and decision
conditions without automatically changing thresholds, eligibility or authority, or exposing protected values.

## TARGET - Cumulative trial deflation at Candidate Intake

Research is bounded by spending, not a fixed trial count ([R&D](./rd/#cumulative-trial-accounting-and-spend-ceilings)); the more a lineage tries, the higher the bar its Candidate meets here.
Qualification applies that discount to a trial count it derives, never to one it is told.

- *What is deflated.* The selected exploratory result's daily non-annualized return series, using the
  preregistered versioned Deflated Sharpe method of Bailey and López de Prado. Its exact mathematics, return
  definition and reference vectors are bound by `deflation_method`; reuse an admitted deterministic calculation
  rather than another statistics framework. Deleted formation code is reference evidence only, not a required
  historical entrypoint or implementation ancestry. The native statistics integration remains unavailable until
  canonical-input and cumulative-count verification passes.
- *N.* The cumulative trial count: the sum of `trial_count` across the census frontiers the Candidate binds for its
  TrialFamily and its cross-family predecessors, plus every protected attempt in that lineage, since each consumed
  holdout is another look. Qualification recomputes it from those frontiers, and an incomplete frontier is
  `NOT_ADMITTED` as it already is.
- *The spread of trial ratios.* The sample standard deviation of the daily ratios of the lineage's
  `TERMINAL_RESULT` trials, which are exploratory evidence rather than protected, floored at a preregistered minimum.
  Trials without a terminal result count in N and add no ratio; with fewer than two terminal trials the floor alone
  is used.
- *The bar.* The protected decision policy version fixes the minimum deflated probability and the floor before any
  result is observed. A Candidate below it is `NOT_ADMITTED` as `DEFLATED_SHARPE_BELOW_POLICY` and reserves no
  holdout, so the deflation spends no protected evidence.
- *Determinism.* The statistic is a function of the canonical result bytes of each trial, and its probability is
  recorded in parts per million, floored, as the formation report records it. The bytes a trial's return series is
  read from are the ones its production build wrote.

The same-universe random control and the sealed holdout stay as specified above. The control is what still holds if
the count is understated; the holdout never returns detail to R&D.

**Implementation gap.** `crates/qualification` has no integrated cumulative deflation or native random-control
arm. Candidate-local holdout reservation does not establish complete cross-family attempt accounting. The native
path must consume the full R&D census and protected attempt lineage before admitting this assessment; neither a
historical formation calculation nor a caller-provided count proves that integration.

## Eligibility terminal status

This section is an implementation status record, not contract. It grants no permission by itself, and a step
listed here is not authority to build, deploy, or drive a protected evaluation. The contract below is unchanged by
whether a step has a caller.

**The eligibility terminal is driven by the ordered PostgreSQL gate and by nothing else.** Every step
is called from that gate's own entries, so a Protected Replay Request Set, an Attempt Frontier, a
Robustness Assessment and an Eligibility Fact all exist in the gate's database. The step list is the
Qualification and Backtest entries of the ordered array in `scripts/ci/test-rd-owner-postgres.bash`,
which stays their only list; no step has a caller outside it.

The gate constructs the Shared Time handoff that the first step needs from
`issue_protected_evaluation_shared_time_v1` in this repository's sealed-acceptance surface, not from
the deployment resolver. **The deployment resolver is still closed**, for the reason recorded under
the deployment-authorized terminal below, so driving the terminal in the gate is not evidence that a
deployment could drive it.

Two earlier entries still assert that Eligibility is absent, and they still pass, because the ordered
gate shares one database that is never reset and they run before the entry that commits the first
Eligibility Fact. **An absence asserted at entry `n` is an absence at entry `n`, not a property of
the Owner** - reading those two entries as "Eligibility never exists" is the misreading this
paragraph used to encode.

The steps are strictly serial. A V2 request is a V1 proposal plus a `ClockHeadHandoff`, and the
production shared-time resolver is built from `DEPLOYMENT_STORE_ADMISSION_MODE`, which stays
`disabled`. The gate does not use that resolver and does not need it:
`issue_protected_evaluation_shared_time_v1` issues the handoff on the sealed-acceptance surface, so a
V2 request, a non-empty request set, a terminal result, a closed frontier and an assessment are all
constructed there. Set sealing admits only `schema_version=2` members - Origin rows carry a different
canonical encoding and would strand the frontier - and the gate supplies `schema_version=2` members.

Admitting shared-time evidence into a **deployment** therefore remains the prerequisite for a
deployment-driven terminal. It is no longer a prerequisite for driving the terminal at all.

**TARGET - the deployment-authorized terminal, and what it waits for:** this terminal is TARGET, not
unfinished work. `DEPLOYMENT_STORE_ADMISSION_MODE` stays `disabled` until a deployment authority exists to issue
what `required` demands: a custodian signature history, an anti-rollback witness, a credential lease
and direct measurement. None of those exist here, and no real trading or production write is authorized, so a
resolver that yields nothing is the correct closed state rather than a defect.

Nothing else in Qualification waits behind it - the attempt frontier, the candidate and evaluation rules, and
the protected-replay custody above are separable work, and treating this terminal as a blocker on them was a
misreading of the dependency rather than a property of it.

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
- The exploratory path's Run Result is not an input to this Owner, and that is the design rather than a gap.
  This Owner evaluates only the results of its own protected requests, because an Eligibility Fact is what a
  qualification becomes, and a result this Owner did not request carries no frozen protected policy for it to be
  measured against. An exploratory Run Result is a report for a researcher to read.
- Operator Authorization is the upstream of the deployment-authorized terminal. What
  it must issue, and why this handoff is TARGET, is stated once under Eligibility terminal status and is not
  repeated here.
- Committed evidence changes may trigger re-evaluation; wake-up channels never replace owner fact reads.

Implementation status of these handoffs, which is a record and not contract. Only the Product Edge handoff has
a production caller: `resolve_or_create_for_basis` and `admit_in_transaction` are called from production code in
vibe-strategy-factory, and `admit_historical_projection_in_transaction` from its R&D custody path. The R&D Candidate handoff has none:
every call of `submit_candidate_intake_v1` outside this Owner is in one sealed acceptance test module. Backtest's half
of the economic measurement now has a delivery path and nothing driving it.

The frozen metric and coverage-policy references, with the unit and the scale, travel inside the request set
seal: `ProtectedReplayRequestSetSealDtoV1` carries the `ProtectedEconomicPolicyBundleV1` this Owner sealed, and `ResolvedProtectedReplayRequestSetV1::economic_computation`
resolves the computation from it. `economic_computation` has only two callers, both in tests. The ordered gate reaches measurement by reading the Candidate under this Owner's role, not through the seal; this is fixture discovery, not a Backtest path.

The grant that would let Backtest read `qualification_protected_economic_policy_bundles_v1` directly stays revoked, and the seal makes it
unnecessary. What remains upstream is that no production code constructs a `ProtectedEconomicPolicyBundleV1`: its four
construction sites all sit inside test modules. The separation from the exploratory path is closed on three
layers, measured rather than assumed. No source of this Owner names `backtest_replay_results_v2`,
`backtest_replay_result_receipts_v1`, or `resolve_exploratory_replay_result_v2`/`_v3`, while `backtest_protected_replay_results_v1` is named four
times. `EXECUTE` on both exploratory resolvers is granted to `rd_owner` alone, where the
protected counterpart is granted to `qualification_writer`.

And `backtest_replay_results_v2` has six readers, none of them this Owner, so its absence here is a boundary rather
than a dead relation.

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
- `TARGET` - to [Backtest](./backtest/): one Forward Replay request per newly observed cut of a registered Forward
  Record, bound to the registration's exact identities. A request this Owner did not create is not a forward request.
- `TARGET` - to [Strategy Governance](./strategy-governance/): the current Forward Decision with exact Forward
  Registration and Eligibility Fact versions. Only `FORWARD_ADMITTED` with a current `QUALIFIED` Eligibility State
  permits a paper `INITIAL_ACTIVATION` proposal; every other, missing or unknown decision permits none.
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

Missing or mutable preregistration; a missing, mutable, non-exhaustive, or late-divergent TrialFamily Census
Frontier; unresolved predecessor correlation; a late independence basis; or incomplete feedback, attempt, and
cumulative holdout frontiers produce `NOT_ADMITTED` before evaluation and consume no holdout. A missing
or mismatched protected decision-policy identity/version or Protected Robustness Plan also produces
`NOT_ADMITTED`. Qualification creates a frozen Protected Replay Request only after the write-once
request-correlated `ADMITTED` receipt and holdout reservation, and repeats that exact policy pair
and plan identity.

The request is never rejected in place: any Backtest admission rejection after creation commits a
request-bound `RUN_REJECTED` Protected Run Result. Qualification verifies exact request-to-result
equality for Artifact, PIT scope, PIT Market Snapshot identity, snapshot rule, replay configuration, Runtime
kernel, simulator, cost, slippage, capacity model, Protected Robustness Plan, and plan-cell identity. Any
omission, substitution, or mismatch is `INVALID_REPLAY_EVIDENCE`, closes under preregistered holdout treatment, and
emits no Eligibility Fact.

Before reserving holdout, Candidate Intake validates the submitted plan against the exact Qualification-owned,
versioned robustness-adequacy policy. Time coverage requires at least two non-overlapping preregistered windows;
regime coverage requires at least two materially distinct regimes including a non-favourable/adverse regime;
instrument non-applicability is permitted only for a frozen single-instrument scope; perturbations cover every
material input class; and every tunable parameter has bounded neighbours or an accepted no-tunable-parameter basis.
An inadequate or policy-mismatched plan is `NOT_ADMITTED` and never reserves holdout.

The plan includes a Qualification-owned, versioned independent random-control definition. Qualification
freezes the sampling basis, seed, instrument universe, windows, draw size and comparison margin before any result.
The native path binds exact control packages or deterministic calculation inputs, package/environment identity and
Market Data manifests. Reuse native replay and existing mathematics; there is no requirement to synthesize a
primitive graph, compile an IR or build a general random-strategy generator.

A control is valid only for its declared comparison scope. Arbitrary Python strategies have no implied finite
program universe. Qualification must state what the control samples and what a passing comparison establishes.
The evaluated Agent cannot choose the protected control or alter its margin from observed outcomes. An absent or
unimplemented control, wrong definition/version/universe/windows or a result-dependent margin is `NOT_ADMITTED`
and reserves no holdout. Definition and input validity must be established before execution; actual control results
must be request-bound. A control's definition alone is not execution evidence.

The existing graph-program compatibility profile uses a sealed `vibe-indicators-kernel` catalogue digest,
input roles and graph bounds, with deterministic synthesis through its Composer/lowerer. Its exact catalogue
and comparison limits remain part of that profile; it is not a native-package prerequisite. The native control
integration remains unavailable until independently verified. Trial deflation and sealed holdout remain separate
protections; a random comparison does not excuse an incomplete or understated trial census.

For a request-equal `TERMINAL_RESULT`, Qualification first consumes Backtest's complete finite non-empty
protected `diagnosticCategorySet`, content digest, and per-category decisive evidence. It preserves all
independently supported members, then validates one duplicate-free subset of the canonical category set before
applying any per-category disposition. Empty, duplicate, unknown, `NO_EXECUTION_DEFECT`-mixed, or
`UNRESOLVED_FAILURE`-mixed input closes as `DIAGNOSTIC_UNRESOLVED`.

Only a structurally valid set containing `MARKET_DATA`, `ARTIFACT`, `RUNTIME_KERNEL`,
`BACKTEST_OPERATIONAL`, `SIMULATOR`, or `REPLAY_CONFIGURATION` closes as `DIAGNOSTIC_INVALID`;
`UNRESOLVED_FAILURE` closes as `DIAGNOSTIC_UNRESOLVED`; neither creates an assessment or Eligibility Fact.
`BACKTEST_OPERATIONAL` remains a sealed Backtest runner/service category: Qualification closes holdout custody
but returns neither its operational evidence nor protected detail to R&D, Product Edge, or Governance. A set
containing `VALID_ECONOMIC_FAILURE` without a defect must produce a failed assessment and `INELIGIBLE`.

`UNRESOLVED_FAILURE` and `NO_EXECUTION_DEFECT` are each valid only as singleton sets, and only singleton
`NO_EXECUTION_DEFECT` may proceed to a passing assessment. Qualification first resolves the exact sealed
Backtest per-cell results against its frozen plan into one complete, duplicate-free result census. The
resulting assessment atomically embeds its census-finalization proof, bound to the frozen stop and
missing-cell policies, assessment-stage Time Evidence, and a sealed Backtest attempt frontier proving no
requested cell remains nonterminal; without that proof no assessment exists and the attempt stays
`IN_PROGRESS_OR_UNKNOWN`.

It derives the complete Protected Robustness Assessment under the frozen adjudication and protected-decision
policy versions. The assessment repeats the exact frozen plan-cell-set digest and accounts for every
plan-required cell exactly once; an axis may contain multiple cells. An explicit pre-result non-applicability
basis becomes `NOT_APPLICABLE_ACCEPTED` only when that policy accepts it; missing, stale, rejected, or
policy-mismatched basis is `NOT_APPLICABLE_REJECTED`. Any missing, duplicate, unknown, request/result-mismatched,
or policy-mismatched cell-or an all-not-applicable census-is `INCOMPLETE_INVALID` and commits
`ASSESSMENT_INVALID` with preregistered holdout closure and no Eligibility Fact.

A complete census is `COMPLETE_PASS` only when the plan was admitted as `PLAN_ADEQUATE`, the
diagnostic set is singleton `NO_EXECUTION_DEFECT`, at least one cell is applicable, every applicable cell
passes, and every non-applicable cell is accepted; any applicable failure or rejected non-applicability is
`COMPLETE_FAIL`. `COMPLETE_PASS` produces `QUALIFIED`; `COMPLETE_FAIL` produces
`INELIGIBLE` under the frozen policy. The Eligibility Fact repeats the exact intake, policy pair,
plan, request, result, verified equality, cell census, coverage, tolerances, thresholds, aggregation, and
missing-cell disposition.

The Protected Robustness Assessment declares `PROTECTED_EVALUATION` as its canonical `timeEvidenceCutKind`,
directly binds every admitted result-stage Time Evidence, and seals one assessment-stage cut. Qualification rejects
missing, expired, unproved or mutually incomparable epochs, skipped-stage, or non-advancing Time Evidence before
categorical assessment and before any holdout closure or Eligibility write. A direct proved request-to-result epoch
transition is valid, but every result in one assessment shares one result epoch and the assessment advances there.

A terminal `RUN_REJECTED` or `INVALID_REPLAY_EVIDENCE` produces `REPLAY_REJECTED` or `REPLAY_INVALID`:
Qualification binds the intake, request, result, and preregistered holdout closure, emits no Eligibility Fact,
and never calls it `INELIGIBLE`. Only `IN_PROGRESS_OR_UNKNOWN` projects `EVALUATING` from the
unchanged `ADMITTED` receipt and protected request while holdout custody remains reserved and
counted in the cumulative frontier. `REVOKED` is reserved for a previously effective qualification
that later loses validity.

The Eligibility State module owns `INELIGIBLE`, `QUALIFIED`, `EXPIRED`, and
`REVOKED`; attempt-only `ASSESSMENT_INVALID` is not an Eligibility state. A revocation transition
informs Governance but does not cancel orders itself.

Eligibility replay is frontier-bound. The same Fact identity and content digest join without extending its
effective interval or `valid-through`. Changed state, interval, predecessor, policy, evidence, or frontier under
the same identity is conflicting replay. Renewal creates a new immutable Fact that binds its predecessor and a
new interval; once a successor, expiry, or revocation becomes the Qualification head, the predecessor can never
be current again. Governance may consume one still-current Fact once per distinct authorized lifecycle request,
evaluation, and decision frontier, while duplicates inside that frontier join and never restore capital.

## Protected feedback resolution and coverage

### Pre-Research protected-feedback resolution

Qualification accepts no caller assertion of genesis, emptiness, or current feedback. It directly resolves the
exact R&D Independence Basis Receipt, locks its complete durable history for the trusted principal and Research
request scope, and commits one genesis frontier only when that history is empty. Existing history returns the
complete current opaque frontier; missing, stale, malformed, conflicting, cross-principal, cross-scope, or
cross-basis input returns `UNAVAILABLE` and creates no frontier transition.

Ordinary create, resolve, and in-transaction admission accept no caller time. After direct basis resolution,
the principal/scope advisory lock, and complete canonical Qualification history verification, Qualification
samples PostgreSQL `clock_timestamp()` inside the same transaction. Existing-read freshness uses that Owner
cut. A new projection takes its single sample at the final write edge and uses only that cut for projection
time, half-open `valid_through`, receipt commit time, and their identities and digests.

After persisting and canonically rereading the new history, Qualification samples a distinct Owner response
cut immediately before freshness validation and commit; crossing `valid_through` rolls back projection,
head, and outbox atomically.

The projection exposes only its resolution state, opaque frontier reference and digest, basis reference and
digest, principal, scope, source sequence/cut, clock epoch, projection time, and half-open validity. It contains no
protected payload, outcome, measurement, parameter, holdout detail, or dereferenceable evidence. Any later
protected-feedback write must repeat the precommitted basis relation. Same basis and canonical source cut replay
byte-identically; a changed basis or source cut cannot join.

#### Protected-feedback generation

Each principal/scope history carries one protected-feedback generation: a count of the public Qualification phase facts
that history has produced, which the projection states as its source sequence. It is the observation frontier the
Qualification Status Summary advances, so a Research Intent frozen under one projection can tell, at a later Owner cut,
whether any protected evaluation has since become observable to it.

- **What advances it:** the first commit of each public status phase fact whose candidate's protected-feedback frontier
  belongs to the history: `NOT_ADMITTED`, `ADMITTED`, `EVALUATING`, `CLOSED_NOT_QUALIFIED` and `QUALIFIED`, one step
  each. A phase fact is what R&D can observe of a protected evaluation, so it is what the generation counts. A replayed
  phase fact does not advance it.
- **What does not:** a projection's creation or renewal, the ten-minute validity window, a read, and the incident
  reconstruction. A renewal takes the generation as it stands, so time alone never changes it.
- **Atomicity:** the step is written in the transaction that commits the phase fact, under the principal/scope lock and
  the history's head row lock that projection writes also take. Every protected closure, attempt disposition and
  assessment alike, commits its phase fact in its own serializable transaction, together with its read of the Protected
  Replay Attempt Frontier, so the generation, the phase fact and the protected state it records commit or roll back as
  one.
- **Evidence for every step:** each step is one append-only row naming its history, its generation and the phase fact
  that caused it, numbered from one without a gap. The head's source sequence is the history's latest generation, and
  its source cut is `qualification-protected-feedback-cut-v1-<generation>`, of which the genesis cut is generation zero.
  History verification requires the head to equal the latest logged step, each logged step to name a stored phase fact
  of that history, and each projection's source sequence to be no greater than its successor's; a generation that no
  phase fact accounts for fails verification.
- **Currentness:** a projection is current only while it is fresh and its source sequence is the history's generation.
  `resolve_or_create_for_basis` renews a fresh projection whose generation has been passed, and `admit_in_transaction`
  refuses it as stale. Candidate intake reads a candidate's feedback frontier the same way: it is current only while it
  is the history's head, fresh at the intake cut and stating the history's generation, so a candidate whose frontier a
  phase fact has passed is `NOT_ADMITTED`. `admit_historical_projection_in_transaction` still reads a projection at its
  own cut.
- **Read without renewal:** `read_protected_feedback_generation_in_transaction` answers, for the projection a caller
  froze, its history's current generation and source cut, and nothing else. It takes the history's head row `FOR SHARE`
  in the caller's read-committed transaction, so the answer holds until that transaction ends, and it neither checks the
  projection's validity window nor writes anything, so a caller past the window reads it without bringing the window
  back or causing a Qualification write. Its SQL function grants `EXECUTE` to `rd_owner` alone. A caller compares the
  source cut it froze with the one it reads: unequal means a phase fact of that history became observable after the
  freeze.
- **A candidate's own phase facts count:** once a Research request's own candidate enters Qualification, its first phase
  fact, `ADMITTED` or `NOT_ADMITTED`, and every later one advance the generation the request froze. That is intended:
  once Qualification has observed the candidate, iterating on it goes through a new freeze. Two consequences rest on
  work outside this Owner and hold only once it lands. R&D refuses a continuation whose frozen source cut the
  generation has passed through its continuation check, which comes after slice 1. Further iteration goes through a
  successor Intent that freezes the current projection under its family's basis, which is slice 1, qOeOp/trade#1197.
  Until slice 1, a successor copies its predecessor's projection and therefore its frozen source cut.
- **Counted from its deployment:** phase facts committed before the generation existed are not counted, and no step is
  reconstructed for them. At its first deployment every history's generation is zero even where protected evaluations
  already happened, so a generation compares two moments after that deployment and says nothing about the history before
  it. An Intent frozen before the deployment froze the genesis cut, and the first phase fact of its history after the
  deployment makes its continuation refuse: the comparison errs toward stopping.

### Verification coverage and limits

#### Protected-feedback resolution

Resolution has three paths: a fresh projection for the same basis rejoins without writes; an unprojected basis under an empty scope takes `GENESIS_EMPTY`; an unprojected basis under a scope with a canonical frontier takes `FRONTIER`. Genesis commits sequence zero at the canonical genesis cut with no source frontier.

`second_request_under_one_principal_resolves_through_the_frontier_arm` covers one deployment, principal and authorized scope with two separately admitted requests. Both are `Accepted`, each owns its basis, and the second projection is `FRONTIER`. Evidence: owner-chains run `35654451152`, 190 passed, 94 entries. The ordered prerequisite `catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds` supplies the Catalog head; an isolated subset that omits it does not prove the complete path.

A scope's first authorization is genesis; later authorizations use `issue_successor`. Admissions bind exact request identities, and equal suffixes cannot create distinct authorization meanings. `Result::is_ok` is not acceptance evidence: `SubmittedOrUnknown` requires `ResolveSameRequestIdentity` and authoritative resolution/store readback. A warning or transport success never proves admission.

#### Response-cut rollback

Rollback requires the response cut to fall outside the projection's half-open validity window. The expiry boundary is `valid_through`; a cut before the projection requires a backwards server clock. Creation or renewal provides the branch precondition. Mutating `valid_through_epoch_ms` breaks canonical projection equality and is refused as `Qualification admission envelope projection mismatch`.

`owner_clock_epoch_ms_in_transaction` reads schema-qualified `pg_catalog.clock_timestamp()` twice in the same transaction. `qualification_writer` is not a superuser and has no `CREATE` on `public` or `rd_owner_api`, preventing a shadow clock. `PROJECTION_VALIDITY_MS` is ten minutes with no override. A harness may vary real elapsed time; injected clocks, canonical-row tampering or production changes are not admitted substitutes. This section records coverage limits, not permission to alter the clock contract.

## Closed and optional compatibility interfaces

### Closed incident reconstruction interface

The feature-gated `qualification-owner-incident-v1-01a02194-139a-7281-9d2b-a87ab29d67ba` interface is sealed to one
incident under `DETERMINISTIC_CANONICAL_RECONSTRUCTION_NO_BACKUP`. Its original evidence resource is unavailable,
so it cannot currently execute or re-prove reconstruction. It is not a general restore/import API or a native
Qualification prerequisite. Fixtures cannot replace the sealed resource.

Its four exact resource locators, original identities, target cluster/database/role checks, canonical evidence
verification, atomic write/replay semantics and separate executable-effect authority remain unchanged. Callers
cannot supply reconstructed rows, timestamps, digests, genesis state or freshness. No new validity or domain wake
may be minted; the original half-open interval leaves the ordinary current-cut resolver `UNAVAILABLE`.
The target acceptance checks that this interface remains closed and cannot widen authority, rather than requiring
a new recovery feature or reproduction of an unavailable developer-local resource.

### Optional Forward Record - unavailable

Forward Record is isolated record-only simulation evidence, not a required step on the
[backtest qualification, real trial and promotion route](../scenarios/research.md#qualified-backtests-real-trading-trials-and-promotion).
It cannot replace real trial returns, create a trial permit or promote a strategy into the formal pool. Qualification
owns backtest eligibility and protected facts; Governance owns promotion stage, authorization and allocation;
Runtime/Risk/Execution own actual operation and trading facts. The new route cannot silently alter sealed interfaces.

This section states a contract with no implementation; it grants no permission to build, deploy, or drive a
forward record.

A Forward Record starts only from a current `QUALIFIED` Eligibility Fact and ends in one terminal Forward Decision. It
is record-only: it creates no Strategy Instance, Runtime generation, trade intent, order command, or Execution effect,
reads no credential, and holds no capital. Governance consumes its decision; it never runs Governance's chain.

A write-once Forward Registration, committed before the first forward cut, binds:

- the exact Eligibility Fact, Candidate, Artifact and protected policy pair;
- the Runtime kernel, simulator, cost, slippage and capacity-model identities of the qualifying Protected Replay
  Request;
- the instrument and venue scope and the decision cadence;
- an interim date and a decision date;
- kill lines and admit lines, each with how it was derived (for example, percentiles of a stated number of
  block-bootstrapped paths of the qualifying weekly stream, with the block length), and any minimum closed-trade
  count;
- an exact frozen `ForwardDecisionMethod`, its parameters and the forward start cut.

No field changes once the first forward cut is recorded. A changed registration is a new registration with its own
record, and both are reported.

A registration chooses a deterministic, versioned `ForwardDecisionMethod` before observations. A Wald
sequential probability-ratio test on weekly returns is one possible policy instance, not a mandatory engine or
unspoken default. A policy choosing it explicitly freezes the hypotheses, return distribution assumptions,
alpha, beta, haircut, dispersion and observation unit. No implicit half-Sharpe or threshold applies; changing
method or parameters creates a new registration rather than reinterpreting observed evidence.

Only a separately admitted Forward Record profile may require stateful replay across new cuts. It does not add
resume/checkpoint infrastructure to V0.1, or gate Candidate Intake, backtest eligibility or real trial entry.
Backtest replays the frozen Artifact on each newly observed point-in-time cut (Forward Replay) on exactly the
registered identities, with the order types (limit, stop, validity and expiry, cancel) and decision cadence
that qualified it. Resting orders and open positions carry from one cut to the next in Backtest custody, a
fill is admitted only from data observed after the order existed, and slots and occupancy follow fill order
because the one simulator that resolves them for the backtest resolves them here. A log of signals is not a
Forward Record: it cannot hold a resting order, and it scores a signal whose stop or target had already
traded.

A separate signal scorer cannot replace stateful native execution evidence. Each consumed cut is processed
once in causal order; slots, fills and occupancy come from the same simulator, not an independent harness.
Scheduling and persistence of this optional profile are unimplemented and require separate admission.

Each record ends in one terminal Forward Decision:

- `FORWARD_KILLED`, at any cut where a kill line or the kill bound is crossed; it also commits `REVOKED` on the
  Eligibility Fact, with the forward kill as its cause;
- `FORWARD_ADMITTED`, at the decision date or at the scale-up bound's admit review, when every admit line holds; it
  means only that the candidate may be proposed for paper activation;
- `FORWARD_WITHDRAWN`, when the record ends for any other reason, such as an expired or revoked Eligibility Fact, a
  replaced registration, or a source that stopped.

The interim date checks kill lines only. A decision date that finds neither a kill nor every admit line holding commits
`FORWARD_CONTINUES` with the next registered date, a phase fact rather than a terminal decision. Killed and withdrawn
records are kept, never deleted.

Qualification reports every Forward Registration with its current phase or terminal decision, and any report of
admitted candidates states the whole registered census and every outcome, so incubation bias cannot select survivors
by omission. The forward record and its measurements are protected like any Qualification result: R&D sees only the
public phase (`FORWARD_RECORDING`, `FORWARD_CONTINUES`, `FORWARD_KILLED`, `FORWARD_ADMITTED`, `FORWARD_WITHDRAWN`), and
each first commit of one is a public phase fact that advances the candidate's protected-feedback generation.

Forward Replay needs what the product does not yet supply in deployment: point-in-time cuts as the data arrives, which
needs the Market Data Owner clock to follow intake; a quote cut for each frame's fills; multi-frame replay; and, for
rules with resting orders, the product path's limit entry with an expiry, take-profit and target ladder, and stop and
target fill reconciliation.

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
  PostgreSQL gate and by nothing else. Its entries and the sealed evidence that admits each terminal are the
  Qualification rows of the ordered array in `scripts/ci/test-rd-owner-postgres.bash`, and that array stays
  their only list; the two behaviours the gate cannot reach are recorded under Behaviours the ordered gate
  cannot reach below.
- **CURRENT_PARTIAL - Pre-Research protected-feedback resolution:** this is the one capability with production
  callers. `resolve_or_create_for_basis` and `admit_in_transaction` are called from
  `crates/strategy_factory/src/product_edge_postgres.rs`, and `admit_historical_projection_in_transaction` from
  `crates/strategy_factory/src/rd_owner_postgres_custody.rs`, all outside any test module. Its readback proof is
  an ordered-chain entry; the response-cut rollback has none, for the reason recorded under Behaviours the
  ordered gate cannot reach below.
- **TARGET - Eligibility State:** the module owns `INELIGIBLE`, `QUALIFIED`, `EXPIRED`, and `REVOKED`, and only
  the first two have any implementation. `EligibilityState::Expired` and `::Revoked` in
  `crates/strategy_governance/src/model.rs` have no producer anywhere, `QualificationPublicStatusV1` carries five
  variants and neither of those two, no relation named for expiry or revocation exists among this Owner's
  `qualification_*_v1` tables. The consumer type exists in
  Governance and every `UntrustedEligibilityReadback` is constructed in that crate's own tests, so the shape of a
  read port is present while nothing on either side has written such a fact.

  A successor chain does now prevent predecessor revival. An Eligibility Fact binds its predecessor and
  its own half-open window, and `predecessor_eligibility_identity` is UNIQUE, so a Fact can be superseded
  at most once. Two properties this Owner publishes for the current Eligibility State are still
  unavailable, and naming which is the point of recording them. The economic-condition version needs no
  new production: a Fact cross-binds the protected decision-policy identity and version, and
  `ProtectedEconomicPolicyBundleV1` carries the same pair, so a State that references its Fact has it.
  The evaluated cost and capacity-model version has no producer at all. `cost_model_identity`,
  `slippage_model_identity`, and `capacity_model_identity` arrive from Candidate Intake as bare strings
  with no version and no digest beside them, while other identities in that same structure do carry
  digests, so this is an absence rather than an unread field. Its supplier is Candidate Intake, and it is
  in place when a version or a digest appears beside those three. A column that could only hold NULL is
  deliberately not added, because a downstream NULL cannot distinguish a model with no version from a
  record that did not compute one from a reader who may not see it.

  Expiry and revocation are not Fact rows. A Fact cross-binds an exact Protected Replay Request and an
  exact `TERMINAL_RESULT` Protected Run Result, and an expiry has neither, so it cannot satisfy what a
  Fact is. Their relation is the one recorded as missing above. Operator Authorization has already solved
  the same shape with `operator_authorization_revocation_frontiers_v1` and
  `operator_authorization_revocation_heads_v1`, and that pair is the shape to follow rather than design
  again. A revocation frontier is deliberately not built for this Owner today, and the reason is that
  nothing consumes one, not that the shape is wrong.
- **TARGET - the deployment-authorized terminal:** `DEPLOYMENT_STORE_ADMISSION_MODE` stays `disabled`, and what
  it waits for is recorded under Eligibility terminal status above.
- **CURRENT, and permanently unprovable - Incident-specific Owner reconstruction:** the machinery is merged -
  `crates/qualification/src/recovery.rs`, exported as `run_owner_recovery_cli` and shipped as the
  `qualification-owner-recovery` binary behind the `owner-recovery` feature - and its only proof can never pass.
  The measurement is recorded under Incident-specific Owner reconstruction below.
- **TARGET - same-universe random control:** the handoff recorded under Failure and recovery below is declared
  and has neither a producer nor a consumer. Nothing publishes a control-set definition, nothing synthesizes
  comparison programs from one, and `crates/qualification` has no comparison arm. The order in which it must be
  built is part of that clause, not a note on it.
- **TARGET - Forward Record:** no Forward Registration, Forward Replay request, Forward Decision or forward census
  exists, and Eligibility has no forward-kill revocation cause. The contract is under TARGET - Forward Record below.

## Decision contract

- **Inputs** - a selected Candidate with exact Agent selection record and frozen version lineage, exhaustive TrialFamily Census,
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
- The closed incident interface remains feature-gated and unavailable without its original sealed resource.
  No caller facts, copied target identity or fixture can authorize reconstruction, refresh validity or create a
  general recovery route; the ordinary resolver remains unavailable under the original interval.
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

Qualification persists intake, holdout reservation/consumption, protected request/result correlation,
robustness assessment, attempt disposition, Eligibility, expiry, and revocation as its native audit chain.
Shared telemetry contains only the public terminal outcome, a type-opaque non-dereferenceable fact reference,
and source-frontier freshness. Protected phase, latency, terminal timing, and timing-derived fields are
forbidden. `REPLAY_REJECTED`, `REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`,
`ASSESSMENT_INVALID`, and `INELIGIBLE` all project byte-equivalently as `CLOSED_NOT_QUALIFIED`;
`QUALIFIED` remains exact.

Protected measurements, parameters, cell outcomes, holdout contents, internal terminal dispositions, negative
reasons, and evaluator detail never enter Event Rail, traces, logs, metrics, alerts, or Dashboard. In
particular, no internal `INELIGIBLE` event exists outside Qualification. Dashboard totals distinguish
only `QUALIFIED`, `CLOSED_NOT_QUALIFIED`, expired, and revoked; all negative protected terminals share
byte-equivalent labels and aggregates.
