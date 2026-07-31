import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS,
  REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION,
  createReplayBarLinkedAggregateTradePathAuthoritySnapshot,
  type ReplayBarLinkedAggregateTradePathAuthoritySnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  canonicalHash,
  createReplayAggregateTradeCoverageAttestation,
  createReplayLiquidityCapacityAttestation,
  createReplaySingleDecisionSchedule,
  replayDatasetHash,
  type ReplayAggregateTradeEvent,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import { createReplayKlineSourceRecord } from "../../../contracts/src/lib/replay-kline-aggregate-trade-bar-link-contracts"
import { materializeReplayKlineAggregateTradeBarLink } from "../../../data-adapter/src/lib/replay-kline-aggregate-trade-bar-link"
import {
  assertReplayBarLinkedStopEntryPathRunOutcome,
  runReplayBarLinkedStopEntryPathStep,
  type ReplayBarLinkedStopEntryPathRunInput,
} from "./replay-bar-linked-stop-entry-path-runner"

const HASH = "c".repeat(64)
const BASE = JSON.parse(readFileSync(new URL(
  "../../../tests/src/fixtures/certified-single-position-v24.json",
  import.meta.url,
), "utf8")) as { request: ReplayExecutionRequest; dataset_manifest: ReplayDatasetManifest }

