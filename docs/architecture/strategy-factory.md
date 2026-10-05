# Strategy Factory

## Responsibility

Strategy Factory is a value-stream boundary around R&D, exploratory Backtest, and independent Qualification. R&D contains both Research and Develop capabilities; the boundary makes the R D Q separation visible without becoming another Owner. Where this page names the actor that canonicalizes, binds, validates, or lowers a Design, that actor is R&D's Develop capability; the boundary itself performs nothing.

### Representation and execution design

R&D compiles versioned JSON into a bounded typed BFP and seals immutable Artifacts. The target Host interprets
that program directly; native Nautilus supplies data, order lifecycle, matching, accounts and analytics.
The current Wasm/capsule path remains a compatibility contract until R2 switches representation. It is not a second
future execution architecture. Signal rules, sizing configuration and execution policy are frozen together.

The following chapters define authority and value flow, typed Design and primitive semantics, policy/configuration,
Host interpretation, data/universe and native order extensions, then protected handoffs and acceptance. Precise
schema, refusal and recovery meanings are normative in their owning chapter; target shapes are not shipped features.

## Forward path

A sourced hypothesis is only a proposal. Before protected feedback, R&D atomically precommits one principal- and request-scope-bound Independence Basis Receipt. Qualification directly resolves that exact R&D receipt and, after inspecting its complete durable principal/scope history, returns either `GENESIS_EMPTY`, a current opaque `FRONTIER(ref, cut)`, or `UNAVAILABLE`; genesis is valid only for proven empty Qualification history. Product Edge carries that principal/scope-bound opaque projection without protected detail. Inside the locked R&D admission transaction, R&D resolves its own complete local semantic-predecessor lineage as `GENESIS_EMPTY`, `COMPLETE_FRONTIER`, or `UNAVAILABLE`. Only exact current canonical reads from both Owners may atomically create the frozen Research Intent, permanent TrialFamily root, initial census member and head, receipts, and outbox. The caller cannot supply or override either frontier, the independence disposition, or the basis identity.

Qualification's PostgreSQL custody is physically distinct: `qualification_owner` owns its tables and locked admission function, while a separate Qualification writer performs projection writes. The R&D role has no ownership, raw `SELECT`, or DML on Qualification tables. In the caller's R&D transaction it may execute only the fixed safe `search_path` `SECURITY DEFINER` admission function, whose fully qualified reads preserve lock order and return an untrusted raw envelope. Qualification-owned Rust verifies that envelope against the canonical R&D basis and Qualification history before constructing the sealed, non-deserializable positive readback; no public raw-envelope constructor exists.

Replay Policy Catalog and durable Composer custody use the same physical separation. `rd_database_owner`
is the NOLOGIN database/public-schema custodian; `replay_policy_catalog_owner` and `composer_owner` are
distinct NOLOGIN object owners of private data and fixed API schemas. `rd_owner` has neither membership,
ownership, schema `CREATE` nor raw table access; it retains the fixed lock/read APIs and exactly one non-grantable
mutation `EXECUTE`, on the Composer commit routines `commit_develop_composer_v2`/`v3`, so a frozen Bounded Feature
Program is reread, locked, bound and committed inside one Owner transaction.
The separately supplied `replay_policy_catalog_admin_writer` LOGIN alone receives non-grantable `EXECUTE` on the
Catalog administration routine, while `rd_fact_writer` retains only Composer commit authority. All routines use `search_path=pg_catalog,pg_temp` inside the
caller's existing transaction. A fresh deployment first runs the same bounded Rust schema materializers while
`rd_owner` still owns `public`; only after they finish may the custody migration transfer the database/schema
to `rd_database_owner` and revoke `rd_owner` schema `CREATE`. The explicit, one-shot Catalog bootstrap or exact
resolution must then complete and its canonical Owner readback must verify before the R&D API may listen. Runtime
startup never reacquires the schema lease or authors Catalog state: missing pre-materialized legacy tables or an
absent, mismatched, unauthenticated, or unresolved bootstrap readback fails closed. Reads never create custody;
cutover preserves existing OIDs, rows and bytes.

The TARGET Composer product entry carries only a canonical Research request locator. R&D uses one transaction and
an Owner-internal exact request/aggregate commit-cut lock to reread canonical Research custody and derive the entire
request, Design, digest, binding, provider, Operator Authorization frontier and final-cut lineage. A read-only GET
projection may expose the pre-send request identity for response-loss recovery, but POST never accepts those fields
back. The sealed A0 Build Receipt is normalized as one intrinsic content-addressed build fact; a separate ordered
use relation binds each Artifact to it, so two Research-derived Artifacts may share one build corpus without sharing
their Research or Artifact custody. Exact legacy bytes admit one one-time normalization; every other schema shape
fails closed. This remains `TARGET`, not deployed or production maturity, until the isolated first-party acceptance chain
and its dual-custody, locator-negative, transaction-fault, concurrency, restart, and cleanup gates pass.

Qualification projections form one append-only, acyclic principal/scope chain. If the latest projection for an exact verified Independence Basis becomes stale after Qualification commit or response loss, only Qualification Owner under the same principal/scope lock may append a successor that binds the exact basis ref/digest, predecessor projection ref/digest, unchanged canonical source sequence/cut/frontier, Owner clock epoch, new half-open validity, receipt and outbox, then atomically advance the head. A current projection joins byte-identically; callers and R&D cannot renew it. Historical R&D terminal custody continues to bind and expose its exact consumed projection, while a new S1 write requires the canonical latest projection to be current at the final locked cut.

R&D's Develop capability returns one content-addressed Strategy Artifact and Build Receipt, then its Research capability freezes one Exploratory Replay Request binding that exact artifact, data scope, replay configuration, and model identities before the separate Backtest service accepts it. Exploratory facts return only to R&D and can create a successor Intent. R&D maintains the append-only TrialFamily Census Frontier and alone commits Iteration Decision. A terminal stop ends there with no Selection. Only a `READY_FOR_SELECTION` decision may produce the selected-only `SELECTED_FOR_QUALIFICATION` disposition and submit the Qualification Candidate.

<a id="strategy-design-v2-shared-lifecycle-kernel"></a>

## TARGET - Host interpretation of the Bounded Feature Program

After T0 is reproduced, the generic ProgramHost interprets the frozen BFP directly. First-party source
lowering, Cargo-to-Wasm and Composer build custody are replaced in bounded cutover slices; they are current
representation compatibility, not a second target engine. Programs use the pinned kernel/catalog and remain
statically bounded. Direct interpretation reduces repeated operator implementations and per-frame guest copying
without admitting caller source, runtime plugins, Paper/Live or money effects.

**What is kept unchanged.** The canonical `BoundedFeatureProgramV1` schema, its domain-separated bytes and digest,
the R&D joint freeze, the pinned primitive catalog with its versioning and golden vectors, the description and
resource bounds, readiness (`READY`/`WARMING`), fixed-I128 arithmetic with its frozen rounding, the absence of
floating point, `NUMERIC_FAILURE_NO_STATE_CHANGE`, `StrategyDesignV2`, `StrategyPlanV2`, and the shared
lifecycle kernel's sole authority over state transitions. Determinism never came from Wasm: it comes from the
fixed-I128 kernel, which host and guest share source for source.

**The TARGET forward path:**

`Frozen Research -> canonical BoundedFeatureProgramV1 -> StrategyPlanV2 binding each plugin's BFP digest ->`
`StrategyArtifactV2 package carrying the Plan and each plugin's canonical BFP bytes -> ProgramHostV2 interpreting`
`each BFP through vibe-indicators-kernel -> shared lifecycle kernel -> Backtest`.

The interpreter is one first-party module of `ProgramHostV2`. It accepts only canonical BFP bytes whose digest the
Plan binds, re-derives that digest before its first evaluation, and evaluates nodes in canonical topological order
by calling the catalog function each node's semantic ID names. It is the sole BFP runtime, not a second one beside
Wasm: the Wasm runtime is retired in the same plan. Strategy meaning stays BFP. The interpreter adds no opcode, no
node kind, and no host feature beyond the published catalog. A semantic ID the running catalog does not publish is
refused, as today. The Artifact's identity binds the Plan, the BFP bytes, and the interpreter identity: the catalog
semantic version and digest plus the interpreter semantic version. A program therefore re-identifies whenever the
code that gives it meaning changes. The build receipt that bound the toolchain played this role before.

**Isolation, relocated onto the program's static bounds.** Each property the Wasm boundary enforced at run time is
enforced by a bound the canonical program already declares. That bound is checked before the Plan is issued, and
checked again when the host is constructed:

- **Fuel per invocation** is replaced by the **evaluation-cost bound**: the sum over nodes of each primitive's
  catalog cost, where a windowed primitive costs its declared window and lag, times invocations per event. It is
  derived from the description bounds (nodes, edges, depth, fan-out, decision branches) and the resource bounds
  (window, lag, invocations per event). At freeze and at Plan issuance, a program whose derived cost exceeds the
  catalog's per-event cost cap is `UNSUPPORTED`. At run time the interpreter performs exactly the derived work.
  Nothing data-dependent can extend it, because the DAG has no loop and no unbounded window.
- **Linear memory, the guest stack and `memory.grow`** are replaced by the **state bound**: state cells and state
  bytes, plus window and lag. The host allocates each plugin's state once, at construction and at the declared
  size, and never during evaluation. A state write beyond its cell, or a window beyond its declared length, is
  refused before any state changes.
- **No imports, no start function and no ambient effect** are replaced by the **closed catalog namespace**. A
  program can name only published semantic IDs, and no catalog function performs I/O, reads a clock, or allocates
  outside its state.
- **A fresh instance per invocation with no retained guest memory** becomes host-owned state crossing each
  evaluation as explicit bytes. This is unchanged in effect: state persists only in the canonical state the
  checkpoint already carries.
- **Forbidden floating-point opcodes** are replaced by the fixed-I128 catalog, unchanged.

The source-byte, Wasm-byte, fuel and linear-memory bounds retire with the Wasm path. A program that declares
them is still read back, and the interpreter ignores those four fields. The derived evaluation-cost bound
replaces them. The catalog publishes its cost cap and each primitive's cost under the same versioning as its
golden vectors.

**Stated refusals and seals this moves.** Each is rewritten where it is stated, marked as applying until the
retirement slice named below lands:

- "not a ... interpreter, runtime" and the Wasm forward path, under the Bounded Feature Program section above;
- "two byte-identical builds", under the V3 build capsule and the first executable corpus above;
- "This is the sole V2 execution path", under the Wasm Artifact and its ABI below;
- R&D's "may not ... create another interpreter or runtime", "No ... second interpreter/runtime" and "two
  byte-identical builds";
- Runtime's "content-addressed Wasm Artifact".

These statements are relocated, not removed: the property each protected - one runtime, a reproducible
executable identity, bounded execution cost and memory - is restated above and stays provable.

**Status.** This section is TARGET. Until slice R2 lands, the Wasm path stays the CURRENT/PARTIAL path; nothing
here is claimed as implemented.

<a id="bfp-host-interpretation-retirement-plan"></a>

### Representation cutover dependencies

**Prerequisites.**

1. *Research T0 is reproduced on the current path.* `backtest.run` reaches the Composer and the Wasm host, and
   the T0 acceptance passes. The run this produces is the oracle for slice R1.
2. *Backtest has one seam.* Backtest's `backtest.run` obtains its executable through exactly one function: a
   frozen Plan maps to an executable Artifact. Under the current path it is the Composer: lower, build twice,
   issue the Artifact. Slice R2 replaces that function's body and nothing else in the run.
3. *Three research prerequisites, scheduled by R&D lane coordination, gate R-1u acceptance only.* They do not
   gate R1-R3:
   - R-1u's reference trades are re-exported with entry, stop and target prices and fill and exit times;
   - its unbounded pivot list is bounded to the last K pivots, with research showing the bound changes no trade;
   - the reference is regenerated on perpetual data. The user decided on 2026-10-04 that the product stays
     perpetual and adds no spot.

**Slices, in order:**

- **R1 - interpreter beside Wasm.**
  - *Adds:* the interpreter in `ProgramHostV2`, behind the same per-plugin invocation the Wasm runtime serves. It
    takes the canonical BFP, the frame's typed inputs and the prior state, and returns the outputs, availability
    and post-state that `PluginFrameV2` carries today. It also adds the evaluation-cost bound and the catalog's
    per-primitive costs.
  - *Deletes:* nothing.
  - *Ordered chain:* unchanged. An equivalence proof is added: every authored corpus program (T0, `d1`, `w1`, `w2`,
    the rebalance program and the rest of the authored corpus) runs both ways over the same frames. Every
    frame's outputs, availability and post-state bytes must be identical.
- **R2 - the Artifact carries the program.**
  - *Adds:* a Strategy Artifact package version whose per-plugin entry is the canonical BFP bytes and the
    interpreter identity, not a Wasm module. Composer becomes "freeze the Plan and its BFP package", with no
    lowering and no build, and the seam from prerequisite 2 calls it.
  - *Deletes:* lowering and building on the production Composer route.
  - *Ordered chain:* these entries are replaced:
    - `product_edge_postgres::tests::frozen_program_runs_the_production_composer_to_a_durable_artifact`;
    - `tests::the_authored_frozen_program_runs_the_production_composer`;
    - F's H5 step in `tests::the_first_composer_v3_replay_runs_as_its_one_member_universe_and_is_reported`;
    - `tests::backtest_run_reaches_the_replay_step_over_a_catalogued_strategy`, once it runs past the replay step.

    Their dependents in `scripts/ci/rd-owner-chain-needs.tsv` are re-measured, never estimated.
- **R3 - delete the Wasm path.**
  - *Deletes:*
    - `bounded_feature_program_lowerer_v1` and its tests;
    - `develop_plugin_build_v3`, and the V2 build producer and its sandbox;
    - `lowered_guest_build_for_test`;
    - `program_runtime_v2` and the wasmi dependency;
    - the guest-stack rule and the guest SDK's BFP wire;
    - the pinned toolchain and sysroot digests;
    - the `strategy-factory-linux-a0` and `strategy-program-seal` workflows;
    - the dead `complex_strategy_ir`/`complex_strategy_program` interpreter and compiler. Their retirement
      condition becomes equivalence through the host interpreter.
  - *Build-receipt tables:* they stop receiving rows. Their existing rows stay readable, because storage stays
    append-only and content-addressed. A Wasm-backed Artifact remains a readable record and is no longer
    executable.
  - *Ordered chain:* entries whose only subject was the build or the lowerer leave the chain. Every other entry
    keeps its position.
- **R4 - the documentation states CURRENT.** The CURRENT statements of this page and of R&D's Develop compilation
  section describe the interpreted path, and each rewritten Wasm statement listed above is removed.

**Acceptance of the retirement.**

- *T0, trade by trade.* Research T0 runs on the interpreted path to a Backtest report whose every trade (member,
  side, entry and exit frame, fill price and quantity) and whose canonical result equal those of the accepted run
  on the Wasm path.
- *Performance, measured.* The per-frame evaluation time of T0 is recorded on the same host profile as the
  2.2 ms baseline, with a target of at most 100 µs. If the measurement misses that target, the target is
  restated with the measurement, not reread.
- *Repeatability.* Repeated runs and every checkpoint restore stay byte-identical, as the first executable corpus
  requires today.

## StrategyDesignV2 and the shared lifecycle kernel

This is the top-level contract for turning arbitrary admitted Research into an executable strategy. It is not a
second Strategy Owner or runtime. Its only forward shape is:

`Research Intent -> StrategyDesignV2 -> StrategyPlanV2 -> StrategyArtifactV2 package -> generic ProgramHostV2 ->`
`shared lifecycle kernel`.

The maturity boundary is explicit:

