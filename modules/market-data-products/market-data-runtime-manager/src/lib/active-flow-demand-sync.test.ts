import assert from "node:assert/strict"
import test from "node:test"
import { buildActiveFlowMarketDataDemands } from "./active-flow-demand-sync"

test("active flow demand sync assigns defensive, plan, and passive priorities without lifecycle authority", () => {
  const result = buildActiveFlowMarketDataDemands({
    active_flow_count: 3,
    active_flows: [
      flow("position", "BTCUSDT", "long", 0, "no_action"),
      flow("plan", "ETHUSDT", "flat", 0, "place_entry"),
      flow("watch", "SOLUSDT", "flat", 0, "no_action"),
    ],
  }, "2026-07-23T00:01:42.000Z")
  assert.equal(result.domain_authority, "none")
  assert.deepEqual(result.demands.map((demand) => [demand.symbol, demand.priority])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]))), [
    ["BTCUSDT", "defensive_exposure"],
    ["ETHUSDT", "active_plan"],
    ["SOLUSDT", "active_flow"],
  ])
  const defensive = result.demands.find((demand) => demand.symbol === "BTCUSDT")!
  assert.equal(defensive.consumer_kind, "execution_defense")
  assert.equal(defensive.lease.issued_at, "2026-07-23T00:01:00.000Z")
  assert.equal(defensive.lease.expires_at, "2026-07-23T00:04:00.000Z")
  assert.equal(defensive.lease.renewal_grace_ms, 600_000)
})

test("same flow renews one stable semantic id while lease hash advances by minute", () => {
  const projection = { active_flow_count: 1, active_flows: [flow("same", "BTCUSDT", "flat", 0, "no_action")] }
  const first = buildActiveFlowMarketDataDemands(projection, "2026-07-23T00:01:01.000Z").demands[0]!
  const sameMinute = buildActiveFlowMarketDataDemands(projection, "2026-07-23T00:01:59.000Z").demands[0]!
  const nextMinute = buildActiveFlowMarketDataDemands(projection, "2026-07-23T00:02:00.000Z").demands[0]!
  assert.equal(first.demand_id, sameMinute.demand_id)
  assert.equal(first.demand_hash, sameMinute.demand_hash)
  assert.equal(first.demand_id, nextMinute.demand_id)
  assert.notEqual(first.demand_hash, nextMinute.demand_hash)
})

test("invalid or incomplete active-flow source fails closed", () => {
  assert.throws(() => buildActiveFlowMarketDataDemands({
    active_flow_count: 2,
    active_flows: [flow("one", "BTCUSDT", "flat", 0, "no_action")],
  }, "2026-07-23T00:00:00.000Z"), /count drifted/)
  assert.throws(() => buildActiveFlowMarketDataDemands({
    active_flow_count: 1,
    active_flows: [flow("one", "", "unknown", 0, "")],
  }, "2026-07-23T00:00:00.000Z"), /canonical symbol/)
})

function flow(
  chainId: string,
  symbol: string,
  positionState: string,
  currentOrdersCount: number,
  targetAction: string,
) {
  return {
    chain_id: chainId,
    symbol,
    current_position_state: positionState,
    current_orders_count: currentOrdersCount,
    current_action_intent: { target_action: targetAction },
  }
}
