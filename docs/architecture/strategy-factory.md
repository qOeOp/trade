# Strategy Factory

## Responsibility

Strategy Factory is a value-stream boundary around R&D, exploratory Backtest, and independent Qualification. R&D contains both Research and Develop capabilities; the boundary makes the R D Q separation visible without becoming another Owner.

## Forward path

A sourced hypothesis is only a proposal. Before protected feedback, R&D atomically precommits one principal- and request-scope-bound Independence Basis Receipt. Qualification directly resolves that exact R&D receipt and, after inspecting its complete durable principal/scope history, returns either `GENESIS_EMPTY`, a current opaque `FRONTIER(ref, cut)`, or `UNAVAILABLE`; genesis is valid only for proven empty Qualification history. Product Edge carries that principal/scope-bound opaque projection without protected detail. Inside the locked R&D admission transaction, R&D resolves its own complete local semantic-predecessor lineage as `GENESIS_EMPTY`, `COMPLETE_FRONTIER`, or `UNAVAILABLE`. Only exact current canonical reads from both Owners may atomically create the frozen Research Intent, permanent TrialFamily root, initial census member and head, receipts, and outbox. The caller cannot supply or override either frontier, the independence disposition, or the basis identity.

Qualification's PostgreSQL custody is physically distinct: `qualification_owner` owns its tables and locked admission function, while a separate Qualification writer performs projection writes. The R&D role has no ownership, raw `SELECT`, or DML on Qualification tables. In the caller's R&D transaction it may execute only the fixed safe `search_path` `SECURITY DEFINER` admission function, whose fully qualified reads preserve lock order and return an untrusted raw envelope. Qualification-owned Rust verifies that envelope against the canonical R&D basis and Qualification history before constructing the sealed, non-deserializable positive readback; no public raw-envelope constructor exists.

Qualification projections form one append-only, acyclic principal/scope chain. If the latest projection for an exact verified Independence Basis becomes stale after Qualification commit or response loss, only Qualification Owner under the same principal/scope lock may append a successor that binds the exact basis ref/digest, predecessor projection ref/digest, unchanged canonical source sequence/cut/frontier, Owner clock epoch, new half-open validity, receipt and outbox, then atomically advance the head. A current projection joins byte-identically; callers and R&D cannot renew it. Historical R&D terminal custody continues to bind and expose its exact consumed projection, while a new S1 write requires the canonical latest projection to be current at the final locked cut.

R&D's Develop capability returns one content-addressed Strategy Artifact and Build Receipt, then its Research capability freezes one Exploratory Replay Request binding that exact artifact, data scope, replay configuration, and model identities before the separate Backtest service accepts it. Exploratory facts return only to R&D and can create a successor Intent. R&D maintains the append-only TrialFamily Census Frontier and alone commits Iteration Decision. A terminal stop ends there with no Selection. Only a `READY_FOR_SELECTION` decision may produce the selected-only `SELECTED_FOR_QUALIFICATION` disposition and submit the Qualification Candidate.

