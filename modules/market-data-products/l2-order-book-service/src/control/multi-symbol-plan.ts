import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  compileMarketDataSubscriptionPlan,
  type MarketDataDemandPriority,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"

export const L2_MULTI_SYMBOL_PLAN_SCHEMA = "trade.l2-multi-symbol-plan.v1" as const

export interface L2RuntimeAssignment {
  slot: number
  symbol: string
  service_id: string
  listen: string
  output_base: string
}

export interface L2MultiSymbolPlan {
  schema_version: typeof L2_MULTI_SYMBOL_PLAN_SCHEMA
  source_plan_hash: string
  observed_at: string
  status: "ready" | "source_capacity_blocked" | "l2_capacity_blocked"
  capacity: {
    max_instances: number
    base_port: number
  }
  instances: Array<L2RuntimeAssignment & {
    priority: MarketDataDemandPriority
    max_freshness_ms: number
    minimum_depth: number
    demand_ids: string[]
  }>
  actions: Array<
    | {
      sequence: number
      kind: "drain"
      slot: number
      symbol: string
      service_id: string
      reason: "demand_released"
    }
    | {
      sequence: number
      kind: "start"
      slot: number
      symbol: string
      service_id: string
      reason: "demand_admitted"
    }
  >
  preserved_assignments: number
  lifecycle_authority: "proposal_only"
  plan_hash: string
}

export function buildL2MultiSymbolPlan(input: {
  subscription_plan: unknown
  current_assignments: L2RuntimeAssignment[]
  max_instances: number
  base_port: number
  output_base: string
}): L2MultiSymbolPlan {
  const source = compileMarketDataSubscriptionPlan(input.subscription_plan)
  const maxInstances = integer(input.max_instances, 1, 100, "max_instances")
  const basePort = integer(input.base_port, 1024, 65_535, "base_port")
  if (basePort + maxInstances - 1 > 65_535) throw new Error("L2 port range exceeds 65535")
  if (input.output_base !== "data/l2") throw new Error("multi-symbol L2 output_base must be data/l2")
  const current = input.current_assignments.map((assignment, index) => validateAssignment(
    assignment,
    index,
    maxInstances,
    basePort,
    input.output_base,
  ))
  requireUnique(current.map((item) => String(item.slot)), "current assignment slots")
  requireUnique(current.map((item) => item.symbol), "current assignment symbols")

  const desired = source.subscriptions
    .filter((subscription) => subscription.product === "l2_book")
    .map((subscription) => ({
      symbol: subscription.symbol,
      priority: subscription.priority,
      max_freshness_ms: subscription.max_freshness_ms,
      minimum_depth: subscription.minimum_depth!,
      demand_ids: subscription.demand_ids,
    }))
  requireUnique(desired.map((item) => item.symbol), "desired L2 symbols")
  const sourceBlocked = source.status === "capacity_blocked"
  const l2Blocked = desired.length > maxInstances
  if (sourceBlocked || l2Blocked) {
    const withoutHash = {
      schema_version: L2_MULTI_SYMBOL_PLAN_SCHEMA,
      source_plan_hash: source.plan_hash,
      observed_at: source.observed_at,
      status: sourceBlocked ? "source_capacity_blocked" as const : "l2_capacity_blocked" as const,
      capacity: { max_instances: maxInstances, base_port: basePort },
      instances: [],
      actions: [],
      preserved_assignments: current.length,
      lifecycle_authority: "proposal_only" as const,
    }
    return { ...withoutHash, plan_hash: canonicalHash(withoutHash) }
  }

  const desiredBySymbol = new Map(desired.map((item) => [item.symbol, item]))
  const retained = current.filter((assignment) => desiredBySymbol.has(assignment.symbol))
  const obsolete = current.filter((assignment) => !desiredBySymbol.has(assignment.symbol))
  const assignedSymbols = new Set(retained.map((assignment) => assignment.symbol))
  const availableSlots = [
    ...obsolete.map((assignment) => assignment.slot),
    ...Array.from({ length: maxInstances }, (_, slot) => slot)
      .filter((slot) => !current.some((assignment) => assignment.slot === slot)),
  ].sort((a, b) => a - b)
  const additions = desired.filter((item) => !assignedSymbols.has(item.symbol))
  if (additions.length > availableSlots.length) throw new Error("L2 assignment capacity accounting drifted")
  const assigned = additions.map((item, index) => assignmentFor(
    item.symbol,
    availableSlots[index]!,
    basePort,
    input.output_base,
  ))
  const allAssignments = [...retained, ...assigned]
  const instances = allAssignments.map((assignment) => {
    const requirement = desiredBySymbol.get(assignment.symbol)
    if (requirement == null) throw new Error("retained L2 assignment has no desired requirement")
    return { ...assignment, ...requirement }
  }).sort((left, right) => left.slot - right.slot)
  const drainActions: L2MultiSymbolPlan["actions"] = obsolete
    .sort((left, right) => left.slot - right.slot)
    .map((assignment, index) => ({
      sequence: index + 1,
      kind: "drain" as const,
      slot: assignment.slot,
      symbol: assignment.symbol,
      service_id: assignment.service_id,
      reason: "demand_released" as const,
    }))
  const startActions: L2MultiSymbolPlan["actions"] = assigned
    .sort((left, right) => left.slot - right.slot)
    .map((assignment, index) => ({
      sequence: drainActions.length + index + 1,
      kind: "start" as const,
      slot: assignment.slot,
      symbol: assignment.symbol,
      service_id: assignment.service_id,
      reason: "demand_admitted" as const,
    }))
  const withoutHash = {
    schema_version: L2_MULTI_SYMBOL_PLAN_SCHEMA,
    source_plan_hash: source.plan_hash,
    observed_at: source.observed_at,
    status: "ready" as const,
    capacity: { max_instances: maxInstances, base_port: basePort },
    instances,
    actions: [...drainActions, ...startActions],
    preserved_assignments: retained.length,
    lifecycle_authority: "proposal_only" as const,
  }
  return { ...withoutHash, plan_hash: canonicalHash(withoutHash) }
}

function validateAssignment(
  value: L2RuntimeAssignment,
  index: number,
  maxInstances: number,
  basePort: number,
  outputBase: string,
): L2RuntimeAssignment {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`current_assignments[${index}] must be an object`)
  }
  const keys = Object.keys(value)
  const expected = ["slot", "symbol", "service_id", "listen", "output_base"]
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error(`current_assignments[${index}] shape drifted`)
  }
  const slot = integer(value.slot, 0, maxInstances - 1, `current_assignments[${index}].slot`)
  const symbolValue = symbol(value.symbol)
  const expectedAssignment = assignmentFor(symbolValue, slot, basePort, outputBase)
  if (
    value.service_id !== expectedAssignment.service_id
    || value.listen !== expectedAssignment.listen
    || value.output_base !== expectedAssignment.output_base
  ) throw new Error(`current_assignments[${index}] identity drifted`)
  return expectedAssignment
}

function assignmentFor(symbolValue: string, slot: number, basePort: number, outputBase: string): L2RuntimeAssignment {
  return {
    slot,
    symbol: symbolValue,
    service_id: `l2-binance-usdm-${symbolValue.toLowerCase()}`,
    listen: `127.0.0.1:${basePort + slot}`,
    output_base: `${outputBase}/${symbolValue.toLowerCase()}`,
  }
}

function symbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("L2 assignment symbol is invalid")
  return value
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function requireUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} must be unique`)
}
