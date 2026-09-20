# R&D

## Responsibility

Unify Research and Develop under one business-fact Owner. The Research capability turns traceable hypotheses into falsifiable Research Intents; the Develop capability produces immutable Strategy Artifacts and bounded attended repairs. R&D owns both experiment and artifact identity, uses Backtest as an evidence-producing service, and does not own protected qualification, deployment, or trading authority.

## Authoritative facts owned

- Immutable Research Source Provenance Record binding source identity, content digest, location, retrieval cut,
  shared time evidence, license basis, and the bounded interpretation identity and digest used to form a hypothesis.
- Frozen mechanism, data scope, exact cost, slippage, and capacity-model identities, capacity assumptions,
  permanent TrialFamily identity, budget, falsifier, and stop rule.
- Frozen information-value policy: the declared ordinal uncertainty-reduction ranking rule and its version, the
  deterministic tie-break key, and the stop threshold every candidate is compared against. This Owner fixes and
  versions them; no proposer, caller or configuration selects them. A TrialFamily seals them into its
  decision-policy binding when it forms, which is before any attempt of that family runs, and every decision reads
  them from the frozen binding of the family its candidate belongs to. A decision can therefore prove which rule it
  was compared under, and seeing a result cannot change that rule: a different rule is a different family, whose
  decisions cite only its own. R&D never computes an information-value score: it admits the declared rank, then
  proves the census complete, every member admissible and comparably scored, the rationale present, and the winner
  unique. A missing, post-result, mutated, or unversioned policy admits no successor experiment and no
  `STOP_LOW_INFORMATION_VALUE`.
- Write-once Independence Basis Receipt, committed before protected feedback and bound to the effective principal,
  Research request scope, untrusted user rationale digest, R&D-owned independence disposition, and immutable basis identity and digest.
- Adaptive research lineage resolved only from locked R&D history as `GENESIS_EMPTY`, `COMPLETE_FRONTIER`, or
  `UNAVAILABLE`, plus the principal/scope-bound opaque Qualification protected-feedback frontier projection.
- Content-addressed Strategy Artifact and Build Receipt bound to intent, TrialFamily, exact code bytes, dependency
  provenance and lock identity, toolchain and runtime identity, Market Semantics Compatibility identity, sandbox
  policy, capability manifest, and Artifact Security Admission result.
- **TARGET:** content-addressed `StrategyDesignV2`, deterministic `StrategyPlanV2`, exact Owner input-binding
  receipt set, compiler disposition and lowering digest under the shared lifecycle-kernel contract.
- **TARGET:** R&D-frozen canonical `BoundedFeatureProgramV1` identity/digest and its exact Design/plugin binding,
  plus a tagged V3 first-party lowering/build capsule and durable receipt. These are not CURRENT executable facts.
- Frozen Exploratory Replay Request binding the exact intent, TrialFamily, artifact, requested PIT data scope, replay configuration, and cost-capacity model.
- **TARGET / NOT_ADMITTED:** sealed, versioned, content-addressed Replay Policy V2 Catalog versions, an explicit
  current-head fact, revocation facts, and their private administration audit. The Catalog is R&D-internal and is
  the sole policy source before TrialFamily formation; no caller-selected policy is an authoritative fact.
- **TARGET / `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1`:** versioned sealed Exploratory Replay Request locator and
  receipt, issued only by R&D from that canonical request and bound to its exact canonical bytes and digest, Owner,
  requester role, and request identity. R&D alone provides the fixed read-only resolver and durable byte-identical
  readback for that locator. The locator, a caller-supplied digest, or another Owner's binding cannot construct,
  deserialize, sign, replace, or attest the receipt. Market Data must resolve and verify this R&D-native receipt and
  canonical request through the fixed
  `lock_sealed_exploratory_replay_request_for_market_data_v1` Owner port before it may independently issue any
  event-binding receipt.
  **TARGET / NOT_ADMITTED:** the three executable routines in that fixed path are owned by the isolated
  `NOLOGIN` `rd_exploratory_replay_api_owner`, which has `SELECT` only on the exact set of relations traversed by the
  canonical verifier chain and no table- or column-level mutation privilege. `market_data_owner` receives only
  schema usage and execution of the exact four-field
  `SECURITY DEFINER` facade, and must call it inside its existing SERIALIZABLE transaction. Runtime roles have no
  membership in the routine owner and cannot replace the facade or either verifier.
- Exploratory request-result equality across Strategy Artifact, requested PIT scope, PIT Market Snapshot,
  Universe Selection Record and correction rule, replay configuration, Runtime kernel, simulator, and cost,
  slippage, and capacity-model identities. Only a request-equal `TERMINAL_RESULT` may enter Research Selection.
- Append-only TrialFamily Census Frontier containing every exploratory Intent, Request, and Result identity through a frozen cut, including losing, rejected, invalid, and unknown trials, plus the consumed family budget.
- Exploratory findings that may justify a new Research Intent, without mutating the frozen predecessor.
- Write-once Iteration Result Admission binding one locked canonical Backtest Result to the iteration that may
  consume it. The Owner derives every admitted fact inside one serializable R&D transaction from the locked
  Result bytes, the exact TrialFamily census cut and the sealed trial budget; the caller supplies only the
  locator, the result and request-meaning digests, the canonically ordered candidate proposal set, and the
  Product Edge admission locator that authorized the mutation. The Owner resolves that admission inside the
  same serializable transaction that holds the Result lock, verifies it names this exact request, operation,
  schema, target Owner, payload and single effect, and requires it to authorize the mutation both when the
  transaction opens and at the committing cut. A replay resolves it historically, because the committed fact
  is content-addressed on the request meaning rather than on who authorized it. A
  proposal set that is empty, oversized, misordered, duplicated, inconsistent with its declared cardinality, or
  larger than the remaining sealed budget closes the admission and creates no custody. Exact request replay joins
  the committed admission; a changed meaning for the same Result is `Conflict`. The admission emits one
  `RD_ITERATION_RESULT_ADMITTED_V1` outbox event and creates no Decision, Selection, Candidate, or Qualification
  transition.
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

## Implementation status ledger

This ledger records only what the repository has reached at this cut. It uses the status vocabulary of the
[Market Data](./market-data/) ledger, with `CURRENT_PARTIAL` as the merged-but-unreachable form, and grants no
permission by itself: no slice of this document is `IMPLEMENTATION_ADMITTED`, and widening the admitted set
requires changing this document first. Every row names the symbol or path that would falsify it.

- **CURRENT - deployed service and the boundary of what it exposes:** `product/rd-workbench/Dockerfile.owner`
  builds `--bin strategy-factory-rd-owner-api` with no `--features` at all; the file's only `--features` is on the
  dashboard binary. So the deployed image is the ungated router in
  `crates/strategy_factory_rd_owner_api/src/main.rs`, and the six routes registered after it by
  `#[cfg(feature = "sealed-develop-composer-acceptance")]` and
  `#[cfg(feature = "sealed-source-intake-composer-acceptance")]` are absent from it:
  `/v2/exploratory-replay/execution-input-bindings`, `/v3/exploratory-replay-requests/composer-backed`, and the
  four `/_sealed-acceptance/v1/develop-composer/*` routes. An acceptance route is never evidence of a production
  capability, and the sealed features exist to keep that distinction mechanical rather than remembered.
