import { expect, test } from "bun:test"
import {
  createForwardObservationProgram,
} from "../apps/research-strategy-development/research-control-plane/contracts/src/lib/forward-observation-program"
import {
  nextForwardCandleSegmentWindow,
} from "./lib/rd-forward-observation-candle-segment"

const HASH = "a".repeat(64)

test("Forward candle segment windows contain only closed bars and catch up in bounded chunks", () => {
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
  expect(nextForwardCandleSegmentWindow(
    program,
    undefined,
    "2026-07-23T07:59:59.999Z",
    10_000,
  )).toBeUndefined()
  expect(nextForwardCandleSegmentWindow(
    program,
    undefined,
    "2026-07-23T08:00:00.000Z",
    10_000,
  )).toEqual({
    start_open_time: Date.parse("2026-07-23T04:00:00.000Z"),
    end_open_time: Date.parse("2026-07-23T04:00:00.000Z"),
    row_count: 1,
  })
  expect(nextForwardCandleSegmentWindow(
    program,
    undefined,
    "2026-07-24T00:01:00.000Z",
    2,
  )).toEqual({
    start_open_time: Date.parse("2026-07-23T04:00:00.000Z"),
    end_open_time: Date.parse("2026-07-23T08:00:00.000Z"),
    row_count: 2,
  })
})
