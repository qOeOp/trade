import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const MARKET_DATA_DEMAND_SCHEMA = "trade.market-data-demand.v1" as const
export const MARKET_DATA_SUBSCRIPTION_PLAN_SCHEMA = "trade.market-data-subscription-plan.v1" as const

export type MarketDataDemandPriority =
  | "defensive_exposure"
  | "active_flow"
  | "active_plan"
  | "opportunity_candidate"
  | "research"

export type MarketDataProduct = "l2_book" | "ohlcv" | "indicator_set"

export interface MarketDataRequirement {
  product: MarketDataProduct
  timeframe: string | null
  indicator_set_ref: string | null
  coverage_start: string | null
  coverage_end: string | null
  max_freshness_ms: number
  minimum_depth: number | null
}

export interface MarketDataDemand {
  schema_version: typeof MARKET_DATA_DEMAND_SCHEMA
  demand_id: string
  consumer_owner: string
  consumer_kind: "runtime" | "research" | "execution_defense"
  subject_ref: string
  venue: "binance_usdm"
  symbol: string
  priority: MarketDataDemandPriority
  requirements: MarketDataRequirement[]
  lease: {
    issued_at: string
    expires_at: string
    renewal_grace_ms: number
  }
  domain_authority: "none"
  demand_hash: string
}

export interface MarketDataSubscriptionPlan {
  schema_version: typeof MARKET_DATA_SUBSCRIPTION_PLAN_SCHEMA
  observed_at: string
  capacity: { max_symbols: number }
  status: "ready" | "capacity_blocked"
  selected_symbols: string[]
  subscriptions: Array<{
    venue: "binance_usdm"
    symbol: string
    priority: MarketDataDemandPriority
    product: MarketDataProduct
    timeframe: string | null
    indicator_set_ref: string | null
    coverage_start: string | null
    coverage_end: string | null
    max_freshness_ms: number
    minimum_depth: number | null
    retain_until: string
    demand_ids: string[]
  }>
  active_demand_ids: string[]
  grace_demand_ids: string[]
  expired_demand_ids: string[]
  deferred_demand_ids: string[]
  attentions: Array<{
    demand_id: string
    reason: "defensive_lease_expired_in_grace" | "capacity_deferred" | "defensive_capacity_insufficient"
  }>
  lifecycle_authority: "none"
  plan_hash: string
}

const PRIORITIES: readonly MarketDataDemandPriority[] = [
  "defensive_exposure",
  "active_flow",
  "active_plan",
  "opportunity_candidate",
  "research",
]

export function buildMarketDataDemand(
  value: Omit<MarketDataDemand, "schema_version" | "domain_authority" | "demand_hash">,
): MarketDataDemand {
  const candidate = {
    schema_version: MARKET_DATA_DEMAND_SCHEMA,
    ...value,
    domain_authority: "none" as const,
  }
  return compileMarketDataDemand({ ...candidate, demand_hash: canonicalHash(candidate) })
}

export function compileMarketDataDemand(value: unknown): MarketDataDemand {
  const input = record(value, "market_data_demand")
  exact(input, [
    "schema_version", "demand_id", "consumer_owner", "consumer_kind", "subject_ref",
    "venue", "symbol", "priority", "requirements", "lease", "domain_authority", "demand_hash",
  ], "market_data_demand")
  if (input.schema_version !== MARKET_DATA_DEMAND_SCHEMA) throw new Error("market data demand schema is unsupported")
  if (input.venue !== "binance_usdm") throw new Error("market data demand venue is unsupported")
  if (input.domain_authority !== "none") throw new Error("market data demand must not grant domain authority")
  const priority = oneOf(input.priority, PRIORITIES, "priority")
  const consumerKind = oneOf(input.consumer_kind, ["runtime", "research", "execution_defense"] as const, "consumer_kind")
  if ((priority === "defensive_exposure") !== (consumerKind === "execution_defense")) {
    throw new Error("defensive_exposure priority requires execution_defense consumer")
  }
  const requirementsInput = array(input.requirements, "requirements")
  if (requirementsInput.length < 1 || requirementsInput.length > 16) {
    throw new Error("requirements must contain between 1 and 16 items")
  }
  const requirements = requirementsInput.map((item, index) => compileRequirement(item, index))
  const requirementKeys = requirements.map(requirementKey)
  if (new Set(requirementKeys).size !== requirementKeys.length) throw new Error("requirements contain duplicate product identities")
  const leaseInput = record(input.lease, "lease")
  exact(leaseInput, ["issued_at", "expires_at", "renewal_grace_ms"], "lease")
  const issuedAt = iso(leaseInput.issued_at, "lease.issued_at")
  const expiresAt = iso(leaseInput.expires_at, "lease.expires_at")
  const leaseMs = Date.parse(expiresAt) - Date.parse(issuedAt)
  if (leaseMs < 60_000 || leaseMs > 30 * 86_400_000) {
    throw new Error("market data demand lease must be between 1 minute and 30 days")
  }
  const renewalGraceMs = integer(leaseInput.renewal_grace_ms, 0, 86_400_000, "lease.renewal_grace_ms")
  if (priority !== "defensive_exposure" && renewalGraceMs !== 0) {
    throw new Error("only defensive_exposure demand may request renewal grace")
  }
  const withoutHash = {
    schema_version: MARKET_DATA_DEMAND_SCHEMA,
    demand_id: identifier(input.demand_id, "demand_id"),
    consumer_owner: identifier(input.consumer_owner, "consumer_owner"),
    consumer_kind: consumerKind,
    subject_ref: safeRef(input.subject_ref, "subject_ref"),
    venue: "binance_usdm" as const,
    symbol: symbol(input.symbol),
    priority,
    requirements,
    lease: {
      issued_at: issuedAt,
      expires_at: expiresAt,
      renewal_grace_ms: renewalGraceMs,
    },
    domain_authority: "none" as const,
  }
  const demandHash = sha256(input.demand_hash, "demand_hash")
  if (canonicalHash(withoutHash) !== demandHash) throw new Error("market data demand_hash mismatch")
  return { ...withoutHash, demand_hash: demandHash }
}

