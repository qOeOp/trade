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
- **TARGET:** the append-only Research knowledge ledger of mechanism statuses, construct effects and findings, each
  bound to the evidence it rests on, which every new or successor Research Intent is checked against.
- Write-once Iteration Result Admission binding one locked canonical Backtest Result to the iteration that may
  consume it. The Owner derives every admitted fact inside one READ COMMITTED R&D transaction, the isolation
  the Product Edge admission lock admits, from the Result bytes, the exact TrialFamily census cut and the sealed
  trial budget; the caller supplies only the locator, the result and request-meaning digests, the canonically
  ordered candidate proposal set, and the Product Edge admission locator that authorized the mutation. The
  transaction first takes the Result's admission lock, so a concurrent admission of the same Result waits and then
  reads what that one committed. It then locks the family's census head before it reads the census members and
  attempt cuts: a census append holds that head from before its first row until it commits, so the census the
  admission binds is one cut and no append lands before the admission commits. The Owner resolves the Product
  Edge admission inside the same transaction, verifies it names this exact request, operation,
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
permission by itself. Widening the admitted set requires changing this document first. Every row names the symbol
or path that would falsify it.

Three slices of this document are `IMPLEMENTATION_ADMITTED`, and this ledger names them because it previously
claimed none were. The claim was already false when it was written, and a reader who trusted it would have read
an admission as invalid:

- the authoring output that stops at `design` and `meaning`, under **Strategy authoring surface**;
- the authoring language V1 in the same section, which nothing implements at this cut;
- the bounded Replay Policy V2 composition, whose admission is stated in the body of a section headed
  **TARGET / NOT_ADMITTED**. The heading governs the wider target; the admitted composition is the narrower one
  the body fixes. Reading the heading alone gets the opposite answer, in both directions.

- **CURRENT - deployed service and the boundary of what it exposes:** `product/rd-workbench/Dockerfile.owner`
  builds `--bin strategy-factory-rd-owner-api`, and the three Replay Policy Catalog binaries of the same package,
  with `--features composer-v3-replay` and no other feature; the dashboard read binary is built with none. So the
  deployed image registers `/v3/exploratory-replay-requests/composer-backed` and
  `/v2/exploratory-replay/execution-input-bindings`, and the Composer's own
  `/v2/develop-composer/runs/{request_identity}/resolve` and `/readback` answer from custody. It does not build
  `native-replay-execution`, so `/v2/exploratory-replays` and the two `/v1/market-data-repair-requests` routes are
  absent, and no sealed feature, so the four `/_sealed-acceptance/v1/develop-composer/*` routes under
  `#[cfg(feature = "sealed-source-intake-composer-acceptance")]` are absent too. The production features carry no
  acceptance fixture, corpus or route; the sealed features include them rather than own them. An acceptance route
  is never evidence of a production capability, and the sealed features exist to keep that distinction mechanical
  rather than remembered.
  The image runs at the product's fixed-point precision, `FIXED_PRECISION` 16, without a build flag:
  `vibe-strategy-factory` declares `high-precision` on its `vibe-model` dependency, and
  `scripts/ci/check-production-features.py` fails a production package that links `vibe-model` without it.
- **CURRENT - the deployed Source Intake pipeline stops after admission:** `SourceIntakeEnvironmentPort` has two
  implementations. `SealedSourceIntakeEnvironmentV1` sits behind `sealed-source-intake-acceptance`, which the image
  above does not build, so the one that ships is `ProductionEnvironmentV1` in
  `crates/strategy_factory/src/source_intake/owner.rs`. It implements `terminal_preflight`, `admit` and
  `resolve_terminal`. `resolve_policy` answers `Ok(None)` unconditionally, which `SourceIntakeWorkflowV1::run`
  turns into `PolicyUnavailable`, and the nine stages after it - `commit_binding` through `commit_terminal` - are
  unconditional `Err(Unavailable)`. A deployed Owner therefore admits a source intake request and acquires
  nothing. Where it stops is worth separating from where a probe of it stopped, because they are not the same
  hop. As shipped the run ends at `resolve_policy`, and `PolicyUnavailable` answers `202` with a log. A live
  request to a deployed Owner never reached that: it answered `503`, which only `Unavailable` produces, from a
  hop before `resolve_policy` - and until that arm was instrumented it recorded nothing, so which hop could not
  be said. The nine stages are therefore unreachable twice over, once because `resolve_policy` returns first and
  once because that deployment did not get that far. Read this carefully against the
  [Source Intake Playbook](../guide/source-intake/), which requires exactly that answer while any
  `LIVE_EXTERNAL` authority is absent and forbids falling back to a fixture. Unavailable is therefore the
  contract-conformant answer today, and the gap is a different one: these stages do not consult an authority and
  then fail closed, they ignore their inputs, so supplying every authority the Playbook names would not change
  the answer. The path that runs when they are present is the part that does not exist. The one that does is
  `SealedSourceIntakeEnvironmentV1`, an acceptance-only class that by the same section permits no external
  network at all. Which stages are still missing is not kept here: `UNIMPLEMENTED_PRODUCTION_STAGES` in that
  module lists them, and a guard fails if the list and the code disagree. Read the list, not this paragraph, for
  the current count. The route answers this as `SUBMITTED_OR_UNKNOWN` with `RESOLVE_SAME_REQUEST`, which is what
  the refusal rule under Lineage and protected-feedback admission gives it: what refuses is the environment, the
  absent `LIVE_EXTERNAL` authority the Playbook names, not the request, whose own refusals (a conflicting identity,
  a malformed body) the route already answers by name. That no retry changes the answer today is the build's
  missing capability, listed in `UNIMPLEMENTED_PRODUCTION_STAGES`; it is not a property of the request and calls
  for no answer of its own.
- **CURRENT - the composer-backed Exploratory Replay request path is in the deployed image:**
`commit_composer_backed_exploratory_replay_request_v3`, its route `/v3/exploratory-replay-requests/composer-backed`,
its tables and their migration exist only under `composer-v3-replay`, which the image above builds. A database that
was materialized before cutover by that image has the tables; one materialized without it, or cut over since, gains
`rd_research_view_transitions_v3` from `postgres-init/10-migrate-authority-custody.sh`, which every deployment runs. Nothing in this document, `docs/owners/backtest.md`
or `docs/architecture/` marks the path `TARGET`, `IMPLEMENTATION_ADMITTED` or any other state, so its state is
read from three statements instead. The deployed-service bullet above says an acceptance route is never evidence
of a production capability. `docs/guide/dashboard.md` says the boundary lifts when a deployed image carries a
path that produces Composer artifacts, and that the v2 commit then retires or is replaced by this one. Such a
path is compiled and registered in the default build: `/v2/develop-composer/runs` runs the production Composer on
the Research request's frozen Bounded Feature Program
(`PostgresSourceResearchComposerProductionV2::run_bounded_feature_program`), which reads the joint freeze and
Market Data's bindings and does not go through Source Intake, so the Source Intake bullet above no longer names
the hop in the way. A build that enables `composer-v3-replay` carries that Composer and this commit together and
no acceptance code. The ordered chain's build is not that build: its acceptance feature includes
`composer-v3-replay` but also replaces the Composer's run with the fixed corpus. The deployment decision that
admits the path into the image was taken under the user's B0 authorization, which admits exploratory replay
without money or exchange credentials. Issuing its execution-input binding still answers `503`
`MARKET_DATA_SCHEDULING_NOT_ADMITTED` until Market Data scheduling is admitted, which is `B3`.
The ungated v2 commit cannot stand in for it. Native Replay preparation parses the request's `artifact.digest`
as a `sha256:` digest before it queries Composer, while a v2 commit succeeds only when that digest equals the
Artifact Build Owner's `blake3:` wasm digest; and the request's `artifact.identity` would have to equal the
Artifact Build `blake3:` identity for the commit and Composer's `rd-strategy-artifact-v2-` locator for
preparation. No v2 request reaches issuance. By the same deployed-service bullet, enabling the feature in the
ordered chain's acceptance build admits nothing in production.
- **CURRENT - what a composer-backed Replay stores for each composition shape:** the stored Composer source,
  `composer_source_json` and the same value inside `frozen_json`, records by its `schema_version` the shape of the
  Replay composition cut it was composed from. Schema 3 is the first corpus and carries the three Instrument Master
  fields its cut binds. Schema 4 is the universe-member shape and carries none of them: that shape binds no
  Instrument Master at composition, which the native initial binding verifies later through the request-keyed
  Instrument Master V2 cut, so nothing between the two may record one as verified. An absent field is not
  serialized, so a schema 3 source keeps the bytes it had before schema 4 existed; a unit golden in
  `exploratory_replay/composition_v3.rs` pins them. The Replay request's `resolved_owner_inputs` is the observation
  census for the first corpus and the universe frame, whose identity is its BLAKE3 digest, for the universe-member
  shape. A universe-member frame is re-derived here, not by Market Data: before either the commit or the readback
  composes, the Design's persisted universe input custody is re-read on the R&D transaction and its frame must be
  the frame the facts and the binding record. Market Data's resolver holds only the binding, not the Research
  request and decision cut that re-read needs, so the check sits with this consumer, where the first corpus
  re-reads its census. Every disagreement is refused by name as a `ComposerReplayShapeRefusalV1`: an unknown
  source schema, a schema 3 source missing an Instrument Master field, a schema 4 source carrying one, a source
  schema other than the one its binding's shape records, a binding and facts of different shapes, frames that are
  not one frame, and a frame the custody no longer re-derives. Schema 4 is only ever written new: no universe-member
  composition binding could be issued before it, so no stored row has that shape and none is backfilled. The commit
  and the historical readback both bind the Composer's inputs through the production binding Owner, which re-reads
  Market Data custody, never the acceptance corpus's fixed frame. No SQL function reads the source sub-object of
  either column; one that starts to must branch on the source schema first.
