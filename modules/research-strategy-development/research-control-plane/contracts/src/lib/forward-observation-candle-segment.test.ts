import { expect, test } from "bun:test"
import {
  buildOhlcvCoverageAuditFixture,
} from "../../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-test-fixtures"
import {
  reconcileMarketDataDemands,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  buildForwardObservationMarketDataDemand,
  createForwardObservationProgram,
} from "./forward-observation-program"
import {
  assertForwardObservationCandleSegment,
  createForwardObservationCandleSegment,
} from "./forward-observation-candle-segment"

const HASH = "a".repeat(64)

test("Forward candle segments bind selected demand, complete owner coverage, and immutable slices", () => {
  const program = fixtureProgram()
  const demand = buildForwardObservationMarketDataDemand(program, {
    issued_at: "2026-07-23T03:00:00.000Z",
  })
  const observedAt = "2026-07-23T08:01:00.000Z"
  const plan = reconcileMarketDataDemands({
    demands: [demand],
    observed_at: observedAt,
    max_symbols: 20,
  })
  const start = Date.parse(program.first_observation_open_time)
  const audit = buildOhlcvCoverageAuditFixture({
    symbol: program.symbol,
    timeframe: program.timeframe,
    start_open_time: start,
    end_open_time: start,
  }, observedAt, true)
  const segment = createForwardObservationCandleSegment({
    program,
    previous_segment: null,
    demand,
    demand_accepted_at: "2026-07-23T03:00:01.000Z",
    subscription_plan: plan,
    coverage_audit: audit,
    candle_slice: fixtureSlice(start, start, 1),
    created_at: observedAt,
  })
  expect(segment.window.data_watermark)
    .toBe("2026-07-23T08:00:00.000Z")
  expect(segment.authority).toEqual({
    forward_dataset_materialization_authority: "segment_only",
    forward_replay_admission_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  })
  expect(() => assertForwardObservationCandleSegment(program, segment))
    .not.toThrow()

  const drifted = structuredClone(segment)
  drifted.candle_slice.rows = 2
  expect(() => assertForwardObservationCandleSegment(program, drifted))
    .toThrow()
})

test("Forward candle segments form a gapless predecessor chain", () => {
  const program = fixtureProgram()
  const demand = buildForwardObservationMarketDataDemand(program, {
    issued_at: "2026-07-23T03:00:00.000Z",
  })
  const firstObservedAt = "2026-07-23T08:01:00.000Z"
  const start = Date.parse(program.first_observation_open_time)
  const first = createForwardObservationCandleSegment({
    program,
    previous_segment: null,
    demand,
    demand_accepted_at: "2026-07-23T03:00:01.000Z",
    subscription_plan: reconcileMarketDataDemands({
      demands: [demand],
      observed_at: firstObservedAt,
      max_symbols: 20,
    }),
    coverage_audit: buildOhlcvCoverageAuditFixture({
      symbol: program.symbol,
      timeframe: program.timeframe,
      start_open_time: start,
      end_open_time: start,
    }, firstObservedAt, true),
    candle_slice: fixtureSlice(start, start, 1),
    created_at: firstObservedAt,
  })
  const secondStart = start + 14_400_000
  const secondObservedAt = "2026-07-23T12:01:00.000Z"
  const second = createForwardObservationCandleSegment({
    program,
    previous_segment: {
      segment_id: first.segment_id,
      segment_hash: first.segment_hash,
      end_open_time: first.window.end_open_time,
    },
    demand,
    demand_accepted_at: "2026-07-23T03:00:01.000Z",
    subscription_plan: reconcileMarketDataDemands({
      demands: [demand],
      observed_at: secondObservedAt,
      max_symbols: 20,
    }),
    coverage_audit: buildOhlcvCoverageAuditFixture({
      symbol: program.symbol,
      timeframe: program.timeframe,
      start_open_time: secondStart,
      end_open_time: secondStart,
    }, secondObservedAt, true),
    candle_slice: fixtureSlice(secondStart, secondStart, 1),
    created_at: secondObservedAt,
  })
  expect(() => assertForwardObservationCandleSegment(
    program,
    second,
    first,
  )).not.toThrow()

  const gap = structuredClone(second)
  gap.coverage_audit.requested_open_range.start_open_time += 14_400_000
  expect(() => assertForwardObservationCandleSegment(
    program,
    gap,
    first,
  )).toThrow()
})

function fixtureProgram() {
  return createForwardObservationProgram({
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
}

function fixtureSlice(
  firstOpen: number,
  lastOpen: number,
  rows: number,
) {
  const hash = "b".repeat(64)
  return {
    schema_version: "market-data.candle-slice-export.v1" as const,
    slice_ref: `market-data://candle-slice/${hash}`,
    manifest_path:
      `data/artifacts/market-data/candle-slices/${hash}/manifest.json`,
    content_sha256: hash,
    rows,
    first_open_ts: firstOpen,
    last_open_ts: lastOpen,
  }
}
