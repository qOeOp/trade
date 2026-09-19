# Backtest

## Responsibility

Replay frozen strategy artifacts against admitted historical facts with production-equivalent trading semantics. Backtest owns what was actually consumed and what happened in replay; it does not decide whether a result is deployable.

## Authoritative facts owned

- Replay identity, deterministic clock, frozen inputs, runtime and simulation versions, and configuration digest.
- Canonical orders, fills, positions, costs, and outcome produced by a replay.
- **TARGET:** the complete ordered shared-kernel semantic trace, binding normalized lifecycle events, checkpoints,
  primitive and plugin results, target/protection transitions and fill reconciliation to the canonical replay.
- Complete separation between exploratory runs and Qualification-requested protected runs.
- Exploratory Run Result repeats the consumed Strategy Artifact, requested PIT scope, PIT Market Snapshot,
  Universe Selection Record and correction rule, replay configuration, Runtime kernel, simulator, and cost,
  slippage, and capacity-model identities so Research can verify exact request-result equality.
- Every terminal exploratory result commits a complete finite `diagnosticCategorySet` under a bound
  diagnostic-policy version. Supported members are `NO_EXECUTION_DEFECT`, `MARKET_DATA`, `ARTIFACT`,
  `RUNTIME_KERNEL`, `BACKTEST_OPERATIONAL`, `SIMULATOR`, `REPLAY_CONFIGURATION`, `VALID_ECONOMIC_FAILURE`, and
  `UNRESOLVED_FAILURE`. It preserves every independently supported simultaneous category and binds each member's
  decisive evidence cut. `NO_EXECUTION_DEFECT` cannot coexist with a defect category; ambiguous or non-isolating
  evidence is `UNRESOLVED_FAILURE`, never a guessed defect or economic result.
- `BACKTEST_OPERATIONAL` binds the exact operational-profile identity and version, run-attempt identity,
  runner/service readiness, backpressure, resource-exhaustion or outage evidence, and fresh Time Evidence. It is
  Backtest-owned operational diagnosis at the Native Replay service boundary, not a Runtime kernel or Sim
  Exchange/Simulator defect, and it blocks economic interpretation until corrected or excluded.
- Protected replay identity binds the exact Strategy Artifact, requested PIT scope, PIT Market Snapshot and
  Universe Selection Record identity and digest, calendar/session/time-zone, corporate-action and historical-membership
  cuts, Market Semantics Compatibility identity, snapshot and correction rule, replay-configuration digest,
  Runtime kernel, simulator, cost, slippage, and capacity model versions, and the exact Candidate/Intake protected
  decision-policy identity and version before execution. It also repeats the frozen Protected Robustness Plan
  identity, required cell identity, metric set, coverage rule, tolerances, thresholds, aggregation, missing-cell
  policy, and stop policy before any protected observation.
- Protected Run Result repeats the actual consumed counterpart of every protected-request field and the protected
  policy pair and requires exact request-to-result equality. It declares `PROTECTED_EVALUATION` as its canonical
  `timeEvidenceCutKind`, directly binds the request Time Evidence, and seals the result-stage clock cut for the
  exact request, attempt, plan, and plan cell.
- Backtest Repair Result binds one R&D-owned `native-repair-request`, exact `SIMULATOR` or
  `BACKTEST_OPERATIONAL` category, predecessor repair decision, stable correlation, original proof digest,
  category-specific old identity and source cut, repair policy, decisive evidence, and fresh Time Evidence.
  Backtest alone commits `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN` for that attempt.

## Modules

- **Native Replay** - replay historical events with deterministic time while reusing the native Runtime, Risk, and order semantics where applicable.
- **Sim Exchange** - model venue acceptance, latency, fills, fees, and account effects without external writes.
- **Run Result** - bind consumed data, artifact, configuration, orders, fills, costs, and terminal outcome into one canonical receipt.

## Shared strategy lifecycle contract

Backtest consumes only the [StrategyDesignV2 shared-kernel path](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel):
an exact `StrategyPlanV2`, its content-addressed Wasm Artifact, resolved Owner input bindings, `ProgramHost`, and
versioned lifecycle/checkpoint/kernel identities. Native Replay supplies the deterministic `START`, `BAR`,
`EVENT`, `FILL`, `TIMER`, `STOP` envelope stream; the shared kernel owns position actions, portfolio targets,
protection adjustment and fill reconciliation. Sim Exchange supplies factual simulated acceptance, fill, rejection
and account effects. A Design, plugin or Backtest adapter cannot submit raw orders or implement a parallel action
state machine.