<a id="strategy-design-v2-shared-lifecycle-kernel"></a>

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
  acceptance evidence only. The local bounded-plugin producer admits exact, fail-closed macOS arm64 and Linux ARM64
  host profiles. Linux ARM64 is **CURRENT/PARTIAL** only at a main-bound hosted native A0 evidence boundary: exact
  workflow [`strategy-factory-linux-a0`](https://github.com/qOeOp/trade/blob/9e5149d4293a800be3a35e6b747a9f3dba304e1f/.github/workflows/strategy-factory-linux-a0.yml),
  `workflow_dispatch` [run 33250411708](https://github.com/qOeOp/trade/actions/runs/33250411708) at head
  `9e5149d4293a800be3a35e6b747a9f3dba304e1f`, and job
  [`strategy factory A0 native gate (linux arm64)`](https://github.com/qOeOp/trade/actions/runs/33250411708/job/99095016988)
  succeeded on GitHub-hosted `ubuntu-22.04-arm`, bound as `github-hosted/Linux/ARM64/aarch64`. That gate verifies
  immutable CI inputs, exact Rust 1.97.1 Cargo/rustc commits and host, the sole `wasm32v1-none` target, the pure-Rust
  canonical sysroot digest, deterministic double build/exact replay, and delivery of the real build into the sole
  Composer and `ProgramHostV2` consumer path. The builder rereads its exact tools and canonical target sysroot before
  and after each build. This hosted job success is not an R&D Owner business receipt. There is no kernel network
  confinement, durable/deployed/Windmill readiness, Paper, Live, deployed-runtime, or production maturity. The
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
- **CURRENT/DYNAMIC, bounded exactly-two-member Backtest target-set vertical:** one complete Owner-sealed
  universe frame is prepared on a cloned `ProgramHostV2`, produces one canonical target set and one plugin
  invocation, and is committed only after one account-scoped `Portfolio::equity` snapshot, both exact instrument
  facts, Decimal target conversion, member reconciliation, and both native orders validate. The equity snapshot is
  total account balance plus unrealized PnL for margin positions; it fails closed for an absent or ambiguous venue
  account, multiple/wrong currencies, or any unpriced open position. Support is limited to
  linear, non-inverse, non-quanto instruments whose settlement and quote currency equal the positive equity
  currency. Weight targets use
  `trunc_toward_zero(equity * weight_micros / 1_000_000 / price / multiplier / size_increment)` as signed grid
  units; position targets already are signed grid units. Both forms pass only through an opaque adapter-sealed
  reconciliation capability bound to the exact prepared target-set identity, running Host instance, account/equity
  snapshot, both instrument facts and prices, current positions, formula, and derived targets. No crate peer or
  caller can construct or alter its numeric targets. Native quantity is rebuilt exactly as grid units times size
  increment and must pass instrument normalization unchanged. Host commit and order preflight are
  whole-batch atomic before submission. Sim Exchange submissions and fills are sequential, not venue-atomic: a
  later submission failure faults the run and preserves any earlier native effect and in-process replay evidence.
  A bounded test-only fault at the second-submit boundary dynamically proves one successful real submission and
  native cached order remain after the Host commit; it does not claim venue rollback or all-or-none submission.
  Each `ClientOrderId` binds the exact instrument and host-derived intent; partial/full/canceled/rejected progress
  advances only that member, retains its independent residual, and synchronizes that member's protection quantity
  to actual filled quantity. The real `BacktestEngine`/Sim Exchange acceptance corpus uses distinct prices,
  multipliers, and size grids and proves repeat equality plus uninterrupted versus same-running-engine opaque Host
  checkpoint-restored suffix equality. A real-Sim regression with the Owner-sealed first frame and a test-only
  admitted successor frame opens positions, marks nonzero unrealized PnL, and proves the next weight target uses
  that batch's account-scoped equity rather than cash balance; it is not evidence of a second dynamic Owner issuance.
  Prepared capabilities are also rejected by independently created equivalent or restored Host instances. It does
  not prove
  a cold engine restart, venue atomicity, Paper, Live,
  provider/network, persistence, production readiness, or trading authority.
- **TARGET / NOT_ADMITTED:** Paper and Live consume the same plan, Artifact, event ordering, checkpoint schema,
  kernel and semantic-trace contract only after their Owner adapters exist and are separately admitted. No current
  Paper or Live equivalence, application, external write, or trading capability is claimed here.

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

`StrategyArtifactV2` is one package containing the canonical `StrategyPlanV2` bytes and exactly one independently
built Wasm module for each plugin declared by that Plan. Modules cannot be shared between plugin declarations.
There is no generated outer or root strategy Wasm module: generic `ProgramHostV2` interprets the Plan graph,
invokes its plugin modules, and passes the resulting typed values to the shared lifecycle kernel, which alone owns
state transitions. This is the sole V2 execution path. V1 remains only a migration and equivalence baseline, never
an alternate V2 runtime.

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
and cross-binds the trigger and observation-batch digest. A Strategy Factory-private adapter validates the trigger
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

- `ENTER`, `ADD`, `REDUCE`, `EXIT`, and `HOLD` position intent under `kernel.position.enter.v1`,
  `kernel.position.add.v1`, `kernel.position.reduce.v1`, `kernel.position.exit.v1`, and
  `kernel.position.hold.v1`;
- target position, target weight, and target rebalance under `kernel.target.position.v1`,
  `kernel.target.weight.v1`, and `kernel.target.rebalance.v1`;
- stop-loss, take-profit, and trailing-protection adjustment under `kernel.protection.stop-loss.v1`,
  `kernel.protection.take-profit.v1`, and `kernel.protection.trailing-adjust.v1`; and
- fill reconciliation under `kernel.fill.reconcile.v1`, including partial fill, rejection, cancellation and
  out-of-order readback handling.

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
and canonical Backtest results, the duplicate V1 interpreter and toy renderer must be deleted. A third runtime,
sidecar interpreter, generated unrestricted strategy code path, or feature-specific core opcode is prohibited.

Acceptance uses three versioned, immutable corpora, each with positive, unsupported, malformed-binding,
resource-exhaustion and checkpoint/restart cases:

1. **Stateful trend:** entry, pyramiding, partial fills, stop-loss/take-profit and trailing-stop adjustments,
   timer action, reductions and exit.
1. **Cross-sectional rebalance:** typed universe roles, ranking, target weights, rebalance cadence, partial fills
   and deterministic residual reconciliation.
1. **Multi-leg, multi-timeframe regime:** exact leg and timeframe roles, joined event ordering, regime state,
   atomic target intent and fail-closed missing/stale leg input.

For every admitted corpus, repeated Backtest runs must produce byte-identical Design/Plan/Artifact identities,
ordered semantic traces, checkpoints, fills, positions, costs and canonical results. The same normalized event
prefix must produce the same semantic trace in a later admitted Paper or Live Runtime up to the Risk/Execution
adapter boundary. Any divergence, heuristic binding, unsupported feature promoted to an opcode, plugin raw-order
attempt, or retained duplicate interpreter fails acceptance.

## Protected path

Research freezes TrialFamily, its exhaustive Census Frontier, cross-family predecessor frontier, precommitted independence basis, PIT rule, costs, capacity assumptions, budget, falsifier, and stop before submission. Qualification verifies those frontiers, preregistration, exact `READY_FOR_SELECTION` decision and selected-only disposition, owns cumulative holdout reservation and disposition across related TrialFamilies, and requests protected replay. A missing selected-only disposition, falsifier mismatch, missing sibling, renamed trial, budget mismatch, mutable frontier, unresolved ancestry, late independence basis, stale feedback frontier, or post-cut family member closes as `NOT_ADMITTED` before protected replay with no holdout consumption; a terminal Research stop never reaches intake, and a later trial requires a successor Candidate. Protected results may update Eligibility State but must never feed the same research loop.

## Authority boundary

R&D owns Intent, TrialFamily, Artifact, Exploratory Replay Request, and Candidate identity. Develop is an internal R&D capability, not a second Owner. Backtest owns replay results and never chooses the R&D next action. Qualification owns intake status, holdout state, eligibility, and revocation. Strategy Factory owns none of these facts and has no storage authority.

## Implementation acceptance

Every handoff preserves immutable identities, request correlation, protected-feedback ancestry, and consumed-input receipts. R&D basis creation precedes any Qualification protected-feedback write. Qualification binds its projection to the exact basis ref/digest, principal, request scope, source sequence/cut, clock epoch, and half-open validity; stale, malformed, mismatched, or unavailable authority creates no S1 transition. Every exploratory result joins one stable R&D-owned request identity; mismatch fails before a run. Candidate intake proves the exact `READY_FOR_SELECTION` decision and `SELECTED_FOR_QUALIFICATION` disposition cross-bind the frozen falsifier and exploratory frontier, the TrialFamily frontier is immutable and exhaustive through its cut, and cumulative holdout disposition survives a TrialFamily rename. A terminal stop creates no Selection, cannot be `ADMITTED`, and consumes no holdout. No protected result can mutate R&D inputs, parameters, or the evaluated Artifact.

For the first S1 write, R&D holds the canonical Operator Authorization, Product Edge, local lineage, and Qualification locks, performs the final Qualification reread, and only then samples one final cut immediately before the first write. The same cut is bound into all resulting identities and receipts, and every authorization, binding, manifest, and Qualification half-open interval must still be current at that cut. Equality with any `valid_through` value is stale and produces zero R&D receipt, Intent, TrialFamily, census, or outbox write.

Before that terminal write, a committed Independence Basis stage is durable downstream custody: it seals the complete canonical R&D request meaning, semantic digest, Product Edge admission locator and historical lineage, basis receipt and outbox. Exact `RESOLVE` may use only that verified sealed meaning to resume historical completion without creating another basis, head, or outbox; changed meaning, changed admission, raw row presence, malformed custody, or missing custody fails closed. After the terminal R&D receipt commits, later authorization or view expiry preserves the exact receipt, Intent, TrialFamily, basis, and historical Qualification projection as a `STALE` read-only result whose only action is same-request resolution; it grants no new submission, successor, or provider effect.
