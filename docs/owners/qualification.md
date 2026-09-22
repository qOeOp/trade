# Qualification

## Responsibility

Independently decide whether a frozen candidate satisfies preregistered evidence, holdout, cost, capacity, and operational conditions. Qualification owns deployability evidence, not strategy design, activation, or recovery.

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
  `qualification_*_v1` tables, and no successor chain prevents predecessor revival. The consumer type exists in
  Governance and every `UntrustedEligibilityReadback` is constructed in that crate's own tests, so the shape of a
  read port is present while nothing on either side has written such a fact.
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

## Behaviours the ordered gate cannot reach

This section is an implementation status record, not contract. Both behaviours below are implemented; what is
absent is a proof, and each absence was measured rather than assumed.

- **First create and `GENESIS_EMPTY`.** No admitted R&D request can exist without its frontier: R&D obtains the
  projection through Qualification's sealed admission API while forming the TrialFamily policy, so every basis the
  gate holds is already projected, and no Qualification entry can itself be the first create. A lineage that skips
  the Qualification resolve fails at once, which is how that was measured. The branch's committed shape is no
  longer unproven: the protected-feedback readback entry asserts that the projection it reads back is
  `GENESIS_EMPTY` at sequence zero on the canonical genesis cut with no source frontier, four properties the create
  branch alone writes, and reverting the first of them fails that entry against a gate-populated store. A local run
  of the whole chain leaves twenty projections, every one of that shape and none of them renewed. What stays out of
  reach is the branch's condition. Resolution has three paths, not two: a basis whose own projection is still fresh
  replays and writes nothing, a basis with no projection under a scope with no frontier takes the genesis arm, and
  a basis with no projection under a scope that has one takes the `FRONTIER` arm. The gate has taken the genesis
  arm twenty times and the `FRONTIER` arm never, so nothing has ever produced that resolution, its stored encoding,
  or a source-frontier identity and digest. Until something does, taking the genesis arm and having no other arm to
  take are the same observation. Driving the other arm needs a second Research request under one principal and
  authorized scope. The gate had never had two requests sharing a principal, because every entry bootstraps its
  own admission under `admin-{suffix}`, so each carries a principal of its own and every scope has seen exactly
  one request. That is a property of the corpus, not of the production path, and underneath it sits a condition
  that is a property of the production path: a scope's first authorization is a genesis and every later one must
  be a successor, so two admissions sharing a scope need `issue_successor`, and the admission bootstrap issues
  only `issue_genesis`. Both were measured by driving them: two admissions under one suffix are refused as a
  conflicting replay because the authorization identity is keyed on the suffix, one admission cannot serve two
  requests because an admission is bound to the request identity it was issued for, and two admissions under one
  principal are refused because the scope already has a genesis.

  Those two are not what keeps the arm unreached. This ledger previously recorded that they were, and that the
  second basis would be written by the same `load_or_create_basis_in_transaction` the first one used. That was
  read off the code rather than driven, and driving it refutes it. `second_request_under_one_principal_is_refused_before_the_lineage_advances`
  supplies exactly the missing configuration - one deployment, one principal, one authorized scope, two requests,
  each with an admission of its own - and no second basis is written. The second request meets that function's
  `head_lineage == lineage_digest` branch, which is written for a replay of the request that created the head: it
  looks up basis-stage custody under the request identity it was handed, finds none for a request it has not
  seen, and refuses with `Owner storage unavailable: R&D basis-stage custody missing`. The `FRONTIER` arm sits
  past that branch and is reached only once the lineage has advanced, which needs the first request to complete.
  **The arm is reached.** On the ordered gate both requests are `Accepted`, the second writes a basis of its
  own, one principal carries two protected-feedback projections, and the second projection's resolution state
  is `FRONTIER` (owner-chains 35654451152, 190 passed, 94 entries). Until that run nothing had ever produced
  that resolution, its stored encoding, or a source-frontier identity and digest, so taking the genesis arm and
  having no other arm to take were the same observation; they are now distinguishable.

  An earlier draft of this paragraph said the opposite twice, and both errors came from the same place. It said
  no second basis is written, and that the first request cannot complete because no Catalog V3 head is
  published so the arm's precondition is an operator action. Both were measured on a four-entry local subset
  that had skipped entry 69, `catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds`,
  which publishes the head before this entry runs. The skipped-upstream artefact did not announce itself as
  one: its recorded symptom is a panic on a line reading an upstream table, and this refusal instead read as a
  clean domain conclusion.

  Neither refusal reaches the caller as an error. Both are returned as `Ok(unresolved_result_v2(..))`, one of the
  twenty-eight such returns `product_edge_postgres.rs` carries, so `submit_v2` answers `SubmittedOrUnknown` with
  `next_legal_action = ResolveSameRequestIdentity` and the reason goes only to a `tracing::warn!` that the gate
  installs no subscriber for. A caller asserting on `Result::is_ok` sees a submission it has every reason to read
  as accepted. The entry above therefore asserts on the resolution and on the store, never on `Ok`, and it is
  written to fail when this improves: whatever lets the lineage advance turns it red, and that red is the signal
  to rewrite it as an assertion about the arm rather than about the refusal.