Backtest owns the resulting ordered semantic trace and canonical replay facts, not their research or deployment
meaning. The trace binds every normalized event order key, before/after checkpoint digest, plugin invocation and
bounded result, kernel primitive semantic ID, target/protection transition, simulated order/fill reconciliation,
position, cost and terminal result. The first admitted vertical is the deterministic stateful-trend corpus;
cross-sectional rebalance and multi-leg/multi-timeframe regime are required acceptance corpora, not permission to
fabricate absent bindings or implement a third runtime.

A positive Run Result derives its actual-consumption record inside Backtest from the exact inputs admitted by
Native Replay, `ProgramHost`, the shared kernel and Sim Exchange. A caller or R&D request may propose requested
meaning but cannot supply, deserialize, or attest the consumed side. The engine-produced record binds the Design,
Plan, Artifact, resolved Owner input receipts and cuts, replay configuration, runtime/kernel/simulator identities,
cost/slippage/capacity models, seed, range, calendar/time-zone meaning and semantic-trace digest. Missing or
unmatched consumption evidence produces no positive receipt; equality between two caller-authored DTOs is never
request-result correlation.

### CURRENT_PARTIAL - durable Result custody and R&D locked read

The Backtest Owner owns the private canonical Result table and its append-only outbox, and only the Backtest
writer may perform DML. The fixed `SECURITY DEFINER` `owner_api` lock/read functions
`resolve_exploratory_replay_result_v2/v3` exist, and the ordered PostgreSQL chain proves positive locked readback,
function-source drift, Owner API sibling-routine, raw-table ACL drift, inherited-owner-membership and
owner-attribute drift rejection, topology-fence serialization, mid-commit rollback, restart-exact readback, and R&D
read-only access (the `vibe-backtest-owner` entries whose test names begin with `postgres_result_` in
`scripts/ci/test-rd-owner-postgres.bash`; the `postgres_protected_result_` entry is deliberately not among
them). Backtest remains the
sole authority for the result fact, and Protected Result custody remains isolated and is not readable through this
R&D seam.

The Backtest Owner exposes one fixed, safe-`search_path`, `SECURITY DEFINER` `owner_api` lock/read function. Its fully
qualified reads lock the exact Result, receipt, and outbox rows and return an untrusted envelope inside the
caller's already-open PostgreSQL transaction. A locator or dependency-neutral contract is only a query and carries
no Result authority. The target dependency-neutral `vibe-backtest-result-custody` adapter validates the schema,
function, and table owners, installed function source, `SECURITY DEFINER` setting, table and function ACLs,
canonical Result bytes and digest, request correlation, Backtest receipt, and outbox binding before constructing a
non-forgeable positive
readback. It accepts a caller-supplied transaction only; opening a separate pool or transaction cannot produce a
readback usable for an R&D decision.

This preserves the acyclic crate direction
`vibe-strategy-factory -> vibe-backtest-result-custody -> vibe-backtest-owner-contracts`: the custody adapter does
not depend on `vibe-backtest-owner`, while `vibe-backtest-owner` retains Result construction and write authority.
Missing, stale, cross-spliced, wrong-owner, wrong-function, ACL-mismatched, noncanonical, digest-mismatched,
receipt-or-outbox-incomplete, or separately read custody is `UNAVAILABLE`. After response loss, exact `RESOLVE` may
return only the same pre-existing byte-identical Backtest Result and receipt; it cannot create first custody,
recompose a result, or append a second Result, receipt, or outbox event. Admitted on that disposable PostgreSQL
proof; it still grants no Dashboard implementation, deployment, production write, provider effect, Paper, Live,
or trading authority.

## Input handoffs

- [R&D](./rd/) submits one frozen Exploratory Replay Request, addressed by an R&D-owned locator carrying the
  request identity, the canonical request meaning digest, the receipt identity and the seal digest. Backtest
  re-resolves that locator through the fixed read-only R&D Owner port and verifies the canonical request bytes
  against the digest before any other field is read; a locator label, a downstream attestation, or a
  caller-supplied copy of the bytes is not the request. The request fixes the exact immutable Artifact, the
  requested PIT data scope, the replay configuration, the same cost, slippage and capacity-model versions frozen
  by its Research Intent, and every other component of the requested meaning that a positive terminal result must
  reconcile exactly. Backtest may observe `AVAILABLE`, `STALE`, or `UNAVAILABLE` on the R&D side; only
  `AVAILABLE` admits an attempt, and neither `STALE` nor `UNAVAILABLE` is a rejection of the request, because
  both say only that this Owner cannot presently supply it. A locator that resolves to nothing, bytes whose
  digest disagrees, a request whose meaning changed under the same identity, and an R&D port that does not answer
  all produce no attempt and no result: silence is never `UNAVAILABLE`, and `UNAVAILABLE` is never a terminal
  replay outcome. Backtest never reconstructs, defaults, or substitutes any requested component, never treats
  equality between two caller-authored representations as request-result correlation, and never begins an attempt
  for a request whose canonical bytes it has not itself verified.
