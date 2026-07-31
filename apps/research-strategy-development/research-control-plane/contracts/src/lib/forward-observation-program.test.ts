import { expect, test } from "bun:test"
import {
  assertForwardObservationMarketDataDemand,
  assertForwardObservationProgram,
  buildForwardObservationMarketDataDemand,
  createForwardObservationProgram,
} from "./forward-observation-program"

const HASH = "a".repeat(64)

test("Forward observation program derives a strict post-freeze OHLCV demand without session authority", () => {
  const program = createForwardObservationProgram({
    program_id: "forward-program-1",
    source_admission_id: "forward-source-1",
    source_binding_hash: HASH,
    experiment_id: "experiment-1",
    decision_id: "decision-1",
    draft_id: "draft-1",
    strategy_id: "S-1",
    strategy_version: "draft-1",
    strategy_policy_hash: HASH,
    selected_trial_id: "trial-1",
    historical_replay_request_registration_id: "registration-1",
    historical_replay_request_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    frozen_at: "2026-07-23T01:15:00.000Z",
    market_data_demand_id: "rd-forward:source-1",
    created_at: "2026-07-23T02:00:00.000Z",
  })
  expect(() => assertForwardObservationProgram(program)).not.toThrow()
  expect(program.first_observation_open_time)
    .toBe("2026-07-23T04:00:00.000Z")
  expect(program.authority.forward_session_authority).toBe("none")
  const demand = buildForwardObservationMarketDataDemand(program, {
    issued_at: "2026-07-23T02:01:42.000Z",
  })
  expect(demand.lease.issued_at).toBe("2026-07-23T02:01:00.000Z")
  expect(demand.requirements).toEqual([{
    product: "ohlcv",
    timeframe: "4h",
    indicator_set_ref: null,
    coverage_start: "2026-07-23T04:00:00.000Z",
    coverage_end: null,
    max_freshness_ms: 60_000,
    minimum_depth: null,
  }])
  expect(() => assertForwardObservationMarketDataDemand(program, demand))
    .not.toThrow()
  expect(() => assertForwardObservationProgram({
    ...program,
    first_observation_open_time: "2026-07-23T00:00:00.000Z",
  })).toThrow()
})
