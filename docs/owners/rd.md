# R&D

## Responsibility

Unify Research and Develop under one business-fact Owner. The Research capability turns traceable hypotheses into falsifiable Research Intents; the Develop capability produces immutable Strategy Artifacts and bounded attended repairs. R&D owns both experiment and artifact identity, uses Backtest as an evidence-producing service, and does not own protected qualification, deployment, or trading authority.

## Authoritative facts owned

- Immutable Research Source Provenance Record binding source identity, content digest, location, retrieval cut,
  shared time evidence, license basis, and the bounded interpretation identity and digest used to form a hypothesis.
- Frozen mechanism, data scope, exact cost, slippage, and capacity-model identities, capacity assumptions,
  permanent TrialFamily identity, budget, falsifier, and stop rule.
- Adaptive research lineage with the complete semantic predecessor frontier, Product Edge's opaque protected-feedback observation frontier, and any independence basis committed before protected feedback.
- Content-addressed Strategy Artifact and Build Receipt bound to intent, TrialFamily, exact code bytes, dependency
  provenance and lock identity, toolchain and runtime identity, Market Semantics Compatibility identity, sandbox
  policy, capability manifest, and Artifact Security Admission result.
- Frozen Exploratory Replay Request binding the exact intent, TrialFamily, artifact, requested PIT data scope, replay configuration, and cost-capacity model.
- Exploratory request-result equality across Strategy Artifact, requested PIT scope, PIT Market Snapshot,
  Universe Selection Record and correction rule, replay configuration, Runtime kernel, simulator, and cost,
  slippage, and capacity-model identities. Only a request-equal `TERMINAL_RESULT` may enter Research Selection.
- Append-only TrialFamily Census Frontier containing every exploratory Intent, Request, and Result identity through a frozen cut, including losing, rejected, invalid, and unknown trials, plus the consumed family budget.
- Exploratory findings that may justify a new Research Intent, without mutating the frozen predecessor.
- Research Iteration Decision: the sole Research fact that records `REPAIR_INPUTS` with the complete supported
  diagnostic set plus one deterministically selected typed repair category and target boundary, a successor
  experiment, `READY_FOR_SELECTION`, or a named terminal stop. Stop, repair, and
  successor outcomes never create a Selection. An unknown or nonterminal run has no Iteration Decision.
- Frozen Protected Robustness Plan identity and version, committed before protected evidence. It names the required
  time-window, regime, instrument-slice, perturbation, and reasonable parameter-neighborhood cells; metric,
  coverage, tolerance, threshold, aggregation, missing-cell, and stop policies; and the exact TrialFamily,
  Artifact, cost, slippage, capacity-model, purge, and embargo bindings. Research defines the plan but never reads
  its protected measurements or result detail.
- Research Selection Disposition: the selected-only `SELECTED_FOR_QUALIFICATION` fact for a frozen Candidate cut.
  It binds the exact `READY_FOR_SELECTION` decision, Research Intent falsifier and stop rule, exploratory
  request/result frontier, costs, capacity assumptions, TrialFamily Census Frontier, preregistered protected
  decision-policy identity and version, and the R&D-owned selection rationale category.
- Write-once Research Request Receipt with `ACCEPTED` bound to one resulting Research Intent identity or `REJECTED_NO_WRITE` bound to no Research transition.
- Write-once, request-correlated D-only Repair Disposition bound to the accepted repair admission, exact predecessor
  generation and Artifact, allowed repair surface, impact class, build and validation evidence, and shared Time
  Evidence. Its exhaustive states are `D0_COMPLETED_NO_ARTIFACT`, `D1_VALIDATED`,
  `D1_VALIDATION_FAILED`, `D1_BUILD_FAILED`, `REJECTED_NOT_D_ONLY`, and `OUTCOME_UNKNOWN`.

## Modules

- **Source Intake** — admit papers, observations, notes, media, and tool output as untrusted data with origin and
  content identity. Source content is never an instruction, capability grant, or authority to call another Owner.
  The provider-neutral implementation baseline is the [Source Intake Playbook](../../guide/source-intake/).