- **CURRENT - how execution-input binding issuance refuses:** `/v2/exploratory-replay/execution-input-bindings` and
  its `/resolve` give five refusals their own status and code: a conflict with an issued binding and the two
  Instrument Master refusals (`409`), a request that names no composition binding (`422`), and a resolve that finds
  no binding (`404`). Every other refusal is `503` `NATIVE_REPLAY_EXECUTION_INPUT_BINDING_UNAVAILABLE`, and each
  names its cause in the body's `cause` and the `x-rd-rejection-cause` header. The causes are `NativeReplayExecutionInputBindingCauseV1`, a closed list
  whose wire names are matched with no wildcard: one for each issuance stage, one for each clause of the check that
  the Owner readbacks agree with each other and with the request, and one for each custody check on the binding
  itself. The service adds `STORE_UNAVAILABLE` for a database error, and one cause for each Owner port it was
  composed without. A deployed image composes every port except Market Data scheduling, which it gains only
  through the Store Admission that `B3` builds, so until then its answer is `MARKET_DATA_SCHEDULING_NOT_ADMITTED`.
  With scheduling admitted and no BAR schedule committed for a member at the frame, the answer is
  `BAR_SCHEDULE_ABSENT`: Market Data names that absence as `NoBarScheduleAtFrame` and `ScheduleAbsent`, apart from
  a read that failed. The status is `503` for every cause. Moving one off `503` needs the per-variant analysis that
  `replay_composition_refusal` records for its own refusals. The issuance stages also log the Owner's detail under
  `native_replay_initial_binding.<stage>`; the cause itself carries no Owner detail.
- **CURRENT - which TrialFamily state a composer-backed Replay binds:** the same state the legacy exploratory
  Replay binds. A Replay of the family's formation Intent binds the family as it formed, with its formation census
  frontier, and is admitted only while the family has no attempt; a successor binds the family's V2 census. An
  attempt is one Replay recorded after its Result, which R&D records when it counts that Result ("CURRENT - every
  committed exploratory Result is counted", below), so a family's first Replay can never compose against a V2 census,
  and once that Replay's Result is counted a new Replay of the formation Intent is refused. A successor of a family
  with no counted attempt is refused by name, `SUCCESSOR_CENSUS_AWAITS_DECISION_COMPOSITION`; a successor Intent is
  committed only from an Iteration Decision on a counted Result, so its family has one. The commit and the historical readback take the choice from one
  rule, and the readback of a first-generation Replay re-reads the formation frontier from the family's root, so a
  later attempt does not change it. Its replay window is the window of the facts it was composed from, which the
  family's policy window bounds (`docs/architecture/strategy-factory.md`, TrialFamily-owned Replay execution policy
  V2), and a Market Data repair re-entry whose predecessor is a composer-backed Replay is refused by name,
  `MARKET_DATA_REPAIR_OF_COMPOSER_V3_REPLAY_AWAITS_DESIGN`, because the re-entry forms its successor from the
  policy window.
- **CURRENT - how Native Replay preparation reads a composer-backed Replay's Research custody:** as the Replay
  committed it, not as the current custody reads. The commit moves the Research View from IntentFrozen to the
  schema 3 View that names the Replay, and records the move as an append-only transition, so a read that wants the
  current custody to still be IntentFrozen refuses every committed Replay. Preparation therefore admits a native
  Composer View only as that transition's new View, and reads the Composer operation over the transition's old
  View, the way the Replay's own readback does (`read_accepted_for_replay_historical_in_transaction`), in the
  issuance transaction. A current View that a later Replay has moved on is refused by name,
  `native Composer Research View has moved past this Replay`: once a second Replay commits on the same Research,
  the first can no longer be prepared. No Research reaches a second one today, because the commit requires the IntentFrozen View it
  moves and a successor waits for the Decision composition below. Revisit this rule when the Decision composition
  or successor iteration is admitted. A build without the COMPOSER_V3 routes refuses a native Composer View by
  name.
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
- **IMPLEMENTATION_ADMITTED / NOT_CUT_OVER - the exploratory replay production entry:** the only caller of
  `run_exploratory_replay_v2` outside `vibe-backtest-owner` is inside `run_native_replay`, which carries
  `#[cfg(feature = "native-replay-execution")]`, a production feature with no acceptance code, with no
  `cfg(not(...))` twin anywhere in the repository. With the deployed image built without `native-replay-execution`, that path is unreachable in what is deployed. This
  measures the deployment artifact, not history.

## Modules

- **Source Intake** - admit papers, observations, notes, media, and tool output as untrusted data with origin and
  content identity. Source content is never an instruction, capability grant, or authority to call another Owner.
  The provider-neutral implementation baseline is the [Source Intake Playbook](../guide/source-intake/).
- **Research Intent** - freeze the falsifiable mechanism and experimental contract before result observation.
- **Strategy Artifact** - preserve immutable content, dependency provenance, market semantics, runtime capability,
  sandbox policy, and Artifact Security Admission consumed unchanged by replay, qualification, and governed application.
- **Development Sandbox** - build and diagnose the code an Owner lowers a strategy's authoring document into, and the
  code of an attended D-only repair, with explicit input and output mounts and no
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
binding row locks were taken in. `freeze` takes an already assembled pair instead, and admits each of its
inputs only as exactly what `declare` derives for that role, value port, clock and binding receipt: both
routes call one derivation, so a pre-assembled program can restate the Design's roles but never differ from
them. Both admit the pair
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

**A committed Composer run reads back at the View it ran under.** In the transaction that commits
it, the run records two facts of that operation beside its receipt: the Research View it ran under
and the Owner read cut it ran at. Nothing rewrites them. `GET /v2/develop-composer/runs/{request_identity}/readback`
re-derives the stored positive record against that View at that cut and relocks the Market Data
bindings at that cut, so the run stays readable after its Research View has expired or has moved to
`ARTIFACT_AVAILABLE` or `EXPLORATION_ACTIVE`. A View expires ten minutes after its projection and
nothing refreshes it, so without the record every run became unreadable within ten minutes of its
Research request's acceptance. The recorded View is not trusted as written. The Research artifact
evidence must have been sealed for it (`rd_owner_api.lock_research_for_artifact_at_view_v1`), the
stored View must be a legal descendant of it, the cut must lie inside its validity window, and the
operation receipt's Research custody digest must equal the one rebuilt from it. The first three
failures answer `UNAVAILABLE` at their own coordinates under `research_custody.run_view`; a differing
digest answers at the existing `operation_receipt` coordinate. A row committed before the
record existed carries neither fact: it keeps the read against the current View. Once that View has
moved past `INTENT_FROZEN`, or the authority it continues under is no longer current (see below), it
answers at `research_custody.run_view_unrecorded`, which
states why the row cannot be read instead of implying that the run is gone. Such a row therefore reads
back for as long as the operator authorization its Research request was admitted under lasts. Once that
authorization expires or is revoked, it answers under the continuation's own coordinate,
`research_custody.continuation.authority_not_current`, not the unrecorded one. A row that recorded its
View does not depend on the authorization at all. The migration adds the two
columns by reading the catalog shape first; they freeze when the migration is deployed, not when it
merges.

**An admitted Research Intent continues under the authority it was admitted under, not inside its
View's window.** A View's `valid_through` is a reader's freshness: past it the View reads `STALE`,
and nothing refreshes it. It does not bound how long the frozen Intent may be worked on. Each of
these continuations re-locks the Intent's own Product Edge admission at its own cut, the way a
downstream first mutation does:

- the Composer run;
- `POST /v1/bounded-feature-programs/{declare,freeze}`;
- publishing the Design role intent;
- reading the Research authoring facts;
- freezing a complex-strategy develop evaluation;
- the Artifact build: preparing it, reserving its provider invocation, recording its candidate and
  committing its terminal result. A successor's build continues under the successor's own admission
  and the protected feedback it froze, not its family's initial Intent's.

Each continues only while the operator authorization that admission names is current there: in
force, not revoked, and under a current policy binding and manifest window. Otherwise it answers
`UNAVAILABLE` at `research_custody.continuation.authority_not_current`. Two other refusals are named:

- a re-locked admission that is not the one the Intent was admitted under answers at
  `research_custody.continuation.admission_changed`;
- a quarantined legacy custody carries no current admission and answers at
  `research_custody.continuation.no_admission`.

Each also continues only while no protected evaluation has become observable to the Intent since it
was frozen. Every public Qualification phase fact of the principal/scope history advances that
history's protected-feedback generation (see Qualification's protected-feedback generation), so the
continuation reads the history's current source cut for the projection the Intent froze and
compares it with the one it froze. It holds the history's head `FOR SHARE` until the continuation
commits, so no phase fact can land in between. A later cut answers at
`research_custody.continuation.protected_feedback_advanced`: iterating on the Intent then goes
through a successor Intent, which freezes the history's new generation (Lineage and
protected-feedback admission). An Intent whose frozen projection or history cannot be read answers
at `research_custody.continuation.protected_feedback_unavailable`. A candidate's own phase fact
counts as well, so once the Intent's candidate enters Qualification its continuation stops.

The frozen View still identifies the Intent: a cut before its projection is refused, and the Intent
must still be `INTENT_FROZEN`.

A read that only projects an Artifact build's next action, its readback and its resolve, takes no
lock: it answers from the authorization the build's admission recorded and the stored View's
availability, and the mutation that follows proves the continuation again and refuses by name. A
read at a cut an operation already wrote at asks only that the Research authority it recorded covered
that cut: the Research sources that the Backtest run, the execution-input binding and Market Data
repair read at their Replay's Owner cut, where the Replay commit proved the continuation.

Product Edge admits a new Artifact build request past the View's window as well. Its admission
still checks that the Research was projected, and locked by R&D, no later than its cut, and that the
source authorization the Research was admitted under is in force and not revoked there. The R&D
functions it locks the Research through, `rd_owner_api.lock_research_for_artifact_at_view_v1` and
`rd_owner_api.lock_current_successor_research_for_artifact_v1`, no longer refuse a View past its
window either.

Until its own slice lands, one check still reads the View's window: the exploratory Replay commit,
whose file F holds, so until it moves every step after a Replay reaches only a Replay committed
inside the window.

**CURRENT/PARTIAL - the first cycle now has something to stand on.** Sealing the corpus run leaves
`run_bounded_feature_program` as the only production entry, and it requires a frozen joint program.
Freezing one requires Strategy Input declarations, and Market Data used to register those only from
a Composer attestation, which a Composer commit is what mints. Every later cycle closes on itself -
a commit's own response carries exactly the locator the registration takes - but the first had no
origin, and no artifact-bound shape could supply one: a program's identity folds in the very binding
receipts the registration issues. This Owner therefore publishes a Design-level role intent, which
names a Design, the Research request and custody it was admitted against, and the roles it declares,
and nothing else. Each role's scope decides whether it names an instrument: an exact-instrument role names one, and a
universe-member role names none, because the selection is the PIT request's rather than the Design's.
`POST /v1/strategy-designs/publish-role-intent` derives it from currently accepted custody and stores it
write-once per Design; from schema 2 it also names the Intent's initial PIT request, as the requested-instrument-scope
contract below states;
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

**The Composer path holds a Research Intent with nothing to project, and that is why the prohibition
stands.**

