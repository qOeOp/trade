import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarketDataDemand,
  reconcileMarketDataDemands,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { buildL2MultiSymbolPlan } from "../../../l2-order-book-service/src/control/multi-symbol-plan"
import {
  applyL2MultiSymbolPlan,
  type ManagedL2Pair,
  type ManagedProcess,
  type MarketDataManagerDependencies,
} from "./runtime-manager"

test("manager drains consumer before owner, then starts owner and consumer after readiness", async () => {
  const calls: string[] = []
  const active = new Map<string, ManagedL2Pair>([
    ["l2-binance-usdm-solusdt", existingPair("SOLUSDT", 0)],
  ])
  const plan = desiredPlan("ETHUSDT", active)
  const result = await applyL2MultiSymbolPlan({
    root: "/repo",
    bun_path: "/usr/bin/bun",
    market_data_db: "data/market_data.db",
    plan,
    active,
    dependencies: dependencies(calls),
  })
  assert.equal(result.status, "completed")
  assert.deepEqual(calls, [
    "drain:consumer:l2-binance-usdm-solusdt",
    "drain:owner:l2-binance-usdm-solusdt",
    "start_owner:l2-binance-usdm-ethusdt:ETHUSDT",
    "owner_ready:ETHUSDT",
    "start_consumer:l2-binance-usdm-ethusdt:ETHUSDT",
    "consumer_ready:ETHUSDT",
  ])
  assert.deepEqual(result.active_service_ids, ["l2-binance-usdm-ethusdt"])
})

test("manager preserves current pairs when upstream capacity is blocked", async () => {
  const calls: string[] = []
  const active = new Map<string, ManagedL2Pair>([
    ["l2-binance-usdm-btcusdt", existingPair("BTCUSDT", 0)],
  ])
  const source = reconcileMarketDataDemands({
    demands: [
      demand("BTCUSDT", "defensive-btc"),
      demand("ETHUSDT", "defensive-eth"),
    ],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  })
  const plan = buildL2MultiSymbolPlan({
    subscription_plan: source,
    current_assignments: currentAssignments(active),
    max_instances: 1,
    base_port: 51_100,
    output_base: "data/l2",
  })
  const result = await applyL2MultiSymbolPlan({
    root: "/repo",
    bun_path: "/usr/bin/bun",
    market_data_db: "data/market_data.db",
    plan,
    active,
    dependencies: dependencies(calls),
  })
  assert.equal(result.status, "source_blocked")
  assert.deepEqual(calls, [])
  assert.deepEqual(result.active_service_ids, ["l2-binance-usdm-btcusdt"])
})

test("manager never starts consumer if owner readiness fails and cleans the new owner", async () => {
  const calls: string[] = []
  const active = new Map<string, ManagedL2Pair>()
  const plan = desiredPlan("BTCUSDT", active)
  const deps = dependencies(calls)
  deps.wait_owner_ready = async (symbol, process) => {
    calls.push(`owner_ready:${symbol}`)
    assert.equal(process.role, "owner")
    return false
  }
  const result = await applyL2MultiSymbolPlan({
    root: "/repo",
    bun_path: "/usr/bin/bun",
    market_data_db: "data/market_data.db",
    plan,
    active,
    dependencies: deps,
  })
  assert.equal(result.status, "failed")
  assert.equal(result.failure_class, "owner_not_ready")
  assert.deepEqual(calls, [
    "start_owner:l2-binance-usdm-btcusdt:BTCUSDT",
    "owner_ready:BTCUSDT",
    "drain:owner:l2-binance-usdm-btcusdt",
  ])
  assert.deepEqual(result.active_service_ids, [])
})

function desiredPlan(symbol: string, active: Map<string, ManagedL2Pair>) {
  const source = reconcileMarketDataDemands({
    demands: [demand(symbol, `candidate-${symbol.toLowerCase()}`, "opportunity_candidate")],
    observed_at: "2026-07-23T00:10:00.000Z",
    max_symbols: 1,
  })
  return buildL2MultiSymbolPlan({
    subscription_plan: source,
    current_assignments: currentAssignments(active),
    max_instances: 1,
    base_port: 51_100,
    output_base: "data/l2",
  })
}

function demand(
  symbol: string,
  demandId: string,
  priority: "defensive_exposure" | "opportunity_candidate" = "defensive_exposure",
) {
  return buildMarketDataDemand({
    demand_id: demandId,
    consumer_owner: priority === "defensive_exposure" ? "fast-track-guard" : "slow-track-plan",
    consumer_kind: priority === "defensive_exposure" ? "execution_defense" : "runtime",
    subject_ref: `subject:${symbol}`,
    venue: "binance_usdm",
    symbol,
    priority,
    requirements: [{
      product: "l2_book",
      timeframe: null,
      indicator_set_ref: null,
      coverage_start: null,
      coverage_end: null,
      max_freshness_ms: 1_000,
      minimum_depth: 20,
    }],
    lease: {
      issued_at: "2026-07-23T00:00:00.000Z",
      expires_at: "2026-07-23T01:00:00.000Z",
      renewal_grace_ms: priority === "defensive_exposure" ? 600_000 : 0,
    },
  })
}

function existingPair(symbol: string, slot: number): ManagedL2Pair {
  const serviceId = `l2-binance-usdm-${symbol.toLowerCase()}`
  return {
    assignment: {
      slot,
      symbol,
      service_id: serviceId,
      listen: `127.0.0.1:${51_100 + slot}`,
      output_base: `data/l2/${symbol.toLowerCase()}`,
      priority: "opportunity_candidate",
      max_freshness_ms: 1_000,
      minimum_depth: 20,
      demand_ids: ["old-demand"],
    },
    owner: { service_id: serviceId, role: "owner" },
    consumer: { service_id: serviceId, role: "consumer" },
  }
}

function currentAssignments(active: Map<string, ManagedL2Pair>) {
  return [...active.values()].map(({ assignment }) => ({
    slot: assignment.slot,
    symbol: assignment.symbol,
    service_id: assignment.service_id,
    listen: assignment.listen,
    output_base: assignment.output_base,
  }))
}

function dependencies(calls: string[]): MarketDataManagerDependencies {
  return {
    start_owner: async (command, serviceId) => {
      calls.push(`start_owner:${serviceId}:${argument(command, "--symbol")}`)
      return process(serviceId, "owner")
    },
    wait_owner_ready: async (symbol) => {
      calls.push(`owner_ready:${symbol}`)
      return true
    },
    start_consumer: async (command, serviceId) => {
      calls.push(`start_consumer:${serviceId}:${argument(command, "--symbol")}`)
      return process(serviceId, "consumer")
    },
    wait_consumer_ready: async (symbol) => {
      calls.push(`consumer_ready:${symbol}`)
      return true
    },
    drain: async (value) => {
      calls.push(`drain:${value.role}:${value.service_id}`)
    },
  }
}

function process(serviceId: string, role: ManagedProcess["role"]): ManagedProcess {
  return { service_id: serviceId, role }
}

function argument(command: string[], name: string): string {
  return command[command.indexOf(name) + 1] ?? ""
}
