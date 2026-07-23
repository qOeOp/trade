import { canonicalHash } from "../../../../../../contracts/runtime-core/src/canonical-json"

type JSONRecord = Record<string, unknown>

export const STRATEGY_FAMILY_CAPABILITY_SCHEMA_VERSION =
  "trade.rd-strategy-family-capability.v1" as const

export interface StrategyFamilyParameterAxis {
  name: string
  value_type: "number" | "integer" | "boolean" | "string"
  minimum?: number
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
  }),
  capability({
    canonical_node_id: "canonical:trend/cross-sectional-momentum/relative-weakness-momentum",
    family_id: "relative_weakness_momentum_v1",
    replay_coverage: "partial",
    required_data: ["ohlcv"],
    parameter_axes: [
      enumAxis("side", ["long", "short", "both"]),
      enumAxis("signal_mode", ["relative_weakness", "relative_strength"]),
      enumAxis("confirmation_mode", ["none", "benchmark"]),
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
    module_ref: MODULE_REF,
  }
  return { ...body, capability_hash: canonicalHash(body) }
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
    ...(minimum == null ? {} : { minimum: inclusive ? minimum : Number.MIN_VALUE }),
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
  return axis.minimum == null || value >= axis.minimum
}
