import { canonicalHash } from "../../runtime-core/src/canonical-json"

type JSONRecord = Record<string, unknown>

export const STRATEGY_FAMILY_CAPABILITY_SCHEMA_VERSION =
  "trade.rd-strategy-family-capability.v1" as const

export interface StrategyFamilyParameterAxis {
  name: string
  value_type: "number" | "integer" | "boolean" | "string"
  minimum?: number
  exclusive_minimum?: boolean
  allowed_values?: Array<string | number | boolean>
}

export interface StrategyFamilyCapabilityBody {
  schema_version: typeof STRATEGY_FAMILY_CAPABILITY_SCHEMA_VERSION
  canonical_node_id: string
  family_id: string
  implementation_version: string
  replay_coverage: "ready" | "partial"
  runtime_coverage: "missing"
  required_data: string[]
  parameter_axes: StrategyFamilyParameterAxis[]
  implementation_contract: {
    feature_definition: JSONRecord
    signal_definition: JSONRecord
    position_rule: JSONRecord
    risk_rule: JSONRecord
    execution_rule: JSONRecord
  }
  module_ref: string
}

export interface StrategyFamilyCapability extends StrategyFamilyCapabilityBody {
  capability_hash: string
}

export interface CandidateSpaceCompatibility {
  compatible: boolean
  unsupported_axes: string[]
  invalid_axes: string[]
}

const MODULE_REF =
  "modules/research-strategy-development/agent-roles/developer/strategy-family-engine"