export function reconcileMarketDataDemands(input: {
  demands: unknown[]
  observed_at: string
  max_symbols: number
}): MarketDataSubscriptionPlan {
  const observedAt = iso(input.observed_at, "observed_at")
  const observedAtMs = Date.parse(observedAt)
  const maxSymbols = integer(input.max_symbols, 1, 100, "max_symbols")
  const byId = new Map<string, MarketDataDemand>()
  for (const value of input.demands) {
    const demand = compileMarketDataDemand(value)
    const previous = byId.get(demand.demand_id)
    if (previous && previous.demand_hash !== demand.demand_hash) {
      throw new Error(`market data demand identity conflict: ${demand.demand_id}`)
    }
    byId.set(demand.demand_id, demand)
  }
  const active: MarketDataDemand[] = []
  const grace: MarketDataDemand[] = []
  const expired: MarketDataDemand[] = []
  for (const demand of [...byId.values()].sort((a, b) => a.demand_id.localeCompare(b.demand_id))) {
    const expiresAtMs = Date.parse(demand.lease.expires_at)
    if (observedAtMs <= expiresAtMs) active.push(demand)
    else if (
      demand.priority === "defensive_exposure"
      && observedAtMs <= expiresAtMs + demand.lease.renewal_grace_ms
    ) grace.push(demand)
    else expired.push(demand)
  }
  const eligible = [...active, ...grace]
  const symbols = [...new Set(eligible.map((demand) => demand.symbol))]
    .map((symbolValue) => ({
      symbol: symbolValue,
      priority: highestPriority(eligible.filter((demand) => demand.symbol === symbolValue)),
    }))
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
      || left.symbol.localeCompare(right.symbol))
  const defensiveSymbols = symbols.filter((item) => item.priority === "defensive_exposure")
  const capacityBlocked = defensiveSymbols.length > maxSymbols
  const selectedSymbols = capacityBlocked ? [] : symbols.slice(0, maxSymbols).map((item) => item.symbol)
  const selected = new Set(selectedSymbols)
  const deferred = capacityBlocked
    ? eligible
    : eligible.filter((demand) => !selected.has(demand.symbol))
  const selectedDemands = capacityBlocked
    ? []
    : eligible.filter((demand) => selected.has(demand.symbol))
  const attentions: MarketDataSubscriptionPlan["attentions"] = [
    ...grace.map((demand) => ({
      demand_id: demand.demand_id,
      reason: "defensive_lease_expired_in_grace" as const,
    })),
    ...deferred.map((demand) => ({
      demand_id: demand.demand_id,
      reason: capacityBlocked
        ? "defensive_capacity_insufficient" as const
        : "capacity_deferred" as const,
    })),
  ].sort((a, b) => a.demand_id.localeCompare(b.demand_id))
  const planWithoutHash = {
    schema_version: MARKET_DATA_SUBSCRIPTION_PLAN_SCHEMA,
    observed_at: observedAt,
    capacity: { max_symbols: maxSymbols },
    status: capacityBlocked ? "capacity_blocked" as const : "ready" as const,
    selected_symbols: selectedSymbols,
    subscriptions: mergeSubscriptions(selectedDemands),
    active_demand_ids: active.map((demand) => demand.demand_id),
    grace_demand_ids: grace.map((demand) => demand.demand_id),
    expired_demand_ids: expired.map((demand) => demand.demand_id),
    deferred_demand_ids: deferred.map((demand) => demand.demand_id).sort(),
    attentions,
    lifecycle_authority: "none" as const,
  }
  return { ...planWithoutHash, plan_hash: canonicalHash(planWithoutHash) }
}

