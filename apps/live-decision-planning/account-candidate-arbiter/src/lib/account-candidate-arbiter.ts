import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"

export const ACCOUNT_CANDIDATE_ALLOCATION_SCHEMA = "trade.account-candidate-allocation.v1" as const

export interface AccountCandidateArbiterInput {
  observed_at: string
  account_ref: string
  account_scope: string
  policy: {
    total_risk_units: number
    max_new_positions: number
    max_risk_units_per_symbol: number
    max_risk_units_per_correlation_bucket: number
  }
  existing_exposure: Array<{
    symbol: string
    correlation_bucket: string
    risk_units: number
  }>
  candidates: Array<{
    setup_id: string
    plan_ref: string
    plan_hash: string
    strategy_version_ref: string
    symbol: string
    side: "long" | "short"
    correlation_bucket: string
    score_units: number
    requested_risk_units: number
    expires_at: string
    market_fact_hashes: string[]
  }>
}

export interface AccountCandidateAllocation {
  schema_version: typeof ACCOUNT_CANDIDATE_ALLOCATION_SCHEMA
  observed_at: string
  account_ref: string
  account_scope: string
  policy: AccountCandidateArbiterInput["policy"]
  existing_risk_units: number
  proposed_new_risk_units: number
  remaining_risk_units: number
  decisions: Array<{
    rank: number
    setup_id: string
    plan_ref: string
    plan_hash: string
    strategy_version_ref: string
    symbol: string
    side: "long" | "short"
    correlation_bucket: string
    score_units: number
    requested_risk_units: number
    allocated_risk_units: number
    expires_at: string
    market_fact_hashes: string[]
    status: "accepted" | "rejected"
    reason:
      | "within_account_allocation_limits"
      | "expired"
      | "existing_symbol_exposure"
      | "candidate_symbol_conflict"
      | "new_position_capacity_exhausted"
      | "symbol_risk_limit"
      | "correlation_bucket_risk_limit"
      | "account_risk_limit"
  }>
  allocation_authority: "proposal_only"
  execution_authority: "none"
  allocation_hash: string
}

export function arbitrateAccountCandidates(raw: AccountCandidateArbiterInput): AccountCandidateAllocation {
  const input = compileInput(raw)
  const existingRisk = input.existing_exposure.reduce((sum, item) => sum + item.risk_units, 0)
  if (existingRisk > input.policy.total_risk_units) {
    throw new Error("existing exposure exceeds the supplied account risk policy")
  }
  const symbolRisk = new Map<string, number>()
  const bucketRisk = new Map<string, number>()
  for (const exposure of input.existing_exposure) {
    symbolRisk.set(exposure.symbol, (symbolRisk.get(exposure.symbol) ?? 0) + exposure.risk_units)
    bucketRisk.set(exposure.correlation_bucket, (bucketRisk.get(exposure.correlation_bucket) ?? 0) + exposure.risk_units)
  }
  const ranked = [...input.candidates].sort((left, right) =>
    right.score_units - left.score_units || left.setup_id.localeCompare(right.setup_id))
  const acceptedSymbols = new Set<string>()
  let proposedRisk = 0
  let acceptedCount = 0
  const decisions: AccountCandidateAllocation["decisions"] = []
  for (const [index, candidate] of ranked.entries()) {
    let reason: AccountCandidateAllocation["decisions"][number]["reason"] = "within_account_allocation_limits"
    if (Date.parse(candidate.expires_at) <= Date.parse(input.observed_at)) reason = "expired"
    else if ((symbolRisk.get(candidate.symbol) ?? 0) > 0) reason = "existing_symbol_exposure"
    else if (acceptedSymbols.has(candidate.symbol)) reason = "candidate_symbol_conflict"
    else if (acceptedCount >= input.policy.max_new_positions) reason = "new_position_capacity_exhausted"
    else if (candidate.requested_risk_units > input.policy.max_risk_units_per_symbol) reason = "symbol_risk_limit"
    else if ((bucketRisk.get(candidate.correlation_bucket) ?? 0) + candidate.requested_risk_units
      > input.policy.max_risk_units_per_correlation_bucket) reason = "correlation_bucket_risk_limit"
    else if (existingRisk + proposedRisk + candidate.requested_risk_units > input.policy.total_risk_units) {
      reason = "account_risk_limit"
    }
    const accepted = reason === "within_account_allocation_limits"
    if (accepted) {
      acceptedCount += 1
      proposedRisk += candidate.requested_risk_units
      acceptedSymbols.add(candidate.symbol)
      symbolRisk.set(candidate.symbol, candidate.requested_risk_units)
      bucketRisk.set(
        candidate.correlation_bucket,
        (bucketRisk.get(candidate.correlation_bucket) ?? 0) + candidate.requested_risk_units,
      )
    }
    decisions.push({
      rank: index + 1,
      ...candidate,
      allocated_risk_units: accepted ? candidate.requested_risk_units : 0,
      status: accepted ? "accepted" : "rejected",
      reason,
    })
  }
  const withoutHash = {
    schema_version: ACCOUNT_CANDIDATE_ALLOCATION_SCHEMA,
    observed_at: input.observed_at,
    account_ref: input.account_ref,
    account_scope: input.account_scope,
    policy: input.policy,
    existing_risk_units: existingRisk,
    proposed_new_risk_units: proposedRisk,
    remaining_risk_units: input.policy.total_risk_units - existingRisk - proposedRisk,
    decisions,
    allocation_authority: "proposal_only" as const,
    execution_authority: "none" as const,
  }
  return { ...withoutHash, allocation_hash: canonicalHash(withoutHash) }
}

