import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseFrontmatter } from "./loaders"
import type { JSONRecord } from "./json"
import type { StrategyRndCandidateInput } from "./strategy-rnd-inputs"

type StrategyContractEngine = "rnd_family_v1" | "manual_policy_v1"

interface StrategyContractDocument {
  path: string
  frontmatter: JSONRecord
  body: string
  contractRaw: string
  contract: JSONRecord
}

interface StrategyContractCompiled {
  schema_version: "trade-flow.strategy-contract.v1"
  strategy_id: string
  name: string
  status: string
  path: string
  setup_id: string
  engine: StrategyContractEngine
  family?: string
  timeframe?: string
  contract_hash: string
  candidate?: StrategyRndCandidateInput
  replay_defaults: JSONRecord
  signal_defaults: JSONRecord
  risk: JSONRecord
  cost_model: JSONRecord
  universe: JSONRecord
  execution: JSONRecord
  lifecycle: JSONRecord
  proof: JSONRecord
}

interface StrategyContractLintResult {
  strategy_id: string
  path: string
  valid: boolean
  errors: string[]
  warnings: string[]
  contract?: StrategyContractCompiled
}

function loadStrategyContract(path: string): StrategyContractDocument {
  const raw = readFileSync(path, "utf8")
  const { frontmatter, body } = parseFrontmatter(raw)
  const contractRaw = extractTradeContract(body)
  return {
    path,
    frontmatter,
    body,
    contractRaw,
    contract: parseYamlSubset(contractRaw),
  }
}

function compileStrategyContract(path: string, candidateParamOverrides: JSONRecord = {}): StrategyContractCompiled {
  const document = loadStrategyContract(path)
  const strategyId = stringField(document.frontmatter.strategy_id) || stringField(document.frontmatter.id)
  const contract = document.contract
  const engine = readEngine(contract.engine)
  const family = stringField(contract.family)
  const setupId = stringField(contract.setup_id)
  const risk = asRecord(contract.risk)
  const costModel = asRecord(contract.cost_model)
  const universe = asRecord(contract.universe)
  const execution = asRecord(contract.execution)
  const lifecycle = compileLifecycle(contract, engine, family)
  const proof = asRecord(contract.proof)
  const candidate = engine === "rnd_family_v1"
    ? buildRndCandidate(strategyId, setupId, family, contract, risk, candidateParamOverrides)
    : undefined

  return {
    schema_version: "trade-flow.strategy-contract.v1",
    strategy_id: strategyId,
    name: stringField(document.frontmatter.name),
    status: stringField(document.frontmatter.status) || "draft",
    path,
    setup_id: setupId,
    engine,
    ...(family ? { family } : {}),
    ...(stringField(contract.timeframe) ? { timeframe: stringField(contract.timeframe) } : {}),
    contract_hash: strategyContractHash(document.frontmatter, contract),
    ...(candidate ? { candidate } : {}),
    replay_defaults: compact({
      timeframe: stringField(contract.timeframe) || undefined,
      max_hold_bars: numberOrUndefined(risk.max_hold_bars),
      fee_bps: numberOrUndefined(costModel.fee_bps),
      slippage_bps: numberOrUndefined(costModel.slippage_bps),
      funding_bps_per_8h: numberOrUndefined(costModel.adverse_funding_bps_per_8h),
    }),
    signal_defaults: compact({
      timeframe: stringField(contract.timeframe) || undefined,
      max_signal_age_bars: numberOrUndefined(contract.max_signal_age_bars),
    }),
    risk,
    cost_model: costModel,
    universe,
    execution,
    lifecycle,
    proof,
  }
}