export function compileMarketDataSubscriptionPlan(value: unknown): MarketDataSubscriptionPlan {
  const input = record(value, "market_data_subscription_plan")
  exact(input, [
    "schema_version", "observed_at", "capacity", "status", "selected_symbols",
    "subscriptions", "active_demand_ids", "grace_demand_ids", "expired_demand_ids",
    "deferred_demand_ids", "attentions", "lifecycle_authority", "plan_hash",
  ], "market_data_subscription_plan")
  if (input.schema_version !== MARKET_DATA_SUBSCRIPTION_PLAN_SCHEMA) {
    throw new Error("market data subscription plan schema is unsupported")
  }
  if (input.lifecycle_authority !== "none") throw new Error("market data subscription plan must not grant lifecycle authority")
  const capacityInput = record(input.capacity, "capacity")
  exact(capacityInput, ["max_symbols"], "capacity")
  const maxSymbols = integer(capacityInput.max_symbols, 1, 100, "capacity.max_symbols")
  const status = oneOf(input.status, ["ready", "capacity_blocked"] as const, "status")
  const selectedSymbols = array(input.selected_symbols, "selected_symbols").map(symbol)
  requireUnique(selectedSymbols, "selected_symbols")
  if (selectedSymbols.length > maxSymbols) throw new Error("selected_symbols exceeds capacity")
  const activeDemandIds = sortedIdentifiers(input.active_demand_ids, "active_demand_ids")
  const graceDemandIds = sortedIdentifiers(input.grace_demand_ids, "grace_demand_ids")
  const expiredDemandIds = sortedIdentifiers(input.expired_demand_ids, "expired_demand_ids")
  const deferredDemandIds = sortedIdentifiers(input.deferred_demand_ids, "deferred_demand_ids")
  requireDisjoint([
    activeDemandIds,
    graceDemandIds,
    expiredDemandIds,
  ], "market data demand lifecycle sets")
  const eligibleIds = new Set([...activeDemandIds, ...graceDemandIds])
  for (const id of deferredDemandIds) {
    if (!eligibleIds.has(id)) throw new Error("deferred demand must be active or in grace")
  }
  const selectedSet = new Set(selectedSymbols)
  const subscriptions = array(input.subscriptions, "subscriptions")
    .map((item, index) => compileSubscription(item, index))
  if (!isSubscriptionOrderCanonical(subscriptions)) throw new Error("subscriptions are not in canonical order")
  for (const subscription of subscriptions) {
    if (!selectedSet.has(subscription.symbol)) throw new Error("subscription symbol is not selected")
    for (const id of subscription.demand_ids) {
      if (!eligibleIds.has(id) || deferredDemandIds.includes(id)) {
        throw new Error("subscription demand is not eligible and selected")
      }
    }
  }
  const attentions = array(input.attentions, "attentions").map((item, index) => {
    const attention = record(item, `attentions[${index}]`)
    exact(attention, ["demand_id", "reason"], `attentions[${index}]`)
    const reason = oneOf(attention.reason, [
      "defensive_lease_expired_in_grace",
      "capacity_deferred",
      "defensive_capacity_insufficient",
    ] as const, `attentions[${index}].reason`)
    const demandId = identifier(attention.demand_id, `attentions[${index}].demand_id`)
    if (reason === "defensive_lease_expired_in_grace" && !graceDemandIds.includes(demandId)) {
      throw new Error("defensive grace attention does not reference a grace demand")
    }
    if (reason !== "defensive_lease_expired_in_grace" && !deferredDemandIds.includes(demandId)) {
      throw new Error("capacity attention does not reference a deferred demand")
    }
    return { demand_id: demandId, reason }
  })
  const withoutHash = {
    schema_version: MARKET_DATA_SUBSCRIPTION_PLAN_SCHEMA,
    observed_at: iso(input.observed_at, "observed_at"),
    capacity: { max_symbols: maxSymbols },
    status,
    selected_symbols: selectedSymbols,
    subscriptions,
    active_demand_ids: activeDemandIds,
    grace_demand_ids: graceDemandIds,
    expired_demand_ids: expiredDemandIds,
    deferred_demand_ids: deferredDemandIds,
    attentions,
    lifecycle_authority: "none" as const,
  }
  if (status === "capacity_blocked" && (selectedSymbols.length !== 0 || subscriptions.length !== 0)) {
    throw new Error("capacity-blocked plan must not select subscriptions")
  }
  if (status === "ready" && attentions.some((item) => item.reason === "defensive_capacity_insufficient")) {
    throw new Error("ready plan cannot carry defensive capacity failure")
  }
  const planHash = sha256(input.plan_hash, "plan_hash")
  if (canonicalHash(withoutHash) !== planHash) throw new Error("market data subscription plan_hash mismatch")
  return { ...withoutHash, plan_hash: planHash }
}

