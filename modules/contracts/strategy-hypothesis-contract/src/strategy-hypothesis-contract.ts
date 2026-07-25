type JSONRecord = Record<string, unknown>

interface StrategyHypothesisLintResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

const CONTRACT_SCHEMA_VERSION = "trade-flow.strategy-hypothesis-contract.v1" as const
const DESIGNER_TOOL_ID = "research.strategy-hypothesis-designer" as const

function lintStrategyHypothesisContract(value: unknown): StrategyHypothesisLintResult {
  const contract = asRecord(value)
  const errors: string[] = []
  const warnings: string[] = []
  if (stringField(contract.schema_version) !== CONTRACT_SCHEMA_VERSION) errors.push(`schema_version must be ${CONTRACT_SCHEMA_VERSION}`)
  requireText(contract, "hypothesis_id", errors)
  requireText(contract, "title", errors)
  requireText(contract, "return_driver", errors)
  requireText(contract, "portfolio_shape", errors)
  requireStringArray(contract, "data_surfaces", errors)
  requireNestedTexts(contract, "thesis", ["mechanism", "behavioral_claim", "participants", "regime", "falsification"], errors)
  requireNestedTexts(contract, "trade_logic", ["timeframe", "side", "entry", "exit", "risk"], errors)
  requireNestedArray(contract, "evidence_plan", "primary_tests", errors)
  requireNestedArray(contract, "evidence_plan", "negative_controls", errors)
  requireNestedTexts(contract, "evidence_plan", ["validation_plan", "promotion_boundary"], errors)

  const compilation = asRecord(contract.compilation)
  const requiresNewFamily = compilation.requires_new_family === true
  const targetFamily = stringField(compilation.target_family)
  if (!requiresNewFamily && !targetFamily) errors.push("compilation.target_family is required unless requires_new_family is true")
  if (requiresNewFamily && targetFamily) warnings.push("requires_new_family=true should not also bind target_family")

  const hints = asRecord(compilation.candidate_param_hints)
  const hintCount = Object.keys(hints).length
  if (hintCount > 8) warnings.push(`candidate_param_hints has ${hintCount} keys; candidate batch max_parameter_count is 8`)

  const text = JSON.stringify(contract)
  if (/\b(TODO|TBD|placeholder)\b/i.test(text)) errors.push("contract must not contain TODO/TBD/placeholder text")
  if (nonEmptyStrings(asRecord(contract.evidence_plan).negative_controls).length < 1) errors.push("evidence_plan.negative_controls must include at least one mechanism-specific negative control")
  return { valid: errors.length === 0, errors, warnings }
}

function strategyHypothesisToQueueItem(value: unknown): JSONRecord {
  const lint = lintStrategyHypothesisContract(value)
  if (!lint.valid) {
    throw new Error(`strategy hypothesis contract failed lint: ${lint.errors.join("; ")}`)
  }
  const contract = asRecord(value)
  const compilation = asRecord(contract.compilation)
  const dataBinding = asRecord(contract.data_binding)
  const constraints = asRecord(contract.constraints)
  const targetFamily = stringField(compilation.target_family)
  const requiresNewFamily = compilation.requires_new_family === true
  const mode = stringField(compilation.mode) || "loop"
  const manifestPath = stringField(dataBinding.manifest_path) || stringField(dataBinding.discovery_manifest_path)
  const candidateParams = asRecord(compilation.candidate_param_hints)
  const blockedReason = queueBlockedReason(mode, requiresNewFamily, targetFamily, manifestPath, candidateParams)
  const hypothesisId = safeID(stringField(contract.hypothesis_id))
  return compactRecord({
    hypothesis_id: hypothesisId,
    source: DESIGNER_TOOL_ID,
    ready: blockedReason ? false : true,
    blocked_reason: blockedReason,
    mode,
    hypothesis: stringField(asRecord(contract.thesis).behavioral_claim) || stringField(contract.title),
    return_driver: stringField(contract.return_driver),
    portfolio_shape: stringField(contract.portfolio_shape),
    data_surface: nonEmptyStrings(contract.data_surfaces),
    manifest_path: manifestPath,
    validation_manifest_path: stringField(dataBinding.validation_manifest_path),
    indicator_report_path: stringField(dataBinding.indicator_report_path),
    validation_indicator_report_path: stringField(dataBinding.validation_indicator_report_path),
    timeframe: stringField(asRecord(contract.trade_logic).timeframe),
    search_trial_count: positiveInteger(constraints.search_trial_count, 1),
    max_total_trials: positiveInteger(constraints.max_total_trials, 1),
    max_factors_per_candidate: positiveInteger(constraints.max_factors_per_candidate, 0) || undefined,
    thesis_certificate: thesisCertificate(contract),
    candidates: targetFamily ? [{
      candidate_id: `${hypothesisId}-base`,
      description: stringField(contract.title),
      family: targetFamily,
      parameter_count: Object.keys(candidateParams).length || undefined,
      params: candidateParams,
    }] : [],
    design_contract: {
      schema_version: CONTRACT_SCHEMA_VERSION,
      hypothesis_id: hypothesisId,
      title: stringField(contract.title),
      evidence_plan: asRecord(contract.evidence_plan),
      compilation: {
        target_family: targetFamily || undefined,
        requires_new_family: requiresNewFamily,
      },
    },
  })
}