No Research Intent in this repository declares channels. The formation path's `ResearchIntent` did
(`data.channels`, each with its role, asset, timeframe and staleness bound), but it was only ever
built from one frozen compile-time representative, never reached the Composer path, and was removed
with the formation retirement.

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
single threshold**, with the decision clock taken from `data.decision_clock_channel`. A program of the family
proposes each side only from a position the kernel accepts it at, and holds otherwise, so it carries the position it
believes it holds in a state cell: the kernel accepts an entry only from flat and an exit only from a held position
(`validate_position_transition` in the program SDK), and a refused proposal aborts the whole run
(`program_host_v2.rs`), so a program without that belief could not survive a second bar above its threshold. It may
also name three exits, each judged at the bar close and proposed there, so that it fills on the next frame and not
at the exit level inside a bar: `stop_loss_fraction` and `take_profit_fraction`, measured from the close the position
was entered at and admitted only on a close channel, and `max_holding_bars`, counted in frames. That belief and those
exits belong to the family; neither makes its threshold depend on state. Every graph
outside that family - two signals, a conjunction, a state-dependent threshold, a threshold this
Owner would have to choose - remains a proposer declaration this Owner admits rather than derives. A proposer
may declare such a graph as `meaning` directly or as a document in the authoring language under **Strategy
authoring surface**; the language compiles one into the other and decides nothing, so neither route makes this
Owner derive a graph.
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
them. That reproduction is not admission: derivation copies the graph through without inspecting
it, and its six refusals name identities, plugins and roles but never a graph. The graph is judged
afterwards, in `prepare_bounded_feature_program_v1`, and when a check was first placed there four of
those same ten programs were refused. **A layer that emits `meaning` therefore has to be checked
against the stage that reads the graph, because the stage that rebuilds a proposal from it would
accept a graph that cannot run.**

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
slice adds is therefore less than the code it removes. It introduces no new primitive and no execution
path, and what it emits is checked by the same contract that checks a hand-written declaration. The
single-threshold author is its first product and stays byte-for-byte what it is; the authoring language
below is admitted on the same terms and makes that family one of its special cases. Its bytes changed once
since, on purpose: a side's reconciliation target reads that side's target position, because the kernel
requires a position target and its reconciliation target to be equal, and the single constant of 0 both sides
once shared made every program whose sides held different positions unrunnable - the target-set Host refused its
entry side before the first order. A program frozen from the old bytes could never have run, and it is now
outside the family. They changed a second time, on purpose, for the same kind of reason: a program proposed its side
on every bar its comparison held, so under the kernel rule above every program of the family aborted its run on its
second bar above the threshold. Each program now carries the position it believes it holds, and proposes a side only
from a position the kernel accepts it at. No deployment had frozen a program of the family when this changed, and a
program frozen from the earlier bytes is outside the family.

**CURRENT - strategy catalog:** an authored single-threshold strategy is held as an immutable statement, named by
its content and bound to no Research request. The statement is `SingleThresholdAuthoringRequestV1` without its three
Research identities (`SingleThresholdStrategySpecV1`). Its `strategy_id` is the domain-separated SHA-256 of its
canonical bytes, not a Design identity: a Design hashes the Research request and Intent it answers, so one statement
makes a different Design under every request. Every value a statement can spell more than one way is brought to its
one spelling before it is hashed, so one strategy has one identity: the threshold is rewritten to its one decimal
spelling at the channel's scale. A statement is admitted only if it authors, so the
catalog never holds a strategy a run would refuse at authoring.

- `rd-owner-api` serves it under `/v1/strategies`: validate (authors and writes nothing), create (the same statement is
  the same strategy), get (the stored bytes, which hash to the identity, so a row whose bytes changed is refused rather
  than served), list, revise (a new statement naming its predecessor) and archive (the strategy stays readable and can
  no longer be revised or run). An authoring refusal keeps the author's name (`SINGLE_THRESHOLD_*`, or `THRESHOLD_*` for a threshold the
  channel cannot hold).
- Two append-only R&D tables hold it, `rd_strategy_specs_v1` and `rd_strategy_archives_v1`. Neither names a Research
  request, nothing is updated or deleted, and no other Owner is granted either.
- The catalog freezes nothing and reads no market data. A backtest run reads a statement by value, opens a Research goal
  of its own, authors the Design under that goal's identities and freezes it there, so the one-freeze-per-request rule
  above is never met by a second statement and every edge points down the layers.
- `strategies::postgres_tests::the_strategy_catalog_holds_a_statement_through_every_operation_over_http` drives every
  operation and every refusal over HTTP on the ordered chain's PostgreSQL, with no market data and no Research request.