- **Research Intent** — freeze the falsifiable mechanism and experimental contract before result observation.
- **Strategy Artifact** — preserve immutable content, dependency provenance, market semantics, runtime capability,
  sandbox policy, and Artifact Security Admission consumed unchanged by replay, qualification, and governed application.
- **Development Sandbox** — build and diagnose generated strategy code with explicit input and output mounts and no
  ambient filesystem, network, subprocess or process-tree escape, inherited capability, secret, account,
  deployment, or effect-port authority.

## Attended D-only repair

An authorized user may select one exact current strategy generation and Artifact and ask R&D to repair an implementation defect without opening adaptive Research. Product Edge submits the typed `ATTENDED_D_ONLY_REPAIR` request and later displays the bounded result, but R&D alone admits the request and commits its D-only Repair Disposition. Shell acknowledgement or a visible view is not that terminal fact.

- Before admission, stale, invalid, unauthorized, or changed request meaning closes only through the R&D Request
  Receipt as `REJECTED_NO_WRITE`; because no repair attempt exists, it creates no D-only Repair Disposition.
- `D0_NON_EXECUTABLE` closes as `D0_COMPLETED_NO_ARTIFACT` only when executable bytes, dependency lock,
  capability manifest, deterministic traces, and every deployable identity are unchanged. It creates no Artifact,
  Candidate, Qualification attempt, Governance generation, or replacement.
- `D1_EXECUTABLE_REPAIR` first runs the deterministic build, package, and Artifact Security Admission attempt.
  A deterministic failure in that phase closes as `D1_BUILD_FAILED` before any canonical successor Artifact,
  security admission, repair-validation result, or Candidate exists; the failure evidence and fresh Time Evidence
  are terminal for the attempt and grant no naked retry. A completed build creates a new immutable Artifact and
  then runs request-equal, non-adaptive Backtest repair validation. A passing result closes as `D1_VALIDATED` and only permits a separately formed
  attended-repair Candidate for independent Qualification; a failed, rejected, invalid, or semantically unequal
  validation closes as `D1_VALIDATION_FAILED`, retains the immutable build evidence, and creates no Candidate or
  lifecycle transition.
- After admission, any mechanism, parameter, universe, PIT/data semantics, market semantics, cost, slippage,
  capacity, allowed-surface, or other Research-dimension violation closes as `REJECTED_NOT_D_ONLY`; it creates no
  repair Artifact or Candidate and may
  proceed only as a separately authorized sourced-hypothesis Research Intent.
- Missing or irreconcilable build or validation custody closes explicitly as `OUTCOME_UNKNOWN` at the last
  authoritative frontier; delivery, silence, timeout, telemetry, or a Product view cannot be promoted to success.
  It creates no Artifact, Candidate, Qualification, or deployment transition and never authorizes a naked retry.
- The predecessor Artifact and generation are never mutated. Every disposition repeats the originating request,
  admission, and attempt identities and exact admitted cut. Replaying the same request, admission, attempt, and
  meaning joins the write-once disposition; changed meaning is rejected, and another attempt requires a new
  explicit user request, successor admission, and successor attempt. Backtest returns repair-validation facts but
  does not choose the change, and protected Qualification detail never returns to R&D.

## Research diagnosis and iteration contract

Source Intake does not jump from a source to code. Before an Intent can freeze, Research records at least one
plausible alternative interpretation, one observable prediction that distinguishes the preferred mechanism from
those alternatives, and one falsifier. Missing alternatives or a non-discriminating prediction leaves the source
admitted but creates no handoffable Intent.

