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
  resolver, prove dynamic PostgreSQL product composition or end-to-end Windmill acceptance, or admit trading.
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
- **TARGET / NOT_ADMITTED - ARC Complex D Bounded Feature Program V1:** frozen Research may supply the bounded,
  typed feature/state program defined below. Strategy Factory deterministically lowers that canonical program with
  first-party sources into one existing bounded plugin, then continues only through `PluginManifestV2`,
  `StrategyPlanV2`, `StrategyArtifactV2`, `ProgramHostV2`, and the shared lifecycle kernel. This repository has no
  executable `BoundedFeatureProgramV1`, V3 producer or durable V3 readback today. This contract does not claim an
  executable D-loop, Native Replay, Windmill acceptance, stable profitability, Paper, Live, production, or trading
  authority.

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

### TARGET - ARC Complex D Bounded Feature Program V1

`BoundedFeatureProgramV1` (BFP V1) is the only admitted general Complex D representation. R&D/Develop freezes its
canonical meaning together with the Research Intent and `StrategyDesignV2`; Strategy Factory verifies and lowers
it but cannot invent Research meaning. Its sole forward path is:

`Frozen Research -> canonical BoundedFeatureProgramV1 typed DAG -> deterministic first-party source lowering ->`
`versioned V3 build capsule/receipt -> existing PluginManifestV2/Composer/StrategyArtifactV2 ->`
`existing ProgramHostV2 -> shared lifecycle kernel -> Backtest`.

The BFP is a build input for exactly one bounded plugin declared by the Design, not a Host graph extension, Host
feature opcode, interpreter, runtime, strategy template, raw-order program, or new Owner. An LLM or caller may
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
  bytes, Wasm bytes, fuel, linear memory, and invocations per event; and
- domain-separated canonical bytes and digest covering every field above, all constants and frozen rounding modes.

Node IDs and port IDs are unique stable strings; edges reference only earlier typed outputs; every output is
consumed or declared terminal, every fan-out is explicit and bounded, and state has one writer and a declared initial value;
unreachable nodes, cycles, forward references, duplicate IDs, implicit casts, implicit rescale, unit mismatch,
unbounded windows, or a bound inconsistent with the manifest are `UNSUPPORTED` before source generation. Canonical
sorting is by schema-defined byte keys, never source order, map iteration, locale, platform, enum ordinal, or
caller-provided digest. Re-canonicalizing canonical bytes must be byte-identical.

The first primitive catalog is versioned and owned by `vibe-indicators-kernel`. Strategy Factory references each
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

`NUMERIC_FAILURE_NO_STATE_CHANGE` is failure-atomic: input admission may be recorded, but primitive state,
warm-up counters, stored sample coordinates, plugin/BFP/kernel state, lifecycle output, target/protection, semantic
trace, and checkpoint bytes remain identical to their pre-event bytes. Validation failures discovered before
execution remain `UNSUPPORTED` with no Artifact. A valid warm-up event is not a numeric failure: it advances the
declared state and exposes a typed `WARMING` availability with no readable value. A downstream node cannot read a
`WARMING` value; a lifecycle output during warm-up must be an explicit Design wiring from availability to the
existing `HOLD` semantic.

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

The primitive catalog publishes this family atomically. The following list is the closed V1 namespace:

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
  `kernel.target.position.v1`, `kernel.target.weight.v1`, `kernel.target.rebalance.v1`,
  `kernel.protection.stop-loss.v1`, `kernel.protection.take-profit.v1`, and
  `kernel.protection.trailing-adjust.v1`.

No other primitive, alias, optional subset, or extension belongs to catalog V1. Every row binds its exact formula,
type/unit/scale contract, rounding ID where applicable, availability/update-clock rule, state encoding, and required
golden-vector identities in canonical catalog bytes. Missing or adding one row, formula, semantic ID, golden vector,
or failure oracle makes the entire V1 catalog digest unavailable; Strategy Factory must reject the BFP and cannot
publish or substitute a partial toy catalog.

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

Market Data resolves the exact historical timeframe-projection receipt for the sealed static binding and selects
and seals the coordinate from its verified census. R&D, Strategy Factory, the Host caller, Backtest, and the plugin cannot
mint, narrow, hash-substitute, or advance it. For one role, a replay joins only when all 308 bytes match. The same
role/timeframe/sample identity with different bytes is a conflict. A new sample requires unchanged static binding,
timeframe, lineage root and Market Semantics identity, a nondecreasing lineage version, a different sample identity,
and a strictly greater lexicographic `(logical_time, event_time, owner_sequence, event_identity, sample_identity)`
tuple. Cross-lineage coordinates are not comparable and fail closed. These equality and order rules, not numeric
value equality, decide state advancement.