function compileInput(value: AccountCandidateArbiterInput): AccountCandidateArbiterInput {
  exact(value as unknown as Record<string, unknown>, [
    "observed_at", "account_ref", "account_scope", "policy", "existing_exposure", "candidates",
  ], "input")
  const observedAt = canonicalTime(value.observed_at, "observed_at")
  const accountRef = text(value.account_ref, "account_ref")
  const accountScope = text(value.account_scope, "account_scope")
  exact(value.policy as unknown as Record<string, unknown>, [
    "total_risk_units", "max_new_positions", "max_risk_units_per_symbol",
    "max_risk_units_per_correlation_bucket",
  ], "policy")
  const policy = {
    total_risk_units: integer(value.policy.total_risk_units, 1, 10_000, "policy.total_risk_units"),
    max_new_positions: integer(value.policy.max_new_positions, 0, 100, "policy.max_new_positions"),
    max_risk_units_per_symbol: integer(
      value.policy.max_risk_units_per_symbol,
      1,
      10_000,
      "policy.max_risk_units_per_symbol",
    ),
    max_risk_units_per_correlation_bucket: integer(
      value.policy.max_risk_units_per_correlation_bucket,
      1,
      10_000,
      "policy.max_risk_units_per_correlation_bucket",
    ),
  }
  if (!Array.isArray(value.existing_exposure) || value.existing_exposure.length > 1_000) {
    throw new Error("existing_exposure must be bounded")
  }
  const existingExposure = value.existing_exposure.map((item, index) => {
    exact(item as unknown as Record<string, unknown>, ["symbol", "correlation_bucket", "risk_units"], `existing_exposure[${index}]`)
    return {
      symbol: symbol(item.symbol, `existing_exposure[${index}].symbol`),
      correlation_bucket: identifier(item.correlation_bucket, `existing_exposure[${index}].correlation_bucket`),
      risk_units: integer(item.risk_units, 1, 10_000, `existing_exposure[${index}].risk_units`),
    }
  })
  if (!Array.isArray(value.candidates) || value.candidates.length > 1_000) throw new Error("candidates must be bounded")
  const candidates = value.candidates.map((item, index) => {
    exact(item as unknown as Record<string, unknown>, [
      "setup_id", "plan_ref", "plan_hash", "strategy_version_ref", "symbol", "side",
      "correlation_bucket", "score_units", "requested_risk_units", "expires_at", "market_fact_hashes",
    ], `candidates[${index}]`)
    if (item.side !== "long" && item.side !== "short") throw new Error(`candidates[${index}].side is invalid`)
    return {
      setup_id: identifier(item.setup_id, `candidates[${index}].setup_id`),
      plan_ref: text(item.plan_ref, `candidates[${index}].plan_ref`),
      plan_hash: hash(item.plan_hash, `candidates[${index}].plan_hash`),
      strategy_version_ref: text(item.strategy_version_ref, `candidates[${index}].strategy_version_ref`),
      symbol: symbol(item.symbol, `candidates[${index}].symbol`),
      side: item.side,
      correlation_bucket: identifier(item.correlation_bucket, `candidates[${index}].correlation_bucket`),
      score_units: integer(item.score_units, 0, 1_000_000, `candidates[${index}].score_units`),
      requested_risk_units: integer(item.requested_risk_units, 1, 10_000, `candidates[${index}].requested_risk_units`),
      expires_at: canonicalTime(item.expires_at, `candidates[${index}].expires_at`),
      market_fact_hashes: sortedHashes(item.market_fact_hashes, `candidates[${index}].market_fact_hashes`),
    }
  })
  requireUnique(candidates.map((candidate) => candidate.setup_id), "candidate setup ids")
  return {
    observed_at: observedAt,
    account_ref: accountRef,
    account_scope: accountScope,
    policy,
    existing_exposure: existingExposure,
    candidates,
  }
}

function exact(value: Record<string, unknown>, fields: string[], name: string): void {
  const expected = new Set(fields)
  if (Object.keys(value).some((field) => !expected.has(field)) || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new Error(`${name} shape drifted`)
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024) throw new Error(`${field} is invalid`)
  return value
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function symbol(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[A-Z0-9]{5,20}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function sortedHashes(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error(`${field} must be non-empty and bounded`)
  const result = value.map((item, index) => hash(item, `${field}[${index}]`))
  const sorted = [...new Set(result)].sort()
  if (sorted.length !== result.length || sorted.some((item, index) => item !== result[index])) {
    throw new Error(`${field} must be sorted and unique`)
  }
  return sorted
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function canonicalTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC time`)
  }
  return value
}

function requireUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} must be unique`)
}