| Diagnosis dimension | Required diagnosis                                                                                                                                                                                                                                                                                | Decision use                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence integrity  | Verify provenance, PIT time, universe and correction identity, Artifact, configuration, runtime, simulator, and deterministic request-result equality.                                                                                                                                            | Repair or reject evidence before interpreting strategy performance.                                                                                                                             |
| Mechanism validity  | Compare the observed sign, path, regime behavior, and failure mode with the frozen causal mechanism, falsifier, and stop rule.                                                                                                                                                                    | Stop a falsified mechanism or create one successor mechanism hypothesis.                                                                                                                        |
| Economic viability  | Attribute turnover, fees, spread, slippage, market impact, liquidity, and capacity under the frozen model versions.                                                                                                                                                                               | Stop economic impossibility or revise one economic assumption before robustness work.                                                                                                           |
| Robustness          | Test sensitivity across time, regime, instruments, perturbations, and reasonable parameter neighborhoods without consuming protected evidence.                                                                                                                                                    | Distinguish stable mechanism support from a narrow parameter accident.                                                                                                                          |
| Failure attribution | Classify failure as data, artifact, runtime, simulator, mechanism, economics, robustness, or unresolved uncertainty.                                                                                                                                                                              | Route repair to the owning boundary and prevent invalid runs from becoming negative Alpha evidence.                                                                                             |
| Information value   | For each preregistered next experiment, bind the decision uncertainty, distinguishing observation or falsifier, possible result-to-action map, bounded acquisition cost, remaining family-budget effect, competing alternatives, and replayable ordinal comparison rationale at one evidence cut. | Choose the highest-ranked admissible experiment with a deterministic tie-break; an unexplained ordinal is inadmissible, and stop is legal only for a complete non-empty below-threshold census. |

Backtest supplies one complete finite `diagnosticCategorySet` for each terminal exploratory result; Research
preserves every supported member and applies this exact mapping before interpreting economics:

| Run Result diagnostic set                                                                                       | Research disposition                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any of `MARKET_DATA`, `ARTIFACT`, `RUNTIME_KERNEL`, `BACKTEST_OPERATIONAL`, `SIMULATOR`, `REPLAY_CONFIGURATION` | Defect evidence preempts economic interpretation. Preserve all supported defects, then select one `REPAIR_INPUTS` target by `MARKET_DATA > ARTIFACT > RUNTIME_KERNEL > BACKTEST_OPERATIONAL > SIMULATOR > REPLAY_CONFIGURATION`. |
| No defect, with `NO_EXECUTION_DEFECT` or `VALID_ECONOMIC_FAILURE`                                               | Economic and mechanism interpretation is allowed; neither category forces iteration or selection.                                                                                                                                |
| `UNRESOLVED_FAILURE`                                                                                            | No Iteration Decision; retain the attempt in the census until isolating evidence exists.                                                                                                                                         |

Every successor declares exactly one experiment mode. One iteration changes exactly one decision-relevant hypothesis dimension
in `SINGLE_DIMENSION` mode, chosen from these nine typed
dimensions: `RETURN_MECHANISM`, `MARKET_REGIME`, `INSTRUMENT_SCOPE`, `FEATURE_SIGNAL`, `ENTRY_RULE`,
`EXIT_RULE`, `POSITION_AND_HOLDING`, `FREQUENCY_AND_COST`, or `CAPACITY_AND_PORTFOLIO_ROLE`.
`PREREGISTERED_FINITE_JOINT` is allowed only
when the hypothesis requires a finite named combination that was frozen before result observation; it lists every
changed dimension, the bounded combinations, attribution rule, budget, falsifier, and stop rule. It is never an
open parameter search or a way to hide bundled post-result tuning.

The exact development flow is **Run Result → Diagnosis → Iteration Decision → Successor Intent / Selection**:

1. A request-equal `TERMINAL_RESULT` enters Diagnosis. Its complete Backtest `diagnosticCategorySet` first maps as
   in the table above. All simultaneously supported members remain attached to the result and decision. Any defect
   preempts economic interpretation; Research chooses exactly one repair by the frozen category precedence rather
   than discarding lower-priority facts. Source-provenance defects fail Intent admission, and a valid
   economic-model change is a typed successor hypothesis rather than evidence repair. `UNRESOLVED_FAILURE`, an
   unknown or nonterminal attempt, or an invalid candidate set produces no Iteration Decision. All attempts remain
   in the TrialFamily Census and none is reinterpreted as negative Alpha evidence.