- For an admitted `D1_EXECUTABLE_REPAIR`, R&D submits a distinct `REPAIR_VALIDATION` request bound to the D-only
  repair admission, predecessor and successor Artifacts, defect oracle, complete non-defect regression corpus,
  frozen semantic-equality proof, and deterministic event/signal/intent/order trace comparison. It is never an
  exploratory or protected request.
- [Qualification](./qualification/) sends a frozen protected request created only after `ADMITTED` intake and
  holdout reservation, with every execution-defining identity and exact Candidate/Intake protected policy pair
  fixed. Each request addresses one declared Protected Robustness Plan cell or the exact frozen bounded matrix;
  Backtest cannot choose cells after observing results. Admission rejection must still commit a request-bound
  `RUN_REJECTED` result.
- [Market Data](./market-data/) supplies the frozen point-in-time facts and instrument terms one replay consumes:
  the PIT Market Snapshot identity and digest, the Universe Selection Record identity and digest, the snapshot and
  correction rule, the corporate-action and historical-membership cuts, the Market Semantics Compatibility
  identity, and, per instrument, the sealed fact digest, receipt digest and terms digest together with the venue,
  quote and settlement currencies, validity window, margin model and fee terms. Backtest consumes these as
  Owner-sealed receipts; it does not query a store, select a slice, or accept a caller-supplied fixture in their
  place. A receipt is either sealed and resolvable for the exact request-bound scope or it is not, and there is no
  partial or provisional form: only a complete set covering every requested instrument and the whole requested
  scope admits execution, and a set that covers the scope by substituting a neighbouring cut, a later correction
  frontier, or a different membership does not. An absent receipt, an unresolvable identity, a digest that
  disagrees, an instrument outside the request-bound universe, a validity window that does not contain the
  requested cut, or more than one settlement currency where the computation admits one, each fails before
  `ProgramHost` invocation and produces no positive receipt, because a data gap is a replay-evidence fact and
  never an economic result. Backtest never infers a missing price, term, or membership, never silently changes
  costs, never substitutes a different snapshot or simulation version, and never lets telemetry or a projection
  stand in for a sealed receipt.
- [R&D](./rd/) may additionally submit one frozen `SIMULATOR` or `BACKTEST_OPERATIONAL`
  `native-repair-request`. `SIMULATOR` targets only Backtest's Sim Exchange surface `sim-exchange`;
  `BACKTEST_OPERATIONAL` targets only Native Replay's `BACKTEST_RUNNER_SERVICE`. Wrong target, category,
  predecessor, proof, old identity, source cut, policy, time, or
  changed meaning creates no Backtest repair attempt or result.

These two upstream contracts are no more admitted than the upstream states them to be: the corresponding
[Market Data](./market-data/) output handoff marks direct `BACKTEST_OWNER_V1` Instrument Master resolution
**TARGET**, so nothing here may be read as an admitted consumption path. The exploratory path is also
unreachable in what is deployed: the only caller of `run_exploratory_replay_v2` outside its own crate sits under
`#[cfg(feature = "sealed-develop-composer-acceptance")]`, and `product/rd-workbench/Dockerfile.owner` builds
`strategy-factory-rd-owner-api` with no feature flags at all. That measures the deployment artifact and not
history; it says nothing about whether the path has ever run in some other environment.

## Output handoffs

- To [R&D](./rd/): exploratory Run Results with the complete finite `diagnosticCategorySet` and each
  member's decisive evidence cuts. Any execution-defect member preempts economic interpretation and Research
  chooses one repair under its frozen precedence while preserving all supported members. Only a set with no
  defect may use `NO_EXECUTION_DEFECT` or `VALID_ECONOMIC_FAILURE` for economic interpretation;
  `UNRESOLVED_FAILURE` permits no decision.