function compileRequirement(value: unknown, index: number): MarketDataRequirement {
  const field = `requirements[${index}]`
  const input = record(value, field)
  exact(input, [
    "product", "timeframe", "indicator_set_ref", "coverage_start", "coverage_end",
    "max_freshness_ms", "minimum_depth",
  ], field)
  const product = oneOf(input.product, ["l2_book", "ohlcv", "indicator_set"] as const, `${field}.product`)
  const timeframe = nullableTimeframe(input.timeframe, `${field}.timeframe`)
  const indicatorSetRef = nullableRef(input.indicator_set_ref, `${field}.indicator_set_ref`)
  const coverageStart = nullableIso(input.coverage_start, `${field}.coverage_start`)
  const coverageEnd = nullableIso(input.coverage_end, `${field}.coverage_end`)
  const minimumDepth = nullableInteger(input.minimum_depth, 1, 100, `${field}.minimum_depth`)
  if (product === "l2_book") {
    if (timeframe != null || indicatorSetRef != null || coverageStart != null || coverageEnd != null || minimumDepth == null) {
      throw new Error(`${field} l2_book shape is invalid`)
    }
  } else {
    if (timeframe == null || coverageStart == null || coverageEnd == null || minimumDepth != null) {
      throw new Error(`${field} historical product shape is invalid`)
    }
    if (Date.parse(coverageStart) >= Date.parse(coverageEnd)) throw new Error(`${field} coverage window is invalid`)
    if ((product === "indicator_set") !== (indicatorSetRef != null)) {
      throw new Error(`${field} indicator_set_ref shape is invalid`)
    }
  }
  return {
    product,
    timeframe,
    indicator_set_ref: indicatorSetRef,
    coverage_start: coverageStart,
    coverage_end: coverageEnd,
    max_freshness_ms: integer(input.max_freshness_ms, 100, 86_400_000, `${field}.max_freshness_ms`),
    minimum_depth: minimumDepth,
  }
}

function compileSubscription(
  value: unknown,
  index: number,
): MarketDataSubscriptionPlan["subscriptions"][number] {
  const field = `subscriptions[${index}]`
  const input = record(value, field)
  exact(input, [
    "venue", "symbol", "priority", "product", "timeframe", "indicator_set_ref",
    "coverage_start", "coverage_end", "max_freshness_ms", "minimum_depth",
    "retain_until", "demand_ids",
  ], field)
  if (input.venue !== "binance_usdm") throw new Error(`${field}.venue is unsupported`)
  const requirement = compileRequirement({
    product: input.product,
    timeframe: input.timeframe,
    indicator_set_ref: input.indicator_set_ref,
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    max_freshness_ms: input.max_freshness_ms,
    minimum_depth: input.minimum_depth,
  }, index)
  return {
    venue: "binance_usdm",
    symbol: symbol(input.symbol),
    priority: oneOf(input.priority, PRIORITIES, `${field}.priority`),
    ...requirement,
    retain_until: iso(input.retain_until, `${field}.retain_until`),
    demand_ids: sortedIdentifiers(input.demand_ids, `${field}.demand_ids`),
  }
}