**CURRENT - strategy-authoring MCP server:** the `strategy-authoring` server of the
[domain MCP catalog](../architecture/product-edge#target---external-agent-tool-surface) is `strategy-authoring-mcp`, a stateless
stdio process built from `rd-owner-api`'s package. It holds `RD_OWNER_API_URL` and `RD_OWNER_API_TOKEN` in its own
environment and reaches `/v1/strategies` only. Each tool sends one request and passes the answer or the refusal through
by name; no argument or result carries the token. A result's text is the API's body exactly as sent, so a returned
spec keeps the stored key order its identity hashes.

| Tool                            | Route                                         | Refusals by name                                                                                                |
| ------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `validate(spec)`                | `POST /v1/strategies/validate`                | every `SINGLE_THRESHOLD_*` authoring refusal                                                                    |
| `create(spec)`                  | `POST /v1/strategies`                         | every `SINGLE_THRESHOLD_*` authoring refusal                                                                    |
| `get(strategy_id)`              | `GET /v1/strategies/{strategy_id}`            | `STRATEGY_UNKNOWN`                                                                                              |
| `list(include_archived, limit)` | `GET /v1/strategies`                          | `STRATEGY_LIST_LIMIT_OUT_OF_RANGE`                                                                              |
| `revise(strategy_id, spec)`     | `POST /v1/strategies/{strategy_id}/revisions` | `STRATEGY_UNKNOWN`, `STRATEGY_ARCHIVED`, `STRATEGY_REVISION_UNCHANGED`, `STRATEGY_EXISTS_UNDER_ANOTHER_LINEAGE` |
| `archive(strategy_id)`          | `POST /v1/strategies/{strategy_id}/archive`   | `STRATEGY_UNKNOWN`                                                                                              |

A `strategy_id` in any spelling but `sha256:` and 64 lower-case hex digits is answered `STRATEGY_UNKNOWN` without a
request, because it becomes part of a route's path. A malformed call is `MALFORMED_TYPED_REQUEST`, an unknown tool
`TOOL_UNKNOWN`, and a route that cannot be reached `RD_OWNER_API_UNREACHABLE`.

Acceptance on a local deployment, with only this server mounted and no market data:

1. `validate` a single-threshold statement with a stop-loss and a holding limit: `VALID` and a `strategy_id`.
2. `get` that id: `STRATEGY_UNKNOWN`, because validate wrote nothing.
3. `create` the same statement: the same `strategy_id`; `create` it again: the same answer.
4. `get` it: the `spec` returned hashes to the `strategy_id` (SHA-256 over
   `strategy.catalog.single-threshold-statement.v1\0` followed by the spec's bytes).
5. `revise` it with `max_holding_bars` changed: a new id naming the first as `predecessor_id`.
6. `revise` the first into its own statement: `STRATEGY_REVISION_UNCHANGED`; revise the second into the first's
   statement: `STRATEGY_EXISTS_UNDER_ANOTHER_LINEAGE`.
7. `list`: both; `archive` the first, `list` again: only the second; `list(include_archived=true)`: both.
8. `revise` the archived one: `STRATEGY_ARCHIVED`; `get` it: still readable, with `archived_at_epoch_ms`.
9. `validate` with `max_holding_bars: 0`: `SINGLE_THRESHOLD_MAX_HOLDING_BARS_ZERO`; with `stop_loss_fraction: "0.020"`:
   `SINGLE_THRESHOLD_EXIT_FRACTION_INVALID`.

**IMPLEMENTATION_ADMITTED - authoring language V1:** a document a proposer writes, compiled by a pure
function into the `design` and `meaning` pair and nothing further. Nothing implements it at this cut, and
its implementation follows the first COMPOSER_V3 Replay through the ordered chain. The proposer is a
language model or the Composer; the user does not write documents, so there is no text syntax to parse,
and a rendering of a document exists for reading only.

- *Form.* One JSON document, `research.strategy-authoring.v1`, closed at every level with
  `deny_unknown_fields` and tagged enums, the same promise this Owner makes a proposer for `meaning`. It has
  `inputs`, a flat list of named `definitions`, named `states`, an ordered list of `rules` and an `otherwise`
  action. A definition references others by name only, so the list is the DAG and a name is the node id.
  The universe form and its member count are not written in the document: they come from the Research
  Intent's instrument scope as compile context, and a document whose `scope.form` disagrees is refused.
- *Constructs.* Each construct maps to a catalog operation or expands into catalog operations, and none
  adds one: arithmetic, `ratio`, `scale_by`, `weighted` (fused rational with a declared unit), `sqrt`;
  `mean`, `sum`, `min`, `max`, `ema`, `wilder`, `rsi`; the bar family `true_range`, `atr`, `body`, `range`,
  `upper_wick`, `lower_wick`, `gap`; `ago`, `swing_high`, `swing_low`; the expansions `variance`, `stddev`,
  `zscore`, `crosses_above`, `crosses_below`; `compare`, `all_of`, `any_of`, `not`, `if` and `banded`;
  and the states `latch`, `count_while` and `capture`. `if` is not lazy: both branches are evaluated, as
  every node is.
- *Members (TARGET, with the Strategy shape envelope's I2).* A document is written once over the member set
  the Research scope names. An expression over a role is broadcast: the compiler unrolls it into one node per
  member, each reading its input at that member's `member_ordinal`. `across_members` reduces one broadcast
  expression over every member with `rank`, `mean`, `min`, `max` or `nth`, which lower to the cross-member
  primitives I2 appends to the catalog: `rank` is the average rank, so tied members share one, and `nth` returns
  the n-th order statistic's value. The unrolled graph is measured against `graph_bounds` like any other, and
  the member bound is fixed only after I1.5 measures how N-fold unrolling presses on `max_edges`. A compiled
  program is valid only for its own member count, so a changed member set is a new Research and a new compile.
  Until I2 lands, a document whose scope names more than one member, or that uses `across_members`, is refused
  at its path as `MEMBER_DIMENSION_NOT_YET_ADMITTED`: before I2 a program reads a universe role only at
  `member_ordinal` 0 and no terminal emits target-set bytes, so a document compiles today only over one member.
  Nothing constructs that refusal until the authoring compiler exists; its unit tests drive it from then on.
- *States and rules.* A state's name read in an expression is its value at the previous tick, so feedback
  runs only through state and a cycle between definitions is refused. While the program is warming, every
  state keeps its prior value, because the host holds only the warming frame neutral and a state that moved
  would record an entry that was never proposed. A rule's name is the boolean "this rule was selected this
  tick": its condition, its `require` and the negation of every higher-priority rule's condition. A latch
  over those names is the position the program intended, which diverges from the account's position
  wherever execution refuses or does not fill, because no account input is admitted.
- *Actions.* A rule's action names a position change, a target and a protection, and every port it leaves
  out is neutral. `ENTER` and `ADD` carry a required `side`, `LONG` or `SHORT`: the lifecycle kernel accepts
  target weights in `[-1_000_000, 1_000_000]`, so a short position is a negative weight, and a magnitude such
  as `banded` stays positive. Nothing on the Bounded Feature Program path proposes a negative weight at this
  cut: all ten weight constants in the hand-written corpus are positive, and the only negative weight literal
  under `crates/` is a codec round trip in `crates/strategy_factory/programs/sdk/src/lib.rs`.
- *Compilation.* The compiler decides encoding only. It calls the Owner's own functions for units and
  scales, state bytes and role and coordinate-port identity rather than holding a second copy. Three of them
  exist: `expected_state_bytes`; `coordinate_port_id` in `strategy_plan_v2.rs`, the one spelling of a
  coordinate port id, which the validator and the Plan compiler call. The lowerer keeps its own copy because its
  source is frozen - the V3 build capsule binds its digest, so removing the copy would re-identify every build -
  and a test holds that copy to this one; and
  `measure_bounded_feature_program_shape_v1`, which validates a program as
  `prepare_bounded_feature_program_v1` does with its graph bounds lifted and returns the shape they are checked
  against. The unit and scale derivation is still private to the validator and is exposed with the compiler
  that calls it. `graph_bounds` are the measured shape, with a lag or window of 0 declared as 1, and they are
  exactly where the program is refused: one below any of them fails `prepare`. The Design's state size is its
  plugin manifest's rather than a graph bound, and the program's cells may not exceed it; the source and Wasm
  byte bounds are ceilings fixed by the language version. A declared input the program never reads is compiled
  into `carried_input_role_ids`. The compiler then derives and prepares its own output against the newest
  published catalog and emits nothing `prepare` refuses. Its own refusals are named at a document path:
  unknown name, definition cycle, unused definition, unit mismatch, literal not representable at its scale,
  fraction out of range, bands not ascending, a literal zero denominator, a weight out of range, a lowest-priority
  rule whose action equals `otherwise`, duplicate rules, a rule shadowed by an earlier literal-true rule, and
  a scope that disagrees with the Intent.
- *Guest stack.* The lowered guest's stack follows the program's declared state: five bytes of stack per byte of
  state plus 16 KiB, rounded up to a whole 64 KiB page, and never below the 64 KiB every program was built with
  before (`guest_stack_bytes_v1`). The stack shares the program's linear memory with its state and its heap, so a
  program whose stack would exceed half of it is refused when it is lowered, as `PROGRAM_STATE_TOO_LARGE_FOR_STACK`,
  rather than built into a guest that traps when it runs. The build sandbox writes and the V3 build verifier checks
  the same config, the verifier deriving the stack from the capsule's declared state bound; a hand-written build
  keeps 64 KiB. This changed the lowerer's source once, on purpose, and its digest enters every V3 build identity, so
  every V3 build is re-identified once.
  The rule is measured, as the least stack each program runs at to 16 bytes, a smaller one trapping with
  `MemoryOutOfBounds`. Research T0 at four window sizes lies on one line, 3.44 bytes per byte of state plus about
  9.9 KB:

  | Program               |   State bytes | Least stack |
  | --------------------- | ------------: | ----------: |
  | T0, windows x0.1      |         5 764 |      29 792 |
  | T0, windows x0.4      |        19 372 |      76 640 |
  | T0                    |        46 588 |     170 336 |
  | T0, windows x1.4      |        64 732 |     232 800 |
  | `d1`                  |         5 356 |      25 280 |
  | `t3` and its variants |         3 405 |      20 176 |
  | every primitive alone | at most 1 376 |      12 256 |
  | fair value gaps       |   under 1 800 |       9 712 |

  Every other program sits at or under that line, so five bytes per byte and 16 KiB are 45% and 65% over it. The
  largest state in the hand-written corpus is 9.8 KB, so every one of those programs lowers to the same config bytes
  as before (`every_hand_written_program_keeps_its_stack`). `d1` runs at the rule's stack before the page rounding
  and traps under its measured need (`a_program_runs_at_its_stack_rule_without_the_page_rounding`), so the rule holds
  without the slack a page adds; 49 152 bytes is the largest state a page holds with none.
- *Catalog.* `meaning` names primitives by full semantic id and carries no catalog version; `declare` binds
  the newest one and a redeclaration keeps the frozen one. A compiled document therefore does not change when
  a catalog version is published, which holds only while every published version contains every earlier
  row unchanged. That is an invariant of the catalog, checked for each version against its predecessor by
  semantic digest.
- *Acceptance.* The sixteen hand-written programs, over twelve Designs, in
  `crates/strategy_factory/test_data/bounded_feature_program_meaning_v1/` are rewritten as documents and
  each compiles to a program whose canonical form equals the hand-written one's. The canonical form replaces
  every node, constant and state identity with a structural digest over inputs in port order, keeps decision
  priorities only by relative order, and drops the bounds; every compiled bound is at most the hand-written
  one. Both sides of that projection are proven by running the Wasm of both programs over one sequence long
  enough to leave warmup and to produce a non-neutral entry and exit: changing a window, a constant, the
  priority order of branches that hold on the same bar or the order of `sub`'s operands must change
  behaviour and canonical form, and renaming identities, scaling priorities or enlarging bounds must change
  neither. A short program is added to the corpus and run through to a report. Every single-threshold request compiles, through a total translation
  into a document, to exactly the bytes `author_single_threshold_program_v1` produces, in the exact and the
  universe-member forms.

**CURRENT - authoring language V1, slice 1:** the constructs research T0 needs, compiled by
`strategy_authoring_v1::author_strategy_document_v1` into the `design` and `meaning` pair, which the compiler
derives and prepares itself before it returns them. T0 is a daily trend rule over one perpetual: enter when the
close leaves the prior 50 closes' range; while held, flip when it leaves that range the other way; exit when it
crosses the prior 20 closes' range, when the bar touches a stop captured at two ATR(20) from the opening close, or
at the close of the 250th bar the position is held, counting the bar it fills on; long and short mirrored. Every
construct below maps to catalog operations, and none adds one.

- *Inputs.* `OPEN`, `HIGH`, `LOW` and `CLOSE` of the one member of the Research scope's universe, each declared at
  most once under a name of the author's choosing. A document must read `CLOSE`, which prices its orders; an input it
  never reads is carried.
- *Definitions.* `ago(of, bars)`, `max(of, window)`, `min(of, window)`, `atr(period)` over the four inputs (Wilder,
  first sample the true range), `add`, `sub`, `mul`, `compare(a, predicate, b)`, `all_of`, `any_of` and `not`. An
  operand is a name or a decimal literal; a literal takes the unit and scale of the other operand of its operation and
  is refused when that scale cannot hold it exactly.
- *States.* `latch(set, reset)` is true from the tick its `set` holds until the tick its `reset` holds, `reset`
  winning a tick where both hold; `count_while(condition)` counts the consecutive ticks its condition holds and is 0
  otherwise; `capture(value, when)` is the number `value` was at the last tick `when` held, 0 before it first holds.
  A state's name read anywhere is its value at the previous tick. A state whose writer reads a warming value keeps
  its prior value, which is how every state holds while the program warms.
- *Rules.* An ordered list, the first that holds deciding the tick. A rule's action is `ENTER` with a `side`, `LONG` or
  `SHORT`, and a position target in units, which opens from flat and keeps protection; `FLIP` with a side and units,
  which reverses a held position through zero under `kernel.position.flip.v1` and clears protection; or `EXIT`,
  which clears it. `otherwise` is `HOLD`. A rule's name read in a state is "this rule was selected this tick": its
  condition and no earlier rule's. Nothing on this path reads the account, so a latch over rule names is the position
  the program intended; the document itself must gate an entry on its own flat state, and a flip and an exit on its
  held state, because the kernel refuses every other transition.
- *Protection.* Slice 1 places no protective order. Replay judges no order inside a bar, so a stop is a rule: T0
  captures its level when it opens, compares the bar's low (long) or high (short) against it, and exits at the close,
  filled the next frame. An `ENTER` that names a `stop_loss` is refused as `PROTECTION_NOT_SUPPORTED_IN_SLICE_1`.
- *Refusals*, each at its document path: `AUTHORING_LANGUAGE_UNKNOWN`, `NAME_UNKNOWN`, `NAME_DUPLICATED`,
  `DEFINITION_CYCLE`, `DEFINITION_UNUSED`, `UNIT_MISMATCH`, `LITERAL_NOT_REPRESENTABLE`, `WINDOW_OUT_OF_RANGE`,
  `NOT_BOOLEAN`, `INPUT_FIELD_REPEATED`, `CLOSE_INPUT_REQUIRED`, `RULES_REQUIRED`,
  `PROTECTION_NOT_SUPPORTED_IN_SLICE_1`, and any refusal the compiler's own `prepare` returns.
- *Catalog.* The strategy catalog holds a document beside the single-threshold statement. A document is named by the
  SHA-256 of its canonical bytes under a domain of its own, and the single-threshold identities are unchanged.
- *Acceptance.* T0's document compiles and the compiled program prepares, and its Wasm runs across frames in the
  toolchain proofs (`the_authored_t0_document_runs_as_wasm_across_frames`): warm at bar 51; long at 61, its stop
  captured at 105.10; a low of 106 holds and a low of 105 leaves at 66; short from flat at 71; flipped to long at
  76, ahead of the short's stop and channel exit on the same bar; out by the holding limit at 326, counted from the
  flip, and not at 325. It behaves the same at its guest stack rule before page rounding, 249 328 bytes against a
  measured need of 170 336. The sixteen hand-written programs and the total single-threshold translation above
  remain the next slices' acceptance.

**TARGET / NOT_ADMITTED - authored source custody and report statement:** a document is stored with the
freeze it compiled to, in the same transaction, keyed by the joint freeze digest, and `declare` accepts it
beside the `meaning` it compiled to. This Owner recompiles it and refuses a document whose design or
`meaning` differs from the declared pair. A report then states a run from its document only after both
anchors hold: the document recompiled under its recorded language version reproduces the frozen design and
program bytes, and `anchor_frozen_program_to_run` ties the program to the run exactly as it does today. A
document that no longer reproduces its freeze is an integrity failure and never falls back to another
statement. The report reads the document in the freeze's snapshot, without a lock, and compiles after the
transaction ends. The table is read by the report, so its materialization carries the same pre-cutover
proof as the others. It stays `TARGET` because the report's data window is a single instrument at a single
granularity, which a program with several inputs cannot state, and no contract yet defines that window.

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

Which answer a refusal gets is decided by what it negates. A refusal that negates the request itself - its type,
its identity, the operation it belongs to - cannot be changed by any retry, so it is refused under its own name and
never answered as `SUBMITTED_OR_UNKNOWN`: the Source Intake route answers a request identity whose stored semantics
conflict with the request as `CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY`. A refusal that negates the current state of the environment, of an authority, or of the
build's capability may be changed by a retry or a new deployment, so it answers `SUBMITTED_OR_UNKNOWN` with the
resolve-same-request action (`RESOLVE_SAME_REQUEST_IDENTITY` here, `RESOLVE_SAME_REQUEST` on the Source Intake
route), even when the Owner knows it wrote nothing, and its cause is recorded through `refused_by_store` under a
named coordinate, which is where an operator looks: `submit_v2` answers so when the current replay policy catalog V3
head is absent, and records `research_goal_owner.submit_v2.replay_policy_catalog_v3.resolve_current`. The Owner does
not judge how long an environment state will last - a head published a minute later lets the same request succeed -
so an unavailable authority gets no answer of its own.

A successor Research Intent commits no Independence Basis of its own; it is bound to the one its TrialFamily was
admitted under. It still freezes the protected-feedback projection that is current when it is created, the same way:
Qualification resolves the projection for that basis first, in its own transaction, and the creating transaction
admits it again, freezes only an equal one, and admits it once more before committing. A successor therefore never
carries its predecessor's projection forward, and after a protected evaluation becomes observable the next successor
freezes the frontier that includes it. The successor's admitted principal and scope must be the basis's own, or the
request is refused as an invalid proposal, so one operator cannot freeze another's family feedback. An existing
successor replays under the projection it stored and resolves nothing. Its Artifact build binds that projection only
while Qualification still reads it as admitted under the family's basis. The other refusals write nothing, answer the
Owner unavailable, and are recorded under `research_goal_owner.compose_successor_v1.protected_feedback`: `resolve`,
`absent`, `mismatch`, `refresh_mismatch` and `foreign_basis`.

R&D's clock is `pg_catalog.clock_timestamp()`, read inside the R&D transaction that uses it. A Research Intent's
projection time, `valid_through` and commit time are stamped from it, and so is the `owner_cut` its lock returns;
a successor Research Intent follows the same rule. Every other R&D cut compared with a research view, in Artifact
builds, the bounded feature program and the Composer's source research, is read the same way, and Product Edge
compares cuts it takes from the same clock with those values, so no research window compares two clocks.
Qualification takes its Owner cut the same way.

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

**TARGET - matched-entry control and clustered interval in Diagnosis.** Diagnosis reads the exploratory Result's
matched-entry control and its date-clustered interval (Backtest, "TARGET - Exploratory matched-entry control and
clustered interval") and shows the run's edge over random entries of the same shape with that interval, labelled as a
control. It is a control, not a selection criterion: the Iteration Decision does not select, order, or stop candidates
by it, and it never stands in for Qualification's holdout or same-universe random control.

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

### TARGET - Cumulative trial accounting and the spend cap

The user decided on 2026-09-27 that Research runs until it develops a strategy instead of stopping at a trial count.
In the user's words (translated): "R&D has to keep running until it develops a strategy; otherwise it keeps being
interrupted for budget reasons and cannot develop an effective strategy, which is a bad experience." The option the
user chose (translated): "R&D does not stop on the number of trials; every trial is recorded and accumulates across
rounds, so the more is tried, the heavier the discount at qualification review; the random-strategy control and the
held-out data stay as they are; only one spend cap you can set remains (API and compute)." Under that authorization
this removes a stated bound, the sealed trial budget, and relocates what it protected: multiple-testing control
moves from stopping the search to raising the qualification bar
([Qualification](./qualification/#target---cumulative-trial-deflation-at-candidate-intake)), and protection against
uneconomic endless search moves to the spend cap below. The removal lands last, after the accounting, the deflation,
and the spend cap exist, so no cut holds neither the old bound nor its replacement.

**Today**, measured at `main` 019f231b0. The sealed budget is `TrialFamilyPolicyV1.trial_budget`, which Product Edge
admits in 1 to 10,000 (`TRIAL_BUDGET_INVALID`) and the Dashboard research form in 1 to 64. It is inside the policy
digest and therefore the TrialFamily identity. Three rules enforce it: Iteration Result Admission refuses a proposal
set larger than the remaining budget (`ITERATION_RESULT_ADMISSION_TRIAL_BUDGET_EXCEEDED`); the decision policy
issues `TRIAL_BUDGET_EXHAUSTED` when the consumed count equals the budget; and that exhaustion preempts candidate
comparison and `READY_FOR_SELECTION`, so the last budgeted trial can never become a Candidate. One consumed unit is
one census attempt, an Intent, Request, and Result triple of any terminal disposition, counted per TrialFamily. A
successor Intent stays in its family, a new Research goal forms a new family whose count starts again, and nothing
sums counts across families. R&D counts every Result the native Replay run route commits ("CURRENT - every
committed exploratory Result is counted", below). The 1 the formation writes reserves the family's first attempt, so
counting that attempt's Result leaves the count at 1, and a family's count first reaches 2 at the Result of its first
successor.

**A trial** is one census attempt, exactly as counted today: every exploratory Intent, Request, and Result triple the
TrialFamily Census admits, whatever its disposition. Losing, rejected, invalid, and unknown attempts count, because
each is a look at the data; an exact request replay joins its receipt and is not a second trial. The V2 census calls
the count `trial_count` where it now says `consumed_trial_budget`; V1 readbacks keep the old name.

**The lineage it accumulates across.** A Candidate's cumulative trial count is the sum of `trial_count` at the census
frontier it binds for its own TrialFamily and for every TrialFamily in its cross-family predecessor frontier,
transitively:

- successor iterations stay in their family, so they are counted;
- a replan after Qualification feedback is a successor with cross-family ancestry, so it is counted;
- declared independence changes neither, just as it cannot grant a fresh holdout budget;
- a predecessor family that is still accruing is counted at the cut the Candidate binds, and a later append is
  counted by the next Candidate that binds a later cut.

No caller supplies the count: Qualification derives it from the bound frontiers. A Research goal with no semantic
predecessor starts a new lineage. The count is bounded by the lineage rather than by every trial a principal has run,
because what it protects against does not rest on it alone: using a new goal to erase a predecessor is already
prohibited below, and the same-universe random control compares a Candidate against programs drawn to a definition
the searcher did not write, so it holds even when the count is understated.

**What changes when the removal lands.** A TrialFamily Policy V2 has no trial budget and its own digest domain, so
every V1 family keeps its identity and its frozen decision policy. A V1 family that exhausts its sealed budget still
stops as it committed to, and its lineage continues through a successor family formed under V2, with every V1 trial
counted. For V2 families:

- Iteration Result Admission drops the remaining-budget refusal;
- the decision policy version no longer lists `TRIAL_BUDGET_EXHAUSTED` or its preemption of comparison and readiness;
- the information-value comparison weighs the cumulative trial-count effect where it weighed the remaining
  family-budget effect;
- the remaining stops (falsifier, frozen stop rule, input unavailable, economic impossibility, low information
  value) end a lineage, not Research, and "exhausted budgets" leaves the failures that prevent candidate submission;
- the Dashboard's trial-budget field and budget columns give way to the cumulative trial count once
  `docs/guide/dashboard.md` is changed for it.

**The spend cap.** One user-set cap bounds what Research spends, and reaching it pauses Research rather than stopping
it.

- *What is metered.* Paid market data, by the cost its provider quotes before the request: Databento's `get_cost` preflight,
  which today has its own cap `DATABENTO_MAX_PROBE_COST_USD`, is folded into this one. Compute, the seconds of
  Backtest replay and Develop builds, at a user-set rate that defaults to zero on the single local host the user
  admitted, so compute counts only if the user prices it. Language-model calls are not metered: since the user's
  decision of 2026-10-03 the agent works outside the product ("Agent-outside R&D experience" in the product loop), the
  product makes no model call, and what the agent spends is the agent's own. This replaces the metering of
  language-model provider calls that this item stated before.
- *Who meters.* R&D keeps an append-only Spend Ledger. Before a metered effect it reserves the effect's upper bound,
  in the transaction that claims the effect: the preflight quote, or the declared time limit at the compute rate. After the effect it settles the actual amount against that reservation.
  An effect whose outcome is unknown stays reserved at its bound until it resolves. Reservations serialize on the
  ledger head, so two concurrent ones cannot together pass the cap.
- *When the cap is reached.* A reservation that would take settled plus reserved spend past the cap is refused, and
  the Research workflow enters `PAUSED_SPEND_CAP_REACHED`, which carries the cap, the settled and reserved amounts,
  and the refused effect. It is not an Iteration Decision or a stop: no identity closes and nothing is lost, and the
  same step reserves again once the cap allows it. An effect already reserved completes and settles.
- *How the user sets it.* The cap is one amount in US dollars per UTC calendar month, resetting on the first of each
  month, which the user confirmed on 2026-09-28. It is held with its price table as an authorized Product Edge
  configuration fact that R&D reads at each reservation; a change is a new fact, never an edit. Until the Dashboard admits a control for it, the R&D Owner API reads the cap from its environment, as it
  reads the Databento cap today.

The slices and their order are in
[Strategy Factory](../architecture/strategy-factory#target---research-runs-until-a-strategy-bounded-by-spend).

### CURRENT - every committed exploratory Result is counted

The native Replay run route (`POST /v2/exploratory-replays`, carried by the `native-replay-execution` feature)
counts the Result the Backtest Owner committed before it answers. It counts in R&D's own transaction, after the
Backtest commit, because it cannot count in or before that commit:

- the Backtest commit runs in a `backtest_owner` session, which reaches R&D only through the locked request read
  `rd_owner_api` grants it;
- the census append is R&D's own canonical encoding, which a SQL function would have to restate;
- a successor's commit relock requires the census head the successor was frozen against, so an append before the
  commit would make the commit refuse itself.

**What is counted.** The count locks the Result through the Backtest custody adapter, as Iteration Result Admission
does. It reads the family and Intent from the sealed request's canonical bytes, recomputing their meaning digest
against the one the Result binds. It then locks the family's census head and appends one attempt: the Intent, the
request and the Result, with the Result's terminal counted one for one (`TERMINAL_RESULT`, `RUN_REJECTED` as
`REJECTED`, `INVALID_REPLAY_EVIDENCE` as `INVALID`). The attempt's consumed count is its ordinal plus one. Its
candidate set is the expansion of the empty grid ("CURRENT - candidate counts are computed from their grid", below),
because no Decision has read the Result yet. A Result whose request identity and meaning digest the census already counts is an exact
replay: it joins that attempt and writes nothing, whatever attempt identity Backtest gave it.

**What the count is.** The 1 the formation writes reserves the family's first attempt, so counting its Result leaves
the count at 1. What changes is that the family's head moves to the V2 census and its attempt frontier binds this
request and Result. A new Replay of the formation Intent is then refused, and the count first reaches 2 at a
successor's Result.

**No Result is shown before it is counted.** Between the Backtest commit and the count the Result exists uncounted.
If the count fails, the route answers the count's refusal rather than the Result, and running the same request and
attempt again recovers the committed Result and counts it. Every R&D read that shows a Result or what it produced
refuses one its census does not count, as `EXPLORATORY_RESULT_NOT_COUNTED`:

- the write API's Result and run-evidence reads and the read API's Result read, with 409;
- the run report, whose refusal carries the same code;
- Iteration Result Admission, as `ITERATION_RESULT_ADMISSION_RESULT_NOT_COUNTED`.

The check takes no row lock, so the read API's `READ ONLY` transactions make it. The diagnosis gate, iteration
analysis and every Decision already require the census's latest attempt to be this exact Result. The Result
directory lists identities, terminals and commit times and no outcome, and it is unchanged. A Result whose request no
R&D request seals belongs to no family and is refused as `EXPLORATORY_RESULT_REQUEST_UNAVAILABLE`.

**What no test drives.** No ordered-chain entry runs a native Replay, so no test reaches the run route's count; the
first entry that executes one asserts it. No entry drives Iteration Result Admission's first admission either. The
count, the join and every refusal above are proven by the run report entry,
`backtest_run_report_reads_back_every_point_a_real_run_committed`, on a Result committed through the chain's own
Backtest writer. A native run commits only `TERMINAL_RESULT`: a run that fails before its commit leaves no Result and
nothing to count.

### CURRENT - candidate counts are computed from their grid

A candidate set is stated as the grid that generates it, `CandidateGenerationGridV1`, and the Owner expands it. Each
listed hypothesis dimension is one `SINGLE_DIMENSION` candidate, and each frozen finite-joint contract is one
`PREREGISTERED_FINITE_JOINT` candidate. Both lists are strictly ascending, so a grid has one representation and lists no
member twice. The rule's identity and digest are computed from the grid, never supplied, and the TrialFamily census
stores the grid in the candidate-set frontier and recomputes both on every readback.

Wherever a candidate set is admitted, in the census and in Iteration Result Admission's proposal set, the registered
count is held to the expansion and the listed candidates to its members, and each disagreement is refused by name:

- `CANDIDATE_GENERATION_GRID_INVALID`: the grid repeats a member or lists one out of order;
- `CANDIDATE_GENERATION_CARDINALITY_MISMATCH`: the registered `expected_cardinality` is not the expansion's size;
- `CANDIDATE_SET_DIFFERS_FROM_GENERATION_RULE`: the listed experiments are not the expansion.

A proposal's `candidate_digest` is computed from its identity and experiment as well, and Iteration Result Admission
refuses a stated one that differs as `ITERATION_RESULT_ADMISSION_IDENTITY_MISMATCH`. A grid has no other kind of member:
when the authoring layer generates candidates another way, a parameter sweep for instance, that is a new kind of
member with its own named expansion, never a string the Owner takes as stated.

### TARGET - Production trial ledger and data-read ledger

This section states a contract with no implementation; it grants no permission to build or deploy it.

**Today**, by callers rather than references:

- **Only a committed Result is counted.** "CURRENT - every committed exploratory Result is counted", above, counts
  every Result the native Replay run route commits. A run that fails before its commit leaves nothing to count, and
  the Backtest Owner commits no `RUN_REJECTED` or `INVALID_REPLAY_EVIDENCE` Result for one.

**Every look is a trial.** A trial is one census attempt, exactly as counted above:

- a run of a new request is a trial, and so is a rerun whose meaning differs in any way;
- a failed, rejected, invalid or unknown run is a trial;
- an exact replay of a request joins its receipt and is not a second trial;
- a look at outcomes made for any other purpose is a trial too. An outcome is never computed except through a
  counted request. Diagnosis, Compare and the Dashboard read only Results that already exist, and a question about
  size or sample is answered from counts, not outcomes.

A failed run is counted once the Backtest Owner commits a `RUN_REJECTED` or `INVALID_REPLAY_EVIDENCE` Result for
it, which the count above already maps.

**Where market data is read today**, measured at `main` 8f67d897f by callers:

- Only one R&D read has both an instrument set and a half-open period: the execution-input binding issuance
  (`POST /v2/exploratory-replay/execution-input-bindings`, feature `composer-replay-issuance`). Its
  `resolve_native_replay_initial_owner_inputs_v1` reads the member instruments and the Replay window
  `[start_event_ns, end_event_ns_exclusive)` (`crates/strategy_factory/src/native_replay_initial_owner_inputs_v1.rs:150-176`),
  and the native run and the Market Data repair request read through the same function.
- Every other R&D route that reaches Market Data has scope identities and one decision cut but no period: the initial
  PIT issuance, the PIT snapshot request route, and the Composer and bounded-feature-program routes, which reread one
  PIT batch at one cut. The V3 Research submission checks instrument identities against the eligible frontier, which
  is reference data, not prices.
- No R&D tool lets an agent read market data. The Dashboard MCP server's five tools
  (`product/dashboard/lib/dashboard-mcp-server.ts:134-193`) submit or read R&D and run state and return no market
  value, and the product makes no model call.
- No type classifies an instrument into a stratum. Instrument Master V2 records a perpetual's listing instant from
  Binance `onboardDate` (`crates/data/src/owner/instrument_master_v2.rs:346`), and Market Data serves bar volume as
  `MARKET_DATA.BAR.VOLUME.QUANTITY.V1`.
- No Owner defines a holdout partition of instruments or periods. Qualification's holdout is a budget and a custody
  reservation, not a partition of the data.

**The data-read ledger.** R&D records every read of market data its trials make as append-only rows, one per
instrument, in the R&D transaction that makes the read, and reads every agent read from Market Data:

- a row binds the lineage (the TrialFamily and its cross-family predecessor frontier), the trial (the Replay
  request's identity and meaning digest), the instrument, the half-open period `[start, end)` in
  event nanoseconds, the instrument's stratum for that period with the stratum policy's identity, and the commit time;
- trial rows are written when R&D issues a Replay's execution-input binding, the one point where the members and the
  window are both known; a binding that is joined rather than issued writes nothing again;
- an agent reads market values only through Market Data's MCP server, and Market Data records each such read as its own
  agent data-read row before it answers ([market-data MCP server](./market-data#target-market-data-mcp-server)). These
  rows moved there from this ledger when the agent's tools moved to domain servers; the census reads them downward,
  and until a session is bound to a lineage it counts an agent read against every lineage. No R&D tool returns market
  values to an agent;
- a read whose rows cannot be written fails, so no read happens without its rows.

**Strata.** A stratum is computed before the outcome, never assigned after it. A versioned stratum policy, frozen in
the TrialFamily policy, classifies each instrument from point-in-time facts at the period's start: its listing age
from Instrument Master's listing instant, and its size from the trailing traded value (bar volume times close) Market
Data serves. Version 1 takes the user's research buckets as its defaults: the 17 instruments of largest trailing traded
value are majors, the next 20 are large caps, and an instrument listed less than 365 days before the period's start is
a new listing whatever its size. A different threshold is a new policy version, and every row names the version it
used.

**Untouched slices.** The ledger hands out slices nobody in the lineage has read:

- A validation stage asks it for a slice of one stratum and one period length, drawn from the instruments Market
  Data's eligible frontier names, and gets one or `NO_UNTOUCHED_SLICE`.
- A slice overlaps a read when they share an instrument and their half-open periods intersect. A read by an earlier
  lineage that shares the Candidate's predecessor frontier counts, so an earlier family's contamination is visible
  rather than remembered.
- Once handed out, the slice is reserved to that stage, and a second read of it refuses as `SLICE_ALREADY_READ`.
- The ledger never hands out a slice inside Qualification's sealed holdout partition. No Owner defines that partition
  yet, so until Qualification does, every hand-out refuses as `HOLDOUT_PARTITION_UNDEFINED`, while reads are still
  recorded.

**The census carries no verdict.** A census row records that a trial ran and its exploratory disposition. It never
records a Qualification outcome or any pass or fail bit from an evaluator; Qualification counts its own protected
attempts into N ([Qualification](./qualification/#target---cumulative-trial-deflation-at-candidate-intake)) and
publishes outcomes only through its public phases.

**How it feeds the deflation.** Qualification's cumulative N is the sum of `trial_count` across the census frontiers
a Candidate binds, plus the lineage's protected attempts. The spread of trial ratios comes from the lineage's
`TERMINAL_RESULT` trials. Both are therefore only as complete as this append. The Deflated Sharpe Ratio and its CSCV
estimate of PBO are ported from `crates/strategy_factory/src/robustness.rs` at `main` f2238c09b, as Qualification
states, with N the cumulative count in place of the formation path's fixed four or two.

### TARGET - Research knowledge ledger

This section states a contract with no implementation; it grants no permission to build or deploy it.

**Why it exists.** A Research lineage today remembers its own census, Decisions and findings, and nothing carries
what one lineage learned to the next. The user's manual research run (archived at
`refs/archive/research/ronnie-2026-10-02`, `research/ronnie/`) kept that memory by hand: one status table of
mechanism families (`STRATEGIES.md:166-216`), a cross-loop factor ledger (`loop/ledger.txt`), and notes that a later
loop read before it chose a change. Its retrospective names the gap this closes: knowledge "lost partly across
context compactions" (`loop/RETROSPECTIVE.md:131`). Its requirements add that a family opens only after a literature
screen (`RD_AUTONOMY.md:83`). The ledger is R&D's durable form of that memory, and it binds the next Research Intent.

**What it records.** The ledger is append-only and holds three kinds of entry. None is edited or deleted; a later
entry supersedes an earlier one by naming it.

- *Mechanism status.* One of five statuses for a mechanism within a scope, as the research defines them
  (`loop/CRITERIA.md:56-83`):
  - `ACTIVE`: positive at its first development stage or above;
  - `PARKED`: inconclusive, with the data the next look needs (instruments, periods or trades) and a revisit trigger;
  - `ABSORBED`: carried by another mechanism, which the entry names;
  - `IMMATERIAL`: as a filter it touches under the frozen share of trades, so no result could change a decision;
  - `CLOSED`: equivalence below the smallest effect of interest on data not used to select it, or a falsified
    mechanism with its registered variants exhausted.
- *Construct effect.* The measured effect of one construct, a reusable rule component such as a box-breakout
  retest, a funding carry condition or a Fibonacci ratio set, on one stratum and period: the effect estimate and its
  interval against the registered control, its rank correlation with the outcome and that correlation's sign, and
  whether the same pattern appears in the control's own outcomes (`REGIME`, not skill).
- *Finding.* A stated conclusion with its conditions and scope, such as "the ratios carry nothing beyond nearby
  non-Fibonacci ratios". A later finding may narrow, extend or retract it only by superseding it.

**Keys.** Every entry keys on identities R&D already owns or computes, never on a name a caller types:

- a mechanism is the frozen mechanism identity of the Research Intents that test it;
- a construct is a versioned construct definition, content-addressed over what it measures and how it counts, so
  "touches of a swing level" and "touches of a range edge" are two constructs, because the research found the same
  word with opposite signs (`loop/WORKFLOW_NOTES.md:203-205`);
- a scope is a set of strata and periods under one stratum policy, the policy the data-read ledger above freezes in
  the TrialFamily policy. A stratum the entry did not test is untested, never closed (`loop/CRITERIA.md:104-106`).

**Evidence.** Every entry binds the evidence it rests on, and the Owner derives every value from that evidence:

- R&D evidence is a TrialFamily census attempt and the Result it counts. A Result the census does not count is
  refused as `EXPLORATORY_RESULT_NOT_COUNTED`, as every other R&D read refuses it.
- An effect, its interval and its correlation are computed by a versioned R&D estimator from the Results the entry
  binds, never stated by the caller: the same rule as candidate counts ("CURRENT - candidate counts are computed from
  their grid"). No R&D estimator exists today; until one does, effect fields are `NOT_COMPUTED`, and a status that
  needs an interval cannot be written.
- Outside evidence is a Research Source Provenance Record from Source Intake, with its claimed result and evidence
  quality. The research archive enters this way, as one source per file and line range.
- A status change names new evidence: evidence its predecessor did not bind. A supersession that cites none is
  refused as `KNOWLEDGE_SUPERSESSION_WITHOUT_NEW_EVIDENCE`.

**How it binds the next Research Intent.** A Research Intent declares the mechanism it tests and the constructs its
rule uses. R&D checks them against the ledger at the two points an Intent freezes: in the S1 admission transaction
("Lineage and protected-feedback admission") and when a successor Intent is composed. A grid member that varies a
construct names it, so a successor experiment is checked the same way. Each refusal negates the request at a ledger
cut R&D owns, so it closes `REJECTED_NO_WRITE` under its own name and stores the check record with the ledger head it
read, as `INSTRUMENT_SCOPE_NOT_RESOLVABLE` stores its check:

- `KNOWLEDGE_MECHANISM_CLOSED`: the mechanism is `CLOSED` in the requested scope and the Intent states no new
  mechanism. A new mechanism is a different mechanism identity, with the observable prediction that tells it apart
  from the closed one (the diagnosis contract above).
- `KNOWLEDGE_PARKED_GAP_UNADDRESSED`: the mechanism is `PARKED` in the requested scope and the Intent does not name
  which of the entry's missing data it supplies.
- `KNOWLEDGE_CONSTRUCT_CLOSED`: a declared construct is `CLOSED` as a filter or component in the requested scope.
- `KNOWLEDGE_DECLARATION_MISSING`: the Intent declares no mechanism identity or no construct list.

A scope the ledger has not tested passes, and the Intent records that it opens an untested stratum. A closure that
rests only on outside evidence is lifted by a replication inside the product, which is new evidence, and only by one
that could have found what the closure denies: its Intent registers the smallest effect of interest before it runs,
its attempts are counted in the census like any other, and its detectable edge is no larger than the one the closure
rested on. A replication with less power leaves the closure in place. A closure resting on R&D evidence is lifted only
by a new mechanism.

Today none of these is reached: no Intent declares a mechanism identity or constructs, and the ledger has no entries.
Each becomes reachable when the declaration lands, and the first entries the archive provides make the first three
constructible.

**What the ledger never holds.** Qualification's protected evidence never enters it. R&D already never reads
protected payload or detail, so the ledger's only inputs are R&D's own census, Results and data-read slices, Source
Intake records, and Qualification's public phase facts. Each field is held to that:

- *Effect, interval, correlation and decay* come only from counted exploratory Results. Decay is compared between
  periods of R&D's own data, never between an iteration period and a Qualification read, which is the comparison the
  research's attribution tool made against its validation tier (`loop/WORKFLOW_NOTES.md:106`).
- *Scope and strata* name only slices R&D read. A slice inside Qualification's sealed holdout partition cannot be
  named, because the data-read ledger never hands one out.
- *Data needed and revisit trigger* are computed from R&D's own detectable edge and counts, never from a protected
  sample size or power.
- *Qualification outcomes* enter only as the public phase fact itself (`QUALIFIED`, `CLOSED_NOT_QUALIFIED`, or a
  forward phase), by its type-opaque reference. A public phase never changes a status by itself: every negative
  protected terminal projects as the same `CLOSED_NOT_QUALIFIED`, so it cannot show equivalence, and an entry that
  follows it must cite R&D evidence too. No entry records when a protected evaluation happened beyond that fact.
- *Text.* A finding's statement is untrusted rationale text, bound by digest. It is written from R&D-readable
  evidence, because nothing protected reaches the writer.

**What it is not.** The ledger adds no second authority:

- trial counts stay in the TrialFamily census, and the ledger only cites attempts;
- stops, successors and repairs stay Iteration Decisions. A Decision whose terminal stop is the falsifier is the
  R&D evidence for a `CLOSED` entry by a falsified mechanism, and no entry creates or overturns a Decision;
- strata stay the data-read ledger's stratum policy, and a scope never defines its own buckets;
- candidate counts stay the generation grid's expansion;
- sources stay Source Intake's records, and the pre-family literature screen is Source Intake's step.

**Reads.** The ledger is read through the R&D read API by mechanism, construct or scope. A read returns entries and
their evidence references, which are R&D facts already visible to the reader, and no market value.

**First entries.** The archived research supplies the first entries as outside evidence. They are drafted for review
with their source file and lines in `docs/plans/research-knowledge-ledger-seed.md`; only their development-side figures
are carried, because that run's validation and final tiers played the role Qualification's holdout plays here. A
mechanism that run closed only on such a held-out read is imported as `PARKED`: the ledger cannot hold the figure, so
it holds no evidence that could support `CLOSED`, and the closure has to be established again from R&D evidence.

## Input handoffs

- Product Edge supplies a sourced research request rather than an unsourced instruction to trade. The request commits the bounded protected-feedback frontier already projected to that principal. Research resolves the stable request identity with its own terminal receipt and preserves semantic predecessors without reading protected category or detail; absent receipt remains unknown.
- [Market Data](./market-data/) supplies point-in-time facts, catalog versions, and instrument semantics. For each
  initial PIT Market Snapshot Request it returns one move-only, Market Data-sealed `ResearchPitTerminal` correlated
  to the exact request identity and content digest, carrying the canonical six-state disposition `AVAILABLE`,
  `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, or `UNAVAILABLE` and the exact Universe Selection Record
  identity and digest. The request binds the Intent identity, so it exists only after that Intent is frozen and its
  terminal cannot enter that Intent: only an `AVAILABLE` initial terminal may be named by the Intent's Design role
  intent or consumed by its exploratory Replay, every other state blocks only that Intent's downstream consumption,
  and an absent response remains unknown. For a committed Market Data Repair Request it
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

**TARGET / IMPLEMENTATION_ADMITTED, the requested instrument scope and the initial PIT request:** a Research request
states the instrument scope it studies, and this Owner never chooses it. The user admitted this on 2026-09-24,
choosing, in these words (translated): "Specify it when submitting the research request (recommended): the research
request form gains an 'instrument' field; this research and its backtests are bound to that instrument; to change the
instrument, submit a successor research request. This agrees with the existing documented design: the initial PIT
request binds 'the requested instrument or universe scope'."

- `ProductEdgeResearchGoalRequestV3` is `ProductEdgeResearchGoalRequestV2` plus a required `instrument_scope`, a
  `ResearchInstrumentScopeV1`: one or two distinct canonical Instrument Master identities, such as
  `BTCUSDT-PERP.BINANCE`, in ascending byte order, matching the member counts the universe vertical admits. The
  single-instrument route states one. The Strategy shape envelope widens this to N members as a TARGET, which the
  user authorized on 2026-09-27; until its slice I1 lands, one or two remains the admitted bound. Its canonical bytes are schema `u16LE = 1`, the member count `u8`, and each
  identity length-prefixed (`u16LE`) in order; its identity is SHA-256 over
  `rd.research-instrument-scope.v1\0 || canonical bytes`. On the wire it is the JSON object
  `{"schema_version": 1, "identities": ["BTCUSDT-PERP.BINANCE"]}`; this Owner refuses an unknown schema, an empty,
  duplicated or unordered list, or an identity that is empty, padded, holds a control character or exceeds 1024 UTF-8
  bytes, and it computes the canonical bytes and identity itself, never taking them from a caller. Before accepting,
  this Owner asks Market Data's admitted read surface whether every identity resolves and lies in the eligible
  instrument frontier at Market Data's current decision cut; if one does not, the request closes
  `REJECTED_NO_WRITE` with `INSTRUMENT_SCOPE_NOT_RESOLVABLE` and no Intent is frozen, so a mistyped instrument leaves
  no accepted research that could never be backtested. That check only refuses early: Market Data's decision when the
  initial PIT request is issued remains the guarantee, as in the universe-member binding. Which Market Data read
  function answers it is agreed with Market Data; if none is admitted yet, providing one is part of this slice, never
  a reason to skip the check. The request travels as
  the `sourced-research-goal-v3` operation, submitted with `POST /v3/source-intake-research` when a Source Intake
  terminal supplies its sources, or with `POST /v3/research-goals` when the caller states them, as
  `POST /v2/research-goals` takes a V2 request's, and resolved with `POST /v3/research-goals/{request_identity}/resolve`,
  beside the unchanged V2 routes. `POST /v3/research-goals` requires the scope and `POST /v2/research-goals` refuses
  one, both before anything is admitted, and either route admits under the operation
  `research_goal_admitted_operation` chooses from whether the request states a scope, the same function the Owner
  checks a stored admission against. The scope is part of the
  request's meaning, so the same
  request identity with another scope is a changed meaning and is rejected. The frozen Research Intent (V3) binds the
  scope identity and bytes. Changing the instrument means a successor Research request, with its own Intent and its
  own initial PIT request; nothing rebinds an accepted Intent to another instrument.
- How this Owner holds a V3 request. There is one stored Research request for V2 and V3:
  `ProductEdgeResearchGoalRequestV2` carries `instrument_scope` exactly for a V3 request and omits it, rather than
  writing `null`, for a V2 one, so every stored V2 request, meaning digest and admission payload is unchanged and
  everything derived from a request is derived the same way. A V3 request is admitted under
  `research_goal.submit_or_resolve.v3` and `sourced-research-goal-v3` with the scope in its admission payload, and its
  meaning digest covers the scope. A scope that is not canonical closes the request `REJECTED_NO_WRITE` with
  `INSTRUMENT_SCOPE_INVALID`, checked after every V2 field so no V2 rejection code is displaced. The V3 Intent has
  schema 3 and binds `instrument_scope` as the scope identity and canonical bytes in lowercase hex; it keeps the V2
  Intent and receipt identity scheme, which stays unique because the meaning digest covers the scope. Both resolve
  routes resolve a stored request by its identity, whichever schema admitted it.
- How a scope rejection is proved. A rejected request is proved by replay: validating the stored request again
  reproduces the stored code. `INSTRUMENT_SCOPE_NOT_RESOLVABLE` cannot be reproduced that way, because Market Data
  answers at its own decision cut, so that rejection is proved instead by the check record stored with it: the
  eligible-instrument frontier Market Data held as current, the `MarketDataDecisionCutV1` it answered at, and one row
  per requested identity in request order. Only an answer given against a current frontier rejects: without one,
  Market Data has denied the environment rather than the instruments, so the request stays unresolved, as it does when
  the check cannot be answered at all. Custody accepts a stored rejection only when the stored request is otherwise
  valid, the record answers exactly its scope against a stated frontier that is not all zero, the cut precedes its
  own validity bound, and the record does not admit the scope; a later check never rewrites it. Every other rejection is still proved by replay, and a record beside any other code is
  refused. A source-bound rejection records its Source Intake ancestry as an accepted request does, and is re-verified
  against the admission it was made under.
- A V2 request is still accepted unchanged. It states no scope, so no initial PIT request is issued for it, and the
  Design role intent it can publish names no PIT request; Market Data refuses a universe-member declaration from such
  an intent by name.
- After the Intent is frozen and before any exploratory consumption, this Owner issues the initial PIT request in its
  own step, `POST /v3/research-goals/{request_identity}/initial-pit`, taking only the request identity from its caller;
  it issues for that request's one accepted Intent. It first states the selection rule to Market Data's Universe
  Selection intake: the fixed-member rule, `[0,1,3]` followed by the scope's canonical bytes, with the scope identity as
  its rule identity, which Market Data evaluates against its eligible-instrument frontier at its published decision cut.
  R&D chooses no frontier and no member beyond the ones the user requested: the request carries the current
  eligible-instrument frontier Market Data's read returns, and its identity is derived from the correlation, that
  frontier and the decision cut, so the same references always name the same request. It then freezes the PIT
  submission for the selection Market Data recorded: `requester_identity` is Market Data's requester digest of the
  32-byte Research request identity this Owner's Design role intent carries (`rd.develop.request-identity.v2\0` over the
  request locator), so Market Data recomputes the same value from the intent; this Owner writes it and never takes it
  from a caller; `scope_digest` is the scope identity; the correlation is SHA-256 over
  `rd.research-initial-pit-correlation.v1\0` and the Intent identity's 32 bytes; and the Source Binding, Market Semantics
  and decision-cut references are the ones Market Data's own read surface resolves for that scope, as the Market Data
  contract states. The submission states no Instrument Master digest and no claimed request identity or digest: the
  intake stamps its own Instrument Master readback and seals the request itself.
- Market Data is reached through its two admission ports, the same pair behind its Universe Selection and PIT routes,
  so it runs on its own pool and in its own transactions and this Owner hands it only untrusted input. Its reads of the
  scope and of the correlation run in this Owner's transaction, as Market Data's read surface provides. If Market Data
  becomes its own process, the replacement point is those two ports' implementations, which become an HTTP client; the
  issuance does not change.
- Each frozen submission is an attempt, appended under the request and never rewritten, and stored before it is sent;
  a submission identical to one already frozen is that attempt, not a second one. Every attempt carries the Intent's one
  correlation, and Market Data commits at most one initial intake per correlation, so an Intent has at most one initial
  PIT request. A send that gets no answer, or that Market Data refuses as `PIT_CORRELATION_ALREADY_COMMITTED` or
  `PIT_CLOCK_EVIDENCE_NOT_CURRENT`, is resolved by reading back by correlation, not by sending again: once Market Data's
  clock head has moved, the frozen bytes no longer rejoin. A terminal read back is recorded against the one attempt
  whose submission, stamped with the terminal's Instrument Master digest, seals to exactly the request identity and
  digest the terminal answers. None is refused as `INITIAL_PIT_TERMINAL_MATCHES_NO_ATTEMPT`, more than one as
  `INITIAL_PIT_TERMINAL_MATCHES_SEVERAL_ATTEMPTS`, and a terminal under another correlation or another request's requester
  as `INITIAL_PIT_TERMINAL_NAMES_ANOTHER_REQUEST`; a terminal is recorded only with the primary blocker Market Data derives
  its disposition from. When nothing reads back, the latest attempt is sent again, and only when Market Data then refuses
  its clock evidence is a new attempt frozen at the current cut. The recorded terminal is written once. A refusal that
  comes after an attempt was sent leaves that attempt, and the readback states `SUBMITTED_OR_UNKNOWN` until a terminal is
  recorded.
- The Research readback carries the state as `initial_pit`: `null` unless the request is an accepted V3 one,
  `NOT_ISSUED` before this Owner has frozen an attempt, `SUBMITTED_OR_UNKNOWN` once one is frozen and before a terminal
  is recorded, and otherwise the recorded disposition, one of the six, with its primary blocker or `null`; a reader
  never infers one of these from another. An identity that passed the check at acceptance but no longer resolves to a
  single member of Market Data's current frontier is refused by the fixed-member rule before any PIT request exists, so
  issuance answers `INSTRUMENT_SCOPE_NOT_ELIGIBLE_AT_ISSUE`, freezes nothing, and the readback stays `NOT_ISSUED`:
  nothing downstream of that Intent can consume it, and the remedy is a successor request.
- The Research readback also states `request_schema_version`, `2` or `3`, read from the `operation_schema` of the
  Product Edge admission the request was made under (`sourced-research-goal-v2` or `sourced-research-goal-v3`), and
  `instrument_scope`, the scope a V3 request states, exactly as it was admitted and stored; it is `null` for a V2
  request. The stored request is one shape for both versions, so the version is never inferred from it. The two must
  agree - a V3 admission exactly when the request states a scope - and a readback where they disagree is refused as an
  integrity failure (`DisagreesWithInstrumentScope`), as is one whose admission names another schema
  (`UnsupportedOperationSchema`). A rejected V3 request is still V3 and states its scope, even one rejected because the
  scope is not canonical. Where this Owner holds no current admitted request - an unresolved request, an identity
  conflict, a legacy quarantined one - both are `null`, and `null` implies no version.
- The Design role intent (schema 2) additionally names that initial PIT request, read from this Owner's custody and
  never from the publishing caller, and it is published only once the recorded terminal is `AVAILABLE`. Market Data
  registers the Design's declarations against exactly that request instead of searching for one, so a request a
  caller submitted under a forged `requester_identity` is never picked up. A successor PIT request of the same Intent
  is named only by a role intent published after it; a published role intent never changes.
- A V3 request's scope is the one place its instruments are declared, so a Design published, frozen or declared under
  it may not name one itself: a role with the exact instrument scope or a non-empty `instrument` is refused as
  `DESIGN_ROLE_NAMES_INSTRUMENT_UNDER_RESEARCH_SCOPE` before any row is written, and every role reads the members the
  scope names, one or many. This is the Strategy shape envelope's P0 on the paths that create new custody: only a first
  write is refused, so a Design already published or frozen under the request reads back as it was committed. The
  ordered chain's V3 scope entry drives it, publishing and freezing the exact-instrument candidate under an accepted V3
  request and finding neither row. A V2 request states no scope, so its Designs still name their instrument.

Built so far: the scope codec, the schema 2 role intent codec, V3 acceptance and the issuance above.
`ResearchInstrumentScopeV1` validates a scope and computes its canonical bytes, identity and fixed-member selection
rule, and decodes that rule back, for this Owner and Market Data alike. `StrategyDesignRoleIntentV1` names the initial
PIT request as `(pit_request_identity, pit_request_digest)` under schema 2 alone, digests each schema under its own
domain, and leaves schema 1 bytes and digests unchanged. A V3 request is submitted through
`POST /v3/source-intake-research`, checked against Market Data's early read, and either accepted with a schema 3 Intent
that binds its scope or rejected with its bound check record. `POST /v3/research-goals/{request_identity}/initial-pit`
freezes attempts in `rd_research_initial_pit_attempts_v1` and records the terminal in
`rd_research_initial_pit_terminals_v1`, and the Research readback carries `initial_pit`. A V3 request's Design role
intent is published as schema 2 naming the recorded `AVAILABLE` request, and is refused as
`INITIAL_PIT_REQUEST_NOT_AVAILABLE` until one is recorded. The issuance route has no production caller yet: the
Dashboard admits showing `initial_pit` but no action that issues it.

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