- To [R&D](./rd/): for `REPAIR_INPUTS_SIMULATOR` or `REPAIR_INPUTS_BACKTEST_OPERATIONAL`, Backtest alone returns
  the exact request-correlated `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN`. `REPAIRED` names a new simulator
  or operational-profile identity and permits only one new request-equal Replay Request bound to the exact
  predecessor `REPAIR_INPUTS` decision, category, native repair request and result identities, original proof
  digest, stable correlation, predecessor and successor native identities and cuts, and unchanged predecessor
  request semantics. `BACKTEST_OPERATIONAL` includes the successor operational-profile identity and cut. Only
  `REPAIRED` permits re-entry; `UNAVAILABLE` permits
  only the correlated `STOP_INPUT_UNAVAILABLE`; `OUTCOME_UNKNOWN` permits no stop, retry, successor, Artifact,
  Selection, or Replay Request. None mutates or retries the consumed run attempt.
- Only a request-equal exploratory `TERMINAL_RESULT` is selection-eligible; rejected, invalid, unknown,
  non-terminal, or mismatched attempts remain TrialFamily Census facts only.
- To R&D's attended repair path: one request-equal passing `REPAIR_VALIDATION` result may support
  `D1_VALIDATED`; a failed, rejected, invalid, unknown, or unequal result supports no Candidate and cannot be
  relabeled as research evidence. R&D alone commits the D-only Repair Disposition.
- To [Qualification](./qualification/): sealed Protected Run Results that repeat every consumed execution-defining identity for exact equality checking, plus complete consumed-input evidence only.
- To Product Edge: read-only exploratory Run Result views only; protected requests, measurements, results, and holdout details are never projected.

## Rejections and prohibitions

- Never infer missing data, silently change costs, or substitute a different artifact or simulation version.
- Never mix exploratory and protected results or expose protected results to the same research loop.
- Never treat replay survival, statistical significance, or a single holdout as deployment authority.
- Never own Eligibility State, lifecycle state, capital, live orders, or account truth.
- Never interpret a Run Result as deployability; only Qualification can consume protected evidence into Eligibility State.
- Never discard one supported diagnostic because another is present, or let duplicate or ambiguous evidence
  become a guessed repair target; preserve supported members and classify non-isolating evidence as
  `UNRESOLVED_FAILURE`.
- Never relabel runner readiness, backpressure, resource exhaustion, or a service outage as `RUNTIME_KERNEL`,
  `SIMULATOR`, valid economics, or unresolved when the operational evidence is decisive.
- Never accept `RUNTIME_KERNEL` as a Backtest repair, rewrite a repair result for changed meaning, or treat request
  delivery, acceptance, silence, or telemetry as a terminal native repair result.
- Never expose a protected result through Product Edge, even as a read-only view.

## Failure and recovery

Data gaps, invalid instrument terms, non-determinism, or an omitted substituted or mismatched Artifact, PIT scope, PIT Market Snapshot identity, Universe Selection Record identity or digest, snapshot rule, replay configuration, Runtime kernel, simulator, cost, slippage, or capacity model terminate as `RUN_REJECTED` or `INVALID_REPLAY_EVIDENCE`. These are replay-evidence facts, never Candidate admission or Eligibility. Qualification records the corresponding terminal attempt disposition and preregistered holdout closure without calling it `INELIGIBLE`; only `IN_PROGRESS_OR_UNKNOWN` remains unresolved. A protected run that cannot preserve isolation is not downgraded to exploratory evidence. Reproduction starts from the frozen receipt, not from reconstructed defaults.

A decisively identified runner readiness, backpressure, resource-exhaustion, or service-outage failure is
`BACKTEST_OPERATIONAL`. It preempts economics and routes correction only to Backtest's operational profile and
runner service; it never claims a Runtime kernel or Simulator repair. On the protected path Qualification consumes
only the sealed category as `DIAGNOSTIC_INVALID`, closes holdout under the preregistered policy, emits no
Eligibility Fact, and exposes neither the operational evidence nor protected detail to R&D or Product Edge.

## Decision contract

- **Inputs** - one frozen exploratory or protected Replay Request plus exact admitted PIT snapshot, artifact,
  runtime, simulator, cost, slippage and capacity identities.
- **Diagnosis and decision** - admit or reject the exact request, establish runner/service operational readiness,
  replay deterministically, and commit actual consumption, operational diagnosis, and terminal result without
  interpreting deployability.
- **Conflict resolution** - request identity and namespace determine the run; changed meaning is rejected and
  replay joins the same result rather than substituting defaults.
- **Outputs and terminal negatives** - Run Result or `RUN_REJECTED`, `INVALID_REPLAY_EVIDENCE`, and
  `IN_PROGRESS_OR_UNKNOWN`; every branch remains factual evidence only.
- **Feedback and economic meaning** - expose net-of-cost behavior and reproducibility so Research can learn and
  Qualification can test without granting eligibility or capital.
- **Prohibitions** - no Candidate selection, protected feedback to Research, Eligibility, lifecycle, live order,
  account truth, or deployment authority.