The TARGET Design/Plan seam is the versioned source semantic
`strategy.value-ref.owner-sample-coordinate.v1(input_role_id)`. For each BFP role used by a sample-clock node, the
lowerer must create one manifest input port whose literal semantic ID is
`strategy.input.sample-coordinate.v1.<role_identity_hex>`, where `role_identity_hex` is exactly the 64 lowercase
hex characters of that role's `[u8; 32]` identity. Uppercase, a non-64-length suffix, or a suffix unequal to the
bound role is noncanonical. The port has type `ValueTypeV2::Bytes` and exact `max_bytes = 308`. BFP role input ports
are ordered by `(role_identity_bytes, kind_tag)`, where `kind_tag = 0` is the role's value port and `kind_tag = 1`
is its coordinate port, so each present coordinate follows exactly its own value without relying on source order.
`StrategyPlanV2` binds the role, full derived port ID, coordinate-source semantic ID, port ordinal, static binding,
coordinate codec/digest rule, and update clock. Existing Designs without this tagged source retain byte-identical
V2 meaning.

The one generic `ProgramHostV2` extends its existing Owner-event evidence adapter, not its graph opcode set or
runtime, to retain the already verified coordinate bytes and resolve that Plan-bound metadata source. It rejects a
coordinate not cross-bound by the admitted Market Data receipt, then copies the exact 308 Owner bytes into the
ordinary typed plugin input port. The guest receives no caller coordinate and cannot request another role. This is
the sole admitted transport; deriving a coordinate from the I128 value, driver envelope, trigger count, local hash,
or guest state is prohibited.

A trigger-clock node advances once for each newly admitted trigger coordinate. A sample-clock node advances only
when its named role receives a strictly new Owner-sealed sample coordinate. Repeating the same 1-hour sample across
many 1-minute triggers must reuse the prior sample-clock state without advancing it, even when other trigger
values change. A newly sealed 1-hour sample must advance exactly once even when its numeric OHLC values are
identical to the preceding sample. Value comparison, caller time, trigger count, arrival order, a narrowed R04 or
event hash, and locally derived timestamps are not valid substitutes. Missing, stale, duplicate-conflicting,
cross-role, cross-timeframe, cross-lineage, regressed-version, receipt-mismatched, or noncanonical coordinates fail
before guest invocation or any BFP, plugin, lifecycle, target, protection, trace, or checkpoint mutation.

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
port-entry layout, uses frame header ABI `u16 = 3`, and changes only the invocation status map: nonnegative is the
canonical output length, `-1` is `NUMERIC_FAILURE_NO_STATE_CHANGE`, and every other negative value is an
unsupported/unknown guest status.

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

`PluginImplementationReceiptV2` may continue to bind the resulting module and an opaque
`verified_build_receipt_digest`; it does not interpret or mint V3 authority. Composer durable custody must store
and reread an explicit `V2(existing canonical bytes) | V3(canonical bytes)` receipt tag, validate the selected
schema with its own decoder, and bind that tagged receipt digest into the Plan/Artifact path. Existing V2 rows and
digests remain byte-for-byte authoritative and readable; migration cannot rewrite, reinterpret, backfill, or
silently promote them to V3. A missing tag, unknown version, cross-tag replay, V2 bytes under a V3 tag, changed BFP
under the same build identity, or partial V3 coverage fails closed with no Plan or Artifact.

After the new corpus proves the sole BFP-to-Wasm path equivalent where legacy behavior is still admitted,
`complex_strategy_ir`, `complex_strategy_program`, their interpreter/compiler path, and the hand-written V1
complex programs must be deleted or retired as non-authoritative. Their floating-point semantics and raw
`Action::Submit` plumbing must not be translated, wrapped, or retained as BFP, SDK, primitive, Host, or migration
authority.

#### First future executable corpus and falsifiers

The first future executable corpus is immutable and precommitted. Its single `InputJoinV2` contains 1-minute raw
open/high/low/close price roles plus 1-hour-close and 1-day-close regime-source price roles. Every joined role has
the same fixed-I128 value type, price unit, and scale; the 1-minute-close role is the explicit trigger. No volume
role is part of this V1 corpus. On the 1-minute trigger clock it evaluates ATR, RSI, candle geometry, rolling
swings, and rational Fibonacci range fractions. On the named 1-hour-close and 1-day-close sample clocks it updates
multi-timeframe regime state. The reaction consumes exactly that complete join role set. Bounded holding,
add-count, high-water and protection state drives a
continuous event sequence containing `ENTER -> ADD -> REDUCE -> EXIT` and explicit `HOLD`, with dynamic stop-loss,
take-profit and trailing-protection outputs.