function lintStrategyContract(path: string): StrategyContractLintResult {
  const errors: string[] = []
  const warnings: string[] = []
  try {
    const document = loadStrategyContract(path)
    const frontmatter = document.frontmatter
    const contract = document.contract
    const strategyId = stringField(frontmatter.strategy_id) || stringField(frontmatter.id)
    const engine = stringField(contract.engine)
    const proof = asRecord(contract.proof)
    const lifecycle = asRecord(contract.lifecycle)

    requireField(errors, "frontmatter.strategy_id", strategyId)
    requireField(errors, "frontmatter.name", stringField(frontmatter.name))
    requireField(errors, "frontmatter.status", stringField(frontmatter.status))
    if (String(frontmatter.contract_schema_version) !== "1") {
      errors.push("frontmatter.contract_schema_version must be 1")
    }
    requireField(errors, "contract.setup_id", stringField(contract.setup_id))
    requireField(errors, "contract.engine", engine)
    if (engine !== "rnd_family_v1" && engine !== "manual_policy_v1") {
      errors.push("contract.engine must be rnd_family_v1 or manual_policy_v1")
    }
    requireField(errors, "contract.timeframe", stringField(contract.timeframe))
    requireField(errors, "contract.proof.live_permission", stringField(proof.live_permission))

    if (engine === "rnd_family_v1") {
      requireField(errors, "contract.family", stringField(contract.family))
      const candidate = asRecord(contract.candidate)
      const risk = asRecord(contract.risk)
      const costModel = asRecord(contract.cost_model)
      requireField(errors, "contract.candidate.side", stringField(candidate.side))
      requireField(errors, "contract.risk.stop_atr", risk.stop_atr)
      requireField(errors, "contract.risk.max_risk_atr", risk.max_risk_atr)
      requireField(errors, "contract.risk.reward_risk", risk.reward_risk)
      requireField(errors, "contract.risk.max_hold_bars", risk.max_hold_bars)
      requireField(errors, "contract.cost_model.fee_bps", costModel.fee_bps)
      requireField(errors, "contract.cost_model.slippage_bps", costModel.slippage_bps)
      if (stringField(contract.family) === "relative_weakness_momentum_v1" && !stringField(candidate.benchmark_manifest_path)) {
        warnings.push("relative_weakness_momentum_v1 needs benchmark_manifest_path at signal/replay time; pass it in CLI JSON if the strategy omits environment-specific paths")
      }
    } else if (stringField(contract.family)) {
      warnings.push("manual_policy_v1 ignores contract.family")
    }
    if (Object.keys(lifecycle).length > 0) {
      for (const field of lifecycleFields()) {
        requireField(errors, `contract.lifecycle.${field}`, stringField(lifecycle[field]))
      }
    } else if (engine === "manual_policy_v1") {
      warnings.push("manual_policy_v1 without lifecycle is legacy-compatible only and is not promotion-lifecycle eligible")
    }

    const compiled = errors.length === 0 ? compileStrategyContract(path) : undefined
    return { strategy_id: strategyId, path, valid: errors.length === 0, errors, warnings, ...(compiled ? { contract: compiled } : {}) }
  } catch (error) {
    return {
      strategy_id: "",
      path,
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
    }
  }
}

function compileLifecycle(contract: JSONRecord, engine: StrategyContractEngine, family: string): JSONRecord {
  const declared = asRecord(contract.lifecycle)
  if (Object.keys(declared).length > 0) {
    return compact({
      source: "declared_lifecycle_v1",
      promotion_eligible: lifecycleFields().every((field) => stringField(declared[field])),
      signal_rule: stringField(declared.signal_rule),
      entry_builder: stringField(declared.entry_builder),
      protection_builder: stringField(declared.protection_builder),
      position_update_rule: stringField(declared.position_update_rule),
      exit_rule: stringField(declared.exit_rule),
      review_attribution: stringField(declared.review_attribution),
    })
  }
  if (engine === "rnd_family_v1") {
    return {
      source: "generated_rnd_family_v1",
      promotion_eligible: true,
      signal_rule: `family:${family || "unknown"} closed-candle signal`,
      entry_builder: "next_open_entry_from_signal_or_live_entry_reference",
      protection_builder: "initial_stop_target_from_risk_contract",
      position_update_rule: "one_active_lane_optional_break_even_next_bar",
      exit_rule: "protective_stop_target_or_time_exit",
      review_attribution: "compare_replay_shadow_live_by_setup_id_and_r_multiple",
    }
  }
  return {
    source: "legacy_compatibility_v1",
    promotion_eligible: false,
  }
}

function lifecycleFields(): string[] {
  return [
    "signal_rule",
    "entry_builder",
    "protection_builder",
    "position_update_rule",
    "exit_rule",
    "review_attribution",
  ]
}

function candidateFromStrategyContract(path: string, candidateParamOverrides: JSONRecord = {}): StrategyRndCandidateInput {
  const compiled = compileStrategyContract(path, candidateParamOverrides)
  if (compiled.engine !== "rnd_family_v1" || !compiled.candidate) {
    throw new Error("--strategy-signal --strategy requires a rnd_family_v1 strategy contract")
  }
  return compiled.candidate
}