2. Diagnosis records all six dimensions, cites the exact Intent, Request, Result, Artifact, data, runtime,
   simulator, and cost/slippage/capacity-model identities, and does not rewrite any fact.
3. Next action uses one total precedence: `REPAIR_INPUTS`; then applicable input-unavailable, falsifier, rule, or
   budget hard stop; then `READY_FOR_SELECTION`; then `STOP_LOW_INFORMATION_VALUE`; then exactly one change.
   Within the change branch, evidence repair precedes interpretation, mechanism precedes parameter refinement,
   then economics and robustness. The candidate census is complete only when its frozen generation rule,
   candidate-set frontier, expected cardinality, observed membership, and per-candidate typed admissibility reason
   prove that no candidate is absent or unresolved. The complete finite set is ordered lexicographically by admissibility, ordinal
   uncertainty-reduction rank, deterministic tie-break key, and collision-free candidate identity plus content
   digest. Duplicate identities, content digests, or complete comparison keys invalidate the set and create no
   successor, selection, repair effect, or low-information stop. `STOP_LOW_INFORMATION_VALUE` is valid only when
   every member of that complete census is admissible, comparably scored against the preregistered threshold, and
   proven below it. An incomplete, unknown, inadmissible-for-another-reason, or non-comparable census creates no
   Iteration Decision. The selected identity must equal the unique computed winner.
4. Iteration Decision commits one mutually exclusive outcome: `REPAIR_INPUTS`, a successor experiment,
   `READY_FOR_SELECTION`, or a terminal stop. A successor freezes a new Research Intent, Artifact when required,
   and Replay Request identity. Research Selection is legal only from exactly one `READY_FOR_SELECTION` decision
   with the same decision-policy version, TrialFamily Census, and evidence cut; a stop state and selection cannot
   coexist.

`REPAIR_INPUTS` routes by category and never means “retry anything.” It is an immutable terminal disposition for
the consumed result and by itself creates no Selection, successor Intent, Artifact, Replay Request, or repair
effect. `MARKET_DATA` targets Market Data and is the only category that may emit a correlated Market Data Repair
Request after the decision commits. `ARTIFACT` targets Research through Develop and requires a new Artifact
identity; `RUNTIME_KERNEL` targets Runtime and requires a new kernel identity; `BACKTEST_OPERATIONAL` targets
Backtest's `BACKTEST_RUNNER_SERVICE` at the
Native Replay surface and binds the operational-profile version, run attempt, runner/service readiness,
backpressure, resource-exhaustion or outage evidence, and Time Evidence. It is resolved before economics and
cannot be relabeled `RUNTIME_KERNEL` or `SIMULATOR`; `SIMULATOR` targets Backtest's Sim Exchange surface
`sim-exchange` and requires a new simulator identity. `REPLAY_CONFIGURATION` remains R&D-owned and requires a new Replay Request
with a new configuration digest. For `RUNTIME_KERNEL`, `SIMULATOR`, and `BACKTEST_OPERATIONAL`, R&D freezes one
`native-repair-request` from the exact predecessor `REPAIR_INPUTS` decision, stable correlation, original defect
proof digest, category-specific old native identity and source cut, target Owner, policy, and fresh Time Evidence.
Runtime accepts only `RUNTIME_KERNEL`; Backtest accepts only `SIMULATOR` or `BACKTEST_OPERATIONAL`. Same-meaning
replay joins one native attempt, while changed meaning requires a successor R&D-owned request identity.