Acceptance requires the canonical BFP to lower twice to byte-identical source, build twice to byte-identical Wasm
and tagged V3 receipt, pass Composer into the same `StrategyArtifactV2`, and execute through the real
`ProgramHostV2`/Backtest shared-kernel path. Complete repeated runs must produce byte-identical BFP, source, Wasm,
build receipt, Plan/Artifact identities, ordered semantic trace, checkpoint, fill, position, protection, cost, and
canonical Backtest result. Restoring a checkpoint at every declared state frontier must reproduce a byte-identical
suffix.

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

## TARGET / NOT_ADMITTED - TrialFamily-owned Replay execution policy V2

At TrialFamily formation, R&D must freeze exactly one canonical nested `replay_execution_policy_v2`. The permanent
family root, the policy, and the initial Census Frontier must cross-bind their identities and canonical digests so
that no later family member, Composer, Windmill flow, Backtest adapter, or other caller can replace or reinterpret
the policy. This remains a target architecture contract; the current caller-authored `ReplayRequestDtoV2` path does
not satisfy it, and no current PostgreSQL or Windmill acceptance is claimed.

The sole pre-formation source of those values is an R&D Owner-internal, sealed, versioned Replay Policy Catalog
fact; the catalog is neither a new Owner nor a second TrialFamily aggregate. Each immutable record contains a
unique, never-reused non-empty ASCII `catalog_record_id`, a unique, strictly increasing, never-reused unsigned
64-bit `catalog_version`, the complete
canonical `replay_execution_policy_v2` bytes, and
`policy_digest = SHA-256("rd.replay-execution-policy.v2\0" || policy_canonical_bytes)`. Its canonical record bytes
are the successive `u32 length || bytes` encoding of the ASCII record ID and policy bytes, with the version encoded
between them as little-endian `u64`, followed by the 32 policy-digest bytes; lengths are little-endian, and trailing
bytes are forbidden. `catalog_record_digest` is
`SHA-256("rd.replay-policy-catalog-record.v2\0" || canonical_record_bytes)`.

Before the first TrialFamily-formation write, an R&D-private formation resolver in the same Owner transaction must
lock and reread the then-current, unrevoked catalog record, verify its identity, version, canonical bytes, policy
digest, record digest, currentness, and unrevoked status, and resolve no policy field from anywhere else. The
permanent family root and initial Census Frontier both embed the complete policy bytes and policy digest and
cross-bind the catalog record identity,
version, and digest. A caller, Windmill flow, environment variable, deployment configuration, default, or later
catalog record cannot select, override, synthesize, backfill, or infer any field.

The nested policy owns every execution choice needed to compose the complete `ReplayRequestDtoV2` meaning:

- the runtime-kernel, simulator, cost, slippage, and capacity profile identities and versions;
- the runner operational profile, diagnostic policy, and deterministic seed;
- the half-open replay window, calendar, session, and time-zone identities and versions; and
- the correction-rule and market-semantics identities and versions, corporate-action cut, historical-membership
  cut, and any other selection in the request that family policy, rather than an input Owner, owns.

The TrialFamily's existing top-level cost-model, slippage-model, and capacity-model identities must equal the
corresponding nested model profiles exactly. A mismatch is unavailable, not an alternate representation. A legacy
TrialFamily without the sealed policy remains historically readable, but is ineligible and unavailable for Replay
V2 composition: there is no default, backfill, caller substitution, or inference from a newer family.

Windmill and every other Exploratory Replay caller may submit only the Artifact and TrialFamily identities plus
Owner-sealed Composer and Market Data locators and digests. Those values are evidence locators, not selection
authority; a replay-policy locator or value is not a caller input. The R&D Owner alone resolves the family-sealed
policy and composes the complete canonical Replay request; callers cannot supply or override runtime/model profiles,
replay window, calendar/session/time zone, deterministic seed,
diagnostic policy, correction rule, market semantics, or either historical cut.

Within the same `commit_v2` transaction, immediately before the first `INSERT`, R&D must lock and reread every
canonical Owner fact used by composition, including the Artifact-family binding, family root and current Census
Frontier, family-sealed replay policy and its referenced immutable catalog record, Composer facts, and Market Data
cuts. Missing, stale, digest-mismatched, cross-spliced, or caller-overridden input rejects the operation with zero
Replay request, receipt, outbox, or head change. Backtest accepts only the resulting R&D-owned sealed request and
owns only its result; it never creates a request or selects execution policy.

