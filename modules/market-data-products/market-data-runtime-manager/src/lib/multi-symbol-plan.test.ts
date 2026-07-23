import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketDataDemand,
  reconcileMarketDataDemands,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { buildL2MultiSymbolPlan, type L2RuntimeAssignment } from "./multi-symbol-plan"

test("multi-symbol plan preserves stable slots and drains before replacing lower-priority demand", () => {
  const source = reconcileMarketDataDemands({
    demands: [
      demand("defensive-eth", "ETHUSDT", "defensive_exposure"),
      demand("candidate-btc", "BTCUSDT", "opportunity_candidate"),
    ],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 2,
  })
  const current: L2RuntimeAssignment[] = [
    assignment(0, "BTCUSDT"),
    assignment(1, "SOLUSDT"),
  ]
  const plan = buildL2MultiSymbolPlan({
    subscription_plan: source,
    current_assignments: current,
    max_instances: 2,
    base_port: 51_100,
    output_base: "data/l2",
  })
  assert.equal(plan.status, "ready")
  assert.equal(plan.preserved_assignments, 1)
  assert.deepEqual(plan.instances.map((item) => [item.slot, item.symbol]), [[0, "BTCUSDT"], [1, "ETHUSDT"]])
  assert.deepEqual(plan.actions.map((item) => [item.sequence, item.kind, item.symbol]), [
    [1, "drain", "SOLUSDT"],
    [2, "start", "ETHUSDT"],
  ])
  assert.equal(plan.lifecycle_authority, "proposal_only")
})

test("source defensive capacity failure proposes no stop or start and preserves current processes", () => {
  const source = reconcileMarketDataDemands({
    demands: [
      demand("defensive-btc", "BTCUSDT", "defensive_exposure"),
      demand("defensive-eth", "ETHUSDT", "defensive_exposure"),
    ],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  })
  const plan = buildL2MultiSymbolPlan({
    subscription_plan: source,
    current_assignments: [assignment(0, "BTCUSDT")],
    max_instances: 1,
    base_port: 51_100,
    output_base: "data/l2",
  })
  assert.equal(plan.status, "source_capacity_blocked")
  assert.deepEqual(plan.instances, [])
  assert.deepEqual(plan.actions, [])
  assert.equal(plan.preserved_assignments, 1)
})

test("multi-symbol plan rejects slot, port, output, and assignment identity drift", () => {
  const source = reconcileMarketDataDemands({
    demands: [demand("candidate-btc", "BTCUSDT", "opportunity_candidate")],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  })
  assert.throws(() => buildL2MultiSymbolPlan({
    subscription_plan: source,
    current_assignments: [{ ...assignment(0, "BTCUSDT"), listen: "0.0.0.0:51100" }],
    max_instances: 1,
    base_port: 51_100,
    output_base: "data/l2",
  }), /identity drifted/)
  assert.throws(() => buildL2MultiSymbolPlan({
    subscription_plan: source,
    current_assignments: [],
    max_instances: 100,
    base_port: 65_500,
    output_base: "data/l2",
  }), /port range/)
  assert.throws(() => buildL2MultiSymbolPlan({
    subscription_plan: source,
    current_assignments: [],
    max_instances: 1,
    base_port: 51_100,
    output_base: "tmp/arbitrary",
  }), /must be data\/l2/)
})

function demand(
  demandId: string,
  symbol: string,
  priority: "defensive_exposure" | "opportunity_candidate",
) {
  return buildMarketDataDemand({
    demand_id: demandId,
    consumer_owner: priority === "defensive_exposure" ? "fast-track-guard" : "slow-track-plan",
    consumer_kind: priority === "defensive_exposure" ? "execution_defense" : "runtime",
    subject_ref: priority === "defensive_exposure" ? `flow:${symbol}` : `setup:${symbol}`,
    venue: "binance_usdm",
    symbol,
    priority,
    requirements: [{
      product: "l2_book",
      timeframe: null,
      indicator_set_ref: null,
      coverage_start: null,
      coverage_end: null,
      max_freshness_ms: priority === "defensive_exposure" ? 500 : 1_000,
      minimum_depth: priority === "defensive_exposure" ? 50 : 20,
    }],
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T01:00:00.000Z",
      renewal_grace_ms: priority === "defensive_exposure" ? 600_000 : 0,
    },
  })
}

function assignment(slot: number, symbol: string): L2RuntimeAssignment {
  return {
    slot,
    symbol,
    service_id: `l2-binance-usdm-${symbol.toLowerCase()}`,
    listen: `127.0.0.1:${51_100 + slot}`,
    output_base: `data/l2/${symbol.toLowerCase()}`,
  }
}