The native Owner alone commits the correlated repair result as `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN`.
`REPAIRED` names a new category-specific native identity and permits R&D to freeze only one new request-equal
Replay Request bound to the exact native-repair-request identity, exact repair-result identity, new
category, exact predecessor `REPAIR_INPUTS` decision, stable correlation, original defect-proof digest,
predecessor and successor category-specific native identities and source cuts, and unchanged predecessor request
semantics. `BACKTEST_OPERATIONAL` additionally binds the successor operational-profile identity and cut. Only a
matching `REPAIRED` result permits this re-entry; `UNAVAILABLE` and `OUTCOME_UNKNOWN` never do.
`UNAVAILABLE` is terminal for the attempt and permits
only the exact correlated `STOP_INPUT_UNAVAILABLE`; `OUTCOME_UNKNOWN` commits no stop, retry, successor Intent,
Selection, Artifact, or Replay Request. Request delivery, acceptance, silence, or telemetry never substitutes for
the terminal result. No native repair mutates the old Intent or silently starts work.

The Market Data Repair Request binds the original PIT request and proof digest, instrument scope, decision cut,
category, stable correlation identity, and shared Time Evidence. Market Data returns a correlated PIT Snapshot
terminal of `AVAILABLE` or `UNAVAILABLE`; transport delivery, silence, or a changed proof digest is not a result.
A matching `UNAVAILABLE` commits the append-only Research terminal `STOP_INPUT_UNAVAILABLE`, bound to the
predecessor repair decision, exact request/result, evidence cuts, and time evidence; it creates no Selection,
retry, or successor Intent. A matching usable repair may support a new request. Repair never mutates the old
Intent or silently starts work.

Research stops on the frozen falsifier, stop rule, exhausted budget, demonstrated economic impossibility, or low
expected information value. Low information value is proven only by the complete compared candidate census above;
unknown, incomplete, otherwise inadmissible, or non-comparable options do not imply that stop. Research also ends
exploration when the complete evidence cut is ready for selection.
Protected measurements, outcomes, categories, and holdout detail never enter Diagnosis or Iteration Decision.
Purge and embargo derivation, trial-family-aware multiplicity policy, attempt frontier, and protected-decision
policy are frozen before their results and carried unchanged through Replay Request, Run Result, Iteration
Decision, Selection, and Candidate. Changing one creates a successor lineage rather than reinterpretation.

## Input handoffs

- Product Edge supplies a sourced research request rather than an unsourced instruction to trade. The request commits the bounded protected-feedback frontier already projected to that principal. Research resolves the stable request identity with its own terminal receipt and preserves semantic predecessors without reading protected category or detail; absent receipt remains unknown.
- [Market Data](../market-data/) supplies point-in-time facts, catalog versions, instrument semantics, and the
  correlated `AVAILABLE` or `UNAVAILABLE` terminal for a committed Market Data Repair Request.
- Exploratory [Backtest](../backtest/) results may inform a new intent and artifact generation.
- Committed generation-scoped Performance, Runtime Incident, Execution account/order/fill/quality-observation,
  Effect Journal, readback, and Reconciliation Drift facts may be admitted only
  as a new Research Source Provenance Record for a successor lineage. They can never mutate the deployed or
  previously selected Intent, Artifact, Candidate, or protected evidence boundary.
- [Runtime](../runtime/) supplies committed generation-scoped Incident facts directly for successor-only source
  admission. [Execution](../execution/) supplies committed account, order, fill, quality-observation, Effect Journal, readback, and
  Reconciliation Drift facts directly for the same purpose. Neither handoff can tune the running generation or
  reveal protected Qualification evidence. Each Research Source Provenance Record binds the exact committed fact
  identity and source cut; Effect Closure View and Event Rail wake are not admissible substitutes.

## Output handoffs

- To [Market Data](../market-data/): only a committed `REPAIR_INPUTS` Iteration Decision may produce a Market Data
  Repair Request. The request asks its native Owner to repair evidence; it does not prescribe an adapter, rewrite
  the old snapshot, or claim availability.
- To [Backtest](../backtest/): one R&D-owned frozen Exploratory Replay Request bound to the exact intent,
  artifact, data scope, replay configuration, and cost, slippage, and capacity-model identities.
  A `REPAIR_INPUTS_SIMULATOR` or `REPAIR_INPUTS_BACKTEST_OPERATIONAL` decision may additionally create one
  correlated `native-repair-request`; Backtest alone returns `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN` for
  that exact category-specific attempt.