A missing, stale, or revoked catalog record at formation, an identity/version/bytes/digest mismatch, a
catalog-to-family cross-splice, or any prohibited source reaching formation fails before mutation with zero family,
Replay request, receipt, outbox, or head writes. Once a family forms successfully, its embedded policy bytes and
digest and catalog record identity, version, and digest are permanent: a later catalog version neither replaces
them nor makes that family unavailable.

Replay composition validates only that permanent family-sealed binding and the referenced immutable record's exact
bytes and digests, untampered state, and readability; it must not perform a latest/current catalog lookup. A deleted,
tampered, or unreadable referenced record, or a binding mismatch, makes Replay V2 unavailable with zero Replay
request, receipt, outbox, or head writes. Formation and composition may not repair any failure by selecting a
default or newer catalog record.

This adds neither a second request aggregate nor a new Owner. It preserves
`StrategyDesignV2 -> StrategyPlanV2 -> StrategyArtifactV2 -> ProgramHostV2`, the existing R&D request identity and
custody, and response-loss recovery: exact `RESOLVE` may recover only the same pre-existing sealed request meaning
and may not compose a replacement, alter policy, or create a second request, receipt, outbox, or head. This target
is not admitted until implementation plus real disposable PostgreSQL Owner readback and end-to-end Windmill
acceptance prove the complete composition and every zero-change rejection; it grants no production or trading
authority.

## Protected path

Research freezes TrialFamily, its exhaustive Census Frontier, cross-family predecessor frontier, precommitted independence basis, PIT rule, costs, capacity assumptions, budget, falsifier, and stop before submission. Qualification verifies those frontiers, preregistration, exact `READY_FOR_SELECTION` decision and selected-only disposition, owns cumulative holdout reservation and disposition across related TrialFamilies, and requests protected replay. A missing selected-only disposition, falsifier mismatch, missing sibling, renamed trial, budget mismatch, mutable frontier, unresolved ancestry, late independence basis, stale feedback frontier, or post-cut family member closes as `NOT_ADMITTED` before protected replay with no holdout consumption; a terminal Research stop never reaches intake, and a later trial requires a successor Candidate. Protected results may update Eligibility State but must never feed the same research loop.

## Authority boundary

R&D owns Intent, TrialFamily, Artifact, Exploratory Replay Request, and Candidate identity. Develop is an internal R&D capability, not a second Owner. Backtest owns replay results and never chooses the R&D next action. Qualification owns intake status, holdout state, eligibility, and revocation. Strategy Factory owns none of these facts and has no storage authority.

## Implementation acceptance

Every handoff preserves immutable identities, request correlation, protected-feedback ancestry, and consumed-input receipts. R&D basis creation precedes any Qualification protected-feedback write. Qualification binds its projection to the exact basis ref/digest, principal, request scope, source sequence/cut, clock epoch, and half-open validity; stale, malformed, mismatched, or unavailable authority creates no S1 transition. Every exploratory result joins one stable R&D-owned request identity; mismatch fails before a run. Candidate intake proves the exact `READY_FOR_SELECTION` decision and `SELECTED_FOR_QUALIFICATION` disposition cross-bind the frozen falsifier and exploratory frontier, the TrialFamily frontier is immutable and exhaustive through its cut, and cumulative holdout disposition survives a TrialFamily rename. A terminal stop creates no Selection, cannot be `ADMITTED`, and consumes no holdout. No protected result can mutate R&D inputs, parameters, or the evaluated Artifact.

For the first S1 write, R&D holds the canonical Operator Authorization, Product Edge, local lineage, and Qualification locks, performs the final Qualification reread, and only then samples one final cut immediately before the first write. The same cut is bound into all resulting identities and receipts, and every authorization, binding, manifest, and Qualification half-open interval must still be current at that cut. Equality with any `valid_through` value is stale and produces zero R&D receipt, Intent, TrialFamily, census, or outbox write.

Before that terminal write, a committed Independence Basis stage is durable downstream custody: it seals the complete canonical R&D request meaning, semantic digest, Product Edge admission locator and historical lineage, basis receipt and outbox. Exact `RESOLVE` may use only that verified sealed meaning to resume historical completion without creating another basis, head, or outbox; changed meaning, changed admission, raw row presence, malformed custody, or missing custody fails closed. After the terminal R&D receipt commits, later authorization or view expiry preserves the exact receipt, Intent, TrialFamily, basis, and historical Qualification projection as a `STALE` read-only result whose only action is same-request resolution; it grants no new submission, successor, or provider effect.