function buildRndCandidate(
  strategyId: string,
  setupId: string,
  family: string,
  contract: JSONRecord,
  risk: JSONRecord,
  overrides: JSONRecord,
): StrategyRndCandidateInput {
  if (!family) {
    throw new Error("rnd_family_v1 contract requires family")
  }
  const candidate = asRecord(contract.candidate)
  const params = compact({
    ...candidate,
    ...compact({
      stop_atr: risk.stop_atr,
      max_risk_atr: risk.max_risk_atr,
      reward_risk: risk.reward_risk,
      break_even_after_r: risk.break_even_after_r,
      break_even_offset_r: risk.break_even_offset_r,
    }),
    ...overrides,
  })
  delete params.candidate_id
  delete params.description
  delete params.family
  return {
    candidateId: stringField(candidate.candidate_id) || setupId || strategyId,
    description: stringField(contract.hypothesis) || stringField(candidate.description) || undefined,
    family,
    parameterCount: numberOrUndefined(candidate.parameter_count),
    params,
  }
}

function extractTradeContract(body: string): string {
  const heading = /^## Trade Contract\s*$/m
  const match = heading.exec(body)
  if (!match) {
    throw new Error("strategy file requires ## Trade Contract")
  }
  const rest = body.slice(match.index + match[0].length)
  const block = /```ya?ml\s*\n([\s\S]*?)\n```/i.exec(rest)
  if (!block) {
    throw new Error("## Trade Contract requires a fenced yaml block")
  }
  return block[1].trim()
}

function strategyContractHash(frontmatter: JSONRecord, contract: JSONRecord): string {
  return createHash("sha256")
    .update(stableStringify({
      strategy_id: stringField(frontmatter.strategy_id) || stringField(frontmatter.id),
      name: stringField(frontmatter.name),
      tags: arrayOfStrings(frontmatter.tags),
      contract,
    }))
    .digest("hex")
}

function parseYamlSubset(text: string): JSONRecord {
  const lines = text.split("\n")
  const root: JSONRecord = {}
  const stack: Array<{ indent: number; value: JSONRecord | unknown[] }> = [{ indent: -1, value: root }]

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    const indent = raw.length - raw.trimStart().length
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }
    const parent = stack[stack.length - 1].value
    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error(`yaml list item has no list parent: ${trimmed}`)
      }
      parent.push(parseYamlValue(trimmed.slice(2).trim()))
      continue
    }
    if (Array.isArray(parent)) {
      throw new Error(`yaml map item has list parent: ${trimmed}`)
    }
    const colon = trimmed.indexOf(":")
    if (colon < 0) {
      continue
    }
    const key = trimmed.slice(0, colon).trim()
    const rawValue = trimmed.slice(colon + 1).trim()
    if (!rawValue) {
      const next = nextContentLine(lines, index + 1)
      const child: JSONRecord | unknown[] = next && next.indent > indent && next.trimmed.startsWith("- ") ? [] : {}
      parent[key] = child
      stack.push({ indent, value: child })
      continue
    }
    parent[key] = parseYamlValue(rawValue)
  }
  return root
}

function nextContentLine(lines: string[], start: number): { indent: number; trimmed: string } | null {
  for (let index = start; index < lines.length; index += 1) {
    const raw = lines[index]
    const trimmed = raw.trim()
    if (trimmed && !trimmed.startsWith("#")) {
      return { indent: raw.length - raw.trimStart().length, trimmed }
    }
  }
  return null
}

function parseYamlValue(value: string): unknown {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    return inner ? inner.split(",").map((item) => parseYamlValue(item.trim())) : []
  }
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  const number = Number(value)
  if (value && Number.isFinite(number) && String(number) === value.replace(/^\+/, "")) {
    return number
  }
  return value.replace(/^["']|["']$/g, "")
}

function readEngine(value: unknown): StrategyContractEngine {
  const engine = stringField(value)
  if (engine === "rnd_family_v1" || engine === "manual_policy_v1") {
    return engine
  }
  throw new Error("contract.engine must be rnd_family_v1 or manual_policy_v1")
}

function requireField(errors: string[], name: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    errors.push(`${name} is required`)
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
}

function compact(record: JSONRecord): JSONRecord {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === "") {
      delete record[key]
    }
  }
  return record
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JSONRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export {
  candidateFromStrategyContract,
  compileStrategyContract,
  lintStrategyContract,
  loadStrategyContract,
  parseYamlSubset,
  type StrategyContractCompiled,
  type StrategyContractDocument,
  type StrategyContractLintResult,
}