const CAPABILITIES = [
  capability({
    canonical_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    family_id: "time_series_momentum_v1",
    replay_coverage: "ready",
    required_data: ["ohlcv"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      integerAxis("lookback_bars", 1),
      numberAxis("threshold_atr", 0, false),
      numberAxis("stop_atr", 0, false),
      numberAxis("max_risk_atr", 0, false),
      numberAxis("reward_risk", 0, false),
      numberAxis("break_even_after_r", 0),
      numberAxis("break_even_offset_r", 0),
    ],
    implementation_contract: implementationContract({
      feature: "(close[index] - close[index-lookback_bars]) / ATR14[index]",
      signal: "long when momentum >= threshold_atr; short when momentum <= -threshold_atr; side filters direction",
      stop: "long: signal candle low - stop_atr*ATR14; short: signal candle high + stop_atr*ATR14",
      breakEven: true,
    }),
  }),
  capability({
    canonical_node_id: "canonical:trend/breakout-continuation/channel-breakout",
    family_id: "structure_breakout_retest_v1",
    replay_coverage: "ready",
    required_data: ["ohlcv"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      integerAxis("lookback_bars", 1),
      numberAxis("breakout_buffer_atr", 0),
      numberAxis("retest_tolerance_atr", 0, false),
      numberAxis("stop_atr", 0, false),
      numberAxis("max_risk_atr", 0, false),
      numberAxis("reward_risk", 0, false),
    ],
    implementation_contract: implementationContract({
      feature: "prior lookback high/low, breakout candle close, then current-candle retest within retest_tolerance_atr",
      signal: "previous candle must close beyond structure by breakout_buffer_atr; current candle must retest and close on the broken side",
      stop: "beyond min(retest low, structure) for long or max(retest high, structure) for short by stop_atr*ATR14",
    }),
  }),
  capability({
    canonical_node_id: "canonical:trend/cross-sectional-momentum/relative-weakness-momentum",
    family_id: "relative_weakness_momentum_v1",
    replay_coverage: "partial",
    required_data: ["ohlcv"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      enumAxis("signal_mode", ["momentum", "reversion"]),
      enumAxis("confirmation_mode", ["none", "reversal_close"]),
      integerAxis("lookback_bars", 1),
      numberAxis("relative_threshold_atr", 0, false),
      numberAxis("benchmark_return_max"),
      numberAxis("benchmark_return_min"),
      numberAxis("stop_atr", 0, false),
      numberAxis("max_risk_atr", 0, false),
      numberAxis("reward_risk", 0, false),
      numberAxis("break_even_after_r", 0),
      numberAxis("break_even_offset_r", 0),
    ],
    implementation_contract: implementationContract({
      feature: "((asset lookback return - timestamp-aligned benchmark lookback return) * current close) / ATR14",
      signal: "momentum or reversion mapping over relative_threshold_atr, optional benchmark-return bounds and reversal-close confirmation",
      stop: "long: signal candle low - stop_atr*ATR14; short: signal candle high + stop_atr*ATR14",
      breakEven: true,
    }),
  }),
  capability({
    canonical_node_id: "canonical:trend/trend-pullback/trend-pullback",
    family_id: "trend_pullback_v1",
    replay_coverage: "ready",
    required_data: ["ohlcv"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      enumAxis("fast_ema", [20, 50]),
      enumAxis("slow_ema", [50, 200]),
      numberAxis("pullback_atr", 0, false),
      numberAxis("stop_atr", 0, false),
      numberAxis("max_risk_atr", 0, false),
      numberAxis("reward_risk", 0, false),
      integerAxis("slope_lookback", 0),
      booleanAxis("require_ema_stack"),
    ],
    implementation_contract: implementationContract({
      feature: "selected fast EMA, selected slow EMA, optional fast-EMA slope, and distance of candle extreme from fast EMA in ATR14",
      signal: "trend side requires close relative to fast EMA, optional EMA stack and slope, plus pullback touch within pullback_atr",
      stop: "beyond min(signal low, fast EMA) for long or max(signal high, fast EMA) for short by stop_atr*ATR14",
    }),
  }),
  capability({
    canonical_node_id: "canonical:carry/funding-carry/funding-carry",
    family_id: "funding_carry_v1",
    replay_coverage: "ready",
    required_data: ["funding", "ohlcv"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      integerAxis("funding_lookback_events", 1),
      numberAxis("min_abs_funding_rate", 0, false),
      numberAxis("stop_atr", 0, false),
      numberAxis("max_risk_atr", 0, false),
      numberAxis("reward_risk", 0, false),
      numberAxis("break_even_after_r", 0),
      numberAxis("break_even_offset_r", 0),
    ],
    implementation_contract: implementationContract({
      feature: "trailing average of the latest funding_lookback_events visible at the signal candle plus ATR14",
      signal: "short positive average funding or long negative average funding when absolute threshold is met",
      stop: "long: signal candle low - stop_atr*ATR14; short: signal candle high + stop_atr*ATR14",
      breakEven: true,
    }),
  }),
  capability({
    canonical_node_id: "canonical:carry/funding-carry/crowded-funding-unwind",
    family_id: "funding_unwind_risk_guard_v1",
    replay_coverage: "ready",
    required_data: ["funding", "ohlcv", "open-interest"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      integerAxis("funding_lookback_events", 1),
      numberAxis("min_abs_funding_rate", 0, false),
      numberAxis("stop_atr", 0, false),
      numberAxis("max_risk_atr", 0, false),
      numberAxis("reward_risk", 0, false),
      numberAxis("vfi_weak_max"),
      numberAxis("chopiness_min"),
      integerAxis("cooldown_bars", 0),
      integerAxis("adverse_lookback_bars", 1),
      numberAxis("max_adverse_move_atr", 0, false),
      numberAxis("max_short_close_location"),
      numberAxis("min_long_close_location"),
    ],
    implementation_contract: implementationContract({
      feature: "trailing funding average, VFI, chopiness, recent ATR-normalized move, close location, and deterministic index cooldown",
      signal: "contrarian funding side only when all VFI, chopiness, adverse-move, close-location, factor, and cooldown guards pass",
      stop: "long: signal candle low - stop_atr*ATR14; short: signal candle high + stop_atr*ATR14",
    }),
  }),
  capability({
    canonical_node_id: "canonical:volatility/volatility-regime-transition/volatility-compression-breakout",
    family_id: "volatility_compression_breakout_v1",
    replay_coverage: "ready",
    required_data: ["ohlcv"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      integerAxis("breakout_bars", 1),
      integerAxis("compression_bars", 1),
      numberAxis("compression_percentile", 0, false),
      numberAxis("stop_atr", 0, false),
      numberAxis("max_risk_atr", 0, false),
      numberAxis("reward_risk", 0, false),
    ],
    implementation_contract: implementationContract({
      feature: "prior ATR14/close compression percentile over compression_bars and prior breakout high/low over breakout_bars",
      signal: "current close breaks the prior range only when previous normalized ATR is at or below the declared compression percentile",
      stop: "long: signal candle low - stop_atr*ATR14; short: signal candle high + stop_atr*ATR14",
    }),
  }),
] as const

