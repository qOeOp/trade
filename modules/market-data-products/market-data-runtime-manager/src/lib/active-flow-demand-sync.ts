import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import { asRecord, numberField, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import {
  buildMarketDataDemand,
  type MarketDataDemand,
  type MarketDataDemandPriority,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"

export interface ActiveFlowDemandSyncPlan {
  schema_version: "trade.active-flow-market-data-demand-sync.v1"
  observed_at: string
  source_active_flow_count: number
  demands: MarketDataDemand[]
  domain_authority: "none"
}

export function buildActiveFlowMarketDataDemands(
  projectionValue: unknown,
  observedAtValue: string,
): ActiveFlowDemandSyncPlan {
  const observedAt = canonicalTime(observedAtValue)
  const issuedAt = new Date(Math.floor(Date.parse(observedAt) / 60_000) * 60_000).toISOString()
  const projection = asRecord(projectionValue)
  const flows = Array.isArray(projection.active_flows) ? projection.active_flows.map(asRecord) : []
  const declaredCount = numberField(projection.active_flow_count)
  if (declaredCount != null && declaredCount !== flows.length) {
    throw new Error("active flow projection count drifted")
  }
  const demands = flows.map((flow) => demandForFlow(flow, issuedAt))
    .sort((left, right) => left.demand_id.localeCompare(right.demand_id))
  if (new Set(demands.map((demand) => demand.demand_id)).size !== demands.length) {
    throw new Error("active flow projection contains duplicate demand identities")
  }
  return {
    schema_version: "trade.active-flow-market-data-demand-sync.v1",
    observed_at: observedAt,
    source_active_flow_count: flows.length,
    demands,
    domain_authority: "none",
  }
}

function demandForFlow(flow: JSONRecord, issuedAt: string): MarketDataDemand {
  const chainId = stringField(flow.chain_id)
  if (!chainId || chainId.length > 256) throw new Error("active flow chain_id is invalid")
  const symbol = stringField(flow.symbol).toUpperCase()
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new Error(`active flow ${chainId} has no valid canonical symbol`)
  }
  const orderCount = numberField(flow.current_orders_count)
  if (!Number.isSafeInteger(orderCount) || orderCount < 0) {
    throw new Error(`active flow ${chainId} current_orders_count is invalid`)
  }
  const positionState = stringField(flow.current_position_state)
  const targetAction = stringField(asRecord(flow.current_action_intent).target_action)
  const defensive = positionState !== "flat" || orderCount > 0
  const priority: MarketDataDemandPriority = defensive
    ? "defensive_exposure"
    : targetAction && targetAction !== "no_action"
    ? "active_plan"
    : "active_flow"
  const leaseMs = 3 * 60_000
  return buildMarketDataDemand({
    demand_id: `active-flow:${canonicalHash(chainId).slice(0, 32)}`,
    consumer_owner: "market-data-active-flow-sync",
    consumer_kind: defensive ? "execution_defense" : "runtime",
    subject_ref: `trade_event_store:chain/${chainId}`,
    venue: "binance_usdm",
    symbol,
    priority,
    requirements: [{
      product: "l2_book",
      timeframe: null,
      indicator_set_ref: null,
      coverage_start: null,
      coverage_end: null,
      max_freshness_ms: defensive ? 1_000 : priority === "active_plan" ? 1_500 : 2_000,
      minimum_depth: 20,
    }],
    lease: {
      issued_at: issuedAt,
      expires_at: new Date(Date.parse(issuedAt) + leaseMs).toISOString(),
      renewal_grace_ms: defensive ? 10 * 60_000 : 0,
    },
  })
}

function canonicalTime(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("active flow demand observed_at must be canonical UTC time")
  }
  return value
}