function fixture(
  side: "long" | "short",
  prices: number[],
): ReplayBarLinkedStopEntryPathRunInput {
  const bar: ReplayMarketBar = {
    open_time: "2026-07-14T04:00:00Z",
    close_time: "2026-07-14T08:00:00Z",
    open: prices[0]!,
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices.at(-1)!,
    volume: prices.length,
    closed: true,
  }
  const capacity = createReplayLiquidityCapacityAttestation({
    schema_version: "trade.rd-replay-liquidity-capacity-attestation.v1",
    attestation_id: `capacity-${side}`,
    attestation_ref: `capacity://fixture/${side}`,
    symbol: "BTCUSDT",
    quantity_unit: "base_asset",
    capacity_scope: "static_order_quantity_ceiling",
    full_fill_capacity: 1,
    calibration_window_start: "2026-07-01T00:00:00Z",
    calibration_window_end: "2026-07-12T00:00:00Z",
    observed_through: "2026-07-12T00:00:00Z",
    available_at: "2026-07-13T00:00:00Z",
    source_ref: `dataset://liquidity/${side}`,
    source_hash: HASH,
    derivation_policy_id: "fixture-static-capacity",
    derivation_policy_version: "v1",
    derivation_policy_hash: HASH,
    evidence_limitation: "not_event_depth_or_queue_position_proof",
  })
  const dataHash = replayDatasetHash([bar])
  const manifest: ReplayDatasetManifest = {
    ...structuredClone(BASE.dataset_manifest),
    data_hash: dataHash,
    row_count: 1,
    first_open_time: bar.open_time,
    last_close_time: bar.close_time,
    observed_through: bar.close_time,
    liquidity_capacity_attestation: capacity,
  }
  const order: ReplayExecutionRequest["order"] = {
    side,
    quantity: 1,
    signal_time: "2026-07-14T00:00:00Z",
    earliest_executable_time: bar.open_time,
    stop_price: side === "long" ? 90 : 110,
    target_price: side === "long" ? 110 : 90,
    entry_execution: {
      order_type: "stop_market",
      trigger_price: side === "long" ? 105 : 95,
      trigger_source: "last_trade_ohlcv",
      time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1",
      full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: capacity.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const request: ReplayExecutionRequest = {
    ...structuredClone(BASE.request),
    run_id: `run-${side}-${canonicalHash(prices).slice(0, 8)}`,
    idempotency_key: `key-${side}-${canonicalHash(prices).slice(0, 8)}`,
    dataset_hash: dataHash,
    order,
    decision_schedule: decisionSchedule,
    decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const events: ReplayAggregateTradeEvent[] = prices.map((price, index) => ({
    schema_version: REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
    symbol: request.symbol,
    aggregate_trade_id: index + 1,
    first_trade_id: index + 1,
    last_trade_id: index + 1,
    trade_time: `2026-07-14T04:0${index}:00Z`,
    available_at: `2026-07-14T04:0${index}:00Z`,
    price,
    quantity: 1,
    buyer_is_maker: false,
  }))
  const coverage = createReplayAggregateTradeCoverageAttestation({
    attestation_id: `coverage-${request.run_id}`,
    attestation_ref: `aggregate-trades://${request.run_id}`,
    symbol: request.symbol,
    coverage_start: bar.open_time,
    coverage_end: bar.close_time,
    source_ref: `archive://${request.run_id}`,
    source_hash: HASH,
    produced_at: bar.close_time,
    events,
  })
  const quoteVolume = prices.reduce((sum, price) => sum + price, 0)
  const kline = createReplayKlineSourceRecord({
    symbol: request.symbol,
    timeframe: request.timeframe,
    market_bar: bar,
    available_at: bar.close_time,
    quote_volume: quoteVolume,
    trade_count: prices.length,
    taker_buy_base_volume: prices.length,
    taker_buy_quote_volume: quoteVolume,
    source_ref: `kline://${request.run_id}`,
    source_hash: HASH,
  })
  const barLink = materializeReplayKlineAggregateTradeBarLink({
    market_bar: bar,
    kline_record: kline,
    aggregate_trade_coverage: coverage,
    aggregate_trade_events: events,
  })
  const authority: ReplayBarLinkedAggregateTradePathAuthoritySnapshot =
    createReplayBarLinkedAggregateTradePathAuthoritySnapshot({
      schema_version: REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION,
      authority_snapshot_id: `authority-${request.run_id}`,
      authority_snapshot_ref: `authority://${request.run_id}`,
      status: "authorized",
      issued_at: "2026-07-14T08:00:01Z",
      authority_id: "research-control-plane",
      authority_policy_version: "rd-bar-linked-path-authority-v1",
      trial_id: request.trial_id,
      run_id: request.run_id,
      reservation_ref: request.trial_reservation_ref,
      reservation_hash: request.trial_reservation_hash,
      request_schema_version: request.schema_version,
      request_hash: canonicalHash(request),
      entry_order_hash: canonicalHash(request.order),
      dataset_manifest_ref: manifest.manifest_ref,
      dataset_hash: manifest.data_hash,
      aggregate_trade_evidence_admission_ref: `admission://aggregate/${request.run_id}`,
      aggregate_trade_evidence_admission_hash: HASH,
      cross_source_ordering_admission_ref: `admission://ordering/${request.run_id}`,
      cross_source_ordering_admission_hash: HASH,
      bar_link_attestation_id: barLink.attestation_id,
      bar_link_attestation_hash: barLink.attestation_hash,
      bar_link_schema_version: barLink.schema_version,
      bar_link_policy_version: barLink.policy_version,
      venue_id: "binance-usdm",
      symbol: request.symbol,
      timeframe: request.timeframe,
      window_start_inclusive: bar.open_time,
      window_end_exclusive: bar.close_time,
      latest_component_available_at: barLink.latest_component_available_at,
      kline_record_hash: barLink.kline_record_hash,
      replay_market_bar_hash: barLink.replay_market_bar_hash,
      aggregate_trade_coverage_attestation_hash: coverage.attestation_hash,
      aggregate_trade_events_hash: coverage.events_hash,
      entry_side: side,
      entry_trigger_price: order.entry_execution.order_type === "stop_market"
        ? order.entry_execution.trigger_price : 0,
      protective_stop_price: order.stop_price,
      protective_target_price: order.target_price,
      consumer_capability: "bounded_initial_stop_market_same_bar_post_entry_protection_ordering",
      entry_scope: "initial_stop_market_entry_only",
      path_resolution_authority: "authorized_for_bound_request_and_bar",
      path_observation_rule: "strictly_after_entry_trigger_trade",
      path_source_authority: "ordered_aggregate_trade_prices_within_linked_bar_only",
      cross_source_ordering_authority: "lineage_only_not_global_sequence",
      fill_quantity_authority: "none",
      cost_authority: "none",
      external_completeness: "not_verified",
      runner_compatibility: "not_bound",
      activation: "forbidden_until_exact_request_runner_consumer",
      limitations: [...REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS],
      limitations_hash: canonicalHash(REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS),
    })
  return {
    activation_mode: "explicit_opt_in_pre_result_binding",
    request,
    dataset_manifest: manifest,
    market_bar: bar,
    path_authority: authority,
    bar_link_attestation: barLink,
    aggregate_trade_coverage: coverage,
    aggregate_trade_events: events,
  }
}

test("opt-in Runner resolves opposite ordered paths for identical OHLC long and short bars", () => {
  for (const [side, targetFirst, stopFirst] of [
    ["long", [100, 105, 110, 90, 100], [100, 105, 90, 110, 100]],
    ["short", [100, 95, 90, 110, 100], [100, 95, 110, 90, 100]],
  ] as const) {
    const targetInput = fixture(side, [...targetFirst])
    const stopInput = fixture(side, [...stopFirst])
    expect(canonicalHash(targetInput.market_bar)).toBe(canonicalHash(stopInput.market_bar))
    const target = runReplayBarLinkedStopEntryPathStep(targetInput)
    const stop = runReplayBarLinkedStopEntryPathStep(stopInput)
    expect(target.step.exact_trade_stop_resolution.terminal_trigger?.role).toBe("target")
    expect(stop.step.exact_trade_stop_resolution.terminal_trigger?.role).toBe("stop")
    expect(target.result_published).toBeFalse()
    expect(target.artifact_published).toBeFalse()
    assertReplayBarLinkedStopEntryPathRunOutcome(target, targetInput)
    assertReplayBarLinkedStopEntryPathRunOutcome(stop, stopInput)
  }
})

test("entry-trigger trade cannot retroactively trigger protection", () => {
  const input = fixture("long", [100, 112, 100, 90, 100])
  const outcome = runReplayBarLinkedStopEntryPathStep(input)
  expect(outcome.step.exact_trade_stop_resolution.entry_trigger?.reference_price).toBe(112)
  expect(outcome.step.exact_trade_stop_resolution.terminal_trigger?.role).toBe("stop")
  expect(outcome.step.exact_trade_stop_resolution.terminal_trigger?.aggregate_trade_id).toBe(4)
})

test("Runner fails closed on Request, linked source, and output tamper", () => {
  const input = fixture("long", [100, 105, 110, 90, 100])
  const requestTamper = structuredClone(input)
  requestTamper.request.idempotency_key = "tampered-but-schema-valid"
  expect(() => runReplayBarLinkedStopEntryPathStep(requestTamper)).toThrow(/Request authority/)

  const otherPath = fixture("long", [100, 105, 90, 110, 100])
  const linkTamper = { ...input, bar_link_attestation: otherPath.bar_link_attestation }
  expect(() => runReplayBarLinkedStopEntryPathStep(linkTamper)).toThrow(/Bar Link authority/)

  const outcome = runReplayBarLinkedStopEntryPathStep(input)
  const outputTamper = structuredClone(outcome)
  outputTamper.step.exact_trade_stop_resolution.terminal_trigger!.role = "stop"
  expect(() => assertReplayBarLinkedStopEntryPathRunOutcome(outputTamper, input)).toThrow()
})