export function readStrategyFamilyCapability(
  canonicalNodeId: string,
): StrategyFamilyCapability | null {
  return CAPABILITIES.find((item) => item.canonical_node_id === canonicalNodeId) ?? null
}

export function listStrategyFamilyCapabilities(): StrategyFamilyCapability[] {
  return CAPABILITIES.map((item) => structuredClone(item))
}

export function assessCandidateSpaceCompatibility(
  candidateSpace: JSONRecord,
  family: StrategyFamilyCapability,
): CandidateSpaceCompatibility {
  const supported = new Map(family.parameter_axes.map((axis) => [axis.name, axis]))
  const unsupportedAxes: string[] = []
  const invalidAxes: string[] = []
  for (const [name, choices] of Object.entries(candidateSpace).sort(([left], [right]) => left.localeCompare(right))) {
    const axis = supported.get(name)
    if (!axis) {
      unsupportedAxes.push(name)
      continue
    }
    if (!Array.isArray(choices) || choices.length === 0
      || choices.some((choice) => !axisAccepts(axis, choice))) {
      invalidAxes.push(name)
    }
  }
  return {
    compatible: unsupportedAxes.length === 0 && invalidAxes.length === 0,
    unsupported_axes: unsupportedAxes,
    invalid_axes: invalidAxes,
  }
}

function capability(input: Omit<
  StrategyFamilyCapabilityBody,
  "schema_version" | "implementation_version" | "runtime_coverage" | "module_ref"
>): StrategyFamilyCapability {
  const body: StrategyFamilyCapabilityBody = {
    schema_version: STRATEGY_FAMILY_CAPABILITY_SCHEMA_VERSION,
    canonical_node_id: input.canonical_node_id,
    family_id: input.family_id,
    implementation_version: "v1",
    replay_coverage: input.replay_coverage,
    runtime_coverage: "missing",
    required_data: [...input.required_data].sort(),
    parameter_axes: [...input.parameter_axes].sort((left, right) => left.name.localeCompare(right.name)),
    implementation_contract: structuredClone(input.implementation_contract),
    module_ref: MODULE_REF,
  }
  return { ...body, capability_hash: canonicalHash(body) }
}

function implementationContract(input: {
  feature: string
  signal: string
  stop: string
  breakEven?: boolean
}): StrategyFamilyCapabilityBody["implementation_contract"] {
  return {
    feature_definition: {
      source: "statically_registered_family_implementation",
      formula: input.feature,
      visibility: "closed_candle_only",
    },
    signal_definition: {
      source: "statically_registered_family_implementation",
      rule: input.signal,
    },
    position_rule: {
      source: "replay_harness_not_family",
      scope: "family emits one directional signal with entry, stop, target, and entry_risk_limit; quantity and overlapping-position policy bind in Replay execution",
    },
    risk_rule: {
      stop: input.stop,
      entry_risk_gate: "reject unless 0 < abs(entry-stop) <= max_risk_atr*ATR14",
      target: "entry plus or minus abs(entry-stop)*reward_risk",
      break_even: input.breakEven
        ? "enabled only when break_even_after_r > 0, using break_even_offset_r"
        : "not implemented by this family",
    },
    execution_rule: {
      decision: "family evaluates one closed signal candle",
      entry: "entry_index and decisionPrice are supplied by the Replay harness; the experiment contract binds earliest execution to next open",
      order_authority: "family emits a signal only and has no exchange-write authority",
    },
  }
}