function mergeSubscriptions(demands: MarketDataDemand[]): MarketDataSubscriptionPlan["subscriptions"] {
  const groups = new Map<string, { demands: MarketDataDemand[]; requirements: MarketDataRequirement[] }>()
  for (const demand of demands) {
    for (const requirement of demand.requirements) {
      const key = [demand.venue, demand.symbol, requirementKey(requirement)].join("|")
      const group = groups.get(key) ?? { demands: [], requirements: [] }
      group.demands.push(demand)
      group.requirements.push(requirement)
      groups.set(key, group)
    }
  }
  return [...groups.values()].map((group) => {
    const firstDemand = group.demands[0]!
    const firstRequirement = group.requirements[0]!
    return {
      venue: firstDemand.venue,
      symbol: firstDemand.symbol,
      priority: highestPriority(group.demands),
      product: firstRequirement.product,
      timeframe: firstRequirement.timeframe,
      indicator_set_ref: firstRequirement.indicator_set_ref,
      coverage_start: nullableMinimum(group.requirements.map((item) => item.coverage_start)),
      coverage_end: nullableMaximum(group.requirements.map((item) => item.coverage_end)),
      max_freshness_ms: Math.min(...group.requirements.map((item) => item.max_freshness_ms)),
      minimum_depth: nullableNumericMaximum(group.requirements.map((item) => item.minimum_depth)),
      retain_until: maximum(group.demands.map((item) => item.lease.expires_at)),
      demand_ids: [...new Set(group.demands.map((item) => item.demand_id))].sort(),
    }
  }).sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
    || left.symbol.localeCompare(right.symbol)
    || left.product.localeCompare(right.product)
    || (left.timeframe ?? "").localeCompare(right.timeframe ?? "")
    || (left.indicator_set_ref ?? "").localeCompare(right.indicator_set_ref ?? ""))
}

function isSubscriptionOrderCanonical(
  subscriptions: MarketDataSubscriptionPlan["subscriptions"],
): boolean {
  const keys = subscriptions.map(subscriptionOrderKey)
  return keys.every((key, index) => index === 0 || keys[index - 1]! <= key)
}

function subscriptionOrderKey(subscription: MarketDataSubscriptionPlan["subscriptions"][number]): string {
  return [
    String(priorityRank(subscription.priority)).padStart(2, "0"),
    subscription.symbol,
    subscription.product,
    subscription.timeframe ?? "",
    subscription.indicator_set_ref ?? "",
  ].join("|")
}

function requirementKey(requirement: MarketDataRequirement): string {
  return [requirement.product, requirement.timeframe ?? "", requirement.indicator_set_ref ?? ""].join(":")
}

function highestPriority(demands: MarketDataDemand[]): MarketDataDemandPriority {
  if (demands.length === 0) throw new Error("cannot rank empty market data demand set")
  return demands.map((demand) => demand.priority)
    .sort((left, right) => priorityRank(left) - priorityRank(right))[0]!
}

function priorityRank(value: MarketDataDemandPriority): number {
  return PRIORITIES.indexOf(value)
}

function nullableMinimum(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => value != null)
  return present.length === 0 ? null : present.sort()[0]!
}

function nullableMaximum(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => value != null)
  return present.length === 0 ? null : present.sort().at(-1)!
}

function nullableNumericMaximum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null)
  return present.length === 0 ? null : Math.max(...present)
}

function sortedIdentifiers(value: unknown, field: string): string[] {
  const result = array(value, field).map((item, index) => identifier(item, `${field}[${index}]`))
  requireUnique(result, field)
  if (result.some((item, index) => index > 0 && result[index - 1]!.localeCompare(item) > 0)) {
    throw new Error(`${field} must use canonical binary order`)
  }
  return result
}

function requireUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} must not contain duplicates`)
}

function requireDisjoint(groups: string[][], field: string): void {
  const seen = new Set<string>()
  for (const value of groups.flat()) {
    if (seen.has(value)) throw new Error(`${field} overlap`)
    seen.add(value)
  }
}

function maximum(values: string[]): string {
  return [...values].sort().at(-1)!
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function exact(value: Record<string, unknown>, allowed: string[], field: string): void {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !expected.has(key))
  const missing = allowed.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${field} is unsupported`)
  return value as T[number]
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function safeRef(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value.includes("\0")
    || value.startsWith("/") || value.includes("../") || /(?:^|[/:])(?:secret|credential|token|password)(?:[/:]|$)/i.test(value)) {
    throw new Error(`${field} is unsafe`)
  }
  return value
}

function nullableRef(value: unknown, field: string): string | null {
  return value === null ? null : safeRef(value, field)
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC time`)
  }
  return value
}

function nullableIso(value: unknown, field: string): string | null {
  return value === null ? null : iso(value, field)
}

function nullableTimeframe(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== "string" || !/^(?:1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d)$/.test(value)) {
    throw new Error(`${field} is unsupported`)
  }
  return value
}

function symbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("symbol is invalid")
  return value
}

function integer(value: unknown, minimum: number, maximumValue: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximumValue) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximumValue}`)
  }
  return Number(value)
}

function nullableInteger(
  value: unknown,
  minimum: number,
  maximumValue: number,
  field: string,
): number | null {
  return value === null ? null : integer(value, minimum, maximumValue, field)
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a SHA-256 hex digest`)
  return value
}