- **CURRENT/PARTIAL:** V2 freezes canonical Design/Plan meaning, the content-addressed package and bounded plugin
  ABI, and the generic host/shared-kernel execution boundary described below. The shared kernel now includes the
  bounded exactly-two-member Market Data universe vertical: one complete Owner-sealed frame causes one plugin
  invocation and one canonical instrument-keyed target set, and the host commits both member lifecycle states and
  one combination checkpoint only after exact-set validation succeeds. A non-default, zero-argument sealed
  acceptance corpus exercises the real Market Data Owner issuance path, exact Plan compilation, one guest call,
  member-causal targets, atomic malformed-output rejection, replay, and restore. This is bounded crate-local
  acceptance evidence only. The local bounded-plugin producer admits an exact, fail-closed macOS arm64 host profile.
  Linux ARM64 and x86_64 are **REVALIDATION REQUIRED**: the implementation now freezes the currently observed
  canonical `wasm32v1-none` sysroot digest, but neither becomes CURRENT/PARTIAL until a main-bound hosted native
  gate succeeds for that digest on that host. The previous evidence boundary was the exact
  workflow [`strategy-factory-linux-a0`](https://github.com/qOeOp/trade/blob/9e5149d4293a800be3a35e6b747a9f3dba304e1f/.github/workflows/strategy-factory-linux-a0.yml),
  `workflow_dispatch` [run 33250411708](https://github.com/qOeOp/trade/actions/runs/33250411708) at head
  `9e5149d4293a800be3a35e6b747a9f3dba304e1f`, and job
  [`strategy factory A0 native gate (linux arm64)`](https://github.com/qOeOp/trade/actions/runs/33250411708/job/99095016988)
  succeeded on GitHub-hosted `ubuntu-22.04-arm`, bound as `github-hosted/Linux/ARM64/aarch64`. That historical gate
  covered the superseded sysroot digest and is not acceptance for the replacement freeze. The gate verifies
  immutable CI inputs, exact Rust 1.97.1 Cargo/rustc commits and host, the sole `wasm32v1-none` target, the pure-Rust
  canonical sysroot digest, deterministic double build/exact replay, and delivery of the real build into the sole
  Composer and `ProgramHostV2` consumer path. The builder rereads its exact tools and canonical target sysroot before
  and after each build. This hosted job success is not an R&D Owner business receipt. There is no kernel network
  confinement, durable/deployed/Dashboard readiness, Paper, Live, deployed-runtime, or production maturity. The
  bounded Backtest target-set slice below is the only current member fill-routing,
  account/equity, and price-conversion evidence.
  ComplexStrategy V1 supplies the migration/equivalence baseline. R&D can also freeze a fully bound,
  Owner-sealed PIT pre-Artifact Develop
  Evaluation. That evaluation is an internal R&D fact only: it is not a Strategy Artifact, Exploratory Replay
  Request or Result, Qualification evidence, Candidate, or deployable program.
- **CURRENT/DYNAMIC, isolated Backtest first vertical:** one deterministic stateful corpus drives the real
  `BacktestEngine`/Sim Exchange consumer from two pre-admitted bound fields through `StrategyDesignV2`, the
  deterministic `StrategyPlanV2`, `StrategyArtifactV2`, `ProgramHostV2`, and the shared kernel. It proves native
  partial/full order fills, cache/position transitions, `ENTER -> ADD -> REDUCE -> EXIT`, protection
  replace/adjust/clear, uninterrupted/checkpoint-restored suffix equality, and repeat-run equality. This is an
  isolated dynamic Backtest proof only, not Paper, Live, production Owner readiness, or trading authority.
- **CURRENT/PARTIAL, isolated multi-leg/multi-timeframe input join:** the third immutable corpus binds four exact
  Research-declared roles (two AAPL 1-minute fields, one MSFT 1-hour field and one QQQ 1-day field) to their
  compile-time-sealed Market Data Owner receipts. Market Data performs latest-not-after argmax over its complete
  verified PIT/correction census and issues one opaque `StrategyInputJoinedCutReceiptV1`; the Host has no
  frame-slice selection path. The generic `ProgramHostV2` and shared kernel consume that complete joined cut
  through the ordinary typed plugin path, preserve regime state, and emit one atomic target
  intent per trigger. The real `BacktestEngine`/Sim Exchange consumer proves deterministic joined ordering,
  `ENTER -> ADD -> REDUCE`, native submissions/fills, repeat equality and checkpoint/restore suffix equality.
  Missing, stale, future, mismatched, cross-Design/role or conflicting-lineage input is rejected before guest,
  plugin-state, lifecycle-state, target or checkpoint mutation. This is a parallel complex-strategy substrate and
  isolated Backtest acceptance only; it is not the default R&D path, product readiness, Paper, Live, production
  Owner readiness or trading authority. **CURRENT/PARTIAL, Native Replay preparation only:** the preparation seam
  now additionally requires the exact Owner-sealed V1 joined-cut receipt and move-only V2 JOINED_CUT projection
  readback. Before constructing the ProgramHost handoff it verifies EVENT lifecycle, exact joined-cut subject digest,
  positive complete component count, and strict equality between the projection's role/binding set and the compiled
  Plan. The handoff retains the exact projection digest and count and rechecks their binding before promotion. This
  is fail-closed preparation and public consumer-shape evidence; it does not execute Native Replay, start a production
  resolver, prove dynamic PostgreSQL product composition or end-to-end first-party acceptance, or admit trading.
- **CURRENT/DYNAMIC, bounded exactly-two-member Backtest target-set vertical:** one complete Owner-sealed
  universe frame is prepared on a cloned `ProgramHostV2`, produces one canonical target set and one plugin
  invocation, and is committed only after one account-scoped equity snapshot, both exact instrument
  facts, Decimal target conversion, member reconciliation, and both native orders validate. The equity snapshot is
  total account balance plus each open margin position's unrealized PnL, marked at that member's price under the
  frame's pricing role, never at the latest cached Quote, which is the previous frame's fill quote; it fails closed
  for an absent or ambiguous venue account, multiple/wrong currencies, or an open position on no member. Support is limited to
  linear, non-inverse, non-quanto instruments whose settlement and quote currency equal the positive equity
  currency. Weight targets use
  `trunc_toward_zero(equity * weight_micros / 1_000_000 / price / multiplier / size_increment)` as signed grid
  units; position targets already are signed grid units. Both forms pass only through an opaque adapter-sealed
  reconciliation capability bound to the exact prepared target-set identity, running Host instance, account/equity
  snapshot, both instrument facts and prices, current positions, formula, and derived targets. No crate peer or
  caller can construct or alter its numeric targets. Native quantity is rebuilt exactly as grid units times size
  increment and must pass instrument normalization unchanged. Host commit and order preflight are
  whole-batch atomic before submission. The Host decides and commits at the frame BAR's close but submits each
  member's native order only when that member's fill quote arrives: the Quote from the frame's quote cut, at the
  instant the execution bundle states for that member. The Sim venue's on-arrival check against that Quote then
  decides liquidity, so a limit the fill quote already crosses fills as TAKER at the touch and pays the taker rate,
  and only an uncrossed limit rests and later fills as MAKER at its limit. A Quote at another instant while the
  member's order waits is refused as `FILL_QUOTE_NOT_THE_FRAMES_QUOTE_CUT`, and an order still waiting when the
  next BAR or the run's end arrives is refused as `FILL_QUOTE_MISSING_BEFORE_NEXT_FRAME`; protective orders are
  placed as before. Sim Exchange submissions and fills are sequential, not venue-atomic, so an earlier member can
  fill before a later member's fill quote arrives: a
  later submission failure faults the run and preserves any earlier native effect and in-process replay evidence.
  A bounded test-only fault at the second-submit boundary dynamically proves one successful real submission and
  native cached order remain after the Host commit; it does not claim venue rollback or all-or-none submission.
  Each `ClientOrderId` binds the exact instrument and host-derived intent; partial/full/canceled/rejected progress
  advances only that member, retains its independent residual, and synchronizes that member's protection quantity
  to actual filled quantity. A pre-trade risk denial reaches the kernel as that member's rejection. A position order
  still resting when the run ends is canceled at the venue, and the Host states that cancellation to the kernel
  before the Stop, because no venue event reaches a stopping strategy; protective orders stay. The real
  `BacktestEngine`/Sim Exchange acceptance corpus uses distinct prices,
  multipliers, and size grids and proves repeat equality plus uninterrupted versus same-running-engine opaque Host
  checkpoint-restored suffix equality. A real-Sim regression with the Owner-sealed first frame and a test-only
  admitted successor frame opens positions, marks nonzero unrealized PnL, and proves the next weight target uses
  that batch's account-scoped equity rather than cash balance; it is not evidence of a second dynamic Owner issuance.
  Prepared capabilities are also rejected by independently created equivalent or restored Host instances. It does
  not prove
  a cold engine restart, venue atomicity, Paper, Live,
  provider/network, persistence, production readiness, or trading authority.
- **TARGET / IMPLEMENTATION_ADMITTED, one-member Backtest target-set vertical:** the vertical above also admits a
  universe of exactly one member, alongside the two-member form; admitting one member changes no two-member behaviour
  or byte. The
  user admitted this on 2026-09-24 when choosing crypto perpetuals and single-instrument strategies as the first
  product scope, in these words (translated): "widen the execution chain's member count from exactly two to also
  support one; it is a bounded slice written in these documents; widening it changes the documents and removes no
  property". A single-instrument strategy is a Design whose roles use `UniverseMembers` scope, run against a
  one-member Owner-sealed universe; the Research request names the instrument, which Market Data's universe selection
  evaluates at request time, so neither the Design nor R&D chooses it (the R&D Owner contract states that request
  scope). A Design with `EXACT_INSTRUMENT` roles stays refused under an Owner universe, by a named refusal,
  `ExactInstrumentRolesUnderOwnerUniverse`, which the implementing change introduces. The universe vertical's input contract of exactly one fixed `OPEN` and one
  fixed `CLOSE` member role was later replaced by the role set the Design declares (P1 below); the single-threshold authoring surface gains a universe-member form whose
  channel is the member's daily close and which carries the fixed open role, as a carried input its program never
  reads. The authoring request names its form in a required `scope`, so a request without one is refused rather than
  read as the exact-instrument form. That form consumes each role at member
  ordinal 0 only, and its bounded feature program still emits a single-instrument proposal: under a one-member
  universe the host lifts that proposal into the one-member canonical target set, so the vertical still commits one
  canonical target set and only its producer moves from the plugin to the host. The single-threshold report family and
  the instrument its data window names extend to that form before the first positive run. The target-set schema
  version and semantic identities do not change, and admitting one member changes no two-member preimage: the target-set codec
  and the Instrument Master cut already encode their member count, while the V1 scheduling receipt digest and the
  Strategy Factory digests that hash their members without a count (the Backtest target-set snapshot, execution-profile
  binding, native materialization, execution census and round-trip closure digests) hash any other member count under a
  domain that names the count, so the two-member domain and bytes stay unchanged. A lifted one-member target set takes
  the sequence after the pending set's, or 1 when none is pending. Nothing here is current until the implementing
  changes land and update the CURRENT statement above.
- **TARGET / NOT_ADMITTED:** Paper and Live consume the same plan, Artifact, event ordering, checkpoint schema,
  kernel and semantic-trace contract only after their Owner adapters exist and are separately admitted. No current
  Paper or Live equivalence, application, external write, or trading capability is claimed here.
- **CURRENT/PARTIAL - ARC Complex D Bounded Feature Program V1:** frozen Research may supply the bounded,
  typed feature/state program defined below. R&D's Develop capability deterministically lowers that canonical program with
  first-party sources into one existing bounded plugin, then continues only through `PluginManifestV2`,
  `StrategyPlanV2`, `StrategyArtifactV2`, `ProgramHostV2`, and the shared lifecycle kernel; the production Composer
  route freezes, lowers, builds and composes it (R&D's Develop compilation section states the route). **TARGET:**
  the [host interpretation of the Bounded Feature
  Program](#target-host-interpretation-of-the-bounded-feature-program) replaces lowering, the Wasm build and the
  Wasm runtime with one host interpreter. This contract does not claim an executable D-loop, Native Replay,
  first-party acceptance, stable profitability, Paper, Live, production, or trading authority.

`StrategyDesignV2` is a typed, versioned, content-addressed description of input roles, joins, parameters,
features, state, lifecycle reactions, portfolio targets, protection policy, and optional custom-plugin calls. It
contains stable primitive semantic IDs rather than renderer labels, enum ordinals, generated class names, or raw
orders. `StrategyPlanV2` is the deterministic compiler result. It binds the exact Design and Intent, resolved
Owner input receipts, Market Semantics Compatibility identity, capability closure, primitive and plugin ABI
versions, resource bounds, lifecycle/checkpoint schema, and canonical lowering digest.

The compiler has one fail-closed pipeline:

1. **Canonicalization** validates schema, finite collection/dependency bounds, units, scales, declaration order,
   semantic IDs, state topology and lifecycle coverage, then emits byte-stable Design meaning.
1. **Capability closure** resolves every referenced primitive, lifecycle hook and plugin capability transitively;
   undeclared, unversioned, duplicate or cyclic capability is rejected.
1. **Binding** resolves every Research-declared input role through its fact Owner's typed, sealed receipt. The
   receipt binds role, field semantics, instrument/universe, timeframe, PIT/live cut, units and Market Semantics
   Compatibility identity. Callers and the compiler may not infer an Owner, instrument or field through heuristic
   string mapping, aliases, naming similarity or arrival order.
1. **Lowering** produces one canonical `StrategyPlanV2` and one content-addressed `StrategyArtifactV2` package for
   `ProgramHostV2`. The same inputs must produce byte-identical plan, Artifact and binding digests.

**TARGET / NOT_ADMITTED, Market W3 durable role-set attestation:** the R&D Owner must persist one immutable, complete
Strategy Design role-set attestation in the same positive Develop Composer transaction as the Composer aggregate,
receipt and outbox. The attestation binds the exact
Research request, Composer aggregate and `StrategyDesignV2`, every canonically ordered typed role and semantic
coordinate, complete role coverage, and its content-addressed exact locator. Its only cross-Owner surface is an
exact-locator R&D read function protected by database ACL; there is no public constructor, deserializer, bearer token,
cryptographic-key authority, latest/history scan or raw-table access. Because the locator is known before send, response
loss is recovered by resolving that same locator and byte-validating the same committed attestation, never by minting a
replacement.

**TARGET / NOT_ADMITTED, sealed Replay-request predecessor:** before Market Data selects any event, its
`market_data_owner` SERIALIZABLE transaction may pass only the exact request/meaning/receipt/seal locator to the
R&D-owned fixed facade exposed by `lock_sealed_exploratory_replay_request_for_market_data_v1`. The facade and both
transitive verifiers are owned by the isolated `NOLOGIN`
`rd_exploratory_replay_api_owner`; that role can read only the nine R&D relations required by the canonical verifier
chain and has no table- or column-level mutation privilege. Market principals receive no raw R&D relation access or
routine-owner membership. The caller retains a
request-scoped transaction advisory shared fence paired with the R&D writer-exclusive fence, while SERIALIZABLE
supplies the stable read snapshot. This read grants no event selector, binding, execution, deployment or trading
authority. It remains NOT_ADMITTED until the isolated PostgreSQL positive, drift, isolation and no-write gate passes.

Market Data positive Replay composition accepts only that untrusted attestation locator and the exact native dependency
locators. Market Data validates the R&D attestation internally, but independently re-resolves its own durable binding
registry, complete observation census, joined cut, sample projection, R0 and Market Semantics facts before atomically
issuing `ReplayCompositionBindingV1`. A caller-supplied receipt, readback, role set, count, authoritative token or
`StrategyPlanV2` is never positive evidence. Market Data neither parses R&D raw tables nor depends on R&D,
and R&D cannot select or reinterpret any Market fact. Missing, partial, stale, reordered, digest-mismatched or
cross-spliced evidence yields zero binding, Replay V2 fact, receipt or outbox writes. This preserves the sole forward
shape above and creates neither a new Owner nor a second canonicalization authority.

This target claims no implementation, admitted store, deployed composition, production write, runtime or trading
authority until disposable PostgreSQL Owner readback and the final consumer path prove the positive, rejection and
response-loss cases.

### TARGET - ARC Complex D Bounded Feature Program V1

`BoundedFeatureProgramV1` (BFP V1) is the only admitted general Complex D representation. R&D/Develop freezes its
canonical meaning together with the Research Intent and `StrategyDesignV2`; R&D's Develop capability verifies and lowers
it but cannot invent Research meaning. Until retirement slice R2 lands, its sole forward path is:

`Frozen Research -> canonical BoundedFeatureProgramV1 typed DAG -> deterministic first-party source lowering ->`
`versioned V3 build capsule/receipt -> existing PluginManifestV2/Composer/StrategyArtifactV2 ->`
`existing ProgramHostV2 -> shared lifecycle kernel -> Backtest`.

The BFP is the meaning of exactly one bounded plugin declared by the Design, not a Host graph extension, Host
feature opcode, strategy template, raw-order program, or new Owner. Until slice R2 it is a build input to the
lowerer; the user-authorized TARGET (2026-10-04) makes it the input of the one host interpreter instead, which
replaces lowering, the Wasm build and the Wasm runtime rather than adding a second runtime beside them - see
[Host interpretation of the Bounded Feature Program](#target-host-interpretation-of-the-bounded-feature-program).
The lowering rules in this paragraph apply until slice R3 deletes the lowerer. An LLM or caller may
propose Research meaning, but it cannot author Rust, Wasm, a dependency, ABI, formula implementation, build
command, clock, Owner receipt, or executable fallback. Only the frozen canonical BFP enters the first-party
lowerer. The lowerer is deterministic and dependency-closed; it may emit only source assembled from its pinned
SDK and primitive-kernel catalog. It cannot accept caller source, packages, build scripts, macros with ambient
inputs, network access, filesystem inputs, randomness, floating point, or undeclared imports/exports. In
particular, no `f32` or `f64` value or operation is valid anywhere in BFP meaning, lowering, plugin state, wire
values, or acceptance.

The canonical BFP schema must bind all of the following, with unknown fields and unknown semantic IDs rejected:

- schema and semantic version; exact Research request, Research Intent, `StrategyDesignV2`, plugin semantic ID,
  and canonical `PluginManifestV2` digest;
- every input's Owner, fact type, role identity, timeframe, signed fixed-I128 unit and decimal scale, static binding
  receipt digest, and its declared trigger or sample clock;
- the primitive-catalog semantic version and content digest, first-party SDK/source digest, lifecycle-output
  semantic IDs, and the complete typed DAG in canonical topological order;
- finite bounds for nodes, edges, depth, ports, constants, lag and rolling windows, state cells and bytes, source
  bytes, Wasm bytes, fuel, linear memory, and invocations per event (under the TARGET host interpretation the
  source, Wasm, fuel and linear-memory bounds retire, and a derived evaluation-cost bound replaces fuel); and
- domain-separated canonical bytes and digest covering every field above, all constants and frozen rounding modes.

Node IDs and port IDs are unique stable strings; edges reference only earlier typed outputs; every output is
consumed or declared terminal, every fan-out is explicit and bounded, and state has one writer and a declared initial value;
unreachable nodes, cycles, forward references, duplicate IDs, implicit casts, implicit rescale, unit mismatch,
unbounded windows, or a bound inconsistent with the manifest are `UNSUPPORTED` before source generation. Canonical
sorting is by schema-defined byte keys, never source order, map iteration, locale, platform, enum ordinal, or
caller-provided digest. Re-canonicalizing canonical bytes must be byte-identical.

Every declared input is read. The one exception is an input the program lists in `carried_input_role_ids`: a
role the Design requires and the program has no use for. A carried input keeps its value and coordinate ports and
its binding, and the host passes it like any other input. A graph that reads a carried input, as a value, as a
coordinate, or as the clock a node advances on, is refused as `CarriedInputRead`. An input that is neither read
nor listed is still refused, so the exemption comes from the declaration alone. The list is absent from the
canonical bytes when it is empty, so a program without carried inputs keeps its bytes.

For every catalog row with the `AvailableFixedAndCoordinate` output rule, the value and its provenance coordinate
form one atomic pair. Only the value projection may be referenced; referencing it atomically consumes the
coordinate sidecar for graph-closure purposes. Both projections always have the same availability. A value
consumer must declare `require_ready = true`, and neither projection is readable while the pair is `WARMING`.
The coordinate cannot be referenced independently or routed into a primitive input, strategy state, lifecycle
terminal, or manifest output.

The first primitive catalog is versioned and owned by `vibe-indicators-kernel`. R&D's Develop capability references each
primitive's semantic ID and the pinned catalog/source digest; it must not copy, reinterpret, or independently
implement a formula. The first catalog must include:

- checked fixed-I128 add, subtract, multiply, divide, explicit rescale, compare, and select, all with frozen
  rounding and overflow terminals;
- lag and rolling sum, mean, minimum, and maximum;
- EMA, Wilder smoothing, true range, ATR, and RSI;
- candle body, range, upper/lower wick, and gap geometry;
- rolling swing high and low; and
- `range_fraction(low, high, numerator, denominator)`, where the ratio is a frozen reduced rational, denominator
  is positive, bounds and scale are explicit, and Fibonacci levels are only frozen rational constants.

Later versions only append. Version 2 adds the fused rational, version 3 the fixed-point square root, and
version 4 the trailing-window bar counts since the maximum and since the minimum, exact integers where the
latest of equal extrema counts, and the trailing-window percent rank, the latest sample's midrank from 0 at the
lowest to 1 at the highest over a window of at least two, with one final rounding. Version 5 adds the position
flip as a lifecycle reference, so a Bounded Feature Program may propose it; it needs no golden vector, so version 5's
primitives and corpus are version 4's. A published version's number counts publications: the V4b and V5 labels under
"Values, inputs, and actions" name planned rows, not the version that will publish them.

Price-action rules and candlestick patterns are typed compositions of these catalog primitives, not named strategy
templates, opaque labels, copied formulas, or new Host opcodes.

#### Numeric, indicator, and availability semantics

BFP V1 fixed decimal is a signed I128 coefficient with a base-10 scale in `0..=38`; its mathematical value is
`coefficient * 10^-scale`. Scale is part of every port and state type. No node may infer, align, or silently change
a scale. Add, subtract, compare, select, and OHLC geometry require equal input scales; every other scale change is
an explicit rescale or a node-declared output scale. The only admitted rounding modes are `TowardZero` and
`NearestTiesToEven`. Every arithmetic or indicator update forms one exact signed two's-complement I256 expression,
including all powers of ten and rational factors, and performs exactly one final division/rounding into the
declared output scale. A wide intermediate that exceeds I128 but fits I256 and rounds to I128 is valid. An I256
overflow, divide by zero, invalid scale, discarded nonzero remainder without a declared rounding mode, or final
I128 overflow - including I128 `MIN / -1` - returns the named `NUMERIC_FAILURE_NO_STATE_CHANGE` terminal.
One class is exempt by user authorization: the TARGET natural logarithm and exponential catalog rows (V4b) have no
exact single-rounding form, so each pins its algorithm and golden test vectors instead, and the exemption covers
only those new rows. The pinned algorithm is part of the row's identity, so changing it is a new row; it is written
in the catalog's own fixed-point arithmetic, never a host math library, so guest and host agree; and a domain
failure - a logarithm of zero or less, an exponential that overflows - still returns
`NUMERIC_FAILURE_NO_STATE_CHANGE`. The exemption covers only the single final rounding, never the failure meaning.

`NUMERIC_FAILURE_NO_STATE_CHANGE` is failure-atomic: input admission may be recorded, but primitive state,
warm-up counters, stored sample coordinates, plugin/BFP/kernel state, lifecycle output, target/protection, semantic
trace, and checkpoint bytes remain identical to their pre-event bytes. Validation failures discovered before
execution remain `UNSUPPORTED` with no Artifact. A valid warm-up event is not a numeric failure: it advances the
declared state and exposes a typed `WARMING` availability with no readable value. A downstream node cannot read a
`WARMING` value; a lifecycle output during warm-up must be an explicit Design wiring from availability to the
existing `HOLD` semantic. Every successful ABI 3 output frame begins, immediately before its first manifest output
value, with one canonical availability byte: `0 = READY` and `1 = WARMING`; every other value is unsupported.
The tag is covered by the canonical frame length and identity and cannot be inferred from lifecycle values or
post-state. Every ABI 3 BFP warm-up invocation nevertheless returns one complete manifest-ordered output frame:
position intent is `kernel.position.hold.v1`, target variant is `kernel.target.keep.v1`, protection
variant is `kernel.protection.keep.v1`, and the eight scalar fields ignored under those Keep variants - target
position units, target weight micros, rebalance sequence, reconciliation target units, stop-loss ticks, take-profit
ticks, trailing-distance ticks, and trailing-stop ticks - are their exact-width canonical zero. Post-state is the
canonical state after this admitted coordinate has advanced every applicable primitive and BFP state cell. For an
ABI 3 manifest bound to BFP V1, `ProgramHostV2` verifies the `WARMING` tag, all three lifecycle values, all eight
zero scalars, and the canonical post-state before committing the scratch bundle; a missing or contradictory tag,
nonzero ignored scalar, or partial warm-up frame fails closed. A `READY` frame is never accepted as evidence of
warm-up merely because it returns `HOLD`/Keep/Keep. Existing ABI 2 output bytes and Host semantics are not
reinterpreted by this rule.

The following V1 definitions are normative:

- `lag(offset)` requires `offset` in `1..=declared_max_lag`, returns the value and Owner sample coordinate exactly
  `offset` advances before the current coordinate, and first becomes `READY` on sample `offset + 1`.
- Rolling sum, mean, minimum, maximum, and rolling swing require a positive window. They are `WARMING` until
  exactly `window` distinct update-clock samples have been admitted and are `READY` on sample `window`. Mean uses
  one I256 sum divided once by `window` with the node's rounding mode. No partial-window result is admitted.
- EMA with period `p > 0` is `READY` at the first sample, seeds that exact sample, and thereafter evaluates
  `previous + (2 / (p + 1)) * (sample - previous)` as one wide expression with one final rounding.
- Wilder smoothing with period `p > 0` is `READY` at the first sample, seeds that exact sample, and thereafter
  evaluates `previous + (1 / p) * (sample - previous)` as one wide expression with one final rounding.
- True range validates OHLC first. Its first sample is `high - low`; each later sample is
  `max(high - low, abs(high - previous_close), abs(low - previous_close))`. ATR V1 is only that true-range series
  under the preceding first-sample-seeded Wilder update. A configurable SMA ATR is not V1.
- RSI with period `p > 0` stores the previous close, then accumulates gains and losses over exactly `p` deltas.
  Its first `READY` output is sample `p + 1`, using the arithmetic mean of those `p` gains and `p` losses; later
  average gain and loss use the preceding Wilder update. Output is dimensionless in `[0, 100]` at the node-declared
  scale. Average gain and loss both zero yields exactly `50`; positive gain with zero loss yields exactly `100`;
  zero gain with positive loss yields exactly `0`; otherwise it evaluates `100 * gain / (gain + loss)` with one
  final rounding.
- Candle body is `abs(close - open)`, range is `high - low`, upper wick is
  `high - max(open, close)`, lower wick is `min(open, close) - low`, and gap is signed
  `open - previous_close`. Gap alone is `WARMING` on the first sample. Scale mismatch or any violation of
  `low <= min(open, close) <= max(open, close) <= high` returns the no-state-change terminal before any geometry or
  previous-close state advances.
- Rolling swing high is the maximum high and rolling swing low is the minimum low in the declared full trailing
  window. Each output includes the winning value and its complete Owner sample coordinate; equal extrema choose
  the latest coordinate in Owner order. This is a trailing-window extremum, not a future-looking confirmed pivot.
- `range_fraction(low, high, numerator, denominator)` requires equal low/high scales, `low <= high`, a reduced
  rational encoded as canonical unsigned 32-bit numerator and denominator, positive denominator, and
  `0 <= numerator <= denominator`. It evaluates exactly
  `low + (high - low) * numerator / denominator` as one I256 expression with one final rounding at the declared
  output scale. Ratios outside the closed unit interval are unavailable in V1 rather than clamped or extended.

Warm-up counts, period/window/lag values, ring indices, and add counts are canonical unsigned 32-bit fields;
Owner sequences are canonical unsigned 64-bit fields; numeric coefficients are canonical signed 128-bit fields;
scales and rounding tags are canonical unsigned 8-bit fields; and stored Owner coordinates use the exact
fixed-width canonical fields of `StrategyInputSampleCoordinateV1`. All integers are little-endian in canonical
state bytes. Rust layout, `usize`, pointer width, platform alignment, map order, and JSON number parsing have no
authority.

The primitive catalog publishes this family atomically. The following list is the closed V1 namespace and contains
exactly 57 rows:

- Numeric policy: `bfp.numeric.fixed-i128.max-scale-38.explicit-rescale.i256-single-round.v1`,
  `bfp.round.toward-zero.v1`, `bfp.round.nearest-ties-to-even.v1`, and
  `bfp.numeric.failure.no-state-change.v1`.
- Add: `bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` and
  `bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`.
- Subtract: `bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` and
  `bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`.
- Multiply: `bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` and
  `bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`.
- Divide: `bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` and
  `bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`.
- Rescale: `bfp.fixed-i128.rescale.max-scale-38.i256-single-round.toward-zero.v1` and
  `bfp.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1`.
- Compare/select: `bfp.fixed-i128.compare.equal-scale.v1` and `bfp.fixed-i128.select.equal-scale.v1`.
- Availability/state: `bfp.availability.warming-ready.v1`, `bfp.state.post.fixed-canonical.v1`, and
  `bfp.lag.coordinate.offset.full-history.v1`.
- Rolling: `bfp.rolling.sum.full-window.v1`, `bfp.rolling.mean.full-window.toward-zero.v1`,
  `bfp.rolling.mean.full-window.nearest-ties-to-even.v1`, `bfp.rolling.min.full-window.v1`, and
  `bfp.rolling.max.full-window.v1`.
- EMA: `bfp.ema.first-sample.alpha-2-over-period-plus-1.toward-zero.v1` and
  `bfp.ema.first-sample.alpha-2-over-period-plus-1.nearest-ties-to-even.v1`.
- Wilder: `bfp.wilder.first-sample.alpha-1-over-period.toward-zero.v1` and
  `bfp.wilder.first-sample.alpha-1-over-period.nearest-ties-to-even.v1`.
- TR/ATR: `bfp.true-range.ohlc.first-high-low.v1`,
  `bfp.atr.true-range.wilder-first-sample.toward-zero.v1`, and
  `bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1`.
- RSI: `bfp.rsi.period-deltas.wilder.flat-50.toward-zero.v1` and
  `bfp.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1`.
- Candle: `bfp.candle.body-magnitude.ohlc-validated.v1`, `bfp.candle.range.ohlc-validated.v1`,
  `bfp.candle.upper-wick.ohlc-validated.v1`, `bfp.candle.lower-wick.ohlc-validated.v1`, and
  `bfp.candle.gap-signed.previous-close.ohlc-validated.v1`.
- Swing: `bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1` and
  `bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1`.
- Range fraction: `bfp.range-fraction.closed-unit-rational.toward-zero.v1` and
  `bfp.range-fraction.closed-unit-rational.nearest-ties-to-even.v1`.
- Kernel output references: `kernel.position.enter.v1`, `kernel.position.add.v1`,
  `kernel.position.reduce.v1`, `kernel.position.exit.v1`, `kernel.position.hold.v1`,
  `kernel.target.keep.v1`, `kernel.target.position.v1`, `kernel.target.weight.v1`,
  `kernel.target.rebalance.v1`, `kernel.protection.keep.v1`, `kernel.protection.clear.v1`,
  `kernel.protection.replace.v1`, `kernel.protection.stop-loss.v1`, `kernel.protection.take-profit.v1`, and
  `kernel.protection.trailing-adjust.v1`.

No other primitive, alias, optional subset, or extension belongs to catalog V1. Every row binds its exact formula,
type/unit/scale contract, rounding ID where applicable, availability/update-clock rule, state encoding, and required
golden-vector identities in canonical catalog bytes. Missing or adding one row, formula, semantic ID, golden vector,
or failure oracle makes the entire V1 catalog digest unavailable; R&D's Develop capability must reject the BFP and cannot
publish or substitute a partial toy catalog.

<a id="catalog-versioning-and-frozen-program-readback"></a>

##### Catalog versioning and frozen-program readback

The catalog is published per semantic version rather than once. Version `N` fixes a closed row set with its
formulas, rounding IDs, availability rules, state encodings, and required golden-vector identities. Within that
version the closure statement above is exact: missing or adding one row, formula, semantic ID, golden vector, or
failure oracle makes version `N` unavailable.

Two identities are separate, and neither substitutes for the other.

- The **semantic digest** of version `N` is SHA-256 over a version-semantic domain, the version number, that
  version's canonical rows, and that version's canonical goldens. It binds meaning rather than code, so it is
  stable across kernel implementation changes.
- The **kernel implementation identity** is SHA-256 over the exact compiled kernel source set. It identifies one
  build, changes whenever any kernel source byte changes, and is evidence rather than an admission gate.

A frozen `BoundedFeatureProgramV1` declares its catalog semantic version and that version's semantic digest.
Admission resolves the declared version, refuses an unpublished version, and refuses a digest that is not that
version's semantic digest. It never compares the declaration against whichever version happens to be newest.

Reading back a program frozen under version `N` requires the running kernel to reproduce every required golden
vector of version `N` byte-for-byte before the program is parsed. That proof, not the kernel implementation
identity, is what keeps an older frozen program honest. An implementation change that preserves version `N`
semantics keeps the freeze readable; one that does not fails those goldens and makes the freeze unavailable
rather than silently re-evaluating committed Research meaning under changed semantics.

Publishing version `N+1` neither changes nor invalidates version `N`. A retired primitive leaves the row set of
`N+1` while version `N` keeps its rows and goldens compiled for as long as a frozen program declares it, so
retirement removes a primitive from new programs without rewriting committed Research meaning.

This is a deliberate trade. A freeze no longer pins the exact kernel binary that produced it, and its strength is
exactly the coverage of that version's golden corpus, which the exhaustive per-primitive requirements above
already fix.

<a id="declared-expressions-and-what-bounds-them"></a>

##### Declared expressions and what bounds them

An indicator does not have to be a primitive. Version 2 publishes one fused rational primitive whose parameter is a
declared expression: a numerator program and a denominator program over the node's two inputs and integer
constants, evaluated entirely in I256 with exactly one final rounding. Wilder's update, an initial average and the
RSI close are that same shape with different programs, so they may be library fragments rather than catalog rows,
and such a composition reproduces the shipped primitive's value coefficient for coefficient.

That exactness is what a composition of separately rounded nodes cannot reach. Every node output is an
already-rounded `FixedI128`, so composing Wilder from separate arithmetic nodes rounds three times where the
primitive rounds once. Exactness rather than expressiveness is what forced indicators into the catalog, and it is
what a declared expression gives back.

Moving an indicator out of the catalog moves it into the program, so the bounds follow it. **Description bounds**
limit how long a program is written: nodes, edges, ports, inputs, constants, decision branches and fan-out.
**Resource bounds** limit what it does: fuel, state bytes, linear memory, invocations per event, window and lag. A
composition changes the first and not the second, so only the first is recalibrated, and from a measurement of
admission cost against program size rather than from a guess. Depth stays where it is: it is the meaningful
structural limit, and indicators sitting beside each other do not add to it.

Each golden is canonical `BoundedFeatureGoldenVectorV1` binary bytes: magic `BFGV` `[u8; 4]`, schema `u16 = 1`,
reserved-zero `u16`, ASCII vector semantic ID and primitive semantic ID as `u16 length || bytes`, rounding tag
`u8` (`0 = none`, `1 = TowardZero`, `2 = NearestTiesToEven`), terminal tag `u8` (`0 = READY`, `1 = WARMING`,
`2 = NUMERIC_FAILURE_NO_STATE_CHANGE`, `3 = UNSUPPORTED`), then pre-state, canonical input frame, expected output,
and post-state as four successive `u32 length || bytes` fields. Integers are little-endian, strings are non-empty
ASCII, reserved bytes and trailing bytes are forbidden, and re-encoding must be byte-identical. Vector identity is
SHA-256 over `bfp.golden-vector.v1\0 || canonical bytes`. The catalog sorts full vectors by vector semantic-ID bytes,
rejects duplicates, and hashes their `u32 length || canonical bytes` concatenation into its own digest.

For every executable primitive ID in the Add through Range fraction families above, V1 requires exactly one
`bfp.golden.primitive.<primitive-id-without-bfp-prefix>.success.v1` vector; the semantic ID already fixes its
rounding choice, while its canonical node arguments and expected readiness are carried in the vector bytes. Numeric
policy IDs and kernel-output reference IDs do not mint primitive success vectors. The additional closed
cross-cutting vector-ID set is the Cartesian product explicitly named here: rounding mode token
`toward-zero|nearest-ties-to-even`, sign token `positive|negative`, and quotient token `even|odd` under
`bfp.golden.round.<rounding>.<sign>.<quotient>-half.v1`; frontier token `before-ready|first-ready` for each family
token `lag-offset-2|rolling-sum-window-3|rolling-mean-window-3|rolling-min-window-3|rolling-max-window-3|swing-high-window-3|swing-low-window-3|rsi-period-3`
under `bfp.golden.warm-up.<family>.<frontier>.v1`; and the literal IDs
`bfp.golden.ema-period-3.first-ready.v1`, `bfp.golden.wilder-period-3.first-ready.v1`,
`bfp.golden.atr-period-3.first-ready.v1`, `bfp.golden.gap.before-ready.v1`,
`bfp.golden.gap.first-ready.v1`, `bfp.golden.rsi.flat-50.v1`, `bfp.golden.rsi.zero-loss-100.v1`,
`bfp.golden.rsi.zero-gain-0.v1`, `bfp.golden.true-range.first.v1`,
`bfp.golden.true-range.previous-close.v1`,
`bfp.golden.numeric.i256-overflow.state-byte-identity.v1`,
`bfp.golden.numeric.divide-by-zero.state-byte-identity.v1`,
`bfp.golden.numeric.invalid-scale.state-byte-identity.v1`,
`bfp.golden.numeric.remainder-without-rounding.state-byte-identity.v1`,
`bfp.golden.numeric.final-i128-overflow.state-byte-identity.v1`,
`bfp.golden.numeric.min-div-negative-one.state-byte-identity.v1`,
`bfp.golden.numeric.scale-mismatch.state-byte-identity.v1`,
`bfp.golden.ohlc.ordering-violation.state-byte-identity.v1`,
`bfp.golden.swing-high.latest-coordinate-tie.v1`, `bfp.golden.swing-low.latest-coordinate-tie.v1`,
`bfp.golden.sample.same-no-advance.v1`, `bfp.golden.sample.equal-value-new-advance.v1`,
`bfp.golden.numeric.wide-fit-after-scale.v1`,
`bfp.golden.range-fraction.denominator-zero.v1`,
`bfp.golden.range-fraction.non-reduced-rational.v1`,
`bfp.golden.range-fraction.above-one.v1`, and `bfp.golden.range-fraction.low-above-high.v1`. The finite token sets
expand to literal IDs at publication; no
brace, token, or generator text enters catalog bytes. These literal state-byte-identity IDs exhaust primitive
numeric and OHLC failure goldens. Coordinate/receipt, ABI, build, and resource rejections occur outside primitive
evaluation and are required corpus oracles below, not additional catalog goldens.

Every stateful primitive declares exactly one update coordinate: the reaction trigger clock or one named input's
sample clock. The BFP also declares bounded strategy state such as holding status, add count, high-water mark, and
protection state, and it can produce only manifest-typed post-state plus existing `PositionIntentV1`,
`TargetVariantV1`, `ProtectionVariantV1`, target, and protection fields. The Host validates those bytes, seals the
proposal identity and order, and hands the proposal to the shared lifecycle kernel. Only that kernel interprets
`ENTER`, `ADD`, `REDUCE`, `EXIT`, `HOLD`, target position/weight, stop-loss, take-profit, trailing protection, and
fill reconciliation. A BFP/plugin can never emit an order, `Action::Submit`, Risk permit, Execution request, or
external effect.

Dynamic lifecycle choice is expressed only by one bounded whole-proposal decision table in canonical BFP meaning.
It contains a finite list of branches with unique explicit priorities and one mandatory default. Each priority is
one canonical little-endian `u16`; a smaller numeric value has precedence, branches canonicalize in ascending
priority order, and caller collection order has no authority. `max_decision_branches` is a nonzero `u16`, cannot
exceed 64, and bounds the branch count. On a `READY` invocation, predicates are evaluated in that order and the
first true branch is selected; the default is selected when none is true. Each branch and the default atomically
supply the complete lifecycle terminal tuple:
position action, target variant and every target scalar, protection variant and every protection scalar, and every
other required scalar output. A field may be a type-compatible DAG value or canonical constant, but no branch may
omit, inherit, or merge a field. Duplicate priority, missing default, partial tuple, more than one selected proposal,
or any encoding whose ordering cannot identify one whole proposal is `UNSUPPORTED` before execution. Later true
predicates after the unique first match do not create additional proposals. `WARMING` bypasses this table and uses
the complete HOLD/Keep/Keep/zero-scalar frame above.

All declared primitive and strategy state cells share one canonical plugin-state bundle. Empty pre-state is the
sole initialization encoding and means every cell's declared initial value. After any successful or `WARMING`
invocation, post-state is exactly the concatenation of every cell's complete canonical bytes, with cells sorted
lexically by `state_id` bytes and with no gap, alignment byte, or padding. A primitive cell uses that primitive's
existing canonical state bytes. A strategy-defined writable slot has one declared fixed width and its declared
maximum is exactly that width; only its owning node may write it. For a nonempty cell set, every post-state contains
the full concatenated width even when a cell is unchanged. A non-initial pre-state must have that same exact total
width. Wrong total size, a truncated or overlapping boundary, undeclared bytes, padding, a variable-width strategy
slot, or any other noncanonical cell boundary is `UNSUPPORTED` before execution and advances no state.

#### Sample-coordinate contract

Numeric equality is not sample identity. Before BFP V1 can be executable, Market Data must provide a
dependency-neutral, Owner-sealed `StrategyInputSampleCoordinateV1` for every component of an admitted event or
joined cut. Its canonical bytes are exactly 308 bytes in this order: schema `u16 = 1`, reserved-zero `u16`, input
role identity `[u8; 32]`, timeframe identity `[u8; 32]`, Owner event identity `[u8; 16]`, sample identity
`[u8; 32]`, logical time `u64`, event-effective time `u64`, Owner sequence `u64`, static binding receipt digest
`[u8; 32]`, dynamic canonical-row digest `[u8; 32]`, Source Binding lineage root `[u8; 32]`, lineage version `u64`,
Market Semantics identity `[u8; 32]`, and stable Owner sample-receipt digest `[u8; 32]`. Integers are little-endian;
reserved or trailing bytes are forbidden. Coordinate digest is SHA-256 over
`strategy.input.sample-coordinate.v1\0 || canonical bytes`. The Market Data event/joined-cut receipt cross-binds
that digest; the coordinate does not include the enclosing trigger receipt, so the same component sample carried
by later triggers remains byte-identical. `Owner event identity` here is the role-independent native sample-event
identity defined by Market Data, not the V1 frame-trigger event identity that binds the Design, role, and static
binding.

The Owner-native source of those unchanged 308 bytes is the additive Market Data `SampleFactV1` and
trigger-independent `SampleReceiptV1` contract. `TimeframeSpecV1` binds kind/step/unit together with anchor,
calendar, session, time-zone, label, and partial-bar identities and rules under
`market-data.timeframe.identity.v1`; `1d` is an exchange-session day and never
a UTC-duration day. `SampleFactV1` binds series/slot and predecessor topology, source snapshot/fact/batch,
instrument/channel/data-kind/field meaning/timeframe, Owner event and sequence, logical time plus the four
event-effective/provider-available/retrieval/correction-publication clocks, exact value semantic/bytes/scale,
canonical-row digest, and binding/lineage/frontier/master/universe/Market Semantics/correction evidence.
`fact_digest = SHA-256(market-data.sample-fact.v1\0 || fact_bytes)` and
`sample_identity = SHA-256(market-data.sample.identity.v1\0 || fact_digest)` are distinct from the existing BLAKE3
row digest.

The unchanged V1 binding timeframe string does not authorize that identity. Market Data alone supplies an
immutable `TimeframeProjectionReceiptV1` keyed by the exact V1 binding-receipt digest and carrying the full spec
bytes/identity plus its Owner evidence identities. Missing, conflicting, non-unique, or caller-parsed projection
fails before coordinate construction; later calendar or mapping changes cannot alter historical readback.

`SampleReceiptV1` carries the exact role-independent Owner fact projection. Its domain-separated SHA-256 stable
digest supplies the existing sample-receipt-digest field; neither the fact identity nor receipt digest depends on a
trigger, frame, join, consumer, Design, role, or static binding. The additive
`StrategyInputFrameEvidenceIdentityV2` additively identifies the exhaustive ordered V1 trigger/value evidence
without changing V1. `StrategyInputSampleProjectionReceiptV2` is the only V2 frame/join envelope; its closed
`FRAME|JOINED_CUT` kind, FRAME evidence identity or exact V1 JOINED_CUT receipt digest, and strictly role-sorted
fixed entries cross-bind each unchanged V1 binding/frame-evidence/trigger/value receipt to its
timeframe-projection receipt, native sample receipt, and exact 308-byte
coordinate. There are no separate V2 event/value/frame/join codecs. The envelope keeps the role-bound V1 trigger
identity separate from the role-independent native event identity. ProgramHostV2 and Backtest may receive only
that exact V2 projection and the referenced
native historical receipt. They cannot derive or repair either from the value, row digest, frame/event digest,
trigger time, latest head, or a local timeframe interpretation. A restart must resolve the same native receipt
bytes and, for the same role/binding, the same coordinate bytes.

**CURRENT/PARTIAL:** the retained JOINED_CUT slice implements that V2 structural projection and exact-digest
readback shape for EVENT components, and Native Replay preparation consumes it only together with the exact V1
joined-cut receipt and the complete Plan binding set. This does not make the future BFP coordinate port executable
and does not establish a Native Replay run, production startup, durable product composition, or Backtest closure.

**CURRENT/PARTIAL, request-bound Native Replay execution inputs:** the R&D Owner issues and persists one
immutable `NativeReplayExecutionInputBindingV1` for one exact sealed Exploratory Replay request. R&D's Develop capability
owns the pure structural validator and preparation boundary; it has no independent storage authority and cannot
mint, replace, or reinterpret any constituent Owner fact. The binding is a cross-Owner composition locator rather
than a new source of market, instrument, schedule, universe, or economic truth.

The canonical binding cross-binds the R&D request, TrialFamily, Artifact, Strategy Plan, Replay execution-profile
seals, and exactly these constituents in the canonical two-member order fixed by the Owner-sealed universe
selection: one exact Market Data V2 public Instrument Master cut/readback containing the two public facts; the two
exact Instrument Owner `InstrumentEconomicTermsFactV1` receipt/readback locators; one exact two-member
`StrategyInputUniverseFrameReceipt`; and the two exact Market Data BAR schedule cut/receipt readback locators. Each
member entry repeats the canonical member key, public instrument identity/digest, venue, account scope, schedule
identity, and every constituent locator/digest needed to prove equality. The binding stores locators and digests,
while the move-only typed readbacks retain their original Owner authority; it never copies private economic terms
into Market Data or turns a universe/schedule receipt into Instrument Master truth.

Before R&D commits the binding, R&D's Develop capability must consume all exact-locator Owner readbacks and prove: exactly
two distinct members and no extras; universe-member order and identities equal the Plan; each public fact equals
the Instrument Economic Terms public-fact reference; venue, account scope, currencies, half-open validity and event
time agree with the Replay profile; and each member's BAR timeframe equals its exact schedule readback. R&D then
atomically stores the canonical binding, deterministic receipt, and outbox under the already sealed request. Exact
request/binding-locator replay or response-loss recovery returns the same bytes with zero append. Any missing,
duplicate, reordered, latest-selected, caller-reconstructed, V1-to-V2-synthesized, cross-request, cross-member,
cross-venue, stale, tampered, or ACL-drifted constituent fails before binding, ProgramHost, Backtest, or result
state changes.

The initial-composition adapter derives the Market Data request from sealed values only. It takes the Replay PIT
snapshot identity/digest and window, the Plan's complete universe-role declarations and selection projection, and
the canonical Master V2 members. It maps only the closed Market Data semantic/channel/unit registries, preserves
the Plan's role identities, timeframes, and scales, and hands that bounded request to the fixed Owner resolver.
The returned universe frame and two schedule readbacks must equal the Plan selection and Master V2 member order
before they can enter the R&D binding issuer. There is no caller-supplied schedule locator or generic Owner-input
map in this path.

Native Replay preparation and Backtest consume only the R&D Owner's move-only binding readback and independently
re-resolve every embedded exact Owner locator before native materialization. A caller may supply the sealed Replay
request locator only; it cannot supply the constituent list, facts, values, symbols, ordering, resolver, store, or
fallback. The current slice implements the immutable PostgreSQL ledger, exact-locator recovery, typed Owner-readback
validator, atomic binding/receipt/outbox issuance, and the fixed initial universe/schedule resolution bridge. The
authenticated R&D service accepts only the complete sealed Replay locator: its issuance operation first has Market
Data issue the request-keyed Instrument Master V2 cut over the Universe Selection bound by the composition binding that
the request's sealed V3 record names, and refuses by name a request with no such record rather than choosing a
binding. That issuance commits in its own Market Data transaction, so an R&D failure after it is retried and reuses the
cut. The operation then resolves the sealed preparation, Composer Plan and Artifact, request-bound Instrument Master V2
cut, one same-account economic-terms fact per member, universe frame, and one BAR schedule per member before committing the binding through
one R&D transaction;
its read operation returns only an already issued binding projection. A separate consumer composition first reads
that durable binding, independently re-resolves the exact Composer, Instrument Master V2, economic, universe, and
schedule inputs, reproduces the stored binding byte-for-byte, and only then materializes the existing native
execution bundle. A sealed production R&D resolver now performs that reconstruction inside one
repeatable-read R&D transaction, derives attempt-bound runtime identities, and hands Backtest the move-only bundle
with the complete ordered 28-component observation package. R&D source records provide Research, TrialFamily and
Replay-authority bytes; accepted Composer custody provides Design, Plan and Artifact bytes; the independently
reproduced durable binding provides the remaining resolved-input evidence. The existing Backtest preparation Owner
accepts this sealed resolver directly and still performs its own request, component and execution-locator
reconciliation before entering ProgramHost. The materialization seals each frame through the Market Data V1 native
scheduling seal, which now takes the frame's Quotes from the frame's own quote cut rather than from the BAR's
one-instant batch; no proof has yet driven the materialization to completion on Owner custody.

**IMPLEMENTATION_ADMITTED / NOT_CUT_OVER, production Native Replay entry:** the authenticated R&D API's
`POST /v2/exploratory-replays` is admitted as a production route; its body carries only the exact sealed request
locator and attempt identity. It is not cut over. The handler, the execution service it calls and the router
registration are compiled under `native-replay-execution`, a production feature with no acceptance code that the
deployed image does not enable, so no deployed image serves this route today, and no request has ever reached it outside acceptance. What the execution service needs of the
Composer is ungated production code: its sealed read port is implemented by the production Composer,
`PostgresSourceResearchComposerProductionV2`, and that Composer's final-evidence port, `LockedOwnerEvidenceV2`,
locks and rereads the evidence for the locator it is given; no separate `PostgresDevelopComposerSealedReadPortV2`
exists or is needed. A build that enables `composer-v3-replay` and `native-replay-execution` carries them and no acceptance
code, which `scripts/ci/check-production-features.py` checks for whatever features the image builds. The feature
gate is therefore all that stands between this route and a build, and cutover is the deployed image carrying such a
build, which is a deployment decision. After cutover, startup
still exposes the execution capability only when `BACKTEST_OWNER_DATABASE_URL` admits the canonical Backtest Owner
principal and the Market Data scheduling capability is present. The handler returns only the exact persisted
canonical Result bytes after the coordinator acknowledges the Result, all 28 evidence envelopes and the semantic
trace; an unacknowledged submission remains unavailable. This admission grants no disposable PostgreSQL acceptance,
deployed or running service, production invocation, Paper/Live execution, or trading.

#### Execution input versioning and materialization

Multi-frame replay uses PIT window custody and derived per-frame views. The request binds window, decision
availability, canonical members, input roles, economic terms and execution policy. Custody contracts enforce
complete coverage, correction selection, no future data, identical-byte recovery and atomic binding/receipt/outbox.
Do not build a separate external snapshot-commit chain per frame, reinterpret V1, or fall back to test frames or
caller values when a source is missing. The existing single-frame V1, 28-component evidence and request/Result bytes
retain their meanings. Multi-frame Results bind the exact window and complete consumed inputs; old single-frame
evidence cannot prove them. An open-position run may have a valid Result but cannot claim round-trip closure.
Response-loss recovery reads committed results without re-execution.

Market Data issues every
BAR and Quote value at its canonical scale, so a close of 123.450 on a 0.001 tick arrives as 123.45. The Instrument
Master's tick is the venue's tick on the day it was retrieved, and a venue coarsens a tick as the price rises:
BTCUSDT's tick is 0.10 today, while its 2021-06-01 daily bar opened at 37244.36, and SOLUSDT's is 0.0100 while its
2021 prices carry three places. The bundle therefore first widens each member's price grid to the finest scale its
window's BAR and Quote prices show, when that is finer than the tick, with a one-unit increment at that scale, and its
census records, per member, the tick's precision, the data's precision, the instant of the first datum that set it,
and the precision the Replay runs at. The order grid is then the data's, not the venue's tick at the time, which the
Instrument Master does not hold. The Host keeps that sound as an invariant rather than an assumption: a position
order's price and every fill's price must lie on the member's data grid, or the run fails by name as
`ORDER_PRICE_OFF_THE_DATA_GRID` or `FILL_PRICE_OFF_THE_DATA_GRID`; a protective stop-market's trigger is the kernel's,
on the Replay's grid, and trades at the touch, which the fill check covers. Only prices widen: a size grid is what one
grid unit of position means. The bundle then re-expresses each price and size at its instrument's precision without
changing a value, and refuses by name a value finer than the instrument's grid. It then refuses, by name, any BAR or
Quote not at its instrument's precision: the engine would otherwise drop that datum silently and still complete the
run.

The bundle carries the window's settled funding by value: Market Data's `ReplayFundingScheduleV1` (market-data.md,
"window funding schedule read"), or nothing. Its census states which. A schedule must cover exactly the run's window
and members, or the bundle is refused by name as `FUNDING_SCHEDULE_WINDOW_NOT_THE_RUNS` or
`FUNDING_SCHEDULE_MEMBERS_NOT_THE_RUNS`, and its digest is then sealed into the census digest. A bundle without one
states `FUNDING_NOT_STATED`, and its census digest is the one it had before funding was carried. **Current:** both
consumer paths (the single-frame snapshot and the custody run) read the window's settled funding through Market
Data's admitted-read port before composing the bundle: no backfilled coverage for a member answers `None` and the
bundle states `FUNDING_NOT_STATED`, exactly as before this read existed; a window with coverage but a genuine
settlement gap inside it refuses the whole bundle by name rather than stating anything or filling the gap with a
zero rate. Since nothing backfills funding settlements in production yet, every production bundle still states
`FUNDING_NOT_STATED` today; a report must not read that as a run that paid no funding.

**TARGET / NOT_ADMITTED, BAR FRAME and JOINED_CUT composition:** the additive
`StrategyInputSampleProjectionV4` is the only projection that may compose BAR components across a complete
native join. It has closed `FRAME|JOINED_CUT` projection kinds and the closed `BAR` lifecycle; V2 EVENT/FRAME/
JOINED_CUT and V3 BAR/FRAME bytes, identities, semantics and resolvers remain unchanged. A V4 JOINED_CUT uses the
exact unchanged V1 joined-cut receipt digest as its subject. Its receipt identity also covers the exact canonical
schedule-dependency-set digest, and every V4 component must equal the corresponding Owner-resolved V3 BAR FRAME
component in every role, binding, frame, timeframe, sample, coordinate and schedule dependency field. No caller,
Composer or consumer may recanonicalize, narrow or substitute either set.

The first corpus is exactly six roles: one-minute OPEN, HIGH, LOW and CLOSE; one-hour CLOSE; and exchange-session
one-day CLOSE. One-minute CLOSE is the trigger. All four one-minute roles must resolve the same complete schedule
slot and observation batch. The one-hour and one-day components are the complete latest-closed samples not after
that trigger under their Owner schedules; the one-day component is an exchange-session day and never a UTC-day or
24-hour substitution. W3 may consume only the exact-locator V4 JOINED_CUT readback, never V2 or V3 as the joined
composition. Missing, partial, future, stale, duplicate, cross-batch, cross-slot, schedule-set, V1-subject or strict
component-equality failure rejects before Composer, Plan, Artifact, Host, Backtest or lifecycle mutation. This
target grants no production, deployment, runtime or trading authority.

Market Data resolves the exact historical timeframe-projection receipt for the sealed static binding and selects
and seals the coordinate from its verified census. R&D, the Host caller, Backtest, and the plugin cannot
mint, narrow, hash-substitute, or advance it. For one role, a replay joins only when all 308 bytes match. The same
role/timeframe/sample identity with different bytes is a conflict. A new sample requires unchanged static binding,
timeframe, lineage root and Market Semantics identity, a nondecreasing lineage version, a different sample identity,
and a strictly greater lexicographic `(logical_time, event_time, owner_sequence, event_identity, sample_identity)`
tuple. Cross-lineage coordinates are not comparable and fail closed. These equality and order rules, not numeric
value equality, decide state advancement.

The TARGET Design/Plan seam is the versioned source semantic
`strategy.value-ref.owner-sample-coordinate.v1(input_role_id)`. Every BFP input role, including the trigger role,
has exactly one value binding and exactly one coordinate binding. For each such role, the lowerer must create one
manifest input port whose literal semantic ID is
`strategy.input.sample-coordinate.v1.<role_identity_hex>`, where `role_identity_hex` is exactly the 64 lowercase
hex characters of that role's `[u8; 32]` identity. Uppercase, a non-64-length suffix, or a suffix unequal to the
bound role is noncanonical. The port has type `ValueTypeV2::Bytes` and exact `max_bytes = 308`. The canonical BFP
role-binding table is ordered by `(role_identity_bytes, kind_tag)`, where `kind_tag = 0` is the role's value binding
and `kind_tag = 1` is its coordinate binding; this order proves exact value-coordinate pairing and does not define
ABI wire order. The manifest input frame remains ordered only by canonical `PluginManifestV2.input_ports` order,
and every role-binding-table entry binds its exact manifest port ordinal. `StrategyPlanV2` binds the role, full
derived port ID, coordinate-source semantic ID, port ordinal, static binding, coordinate codec/digest rule, and
update clock. Plan may project that source only from the exact Owner-verified coordinate projection; neither Plan
nor Host may accept caller-provided or reconstructed coordinate bytes. Existing Designs without this tagged source
retain byte-identical V2 meaning.

A universe-member role uses the member counterparts of both bindings: `UniverseMemberInput` for its value and
`UniverseMemberSampleCoordinate` for its coordinate, each naming the member ordinal, under the same source semantic
and port ID rules. A bounded feature program emits a single-instrument proposal, so it reads a universe only when the
Owner universe has exactly one member, and only at ordinal 0. Its static binding for such a role is the Owner binding
of that role at that member. A universe of any other size is refused by name and is never bound to its first member.
The Plan's role-binding row carries the member ordinal, which an exact-instrument row omits so that its Plan bytes do
not change, and the Host resolves the coordinate at that role and ordinal. CURRENT_PARTIAL: the Design variant, the
Plan projection, BFP preparation and Host resolution are implemented and proven at unit level. No Owner projection
carries a universe frame's member coordinates yet. That projection is Market Data's universe-frame sample projection,
which is not yet specified, and until it exists the Host refuses a universe frame for a BFP Plan at input admission,
because the frame's coordinates are missing.

The one generic `ProgramHostV2` extends its existing Owner-event evidence adapter, not its graph opcode set or
runtime, to retain the Owner-verified projection's exact coordinate bytes and resolve that Plan-bound metadata
source. It rejects a coordinate not cross-bound by the admitted Market Data receipt, then copies those exact 308
Owner bytes into the coordinate port at its Plan-bound manifest ordinal. The guest receives no caller coordinate
and cannot request another role. This is the sole admitted transport; deriving a coordinate from the I128 value,
driver envelope, trigger count, local hash, or guest state is prohibited.

A trigger-clock node advances once for each newly admitted coordinate of the named trigger role. A sample-clock
node advances only when its named sample role receives a strictly new Owner-sealed sample coordinate. Each clock
therefore consumes the exact coordinate paired with its named role; no trigger coordinate stands in for another
role's sample coordinate. Repeating the same 1-hour sample across many 1-minute triggers must reuse the prior
sample-clock state without advancing it, even when other trigger values change. A newly sealed 1-hour sample must
advance exactly once even when its numeric OHLC values are identical to the preceding sample. Value comparison,
caller time, trigger count, arrival order, a narrowed R04 or event hash, and locally derived timestamps are not
valid substitutes. Missing, stale, duplicate-conflicting, cross-role, cross-timeframe, cross-lineage,
regressed-version, receipt-mismatched, or noncanonical coordinates fail before guest invocation or any BFP,
plugin, lifecycle, target, protection, trace, or checkpoint mutation.

An accepted correction is an immutable successor sample with exact series and correction predecessors. It creates
a new fact, receipt, identity, and coordinate and advances the sample clock exactly once; it never rewrites,
retroactively replaces, or replays the predecessor's state. An equal-valued ordinary successor also advances once.
The single V2 projection receipt cross-binds the exact sample identity, native receipt digest, and coordinate
digest while preserving every V1 byte and meaning. Repeated selection of one sample under
later triggers is byte-identical and does not advance again.

This TARGET remains architecture-contract maturity only. Canonical acceptance requires the existing disposable
PostgreSQL harness and repository-authoritative Makefile, pre-commit, and CI wiring to prove per-field mutation,
idempotency/conflict and correction topology, response loss/restart/rollback/historical readback, tamper and
cross-splice rejection, V1 preservation, and Owner-only ACLs. The consumer oracle covers repeated 1-hour and
exchange-session `1d` samples across 1-minute triggers, equal-valued successors, corrections, and byte-identical
native receipt recovery after restart. It does not establish provider authenticity, production migration or
deployment, Dashboard, Paper, Live, BFP executable maturity, or trading authority.

#### TARGET plugin failure-status compatibility

The named numeric terminal uses a compatible versioned extension of the existing manifest, wire, and
`ProgramHostV2`, not a plugin output, Host feature opcode, or second runtime. Existing ABI 2 manifests, frame bytes,
receipts, and the `strategy.plugin.failure.unsupported.v1` handling remain byte-for-byte authoritative. A BFP V1
plugin instead uses `PluginManifestV2.abi_version = 3` and
`failure_semantic_id = bfp.numeric.failure.no-state-change.v1`; the Plan, V3 build receipt,
`PluginImplementationReceiptV2`, module identity, and Artifact all bind both values. ABI 3 retains the canonical
port-entry layout, uses frame header ABI `u16 = 3`, and prefixes the manifest output values in every successful
output body with the canonical one-byte availability tag defined above; that byte is not a manifest port entry.
It otherwise changes only the invocation status map: nonnegative is the canonical output length, `-1` is
`NUMERIC_FAILURE_NO_STATE_CHANGE`, and every other negative value is an unsupported/unknown guest status.

On ABI 3 status `-1`, `ProgramHostV2` decodes no output, discards the scratch guest/BFP/kernel bundle, emits the
named terminal bound to the admitted event and plugin identity, and proves the pre-event checkpoint bytes and
digests are unchanged. An output frame cannot claim that terminal, and a status cannot carry post-state, intent,
target, protection, or effect bytes. ABI/version/failure-ID mismatch, an unknown status, a trap, or a status/output
length conflict fails closed through the existing generic unsupported boundary. No V2 row or receipt is rewritten,
reinterpreted, or promoted.

#### V3 build capsule and durable compatibility

`DevelopPluginBuildProducerV2` is CURRENT/PARTIAL and derives one fixed empty implementation from the manifest; it
cannot honestly carry variable BFP meaning. The TARGET producer therefore accepts a separately tagged V3 capsule,
never an unversioned mutation of V2. The canonical V3 capsule and build receipt bind the plugin semantic ID and
manifest digest; BFP canonical bytes/digest; exact first-party SDK and `vibe-indicators-kernel` catalog/source
digests; lowerer identity/source digest; compiler, linker, target sysroot, toolchain, target and build-profile
identities; fixed command/configuration; complete source-file set and digest; and declared source/Wasm, fuel,
memory, import, export, ABI, port, state and invocation bounds. Two fresh private builds must finish successfully
and produce byte-identical source and Wasm. The existing ABI/resource verifier then rejects every undeclared
import/export, start function, `memory.grow`, floating-point opcode, ABI/manifest mismatch, or resource excess.
This capsule and its two-build seal hold until retirement slice R2; the TARGET Artifact binds the canonical BFP
bytes and the interpreter identity instead, and slice R3 deletes the capsule producer (see the
[retirement plan](#bfp-host-interpretation-retirement-plan)).

`PluginImplementationReceiptV2` may continue to bind the resulting module and an opaque
`verified_build_receipt_digest`; it does not interpret or mint V3 authority. Composer durable custody must store
and reread an explicit `V2(existing canonical bytes) | V3(canonical bytes)` receipt tag, validate the selected
schema with its own decoder, and bind that tagged receipt digest into the Plan/Artifact path. Existing V2 rows and
digests remain byte-for-byte authoritative and readable; migration cannot rewrite, reinterpret, backfill, or
silently promote them to V3. A missing tag, unknown version, cross-tag replay, V2 bytes under a V3 tag, changed BFP
under the same build identity, or partial V3 coverage fails closed with no Plan or Artifact.

After the new corpus proves the sole BFP execution path (the Wasm path, and after slice R1 the host interpreter)
equivalent where legacy behavior is still admitted, `complex_strategy_ir`, `complex_strategy_program`, their
interpreter/compiler path, and the hand-written V1
complex programs must be deleted or retired as non-authoritative. Their floating-point semantics and raw
`Action::Submit` plumbing must not be translated, wrapped, or retained as BFP, SDK, primitive, Host, or migration
authority.

#### First future executable corpus and falsifiers

The first future executable corpus is immutable and precommitted. Its single `InputJoinV2` contains 1-minute raw
open/high/low/close price roles plus 1-hour-close and 1-day-close regime-source price roles. Every joined role has
the same fixed-I128 value type, price unit, and scale; the 1-minute-close role is the explicit trigger. No volume
role is part of this V1 corpus. On the 1-minute trigger clock it evaluates ATR, RSI, candle geometry, rolling
swings, and rational Fibonacci range fractions, whether as catalog primitives or as declared expressions
composed over the fused rational primitive. On the named 1-hour-close and 1-day-close sample clocks it updates
multi-timeframe regime state. The reaction consumes exactly that complete join role set. Bounded holding,
add-count, high-water and protection state drives a
continuous event sequence containing `ENTER -> ADD -> REDUCE -> EXIT` and explicit `HOLD`, with dynamic stop-loss,
take-profit and trailing-protection outputs. Every `READY` frame's `ProtectionVariantV1` is exactly one of the
variants already recognized by `ProgramHostV2`: `kernel.protection.keep.v1`, `kernel.protection.clear.v1`,
`kernel.protection.trailing-adjust.v1`, or `kernel.protection.replace.v1`. The Host reads protection scalar fields
only according to that exact variant, and the corpus exercises Keep, Clear, trailing adjustment, and Replace
without introducing a second protection interpretation.

Acceptance requires the canonical BFP to lower twice to byte-identical source, build twice to byte-identical Wasm
and tagged V3 receipt, pass Composer into the same `StrategyArtifactV2`, and execute through the real
`ProgramHostV2`/Backtest shared-kernel path. Complete repeated runs must produce byte-identical BFP, source, Wasm,
build receipt, Plan/Artifact identities, ordered semantic trace, checkpoint, fill, position, protection, cost, and
canonical Backtest result. Restoring a checkpoint at every declared state frontier must reproduce a byte-identical
suffix. From retirement slice R2 the source, Wasm and build clauses are replaced by the interpreted Artifact
identity, and every other clause applies unchanged to the interpreted path.

Byte identity holds within one fixed-point precision mode. The product runs at `FIXED_PRECISION` 16:
`vibe-strategy-factory` declares `high-precision` on its `vibe-model` dependency, so local, CI, Owner-chain and
production builds share it, and `scripts/ci/check-production-features.py` fails any production package that links
`vibe-model` without it. A fixed-point value converts to `f64` by one correct rounding in either mode, so the
canonical result does not depend on the mode; the representable range and what admission accepts do.

The corpus has negative oracles for unknown opcode/field/semantic ID; scale or unit mismatch; every checked
overflow and rounding boundary; missing, stale or cross-lineage binding/coordinate; same-sample duplicate; an
equal-valued new sample; duplicate/conflicting state advance; DAG/window/state/fuel/memory/source/Wasm exhaustion;
noncanonical bytes; build/source/Wasm inequality; ABI/import/export violation; floating-point presence; and any
raw-order output. It also covers a missing/duplicate/noncanonical golden ID or vector, an ABI 3 failure-semantic
mismatch, unknown negative status, status/output-length conflict, and a claimed numeric terminal carrying output
or post-state. Every negative case must terminate at its named boundary with no generated fallback and with
checkpoint, BFP/plugin/kernel state, target/protection, semantic trace, Plan, Artifact, and external effects
byte-identically unchanged or absent, as applicable.

Golden vectors must additionally pin both rounding modes at positive and negative half ties; every lag, rolling,
EMA, Wilder, ATR, RSI, gap, and swing warm-up frontier immediately before and at `READY`; flat-price RSI `50`;
zero-loss RSI `100`; zero-gain RSI `0`; first and later true range; OHLC rejection; latest-coordinate swing ties;
same-sample non-advance; equal-valued-new-sample advance; a calculation whose I128 intermediate would overflow but
whose I256 intermediate and final scaled result fit; I128 `MIN / -1`; representable invalid range fractions with
zero denominator, non-reduced rational, numerator above denominator, or low above high; and every
primitive failure class named by the closed state-byte-identity IDs above. Each such vector has byte-identical
pre/post state and checkpoint. Transport, receipt, ABI, build, and resource failure paths instead prove the same
no-change property through their distinct named corpus oracles. Publication fails if any required golden vector is
absent or differs across the two lowerings, two builds, complete reruns, or checkpoint-restored suffixes.

`InputJoinV2` version 1 has one admitted alignment semantic,
`strategy.input-join.latest-not-after-trigger.v1`. Research must declare a non-empty unique join ID, at least two
unique raw typed input-role IDs, one explicit trigger role from that exact set, and a positive finite
`max_staleness_ns` no greater than 31 days. Join-to-join edges (including cycles), duplicate/unknown roles, a role
shared by two joins, and incompatible fact class, scope, value type, unit or scale are `UNSUPPORTED`. Every joined
role is an exact-instrument Market Data Owner role with its own explicit instrument and timeframe; a reaction
consumes either the complete canonical role set or none of it. At admission, the trigger fixes the joined event
lifecycle and logical time. Every component must have the same lifecycle, be no later than the trigger, and have
`trigger_time - component_time <= max_staleness_ns`. Market Data computes the per-role latest-not-after argmax over
one complete verified PIT/correction census and frontier, then seals the trigger, exact Design/join/role set,
selected frame identities and digests, selection-basis/frontier digest, source/correction lineage, staleness proof,
Market Semantics identity and receipt digest in a non-`Deserialize`, no-public-constructor
`StrategyInputJoinedCutReceiptV1`. The Host accepts only that receipt, verifies its exact Plan projection and
Owner-canonical component order, and cannot select, substitute, reorder or infer frames; `SealedReplayInput` may
serve only as Owner-internal evidence basis. Missing, duplicate, stale, future, receipt/role/Plan mismatch,
cross-census or cross-Design splice, cross-lineage version regression,
same-root conflicting versions, or conflicting component/event identity fails before scratch execution or any
guest, state, target or checkpoint mutation. The join is canonical Plan data consumed by the one generic Host and
shared lifecycle kernel; it introduces no feature opcode, second interpreter, heuristic binding or raw-order path.

For continuous EVENT replay, R&D's Develop capability accepts only the additive move-only
`StrategyInputEventCorpusV1`. Its complete-set authority is the additive move-only Market Data
`StrategyInputEventSourceV1`, issued from Owner frames resolved against verified PIT batches; `SealedReplayInput`
V1 is not reinterpreted as multi-event authority. Preparation revalidates every retained joined cut and V2 projection against the exact
Plan binding set and validates the whole corpus digest before constructing a Host. One
`PreparedProgramHostHandoffV2` then transfers the complete corpus exactly once to one persistent Host consumer;
there is no lazy resolution, caller-selected event vector, or Host-per-event reconstruction. Omission, duplication,
noncanonical native order, BAR substitution, equal-valued cross-snapshot/batch substitution, or any
request/census/frontier/cut/projection/native-trigger splice
fails before Host construction, so no Host checkpoint can advance. The historical single-event preparation entry
point remains separately available and retains its existing behavior.

`StrategyArtifactV2` is one package containing the canonical `StrategyPlanV2` bytes and exactly one independently
built Wasm module for each plugin declared by that Plan. Modules cannot be shared between plugin declarations.
There is no generated outer or root strategy Wasm module: generic `ProgramHostV2` interprets the Plan graph,
invokes its plugin modules, and passes the resulting typed values to the shared lifecycle kernel, which alone owns
state transitions. Until retirement slice R2 this is the sole V2 execution path; the user-authorized TARGET
replaces each plugin's Wasm module with its canonical BFP bytes, evaluated by the host interpreter, which is then
the sole V2 execution path ([Host interpretation of the Bounded Feature
Program](#target-host-interpretation-of-the-bounded-feature-program)). V1 remains only a migration and equivalence
baseline, never an alternate V2 runtime.

For the exact two-member vertical, the selected instruments come only from an actual Market Data Owner-sealed
`StrategyInputUniverseSelectionReceipt` carried by the closed, non-fabricable sealed acceptance adapter; two otherwise valid singular input-binding receipts never create shared
universe authority. The adapter also carries the exact Owner binding identity for every declared role/member,
including its Research request, Strategy Design, role, and binding digests. Compilation requires those identities
to match the canonical Design, and the host requires every admitted frame value's role coordinate and binding
digest to equal the Plan projection; sharing a selection and role names cannot splice a frame from another Design.
The Plan projects the receipt's selection identity/digest, exact canonical member-key and
instrument pairs, Instrument Master digest, Source Binding lineage root, Market Semantics identity, and receipt
digest into its canonical lowering. Design roles explicitly distinguish compatible exact-instrument scope from
universe-member scope; the default exact-instrument scope remains omitted from schema-2 canonical JSON so Origin
Design and role identities do not drift. The current universe vertical declares OPEN and CLOSE once and graph references select only
an ordinal in the Owner-canonical member order; neither role nor guest supplies an instrument or selection identity.
Every BAR or EVENT reaction must consume one actual Owner-sealed
`StrategyInputUniverseFrameReceipt` whose selection exactly matches that Plan projection and whose canonical values
cover every required role/member coordinate for both distinct canonical instruments. A vector of singular event
frames is not a universe frame. Each BAR/EVENT graph has exactly one compute/target-producing node, so exactly one
plugin call returns a fixed-size canonical target set sorted by instrument key. The host rejects
missing, duplicate, unknown, reordered, out-of-range, mixed, or noncanonical members before either member kernel,
plugin/strategy state, target set, sequence, or checkpoint advances. The host seals selection, admitted-frame,
capability, program/artifact, state, and per-member lifecycle identities around that guest output; the guest and
caller cannot select those authorities. The opaque combination checkpoint contains both member kernels, their
pending targets/protection, the canonical target set, all host/plugin state, and the combination sequence, so
restore and exact replay reproduce the same suffix. This is one `ProgramHostV2`, not one host per instrument.
The current bounded Backtest adapter supplies a member coordinate only through its native
`ClientOrderId -> {instrument, intent identity}` binding and consumes an in-process Backtest account/instrument
snapshot under the restrictions above. No caller-selected fill coordinate or weight reconciliation is accepted.
The adapter alone seals the opaque reconciliation capability; `ProgramHostV2` accepts no free-form target-unit
array and commits a prepared value only when its in-process instance token and checkpoint frontier still match.
Execution/Paper/Live routing, external account truth, broader currency conversion, inverse/quanto instruments,
and cold-engine restoration remain unavailable.

The module ABI below holds until retirement slice R3 deletes the Wasm runtime.
Each plugin invocation uses a fresh or reset module instance. Guest memory and guest state are never retained
between invocations; plugin state is explicit, bounded, host-owned bytes carried in the canonical frames. A V2
plugin module has no imports or start function, cannot execute `memory.grow`, and exports exactly these six items
with no extras:

- `memory`;
- `strategy_factory_plugin_input_ptr_v2() -> i32` and
  `strategy_factory_plugin_input_capacity_v2() -> i32`;
- `strategy_factory_plugin_output_ptr_v2() -> i32` and
  `strategy_factory_plugin_output_capacity_v2() -> i32`; and
- `strategy_factory_plugin_invoke_v2(i32) -> i32`.

The input and output codecs each use a canonical 96-byte header. In byte order the fields are magic (`SFPI` for
input or `SFPO` for output), codec `u16 = 2`, ABI `u16 = 2`, canonical manifest digest `[u8; 32]`, module identity
`[u8; 32]`, host-derived invocation identity `[u8; 16]`, value count `u16`, reserved-zero `u16`, and body length
`u32`. The body contains entries in manifest order as ordinal `u16`, type `u8`, zero flags `u8`, length `u32`, and
payload bytes; plugin state uses ordinal `0xffff`. Scalars are exact-width little-endian and byte values remain
within their declared bounds. Unknown fields or types, trailing bytes, wrong order, duplicate or missing entries,
nonzero reserved/flags, width mismatch, and every other noncanonical encoding fail closed. Output may contain only
manifest-typed values and post-state. A plugin can never choose or return proposal identity, proposal order, an
order, or another effect. The host computes a domain-separated aggregate plugin-state-set digest over plugin state
bytes in Plan order.

Research owns the declaration of each input role and its intended experimental meaning; the fact Owner alone
binds that role to a consumable fact. The binding authority is fixed by fact class:

| Input fact class                                                         | Binding authority                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| hypothesis parameters, mechanism state and Research‑controlled constants | R&D                                                                                 |
| market, reference, instrument, universe and calendar facts               | Market Data                                                                         |
| order, fill, venue acceptance and execution readback facts               | Execution in Runtime; Backtest's Sim Exchange only in its isolated replay namespace |
| position, balance, exposure and account truth                            | Portfolio                                                                           |
| limits, decisions, Reservations and permits                              | Risk                                                                                |

The compiler verifies these typed receipts; it never transfers one Owner's authority to another or treats a
Backtest simulation fact as Runtime account, Execution or Risk truth.

For a Market Data input, the static `StrategyInputBindingReceipt` is the sole role/stream authority. Its
role-independent `selection_identity` binds field semantics, canonical instrument or stable universe scope,
channel, data kind, timeframe, unit, scale, Source Binding lineage root, correction-stream identity, and Market
Semantics identity. PIT request, snapshot, batch, exact frontier/version, time, sequence, row and value facts are
renewable event evidence and are excluded from the static digest. Runtime uses
one Owner-sealed event frame, not one lifecycle identity per field row. Market Data issues its trigger only while it
holds a verified multi-field observation batch whose selected rows share snapshot/fact/batch identity,
event-effective time, provider-available time, correction-publication time, non-zero correction sequence, and
event class. Every set of roles co-consumed by one reaction must also share one Source Binding lineage root,
correction stream, and Market Semantics identity as its frame anchor; separate reactions may use separate lineage
roots. The trigger preserves those identities and binds the sorted `(input-role identity, original binding
digest, selection identity, dynamic canonical-row digest)` set. Its deterministic projection is `BAR -> BAR` and
`QUOTE|TRADE|REFERENCE|ECONOMIC|SCALAR -> EVENT`; `logical_time` is
`max(provider_available, correction_publication)`, `event_time` is `event_effective`, and `owner_sequence` is the
correction sequence. `event_identity` is the first 16 bytes of BLAKE3 over the canonical domain
`VIBE_STRATEGY_INPUT_EVENT_FRAME_V1` and that complete frame projection.

The frame consumes the already sealed static receipts and re-resolves their rows against the current verified
batch; it does not clone static receipts into the frame. Each ordered per-role value receipt preserves the original `StrategyInputBindingReceipt` digest and role identity,
seals exact signed i128 little-endian bytes with an explicit fixed-value semantic, scale and canonical-row digest,
and cross-binds the trigger and observation-batch digest. An R&D-private adapter validates the trigger
once, validates only the Owner facts referenced by the current reaction against the Plan role/type and frame/as-of,
and derives the SDK envelope and order key directly from the sealed trigger. Its aggregate admitted-event digest
supplements rather than replaces every original Owner identity. There is no public caller envelope/value
constructor. The compiler rejects reaction/input combinations for which no admitted trigger and fact contract can
execute. The sealed Plan binding projection retains the Owner's exact `data_kind`: `BAR` facts may be referenced
only by `BAR` reactions, while `QUOTE|TRADE|REFERENCE|ECONOMIC|SCALAR` facts may be referenced only by `EVENT`
reactions. Market Data can issue only `BAR` and `EVENT`: Time/Scheduler is the sole future `TIMER` trigger Owner and
Execution is the sole future `FILL` trigger Owner, and positive admission for both remains unavailable until those
real contracts exist.

The shared lifecycle kernel alone orders and applies `START`, `BAR`, `EVENT`, `FILL`, `TIMER`, and `STOP`. Every
input is normalized into a versioned envelope with logical/event time, lifecycle-kind precedence in that declared
order, Owner sequence, and stable event identity as the final tie-break. That tuple is a total order: an exact
identity replay joins byte-identically, while conflicting bytes at the same identity or any missing ordering
coordinate fail closed. The host derives `envelope_digest` as SHA-256 of the domain
`strategy.lifecycle.envelope.v1\0` followed by the canonical 128-byte envelope with bytes `56..88` zeroed. It
derives `proposal_digest` as SHA-256 of the domain `strategy.lifecycle.proposal.v1\0` followed by the canonical
224-byte, fully host-sealed proposal with bytes `32..64` zeroed. A caller-provided nonzero digest is never
sufficient authority for either identity. A versioned checkpoint binds the Design, Plan, Artifact,
`ProgramHostV2`, kernel, plugin and Market Semantics identities; last consumed order key; strategy and plugin state;
target/protection state; and
order/fill reconciliation frontier. It also binds a deterministic root-keyed Source Binding version frontier:
versions are comparable only within the same lineage root, a same-root decrease fails before guest or state
mutation, and a lower version from a different root is not a downgrade. Restart resumes only from an exactly
matching opaque `ProgramCheckpointBundleV2` and produces the same subsequent semantic trace. Its canonical bytes
and digest remain content-addressing evidence, but caller-held bytes - even if re-digested - are not restore authority;
the Host verifies the bundle's privately stored digest before decoding.

Admission and evaluation are one failure-atomic boundary. The host performs admission or exact-replay join before
any guest invocation, clones the complete host and kernel state, evaluates plugins only for `BAR`, `EVENT`, or
`TIMER`, validates every plugin result, post-state, and fully host-sealed proposal, applies the proposal to the
cloned kernel, and proves a canonical checkpoint encode/decode round trip before one whole-bundle swap. `START`,
`FILL`, and `STOP` are kernel-only and never invoke a guest. Any fault leaves the checkpoint, consumed order,
host/plugin/kernel state, digests, and semantic trace byte-identically unchanged and emits zero semantic or
external effect.

The kernel, never a Design or plugin, owns these stable semantic primitives and their state transitions:

- `ENTER`, `ADD`, `REDUCE`, `EXIT`, `FLIP`, and `HOLD` position intent under `kernel.position.enter.v1`,
  `kernel.position.add.v1`, `kernel.position.reduce.v1`, `kernel.position.exit.v1`, `kernel.position.flip.v1`,
  and `kernel.position.hold.v1`. `FLIP` takes a held position through zero to the opposite side in one
  intent, filled as one order of the whole difference: the position must be non-zero and the target non-zero
  with the opposite sign, or it is `InvalidPositionTransition`. Its protection must be cleared or replaced,
  never kept, because the protection a position held guards the side it is leaving. Without it a strategy whose
  exit and opposite entry fall on one frame loses the entry: one proposal per member per frame can exit or
  enter, not both, and research T0's daily trend needs that on 11 of its 940 trades (1.2%). Its name is short
  on purpose: a Bounded Feature Program's lifecycle port is as wide as the longest identifier of its type,
  and `kernel.position.reverse.v1` would have widened it and re-identified every program. For the same reason it
  is not in a Plan's capability closure, which lists the kernel's primitives as they stood when the closure entered
  every Plan's identity; the Plan's constant check and the plugin wire admit it instead, and catalog version 5 lists
it, so a Bounded Feature Program frozen against version 5 may propose it;
- target position, target weight, and target rebalance under `kernel.target.position.v1`,
  `kernel.target.weight.v1`, and `kernel.target.rebalance.v1`;
- stop-loss, take-profit, and trailing-protection adjustment under `kernel.protection.stop-loss.v1`,
  `kernel.protection.take-profit.v1`, and `kernel.protection.trailing-adjust.v1`; and
- fill reconciliation under `kernel.fill.reconcile.v1`, including partial fill, rejection, cancellation and
  out-of-order readback handling.

A rebalance target's sequence is the Host's, not the program's. A program emits `0` on
`proposal.rebalance-sequence.v1` for a `kernel.target.rebalance.v1` target, and the Host assigns the sequence when it
decodes the proposal: on the target-set path, the sequence of the target set the proposal is lifted into, which the
lift requires each member to carry; on the single-instrument path, one more than the member kernel's current
rebalance sequence, which the kernel requires a rebalance to exceed. Both rules hold by construction, where a
program could only guess the one number that satisfies them on one frame. A program that emits any other value for
a rebalance target is refused by name as `REBALANCE_SEQUENCE_IS_HOST_ASSIGNED`; the port stays in the plugin ABI,
and no other target reads it.

Each primitive has a versioned semantic ID whose meaning is stable across Backtest and Runtime. The kernel turns
targets and protection transitions into semantic intent records; in Runtime, Risk remains the final admission
authority, Execution remains the order/fill/effect authority, and Portfolio remains the position/account truth.
Neither R&D, Backtest, the compiler, nor a plugin may bypass those Owners.

A custom plugin is the sole bounded escape hatch. It is a pure typed function over an allowlisted, versioned input
record and bounded private state, returning only an allowlisted typed value or state proposal. Its manifest fixes
ABI and semantic IDs, input/output/state schemas and byte limits, fuel, linear memory, invocation count and
deterministic failure behavior. It has no Owner read/write, network, filesystem, clock, randomness, subprocess,
secret, account, raw-order, Risk-permit, Execution-adapter, deployment or external-effect authority. A plugin
cannot add a core opcode or return an order; the plan may only feed its bounded output into kernel-owned
primitives. Exhausted or malformed plugins terminate with a structured unsupported result and zero strategy
effect for that event.

Compilation has only two non-positive semantic terminals. `UNSUPPORTED` names the exact schema coordinate,
missing/version-mismatched primitive or capability, plugin/resource bound, Owner binding, or runtime profile and
returns no Plan or Artifact. `NEEDS_RESEARCH_REFINEMENT` names an ambiguous or under-specified mechanism, input
role, timeframe, state transition, target, protection rule or falsifier that Research must freeze in a successor
Design; it likewise returns no Plan or Artifact. Neither terminal permits guessed bindings, generated fallback
code, a toy renderer, or a partial executable.

ComplexStrategy V1 canonicalization, bounds, frozen-Intent checks and exact Owner binding are migration inputs,
not a second permanent language. They must be absorbed into the V2 compiler and lowered through the sole
`StrategyArtifactV2`/`ProgramHostV2` path. After the frozen equivalence corpora prove byte-identical semantic traces
and canonical Backtest results in the product's precision mode, the duplicate V1 interpreter and toy renderer must be deleted. A third runtime,
sidecar interpreter, generated unrestricted strategy code path, or feature-specific core opcode is prohibited.

Acceptance uses three versioned, immutable corpora, each with positive, unsupported, malformed-binding,
resource-exhaustion and checkpoint/restart cases:

1. **Stateful trend:** entry, pyramiding, partial fills, stop-loss/take-profit and trailing-stop adjustments,
   timer action, reductions and exit.
1. **Cross-sectional rebalance:** typed universe roles, ranking, target weights, rebalance cadence, partial fills
   and deterministic residual reconciliation.
1. **Multi-leg, multi-timeframe regime:** exact leg and timeframe roles, joined event ordering, regime state,
   atomic target intent and fail-closed missing/stale leg input.

For every admitted corpus, repeated Backtest runs in the product's precision mode must produce byte-identical
Design/Plan/Artifact identities,
ordered semantic traces, checkpoints, fills, positions, costs and canonical results. The same normalized event
prefix must produce the same semantic trace in a later admitted Paper or Live Runtime up to the Risk/Execution
adapter boundary. Any divergence, heuristic binding, unsupported feature promoted to an opcode, plugin raw-order
attempt, or retained duplicate interpreter fails acceptance.

## TARGET / NOT_ADMITTED - TrialFamily-owned Replay execution policy V2

At TrialFamily formation, R&D must freeze exactly one canonical nested `replay_execution_policy_v2`. The permanent
family root, the policy, and the initial Census Frontier must cross-bind their identities and canonical digests so
that no later family member, Composer, Dashboard operation, Backtest adapter, or other caller can replace or reinterpret
the policy. This remains a target architecture contract; the current caller-authored `ReplayRequestDtoV2` path does
not satisfy it, and no current PostgreSQL or first-party acceptance is claimed.

The sole pre-formation source of those values is an R&D Owner-internal, sealed, versioned Replay Policy Catalog
fact; the catalog is neither a new Owner nor a second TrialFamily aggregate. Each immutable record contains a
unique, never-reused non-empty ASCII `catalog_record_id`, a unique, strictly increasing, never-reused unsigned
64-bit `catalog_version`, a non-empty versioned ASCII `policy_grammar_parser_id` that identifies the exact policy
schema, canonical grammar, and parser contract, its 32-byte `policy_grammar_parser_digest`, the complete canonical
`replay_execution_policy_v2` bytes, and
`policy_digest = SHA-256("rd.replay-execution-policy.v2\0" || policy_canonical_bytes)`. Its canonical record bytes
encode, in that fixed order, the ASCII record ID as `u32 length || bytes`, the version as little-endian `u64`, the
ASCII grammar/parser ID as `u32 length || bytes`, the 32 grammar/parser-digest bytes, the policy bytes as
`u32 length || bytes`, and the 32 policy-digest bytes; every length is little-endian. `catalog_record_digest` is
`SHA-256("rd.replay-policy-catalog-record.v2\0" || canonical_record_bytes)`.

The Catalog bootstrap is a dedicated opt-in, one-shot `authority-admin` composition, never an R&D API route,
Product Edge/Dashboard operation, default service, migration, or runtime selector. It uses only
`REPLAY_POLICY_CATALOG_ADMIN_DATABASE_URL` to invoke the fixed private write port. The Rust one-shot composition
verifies the deny-unknown-fields sealed V1 request before database access. PostgreSQL does not independently verify
Ed25519; it trusts the exclusive `replay_policy_catalog_admin_writer` principal as the authenticated broker mutation
boundary. That credential must never be distributed to operators, ordinary services, the Dashboard, or generic SQL
clients; possession or use outside the broker is a trust-boundary breach. The request is
Ed25519-signed and binds the schema version, bootstrap identity, administrator identity, separately trusted
verifier identity, Catalog record identity, complete canonical policy bytes, deterministic create and head-advance
command identities, event time, and signature. The composition verifies the exact schema, signature, trusted
verifier identity/key, bound identities, and canonical digests before any database access, then derives the
`authentication_fact_digest` from the verified evidence rather than accepting a caller- or credential-asserted
value.

The transaction locks and classifies the census of records/head/revocations/audits before acting: only exact
`0/0/0/0` may create version 1 and advance its head, and resolution requires exact `1/1/0/2` plus exact record,
head, and audit bytes. The genesis record must have no predecessor and its `created_by`/`created_at_epoch_ms` and
the head's `advanced_by`/`advanced_at_epoch_ms` must equal the signed administrator and event time. Every other
partial, extra, or provenance-mismatched shape conflicts unchanged. Exact identity
and byte-identical meaning reconstruct one deterministic typed Owner readback from the exact sealed request and
immutable audited record/head state. First success and exact response-loss or restart replay return that readback
byte-for-byte without a write; no attempt-local `CREATED`/`RESOLVED` field or execution-path marker may change its
bytes. Changed identity or meaning and orphaned, divergent, revoked, tampered, partially initialized, or
unauthenticated state conflict with zero record, head, revocation, or audit change. Each immutable audit fact is the
durable command receipt and this typed readback is the sole projection; there is no separate administration receipt
or outbox. No policy, identity, head, authentication fact, or success result may be inferred or synthesized.

`policy_canonical_bytes` are uniquely reproducible only under the exact schema/grammar/parser identity and digest
bound above. That contract defines one fixed field order; explicit integer widths and endianness; `u32`-length-
prefixed UTF-8, ASCII, and arbitrary byte strings as applicable; preserved list order where order is semantic; and
canonical key order wherever maps are admitted. Every integer uses its schema-declared fixed width and
little-endian encoding, variable-width integers are forbidden, and string lengths count encoded bytes. The
canonical encoder and parser reject duplicate keys, unknown fields, noncanonical encodings or map order, invalid
enum values or versions, length overflow, and trailing bytes; accepting then re-encoding any valid policy must
reproduce the input byte-for-byte.

Before the first TrialFamily-formation write, an R&D-private formation resolver in the same Owner transaction must
lock and reread the then-current, unrevoked catalog record, verify its identity, version, canonical bytes, policy
digest, grammar/parser identity and digest, record digest, currentness, and unrevoked status, and resolve no policy
field from anywhere else. The
permanent family root and initial Census Frontier both embed the complete policy bytes and policy digest and
cross-bind the `policy_grammar_parser_id`, `policy_grammar_parser_digest`, catalog record identity, version, and
digest. A caller, Dashboard operation, environment variable, deployment configuration, default, or later catalog record
cannot select, override, synthesize, backfill, or infer any field.

The nested policy owns every execution choice needed to compose the complete `ReplayRequestDtoV2` meaning:

- the runtime-kernel, simulator, cost, slippage, and capacity profile identities and versions;
- the runner operational profile, diagnostic policy, and deterministic seed;
- the admissible half-open replay range, and the calendar, session, and time-zone identities and versions; and
- the correction-rule and market-semantics identities and versions, corporate-action cut, historical-membership
  cut, and any other selection in the request that family policy, rather than an input Owner, owns.

A request's replay window is the window of the Market Data facts it is composed from, within the policy's
admissible range; today one frame, `[C, C+1)`, where `C` is the instant Market Data cut the family's snapshot. The
policy bounds the window and no caller supplies either; it cannot fix the window itself, because the family's
policy is sealed when the family forms, before any snapshot of it exists. A composed window outside the range is
refused by name, `FactsWindowOutsidePolicyRange`. A legacy exploratory request still carries the policy window
itself.

### TARGET / NOT_ADMITTED - Replay execution profile V1

The TrialFamily policy selects two separately sealed, content-addressed values: one economic replay configuration
and one runner operational profile. The economic seal fixes the first route to `EVENT`, one venue, Margin/Netting/L1,
the exact starting balance and common quote currency, exact leverage, deterministic full fill, disabled slippage,
latency and capacity models, and every native Sim Exchange behavioral switch. The operational seal fixes every
Backtest engine state, timeout, logging, instance, cache and subsystem field. Both use strict canonical codecs,
fixed-width integer or exact base-10 fixed-point values, closed model enums and no hidden default, floating-point,
environment or caller fallback.

**TARGET, user-authorized 2026-10-05:** the two seals stop mirroring the inherited configuration field by field.
Each seal becomes the canonical serialized bytes of the inherited `SimulatedVenueConfig` or `BacktestEngineConfig`,
with all fields present and no default filled in by a deserializer, plus their digest. A closed allow-list names
the few fields a TrialFamily may vary, and any other field differing from the pinned value is refused by name.
The rule "no hidden default, floating-point" is moved, not dropped:

- the canonical bytes state every field, so no default is hidden;
- a floating-point field, such as a fill probability or a liquidation ratio, is allowed only at its pinned value,
  which the bytes record exactly.

The census measured about 3.8 thousand non-test lines in the mirror (`replay_economic_configuration_v1`,
`replay_runner_operational_profile_v1`, and the binding and native profiles that translate it back). About 3.0 to
3.4 thousand of those go. The Instrument Owner terms check and the allow-list stay. Every seal digest changes
once, with the TrialFamily policies that bind them.

The permanent TrialFamily binding and the R&D-owned request binding both repeat the exact two seal digests and
cross-bind the same family identity and digest. Maker/taker fees and initial/maintenance margins are usable only
with a distinct non-forgeable Instrument Owner provenance value minted from its verified exact-locator readback.
That readback can be issued only by the Owner opened from the deployment configuration root
`INSTRUMENT_OWNER_DATABASE_URL`; the public boundary accepts no caller-selected pool, URL, expected store identity,
or expected digest. Missing configuration and a separately created PostgreSQL store fail before provenance exists.
The Owner also rejects any direct or role-derived effective access by a non-superuser login, including
membership in the Owner role or PostgreSQL whole-database read/write roles.
The private fact and atomic receipt bind public-fact identity/digest, venue, margin-account scope, half-open event
validity, source/provenance, revision, quote/fee currency, and every exact term byte. The first version accepts only
positive fixed initial/maintenance values, `STANDARD_NOTIONAL_RATE` or `FIRST_BRACKET_NOTIONAL_RATE`, and explicitly
selects `StandardMarginModel` (`notional * rate`, no leverage); it never infers `LeveragedMarginModel`. First-bracket
terms hold only up to their `margin_notional_cap`, which the binding records beside the rates and binds into the
terms digest. After the engine runs and before any result is sealed, the Sim EVENT consumer compares, at every
frame and for every member with a cap, the larger of the held and the derived target position, times the frame's
price, multiplier and size increment, with that cap, and refuses a run over it as
`ECONOMIC_TERMS_NOTIONAL_ABOVE_RECORDED_TIER`. Until a native run can commit a result other than `TERMINAL_RESULT`, the refusal ends
the run without a result; it then becomes an `INVALID_REPLAY_EVIDENCE` result under the `ReplayConfiguration`
diagnostic category. The visible economic
configuration cannot attest those values, and a missing value never becomes zero or a native default. Wrong fact,
receipt, terms, venue, account or time, and noncanonical, partial, extra, cross-spliced, tampered or ACL-drifted
custody fail before `ProgramHostV2` or Backtest state exists. Existing profile canonical bytes and digest remain
unchanged.

Which instrument's terms a Replay uses is resolved for its request, not pinned by its family. Schema 1 of the
economic configuration also pins one instrument's terms (`instrument_terms`: instrument, public fact and receipt
digests, fees and margins), and the profile binding then requires exactly one member to equal them. That rule arrived
with the sealed acceptance configuration in #468 and was not stated here before. Schema 1 stays readable, and keeps
its bytes and digest, for every family sealed under it. Schema 2 pins no instrument. It fixes only what holds across
instruments - venue, currencies, leverage, and the fill, fee and margin models - and each Replay's instrument terms are
the ones the Instrument Owner resolves for its members at its window's start when the execution-profile binding is
issued. The binding records their provenance: instrument, public fact digest, terms receipt, terms digest, fees and
margins. A consumer that resolves the terms again must meet exactly those facts, or it refuses. A fee change is
therefore a new terms fact rather than a new Catalog version. Schema 1 without pinned terms, or schema 2 with them, is
refused as `InstrumentTermsPinningMismatch`. Pinning no instrument does not loosen the venue: terms at a venue the
configuration does not name are refused before provenance exists, and the Instrument Owner resolves nothing for
members at another venue. The account scope is the one complete scope the Owner holds for every member; schema 2
does not pin a fee tier. Terms name their instrument by its canonical identity, which carries the venue
(`LINKUSDT-PERP.BINANCE`): the Instrument Owner resolves a Replay's member terms by that identity, and native
materialization compares it with the public fact's canonical identity and parses it as the native instrument id, whose
venue must be the configuration's. A symbol without its venue names no instrument.

Native engine materialization remains `UNAVAILABLE`. V1 represents liquidation only as disabled and supplies no
numeric ratio; an adapter must separately prove that the native float-only inactive liquidation field is not read,
or bind a version-specific inactive constant outside policy meaning. Before materialization, one version-bound,
fail-closed adapter must also prove every native identifier, currency/fixed-point, message-bus codec, time-origin,
rate-limit and deterministic instance-UUID conversion, and select exact native fill, fee and margin models without
host randomness or an implicit model default. These are explicit unavailable prerequisites rather than inferred
conversions from the sealed policy. The real non-test
`ProgramHostV2 -> BacktestEngine/Sim Exchange EVENT` consumer must also exist and produce actual-consumption
evidence before admission. This target does not claim a runnable RDQ loop, Native Replay, Backtest result, Paper,
Live, production or trading capability.

The TrialFamily's existing top-level cost-model, slippage-model, and capacity-model identities must equal the
corresponding nested model profiles exactly. A mismatch is unavailable, not an alternate representation. A legacy
TrialFamily without the sealed policy remains historically readable, but is ineligible and unavailable for Replay
V2 composition: there is no default, backfill, caller substitution, or inference from a newer family.

The Dashboard effect worker and every other Exploratory Replay caller may submit only the Artifact and TrialFamily identities plus
Owner-sealed Composer and Market Data locators and digests. Those values are evidence locators, not selection
authority; a replay-policy locator or value is not a caller input. The R&D Owner alone resolves the family-sealed
policy and composes the complete canonical Replay request; callers cannot supply or override runtime/model profiles,
replay window, calendar/session/time zone, deterministic seed,
diagnostic policy, correction rule, market semantics, or either historical cut.

Within the same `commit_v2` transaction, immediately before the first `INSERT`, R&D must lock and reread every
canonical Owner fact used by composition, including the Artifact-family binding, family root and current Census
Frontier, Composer facts, and Market Data cuts. For policy, composition uses only the complete canonical policy
bytes and digest, grammar/parser identity and digest, and catalog record identity, version, and digest permanently
sealed in the family; it never rereads the Catalog as authority. Missing, stale, digest-mismatched, cross-spliced,
or caller-overridden input rejects the operation with zero Replay request, receipt, outbox, or head change.
Backtest accepts only the resulting R&D-owned sealed request and owns only its result; it never creates a request
or selects execution policy.

A missing, stale, or revoked catalog record at formation, an identity/version/bytes/digest mismatch, a
catalog-to-family cross-splice, or any prohibited source reaching formation fails before mutation with zero family,
Replay request, receipt, outbox, or head writes. Once a family forms successfully, its embedded policy bytes and
digest, grammar/parser identity and digest, and catalog record identity, version, and digest are permanent. A later
catalog version, revocation, deletion, unreadability, or storage tamper neither replaces them nor makes that formed
family unavailable.

Replay composition validates only the family-sealed canonical policy bytes and digest under the sealed
grammar/parser identity and digest, plus the embedded catalog identity/version/digest cross-binding reconstructed
from those sealed values. It performs no Catalog authority lookup. An optional Catalog reread is audit-only and
cannot affect admissibility; later Catalog deletion, unreadability, revocation, or tamper cannot invalidate a formed
family. A family-internal canonical-bytes, digest, grammar/parser, or cross-binding mismatch makes Replay V2
unavailable with zero Replay request, receipt, outbox, or head writes. Formation and composition may not repair any
failure by selecting a default or newer catalog record.

This adds neither a second request aggregate nor a new Owner. It preserves
`StrategyDesignV2 -> StrategyPlanV2 -> StrategyArtifactV2 -> ProgramHostV2`, the existing R&D request identity and
custody, and response-loss recovery: exact `RESOLVE` may recover only the same pre-existing sealed request meaning
and may not compose a replacement, alter policy, or create a second request, receipt, outbox, or head. This target
is not admitted until implementation plus real disposable PostgreSQL Owner readback and end-to-end first-party
acceptance prove the complete composition and every zero-change rejection; it grants no production or trading
authority.

<a id="strategy-shape-envelope"></a>

<a id="target-host-interpretation-of-the-bounded-feature-program"></a>

## TARGET - Strategy shape envelope

Strategy shapes cover breakout/range, support/resistance, candles, indicators, multiple timeframes/instruments
and Fibonacci. Each shape compiles through JSON authoring into the same BFP/shared Host and produces a report over
a bounded multi-frame backtest. The first executable baseline remains single-instrument perpetual; extensions have
explicit dependencies and acceptance and admit no Paper/Live, production effect or second runtime.

Roles, members, window and timeframe have single declared authorities rather than repeated variant constants at
each producer/consumer boundary. Research scope owns members, Design owns roles and TrialFamily policy owns replay
range. Preparation and consumption verify those values instead of inventing them. Exact-identity reads must avoid
unrelated historical custody scans so one corrupt record cannot block every later independent request.

### Prerequisite slices

- **P0, one source for the shape tuple:** a Research request that states its scope carries the member set, the Design
  carries the role set (P1), and the TrialFamily's sealed replay policy carries the admissible replay range; every
  other surface derives them and declares none of them again. The run's actual window is derived from the Market
  Data facts composed within that range, never supplied beside it. Under a stated scope an exact instrument is a
  one-member universe, so a Design may not name an instrument: publishing, freezing or declaring one that does is
  refused as `DESIGN_ROLE_NAMES_INSTRUMENT_UNDER_RESEARCH_SCOPE`. Anything that differs by member count, such as
  Market Data's PIT request preimage domain, is derived from the count rather than declared beside it. P0 is
  complete when, for a Research request that states its scope, changing the member count changes only the scope and
  adding a role changes only the Design. It changes no admitted bound by itself. The Develop Composer's run request
  no longer restates the role set: it carries the Design and the plugin sources, and no binding claim beside them.
  The production frozen-program run admits the Design's roles by name instead - one input scope, Market prices under
  a field semantic Market Data defines, an instrument named exactly under an exact scope - and the custody each role
  reads stays the binding Owner's re-read. A V2 request states no scope and
  stays the legacy exact channel, whose Designs name their instrument; retiring it is a separate slice after T1,
  once every chain entry that creates exact custody under V2 has a scoped replacement.
- **P1, the role set comes from the Design:** the native Plan contract stops fixing OPEN and CLOSE on one day. The
  Design declares its roles, its execution role and its pricing role through fields it already has, the roles' field
  semantics and a join's trigger; no field is added. A universe role must be an `I128` Market Data BAR open, high,
  low, close or volume role, which the target-set Host checks against its native bar; any other is refused as
  `TargetSetRoleNotHostBindable`. The role that prices orders is the one reading the BAR close, and it is also the
  execution role: none is `ExecutionPricingRoleAbsent`, more than one is `ExecutionPricingRoleAmbiguous`, and a join
  triggered by any other role is `ExecutionRoleNotPricingRole`, which nothing constructs today because a join over
  universe roles is refused first. The Host reads its member roles and its pricing role from the Plan. A role's
  timeframe label stays provenance only, so the execution timeframe is not derived from it here: Market Data resolves
  the execution role's typed timeframe from its own binding and refuses more than one timeframe, or a day it cannot
  type, by name. That scheduling change replaces the label comparison in `native_replay_scheduling_v1` and is Market
  Data's. Market Data derives the execution role itself from the request's roles, by the same rule, so no caller names
  it; its refusals are `EXECUTION_ROLE_ABSENT`, `EXECUTION_ROLE_AMBIGUOUS`, `MORE_THAN_ONE_ROLE_TIMEFRAME` and
  `EXECUTION_TIMEFRAME_NOT_DECLARED` (Market Data owner page).
  **Fixed role scale, CURRENT:** every universe-member role, its price roles and its `VOLUME` role, reads at the
  fixed scale 9: Market Data's value scale, `MARKET_DATA_VALUE_SCALE_V1`, which is also its custody series scale, defined once there and referenced
  here, never restated. That
  holds for whatever instrument the Research scope names, so one Design is byte-identical across BTCUSDT, ETHUSDT,
  SOLUSDT and LINKUSDT, and authoring reads no Instrument Master precision. Scale 9 is a fixed-point convention the
  program reads at, not a second definition of precision: the Instrument Master's tick and step stay the only
  precision authority, and the execution bundle aligns the engine's data to them.
  - Market Data aligns each canonical row exactly to the role's scale and refuses a finer row by name (Market Data
    owner page).
  - **Current:** the single-threshold author takes its threshold as a decimal string, such as `"120"`. It converts
    the string exactly to the role's scale, through Market Data's exact rescale, and refuses a finer one as
    `THRESHOLD_FINER_THAN_CHANNEL_SCALE`, malformed text as `THRESHOLD_INVALID`, and a value that does not fit as
    `THRESHOLD_OVERFLOWS_CHANNEL_SCALE`. The Design stores the converted integer.
    - Equivalent spellings, `"120"` and `"120.000"`, author one program.
    - A request recovered from its program spells the threshold canonically, with no trailing fractional zero, so
      anything keyed by a canonical request names a threshold one way.
  - Why fixed and not derived: the PC-1 probe refused a BTCUSDT Replay at its universe declaration, because a
    canonical BTC price has scale 1 and the role required 2. A role scale taken from each instrument's tick would make
    a threshold mean 120.00 on ETHUSDT and 1200.0 on BTCUSDT, so one strategy would need a different Design per
    instrument.
- **P2, the report states every member:** the report family states each member of a universe run, generalizing the
  one-member statement Backtest already makes. It lands with I2, driven by the first run over more than one member:
  before I2 no program reads a member other than the first, so a statement of every member would have nothing to
  state.

### Time: PIT window custody

A PIT snapshot remains one instant, and the Market Data snapshot path, its seals, and the quote cut port that F uses
are unchanged. A multi-frame Backtest instead reads one **PIT window custody**, a new append-only Market Data
aggregate that holds backfilled history for the whole window once, and Market Data derives from it, frame by frame,
a one-instant view that satisfies the batch invariants the frame receipt already checks. The Market Data Owner page
states the custody contract. Multi-frame replay uses one committed window with derived frames, rather than a per-frame external snapshot and schedule commit.

- Each frame has two instants: `e_k`, the close of the execution-timeframe bar that defines it, and `d_k`, the
  instant its data becomes available under the availability rule declared on the Source Binding, with
  `d_k < e_{k+1}`. Frames are enumerated from the execution timeframe's Owner BAR schedule, never from custody rows,
  so a missing bar refuses its frame instead of skipping it.
- The last frame `N` has no later frame, so `e_{N+1}` is the next close that same schedule declares after `e_N`,
  one execution interval later, since only a fixed-interval execution timeframe is admitted. The window ends no
  earlier than `e_{N+1}`, so the last frame's quote cut has `(d_N, e_{N+1})` to fall in, as every other frame's does.
  A one-frame run is the case `N = 1`: a window ending at `e_1` plus one nanosecond leaves no instant strictly
  between the frame and its end, and no quote cut can be derived.
- The derived view's decision cut is `d_k`, never the custody's minting cut: every reader of a decision cut would
  otherwise see a later cut than the frame had. The view's order check is event ≤ available ≤ publication ≤ `d_k`.
- A multi-timeframe role (slice T2) resolves, at frame `k`, the bar its own timeframe's Owner schedule last closed
  before `d_k`, and exactly that bar; a gap refuses the frame. The binder relaxes its single-trigger check by source
  for custody views only: the trigger is the execution role's row, and every other role carries its own lifecycle
  coordinate with available ≤ `d_k`.
- In the fixed-universe branch, the member set is fixed for the whole run. A member whose Instrument Master validity or Universe membership begins or
  ends inside the window refuses the run by name as `WINDOW_MEMBER_NOT_VALID_THROUGHOUT`.
- A frame with no complete cross-section refuses the run as `PIT_WINDOW_FRAME_NOT_COVERED`, naming `e_k` and the
  blocker.
- Backtest result custody for a custody run binds the custody identity and the ordered view identities.

Window custody invariants and execution boundaries:

| Invariant                                                                                            | Window custody and execution contract                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A batch is one instant                                                                               | Each derived view is one instant at `e_k`; under T2 only roles other than the execution role align to their own last close                    |
| Row time order and one clock                                                                         | View rows: event ≤ available ≤ publication ≤ `d_k`; retrieval ≤ minting cut stays in custody evidence                                         |
| One member set, role set, Instrument Master cut, timeframe, venue, and account scope for every frame | Fixed‑universe branch: the member set is fixed and a member not valid throughout refuses the run                                              |
| No gap, no skipped frame, no frame list from the caller                                              | Frames enumerated from the execution timeframe's Owner schedule; a gap is `PIT_WINDOW_FRAME_NOT_COVERED`                                      |
| Latest visible correction, never the superseded version, ambiguous branches refused                  | Version selection per cross section at `d_k`; a branch refuses the frame                                                                      |
| Fill input binding                                                                                   | Current quote cut lies inside `(d_k, e_{k+1})`; target native bar execution freezes and verifies complete execution configuration             |
| An exact locator reread returns identical bytes                                                      | Custody is immutable after commit; view identities are recomputable                                                                           |
| A verified batch comes only from a committed snapshot                                                | A second sealed source, `CustodyView`, with its own `compile_fail` and tamper tests                                                           |
| Nothing from the future is visible                                                                   | The declared availability rule, version selection at `d_k`, and the binder's available ≤ `d_k`; the rule is a declaration, not an observation |
| Historical evidence scope                                                                            | One historical window mint; frozen per‑frame visibility/correction rules; live snapshot requirements remain                                   |

Backfilled history is minted once as window custody. Per-frame visibility derives from the frozen Source
Binding availability rule and correction frontier, only for historical backtests. Live trading still takes a
snapshot per instant and retains its real-time evidence requirement.

Slices: **T0** is the Market Data custody (cross-section correction model, availability rule, frame enumeration,
derived view, `CustodyView` seal); **T1** composes a single-timeframe N-frame Backtest from it; **T2** adds
multi-timeframe roles after P1; **T3** keys warm-up by role and emits neutral member targets during warm-up. Their
falsifiers are fixed now: N=1 and two single-timeframe frames must equal the snapshot path on the projection of
values, coordinates, event times, bar types, and member order; two custodies differing only in whether one
correction publishes before `d_k` must yield different frame `k` values, and removing the publication condition must
turn that red (Binance publishes no correction stream, so a synthetic source drives it); an availability rule set to
the minting instant must hide every frame; removing the available ≤ `d_k` check must turn the T2 look-ahead test red;
and the same higher-timeframe bar must carry byte-identical coordinates in adjacent frames.

### T1: a custody-run Replay commit and execution-input binding

**TARGET.** T0 (above) gives Market Data a chain of backfilled history and a per-frame derived
view; nothing yet commits a Replay request or an execution-input binding against a *run* over that
chain rather than a single PIT snapshot. T1 is exactly that seam, option **(A)**: the sealed Replay
commit and the execution-input binding each grow a custody branch beside their existing
single-frame one, so a Result over a custody run carries the same durable, independently
reproducible anchor the single-frame path already gives F - not a second, parallel contract.

- **Unaffected**: Composer (H5) and the composition binding (H6, the sealed Artifact/Plan a Replay
  request names) do not change. The custody-vs-snapshot choice is made at the Replay request, after
  a Design, Plan and Artifact already exist; nothing about producing those depends on how their
  data window will later be read.
- **The sealed Replay commit** (H7, `/v2/exploratory-replays`'s request) accepts, as an alternative
  to a single PIT snapshot identity, a PIT window custody chain root and a run window
  (`run_start_ns`, `run_end_ns_exclusive`) - the same `UntrustedPitWindowRunV1` shape T0's frames
  port already takes. A custody-run request never also names a PIT snapshot; the two are exclusive.
- **The custody path skips H4b** (the single-frame path's BAR-schedule mint): a custody run's
  schedule is already minted once, per member, as T0-4b's window schedule fact
  (`PitWindowScheduleFactV1`, market-data.md "window schedule fact") when the chain's root custody
  was committed. There is nothing left for H4b to mint.
- **The execution-input binding** (H8, `NativeReplayExecutionInputBindingV1`'s readback) gains a
  read-only accessor, `custody_run() -> Option<ReplayCustodyRunBindingV1>`; a snapshot-run binding
  returns `None`, unchanged. For a custody run:

  ```rust
  pub struct ReplayCustodyRunBindingV1 {
      pub chain_root: [u8; 32],
      pub head_identity: [u8; 32],
      pub run_start_ns: u64,
      pub run_end_ns_exclusive: u64,
  }
  ```

  `head_identity` is written once, at issuance: the issuer calls Market Data's
  `resolve_pit_window_frames_v1(run)` and records the `head_identity` the returned
  `PitWindowRunFramesV1` names. The binding pins that head; it is never advanced to a later one by
  the binding itself. Every later read under the binding - an idempotent retry, H8's readback, the
  consumer, a report readback - passes the pinned head back as the run's `head_identity`. The read
  then answers the frames that head held, however far a daily backfill has since moved the chain,
  rather than refusing once the head moves.
- **Per-member `InstrumentEconomicTermsFactV1`/receipt locators and the public Instrument Master
  cut stay shared between both data paths**, unchanged from the single-frame binding, verified and
  stored at issuance exactly as today - not deferred to the consumer. They are per-instrument, not
  per-data-path: a custody run needs the same fee/margin-tier terms a snapshot run does, and the
  Result's reproducibility requires knowing which version of them was in force at issuance, not
  only at read time. `ReplayCustodyRunBindingV1` therefore carries no economic-terms or
  Instrument-Master field of its own - it stays exactly the four fields above. Only
  `universe_frame_receipt` and each member's BAR-schedule cut/receipt are snapshot-specific and
  move to that branch; everything else, including the member identity and economic-terms
  locators, stays in the binding's shared part for both paths. The custody chain's own basis
  declares an Instrument Master cut of its own; issuance checks the binding's cut equals it, and
  the consumer checks the same equality again independently, refusing by name on mismatch. The
  consumer's `public_terms` input must be read from the binding's own stored, verified locators,
  never re-resolved independently; a test asserts that a `public_terms` value differing from the
  binding's is refused by name, not silently preferred.
- **The consumer side is "T1, the custody run's consumer" below** - re-resolution, the pinned-head
  check (`CUSTODY_HEAD_MOVED_SINCE_BINDING`), per-frame reads and `census().custody()` all live
  there, kept in one place so the two sides cannot drift into disagreeing descriptions.
- **Production gate**: a custody run cannot complete end-to-end in production until Lane 1's T0-6
  lands - T0-6 is the per-gap quote-cut derivation, not general availability/clock wiring.
  Production today refuses every gap as `QuoteCutMissing`, which a custody frame surfaces as
  `EventOrderUnavailable`, until T0-6 derives it. Until T0-6 lands, this is verified the same way
  F's single-frame chain entry already is - an injected quote-cut proof through the sealed-
  acceptance custody resolver (#1331) - and, per Lane 2's rule, that injected-proof run must be
  repeated once T0-6 lands before it counts as evidence of the production path; the injected proof
  is a stand-in for T0-6, not a substitute that outlives it.
- **Goal**: this lets the `backtest.run` orchestration's ordered-chain entry (`run_backtest_v1`,
  `crates/strategy_factory_rd_owner_api/src/backtest_run_v1.rs`, which today stops by name at
  `CustodyFramesNotAvailable`) extend, in place, from "frame parsed, no consumer yet" to a
  multi-frame run that produces a Result, a count and a report - the same chain entry, not a new
  one, per the standing rule that this entry grows as its dependencies land rather than being
  recreated each time.

**After H7/H8: executing the committed Replay (CURRENT_PARTIAL)**. Once H8 issues the custody-run
execution-input binding, `commit_custody_replay_v1` (`backtest_run_v1.rs`) calls
`execute_committed_replay_v1`, which reuses the SAME production execution path F's own
`POST /v2/exploratory-replays` route uses - `vibe_backtest_owner::native_replay::
run_exploratory_replay_v2(preparation_owner, result_owner, &locator, attempt_identity)` - rather
than a second one. `BacktestRunOwnersV1` gains `native_replay_execution: Option<Arc<
exploratory_replay::NativeReplayExecutionServiceV2>>` (gated `all(composer-v3-replay,
native-replay-execution)`, threaded through `backtest_run_routes.rs`/`server.rs` from the SAME
`NativeReplayExecutionServiceV2` instance the HTTP route already builds - two new `pub(crate)`
accessors, `preparation_owner()`/`result_owner()`, expose it without a second construction).
`attempt_identity` is `{run_id}-attempt-1` (backtest.run does not retry an attempt today, so there
is only ever one).

On `NativeReplayCommitDispositionV2::Committed`, `BacktestRunReachedReplayV1` gains
`replay_result_identity: Option<String>` - the committed Result's own identity, written into the
registered HTTP answer (`BacktestRunReachedReplayBodyV1`, `backtest_run_routes.rs`) alongside the
existing `custody_binding_issued` flag, so a report reads the Result to read bars and fills from.
On `SubmittedOrUnknown` or an execution error, `BacktestRunReplayUnavailableV1` gains
`ReplayExecutionFailed(result, cause)` - named, not silent; on a deployment that does not
configure `native_replay_execution`, `ReplayExecutionUnavailable(result)` stops the same way
`ComposerNotAvailable` does for H5. Neither state regresses `custody_binding` - H8's own binding
stays issued regardless of whether execution that follows succeeds.

**Not yet CI-proven, so not DONE**: per AGENTS.md, an Owner implementation is accepted when its
entries in the ordered Owner PostgreSQL chains pass on Linux CI - a local or `trade-rd-lane0`
deployment pass is a working state, not acceptance.
`backtest_run_chain_entry_acceptance.rs`'s ordered-chain entry still passes
`native_replay_execution: None`, so no CI run has ever driven an execution attempt through this
code; the chain proves H8's binding issuance only. **Still needed before this flips to DONE**:
wire a real `NativeReplayExecutionServiceV2` into that entry - it needs a Backtest Owner pool
plus the native Replay scheduling resolver and universe sample projections, none of which the
entry opens today - and actually execute the committed Replay once, over the ordered chain's
PostgreSQL. This is the next slice (Lane 5), after the report-assembly wiring that reads
`replay_result_identity` lands.

**H2/H4 for a custody run: the Design's universe binding must come from the chain's own basis
(TARGET; not built)**. `run_backtest_v1` admits every run's Design role-binding the same way
today, custody or not: it issues an initial PIT snapshot unconditionally
(`issue_research_initial_pit_v1`, needed regardless for Research goal admission - this stays, per
the bullet below), publishes the Design's role intent (`publish_design_role_intent`), then calls
`StrategyInputBindingAdmissionV1::admit_published_design(design_identity)`. That call's only
resolution path (`register_authenticated_design_roles_v1`,
`crates/data/src/owner/postgres/authenticated_design_registration_v1.rs`) resolves every
universe-member role against the ONE PIT batch snapshot the role intent's schema 2
`initial_pit_request` names (`resolve_role_snapshot_v1`) - there is no second path. A custody run
has no PIT snapshot of its own; what it has instead is the chain's own basis
(`PitWindowChainBasisV1`, already resolved once elsewhere in the same run via
`resolve_custody_run_v1`/the custody frames port), which names its own Universe Selection record,
Instrument Master cut and Market Semantics identity - a different, and for a disposable or
freshly-admitted chain, structurally never-equal record to whatever the initial PIT snapshot's
batch resolves. This is exactly what the ordered chain's `backtest_run_chain_entry_acceptance.rs`
entry demonstrates empirically: it commits a real custody chain, drives the full orchestration to
H8, and the execution-input binding's universe cross-check
(`CUSTODY_RUN_UNIVERSE_DIFFERS_FROM_DESIGN`,
`crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs`) refuses every time,
correctly - not because anything is broken, but because H2/H4 bound the Design to the initial PIT
snapshot's selection while H8 checks it against the chain's own.

**Ruling (10-05, Lane 3, cross-session)**: for a custody run, the Design's universe binding should
come from the chain's own basis selection, passed down by value, not from the initial PIT
snapshot's - consistent with the standing rule that modules call only downward and values cross
layers by value: read Market Data's chain once, then hand its resolved values down to the Design,
rather than letting the Design bind to one Market Data view (the PIT snapshot) while a different
Market Data view (the chain) gets checked against it later. Concretely, this needs:

- A custody-run counterpart to `admit_published_design` - e.g.
  `admit_published_design_over_custody_run(design_identity, run: &UntrustedPitWindowRunV1)` - that
  `run_backtest_v1` calls instead when `custody_run.is_some()` (it already resolves this value
  before admission runs today, just unused by admission). This belongs in `vibe_data`
  (`StrategyInputBindingAdmissionV1`'s implementation,
  `crates/data/src/owner/postgres/authenticated_design_registration_v1.rs` and neighbors) alongside
  the existing PIT-snapshot path, not bypassed from the R&D side - **Lane 2's to build**, following
  the same "only MD resolves members/frames/digests" boundary the module doc of
  `strategy_input_binding_admission_v1.rs` already states for the snapshot path.
- Internally, this resolves each role against the chain's own basis
  (`PitWindowChainBasisV1::universe_selection()`/`instrument_master_key()`/
  `market_semantics_identity()`/`members()`) instead of a PIT batch - a parallel to
  `resolve_role_snapshot_v1`, not a modification of it, since the snapshot path's callers and tests
  must keep behaving exactly as they do today.
- The initial PIT snapshot `run_backtest_v1` issues unconditionally keeps its OTHER job - Research
  goal admission (`submit_backtest_research_goal_v1`/`issue_research_initial_pit_v1`) - for both
  data paths; only the Design's universe-member role resolution moves off it for a custody run.
- Once this lands, `backtest_run_chain_entry_acceptance.rs`'s ordered-chain entry flips its
  assertion from the named refusal to `custody_binding.is_some()` - the one remaining piece of
  slice 3 (`docs: see lane5_handoff.md` for the current state), and Lane 4 reruns the full
  `trade-rd-lane0` window only after that, not before.

**T1, the custody run's consumer (TARGET; built in part).** This is the consumer side of the seam that "T1: a
custody-run Replay commit and execution-input binding" states. A custody run reaches the Sim through the same durable
anchors as a snapshot run, so its Result can be reread against the frames it read:

- The consumer re-resolves the run from the binding's `custody_run()`.
  - It enumerates the frames through Market Data's frames port and refuses the run as
    `CUSTODY_HEAD_MOVED_SINCE_BINDING` unless they come from the bound head. It never follows a newer head.
  - It reads each frame through the native Replay resolver's custody frame method, at that head and that frame's
    `e_k`.
  - It admits a frame only when its strategy inputs are the chain's derived view at that `e_k` and `d_k`, with member
    coordinates from the frame's own sample projection (`resolve_native_replay_custody_frames_v1`). Otherwise it
    refuses by name: `CUSTODY_REQUEST_NOT_THE_RUNS`, `CUSTODY_RUN_HAS_NO_FRAME`, `CUSTODY_FRAME_REFUSED`,
    `CUSTODY_VIEW_NOT_THE_FRAMES`, `CUSTODY_FRAME_COORDINATES_UNAVAILABLE`.
- **Current:** the execution bundle carries every frame by value (`new_from_custody_frames_v1`, which takes only the
  resolved frames). Its census pins the chain, the head and the ordered view identities, and they enter the census
  digest only for a custody run, so a snapshot run keeps its digest.
- Each gap's quote cut is Market Data's, derived from the first fill bar after `d_k` (T0-6), so a custody run fills
  on the quotes the frame readback states rather than on a quote R&D supplies.

### TARGET - Dynamic point-in-time universe

On 2026-10-05 the user admitted both fixed lists and a continuous portfolio replay whose members change under a
preregistered historical selection rule. This replaces the application of the whole-run fixed-member invariant
and `WINDOW_MEMBER_NOT_VALID_THROUGHOUT` refusal to *every* research scope; the original rule remains on fixed
scope. The measurement requiring this change is `research/ronnie/trend/books_pit.py` at
`0725a7b3f89902e27cd421a18b4b879a13268534`: B3 chooses up to 20 members each month using only earlier observations,
and 70 different symbols enter its 2018-2022 book. A whole-run fixed list cannot represent that experiment.

- **One scope owner.** R&D freezes either a `FIXED` member list or a `DYNAMIC` selection rule, never both. Dynamic
  scope names the selector/version, eligible venue and instrument class, listing-age rule, ranking inputs,
  rebalance schedule, tie-break, member cap, and treatment of selection gaps. Market Data derives each membership
  cut from facts available before the decision. The agent cannot supply the historical winner list.
- **No membership look-ahead.** Market Data binds the membership timeline to its historical custody and selection
  inputs. A strategy sees only its current eligible members and their permitted data, never future membership.
  Missing historical listings, delistings, or ranking inputs are unavailable, with no fallback to today's survivors.
- **Stable strategy state.** Member state is keyed by canonical instrument identity, not a reusable ordinal. A
  membership transition never resets equity, costs, a live simulated position, or an outstanding order. The same
  authoring semantics apply to each member; the versioned Design/Plan declares bounded dynamic membership and
  state capacity. Existing fixed-count Artifact bytes and replay identities remain unchanged.
- **Explicit exit behavior.** User default confirmed on 2026-10-06: selection exit prohibits new entries and cancels
  pending entry orders, while existing positions retain their original stop/target and other exit rules. For a
  partially filled entry, cancel only the unfilled remainder; retain/protect actual fills, including fills racing
  effective cancellation. Keep execution data, funding, attribution and risk state for retained positions until
  their lifecycle completes. Cancellation intent alone releases no commitment. Intent freezes this policy before
  outcomes; selection-driven liquidation is an explicitly registered alternative, never an implicit rebalance.
  Delisting has its own executable liquidation/settlement rule and provenance. Missing prices that can change the
  disposal outcome leave the replay unresolved; dropping the member or booking a zero return is forbidden.
- **One continuous portfolio.** Backtest consumes the sealed membership transitions and fills in event order with
  one account/equity path. All rebalance, cancellation, funding, and disposal costs enter the report. Splitting time
  into independent backtests that reset positions or capital does not satisfy this contract.
- **Measured bounds.** B3 requires at least 20 selected members, plus any excluded members still holding state under
  the exit policy. The provisional fixed-path bound of 16 cannot establish this example. The implementation slice
  measures graph, state, and retained-position pressure and publishes one capacity bound before it is admitted;
  arbitrary widening or silent truncation cannot substitute for that measurement.
- **Acceptance.** Reproduce B3's selector (month-start selection from prior data, at least 365 daily observations,
  trailing 30-observation median quote volume, top 20 with a deterministic tie-break) in one continuous exploratory
  book. Changing only future ranking data must not change earlier membership. Exercise listing, selector exit with
  pending orders and open holdings, delisting, unavailable disposal data, and session-restart readback. The source
  study's prices and returns do not substitute for the selected product venue's instrument and cost facts.

This target needs Market Data membership custody, versioned authoring/Plan support, and Backtest state continuity.
Those are bounded dependencies of this one story, not separate registries, a second simulator, or current
implementation evidence.

Membership timelines use a new contract version: Intent/Plan freeze selector, rebalance calendar/time zone, candidate
scope and capacity. Market Data appends immutable receipts for each decision cut, binding source versions,
event/availability cuts, ranking and membership changes. Replay binds the complete timeline identity/digest; each
strategy frame sees only the effective prefix. Missing membership facts remain unresolved. Legacy fixed requests and
single selection receipts do not acquire this meaning. Multiple Donchian subrules may share one portfolio Artifact
without becoming multiple running instances or duplicating account allocation; bounded subrule state/attribution
must still replay.

### Members: a parameter

Research scope is the only member-set source (P0), with a provisional upper bound of 16, fixed after I1.5
measures `max_edges`. On the fixed-universe path, a frozen program is valid only for its own member count; changed
members create new Research. Dynamic selection uses its separately registered PIT contract, never reinterprets a
fixed program. Each shape field is declared once at its responsible authority, not repeated as adapter constants.

- **I1** makes the bound one declaration and the target set bounded-variable, and deletes the Host's single-versus-
  members branch. Market Data keeps its one-member PIT request preimage domain, so stored one-member request
  identities are not rekeyed; the members domain carries two or more.
- **I1.5** measures the edge count of per-member expansion against the graph bound before the upper bound is fixed.
- **I2** gives the Bounded Feature Program a member dimension: index reference in the program, broadcast per member
  in the authoring language, and cross-member reductions (rank, mean, minimum, maximum, n-th) as appended catalog
  primitives. Rank is the average rank, so tied members share one rank and a permutation of members permutes their
  ranks; n-th returns the n-th order statistic's value, which no permutation changes. This changes a governed
  surface, and each of the four cheaper routes fails: a new field semantic value cannot, because a member axis is
  not a data meaning; a new catalog primitive cannot, because it acts on values already in the graph and creates no
  per-member port; a new action catalog entry cannot, because it still needs a terminal that emits target-set bytes;
  and a composition of existing nodes cannot, because no node has a target-set type. The change is an optional
  `member_ordinal` on the input meaning and one terminal that turns N member weights into a canonical target set.
  The encoder omits an absent `member_ordinal`, so every frozen meaning re-encodes to identical bytes and digest,
  which is I2's falsifier. The meaning schema version is unchanged and stays closed: a decoder from before I2
  refuses bytes carrying `member_ordinal`, as a frozen program is valid only for its own member count anyway.
- **I3** adds gross and net exposure caps as a Design legality constraint, not a Risk decision; an over-cap proposal
  is refused as `TARGET_SET_EXPOSURE_CAP_EXCEEDED`, which nothing constructs today because no member dimension exists.

The falsifiers: N one-member runs and one non-interacting N-member run agree on per-unit targets and fills (not
weights, which share one equity); permuting members leaves every reduction unchanged and permutes member targets,
including on inputs with ties.

### Values, inputs, and actions

- **Values:** catalog V4a appends window rank and percentile, bars since an extremum, and covariance and correlation.
  Catalog version 4 publishes the first two, and its first users, `w1` and `w2`, are in the authored corpus; a row a
  later version adds is refused by the build until an authored program uses it. Covariance and correlation need a
  two-series window state and remain TARGET.
  V4b appends natural logarithm and exponential. Their algorithm and golden vectors are pinned; only these new catalog rows are exempt from exact-expression single-final-rounding. V5 adds two
  fixed-slot state rules: a bucket array, and a memory of the last N events whose slots each hold a frozen set of
  values. Bollinger variance written as `Mean(x²) − Mean(x)²` must guard its radicand with `Select`,
  because the two terms round separately.
- **Inputs:** funding rate and open interest extend the existing Binance futures PIT source with appended row
  fields and field semantics (N1). The settled funding rows are in place (Market Data's "Binance perpetual settled
  funding rows"); open interest's rows and the field semantics a Design names are not. Binance's public archive holds history for mark, index, and premium klines,
  metrics, book depth, and funding rate. Liquidations have no admitted historical source - the USDⓈ-M archive holds
  none and the coin-margined `BTCUSD_PERP` snapshot ends on 2024-10-14 - so a Design that asks for them is refused as
  `INPUT_FACT_UNAVAILABLE_FROM_ADMITTED_SOURCE`, which no field vocabulary lets a Design reach today.
- **Actions:** a protective order that fills between frames is reconciled under `kernel.fill.reconcile.v1` (D1).
  Before D1 the target-set Host ignored such a fill, so the next frame's reconciliation failed and aborted the run.
  A FILL now names the leg it advances - the pending intent, the stop-loss, or the take-profit - in an envelope byte
  every earlier FILL left zero, so earlier envelopes keep their bytes and digests. The kernel admits a protective fill
  only while its leg is armed, nothing proposed is pending, and the fill reduces the position without passing zero,
  and refuses each other case by name: `ProtectiveLegNotArmed`, `ProtectiveFillWithPendingIntent`, and
  `ProtectiveFillDoesNotReduce`. A part-filled protective order holds the fill frontier until it fills or its rest is
  canceled, and no proposal may open an intent beside it (`ProtectiveFillInProgress`). A leg that closes the position
  clears the protection, and the Host places only the protection the kernel holds. The Native Replay readback reports
  protective fills apart from target-set fills, binds each to its FILL transition in the ordered trace, and counts
  it as a round-trip exit; a run in which none filled serializes as it did before.
  `a_triggered_stop_reconciles_the_member_flat_and_the_run_continues` runs two real Sim frames: the stop fills, the
  exit frame sees the member flat, and a program that exits it anyway is refused as `InvalidPositionTransition`; a
  close stop that does not fall and a fall that misses a far stop are its clean controls. A1 exposes `DecisionTime` and `AccountEquity` (and fill-based entry price and bars held) as
  `LifecycleContext` values the program may read, where `DecisionTime` is the frame's decision cut `d_k`; intended entry price and bars held are expressible inside the
  program already. A2 places take-profit as reduce-only limit orders. A3 first measures a one-limit-per-bar ladder
  and adds a kernel ladder only if that is not enough.
- **TARGET - intrabar protection.** A protective order placed by the kernel cannot yet serve a strategy across a
  multi-frame Replay. Two gaps must close before one may:
  - **The fill is invisible to the program.** A Bounded Feature Program reads no account or position, so after a
    protective fill its own record of the position it holds stays where it was. Its next exit then reaches a flat
    member and is refused as `InvalidPositionTransition`, which ends the run.
  - **There is no price path between frames.** The production economic configuration runs with
    `bar_execution = false`, and each gap between frames carries one fill quote (custody `FillBarOpen`). So a stop
    can trigger only when the next frame's quote crosses it, never on the bar's low inside the gap. A path needs the
    fill timeframe's quotes across the gap.

  The unit of a protective price lands with them: the Host would read it at Market Data's value scale and round it
  away from the market onto the Replay's price grid, under a new protection semantic ID. Today it is ticks at the
  instrument's precision, and that precision is the data's grid since a Replay widens it. [Resting entries, OCO
  exits and the intrabar path](#target-resting-entries-oco-exits-and-the-intrabar-path) is the design that closes
  all three. Until all three land:
  - the authoring language's first slice refuses a protection proposal at compile time as
    `PROTECTION_NOT_SUPPORTED_IN_SLICE_1`;
  - a stop is judged in the program at the frame's close and filled on the next frame
    (`AT_BAR_CLOSE_FILLED_NEXT_FRAME`), which is how research T0's ATR stop is reproduced.

<a id="target-resting-entries-oco-exits-and-the-intrabar-path"></a>

### TARGET - Resting entries, OCO exits and the intrabar path

The orders below are in the shape the [host interpretation of the Bounded Feature
Program](#target-host-interpretation-of-the-bounded-feature-program) leaves, so they add no Wasm ABI or guest
SDK change. A program reaches them only through new lifecycle-output semantic IDs, appended under catalog
versioning like the position flip. Native execution/cache owns order, fill and position facts. The shared
lifecycle adapter retains declarative intent, trade/leg linkage, consumed-event frontier and rule-transition
state; the target-set Host sends native commands and consumes their feedback. It does not mirror a second
authoritative order book or matching state machine. Existing identity, checkpoint and refusal constraints stay
in force through the versioned migration; native events alone determine what actually filled or expired.

**Native execution foundation.** Resting entries, protective orders and execution data extend native Nautilus.
The execution policy freezes complete native venue/engine configuration bytes and their digest, using a small
admitted field allowlist rather than a parallel configuration schema. Native bracket/OCO/trailing and bar execution
are the base; product-specific staged-exit rules must satisfy their actual quantity semantics.

- protection uses the inherited order machinery: bracket orders (`crates/common/src/factories/order.rs:1137`),
  supported OTO/OCO/OUO contingencies where their exact behavior fits, and native trailing stops
  (`crates/model/src/trailing.rs:24`). The default bracket uses OUO, not OCO; neither an unequal-quantity OUO nor
  all-exit OCO implements R-1s staged protection without an event-driven rule adapter;
- Replay runs with the engine's `bar_execution` enabled;
- the synthesized fill quote per gap between frames is deleted.

This moves the invariant "A BAR receipt alone cannot authorize a fill" (see the window-custody table above): a
fill is authorized by the engine's own bar execution over the gap's custody bars. The census that led to this
measured about 2-3 thousand non-test lines of quote-cut and fill-quote code standing in for `bar_execution`
(`native_replay_quote_cut_v2`, the fill-quote parts of native Replay scheduling, and `fill_quote_instants`). It also
found the Host hand-building protection as one stop-market, with trailing done by repeated `modify_order`
(`program_host_backtest_target_set_v2.rs`). **Every recorded Replay's outcome digests change**, because its fills
now come from the bar path rather than one quote; a recorded run is re-run, never reinterpreted.

The first consumer is research R-1u (role-reversal retest), the only research rule in its forward stage. Its
acceptance is a trade-by-trade comparison with its perpetual reference, separating registered product-policy
differences (including signal-frozen rather than fill-relative targets) from matching defects. It needs the three research
prerequisites listed in the [retirement plan](#bfp-host-interpretation-retirement-plan). R-1u itself has no
partial exit and no breakeven move. Those belong to its variant R-1s and are covered by A2 below, not added
here.

**What the product lacks today:**

- every entry is a GTC limit at the frame price;
- the Host places at most one stop;
- a take-profit leg is held in protection state but never placed;
- each gap between frames carries one synthesized fill quote instead of its bars;
- each member has one bar type.

The inherited engine already supports GTD expiry, bracket and OCO/OUO order lists, native trailing stops,
reduce-only quantity, modify, and bar execution. Closing the gap therefore means exposing what the engine already
has, not adding a simulator.

**1. Resting entries (limit, GTD, several at once).**

- *Arming.* A program arms an entry by emitting `kernel.entry.arm.v1` with these fields:
  - side;
  - limit price, at Market Data's value scale. The Host rounds it onto the instrument's price grid away from
    the market: down for a buy, up for a sell;
  - expiry, as a frozen elapsed duration or effective deadline from the decision cut `d_k`, independent of
    how many adaptive execution bars are visited;
  - protective stop price and take-profit price, absolute, at the same scale;
  - quantity, as today's target units or weight.
- *Bounds.* A member holds at most `max_resting_entries` armed entries. That is a manifest bound, part of the
  state bound. R-1u needs as many as one break per daily bar over a 10-day validity. Arming beyond the bound is
  refused by name as `RestingEntriesExhausted`.
- *Expiry.* Translate the frozen deadline to native GTD `expire_time`; native expiry feedback advances the
  lifecycle. Validate the observed effective time against the registered deadline and refuse discrepancies by
  name. No second expiry scheduler invents a terminal order fact or releases capacity before effective expiry.
- *Conditional invalidation (target added from the user's 2026-10-05 pending-order story).* Expiry is one
  invalidation condition. The versioned authoring successor must also express bounded predicates over closed
  candles, indicators, and price distance from the entry, including distance divided by ATR or another admitted
  volatility measure. Freeze the observation timeframe, predicate composition and priority, lookback, threshold,
  price reference, and whether volatility is captured at arming or recomputed at each decision. A condition may
  read the entry's stable identity, arming time and captured values, and sealed order/fill state; an intended
  position latch cannot substitute for actual fills. Evaluate conditions for actually pending entries through
  the shared rule adapter and send native cancellation commands. Signal eligibility is distinct from order state;
  a signal invalidated before submission cannot authorize a later order.
  A close-based condition becomes actionable only when that candle is available at the decision cut: it cannot
  cancel an earlier intrabar fill. Native event order decides fills before cancellation becomes effective;
  cancellation removes only the unfilled quantity and never erases prior fills or their protective exits.
  Within the smallest unresolved time unit, seal an explicit ordering policy or retain an unresolved outcome;
  do not choose whichever ordering improves returns. Terminal cancellation survives checkpoint restoration.
  Creating an entry and cancelling an identified entry are independent strategy actions. A later entry is a
  new order, not restoration of the cancelled order. Do not add product-specific recovery windows, retry
  counts, or automatic rearming switches inside signal strategies. New economic entries are new signal
  actions; operational recovery of a still-valid signal belongs to independently frozen Runtime/Execution
  policy, retaining signal/order lineage and existing no-blind-retry guarantees.
  Orders retain strategy/trial attribution; no previous-order link is mandatory for an ordinary new entry.
  A cancelled entry is never silently revived. Record predicate identity, observed inputs, decision/effective
  times, cancelled quantity, preceding fills and cancellation reason in the replay result.
  Current `AuthoringActionV1` exposes `Enter`, `Flip`, and `Exit`, without a pending-entry cancellation action;
  native Host cancellation for protection cleanup or run shutdown does not close this authoring path.
  Acceptance adds expiry, candle/indicator invalidation, volatility-distance invalidation, partial fills,
  fill/cancel ordering, invalidated signals and restoration cases to the same simulator.
- *R-1u slot policy.* One filled position per coin is a strategy-specific rule, not a product-wide OCO book or
  suspension/resubmission service. Preserve the source reference's first-fill/busy-slot outcome as a separately
  registered policy where comparison requires it. Native contingency semantics must be validated before using
  them to enforce exclusivity; automatic restoration of cancelled entries is not implied. A new economic order
  requires an independent valid create action under item 15. Matching follows the native chronological price
  path and matching priority; same-time new-intent admission ordering does not reorder already resting orders.

**Independent trades and shared resources (TARGET; user decision 2026-10-05, item 16).** Each independent entry
keeps a stable identity through partial fills and its own stop, staged exits and realized/unrealized trade result.
Two entries in the same instrument may coexist without cancelling or closing each other. An exit names its
trade and may reduce only that trade's remaining quantity; sibling exits resize to that quantity. Use the
inherited engine's position identities and supported virtual-position mapping instead of introducing a second
fill or accounting simulator. Position linkage must be part of the sealed order meaning and survive restore.
Portfolio owns account, valuation, exposure and capacity evidence; Risk owns shared commitment usage,
remaining headroom and admission, not the strategy or Portfolio. Per-trade attribution cannot duplicate
capital or conceal aggregate exposure. The research replay applies versioned accounting, capacity and Risk
policy semantics within the Backtest run; it cannot issue production Risk Decisions or Reservations.
See [research Owner boundaries](../scenarios/research.md#strategy-and-owner-boundaries).
pending entry orders reserve capacity at both strategy and shared-account levels under
the frozen margin/risk model. Partial fills transfer the corresponding amount to held-position usage; unfilled
quantity remains reserved. Cancel/expiry releases it only when effective; a request or unknown cancellation
cannot release headroom. Preserve native identities through restoration and avoid duplicate usage or release.
Required margin is distinct from full notional and from product risk commitment dimensions. The public Binance
account API exposes open-order initial margin separately from position initial margin; use historical terms
and the account model frozen for each replay, not current API values as historical evidence.
when an entry exceeds available capital, margin
or the frozen risk bound, reject it with a native reason and requested quantity; do not silently resize it or
queue automatic submission when capacity returns implicitly. Runtime/Execution owns refusal handling under
independent frozen execution policy; signal strategies implement no broker-error recovery. A permitted successor
uses the original still-valid signal only for safe operational recovery, with fresh Risk admission and existing
attempt rules. A definite resource refusal is terminal under item 27 and cannot be resubmitted when capacity
returns. Never hide quantity changes or fabricate a new economic signal. Admission reads the shared portfolio state at the applicable event cut, not a separate
full account for each trade. Distinguish resource rejection from native partial fills and admitted instrument
grid rounding; report requested, admitted and actually filled quantities. Acceptance includes competing entries
against one remaining allowance, preserved existing positions after refusal, and restoration without a hidden
retry. the versioned JSON authoring path admits quantity expressions for fixed units,
allocation from current portfolio equity, and risk allocation based on the entry/stop distance. The user's
2026-10-06 boundary correction locates these in an independent sizing configuration consumed by Runtime rather
than requiring account-aware sizing and error recovery inside each signal strategy. Jointly seal signal, sizing
and execution-policy meaning for replay/qualification without a second Owner or simulator. Compile them
through the existing typed expression path and evaluate against sealed market and actual portfolio state at
the declared decision cut; do not ask an external agent to recompute quantities for every simulated frame.
Seal the expression, units, equity/price/stop inputs and instrument rounding meaning, and report the evaluated
quantity separately from admitted and filled quantities. Refuse invalid dimensions, non-finite arithmetic,
zero denominators, unavailable required inputs and quantities below admitted instrument bounds. Quantity
calculation proposes requested quantity; it does not grant Risk permission, allocate Governance envelopes,
change Qualification bounds or imply hidden resizing. evaluate quantity when creating
the order and keep its admitted quantity fixed while pending. Equity changes do not trigger automatic
modification; changing quantity requires an explicit cancel and a new create action. Record the cancellation's
effective state before admitting the replacement so a still-live original cannot disappear from commitments.
The existing V1 `Enter.units` fixed
integer field alone does not establish this dynamic authoring capability. Acceptance covers equity changes,
different stop distances, rounding, unavailable state and resource refusal on the same execution path.
One-trade-per-instrument and entry exclusivity are explicit strategy
rules, as in R-1u, rather than universal kernel behavior. Existing target-set Host methods
`single_open_position_id` and `cached_position_native_quantity` require at most one native member position;
independent-trade support is a versioned extension, not a current capability. Acceptance drives two same-coin
entries with distinct stops, partial exits and cancellation, verifies that closing one preserves the other,
and reconciles their results to one portfolio including shared costs and resource constraints. R-1u acceptance
still reproduces its original slot rule. This target grants no Paper or Live execution route.

**2. Native protective orders and staged transitions.**

- *Declarative protective transitions (user item 28).* The authored signal/protection rules declare initial
  stops/targets, partial exit quantities and fill-triggered transitions once. The shared kernel drives them from
  actual fills; the signal strategy does not poll broker state or emit the same modification each bar. For R-1s,
  the stop-to-entry transition follows the registered completion condition for the first exit leg, not its
  submission, price touch or assumed completion after one partial fill. Seal the quantity basis and transition
  condition. Host/Execution owns native placement/modification and result feedback; remaining protective
  quantity follows this trade's actual open quantity and cannot close a sibling trade. Native reduce-only/contingency
  support and fill reconciliation are reused, not reimplemented as strategy-side API calls.
- *Entry completion when exits begin (user item 29).* On this trade's first actual exit fill, shared lifecycle
  handling cancels its still-open entry remainder; target touch/submission alone does not trigger this guard.
  Reuse native cancellation and fill feedback, preserve pending liabilities until cancellation is effective,
  and process racing entry fills as actual quantity requiring protection. Cancellation never blocks protective
  stop execution. This is shared execution behavior, not another strategy parameter or API management loop.
- *Fixed signal target (user item 30).* The first product R-1 variant freezes its target at signal generation
  from planned entry and initial stop. Better actual entry fills do not recalculate the target. Record planned
  R separately from actual fill-based risk/reward and costs. This intentionally differs from source R-1
  `replay.py`'s fill-relative target; it requires a named registered variant and new artifact meaning, preserving
  prior results. Reference acceptance must isolate this expected semantic difference from matching defects,
  rather than silently changing old reference trades or claiming exact original-policy reproduction.
- *Stop-to-entry reference (user item 31).* R-1s moves remaining protection to its actual average entry when
  the registered first-exit-leg fill condition completes. Seal the referenced fill frontier and average at
  that transition, and reuse native price-grid handling. Planned signal entry is not the stop reference, and
  fee compensation is not implicitly added. Keep item 30's fixed target unchanged and report actual stop
  fills/costs. Racing entry fills follow existing feedback semantics without changing recorded transitions.
- *Staged quantity rounding (user item 32).* Floor preceding exit legs to the instrument's sealed quantity
  step; the last receives remaining quantity. Report planned versus executable fractions and keep aggregate
  exits within actual trade quantity. Validate applicable point-in-time reduce-only terms. Invalid nonzero
  splits known before entry receive a named refusal, not hidden leg merging. If discovered after real partial
  fills, retain fills/protection and report the unsupported plan through established incident handling rather
  than pretending no position exists. Reuse shared handling and native quantity validation, not strategy code.
- Use the inherited order factory/commands for entry LIMIT, reduce-only STOP_MARKET and target LIMIT. A full-size
  bracket may reuse its native OTO/OUO relationships only after validating partial-entry release and protection
  quantities in this version. Factory metadata alone does not prove protection or live adapter support.
- Native trailing orders implement their supported trailing semantics. A discrete fill-conditioned stop move,
  such as R-1s stop-to-entry, uses native modify commands; it is not automatically a trailing-stop order.
- A2 reuses D1's ordered identity/fill reconciliation but extends its versioned partial-trade meaning where
  needed. A protective fill reduces this trade; only zero actual remaining quantity closes it and clears its
  protection. Completing a partial exit leg is not completing the trade.
- R-1s unequal staged quantities are maintained by the shared event-driven rule adapter using actual remaining
  position and per-leg progress. Native OCO cancels siblings on any fill; native OUO propagates the filling leg's
  remaining quantity, not the remaining trade quantity. Linking a half-size target to a full-size stop through
  those defaults can remove or undersize protection. Reuse native orders, fills, updates and reduce-only checks;
  do not implement a second matcher or presume the default bracket covers this case.
- A1's `LifecycleContext` (fill-based entry price, bars held) makes the fill visible to the program. That closes
  the first blocker under intrabar protection, so a program never proposes an exit for a member a protective fill
  already flattened.

**3. The intrabar path.** The gap between frame `k` and frame `k+1` is executed on that gap's bars by the engine's
own `bar_execution`, not on one synthesized quote. Market Data's PIT custody binds admitted bar windows;
availability of the actual run's finer bars must be verified or prepared, not assumed. The minimum admitted
resolution is one minute. User item 35 selects hierarchical refinement rather than executing
every interval at one minute; signal/decision clocks remain independent of matching resolution.

- *Execution policy.* A versioned adaptive policy refines the earlier draft
  `INTRABAR_EXECUTION_BAR_WITH_MINUTE_TIE_BREAK_V1`, enables native `bar_execution` and freezes its admitted
  resolution hierarchy. Existing sealed profiles keep their original meaning.
- *Hierarchical descent (user item 35).* Begin at the admitted coarse interval and descend through available
  custody timeframes, for example daily → four-hour → finer → one-minute, only where reachable orders/events
  cannot establish outcome order. This includes entry/stop/target, competing entries, activation/expiry,
  protection transitions, capital contention and funding boundaries when outcome-relevant. Refine unresolved
  subintervals recursively; replay child intervals in order against the same kernel/account state. Verify
  parent/child consistency and complete PIT coverage. Never commit parent hypothetical fills as well as child
  fills, and never create a second Host matching simulator. Target-before-entry is not an exit; entry-before-
  target may be. Decision cuts limit signal availability, including no pre-close execution of a close signal.
  Multi-member replay retains one global causal account timeline. Coarse handling is allowed only where
  unchanged account state and economic outcome can be proved. Trace selected resolutions/inferred timing.
- *Within one minute, the adverse leg first (user item 34).* When complete minute evidence reaches both an active stop and a target but cannot establish their order, fill the stop.
  Mark it as policy-inferred, report affected trades/counts and preserve the mark in charts. This does not
  admit missing-minute or invalid-input fallback. The historical R-1u reference forbids an entry-minute target
  and checks it from the next minute; the product instead honors established entry-before-target order and
  uses the conditional ambiguity policy below. The engine's bar path visits a bar's extremes in
  open-high-low-close or adaptive order instead. Reuse the native path only when it provably satisfies this
  admitted policy; otherwise add the smallest adverse-first option, bound in the policy row. Acceptance drives
  both levels in one minute and verifies the stop wins independently of OHLC visitation/iteration order.
  Measure source-reference differences separately; no ties in the historical sample does not prove the rule.
- *Entry/target ambiguity (user item 36).* When complete one-minute evidence cannot establish entry before
  target and reaches no stop, infer entry with continued holding and mark the policy; later minutes resume
  normal execution. Known effective-open/child ordering must be honored, not delayed by a blanket rule.
  Missing minute data is a preparation failure, not this fallback. See the research scenario's
  [data preparation contract](../scenarios/research.md#user-story-and-acceptance-target): signal inputs and
  independent execution hierarchy jointly define frozen dependencies; Market Data owns real finer data/
  aggregation, Backtest consumes bounded sealed slices. No synthetic minute path from daily OHLC, ad hoc fetch
  or silent input-identity replacement. Existing window custody and quote derivation do not prove adaptive
  matching or preparation orchestration is implemented.
  User item 37 requests economical base-data reuse and automatic bounded finer preparation. Binance's measured
  native-timeframe differences prohibit silent substitution by aggregated bars: the native-bar baseline reads
  required native signal timeframes; an explicitly derived series binds separate base/rule/source meaning. Freeze planning/rules/budget first; bind immutable prepared slices
  before resuming and seal the final consumed-data manifest. Never rewrite a sealed input/result or duplicate
  fills across preparation/resume. This is target architecture, not proof the current V1 route supports it.
- *Gap prices.* A limit or target crossed at the open fills at the open when that is better than its price. A stop
  crossed at the open fills at the open when that is worse than its price.

The cost stays bounded by admitted windows, hierarchy and resource caps. Resolved intervals stay coarse;
unresolved intervals read smaller custody bars. Historical R-1u used hourly execution with minute tie breaks;
the product policy generalizes refinement without asserting current native support or exact old-policy parity.

**4. Timeframes.**

- R-1u's zone, trend and arming are daily; source research used hourly execution. The product policy refines
  admitted coarse intervals as needed, independently of its daily signal clock.
- Read required native signal timeframes through Market Data's native-bar custody. Reuse DataEngine aggregation
  for explicitly derived series only, binding distinct source meaning, time alignment and visibility. Binance's
  measured native-timeframe disagreements rule out declaring universal native/derived equivalence. The current
  program interface does not prove arbitrary multi-timeframe consumption is connected; role/input admission is
  still required. Do not recreate generic aggregation inside each signal program. Internally aggregated signal
  bars are not automatically matching inputs; preserve native aggregation-source semantics and data provenance.
- R-1u's 60-day time exit is the existing `Exit` intent. The hourly reference counted 60 × 24 frames; the
  adaptive target must seal elapsed-time meaning anchored to simulated entry and cannot count whichever
  resolution is currently being visited as one equivalent holding bar.

**5. Members and measured implementation bounds.** Independent per-coin replay is useful for source-reference
diagnosis, not acceptance of shared-capital portfolio semantics. Product acceptance uses one continuous account
timeline, subject to the admitted `TARGET_SET_MAX_MEMBER_COUNT` or its measured versioned successor. Measure the
smallest native adapter and bounded state only after the primitive/consumer mapping; earlier line estimates for a
second resting-entry book or local descent are not an implementation plan. Keep state/resource refusals and old
sealed identities until the required versioned capabilities are admitted.

**Refusals stay in force until each piece lands.** The authoring language keeps refusing protection as
`PROTECTION_NOT_SUPPORTED_IN_SLICE_1`, and stops stay judged at the frame close and filled on the next frame.

### Coverage corpus

Every shape has at least one reference strategy, and each must compile through the authoring language and run to a
report over a multi-frame Backtest, proven by its chain entry's test name. The corpus and the slices each item needs:

| Shape                                 | Reference                                                                           | Needs              |
| ------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| Moving average crossover              | C1                                                                                  | P0, P1, T1         |
| Breakout with an ATR stop             | C2, chandelier stop                                                                 | P1, T1, D1         |
| Oversold reversal with a trend filter | C3                                                                                  | P1, T1             |
| Range quartering                      | Ronnie S3, 4h                                                                       | P1, T1, A1         |
| Support and resistance limit orders   | Ronnie S1, 4h structure, 1h execution                                               | P1, T2, A1, A2, V5 |
| Large body breakout                   | Ronnie S2b                                                                          | P1, T1, A1         |
| Fibonacci layered entries             | Ronnie S4                                                                           | P1, T1, V4a, A3    |
| Counter trend short at a key level    | Ronnie S5                                                                           | P1, T1, D1, A1     |
| Bollinger state filter                | Ronnie F1(c), with a `Select` radicand guard                                        | P1, T1             |
| Weekly momentum                       | Ronnie F2, weekly signal, daily execution                                           | T2                 |
| Independent instruments               | F2 on BTC and ETH                                                                   | I1                 |
| Cross instrument condition            | BTC trend filtering ETH                                                             | I2                 |
| Pair spread                           | BTC and ETH z score                                                                 | I2, V4a            |
| Cross sectional rotation              | Top two of eight by momentum                                                        | I2, I3             |
| Funding rate filter                   | Extreme funding reversal                                                            | N1                 |
| Momentum divergence                   | Price against RSI or the MACD histogram at two confirmed pivots                     | P1, T1             |
| Rising and falling wedges             | Lines through the two latest confirmed pivot highs and lows                         | P1, T1             |
| Three and five pushes                 | A push count over confirmed pivots with a holding structure                         | P1, T1             |
| Fair value gap                        | A gap across three bars held in fixed slots until a later bar trades into it        | P1, T1             |
| Liquidity sweep                       | A wick through a confirmed pivot with a close back on its near side                 | P1, T1             |
| Change in state of delivery           | A close through the open of the first bar of the opposing run                       | P1, T1             |
| Ronnie's drawing rules R1 to R6       | Horizontal and wide bands, trend line bands, Fibonacci, quartering, timeframe roles | See below          |

Ronnie's drawing rules were measured from 2,512 screenshots across 17 of his videos and reduced to six computable
rules. They need these slices:

- **R1 and R2, horizontal and wide bands:** P1, T1, and V5's memory of the last N reactions, where each slot keeps
  one swing point's wick extreme and nearest body edge; clustering, the outer and inner edges, and the thickness
  clip are reductions over those slots, and ATR is expressible today. An order-k swing point is a lag plus a
  centered window maximum or minimum.
- **R3, trend line bands:** P1, V4a's bars since an anchor, and the authoring language's `capture` and `latch` to
  move an anchor on an event. The line's value is the anchors' linear extrapolation with one final rounding; trading
  needs the value, not a drawn coordinate.
- **R4, Fibonacci:** P1, V4a to require the high after the low, and `capture`; levels are frozen rationals, and
  Ronnie's 0.764 is 191/250.
- **R5, quartering:** arithmetic over the inner edges of the R1 or R2 bands above and below.
- **R6, timeframe roles:** T2 over daily direction, 4h structure, and 1h execution, with A1 sizing and V5 bands;
  it is T2's acceptance example.

Compiling is not enough for these rules. Each of R1 to R6 carries a behavioral positive control on real data: the
program runs over the public K-lines of the instrument, venue, timeframe, and window each measured frame shows, and
the band edges, line values, and Fibonacci levels it computes must match the prices measured from those frames
within the measurement's own error - about one dollar per edge, 0.9% of a band's thickness, where a frame printed
its own prices, and two pixels at that frame's price scale elsewhere. The control has two halves so that a miss has
one cause: the program's output must equal a direct reference computation of the same rule exactly, which tests the
compiled program, and that reference must match the measured prices within the tolerance, which tests the rule and
the parameters the measurement filled in rather than observed. It becomes constructible only after T1 and V5.

Momentum divergence, wedges, and three or five pushes rest on one building block, a confirmed pivot, and need no
slice beyond P1 and T1:

- **Confirmed pivot:** an order-k pivot high at bar `t - k` is confirmed at bar `t` exactly when `Lag(high, k)`
  equals `Maximum(high, 2k + 1)`, and a pivot low likewise with `Minimum` over the low. The catalog's `SwingHigh` is
  the highest bar of a trailing window, so a bar that is still rising qualifies; it is not a pivot. A pivot is known
  k bars late, and that lag is the definition, not a limit of the implementation.
- **Divergence:** bearish when a newly confirmed pivot high is strictly above the previous one while the indicator
  at the new pivot, `Lag(indicator, k)`, is strictly below its value at the previous pivot; bullish is the mirror
  over lows. The signal is emitted at the confirmation bar. The previous pivot's price and indicator are two
  fixed-point strategy state cells. `d1`, a bearish divergence on the daily close with RSI(3), is the first authored
  program to declare them: `a_divergence_program_carries_its_previous_pivot_through_fixed_point_state` builds it as
  Wasm and it exits only two bars after its second pivot, and putting the two cells back to their zero seeds before
  every bar removes that exit while the pivots are still found.
- **Wedge:** lines through the two latest confirmed pivot highs and the two latest pivot lows. It is rising when both
  slopes are positive and the lower line is steeper, falling in the mirror case, and it declares a convergence ratio
  and a breakout tolerance in ATR. A line's value at the current bar is `p2 + (p2 - p1) * a / b`, where `a` is the
  bars since the later anchor and `b` the bars between the anchors; the subtraction, product, and sum are exact at
  their declared scales, so the division is the one rounding. Lines through three or more pivots need V5's memory
  and round once per node, which the definition must declare.
- **Pushes:** the count rises at each newly confirmed pivot high strictly above the previous push while the pivot low
  between them stays strictly above the one before, and restarts otherwise; three strategy state cells hold it.
  Pushes read on 4h with entries on 1h are T2.

Each has a synthetic control that fixes its signal bar exactly - a divergence at the pivot plus k and never earlier,
no wedge from a parallel channel, a count that restarts at a structure break - and a real-data control: over public
BTC K-lines, the program's pivots and signals must equal an independent reference implementation of the definition
exactly. No human-labelled ground truth exists for these three patterns, so what's checked is the program against
its definition, not the program against the trader.

Three ICT patterns - fair value gap, liquidity sweep, and change in state of delivery - need no slice beyond P1 and
T1 either:

- **Fair value gap:** bullish at bar `t` when the low is strictly above `Lag(high, 2)`, the gap being the interval
  between them, and bearish in the mirror case. A gap stays open until a later bar trades into it, which is the
  signal, and is then cleared. Each open gap takes three fixed-point strategy state cells - its upper edge, its
  lower edge, and whether it is open - and the program declares how many gaps it holds and that a new gap, when
  every slot is open, replaces the oldest. V5's memory of the last N events is that rule as one declaration;
  written out with `Select` today, the gap does not wait for V5. `g2` and `g3`, one bullish gap program with two
  and three slots, are the second authored programs after `d1` whose state is proven through Wasm:
  `a_fair_value_gap_program_evicts_the_oldest_gap_only_when_its_slots_are_full` forms three gaps, and with two slots
  the third evicts the first, so a later bar trading into the first gap's interval emits nothing, while the same
  bars with three slots emit the signal.
- **Liquidity sweep:** bearish at bar `t` when the high is strictly above the latest confirmed pivot high and the
  close is strictly below it, and bullish in the mirror case over lows; the pivot is one state cell. A bar's high
  and close do not say when inside the bar the level was crossed, so the signal is at the sweep bar's close;
  entering at the moment of the sweep needs T2's lower timeframe or quotes. A pivot is known k bars late, so a sweep
  of a pivot not yet confirmed is not seen.
- **Change in state of delivery:** a run is consecutive bars that close on one side of their open. Bullish at bar
  `t` when, after a bearish run of at least a declared length, the close is strictly above the open of the run's
  first bar, and bearish in the mirror case. A counter and that first open are two state cells, the open captured
  when the counter leaves zero; it is the same kind of structure as the push count.

Their controls take the form above: a synthetic control fixes the signal bar - a gap no bar trades into emits
nothing, a wick through a pivot without a close back emits no sweep, and a close equal to the run's first open
emits no change - and a real-data control holds the program to an independent reference implementation over public
BTC K-lines.

Two parts of the ICT method are not these shapes. A session window (killzone) cannot be expressed today: no input
fact is a time of day, and no catalog row turns a sample coordinate, which carries the sample's time, into one. Its
route is an appended catalog row that reads the UTC hour and minute from a sample coordinate, which takes a catalog
version and kernel, golden, and lowerer changes; the V3 build capsule binds the catalog and lowerer source digests,
so every program built after it carries a new build identity. A window stated in New York time moves by one UTC hour
at each daylight saving change, which that row does not represent, so a Design declares the UTC window it means.
Composing a higher-timeframe gap with a lower-timeframe change in state of delivery is T2.

### What the envelope assumes of F

The envelope adds no production path of its own: every slice runs a Backtest through the path F's acceptance
establishes. That path's first-generation Replay binds the family formation frontier, as the legacy path does, because
a family forms before any attempt and an attempt is a Replay that has already produced a Result. A first-generation
Replay therefore needs no attempt cut and no R&D Decision composition, and every corpus item above is a
first-generation run. A successor Replay - a later research round of the same family - reads the TrialFamily Census V2,
which needs an attempt cut whose only writer waits for the Decision composition consumer; successors remain
`TARGET / NOT_ADMITTED` in the R&D Owner, and the envelope neither needs nor builds them. An acceptance that iterates
one family would depend on that producer and would be listed separately.

### Extension dependency order

P0, P1, and T0 proceed in parallel: T0 is internal to Market Data, and its custody request states its own member set
and timeframes. T1 depends on all three, because it derives the custody request from the Research scope and the
Design; its first positive case uses only CLOSE and one member, and D1, which it needs, has landed ahead of it. P2 lands with I2. A1 and V4a proceed in parallel with T1; then T2, I1, I1.5, I2, and I3; then N1, A2, A3, V4b, and V5. Per-frame as-of membership (T4) would
remove the invariant that every frame shares one member set, so its independently frozen dynamic-universe contract is required.

Every target variant the single-threshold author accepts runs past one frame of the target-set Host. Two could not,
each a slice after F and before T1, and both were measured on `main` 3a465a537, red as it stands and past the named
check under a temporary change that was then reverted; the author refused each by name until its slice landed.

- **Rebalance sequence.** The Host assigns the sequence as the rule above states, and the author writes `0`. With a
  constant of 1 only the first frame lifts, and with the Host's assignment removed and `0` written not even the first
  does. `an_authored_rebalance_program_lifts_three_consecutive_frames` runs the authored program as Wasm through three
  frames of the target-set Sim, entering, exiting and entering again at sequences 1, 2 and 3, and
  `a_single_instrument_host_assigns_each_rebalance_the_next_sequence` holds the single-instrument path.
- **Weight reconciliation.** The target-set Host derives a weight member's grid position from equity and price when it
  reconciles, and refuses a weight member that already carries a reconciliation target, but the Host decoded one for
  every target but `Keep`, so a weight side failed as `InputCoverage` on its first frame. Past that check the frame
  failed as `InvalidPositionTransition`, because the author shared one target weight of 0 between both sides. The Host
  now decodes no reconciliation target for a weight target, and each side declares its own `target_weight_micros`,
  which only a weight side may name (`SINGLE_THRESHOLD_WEIGHT_NOT_READ`) and only within 1,000,000 micros either way
  (`SINGLE_THRESHOLD_WEIGHT_OUT_OF_RANGE`); a request that names no weight keeps its bytes.
  `an_authored_weight_program_enters_exits_and_enters_again` runs the authored program through the same three frames.

The rebalance run found a defect no variant refusal covered: the author shared one protection, `keep`, between both sides, and
the kernel refuses `keep` on an exit, so no authored program could exit. Each side's protection now follows its
intent - an exit clears, every other side keeps - and `every_authored_side_runs_through_the_kernel` applies every
authored side to a real lifecycle kernel from each position it can be proposed at, so a terminal shared where it must
follow the side fails there rather than on a later frame.

An authored program proposed its side on every frame its comparison held, so a second frame above the threshold
proposed a second entry from a held position, which the kernel refuses, and the refusal ended the run. The program
now carries the position it believes it holds and proposes a side only from a position the kernel accepts it at,
holding otherwise. It may also name `stop_loss_fraction`, `take_profit_fraction` and `max_holding_bars`, each judged
at a frame's close and proposed there, so an exit fills on the next frame and never at its level inside a bar; a
report states that as `AT_BAR_CLOSE_FILLED_NEXT_FRAME`, because a stop the price passes through inside a bar is
left later, and at a worse price, than one a venue holds.
`an_authored_exit_leaves_once_at_the_close_and_the_program_enters_again` runs the authored program through four
frames for each exit: it enters, holds on a second frame above its threshold, leaves by that exit on a third whose
close is still above it, and enters again. `an_authored_exit_never_reached_holds_the_position` runs the same frames
under exits they never reach. Those runs measured the fuel one invocation burns at about 86,000 with no exit, 205,000
with a price exit and 378,000 for the largest program the family authors, past the 100,000 the plugin's manifest
declared. The family's manifest declares 1,000,000, about 2.6 times the largest measurement. One program's burn varied
by under 2% from frame to frame, so the margin is not for that variation; it covers a growth of the family's largest
program by roughly the size of the exits themselves before the bound has to be measured again. The bound is raised,
not removed: the Plan still refuses a manifest above 10,000,000. Raising it changes the authored Design's identity,
and with it the Design, meaning and Plan pins in `single_threshold_authoring_v1.rs`. Nothing outside that module pins
them.

## TARGET - Research runs until a strategy, bounded by spend

Research does not stop on a trial count: every trial is recorded and accumulates
across rounds, Qualification's discount grows with that count, the random control and holdout stay, and one
user-set spend cap bounds what Research spends. [R&D](../owners/rd/#target---cumulative-trial-accounting-and-the-spend-cap)
defines a trial, the lineage it accumulates across, the removal, and the spend cap;
[Qualification](../owners/qualification/#target---cumulative-trial-deflation-at-candidate-intake) defines the
deflation. None of it blocks F; it is implemented after F, in this order:

| Slice                    | Owners                              | What                                                                                                               | After                |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------- |
| TB1 Lineage trial count  | R&D                                 | production census append, `trial_count`, the lineage sum over bound predecessor frontiers                          | Decision composition |
| TB2 Cumulative deflation | Qualification                       | the deflated ratio at Candidate Intake from the derived count, the cross‑family protected‑attempt count            | TB1                  |
| TB3 Random control       | Qualification, R&D, Backtest        | the specified definition, synthesis, and replay, in that order                                                     | none                 |
| TB4 Spend ledger and cap | R&D, R&D Owner client, Product Edge | usage capture, reserve and settle, `PAUSED_SPEND_CAP_REACHED`, the environment‑set cap, then the Dashboard control | none                 |
| TB5 Remove the trial cap | R&D, Product Edge, Dashboard        | TrialFamily Policy V2 without a budget, the admission refusal and `TRIAL_BUDGET_EXHAUSTED` gone for V2 families    | TB1, TB2, TB4        |

TB1 cannot start yet. It counts the census appends the same-cut Decision and Selection composition in
[R&D](../owners/rd/#target--not_admitted---same-cut-decision-and-selection-composition) makes, and that composition is
itself `TARGET / NOT_ADMITTED`: until it is admitted and built, successor iterations have no production path and no
census append exists to count. TB5 is last because it removes the bound the others replace: before TB2 nothing would
discount a long search, and before TB4 nothing would bound its cost. TB3 is already a condition of any Eligibility, so
it gates Qualification whatever the order. What a stopped lineage does next, a new hypothesis from Source Intake, is
outside these slices.

## Value-stream handoffs

The stage relations between R&D, Backtest, and Qualification cross the value stream as exactly these objects. Each
Owner page defines the object it emits, and the receiving page repeats what it accepts; this page only lists them
so the stream can be read end to end.

- R&D → Backtest: one R&D-owned frozen Exploratory Replay Request bound to the exact Artifact, PIT scope, replay
  configuration, and cost, slippage, and capacity-model identities. The same request identity and canonical bytes
  join one attempt; changed meaning is a conflict and performs no write.
- Backtest → R&D: one Exploratory Run Result per request in exactly one of `RUN_REJECTED`,
  `IN_PROGRESS_OR_UNKNOWN`, `TERMINAL_RESULT`, or `INVALID_REPLAY_EVIDENCE`, repeating every consumed
  execution-defining identity and the complete finite `diagnosticCategorySet`. Only a request-equal
  `TERMINAL_RESULT` may enter Research Selection; every other attempt remains a TrialFamily Census fact and can
  produce only `REPAIR_INPUTS`.
- R&D → Qualification: one frozen Candidate with a terminal `SELECTED_FOR_QUALIFICATION` Research Selection
  Disposition, carried by a stable Qualification Review Request that cross-binds the frozen Intent falsifier and
  stop rule, complete preregistration, immutable exhaustive TrialFamily Census Frontier, exploratory
  request/result frontier, cross-family predecessor frontier, precommitted independence basis, protected-feedback
  observation frontier, Protected Robustness Plan, and the preregistered protected decision-policy identity and
  version.
- Qualification → Product Edge and R&D: one write-once Candidate Intake Receipt, `ADMITTED` or `NOT_ADMITTED`,
  that closes the exact review request. Receipt absence remains `SUBMITTED_OR_UNKNOWN`, and no status summary,
  transport success, or event delivery replaces it. `NOT_ADMITTED` creates no protected attempt and consumes no
  holdout. Qualification then requests and consumes protected replay from Backtest in isolation and returns no
  protected measurement to Research.

## Protected path

Research freezes TrialFamily, its exhaustive Census Frontier, cross-family predecessor frontier, precommitted independence basis, PIT rule, costs, capacity assumptions, budget, falsifier, and stop before submission. Qualification verifies those frontiers, preregistration, exact `READY_FOR_SELECTION` decision and selected-only disposition, owns cumulative holdout reservation and disposition across related TrialFamilies, and requests protected replay. A missing selected-only disposition, falsifier mismatch, missing sibling, renamed trial, budget mismatch, mutable frontier, unresolved ancestry, late independence basis, stale feedback frontier, or post-cut family member closes as `NOT_ADMITTED` before protected replay with no holdout consumption; a terminal Research stop never reaches intake, and a later trial requires a successor Candidate. Protected results may update Eligibility State but must never feed the same research loop.

## Schema freeze condition

Adding a value to a catalog is routine and additive. The catalog entry declares the payload shape, so the schema
does not widen: a bounded feature node names a primitive semantic ID and the catalog's contract fixes how many
bindings that primitive takes and of which type.

Adding a field to `StrategyDesignV2`, `ProposalWiringV2`, or `BoundedFeatureProgramMeaningV1`, or a variant to
`ValueTypeV2`, `LifecycleKindV2`, or `InputFactClassV2`, is not additive. Every such member must be carried by the
lowerer, the shared lifecycle kernel, the Backtest semantic trace, Runtime, and every golden vector, so a member
that is cheap to add is expensive to keep.

Such a change is therefore admissible only after proving the capability cannot be expressed as any of:

- a new value in the field-semantic vocabulary;
- a new primitive catalog entry;
- a new action catalog entry;
- a composition of existing nodes.

The action catalog is `TARGET / NOT_ADMITTED`. Until it exists that alternative resolves to unavailable, and the record says so
rather than treating the absence as a reason to widen the schema.

The change records which alternatives were ruled out and why. That record belongs with the change, not in this
document: a list of approved exceptions maintained here would decay faster than the rule it qualifies.

A reviewer decides whether the record is sound. An automated check can confirm at most that the record exists and
names the four alternatives; it cannot judge whether an exclusion holds, so a passing check is never evidence that
the capability had no catalog expression.

The managed surfaces are `crates/strategy_factory/src/strategy_design_v2.rs`, which defines `StrategyDesignV2`,
`ProposalWiringV2`, `ValueTypeV2`, `LifecycleKindV2`, and `InputFactClassV2`, and
`crates/strategy_factory/src/bounded_feature_program_derivation_v1.rs`, which defines
`BoundedFeatureProgramMeaningV1`.

The rule follows the definition, not the mention. A file that only references a managed type is not a managed
surface, so a change confined to a fixture, a lowerer, a host, or a storage adapter carries no proof burden even
though it names those types.

An optional field is not an exemption. It carries the same proof burden as a required one, because every consumer
must still branch on its absence.

## Authority boundary

R&D owns Intent, TrialFamily, Artifact, Exploratory Replay Request, and Candidate identity. Develop is an internal R&D capability, not a second Owner. Backtest owns replay results and never chooses the R&D next action. Qualification owns intake status, holdout state, eligibility, and revocation. Strategy Factory owns none of these facts and has no storage authority.

## Implementation acceptance

Every handoff preserves immutable identities, request correlation, protected-feedback ancestry, and consumed-input receipts. R&D basis creation precedes any Qualification protected-feedback write. Qualification binds its projection to the exact basis ref/digest, principal, request scope, source sequence/cut, clock epoch, and half-open validity; stale, malformed, mismatched, or unavailable authority creates no S1 transition. Every exploratory result joins one stable R&D-owned request identity; mismatch fails before a run. Candidate intake proves the exact `READY_FOR_SELECTION` decision and `SELECTED_FOR_QUALIFICATION` disposition cross-bind the frozen falsifier and exploratory frontier, the TrialFamily frontier is immutable and exhaustive through its cut, and cumulative holdout disposition survives a TrialFamily rename. A terminal stop creates no Selection, cannot be `ADMITTED`, and consumes no holdout. No protected result can mutate R&D inputs, parameters, or the evaluated Artifact.

For the first S1 write, R&D holds the canonical Operator Authorization, Product Edge, local lineage, and Qualification locks, performs the final Qualification reread, and only then samples one final cut immediately before the first write. The same cut is bound into all resulting identities and receipts, and every authorization, binding, manifest, and Qualification half-open interval must still be current at that cut. Equality with any `valid_through` value is stale and produces zero R&D receipt, Intent, TrialFamily, census, or outbox write.

Before that terminal write, a committed Independence Basis stage is durable downstream custody: it seals the complete canonical R&D request meaning, semantic digest, Product Edge admission locator and historical lineage, basis receipt and outbox. Exact `RESOLVE` may use only that verified sealed meaning to resume historical completion without creating another basis, head, or outbox; changed meaning, changed admission, raw row presence, malformed custody, or missing custody fails closed. After the terminal R&D receipt commits, later authorization or view expiry preserves the exact receipt, Intent, TrialFamily, basis, and historical Qualification projection as a `STALE` read-only result whose only action is same-request resolution; it grants no new submission, successor, or provider effect.