- **Response-cut rollback.** Driving it needs a create or a renewal, so it needs a current frontier that is absent
  or expired. Aging a projection's `valid_through_epoch_ms` desynchronizes it from the canonical row the readback
  verifies, which fails as `Qualification admission envelope projection mismatch`, so the Owner forbids the only
  way to force it. The test-only timing hook that existed solely for this was removed rather than left dead. What
  is missing is not the precondition. The ordered gate reaches the create branch routinely: a local run of its
  first fifty-seven entries left seventeen projections behind, every one a `GENESIS_EMPTY` first create for a
  distinct principal and scope, so an absent frontier is the ordinary case rather than something a harness has to
  manufacture. What no harness controls is the crossing. The rollback fires only when the response cut leaves the
  projection's half-open validity window, whose reachable edge is `valid_through`; its other edge is a response
  cut earlier than the projection, which needs the server clock to step backwards. Both cuts are taken by
  `owner_clock_epoch_ms_in_transaction`, which reads `pg_catalog.clock_timestamp()` twice inside one transaction;
  the call is schema-qualified, so no function reachable through `search_path` can displace it, and the ordered
  gate separately asserts that `qualification_writer` is no superuser and holds `CREATE` on neither `public` nor
  `rd_owner_api`, so the role cannot install a shadowing clock. The window is the private
  `PROJECTION_VALIDITY_MS`, ten minutes, with no override. What a harness can still vary is therefore only real
  elapsed time inside the transaction, at ten minutes per attempt; everything cheaper is a production change, for
  which this Owner has no admitted slice.

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

The plan also carries a same-universe random control, and this Owner defines it. Same universe means one exact
`vibe-indicators-kernel` catalogue digest, one input-role set, and one set of graph bounds - three quantities the
repository already freezes, so the control introduces no new concept. Qualification fixes the seed, the instrument
universe, the preregistered windows, and the draw size; R&D synthesizes the comparison programs from that
definition, because it holds the Composer and the lowerer and this Owner holds neither; Backtest replays them and
returns their series. The division is not a convenience: a control set the evaluated side can influence is not a
control, so the definition cannot come from that side, while synthesis can, because a seed and a universe leave
nothing to choose. Adequacy requires the draw size the versioned policy sets together with a preregistered margin
in the metric's own unit and scale. A plan that omits the control, takes its definition from anywhere but this
Owner, draws from a different catalogue digest, universe, or window set, or fixes its margin after any result is
observed is `NOT_ADMITTED` and never reserves holdout.

The control's strength is bounded by that catalogue version, and the bound is stated rather than implied. The
catalogue carries no square root, variance, correlation, or rank, so volatility-normalized and cross-sectional
factors are not expressible in the universe: a Candidate that passes this control is shown to be better than a
sample drawn from one catalogue, not better than every factor. Each primitive family the catalogue gains raises
that bound.

This answers a question the trial-count corrections on the formation path cannot. Those deflate a selected result
by the number of trials the searcher reports having run; this compares the Candidate against arbitrary programs
expressible in the same catalogue over the same data, drawn to a definition the searcher did not write. The first
stops being a correction when the trial count is understated. The second does not, which is what a protected
evaluation is for.

The handoff is built in the order definition, synthesis, replay, and the order is a prohibition rather than a
preference. Neither the synthesis side nor the consuming side is built before Qualification publishes a
control-set definition, because a consumer built against a definition that does not yet exist cannot be
falsified. This Owner has already done it once: every step of the eligibility terminal was merged
before anything called it, and stayed that way until the ordered gate's entries were written.

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
