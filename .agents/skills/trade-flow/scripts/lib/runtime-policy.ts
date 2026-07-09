import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { asRecord, numberField, stringField, type JSONRecord } from "./json"

type PermissionStage = "observe_only" | "paper_shadow" | "live-small"

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
  return { trading_config: tradingConfig, runtime_policy: runtimePolicy }
}

function compileRuntimePolicy(config: JSONRecord, options: { sourceRef?: string; warnings?: string[]; now?: string } = {}): RuntimePolicy {
  const risk = asRecord(config.risk)
  const exposure = asRecord(config.exposure)
  const execution = asRecord(config.execution)
  const research = asRecord(config.research)
  const permissions = asRecord(config.permissions)
  const maxOpenRiskPct = positiveNumber(risk.max_open_risk_pct)
  const maxDayLossPct = positiveNumber(risk.max_day_loss_pct)
  const defaultBtcNetRiskPct = maxOpenRiskPct != null ? round(maxOpenRiskPct * 1.5) : undefined
  const defaultBtcGrossRiskPct = maxOpenRiskPct != null ? round(maxOpenRiskPct * 2) : undefined
  return {
    schema_version: "runtime-policy.v1",
    profile_id: stringField(config.profile_id) || "default",
    mode: stringField(config.mode) || "dry_run",
    source_hash: `sha256:${hashCanonical(config)}`,
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
    }),
    cost_model: removeUndefined({
      fee_bps: nonNegativeNumber(research.default_fee_bps),
      slippage_bps: nonNegativeNumber(research.default_slippage_bps),
      adverse_funding_bps_per_8h: nonNegativeNumber(research.default_adverse_funding_bps_per_8h),
      slippage_buffer_pct: nonNegativeNumber(execution.slippage_buffer_pct),
    }),
    permissions: {
      can_observe: true,
      can_shadow: stageAllowsShadow(stringField(permissions.max_stage)),
      can_live_small: permissions.live_small_enabled === true && stringField(config.mode) === "live" && stringField(permissions.max_stage) === "live-small",
      max_stage: readPermissionStage(permissions.max_stage),
    },
    applied_overrides: options.sourceRef ? [`config:${options.sourceRef}`] : [],
    warnings: options.warnings || [],
  }
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

function readPermissionStage(value: unknown): PermissionStage {
  const stage = stringField(value)
  if (stage === "observe_only" || stage === "paper_shadow" || stage === "live-small") return stage
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
