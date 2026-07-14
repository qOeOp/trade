import { expect, test } from "bun:test"
import {
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  assertReplayExecutionRequest,
  canonicalHash,
  type ReplayExecutionRequest,
} from "./replay-contracts"

const HASH = "a".repeat(64)

export function fixtureRequest(): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1",
    idempotency_key: "replay-1",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    trial_id: "trial-1",
    candidate_id: "candidate-1",
    candidate_hash: HASH,
    identity_hash_policy_version: "rd-identity-v1",
    experiment_contract_hash: HASH,
    dataset_manifest_ref: "dataset://btc-4h",
    dataset_hash: HASH,
    harness_hash: HASH,
    assumptions_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    initial_cash: 10_000,
    order: {
      side: "long",
      quantity: 1,
      signal_time: "2026-07-14T00:00:00Z",
      earliest_executable_time: "2026-07-14T04:00:00Z",
      stop_price: 95,
      target_price: 110,
    },
    cost_policy: { policy_id: "standard", version: "1", fee_bps: 2, slippage_bps: 1 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION,
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      gap_fill_policy: "worse_open",
      position_accounting: "average_cost",
      funding_timing: "exact_event",
    },
    random_seed: 7,
  }
}

test("Replay request requires complete Trial and evidence identity", () => {
  expect(() => assertReplayExecutionRequest(fixtureRequest())).not.toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), dataset_hash: "weak" })).toThrow()
})

test("canonical hash is independent of object key order", () => {
  expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }))
})
