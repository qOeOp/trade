import { expect, test } from "bun:test"
import {
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import { executeReplayKernel } from "./replay-reference-engine"

const HASH = "a".repeat(64)

function request(side: "long" | "short" = "long"): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: `run-${side}`,
    idempotency_key: `key-${side}`,
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    trial_id: "trial-1",
    candidate_id: "candidate-1",
    candidate_hash: HASH,
    identity_hash_policy_version: "rd-identity-v1",
    experiment_contract_hash: HASH,
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: HASH,
    harness_hash: HASH,
    assumptions_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    initial_cash: 10_000,
    order: {
      side,
      quantity: 1,
      signal_time: "2026-07-14T00:00:00Z",
      earliest_executable_time: "2026-07-14T04:00:00Z",
      stop_price: side === "long" ? 95 : 105,
      target_price: side === "long" ? 110 : 90,
    },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 2, slippage_bps: 1 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION,
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      gap_fill_policy: "worse_open",
      position_accounting: "average_cost",
      funding_timing: "exact_event",
    },
    random_seed: 1,
  }
}

function bar(openTime: string, closeTime: string, open: number, high: number, low: number, close: number): ReplayMarketBar {
  return { open_time: openTime, close_time: closeTime, open, high, low, close, volume: 100, closed: true }
}

test("closed-candle signal enters at next open and resolves same-bar collision stop first", () => {
  const result = executeReplayKernel({
    request: request(),
    bars: [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 94, 105)],
  })
  expect(result.fills.map((fill) => fill.order_role)).toEqual(["entry", "stop"])
  expect(result.limitations[0]?.severity).toBe("resolution_limited")
  expect(result.metrics.ending_equity).toBeLessThan(10_000)
})

test("stop gap fills at the worse open and ledger conserves equity", () => {
  const result = executeReplayKernel({
    request: request(),
    bars: [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 98, 101),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 90, 93, 88, 91),
    ],
  })
  expect(result.fills[1].order_role).toBe("stop")
  expect(result.fills[1].price).toBeLessThan(95)
  expect(result.ledger.at(-1)?.balance_after).toBe(result.metrics.ending_equity)
})

test("exact funding event enters the unified evidence ledger", () => {
  const result = executeReplayKernel({
    request: request("short"),
    bars: [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 97, 98),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 98, 100, 89, 90),
    ],
    funding_events: [{ timestamp: "2026-07-14T08:00:00Z", rate: 0.001, mark_price: 98 }],
  })
  expect(result.metrics.total_funding).toBe(0.098)
  expect(result.ledger.some((entry) => entry.kind === "funding")).toBe(true)
})

test("rerunning the same request and data is byte-semantically deterministic", () => {
  const input = {
    request: request(),
    bars: [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108)],
  }
  expect(executeReplayKernel(input)).toEqual(executeReplayKernel(input))
})
