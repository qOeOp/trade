import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { asRecord, numberField, stringField, type JSONRecord } from "./json"

type PermissionStage = "observe_only" | "paper_shadow" | "live-small"

const HARD_LIMITS = {
  max_single_trade_risk_usdt: 1000,
  max_open_risk_usdt: 5000,
  max_day_loss_usdt: 5000,
  max_open_risk_pct: 0.2,
  max_day_loss_pct: 0.2,
  max_concurrent_risk_flows: 20,
  max_entry_notional_usdt: 100000,
  max_symbol_notional_usdt: 200000,
  max_gross_notional_usdt: 500000,
  max_single_position_leverage: 10,
  max_gross_exposure: 10,
  max_btc_equiv_net_risk_pct: 0.5,
  max_btc_equiv_gross_risk_pct: 1,
  max_funding_rate_pct: 0.01,
  max_funding_erosion_ratio: 1,
  max_open_actions_per_cycle: 5,
  max_open_actions_per_hour: 20,
  reentry_cooldown_minutes: 240,
  min_hold_minutes_before_noise_close: 240,
  default_fee_bps: 50,
  default_slippage_bps: 100,
  default_adverse_funding_bps_per_8h: 100,
  slippage_buffer_pct: 0.05,
} as const

interface RuntimePolicyLoadInput {
  tradingConfigPath?: string
  accountConfigPath?: string
  notifyConfigPath?: string
  now?: string
}

interface RuntimePolicy {
  schema_version: "runtime-policy.v1"
  profile_id: string
  mode: string
  source_hash: string
  compiled_at: string
  effective_limits: JSONRecord
  cost_model: JSONRecord
  permissions: JSONRecord
  applied_overrides: string[]
  warnings: string[]
}

function loadRuntimePolicy(input: RuntimePolicyLoadInput): { trading_config: JSONRecord; runtime_policy: RuntimePolicy } {
  const tradingConfigPath = resolveTradingConfigPath(input)
  const accountConfigPath = input.accountConfigPath || "./profile/account_config.json"
  const notifyConfigPath = input.notifyConfigPath || join(dirname(accountConfigPath), "notify_config.json")
  const warnings: string[] = []
  const tradingConfig = existsSync(tradingConfigPath)
    ? readJsonFile(tradingConfigPath)
    : tradingConfigFromLegacy(accountConfigPath, notifyConfigPath, warnings)
  const runtimePolicy = compileRuntimePolicy(tradingConfig, {
    sourceRef: existsSync(tradingConfigPath) ? tradingConfigPath : accountConfigPath,
    warnings,
    now: input.now,
  })
  return { trading_config: normalizeTradingConfig(tradingConfig, []), runtime_policy: runtimePolicy }
}

function compileRuntimePolicy(config: JSONRecord, options: { sourceRef?: string; warnings?: string[]; now?: string } = {}): RuntimePolicy {
  const warnings = [...(options.warnings || [])]
  const normalized = normalizeTradingConfig(config, warnings)
  const risk = asRecord(normalized.risk)
  const exposure = asRecord(normalized.exposure)
  const execution = asRecord(normalized.execution)
  const research = asRecord(normalized.research)
  const permissions = asRecord(normalized.permissions)
  const maxOpenRiskPct = positiveNumber(risk.max_open_risk_pct)
  const maxDayLossPct = positiveNumber(risk.max_day_loss_pct)
  const defaultBtcNetRiskPct = maxOpenRiskPct != null ? round(maxOpenRiskPct * 1.5) : undefined
  const defaultBtcGrossRiskPct = maxOpenRiskPct != null ? round(maxOpenRiskPct * 2) : undefined
  const mode = stringField(normalized.mode) || "dry_run"
  const maxStage = readPermissionStage(permissions.max_stage)
  return {
    schema_version: "runtime-policy.v1",
    profile_id: stringField(normalized.profile_id) || "default",
    mode,
    source_hash: `sha256:${hashCanonical(normalized)}`,
    compiled_at: options.now || new Date().toISOString(),
    effective_limits: removeUndefined({
      max_single_trade_risk_usdt: positiveNumber(risk.max_single_trade_risk_usdt),
      max_open_risk_usdt: positiveNumber(risk.max_open_risk_usdt),
      max_day_loss_usdt: positiveNumber(risk.max_day_loss_usdt),
      max_open_risk_pct: maxOpenRiskPct,
      max_day_loss_pct: maxDayLossPct,
      max_concurrent_risk_flows: positiveInteger(risk.max_concurrent_risk_flows),
      max_entry_notional_usdt: positiveNumber(exposure.max_entry_notional_usdt),
      max_symbol_notional_usdt: positiveNumber(exposure.max_symbol_notional_usdt),
      max_gross_notional_usdt: positiveNumber(exposure.max_gross_notional_usdt),
      max_single_position_leverage: positiveNumber(exposure.max_single_position_leverage),
      max_gross_exposure: positiveNumber(exposure.max_gross_exposure),
      max_btc_equiv_net_risk_pct: positiveNumber(exposure.max_btc_equiv_net_risk_pct) || defaultBtcNetRiskPct,
      max_btc_equiv_gross_risk_pct: positiveNumber(exposure.max_btc_equiv_gross_risk_pct) || defaultBtcGrossRiskPct,
      max_funding_rate_pct: positiveNumber(execution.max_funding_rate_pct),
      max_funding_erosion_ratio: positiveNumber(execution.max_funding_erosion_ratio),
      max_open_actions_per_cycle: positiveInteger(execution.max_open_actions_per_cycle),
      max_open_actions_per_hour: positiveInteger(execution.max_open_actions_per_hour),
      reentry_cooldown_minutes: positiveInteger(execution.reentry_cooldown_minutes),
      min_hold_minutes_before_noise_close: positiveInteger(execution.min_hold_minutes_before_noise_close),
    }),
    cost_model: removeUndefined({
      fee_bps: nonNegativeNumber(research.default_fee_bps),
      slippage_bps: nonNegativeNumber(research.default_slippage_bps),
      adverse_funding_bps_per_8h: nonNegativeNumber(research.default_adverse_funding_bps_per_8h),
      slippage_buffer_pct: nonNegativeNumber(execution.slippage_buffer_pct),
    }),
    permissions: {
      can_observe: true,
      can_shadow: stageAllowsShadow(maxStage),
      can_live_small: permissions.live_small_enabled === true && mode === "live" && maxStage === "live-small",
      max_stage: maxStage,
    },
    applied_overrides: options.sourceRef ? [`config:${options.sourceRef}`] : [],
    warnings,
  }
}