- To [Runtime](../runtime/): only a committed `REPAIR_INPUTS_RUNTIME_KERNEL` decision may create one correlated
  `native-repair-request`; Runtime alone returns `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN` for that exact
  kernel attempt.
- To [Qualification](../qualification/): only a R&D-owned frozen Candidate with a terminal
  `SELECTED_FOR_QUALIFICATION` Research Selection Disposition. The handoff cross-binds the exact Intent falsifier
  and stop rule, complete preregistration, immutable exhaustive TrialFamily Census Frontier, exploratory
  request/result frontier, complete cross-family semantic predecessor frontier, origin feedback frontier, and
  precommitted independence basis. Candidate and Selection repeat the exact cost, slippage, and capacity-model
  identities frozen by the Intent and exploratory request-result frontier plus the preregistered protected
  decision-policy identity and version. Candidate also binds the frozen Protected Robustness Plan identity and
  version; Qualification and protected Backtest consume it unchanged and return no protected measurements to
  Research. Qualification owns intake and
  cumulative holdout status, not Candidate or selection identity.
- Selection additionally binds exactly one `READY_FOR_SELECTION` Iteration Decision with the same policy version,
  TrialFamily Census, and evidence cut. `REPAIR_INPUTS`, successor, stop, rejected, invalid, unknown, or nonterminal
  states cannot produce a Candidate.
- To Product Edge: the terminal Research Request Receipt plus one bounded Research View. For an attended repair,
  the same view may also project the R&D-owned D-only Repair Disposition without owning or reinterpreting it. The view binds the
  stable request, trusted principal, authorized Research scope, authorization-policy cut, exact Research frontier, projection and valid-through times,
  `AVAILABLE`, `STALE`, or `UNAVAILABLE`, and one phase from `REQUEST_UNRESOLVED`, `INTENT_FROZEN`,
  `ARTIFACT_AVAILABLE`, `EXPLORATION_ACTIVE`, or `SELECTION_TERMINAL`. It may summarize R&D-owned source,
  intent, artifact, exploratory, and decision facts but never protected Qualification detail. A terminal stop is
  shown only from the Iteration Decision. Selection appears only when the selected-only disposition exists.

## Rejections and prohibitions

- Never tune a submitted candidate from its protected evaluation or holdout result.
- Never mutate a frozen intent or artifact in place; iteration creates a new identity.
- Never reuse a Research Source Provenance Record identity with changed content, retrieval cut, license basis, or interpretation; changed evidence creates a successor record and Research Intent.
- Never reset TrialFamily or holdout history by renaming a Candidate or Artifact.
- Never use a new TrialFamily, shell, principal alias, or request identity to erase a semantic predecessor or an already projected protected-feedback frontier.
- Never omit losing or invalid sibling trials, repartition a TrialFamily, or append a trial behind a frozen Candidate; a later family member requires a successor frontier and Candidate.
- Never select an exploratory result whose consumed identities differ from its request. Rejected, invalid,
  unknown, non-terminal, and request-mismatched attempts remain census facts only.
- Never invent a non-selection disposition. Stops belong only to Iteration Decision; a missing selected-only
  disposition means there is no Candidate handoff.
- Never issue a Market Data Repair Request without a committed `REPAIR_INPUTS` decision, accept transport delivery
  as repair proof, or reinterpret a repaired snapshot under the old Intent.
- Never route a non-`MARKET_DATA` repair through Market Data, turn `UNAVAILABLE` into an empty result, or treat an
  unknown/nonterminal attempt as a stop. `STOP_INPUT_UNAVAILABLE` requires the exact correlated terminal result.
- Never select a lower-ranked admissible next experiment when the frozen ranking and tie-break identify another
  experiment.
- Never emit `STOP_LOW_INFORMATION_VALUE` from an incomplete, membership-unknown, otherwise inadmissible, or
  non-comparable candidate census; every candidate must be present, admissible, threshold-compared, and below it.
