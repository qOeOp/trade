type JSONRecord = Record<string, unknown>

interface StrategyPolicyCandidateSource {
  candidate_id: string
  family: string
  parameter_count?: number
  timeframe?: string
  validation_run_ref?: string
  params: JSONRecord
}

interface StrategyPolicySource {
  schema_version: "trade-flow.strategy-policy-source.v1"
  program_id: string
  objective: string
  drafted_at: string
  strategy_ref?: string
  evidence_refs?: string[]
  candidate: StrategyPolicyCandidateSource
}

interface StrategyPolicyShapeLintResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

interface StrategyFamilyPolicyProfile {
  tag: string
  edgeMechanism: string
  entryRule: string
  stopRule: string
  regimeRule: string
  triggerRule: string
}

const SOURCE_SCHEMA_VERSION = "trade-flow.strategy-policy-source.v1" as const

function renderStrategyPolicyMarkdown(source: StrategyPolicySource): string {
  assertStrategyPolicySource(source)
  const candidate = source.candidate
  const params = asRecord(candidate.params)
  const slug = strategyPolicySlug(candidate.candidate_id)
  const strategyID = strategyIDFromSlug(slug)
  const setupID = slug
  const timeframe = inferStrategyTimeframe(source)
  const familyProfile = strategyFamilyProfile(candidate.family, params)
  const validationRunRef = stringField(candidate.validation_run_ref) || "not recorded"
  const side = stringField(params.side) || "long"
  const candidateParams = Object.entries(params)
    .filter(([key, value]) => !riskParamKeys().has(key) && yamlScalarOrArray(value))
  const risk = {
    stop_atr: numberOrDefault(params.stop_atr, 1),
    max_risk_atr: numberOrDefault(params.max_risk_atr, 2),
    reward_risk: numberOrDefault(params.reward_risk, 2),
    max_hold_bars: numberOrDefault(params.max_hold_bars, 18),
  }
  const optionalRisk = ["break_even_after_r", "break_even_offset_r"]
    .filter((key) => Number.isFinite(Number(params[key])))
    .map((key) => `  ${key}: ${Number(params[key])}`)
  return `---
strategy_id: ${strategyID}
contract_schema_version: 1
name: ${titleFromSlug(slug)}
status: draft
tags: [rd, draft, ${timeframe}, ${familyProfile.tag}, ${side}]
---

# ${titleFromSlug(slug)}

This strategy was auto-drafted from a structured R&D policy source after a candidate survived the configured discovery and validation gates. It is a strategy policy draft: it preserves the research contract, execution boundaries, and proof requirements, but it does not authorize live-small trading by itself.

## Why This Edge

- Mechanism: ${familyProfile.edgeMechanism}
- Behavioral claim: ${source.objective}
- Execution premise: signals are generated from closed ${timeframe} candles; entries are delayed until the next executable open or equivalent quote.
- Falsification boundary: any replay, shadow, or review evidence that breaks cost resilience, parameter stability, OOS expectancy, or causal data availability invalidates this draft.

Research refs:

- Program: ${source.program_id}
- Objective: ${source.objective}
- Candidate: ${candidate.candidate_id}
- Family: ${candidate.family}
- Validation run: ${validationRunRef}
- Drafted at: ${source.drafted_at}
${evidenceRefLines(source.evidence_refs)}

## Research Decision

- Current status: \`draft\`.
- R&D decision: candidate passed the current R&D gate and may be written as a policy for governance review.
- Promotion boundary: this file is not shadow or live evidence; it must be compiled, replayed from the contract, reviewed, and explicitly promoted.
- Evidence gap to watch: the draft inherits the validation run, but future promotion must prove the compiled strategy reproduces the candidate behavior.

## Trade Contract

\`\`\`yaml
setup_id: ${setupID}
engine: rnd_family_v1
hypothesis: ${source.objective}
timeframe: ${timeframe}
family: ${candidate.family}
candidate:
${candidateParams.length > 0 ? candidateParams.map(([key, value]) => `  ${key}: ${yamlValue(value)}`).join("\n") : `  side: ${side}`}
risk:
  stop_atr: ${risk.stop_atr}
  max_risk_atr: ${risk.max_risk_atr}
  reward_risk: ${risk.reward_risk}
  max_hold_bars: ${risk.max_hold_bars}
${optionalRisk.length > 0 ? `${optionalRisk.join("\n")}\n` : ""}cost_model:
  fee_bps: 2
  slippage_bps: 1
  adverse_funding_bps_per_8h: 0
universe:
  source: rd_supervisor_validated_candidate
execution:
  entry_rule: ${familyProfile.entryRule}
  stop_rule: ${familyProfile.stopRule}
  target_rule: fixed ${risk.reward_risk}R research target unless a later governance-approved policy declares structure-first exits.
  no_trade_conditions: stale closed ${timeframe} data, missing required supplemental data, unresolved existing lane exposure, abnormal funding or spread, risk wider than ${risk.max_risk_atr} ATR, or setup not causally available before entry.
proof:
  evidence_ref: ${validationRunRef || source.strategy_ref || strategyID}
  live_permission: draft_only
  next_required_proof: compile this policy, replay the compiled contract, append evidence, then run strategy-review before any shadow promotion.
\`\`\`

## Required Inputs

- Closed OHLCV for the declared universe and \`${timeframe}\` timeframe.
- Exchange metadata for lot size, tick size, minimum notional, and order constraints.
- Mark/index price, spread, funding, and current lane exposure before any order is proposed.
- Any family-specific supplemental data required by \`${candidate.family}\` must be present before signal evaluation.

## Signal Stack

### 1. Regime and Eligibility

${familyProfile.regimeRule}

### 2. Trigger

${familyProfile.triggerRule}

### 3. Risk Shape

- Initial stop and target are built from the contract risk fields, not discretionary chart reading.
- Reject the setup if risk per unit exceeds \`${risk.max_risk_atr}\` ATR or if the next executable quote would materially worsen the researched R multiple.
- Use one active strategy lane unless a later portfolio policy explicitly permits overlapping exposure.

### 4. Execution Rule

- New risk must use the contract signal and executable quote model; do not chase with discretionary market entries.
- Entry, stop, target, and time exit must be reconstructable from data available before the decision.
- If live marketability differs from replay assumptions, output \`no_action\` and record the mismatch as review evidence.

## Sizing

\`\`\`text
risk_per_unit = abs(entry - stop)
quantity = risk_budget / risk_per_unit
quantity must satisfy exchange step, tick, min-notional, leverage, and portfolio exposure limits
\`\`\`

Draft and shadow stages should run at paper or explicitly approved small-risk size only. Any live-small sizing requires governance promotion outside this R&D writer.

## No-Trade Checklist

- Data is stale, incomplete, or not point-in-time safe.
- Spread, funding, volatility, or liquidity is outside the researched assumptions.
- The signal depends on information unavailable before the planned entry.
- Existing exposure already occupies the strategy lane.
- Contract risk cannot produce a valid exchange order.
- Fresh replay, shadow, or review evidence contradicts the validation run.

## Decision Output Contract

\`\`\`yaml
target_action: place_entry | no_action
strategy_id: ${strategyID}
setup_id: ${setupID}
evidence_ref: ${validationRunRef || source.strategy_ref || strategyID}
required_fields:
  - signal_time
  - entry
  - stop
  - target
  - quantity
  - invalidation_reason
\`\`\`
`
}