function normalizeTradingConfig(config: JSONRecord, warnings: string[]): JSONRecord {
  return removeUndefined({
    ...config,
    profile_id: stringField(config.profile_id) || "default",
    mode: normalizeMode(config.mode, warnings),
    permissions: normalizePermissions(asRecord(config.permissions), warnings),
    risk: normalizeRisk(asRecord(config.risk), warnings),
    exposure: normalizeExposure(asRecord(config.exposure), warnings),
    execution: normalizeExecution(asRecord(config.execution), warnings),
    research: normalizeResearch(asRecord(config.research), warnings),
    lanes: normalizeLanes(config.lanes, warnings),
  })
}

function normalizeMode(value: unknown, warnings: string[]): string {
  const raw = stringField(value).toLowerCase()
  if (!raw || raw === "dry-run") return "dry_run"
  if (raw === "live" || raw === "dry_run" || raw === "shadow") return raw
  warnings.push(`normalized mode ${String(value)} to dry_run`)
  return "dry_run"
}

function normalizePermissions(permissions: JSONRecord, warnings: string[]): JSONRecord {
  return removeUndefined({
    ...permissions,
    live_small_enabled: permissions.live_small_enabled === true,
    max_stage: readPermissionStage(permissions.max_stage, warnings),
  })
}

function normalizeRisk(risk: JSONRecord, warnings: string[]): JSONRecord {
  return removeUndefined({
    ...risk,
    max_single_trade_risk_usdt: clampPositive(risk.max_single_trade_risk_usdt, "risk.max_single_trade_risk_usdt", HARD_LIMITS.max_single_trade_risk_usdt, warnings),
    max_open_risk_usdt: clampPositive(risk.max_open_risk_usdt, "risk.max_open_risk_usdt", HARD_LIMITS.max_open_risk_usdt, warnings),
    max_day_loss_usdt: clampPositive(risk.max_day_loss_usdt, "risk.max_day_loss_usdt", HARD_LIMITS.max_day_loss_usdt, warnings),
    max_open_risk_pct: clampPositive(risk.max_open_risk_pct, "risk.max_open_risk_pct", HARD_LIMITS.max_open_risk_pct, warnings),
    max_day_loss_pct: clampPositive(risk.max_day_loss_pct, "risk.max_day_loss_pct", HARD_LIMITS.max_day_loss_pct, warnings),
    max_concurrent_risk_flows: clampPositiveInteger(risk.max_concurrent_risk_flows, "risk.max_concurrent_risk_flows", HARD_LIMITS.max_concurrent_risk_flows, warnings),
  })
}