function enumAxis(
  name: string,
  allowedValues: Array<string | number | boolean>,
): StrategyFamilyParameterAxis {
  const first = allowedValues[0]
  return {
    name,
    value_type: typeof first === "number"
      ? "number"
      : typeof first === "boolean"
        ? "boolean"
        : "string",
    allowed_values: [...allowedValues],
  }
}

function integerAxis(name: string, minimum: number): StrategyFamilyParameterAxis {
  return { name, value_type: "integer", minimum }
}

function numberAxis(
  name: string,
  minimum?: number,
  inclusive = true,
): StrategyFamilyParameterAxis {
  return {
    name,
    value_type: "number",
    ...(minimum == null ? {} : {
      minimum,
      ...(inclusive ? {} : { exclusive_minimum: true }),
    }),
  }
}

function booleanAxis(name: string): StrategyFamilyParameterAxis {
  return { name, value_type: "boolean" }
}

function axisAccepts(axis: StrategyFamilyParameterAxis, value: unknown): boolean {
  if (axis.allowed_values && !axis.allowed_values.some((allowed) => Object.is(allowed, value))) {
    return false
  }
  if (axis.value_type === "boolean") return typeof value === "boolean"
  if (axis.value_type === "string") return typeof value === "string" && value.length > 0
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  if (axis.value_type === "integer" && !Number.isSafeInteger(value)) return false
  if (axis.minimum == null) return true
  return axis.exclusive_minimum ? value > axis.minimum : value >= axis.minimum
}

export const DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION =
  "trade.rd-developer-data-snapshot-binding.v2" as const

export interface DeveloperDataSnapshotBindingBody extends JSONRecord {
  schema_version: typeof DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION
  snapshot_ref: string
  snapshot_hash: string
  dataset_kinds: string[]
  hypothesis_id: string
  symbol: string
  exchange: string
  segment: "discovery" | "validation"
  timeframe: string
  manifest_ref: string
  evidence_ref: string
}

export interface DeveloperDataSnapshotBinding extends DeveloperDataSnapshotBindingBody {
  binding_hash: string
}

export function createDeveloperDataSnapshotBinding(
  input: DeveloperDataSnapshotBindingBody,
): DeveloperDataSnapshotBinding {
  if (input.schema_version !== DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION) {
    throw new Error("Developer data snapshot binding schema is unsupported")
  }
  const body: DeveloperDataSnapshotBindingBody = {
    schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
    snapshot_ref: nonempty(input.snapshot_ref, "snapshot_ref"),
    snapshot_hash: digest(input.snapshot_hash, "snapshot_hash"),
    dataset_kinds: uniqueStrings(input.dataset_kinds, "dataset_kinds"),
    hypothesis_id: nonempty(input.hypothesis_id, "hypothesis_id"),
    symbol: nonempty(input.symbol, "symbol"),
    exchange: nonempty(input.exchange, "exchange"),
    segment: dataSegment(input.segment),
    timeframe: nonempty(input.timeframe, "timeframe"),
    manifest_ref: nonempty(input.manifest_ref, "manifest_ref"),
    evidence_ref: nonempty(input.evidence_ref, "evidence_ref"),
  }
  return { ...body, binding_hash: canonicalHash(body) }
}

function uniqueStrings(values: string[], field: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`)
  const normalized = values.map((value) => nonempty(value, field)).sort()
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must be non-empty and unique`)
  }
  return normalized
}

function digest(value: string, field: string): string {
  const normalized = nonempty(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
  return normalized
}

function dataSegment(value: string): "discovery" | "validation" {
  if (value !== "discovery" && value !== "validation") {
    throw new Error("Developer data snapshot segment is unsupported")
  }
  return value
}

function nonempty(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(`${field} is required`)
  }
  return value
}