- **CURRENT - one read-only operation is reachable only through the write API:** the Dashboard's operation
  registry declares eleven Owner routes, and ten are `GET`. The eleventh,
  `research_goal.legacy_quarantine_read.v1`, declares `effect_set: []` and resolves to
  `POST /v1/research-goals/{request_identity}/resolve`, registered in
  `crates/strategy_factory_rd_owner_api/src/main.rs` and absent from the read API binary. The empty effect set is
  accurate: the handler ignores its request body, and each of its three paths -
  `resolve_legacy_quarantined_v1`, `resolve_admission` and `resolve_historical_v1` - only reads, taking
  `FOR SHARE` rather than `FOR UPDATE` and issuing no `INSERT`, `UPDATE` or `DELETE`. What is wrong is where the
  operation lives: a consumer that claims only read operations still needs write-API credentials, because one of
  its reads is a `POST` this Owner exposes nowhere else. Until that route is served from the read API, a
  read-only consumer holding write-API credentials is this constraint rather than a privilege leak, and
  narrowing it to the read-API pair would break the operation rather than tighten it. Concretely, the shadow
  worker service in `product/rd-workbench/docker-compose.yml` needs its write-API pair for exactly this reason:
  removing it while tidying that file stops the worker at `WORKER_CONFIGURATION_UNAVAILABLE`, and nothing in the
  file says why the pair is there. A future operation
  declaring `effect_set: []` over a `POST` needs the question asked again, because an effect set describes the
  operation while the credential admits the whole route.
- **CURRENT - the cross-Owner read surface other Owners are granted:** `rd_owner_api` is the only schema in this
  repository that grants execute to more than one consuming Owner role - `product_edge_owner`,
  `qualification_writer`, `backtest_owner`, `market_data_owner` and `market_data_reader`, with `rd_owner` as the
  schema's own role. The schemas, their functions and every grant are established by the Owner migrations that
  `product/rd-workbench/postgres-init/10-migrate-authority-custody.sh` runs, and that script with the migrations
  it invokes is the authority for what exists at any cut. This row deliberately states no function count. A count
  goes stale the day an Owner adds a function, and it overstates the surface even while it is right: a function
  living in an `_api` schema is reachable only when some role holds `EXECUTE` on it, and this schema holds both
  kinds - entry points granted to a consuming Owner, and internal predicates revoked from every other role. What
  is decidable is the grant. Two such facts hold at this cut and correct an earlier claim in this row that
  `portfolio_api` and `governance_api` carry none: both carry functions, and `governance_api` carries exactly one,
  revoked from `PUBLIC`, with no `GRANT EXECUTE` on it and no `GRANT USAGE ON SCHEMA governance_api` anywhere in
  the repository - built, and reachable by no role. The granted functions are `SECURITY DEFINER` and name no
  caller in their bodies, so access is decided by the grant and a caller without it receives a permission error
  rather than an empty result. This row records the surface and its grants; it does not establish that any
  consumer reads it in production.
- **CURRENT_PARTIAL - the production Composer read port:**
  `crates/strategy_factory/src/source_research_composer_postgres_v2.rs` implements
  `DevelopComposerSealedReadPortV2` for `PostgresSourceResearchComposerProductionV2` with no `cfg` attribute, so
  the deployed build carries it and no acceptance feature is required to resolve a committed Composer operation.
  It proves the read resolves what the same transaction committed; it proves no consumer outside the ordered
  chain.
- **TARGET - the PIT input seam is wired and inert:** `rd.md` states that Market Data returns one sealed
  `ResearchPitTerminal` per PIT Market Snapshot Request. `crates/strategy_factory_rd_owner_api/src/main.rs`
  imports `ResearchPitTerminalResolver`, declares `_market_data_research_pit` and assigns it at construction, and
  never reads it - the underscore is the only marker, and no trait method of that resolver is called anywhere
  outside `crates/data`. The resolver is additionally optional: `bootstrap_deployment_store_admission` returns
  `Option`, so the field may hold `None` in a deployment. Closing this needs a consumer in this Owner, not a
  wider read from Market Data.
- **TARGET / ISOLATED_ACCEPTANCE_ONLY - the exploratory replay production entry:** the only caller of
  `run_exploratory_replay_v2` outside `vibe-backtest-owner` is inside `run_native_replay`, which carries
  `#[cfg(feature = "sealed-develop-composer-acceptance")]` with no `cfg(not(...))` twin anywhere in the
  repository. With the deployed image built without features, that path is unreachable in what is deployed. This
  measures the deployment artifact, not history.

## Modules

- **Source Intake** - admit papers, observations, notes, media, and tool output as untrusted data with origin and
  content identity. Source content is never an instruction, capability grant, or authority to call another Owner.
  The provider-neutral implementation baseline is the [Source Intake Playbook](../guide/source-intake/).
- **Research Intent** - freeze the falsifiable mechanism and experimental contract before result observation.
- **Strategy Artifact** - preserve immutable content, dependency provenance, market semantics, runtime capability,
  sandbox policy, and Artifact Security Admission consumed unchanged by replay, qualification, and governed application.
- **Development Sandbox** - build and diagnose generated strategy code with explicit input and output mounts and no
  ambient filesystem, network, subprocess or process-tree escape, inherited capability, secret, account,
  deployment, or effect-port authority.

## Strategy design and Develop compilation

The [StrategyDesignV2 contract](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel)
governs how arbitrary admitted Research becomes executable. R&D alone freezes the typed, content-addressed
`StrategyDesignV2`, including its stable primitive semantic IDs, declared input roles, lifecycle/state/target/
protection meaning, optional bounded-plugin manifest, and Research Intent binding. Develop deterministically
canonicalizes, closes capabilities, consumes exact Owner binding receipts, and lowers it to `StrategyPlanV2` and
the sole Wasm Strategy Artifact/`ProgramHost` path. It may not generate unrestricted strategy code, invent a core
opcode, infer a source through heuristic strings, or create another interpreter or runtime.

**TARGET / NOT_ADMITTED - ARC Complex D Bounded Feature Program V1:** R&D freezes one canonical
`BoundedFeatureProgramV1` together with its Research Intent, `StrategyDesignV2`, bounded-plugin semantic ID and
manifest digest. The program declares typed Owner roles, units/scales, trigger/sample clocks, the versioned
`vibe-indicators-kernel` primitive-catalog digest, a fixed-I128 DAG, bounded state/resources, lifecycle outputs,
and canonical bytes/digest. R&D owns that frozen Research/Design/program meaning; it cannot mint a Market Data
sample coordinate, build provenance, Host proposal identity, lifecycle transition, Backtest result, raw order, or
trading effect.

**CURRENT_PARTIAL - R&D joint freeze write path:** the R&D Owner now carries a durable PostgreSQL
composition root and three authenticated routes,
`POST /v1/bounded-feature-programs/{declare,freeze,lower}`. `declare` is the proposer's route: it takes
a Design and the program's meaning, derives everything a proposer cannot know from that Design, the
pinned catalog and the Owner's own binding custody, and freezes the result in the transaction those
binding row locks were taken in. `freeze` takes an already assembled pair instead. Both admit the pair
against currently accepted Research custody and the pinned primitive catalog, write exactly one
joint-freeze row with its outbox event, and answer a changed meaning for the same Research identity
with a conflict. `lower` reads that frozen pair back and lowers it, so a frozen program now yields
canonical first-party ABI3 source through a production path rather than only inside sealed acceptance.

**CURRENT_PARTIAL - lowered source is not an executable:** the lowering carries no build receipt, no Wasm,
no Artifact and no qualification meaning. It proves only that the frozen program, the pinned
`vibe-indicators-kernel` catalog and the first-party SDK produce exactly those bytes, and that tampered
stored bytes close the path. The V3 build and the durable Composer RUN now have the production
entry described below; everything downstream of the Artifact stays TARGET.

The TARGET V1 catalog is atomic rather than a menu of names: fixed I128 scale is at most 38, rescale is explicit,
the only rounding modes are `TowardZero` and `NearestTiesToEven`, and each operation uses one exact I256 expression
with one final rounding. The catalog freezes lag/rolling readiness, EMA/Wilder seeds, Wilder ATR, period-delta RSI,
OHLC geometry, trailing-window swing coordinates, and closed-unit rational `range_fraction` semantics. Missing any
required formula, semantic ID, golden vector, or no-state-change oracle makes that catalog version unavailable.