function normalizeExposure(exposure: JSONRecord, warnings: string[]): JSONRecord {
  return removeUndefined({
    ...exposure,
    max_entry_notional_usdt: clampPositive(exposure.max_entry_notional_usdt, "exposure.max_entry_notional_usdt", HARD_LIMITS.max_entry_notional_usdt, warnings),
    max_symbol_notional_usdt: clampPositive(exposure.max_symbol_notional_usdt, "exposure.max_symbol_notional_usdt", HARD_LIMITS.max_symbol_notional_usdt, warnings),
    max_gross_notional_usdt: clampPositive(exposure.max_gross_notional_usdt, "exposure.max_gross_notional_usdt", HARD_LIMITS.max_gross_notional_usdt, warnings),
    max_single_position_leverage: clampPositive(exposure.max_single_position_leverage, "exposure.max_single_position_leverage", HARD_LIMITS.max_single_position_leverage, warnings),
    max_gross_exposure: clampPositive(exposure.max_gross_exposure, "exposure.max_gross_exposure", HARD_LIMITS.max_gross_exposure, warnings),
    max_btc_equiv_net_risk_pct: clampPositive(exposure.max_btc_equiv_net_risk_pct, "exposure.max_btc_equiv_net_risk_pct", HARD_LIMITS.max_btc_equiv_net_risk_pct, warnings),
    max_btc_equiv_gross_risk_pct: clampPositive(exposure.max_btc_equiv_gross_risk_pct, "exposure.max_btc_equiv_gross_risk_pct", HARD_LIMITS.max_btc_equiv_gross_risk_pct, warnings),
  })
}

function normalizeExecution(execution: JSONRecord, warnings: string[]): JSONRecord {
  return removeUndefined({
    ...execution,
    max_funding_rate_pct: clampPositive(execution.max_funding_rate_pct, "execution.max_funding_rate_pct", HARD_LIMITS.max_funding_rate_pct, warnings),
    max_funding_erosion_ratio: clampPositive(execution.max_funding_erosion_ratio, "execution.max_funding_erosion_ratio", HARD_LIMITS.max_funding_erosion_ratio, warnings),
    max_open_actions_per_cycle: clampPositiveInteger(execution.max_open_actions_per_cycle, "execution.max_open_actions_per_cycle", HARD_LIMITS.max_open_actions_per_cycle, warnings),
    max_open_actions_per_hour: clampPositiveInteger(execution.max_open_actions_per_hour, "execution.max_open_actions_per_hour", HARD_LIMITS.max_open_actions_per_hour, warnings),
    reentry_cooldown_minutes: clampPositiveInteger(execution.reentry_cooldown_minutes, "execution.reentry_cooldown_minutes", HARD_LIMITS.reentry_cooldown_minutes, warnings),
    min_hold_minutes_before_noise_close: clampPositiveInteger(execution.min_hold_minutes_before_noise_close, "execution.min_hold_minutes_before_noise_close", HARD_LIMITS.min_hold_minutes_before_noise_close, warnings),
    slippage_buffer_pct: clampNonNegative(execution.slippage_buffer_pct, "execution.slippage_buffer_pct", HARD_LIMITS.slippage_buffer_pct, warnings),
  })
}

function normalizeResearch(research: JSONRecord, warnings: string[]): JSONRecord {
  return removeUndefined({
    ...research,
    default_fee_bps: clampNonNegative(research.default_fee_bps, "research.default_fee_bps", HARD_LIMITS.default_fee_bps, warnings),
    default_slippage_bps: clampNonNegative(research.default_slippage_bps, "research.default_slippage_bps", HARD_LIMITS.default_slippage_bps, warnings),
    default_adverse_funding_bps_per_8h: clampNonNegative(research.default_adverse_funding_bps_per_8h, "research.default_adverse_funding_bps_per_8h", HARD_LIMITS.default_adverse_funding_bps_per_8h, warnings),
  })
}

function normalizeLanes(value: unknown, warnings: string[]): JSONRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((lane) => lane && typeof lane === "object").map((lane, index) => {
    const record = lane as JSONRecord
    const side = stringField(record.side).toLowerCase()
    return removeUndefined({
      ...record,
      lane_id: stringField(record.lane_id) || stringField(record.id) || `lane-${index + 1}`,
      enabled: record.enabled !== false,
      side: side === "long" || side === "short" ? side : undefined,
      max_entry_notional_usdt: clampPositive(record.max_entry_notional_usdt, `lanes[${index}].max_entry_notional_usdt`, HARD_LIMITS.max_entry_notional_usdt, warnings),
      max_single_trade_risk_usdt: clampPositive(record.max_single_trade_risk_usdt, `lanes[${index}].max_single_trade_risk_usdt`, HARD_LIMITS.max_single_trade_risk_usdt, warnings),
    })
  })
}

function compactPolicySnapshot(policy: RuntimePolicy): JSONRecord {
  return {
    schema_version: policy.schema_version,
    profile_id: policy.profile_id,
    mode: policy.mode,
    source_hash: policy.source_hash,
    effective_limits: policy.effective_limits,
    cost_model: policy.cost_model,
    permissions: policy.permissions,
    warnings: policy.warnings,
  }
}