function lintStrategyPolicyShape(markdown: string): StrategyPolicyShapeLintResult {
  const errors: string[] = []
  const warnings: string[] = []
  for (const section of requiredPolicySections()) {
    if (!markdown.includes(section)) errors.push(`missing required section: ${section}`)
  }
  if (!/^---\n[\s\S]*?\n---\n/m.test(markdown)) errors.push("missing frontmatter block")
  if (!/## Trade Contract\n\n```yaml\n[\s\S]+?\n```/m.test(markdown)) errors.push("missing yaml Trade Contract block")
  if (!/live_permission:\s+draft_only/.test(markdown)) errors.push("Trade Contract proof.live_permission must be draft_only")
  let tagsInclude4h = false
  let tagsOffset = 0
  tagsSearch: while (true) {
    const tagsStart = markdown.indexOf("tags: [", tagsOffset)
    if (tagsStart < 0) break
    let valueOffset = tagsStart + "tags: [".length
    while (valueOffset < markdown.length) {
      if (markdown[valueOffset] === "]") {
        tagsOffset = valueOffset + 1
        continue tagsSearch
      }
      if (markdown[valueOffset] === "4" && markdown[valueOffset + 1] === "h") {
        tagsInclude4h = true
        break tagsSearch
      }
      valueOffset += 1
    }
    break
  }
  if (/timeframe:\s*4h/.test(markdown) && !tagsInclude4h) {
    warnings.push("timeframe is 4h but frontmatter tags do not include 4h")
  }
  if (/not recorded/.test(markdown)) warnings.push("validation_run_ref is not recorded")
  if (/TODO|TBD|placeholder/i.test(markdown)) errors.push("strategy policy must not contain TODO/TBD/placeholder text")
  return { valid: errors.length === 0, errors, warnings }
}

function assertStrategyPolicySource(source: StrategyPolicySource): void {
  if (source.schema_version !== SOURCE_SCHEMA_VERSION) throw new Error("strategy policy source schema_version is unsupported")
  if (!stringField(source.program_id)) throw new Error("strategy policy source program_id is required")
  if (!stringField(source.objective)) throw new Error("strategy policy source objective is required")
  if (!stringField(source.drafted_at)) throw new Error("strategy policy source drafted_at is required")
  if (!stringField(source.candidate?.candidate_id)) throw new Error("strategy policy source candidate.candidate_id is required")
  if (!stringField(source.candidate?.family)) throw new Error("strategy policy source candidate.family is required")
  if (!isRecord(source.candidate?.params)) throw new Error("strategy policy source candidate.params is required")
}

function requiredPolicySections(): string[] {
  return [
    "## Why This Edge",
    "Research refs:",
    "## Research Decision",
    "## Trade Contract",
    "## Required Inputs",
    "## Signal Stack",
    "### 1. Regime and Eligibility",
    "### 2. Trigger",
    "### 3. Risk Shape",
    "### 4. Execution Rule",
    "## Sizing",
    "## No-Trade Checklist",
    "## Decision Output Contract",
  ]
}

function evidenceRefLines(refs: string[] | undefined): string {
  const lines = (refs || []).map((ref) => stringField(ref)).filter(Boolean)
  return lines.length > 0 ? lines.map((ref) => `- Evidence ref: ${ref}`).join("\n") : ""
}

function inferStrategyTimeframe(source: StrategyPolicySource): string {
  const candidate = source.candidate
  const params = asRecord(candidate.params)
  const direct = stringField(candidate.timeframe) || stringField(params.timeframe)
  if (direct) return safeTimeframe(direct)
  const text = `${source.objective} ${candidate.candidate_id}`.toLowerCase()
  const match = text.match(/\b(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|1w)\b/)
  return safeTimeframe(match?.[1] || "4h")
}

function strategyFamilyProfile(family: string, params: JSONRecord): StrategyFamilyPolicyProfile {
  const side = stringField(params.side) || "long"
  const direction = side === "short" ? "bearish" : "bullish"
  switch (family) {
    case "trend_pullback_v1":
      return {
        tag: "trend-pullback",
        edgeMechanism: "trend continuation after a controlled pullback improves entry location versus chasing the impulse.",
        entryRule: `closed-candle ${direction} trend filter plus pullback location from trend_pullback_v1; enter next open or equivalent executable quote only.`,
        stopRule: "beyond pullback invalidation using ATR risk from the contract.",
        regimeRule: `Trade only when the trend stack supports the ${side} direction and price has pulled back into a defined risk area.`,
        triggerRule: "A closed candle must satisfy the family pullback condition; confirmation cannot override failed regime or invalid risk geometry.",
      }
    case "time_series_momentum_v1":
      return {
        tag: "momentum",
        edgeMechanism: "large directional moves may continue when impulse size, holding period, and cost drag remain within researched bounds.",
        entryRule: `closed-candle time-series momentum in the ${side} direction; enter next open or equivalent executable quote only.`,
        stopRule: "ATR stop from the signal candle or family-defined impulse invalidation.",
        regimeRule: `Trade only when the measured impulse supports ${side} continuation and volatility is inside the researched envelope.`,
        triggerRule: "Momentum threshold must be crossed on closed data; break-even behavior may activate only after the contract-defined R threshold.",
      }
    case "structure_breakout_retest_v1":
      return {
        tag: "structure-retest",
        edgeMechanism: "failed breakout participants and retest liquidity may create continuation after a prior level is reclaimed or rejected.",
        entryRule: `closed-candle structure breakout/retest in the ${side} direction; enter next open or equivalent executable quote only.`,
        stopRule: "beyond retest failure or breakout level using ATR risk from the contract.",
        regimeRule: "Trade only when the breakout level existed before the signal and the retest is causally observable on closed candles.",
        triggerRule: "Breakout buffer and retest tolerance must both be satisfied; do not infer support/resistance after the fact.",
      }
    case "relative_weakness_momentum_v1":
      return {
        tag: "relative-momentum",
        edgeMechanism: "cross-sectional relative strength or weakness may persist after benchmark-adjusted momentum separates cleanly.",
        entryRule: `closed-candle relative momentum signal in the ${side} direction with benchmark data available point-in-time.`,
        stopRule: "ATR or benchmark-relative invalidation from the contract; never widen because the benchmark moves after entry.",
        regimeRule: "Trade only when benchmark and candidate series are synchronized and the relative signal is not a data-alignment artifact.",
        triggerRule: "Relative spread or beta-adjusted momentum must be present before entry and survive the declared negative controls.",
      }
    case "funding_carry_v1":
      return {
        tag: "funding-carry",
        edgeMechanism: "funding pressure may create carry or crowded-position reversals when price, basis, and holding risk align.",
        entryRule: `closed-candle funding-carry signal in the ${side} direction with funding history available before entry.`,
        stopRule: "ATR or funding-regime invalidation from the contract.",
        regimeRule: "Trade only when funding data coverage is complete and the position is not merely paying hidden adverse carry.",
        triggerRule: "Funding condition, price confirmation, and cost model must all pass before any entry is proposed.",
      }
    case "funding_unwind_risk_guard_v1":
      return {
        tag: "funding-unwind-risk-guard",
        edgeMechanism: "crowded perpetual positioning can unwind when funding is stretched, flow is weak, and risk guards prevent clustered entries into fresh squeeze pressure.",
        entryRule: `closed-candle funding-unwind signal in the ${side} direction with funding history, VFI, chopiness, cooldown, adverse-move, and close-location guards available before entry.`,
        stopRule: "ATR stop from the signal candle; reject the setup when family risk guards or max-risk ATR constraints fail.",
        regimeRule: "Trade only when funding coverage is complete, VFI/chopiness state supports unwind risk, and the family cooldown is not suppressing the setup.",
        triggerRule: "Funding, weak-flow/choppy-state filters, close-location guard, recent adverse-move guard, and cost model must all pass before any entry is proposed.",
      }
    default:
      return {
        tag: strategyPolicySlug(family) || "rnd-family",
        edgeMechanism: `${family || "R&D family"} candidate mechanism validated by the configured research gate.`,
        entryRule: "generated from rnd_family_v1 closed-candle signal; enter next open or equivalent executable quote only.",
        stopRule: "generated from contract risk parameters.",
        regimeRule: "Trade only when the family signal is present, causal, and inside the validated data surface.",
        triggerRule: "The family trigger must be reproducible from closed data and cannot rely on discretionary interpretation.",
      }
  }
}

function strategyPolicySlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
  let start = 0
  let end = normalized.length
  while (normalized[start] === "-") start += 1
  while (end > start && normalized[end - 1] === "-") end -= 1
  return safeFileName(normalized.slice(start, end)) || "rd-strategy"
}

function strategyIDFromSlug(slug: string): string {
  return `S-${slug.toUpperCase()}`
}

function titleFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ")
}

function safeTimeframe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "") || "4h"
}

function riskParamKeys(): Set<string> {
  return new Set(["stop_atr", "max_risk_atr", "reward_risk", "max_hold_bars", "break_even_after_r", "break_even_offset_r"])
}

function yamlScalarOrArray(value: unknown): boolean {
  return typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"))
}

function yamlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(", ")}]`
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return String(value).replace(/[:\n\r]/g, " ").trim() || "null"
}

function numberOrDefault(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function isRecord(value: unknown): value is JSONRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asRecord(value: unknown): JSONRecord {
  return isRecord(value) ? value : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  SOURCE_SCHEMA_VERSION,
  assertStrategyPolicySource,
  lintStrategyPolicyShape,
  renderStrategyPolicyMarkdown,
  requiredPolicySections,
  strategyIDFromSlug,
  strategyPolicySlug,
  type StrategyPolicyCandidateSource,
  type StrategyPolicyShapeLintResult,
  type StrategyPolicySource,
}