The closed TARGET catalog namespace and canonical golden-vector codec are published per semantic version, each
version atomically. A frozen program declares its catalog semantic version and that version's semantic digest, which
binds meaning rather than kernel code; publishing a later version neither changes nor invalidates an earlier one, and
reading an earlier freeze back requires the running kernel to reproduce that version's required golden vectors
byte-for-byte. See
[Catalog versioning and frozen-program readback](../architecture/strategy-factory#catalog-versioning-and-frozen-program-readback).
For every
sample-clock role, R&D binds the exact versioned Owner-coordinate source and ordinary bounded Bytes port in the
Design/Plan, but Market Data alone seals the 308-byte coordinate and its receipt cross-binding. The sole generic
`ProgramHostV2` verifies and transports those bytes; it does not mint them or gain a feature opcode. BFP plugins use
the separately tagged ABI 3 failure status for `NUMERIC_FAILURE_NO_STATE_CHANGE`, while every existing ABI 2
manifest, receipt, frame, and generic failure meaning remains byte-identical. These are TARGET seams, not claims of
CURRENT Market Data, Host, plugin, Composer, or Backtest support, and they require no second runtime or raw-order
authority.

R&D's Develop capability alone validates the canonical DAG and capability/resource/state bounds and deterministically
lowers it with content-addressed first-party SDK/kernel sources. It references versioned primitive semantic IDs and
source digests instead of copying formulas. The result is exactly one existing bounded plugin whose outputs are
limited to typed post-state, `PositionIntentV1`, target and protection fields; `ProgramHostV2` seals the proposal
and the shared lifecycle kernel alone applies it. No caller- or LLM-authored Rust/Wasm/dependency, floating point,
Host feature opcode, second interpreter/runtime, raw-order plumbing, or executable fallback is admitted.

The future V3 build capsule/receipt must bind the canonical program, manifest, SDK/kernel, lowerer/compiler,
toolchain/profile, complete source set, two byte-identical builds, Wasm, ABI and resource/import/export bounds.
`PluginImplementationReceiptV2` may continue to bind its opaque verified-receipt digest, but Composer durable
readback must distinguish tagged V2 from V3 and preserve every existing V2 row and digest byte-for-byte. The
architecture contract and falsifiable first corpus are defined in
[Strategy Factory](../architecture/strategy-factory#target---arc-complex-d-bounded-feature-program-v1). Until
those code, Owner custody and real `ProgramHostV2`/Backtest checks exist, this is not an executable D-loop, Native
Replay, first-party acceptance, stable-profitability claim, or Paper/Live/production/trading authority.

The CURRENT ComplexStrategy V1 pre-Artifact Develop Evaluation is an R&D-internal fact only when current accepted
Research custody, the complete TrialFamily frontier, canonical bounded IR, exact predecessor and an Owner-sealed
PIT readback are all bound and revalidated at commit. It is neither an Artifact nor Backtest Replay, Qualification,
Candidate, Eligibility, Governance or Runtime evidence. Its positive result cannot enter Research Selection. V1
canonicalization, bounds, frozen-Intent checks and Owner binding are migration inputs to V2; the duplicate V1
interpreter and toy renderer must be removed only after corpus equivalence is proven through the Wasm path.

Develop returns a content-addressed Plan and Artifact only after every input role has a typed fact-Owner binding,
capability closure is complete and the lifecycle/checkpoint/plugin bounds are supported. Otherwise it returns
structured `UNSUPPORTED` or `NEEDS_RESEARCH_REFINEMENT` with the exact failing coordinate and creates no Plan,
Artifact, Replay Request, Candidate or downstream effect. `NEEDS_RESEARCH_REFINEMENT` may inform only a successor
Research decision; Develop cannot silently complete research meaning. One Research intent seals at most one
positive Artifact: a later build request for the same intent is not admitted, and further development goes
through a successor Research intent, never by re-sealing the evidence the Product Edge peeks.

**CURRENT/PARTIAL - crate-local Develop Composer V2:** R&D can reread one current accepted V2 Research custody
projection, rederive the Design's Research-controlled request/Intent identities and falsifier, resolve exact sealed
input-binding and verified bounded-plugin build evidence, and invoke the existing V2 compiler and
`StrategyArtifactV2` issuer. One in-memory Owner join returns the same byte-identical Design/Plan/Artifact receipt
for an exact replay and rejects a different proposal for the same Intent. Every custody, coverage, build,
compiler, or Artifact failure returns one structured terminal carrying no partial Plan or Artifact. The emitted
Artifact is dynamically accepted by `ProgramHostV2`; this proves only the crate-local contract and isolated
consumer path. Durable PostgreSQL custody, restart recovery across processes, provider/API/Dashboard composition,
and deployed Owner readiness remain unavailable and are not inferred from the in-memory join.

**The Composer runs in production only from a frozen Bounded Feature Program.** Under default
features `POST /v2/develop-composer/runs` takes a canonical Research request locator, rereads the program
that `POST /v1/bounded-feature-programs/{declare,freeze}` sealed against that Research custody, locks the
Research and resolves its Market Data bindings on the Owner's own transaction, lowers and builds the
program twice to byte-identical Wasm, and commits every positive Composer fact in that same transaction.
A Research request that carries no frozen program is refused at its exact coordinate; nothing is compiled
from a corpus. `derive_source_research_composer_request_v2`, which overwrote four identity fields of the
fixed corpus Design, survives only inside sealed acceptance. The ordered chain proves the production
route end to end on the hosted Linux runner
(`frozen_program_runs_the_production_composer_to_a_durable_artifact`). What the route cannot do is
invent the Design: the contract below states who authors it. Everything downstream of it exists: the
production commit function, the store, the writer, the two build-receipt relations, and the production
binding seam.

**CURRENT/PARTIAL - the first cycle now has something to stand on.** Sealing the corpus run leaves
`run_bounded_feature_program` as the only production entry, and it requires a frozen joint program.
Freezing one requires Strategy Input declarations, and Market Data used to register those only from
a Composer attestation, which a Composer commit is what mints. Every later cycle closes on itself -
a commit's own response carries exactly the locator the registration takes - but the first had no
origin, and no artifact-bound shape could supply one: a program's identity folds in the very binding
receipts the registration issues. This Owner therefore publishes a Design-level role intent, which
names a Design, the Research request and custody it was admitted against, and the roles it declares,
and nothing else. `POST /v1/strategy-designs/publish-role-intent` derives it from currently accepted
custody and stores it write-once per Design;
`rd_owner_api.resolve_design_role_intent_for_market_data_v1` exposes it to the Market Data reader
principal alone. The ordered PostgreSQL chain witnesses a Design that nothing in
`composer_private` names moving from no PIT coordinate to the one Market Data resolved, beside the attested admission it
must agree with.

**TARGET:** who authors that Design. Publication states what R&D knows about a Design it was given;
it does not derive one, which is the open question the contract below still defers.

The binding half of that entry is `dynamic`. The isolated R&D Owner PostgreSQL chain declares and
freezes a six-role BAR program against bindings the Market Data Owner issued through its own
acceptance basis, then resolves that frozen pair through the same production binding Owner a RUN
uses and requires exactly one receipt per declared role.

**CURRENT/PARTIAL:** the RUN acceptance itself - two byte-identical builds of the lowered source, the
tagged V3 receipt, and the single-transaction commit of every positive Composer fact - is carried by
the ordered chain's end-to-end entry on the hosted Linux runner. **TARGET:** deployed Owner readiness
and restart recovery across processes, which no chain entry observes.

### CURRENT_PARTIAL - who authors a Strategy Design

R&D does not derive a Design from research prose. No rule in this repository turns a hypothesis,
mechanism and falsification question into input roles and a reaction graph, and none is intended:
that translation is a judgement, and a judgement an Owner makes is a fact the Owner invented.

**Two different things are called a Research Intent here, and the prohibition stands because the
Composer path holds the one with nothing to project.**

`ResearchIntent` in `crates/strategy_factory/src/research.rs` does carry `data.channels`, each
declaring its `role`, `asset_id`, `timeframe`, requiredness, source and staleness bound, with
`data.decision_clock_channel` naming which one advances the decision. Projecting those would choose
nothing. But that type has exactly one constructor, `frozen_representative()`, which parses a
compile-time constant and then refuses anything whose SHA-256, identity, revision and schema version
are not the frozen ones; its only callers are the formation path in `family_adapters.rs`,
`representative.rs` and `formation_adapters.rs`. The Composer path never holds it.

What the Composer path holds is `CurrentResearchDevelopCustodyV2`, whose fourteen fields are
locators, identities and digests plus one `falsifier` string, and behind it the stored
`intent_json`, which deserializes to `FrozenResearchGoalIntentV2`. That intent's `goal` is a
`SourcedResearchGoalV2`: `hypothesis`, `mechanism`, `falsification_question`,
`expected_observation`, `cost_assumption`, `capacity_assumption`, `sources`, and
`required_data: Vec<String>` whose values are prose such as `PIT bars` and `sealed market bars`.
**It declares no channel, no instrument, no timeframe and no role.**

So there is nothing to project on the production path, and turning `required_data` prose into input
roles is exactly the inference the paragraph above forbids. A projection becomes available only when
the Owner holds channel declarations at the Composer cut - either because the stored intent carries
them, or because something resolves them from the intent identity, neither of which exists. Until
then the input roles are a proposer declaration this Owner admits, on the same terms as the reaction
graph.

The reaction graph is the part that stays a judgement, and it stays with the proposer. A first
bounded family is admitted for it and nothing wider: **a single declared channel compared against a
single threshold**, with the decision clock taken from `data.decision_clock_channel`. Every graph
outside that family - two signals, a conjunction, a state-dependent threshold, a threshold this
Owner would have to choose - remains a proposer declaration this Owner admits rather than derives.
The family exists so the first production path can close without the Owner inventing a mechanism; it
is not a claim that one threshold is a good strategy, and widening it requires changing this
document first.

A **proposer** declares it instead. The proposer may be a language model, a person or any other
caller; this contract does not name it and does not change with it. What the contract fixes is the
**output**: exactly one canonical `StrategyDesignV2` and, on the bounded-plugin path, the program's
meaning - its typed node graph, constants, state cells, decision-table terminals, warmup contract,
graph bounds, and per declared input role the value port the graph reads and the clock that advances
it. The input is unbounded research prose; the output is a closed typed schema that rejects unknown
fields and unknown semantic IDs. That translation is the proposer's whole job.

A proposer declares meaning and never an identity. It does not declare the schema or semantic
versions, the Research, Intent and Design identities and digests, the plugin manifest digest, the
pinned catalog identity, the first-party SDK digest, the four bounds the plugin manifest fixes, or a
static binding receipt. The Owner derives each of those from the Design it was given, the pinned
catalog and its own binding custody, so a proposer cannot state a fact it has no way to know and
cannot disagree with the Design it names. Assembling those derivations and freezing the result
happen in one transaction: the binding custody read takes row locks at a cut, and freezing against a
different cut would seal a program whose receipts were never proven at the moment it was sealed.

The Owner **admits** rather than derives. It binds the declared pair to currently accepted Research
custody and refuses a Design whose Research and Intent identities or digests do not match it. It
re-canonicalizes the declared bytes instead of trusting a declared digest, verifies the program
against the pinned `vibe-indicators-kernel` catalog and the manifest's bounds, and freezes the pair
with one domain-separated digest. A second, different declaration for the same Research identity is a
changed-meaning conflict, never an update.

A proposer authors Research meaning and nothing else. It may not author Rust, Wasm, a dependency, an
ABI, a formula implementation, a build command, a clock, an Owner receipt, a Market Data sample
coordinate, a Backtest result, a raw order or an executable fallback. Those come from the
deterministic first-party lowerer, the pinned catalog and the Owners that hold them, and a
declaration reaching for any of them is refused rather than sanitized.
**TARGET - canonical Research-to-Composer custody:** the public operation accepts only a canonical Research request
locator. On one R&D transaction, the Owner-internal exact commit-cut capability takes request/aggregate row locks,
canonically rereads current Research custody, and derives the request, Design, all Research/Intent/Design digests,
bindings, source capsule, provider, Operator Authorization frontier, and final cut before any write. The authenticated
GET request projection is read-only recovery metadata; POST derives independently and cannot accept projection
feedback. The same transaction persists all positive Composer facts or none. The sealed A0 Build Receipt is one
intrinsic content-addressed fact, while each Artifact owns a separate canonically ordered use relation. Thus two
distinct Research custodies may produce two Artifacts and two use rows that share one build fact without collapsing
their lineage. The intrinsic relation is
`rd_develop_build_receipts_v2(receipt_identity, build_attempt_identity, capsule_identity, canonical_bytes)`;
`rd_develop_artifact_build_receipt_uses_v2(artifact_identity, ordinal, receipt_identity)` owns the ordered references.
Only the exact legacy embedded-receipt schema permits a one-time byte-preserving normalization; partial, mismatched,
ambiguous, or any other shape fails closed. This remains `TARGET` until the isolated first-party
acceptance chain, locator/full-DTO negatives, dual-custody sharing, concurrency/conflict, fault atomicity, response loss,
restart readback, and exact cleanup baseline all pass.

**CURRENT/PARTIAL - authenticated Strategy Design role-set readback:** the fixed R&D Owner adapter can resolve one
exact accepted Composer request locator against the existing durable Design/Plan/Composer custody and return the
additive `StrategyDesignRoleSetReceiptV1`. It repeats schema/reserved, exact request and operation receipt,
Research request and Intent, Design identity/digest, canonical-Design and Plan digests, Artifact identity, every
role sorted by derived role identity with complete semantic coordinates, and every join sorted by derived join
identity while preserving declared role order, alignment, trigger and maximum staleness. Its SHA-256 domain is
`rd.strategy-design-role-set.receipt.v1\0`; the hash protects integrity only, while the fixed admitted R&D resolver
supplies authority. **CURRENT/PARTIAL:** the fixed R&D API resolves this exact readback before Market Data binding
issuance; callers cannot supply the receipt, roles, counts or resolver. The same Market transaction issues and
stores unchanged Replay V2 facts, and exact binding-locator recovery returns byte-identical binding and Replay
payloads. **TARGET:** admitted deployment and isolated PostgreSQL acceptance.
**NOT_ADMITTED:** this projection is
not a second Design store, does not transfer Design/role/join authority to Market Data, and claims no default
deployment, Replay composition, Dashboard, production write, runtime, Backtest result or trading authority.

The receipt canonical binary codec is fixed and has no JSON dependency. Integers are unsigned big-endian;
digests are their raw 32 bytes; a string is its UTF-8 byte length as `u32BE` followed by those bytes; and a list is
its item count as `u32BE` followed by its items. The bytes are, in order: receipt schema `u16BE`, reserved-zero
`u16BE`; Composer locator schema `u16BE`, request identity string, operation-receipt digest, artifact-locator
string, artifact digest, Plan digest and Design digest; repeated operation-receipt, Research-request, Intent,
Design-identity, Design, canonical-Design, Plan and Artifact digests; role count, then each role's identity digest,
semantic-id, fact-class, instrument, scope, field-semantic-id, channel, timeframe and unit strings, scale `u8`, and
value-type string; join count, then each join's identity digest, semantic-id string, ordered-role count, each
ordered role's semantic-id string and identity digest, alignment and trigger strings, and maximum staleness
`u64BE`. No trailing bytes are admitted. `receipt_digest` is SHA-256 of the domain above followed by exactly these
bytes; neither the canonical bytes nor the digest are themselves encoded into the canonical bytes. Exact-locator
recovery reprojects existing Composer custody and must return byte-identical canonical bytes and digest. A
self-consistent caller-created byte sequence or hash remains untrusted and cannot enter the fixed resolver path.

**CURRENT/PARTIAL on macOS; REVALIDATION REQUIRED on hosted Linux ARM64 and x86_64 - local bounded-plugin build
producer:** for exactly one current `PluginManifestV2`, R&D admits
only one content-bounded `src/lib.rs` in the fixed `rust.no_std.fixed-abi-source.v2` language and rejects every
other path, symlink, file, dependency, build script, toolchain, target, or command. It materializes two separate
private temporary Cargo projects. Before locating any tool, it selects one frozen host profile that binds the exact
host, all three executable digests, and the sole `wasm32v1-none` target admission together. The CURRENT macOS arm64
profile binds canonical Cargo 1.97.1 (`c980f486…bf5`, SHA-256 `7672ead3…bbf5`), rustc 1.97.1
(`8bab26f…452`, SHA-256 `210df679…a4da`), rust-lld (SHA-256 `8f5fe507…548d`), and
`aarch64-apple-darwin`. The hosted Linux ARM64 A0 candidate profile records the same exact releases and
commits for `aarch64-unknown-linux-gnu` with Cargo SHA-256 `c5dcff70…1808`, rustc SHA-256 `a3d4dfcd…e78`, and rust-lld
SHA-256 `533dffee…eb7`. The hosted Linux x86_64 candidate profile records the same exact releases and commits for
`x86_64-unknown-linux-gnu` with Cargo SHA-256 `82898072…1953`, rustc SHA-256 `d3a664c9…7eea`, and rust-lld SHA-256
`38a9f284…5721`, and binds the same frozen `wasm32v1-none` sysroot digest, which the hosted x86_64 test host
measured. Each admitted build rejects ambient ancestor Cargo configuration and requires each tool's
`-Vv` host to match the selected profile. `RUSTUP_HOME` or `HOME/.rustup` only locates that profile's candidate
exact-release toolchain; path bytes are non-authoritative and absent from semantic identity.
It then runs the fixed `wasm32v1-none --offline --locked` command and requires two
finished zero-status receipts and byte-identical Wasm, excludes process diagnostics from semantic receipt identity,
and then invokes the sole existing plugin ABI/resource verifier. The move-bound verified build/read result can
supply the crate-local Develop Composer evidence port; exact in-process replay joins the receipt without rebuilding,
while a conflicting capsule for the same plugin identity fails closed. Both temporary roots are explicitly closed
on every terminal path, and cleanup failure dominates the original terminal. This proves only the local isolated
deterministic producer and consumer contract; Cargo offline mode and the fixed dependency-free source do not prove
kernel-level network confinement. It does not prove durable PostgreSQL custody, provider/API/Dashboard execution,
deployment, or production readiness.
The superseded Linux pins were generated by one isolated Linux/arm64 BuildKit readback: index
`sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`, platform manifest
`sha256:5a8cd84cb3fcfd082789a08f92bd36f8e745c6231edd78e24a3bf34fd471a823`, and normalized exact
`lib/rustlib/wasm32v1-none` sysroot tar SHA-256
`92fcee2e35330d22e879b640064e2e4b4e47157af1a7e05fc942dc6cc12b8faf`. On 2026-09-14 a measurement reported
`830cb504e83fd5cc9a5ba451b555cd3c9fb177b39647f3a775ce0d5f1d63300f` instead, and the freeze was replaced with it
pending a fresh hosted A0 readback. That readback has since run on `refs/heads/main` and reports the original
value, as do the hosted x86_64 test host and the pinned base image on both `linux/arm64` and `linux/amd64`: five
independent hosts, one digest, and the 2026-09-14 value reproduced on none of them. The freeze is therefore back to
the value every reachable host carries. The base Rust image remains pinned in its
Dockerfile, and the timestamp-bearing local OCI
manifest is not a registry, deployment, or reproducible-image pin. Runtime authority now comes from the pure-Rust
canonical sysroot verifier: it reproduces the frozen GNU tar normalization, binds the digest into each Linux build
receipt, and rereads the exact sysroot before and after each of the two independent builds, alongside pre/post-build
executable rereads. Exact workflow
[`strategy-factory-linux-a0`](https://github.com/qOeOp/trade/blob/9e5149d4293a800be3a35e6b747a9f3dba304e1f/.github/workflows/strategy-factory-linux-a0.yml)
was read back through `workflow_dispatch` [run 33250411708](https://github.com/qOeOp/trade/actions/runs/33250411708)
at exact main head `9e5149d4293a800be3a35e6b747a9f3dba304e1f`. Its
[`strategy factory A0 native gate (linux arm64)`](https://github.com/qOeOp/trade/actions/runs/33250411708/job/99095016988)
job completed successfully on GitHub-hosted `ubuntu-22.04-arm`, bound as
`github-hosted/Linux/ARM64/aarch64`; immutable-input verification, the exact Rust 1.97.1 Cargo/rustc commits and
host, the sole `wasm32v1-none` target, all three exact consumers, and post steps were successful for the superseded
digest. That run is not acceptance for the replacement freeze. A new exact main-bound hosted run is required. The
exact consumers
were `develop_plugin_build_v2_tests::canonical_linux_sysroot_matches_the_frozen_generator_digest`,
`develop_plugin_build_v2_tests::real_bounded_plugin_builds_twice_and_exact_replay_joins`, and
`develop_composer_v2_tests::real_local_plugin_builder_supplies_composer_and_program_host`: respectively, they prove
the installed canonical sysroot matches the frozen generator digest, the real bounded plugin builds twice and exact
replay joins, and the real build supplies the sole crate-local Composer and `ProgramHostV2` path. This is
main-bound hosted native builder/Composer/ProgramHost evidence only, not an R&D Owner business receipt, durable
custody, deployed Dashboard or product readiness, kernel network confinement, Backtest or full RDQ proof, Paper,
Live, production/runtime deployment, provider integration, trading authority, or evidence for arbitrary complex
strategies. Unpinned hosts remain fail-closed and never substitute a generic toolchain.

### Strategy authoring surface

**TARGET / NOT_ADMITTED - authored strategy shape:** a Bounded Feature Program is written today as a
node graph. The two programs that exist were produced by hand-written generators, and what those
generators did is the evidence for what this layer has to be, in place of a designed-from-scratch
abstraction.

Only two of their abstractions are strategy concepts rather than graph plumbing: `all_of` over a list
of conditions, which lowers to a nested `Select` chain of `k+1` nodes, and `banded` over a measure and
an ordered list of threshold-weight pairs, which lowers to nested `Select`. The first was abstracted
in one generator and hand-expanded again in the second, which is the strongest available evidence that
it is a real primitive: it was needed twice and rewritten the second time. Both are pure composition
over the frozen primitive catalog, so a new strategy primitive costs nothing at the catalog level.
**A third program, deliberately chosen to share no shape with the first two, produced four primitives
neither of them had, and one of them - `not` - had appeared in all three and been hand-written in all
three. What is missing is therefore not sample size but a step that lifts what recurs, so this layer
is specified as open at that point rather than as complete.**

Five of the seven consistency points those generators maintained by hand are derivation rather than
decision: total state bytes, written in three places and summed from a hand-counted cell count; the
per-cell byte formula; the eight `bounds` integers, filled with numbers chosen to be large enough; unit
and scale along the DAG; and constants that exist only to give a port a value of its own unit and scale.
**The Owner already computes each of these, and none of them is a choice an author makes.** Ten
programs were later rebuilt from their meaning by the Owner's own derivation and matched their
references field for field, so this layer's work is not to compute them again but to stop short of
them.

Unifying those generators measured that claim: eight became one, 1232 lines became 487, and all
twenty-four emitted artifacts were byte-identical to their predecessors, so nothing about a program
had been living in the generator that wrote it. **The line is not that this layer derives nothing -
it is that the proposal layer need not be built at all.** For those ten programs the authored
`design` and `meaning` are 228 KB and 297 KB, and the 378 KB proposal is the Owner's. What stays on
the author's side is role identity, because `design` embeds it in each coordinate port id, and
`project_bfp_role_bindings` in `strategy_plan_v2.rs` rejects a binding whose coordinate port id is
not exactly that, so this is enforced rather than conventional. It is a digest over `InputRoleV2`, so this layer does depend on a struct field order that no contract text
states or undertakes to keep, and that coupling is a named residue rather than something this split
removes.

The part with no abstraction at all is exactly the declaration surface. Port identities derive from role
identity, and the second generator resolved that by reading a role-to-digest table produced by a separate
run. **That is the same split the validator reports: of ten rejections taking the first real strategy
through it, eight were the declaration surface and the graph not having been changed together, and two
were expressive bounds.** One artifact generating both sides is what makes that class unrepresentable. A validator rule
added afterwards - a variant-typed port's terminal must read a variant constant carrying its own
semantic id - found four errors already latent in prototypes of this layer, so that class is still
arriving. Where the contract constrains a declaration not at all, this layer cannot make it correct
either: which field a clocked extremum reads is unconstrained today, and two fixtures in the
repository feed `CLOSE` to a swing high.

This layer is a compiler and not a runtime. It emits the `design` and `meaning` that `declare`
already accepts - never a `BoundedFeatureProgramProposalV1`, which is what the Owner derives from
them - and the authored document is evaluated only in producing that pair. A unit is a syntactic product rather than an algebra - a
quotient of two prices carries the unit `PRICE/PRICE` and not a dimensionless one - so a relative
threshold either has its unit normalised by this layer or leaks that spelling into what an author
writes. **Derivation never replaces validation: a derived field is
checked afterwards by the same contract that checks a hand-written one, so a wrong derivation fails
closed rather than admitting a program the validator would have refused.**

**IMPLEMENTATION_ADMITTED - an authoring output that stops at meaning:** one bounded slice, whose
product is the `design` and `meaning` pair and nothing further. An earlier revision admitted the
opposite slice - computing state bytes, the `bounds` integers, and unit and scale - on the reasoning
that those are the layer's first job. They are not its job at all: they are the Owner's, and a
generator that produced them was measured to be reproducing work that already existed. The code this
slice adds is therefore less than the code it removes. It introduces no authoring syntax, no new
primitive and no execution path, and what it emits is checked by the same contract that checks a
hand-written declaration.

## Lineage and protected-feedback admission

The user or App supplies only an untrusted independence rationale. R&D derives and persists the disposition,
basis identity, and basis receipt; Product Edge cannot construct them. Qualification directly rereads the exact
R&D basis and returns an opaque projection only after inspecting its own complete principal/scope history.
Product Edge binds that projection to the trusted request context and transports only its ref, digest, source cut,
clock epoch, and half-open validity.

Within one locked S1 admission transaction, R&D rereads the basis, resolves its complete local predecessor history,
and verifies the current Qualification projection. A proven empty local history yields `GENESIS_EMPTY`; a non-empty
history yields the exact `COMPLETE_FRONTIER`; missing, stale, malformed, conflicting, cross-principal, cross-scope,
or cross-basis evidence yields `UNAVAILABLE`. `UNAVAILABLE` returns `SUBMITTED_OR_UNKNOWN` and writes no Research
receipt, Intent, TrialFamily root/member/head, or transition outbox. A malformed rationale under otherwise current
authority may produce only `REJECTED_NO_WRITE`. Same request, rationale, and canonical Owner cuts replay the exact
bytes; changed meaning or changed cuts cannot join. R&D never reads protected payload or detail.

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
| Evidence integrity  | Verify provenance, PIT time, universe and correction identity, Artifact, configuration, runtime, simulator, and deterministic request‑result equality.                                                                                                                                            | Repair or reject evidence before interpreting strategy performance.                                                                                                                             |
| Mechanism validity  | Compare the observed sign, path, regime behavior, and failure mode with the frozen causal mechanism, falsifier, and stop rule.                                                                                                                                                                    | Stop a falsified mechanism or create one successor mechanism hypothesis.                                                                                                                        |
| Economic viability  | Attribute turnover, fees, spread, slippage, market impact, liquidity, and capacity under the frozen model versions.                                                                                                                                                                               | Stop economic impossibility or revise one economic assumption before robustness work.                                                                                                           |
| Robustness          | Test sensitivity across time, regime, instruments, perturbations, and reasonable parameter neighborhoods without consuming protected evidence.                                                                                                                                                    | Distinguish stable mechanism support from a narrow parameter accident.                                                                                                                          |
| Failure attribution | Classify failure as data, artifact, runtime, simulator, mechanism, economics, robustness, or unresolved uncertainty.                                                                                                                                                                              | Route repair to the owning boundary and prevent invalid runs from becoming negative Alpha evidence.                                                                                             |
| Information value   | For each preregistered next experiment, bind the decision uncertainty, distinguishing observation or falsifier, possible result‑to‑action map, bounded acquisition cost, remaining family‑budget effect, competing alternatives, and replayable ordinal comparison rationale at one evidence cut. | Choose the highest‑ranked admissible experiment with a deterministic tie‑break; an unexplained ordinal is inadmissible, and stop is legal only for a complete non‑empty below‑threshold census. |

Backtest supplies one complete finite `diagnosticCategorySet` for each terminal exploratory result; Research
preserves every supported member and applies this exact mapping before interpreting economics:

| Run Result diagnostic set                                                                                       | Research disposition                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any of `MARKET_DATA`, `ARTIFACT`, `RUNTIME_KERNEL`, `BACKTEST_OPERATIONAL`, `SIMULATOR`, `REPLAY_CONFIGURATION` | Defect evidence preempts economic interpretation. Preserve all supported defects, then select one `REPAIR_INPUTS` target by `MARKET_DATA > ARTIFACT > RUNTIME_KERNEL > BACKTEST_OPERATIONAL > SIMULATOR > REPLAY_CONFIGURATION`. |
| No defect, with `NO_EXECUTION_DEFECT` or `VALID_ECONOMIC_FAILURE`                                               | Economic and mechanism interpretation is allowed; neither category forces iteration or selection.                                                                                                                                |
| `UNRESOLVED_FAILURE`                                                                                            | No Iteration Decision; retain the attempt in the census until isolating evidence exists.                                                                                                                                         |

### TARGET / NOT_ADMITTED - Replay Policy V2 authority and transaction topology

The Replay Policy V2 Catalog remains private to R&D. Every policy version is sealed, versioned, and
content-addressed; the explicit current-head fact and revocation facts are canonical R&D facts. Immediately before
the first TrialFamily-formation write, the private R&D formation resolver passes the existing R&D transaction to
its sealed Catalog read capability, which opens no second pool, connection, or transaction. It locks and rereads
the current unrevoked Catalog record and binds its exact version, content digest, head, and revocation cut. The
Catalog is the sole pre-formation policy source. An absent head, revoked version, stale cut, digest mismatch, or
unavailable read fails closed with zero TrialFamily, initial Census Frontier, receipt, or outbox write; there is no
implicit fallback.

The sole Catalog writer is a private audited R&D Catalog Administration Port. It owns policy creation, immutable
version append, explicit current-head advancement, and revocation. Each admitted administration command records
its authenticated administrative identity, exact predecessor/head, resulting content identity, and immutable audit
fact atomically. That audit fact is the durable command receipt. Catalog authority consists only of the immutable
record, singleton head, revocation, and audit tables; there is no separate administration receipt or outbox table.
Ordinary callers, Product Edge, the Dashboard, providers, and other Owners cannot invoke that port, select a policy
version, advance the head, revoke a version, or write Catalog storage. Environment values, defaults, migrations,
deployment configuration, and runtime selectors cannot seed or synthesize a policy or current head.

The only product composition allowed to bootstrap an empty Catalog is a dedicated, opt-in, one-shot
`authority-admin` composition. It has no API route and is not callable by Product Edge, the Dashboard, the R&D API, a
default service, a migration, or a runtime selector. It alone uses the separately supplied broker-only
`REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL` to reach the fixed Catalog Administration Port. The Rust composition
verifies the sealed Ed25519 request before database access; PostgreSQL does not independently verify Ed25519 and
trusts the exclusive `replay_policy_catalog_admin_writer` principal as that broker's mutation boundary. This
credential must never be distributed to operators, ordinary services, the Dashboard, or generic SQL clients;
possession or use outside the broker is a trust-boundary breach. `rd_fact_writer` retains Composer-only writes and
cannot invoke Catalog mutation.

Its private V1 request is a sealed, deny-unknown-fields document signed with Ed25519 and binds the request schema
version, bootstrap identity, administrator identity, separately trusted verifier identity, Catalog record
identity, complete canonical policy bytes, deterministic create and head-advance command identities, event time,
and signature. Before opening a database connection, the composition must parse the exact V1 schema, reject every
unknown or malformed field, verify the signature against the separately trusted verifier identity and key, and
cross-check every bound identity and canonical policy digest. The `authentication_fact_digest` is derived only
from that verified evidence; it is never accepted from the request, credential, environment, or caller assertion.

The transaction first locks and classifies the complete records/head/revocations/audits census. Only exact
`0/0/0/0` storage may create version 1 and advance the explicit current head to that
record, and atomically commits both deterministic commands as immutable authenticated audit facts. The sole public
projection is one deterministic typed Owner readback reconstructed from the exact sealed request and audited
record/head state. Resolution requires exact `1/1/0/2` plus exact record, head, and audit bytes; the record's null
genesis predecessor and signed actor/time provenance and the head's signed actor/time provenance must also match.
Every other partial, extra, or provenance-mismatched shape conflicts unchanged. First success and exact response-loss or restart replay return that same readback byte-for-byte
without a write; no attempt-local `CREATED`/`RESOLVED` field or execution-path marker may change its bytes. Changing
any bootstrap, create-command, or head-advance identity or meaning, or encountering an orphaned, divergent,
revoked, tampered, partially initialized, unauthenticated, or otherwise non-canonical state, is a conflict with
zero Catalog record, head, revocation, or audit change. Response loss and process restart may only resolve the same
deterministic commands; they cannot synthesize a replacement policy, identity, head, receipt, outbox, or success
result.

Deployment ordering is strict: bounded schema materialization, then custody cutover, then an explicitly invoked
`authority-admin` Catalog bootstrap. Default startup runs only the signed exact `rd_owner` readback, and only then may the R&D API
listen. No implicit policy or current head exists. Missing, unverifiable, mismatched, or unresolved bootstrap
readback fails startup closed.

This bounded composition is **IMPLEMENTATION_ADMITTED** on exactly the contract above and nothing wider; it may be
described as **CURRENT** only once its merged implementation and named acceptance evidence prove authentication
rejection, empty-store creation, exact replay, changed-identity and changed-meaning conflict, response-loss/restart
resolution, tamper rejection, every zero-change failure, and a subsequent accepted TrialFamily formation against
fresh disposable PostgreSQL and the isolated first-party acceptance topology. That status does not establish production deployment,
Workbench product readiness, provider readiness, or any real-trading authority.

Successful TrialFamily formation permanently seals the complete policy and its Catalog identity, version, digest,
grammar/parser identity, and digest cross-binding into the family. Later Replay or Composer composition uses only
that family-sealed policy and cross-binding and never rereads the Catalog as authority. A Catalog reread may be
audit-only and cannot affect admissibility; a later Catalog version, revocation, deletion, unavailability, or
tamper cannot replace the policy or invalidate a formed family.

Later Replay Policy V2 composition uses one R&D-owned A1 orchestration across two explicitly bounded Owner
transactions. A read-only `market_data_reader` transaction first acquires the exact Composer request's shared cut
lock, locks and canonically rereads the complete Composer aggregate through Owner-owned sealed functions, validates
it, and remains open through the Market terminal decision. Only then may the fixed `market_data_owner` login
principal open one SERIALIZABLE transaction, prove that both connections reach the same live primary, database,
postmaster incarnation and advisory
lock manager, acquire the same shared Composer cut lock as a database-level handoff, and perform every Market Data
lock, canonical reread, validation, seal and positive write. The Composer writer uses the matching exclusive cut
lock before every mutation, so either surviving shared lock prevents Composer drift until the Market transaction
commits or rolls back. No Owner or A1 may read another Owner's raw tables, reconstruct sealed evidence, transfer fact
authority, receive raw access to another Owner, claim a shared XID or MVCC snapshot, or claim cross-Owner atomic
commit. `market_data_owner` retains raw authority only over its own private Market Data relations. Any unavailable, stale,
mismatched, cross-cut, wrong-owner or wrong-database evidence, any failed lock-manager proof, or any invalid
family-sealed policy cross-binding fails before the first positive Market write. Binding, Replay facts, receipts,
outbox and issuance response bytes commit atomically only inside the Market Data Owner transaction; Composer
evidence is stable for the guarded window but was committed independently.

A disposable Catalog fixture is test-only. An isolated `SEALED_ACCEPTANCE` harness may use the private
administration port to create and explicitly advance one fixed content-addressed policy head in its fresh
PostgreSQL instance. The fixture, administrative hook, and policy bytes are not runtime defaults, migration seed
data, production configuration, or evidence of deployed Owner/Dashboard readiness.

### TARGET / NOT_ADMITTED - same-cut Decision and Selection composition

`DecisionCompositionRequest` is locator-only: it identifies the R&D-owned TrialFamily and one Backtest-owned
exploratory Result but supplies no Result bytes, diagnosis, readiness judgment, policy outcome, next action, or
Selection. A neutral locator or `vibe-backtest-owner-contracts` representation carries no authority. R&D derives
all six diagnosis dimensions, result readiness, total-precedence branch, policy outcome, and selected identity
internally from canonical Owner facts.

In one R&D-owned PostgreSQL transaction, R&D locks its canonical TrialFamily Census, consumed budget,
candidate-set and attempt frontiers, decision-policy version, and every other predecessor used by composition. On
that same transaction it uses the dependency-neutral but Backtest-Owner-bound `vibe-backtest-result-custody`
adapter to lock and verify the canonical Backtest Result, receipt, and outbox. Immediately before the first
write, R&D samples one final cut, derives Diagnosis and readiness, and co-commits exactly one Iteration Decision,
the selected-only Research Selection only when that decision is `READY_FOR_SELECTION`, and their R&D outbox
entries. Backtest remains results-only authority; R&D remains the sole diagnosis, Decision, and Selection Owner.

Any missing, stale, cross-spliced, wrong-owner, wrong-function, ACL-mismatched, noncanonical, digest-mismatched,
receipt-or-outbox-incomplete Result, incomplete Census/budget/frontier/policy, caller-authored derived field, or
read through a separate pool or transaction fails before the first write with zero Iteration Decision, Selection,
or outbox change. Same-meaning retry joins the same committed composition and returns byte-identical receipts;
after response loss, exact `RESOLVE` can recover only that pre-existing outcome and cannot create first custody,
rerun policy over a new cut, or create a replacement Decision or Selection. This remains a TARGET contract until
real disposable PostgreSQL evidence proves the same-cut positive path, every zero-change rejection, restart, and
response-loss recovery. It adds no dependency cycle, Dashboard implementation, deployment, production write,
provider effect, Paper, Live, or trading authority.

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
   digest, all taken from the Intent's frozen information-value policy rather than recomputed at decision time. Duplicate identities, content digests, or complete comparison keys invalidate the set and create no
   successor, selection, repair effect, or low-information stop. `STOP_LOW_INFORMATION_VALUE` is valid only when
   every member of that complete census is admissible, comparably scored against the preregistered threshold, and
   proven below it. An incomplete, unknown, inadmissible-for-another-reason, or non-comparable census creates no
   Iteration Decision. The selected identity must equal the unique computed winner.
4. Iteration Decision commits one mutually exclusive outcome: `REPAIR_INPUTS`, a successor experiment,
   `READY_FOR_SELECTION`, or a terminal stop. A successor freezes a new Research Intent, Artifact when required,
   and Replay Request identity. Research Selection is legal only from exactly one `READY_FOR_SELECTION` decision
   with the same decision-policy version, TrialFamily Census, and evidence cut; a stop state and selection cannot
   coexist.

`REPAIR_INPUTS` routes by category and never means "retry anything." It is an immutable terminal disposition for
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
- [Market Data](./market-data/) supplies point-in-time facts, catalog versions, and instrument semantics. For each
  initial PIT Market Snapshot Request it returns one move-only, Market Data-sealed `ResearchPitTerminal` correlated
  to the exact request identity and content digest, carrying the canonical six-state disposition `AVAILABLE`,
  `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, or `UNAVAILABLE` and the exact Universe Selection Record
  identity and digest. Only `AVAILABLE` may enter a frozen or successor Intent; every other state freezes only the
  dependent Intent, and an absent response remains unknown. For a committed Market Data Repair Request it
  separately returns the correlated `AVAILABLE` or `UNAVAILABLE` terminal.
- [Backtest](./backtest/) returns, for each R&D-owned Exploratory Replay Request, one Exploratory Run Result in
  exactly one of `RUN_REJECTED`, `IN_PROGRESS_OR_UNKNOWN`, `TERMINAL_RESULT`, or `INVALID_REPLAY_EVIDENCE`. The
  result repeats the consumed Artifact, PIT scope and PIT Market Snapshot, Universe Selection Record and correction
  rule, replay configuration, Runtime kernel, simulator, and cost, slippage, and capacity-model identities, plus the
  complete finite `diagnosticCategorySet` with each member's decisive evidence cut. Research may use only a
  request-equal `TERMINAL_RESULT`; a rejected, invalid, unknown, nonterminal, or unequal attempt stays a
  TrialFamily Census fact and may produce only `REPAIR_INPUTS`, never a Selection or successor hypothesis. Reading
  a result never creates a successor Intent by itself.
- [Qualification](./qualification/) returns no protected feedback to the submitted Candidate's loop. Research
  observes only the write-once `ADMITTED` or `NOT_ADMITTED` Candidate Intake Receipt that closes the exact
  Qualification Review Request, and the bounded public Qualification Status Summary, both through Product Edge.
  Receipt absence remains `SUBMITTED_OR_UNKNOWN`; `NOT_ADMITTED` creates no protected attempt and consumes no
  holdout, and changed meaning cannot join the receipt or create a second intake.
- Committed generation-scoped Performance, Runtime Incident, Execution account/order/fill/quality-observation,
  Effect Journal, readback, and Reconciliation Drift facts may be admitted only
  as a new Research Source Provenance Record for a successor lineage. They can never mutate the deployed or
  previously selected Intent, Artifact, Candidate, or protected evidence boundary.
- [Runtime](./runtime/) supplies committed generation-scoped Incident facts directly for successor-only source
  admission. [Execution](./execution/) supplies committed account, order, fill, quality-observation, Effect Journal, readback, and
  Reconciliation Drift facts directly for the same purpose. Neither handoff can tune the running generation or
  reveal protected Qualification evidence. Each Research Source Provenance Record binds the exact committed fact
  identity and source cut; Effect Closure View and Event Rail wake are not admissible substitutes.

## Output handoffs

- To [Market Data](./market-data/): before exploratory consumption, one R&D-owned frozen initial PIT Market Snapshot
  Request bound to the Research Request, Intent, and TrialFamily identities, the requested instrument or universe
  scope identity and version, the four-time decision cut and PIT semantics, the required provenance, Source Binding
  and dataset version set, the license, rights, retention, and attribution policy cut, the correction and revision
  frontier cut, a stable request correlation identity, and requested-at Time Evidence. R&D owns its identity and
  content digest; the same identity and digest join one Market Data attempt, while a changed scope, cut,
  provenance, license, correction, or meaning requires a successor request. Transport success leaves the request
  `SUBMITTED_OR_UNKNOWN` and proves no snapshot availability.
- To [Market Data](./market-data/): only a committed `REPAIR_INPUTS` Iteration Decision may produce a Market Data
  Repair Request. The request asks its native Owner to repair evidence; it does not prescribe an adapter, rewrite
  the old snapshot, or claim availability.
- To [Backtest](./backtest/): one R&D-owned frozen Exploratory Replay Request bound to the exact intent,
  artifact, data scope, replay configuration, and cost, slippage, and capacity-model identities. The isolated EVENT
  replay route supplies only its R&D-native sealed locator/receipt; every downstream Owner re-resolves the fixed
  read-only R&D port and verifies the canonical request bytes and digest rather than trusting a locator label or a
  downstream attestation.
  A `REPAIR_INPUTS_SIMULATOR` or `REPAIR_INPUTS_BACKTEST_OPERATIONAL` decision may additionally create one
  correlated `native-repair-request`; Backtest alone returns `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN` for
  that exact category-specific attempt.
- To [Runtime](./runtime/): only a committed `REPAIR_INPUTS_RUNTIME_KERNEL` decision may create one correlated
  `native-repair-request`; Runtime alone returns `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN` for that exact
  kernel attempt.
- To [Strategy Governance](./strategy-governance/): the sealed Build Receipt an Owner admission rereads before a
  lifecycle decision, resolved at the exact Artifact identity and digest the receipt was sealed under, carrying the
  intent, TrialFamily, code bytes and dependency set it binds. R&D states what it built and nothing about whether
  that Artifact may run: a Build Receipt is never an activation, never a qualification, never a capital decision,
  and never evidence that any lifecycle state was reached. A receipt that cannot be resolved at that exact identity
  and digest is absent, not stale, and an absent receipt admits no lifecycle transition rather than a cautious one.
- To [Portfolio](./portfolio/): the frozen Research Intent a degradation attribution names, resolved at the exact
  intent identity and digest, carrying the prediction and falsifier that intent froze and the cut they were frozen
  at. R&D supplies the frozen prediction only; it observes no realized performance, attributes no cause, and
  measures no deviation. A Research Intent is never a performance claim, never a capacity statement, and never by
  itself evidence that a mechanism degraded - the deviation and its preserved alternatives are Portfolio's, and
  neither Owner may derive the other's half.
- To [Qualification](./qualification/): only a R&D-owned frozen Candidate with a terminal
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

**CURRENT_PARTIAL - bounded verified-outcome reads.** The R&D Owner answers two authenticated zero-effect reads
over one historical custody cut it resolves itself: the verified Research outcome list and the verified Build
outcome list. Each answers newest first, carries at most the rows the caller asked for and never more than the
bound this Owner owns, and echoes both the custody cut it resolved against and whether it truncated. A Research row
carries the request identity, the committed time, the resolution and the question binding; a Build row carries the
build request identity, the attempt identity, the committed time and the disposition. The caller names neither the
cut nor a row beyond its bound, so a consumer cannot state a coordinate this Owner did not resolve. The two lists
are independent: one answering unavailable or at a different cut withdraws only its own rows and counts. Neither
read admits a Plan, Artifact, receipt bytes, source text, or any mutation, and neither is a Selection, Candidate or
Qualification fact.

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

- **Inputs** - admitted source provenance, PIT facts, frozen Intent and experiment policy, exhaustive TrialFamily
  Census, and request-equal exploratory results.
- **Diagnosis and decision** - interpret the six diagnosis dimensions, then commit exactly one repair, successor,
  ready-for-selection, or stop outcome under the typed experiment rules.
- **Conflict resolution** - evidence validity and frozen falsifier outrank performance appeal; ordinal information
  value plus the declared tie-break chooses among otherwise admissible next experiments.
- **Outputs and terminal negatives** - successor Intent, `READY_FOR_SELECTION`, a typed `REPAIR_INPUTS`, or a named
  stop; correlated unavailable Market Data repair yields `STOP_INPUT_UNAVAILABLE`, while unknown evidence yields no
  decision.
- **Feedback and economic meaning** - exploratory and committed owner facts can improve a successor lineage while
  costs, slippage, capacity, trial budget, and expected decision value prevent uneconomic endless search.
- **Prohibitions** - no protected-detail feedback, in-place mutation, hidden sibling trial, deployment, capital,
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