function resolveTradingConfigPath(input: RuntimePolicyLoadInput): string {
  if (input.tradingConfigPath) return input.tradingConfigPath
  if (input.accountConfigPath) return join(dirname(input.accountConfigPath), "trading-config.json")
  return "./profile/trading-config.json"
}

function tradingConfigFromLegacy(accountConfigPath: string, notifyConfigPath: string, warnings: string[]): JSONRecord {
  warnings.push("trading-config missing; adapted legacy account_config/notify_config")
  const accountConfig = existsSync(accountConfigPath) ? readJsonFile(accountConfigPath) : {}
  const notifyConfig = existsSync(notifyConfigPath) ? readJsonFile(notifyConfigPath) : {}
  return {
    schema_version: 1,
    profile_id: "legacy-account-config",
    mode: "dry_run",
    permissions: { live_small_enabled: false, max_stage: "paper_shadow" },
    risk: {
      equity_source: "live_exchange_snapshot",
      max_open_risk_pct: positiveNumber(accountConfig.max_open_risk_pct),
      max_day_loss_pct: positiveNumber(accountConfig.max_day_loss_pct),
    },
    exposure: {
      max_single_position_leverage: positiveNumber(accountConfig.max_single_position_leverage),
      max_gross_exposure: positiveNumber(accountConfig.max_gross_exposure),
      max_btc_equiv_net_risk_pct: positiveNumber(accountConfig.max_btc_equiv_net_risk_pct),
      max_btc_equiv_gross_risk_pct: positiveNumber(accountConfig.max_btc_equiv_gross_risk_pct),
    },
    execution: {
      market: "usdm",
      default_margin_mode: "isolated",
      slippage_buffer_pct: nonNegativeNumber(accountConfig.slippage_buffer_pct),
      max_funding_rate_pct: positiveNumber(accountConfig.max_funding_rate_pct),
      max_funding_erosion_ratio: positiveNumber(accountConfig.max_funding_erosion_ratio),
      stop_price_protect: accountConfig.stop_price_protect === true,
    },
    research: {
      max_trials_per_campaign: 10,
      max_parameters_per_candidate: 8,
      default_fee_bps: 2,
      default_slippage_bps: 1,
      default_adverse_funding_bps_per_8h: 1,
      allow_auto_promote: false,
    },
    lanes: [],
    notifications: notifyConfig,
  }
}

function readJsonFile(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function readPermissionStage(value: unknown, warnings?: string[]): PermissionStage {
  const raw = stringField(value)
  const stage = raw.replace("_", "-")
  if (raw === "observe_only" || raw === "paper_shadow" || raw === "live-small") return raw
  if (stage === "paper-shadow") return "paper_shadow"
  if (stage === "live-small") return "live-small"
  if (value !== undefined && value !== null && value !== "" && warnings) {
    warnings.push(`normalized permissions.max_stage ${String(value)} to observe_only`)
  }
  return "observe_only"
}

function stageAllowsShadow(value: unknown): boolean {
  const stage = readPermissionStage(value)
  return stage === "paper_shadow" || stage === "live-small"
}

function positiveNumber(value: unknown): number | undefined {
  const number = numberField(value)
  return number > 0 ? number : undefined
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = numberField(value)
  return number >= 0 ? number : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const number = positiveNumber(value)
  return number != null ? Math.floor(number) : undefined
}

function clampPositive(value: unknown, path: string, max: number, warnings: string[]): number | undefined {
  return clampNumber(value, path, max, warnings, true, false)
}

function clampNonNegative(value: unknown, path: string, max: number, warnings: string[]): number | undefined {
  return clampNumber(value, path, max, warnings, false, false)
}

function clampPositiveInteger(value: unknown, path: string, max: number, warnings: string[]): number | undefined {
  const clamped = clampNumber(value, path, max, warnings, true, true)
  return clamped == null ? undefined : Math.floor(clamped)
}

function clampNumber(
  value: unknown,
  path: string,
  max: number,
  warnings: string[],
  positiveOnly: boolean,
  integerOnly: boolean,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    warnings.push(`ignored invalid ${path}: ${String(value)}`)
    return undefined
  }
  const min = positiveOnly ? Number.MIN_VALUE : 0
  if (parsed < min || (positiveOnly && parsed === 0)) {
    warnings.push(`ignored non-positive ${path}: ${parsed}`)
    return undefined
  }
  const capped = Math.min(parsed, max)
  const normalized = integerOnly ? Math.floor(capped) : round(capped)
  if (normalized !== parsed) {
    warnings.push(`clamped ${path} from ${parsed} to ${normalized}`)
  }
  return normalized
}

function removeUndefined(record: JSONRecord): JSONRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ""))
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as JSONRecord
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

export {
  compactPolicySnapshot,
  compileRuntimePolicy,
  loadRuntimePolicy,
  type RuntimePolicy,
}