- Never break a duplicate or colliding comparison key by arrival order; the candidate set is invalid and produces
  no next action.
- Never promote a source, LLM output, attractive backtest, or statistical score directly to deployment.
- Never execute instructions embedded in an external source or tool response. Treat all such content as untrusted
  evidence input; only the receiving Owner's typed contract and admitted principal can authorize an operation.
- Never admit an artifact with mutable or unresolved dependencies, missing capability or Artifact Security Admission,
  mismatched market semantics, ambient secret access, subprocess or process-tree escape, inherited authority, or
  an undeclared filesystem, network, account, deployment, or effect port.
- Never activate Runtime, allocate capital, issue risk permits, or send orders.
- Never treat shell delivery as acceptance, rewrite a receipt for changed request meaning, or let `REJECTED_NO_WRITE` bind a Research Intent.

## Failure and recovery

Missing provenance, ambiguous data semantics, unbounded trial families, unavailable costs, or exhausted budgets
prevent candidate submission. Unadmitted build failures remain Develop Sandbox diagnostics; a deterministic
build, package, or security-admission failure inside an admitted D1 repair closes the attempt as
`D1_BUILD_FAILED`. Operational recovery does not reopen a frozen research identity; a production incident may
become a new sourced hypothesis only after its committed facts are available.

## Decision contract

- **Inputs** — admitted source provenance, PIT facts, frozen Intent and experiment policy, exhaustive TrialFamily
  Census, and request-equal exploratory results.
- **Diagnosis and decision** — interpret the six diagnosis dimensions, then commit exactly one repair, successor,
  ready-for-selection, or stop outcome under the typed experiment rules.
- **Conflict resolution** — evidence validity and frozen falsifier outrank performance appeal; ordinal information
  value plus the declared tie-break chooses among otherwise admissible next experiments.
- **Outputs and terminal negatives** — successor Intent, `READY_FOR_SELECTION`, a typed `REPAIR_INPUTS`, or a named
  stop; correlated unavailable Market Data repair yields `STOP_INPUT_UNAVAILABLE`, while unknown evidence yields no
  decision.
- **Feedback and economic meaning** — exploratory and committed owner facts can improve a successor lineage while
  costs, slippage, capacity, trial budget, and expected decision value prevent uneconomic endless search.
- **Prohibitions** — no protected-detail feedback, in-place mutation, hidden sibling trial, deployment, capital,
  risk, order, account, or external-effect authority.

## Subsequent implementation acceptance

- Every artifact resolves to one immutable intent, code-byte digest, dependency provenance, reproducible build,
  Market Semantics Compatibility identity, sandbox policy, capability manifest, and Artifact Security Admission identity.
- Every exploratory run resolves to one stable R&D-owned request identity; artifact, data scope, configuration, or model changes require a successor request.
- Every exploratory result repeats and equals the request's Artifact, PIT scope and snapshot, universe selection
  and correction rule, replay configuration, Runtime kernel, simulator, cost, slippage, and capacity identities;
  only an equal `TERMINAL_RESULT` is selectable, while every other disposition remains census-only.
- Every Candidate binds an immutable exhaustive Census Frontier and consumed budget; missing, mutable, incomplete, or late-divergent frontiers are not handoffable.
- Every Candidate handoff resolves to exactly one `SELECTED_FOR_QUALIFICATION` Research Selection Disposition
  that cross-binds the frozen Intent falsifier, Protected Robustness Plan, and all exploratory evidence used for
  the decision. A terminal stop has no Selection or Candidate, no Qualification intake, and no protected holdout
  consumption.
- Every Research View resolves to one coherent Research frontier and valid-through time. It never includes
  protected measurements, parameters, outcomes, holdout use, or a dereferenceable protected-evidence reference.