## Subsequent implementation acceptance

- Identical admitted inputs reproduce the same canonical event and result sequence.
- Protected Run Result proves exact equality between every requested and consumed Artifact, PIT scope, snapshot,
  universe, calendar/session/time-zone, corporate-action, historical-membership, market-semantics, correction,
  replay, kernel, simulator, cost, slippage, capacity-model, Protected Robustness Plan, and plan-cell identity.
- Each terminal protected result accounts for exactly its requested plan cell and repeats the complete cell-set
  digest. Qualification alone resolves all sealed per-cell results against the frozen plan and assigns missing-cell
  disposition after consuming a sealed Backtest attempt frontier that proves no requested cell remains nonterminal;
  Backtest cannot claim whole-plan completeness or silently relabel unavailable evidence.
- Any protected request-to-result mismatch becomes `INVALID_REPLAY_EVIDENCE` and produces no Eligibility Fact.
- Every exploratory result joins the same stable R&D-owned request identity; a mismatched, mutable, superseded, or unresolved request produces no run.
- Every terminal exploratory result has one complete finite `diagnosticCategorySet`, diagnostic-policy version,
  and decisive evidence cut per supported member or complete non-isolating evidence set; simultaneous supported
  defects and economic failure remain visible and Research's one-repair selection is deterministic.
- Every terminal protected result likewise preserves one complete finite non-empty `diagnosticCategorySet` and
  content digest for Qualification only. `NO_EXECUTION_DEFECT` and `UNRESOLVED_FAILURE` are singleton-only; any
  supported execution defect preempts economics, and no protected set membership enters shared telemetry or R&D.
- Every terminal protected cell result carries sealed Backtest-owned applicability and outcome evidence plus one
  complete `PROTECTED_EVALUATION` result-stage Time Evidence. Backtest reports observations; it does not assign
  Qualification's `PASS`, `FAIL`, or non-applicability categories.
- Every `BACKTEST_OPERATIONAL` result proves the exact operational profile, run attempt, readiness/backpressure/
  resource-exhaustion/outage evidence, and Time Evidence; a correlated repair targets only
  `BACKTEST_RUNNER_SERVICE`, and a successor profile is consumed only by a new Replay Request.
- Every admitted Backtest native repair request has one correlated write-once result. Exact replay joins the same
  attempt and result; only `REPAIRED` may name a new category-specific identity, while `UNAVAILABLE` and
  `OUTCOME_UNKNOWN` grant no successor identity or retry.
- Every completed exploratory result proves exact request-consumed equality for Artifact, PIT scope and snapshot,
  universe selection and correction, replay configuration, Runtime kernel, simulator, cost, slippage, and capacity;
  only an equal `TERMINAL_RESULT` may enter Research Selection.
- Exploratory and protected run namespaces, access paths, and result consumers are demonstrably isolated.
- No Backtest result can authorize or apply a strategy generation; Qualification decides eligibility, Governance authorizes, and Runtime alone proves application.
- Backtest exposes only `RUN_REJECTED`, `IN_PROGRESS_OR_UNKNOWN`, `TERMINAL_RESULT`, or `INVALID_REPLAY_EVIDENCE`; it cannot write admission or eligibility state.
- A created protected request is never rejected without a Protected Run Result; the result is what lets Qualification close holdout custody.

## Observability and persistence

Backtest persists each Replay Request, run attempt, consumed Artifact and PIT identities, operational-profile
identity and version, runner/service readiness and bounded backpressure/resource/outage evidence, cost/capacity
inputs, complete diagnostic set, Exploratory Result, and Protected Run Result. Operational signals cover queue
time, engine/simulator duration, resource use, and repair dependency without copying protected measurements or
an internal terminal disposition into shared telemetry. Exploratory projections may expose their diagnostic category set;
protected projections expose only the bounded public terminal outcome `CLOSED_NOT_QUALIFIED` or `QUALIFIED`,
a type-opaque non-dereferenceable reference, and source-frontier freshness. Protected phase, run latency,
terminal timing, and timing-derived fields are forbidden. They never expose a generic terminal disposition,
internal reason, or internal state. Every
`REPLAY_REJECTED`, `REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, and
`INELIGIBLE` terminal is byte-equivalently normalized to `CLOSED_NOT_QUALIFIED`; positive `QUALIFIED` remains
exact. No protected category or category-derived aggregate may label, group, filter, count, alert, score health,
or enter a research funnel. Telemetry loss cannot manufacture a Result,
diagnose a protected attempt for Research, or let Qualification close an attempt.
