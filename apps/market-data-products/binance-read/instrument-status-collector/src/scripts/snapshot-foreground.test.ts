import { test } from "bun:test"
import assert from "node:assert/strict"
import type {
  MarketDataSubscriptionPlan,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { instrumentSnapshotJobs, parseArgs } from "./snapshot-foreground"

test("instrument snapshot worker controls are bounded and fixed-path", () => {
  const args = parseArgs([
    "--max-symbols", "12",
    "--max-jobs-per-cycle", "3",
    "--refresh-interval-ms", "900000",
    "--interval-ms", "60000",
    "--command-timeout-ms", "120000",
    "--request-timeout-ms", "10000",
  ])
  assert.equal(args.marketDataDb, "data/market_data.db")
  assert.equal(args.maxJobsPerCycle, 3)
  assert.throws(
    () => parseArgs(["--market-data-db", "/tmp/market.db"]),
    /database path is fixed/,
  )
  assert.throws(
    () => parseArgs(["--refresh-interval-ms", "1200001"]),
    /must be between 60000 and 1200000/,
  )
})

test("instrument snapshot worker fetches only selected symbols without recent evidence", () => {
  const plan: MarketDataSubscriptionPlan = {
    observed_at: "2026-07-23T04:00:00.000Z",
    capacity: { max_symbols: 3 },
    selected_symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    subscriptions: [],
    active_demand_ids: [],
    grace_demand_ids: [],
    expired_demand_ids: [],
    deferred_demand_ids: [],
    attentions: [],
    status: "ready",
    schema_version: "trade.market-data-subscription-plan.v1",
    lifecycle_authority: "none",
    plan_hash: "a".repeat(64),
  }
  assert.deepEqual(
    instrumentSnapshotJobs(plan, new Set(["ETHUSDT"]), 1),
    ["BTCUSDT"],
  )
})