- A Research View replay with a different principal, scope, or authorization-policy cut is rejected rather than served from the earlier request identity.
- A terminal selection exists only with one exact `READY_FOR_SELECTION` Iteration Decision; every stop or repair
  state is mutually exclusive with selection and creates no Candidate.
- Every Market Data Repair Request resolves to one correlated `AVAILABLE` or `UNAVAILABLE` terminal with matching
  PIT proof and Time Evidence. Missing, mismatched, or transport-only responses remain unresolved and create no
  successor Intent.
- Every `UNAVAILABLE` repair result resolves to one `STOP_INPUT_UNAVAILABLE` bound to the predecessor
  `REPAIR_INPUTS`, request, result, cuts, and Time Evidence. Exact replay joins that stop; changed meaning needs a
  successor identity.
- Every Runtime or Backtest native repair request binds one exact category, predecessor repair decision, stable
  correlation, original proof digest, old native identity, source cut, policy, and fresh Time Evidence. A matching
  `REPAIRED` result alone may support a new request-equal Replay Request; `UNAVAILABLE` closes only through the
  correlated stop, and `OUTCOME_UNKNOWN` creates no Research transition or retry.
- Every successor-experiment decision proves that its identity equals the highest-ranked admissible option under
  the frozen ordinal ranking and tie-break.
- Every next action proves the total precedence branch and, for iteration, a collision-free finite comparison set;
  duplicate identities, digests, or complete keys produce no decision.
- Every `STOP_LOW_INFORMATION_VALUE` binds a complete candidate-set frontier, expected and observed membership,
  typed admissibility for every member, the preregistered threshold and comparison evidence proving every member
  is below it; unknown or incomplete membership produces no Iteration Decision.
- Every selected Candidate carries one pre-result Protected Robustness Plan whose required cells, coverage,
  tolerances, thresholds, aggregation, missing-cell policy, and execution identities can be checked without
  exposing protected detail to Research.
- The experiment contract is timestamped before the evaluated result is revealed.
- Protected Qualification results have no write path into the same Research Intent or Strategy Artifact.
- Iteration produces a new lineage node with explicit predecessor and changed assumptions.
- In `SINGLE_DIMENSION`, one successor changes exactly one decision-relevant hypothesis dimension. In
  `PREREGISTERED_FINITE_JOINT`, it may change only the finite named combination frozen before observation, with
  its attribution rule, budget, falsifier, and stop rule. Any other bundled mechanism, parameter, economic-model,
  or robustness change is not an attributable experiment.
- A successor after bounded Qualification feedback preserves complete cross-family ancestry; Research may declare independence but cannot grant itself a fresh holdout budget.
- Research Intent states are `DRAFT_NOT_HANDOFFABLE`, `FROZEN`, or `SUPERSEDED`; exploratory evidence may only create a successor.
- Concurrent or restarted delivery of the same request identity and meaning joins one receipt; an accepted receipt binds exactly one resulting Research Intent.
- Every accepted D-only attempt commits exactly one write-once D-only Repair Disposition. D0 proves no Artifact;
  `D1_BUILD_FAILED` proves deterministic pre-Artifact build, package, or security-admission failure and creates no
  Artifact, validation result, or Candidate; D1 validation failure creates no Candidate;
  `REJECTED_NOT_D_ONLY` creates no repair transition; and
  `OUTCOME_UNKNOWN` binds the last authoritative frontier and permits no naked retry. Replay joins only when the
  request, admission, attempt, correlation, and meaning all match.

## Observability and persistence

R&D persists Source Provenance, Research Intent, hypothesis lineage, TrialFamily membership, Iteration Decision,
Selection, Artifact build/admission, D-only repair attempt, validation, and D-only Repair Disposition as native
facts. It co-commits outbox entries for committed transitions and emits bounded trace/log/metric signals for
intake, sandbox, build, replay wait, and decision latency. Dashboard projections may derive sources consumed,
hypotheses created, development attempts, failure categories, iteration count, time to selected Artifact, and
D-only repair history from those identities; they never replace the facts or expose raw source bodies,
credentials, prompts, or protected Qualification evidence.