function queueBlockedReason(mode: string, requiresNewFamily: boolean, targetFamily: string, manifestPath: string, params: JSONRecord): string {
  if (requiresNewFamily) return "family_design_required_before_strategy_trials"
  if (mode === "panel_research") return "panel_research_requires_panel_evaluator_before_supervisor_strategy_trials"
  if (!targetFamily) return "target_family_required_before_strategy_trials"
  if (!manifestPath) return "manifest_path_required_before_strategy_trials"
  if (Object.keys(params).length === 0) return "candidate_param_hints_required_before_strategy_trials"
  return ""
}

function thesisCertificate(contract: JSONRecord): JSONRecord {
  const thesis = asRecord(contract.thesis)
  const evidence = asRecord(contract.evidence_plan)
  const tradeLogic = asRecord(contract.trade_logic)
  return compactRecord({
    edge_type: stringField(contract.return_driver),
    behavioral_hypothesis: stringField(thesis.behavioral_claim),
    mechanism: stringField(thesis.mechanism),
    market_participants: stringField(thesis.participants),
    regime: stringField(thesis.regime),
    invalidation: stringField(thesis.falsification),
    cost_sensitivity: stringField(asRecord(contract.risk).cost_sensitivity),
    candidate_universe: asRecord(contract.universe),
    trade_logic: tradeLogic,
    negative_controls: nonEmptyStrings(evidence.negative_controls),
    promotion_boundary: stringField(evidence.promotion_boundary),
  })
}

function requireText(record: JSONRecord, key: string, errors: string[]): void {
  if (!stringField(record[key])) errors.push(`${key} is required`)
}

function requireStringArray(record: JSONRecord, key: string, errors: string[]): void {
  if (nonEmptyStrings(record[key]).length === 0) errors.push(`${key} must be a non-empty string array`)
}

function requireNestedTexts(record: JSONRecord, key: string, fields: string[], errors: string[]): void {
  const nested = asRecord(record[key])
  if (Object.keys(nested).length === 0) {
    errors.push(`${key} is required`)
    return
  }
  for (const field of fields) {
    if (!stringField(nested[field])) errors.push(`${key}.${field} is required`)
  }
}

function requireNestedArray(record: JSONRecord, key: string, field: string, errors: string[]): void {
  const nested = asRecord(record[key])
  if (nonEmptyStrings(nested[field]).length === 0) errors.push(`${key}.${field} must be a non-empty string array`)
}

function compactRecord(record: JSONRecord): JSONRecord {
  for (const [key, value] of Object.entries(record)) {
    if (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as JSONRecord).length === 0)
    ) {
      delete record[key]
    }
  }
  return record
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function nonEmptyStrings(value: unknown): string[] {
  return array(value).map(String).map((item) => item.trim()).filter(Boolean)
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function safeID(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
  let start = 0
  let end = normalized.length
  while (normalized[start] === "-") start += 1
  while (end > start && normalized[end - 1] === "-") end -= 1
  return normalized.slice(start, end) || "strategy-hypothesis"
}

export {
  CONTRACT_SCHEMA_VERSION,
  DESIGNER_TOOL_ID,
  lintStrategyHypothesisContract,
  strategyHypothesisToQueueItem,
  type StrategyHypothesisLintResult,
}
