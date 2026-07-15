import { expect, test } from "bun:test"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  replayDatasetHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplaySupplementalFact,
} from "../../../contracts/src/lib/replay-contracts"
import { fundingEventsInWindow, prepareReplayInputData, resolveReplayInstrumentSpecAt, resolveReplayVenueRiskPolicyAt, selectReplaySupplementalFactsAt } from "./replay-data-adapter"

const HASH = "a".repeat(64)
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const ACCOUNTING = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }
const bars: ReplayMarketBar[] = [
  { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 100, high: 105, low: 95, close: 101, volume: 1, closed: true },
  { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 106, low: 96, close: 102, volume: 1, closed: true },
]
const fundingEvents: ReplayFundingEvent[] = [
  { timestamp: "2026-07-14T03:00:00Z", rate: 0.001, mark_price: 100 },
  { timestamp: "2026-07-14T06:00:00Z", rate: 0.002, mark_price: 102 },
]
const markEvents: ReplayMarkEvent[] = [
  { timestamp: "2026-07-14T00:00:00Z", available_at: "2026-07-14T00:00:00Z", source_sequence: 1, mark_price: 100 },
  { timestamp: "2026-07-14T02:00:00Z", available_at: "2026-07-14T02:00:00Z", source_sequence: 2, mark_price: 100.5 },
  { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 3, mark_price: 101 },
  { timestamp: "2026-07-14T06:00:00Z", available_at: "2026-07-14T06:00:00Z", source_sequence: 4, mark_price: 101.5 },
  { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 5, mark_price: 102 },
]

function request(dataHash = replayDatasetHash(bars, fundingEvents)): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1", idempotency_key: "key-1", experiment_id: "experiment-1",
    trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
    candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: dataHash,
    supplemental_facts_hash: canonicalHash([]),
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]), instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders" },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" },
    random_seed: 1,
  }
}

function manifest(dataHash = replayDatasetHash(bars, fundingEvents)): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1", manifest_ref: "dataset://fixture", data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: "2026-07-14T08:00:00Z", closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

test("data adapter verifies manifest binding and selects the first executable bar", () => {
  const prepared = prepareReplayInputData({ request: request(), dataset_manifest: manifest(), bars, funding_events: fundingEvents })
  expect(prepared.entry_index).toBe(1)
  expect(prepared.limitations).toEqual([])
  expect(fundingEventsInWindow(prepared.funding_events, "2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z")).toHaveLength(1)
})

test("data adapter rejects unordered funding instead of sorting silently", () => {
  const unordered = [...fundingEvents].reverse()
  expect(() => prepareReplayInputData({ request: request(replayDatasetHash(bars, unordered)), dataset_manifest: manifest(replayDatasetHash(bars, unordered)), bars, funding_events: unordered })).toThrow("funding events must be ordered")
})

test("data adapter rejects content hash drift and bars outside instrument lifecycle", () => {
  expect(() => prepareReplayInputData({ request: request(), dataset_manifest: { ...manifest(), data_hash: HASH }, bars, funding_events: fundingEvents })).toThrow("hash binding")
  expect(() => prepareReplayInputData({
    request: request(), dataset_manifest: { ...manifest(), instrument: { ...manifest().instrument, delisted_at: "2026-07-14T06:00:00Z" } }, bars, funding_events: fundingEvents,
  })).toThrow("post-delisting")
})

test("data adapter rejects unbound or cross-epoch PIT policy snapshots before execution", () => {
  expect(() => prepareReplayInputData({
    request: { ...request(), venue_risk_policy_schedule_hash: HASH }, dataset_manifest: manifest(), bars, funding_events: fundingEvents,
  })).toThrow("risk policy schedule hash")

  const feeDrift = request()
  feeDrift.cost_policy = { ...feeDrift.cost_policy, liquidation_fee_bps: 49 }
  expect(() => prepareReplayInputData({ request: feeDrift, dataset_manifest: manifest(), bars, funding_events: fundingEvents }))
    .toThrow("risk parameters")

  const crossing = manifest()
  crossing.venue_risk_policy_epochs = [{ ...crossing.venue_risk_policy_epochs[0], valid_until: crossing.last_close_time }]
  const crossingRequest = { ...request(), venue_risk_policy_schedule_hash: canonicalHash(crossing.venue_risk_policy_epochs) }
  expect(() => prepareReplayInputData({ request: crossingRequest, dataset_manifest: crossing, bars, funding_events: fundingEvents }))
    .toThrow("complete Replay window")

  const accountingDrift = manifest()
  accountingDrift.instrument.accounting = { ...accountingDrift.instrument.accounting, price_increment: "0.1" }
  expect(() => prepareReplayInputData({ request: request(), dataset_manifest: accountingDrift, bars, funding_events: fundingEvents }))
    .toThrow("instrument spec schedule hash")
})

test("data adapter admits contiguous policy schedules and switches on the half-open boundary", () => {
  const riskBoundary = "2026-07-14T04:00:00Z"
  const specBoundary = "2026-07-14T06:00:00Z"
  const scheduled = manifest()
  scheduled.venue_risk_policy_epochs = [
    { ...RISK_SNAPSHOT, valid_until: riskBoundary },
    { ...RISK_SNAPSHOT, snapshot_id: "risk-2", effective_at: riskBoundary, source_ref: "fixture:risk-2", source_hash: "b".repeat(64) },
  ]
  scheduled.instrument.spec_epochs = [
    { ...SPEC_SNAPSHOT, valid_until: specBoundary },
    { ...SPEC_SNAPSHOT, snapshot_id: "spec-2", effective_at: specBoundary, source_ref: "fixture:spec-2", source_hash: "b".repeat(64) },
  ]
  const scheduledRequest = {
    ...request(),
    venue_risk_policy_schedule_hash: canonicalHash(scheduled.venue_risk_policy_epochs),
    instrument_spec_schedule_hash: canonicalHash({ epochs: scheduled.instrument.spec_epochs, accounting: scheduled.instrument.accounting }),
  }
  expect(() => prepareReplayInputData({ request: scheduledRequest, dataset_manifest: scheduled, bars, funding_events: fundingEvents })).not.toThrow()
  expect(resolveReplayVenueRiskPolicyAt(scheduled, "2026-07-14T03:59:59Z").snapshot_id).toBe("risk-1")
  expect(resolveReplayVenueRiskPolicyAt(scheduled, riskBoundary).snapshot_id).toBe("risk-2")
  expect(resolveReplayInstrumentSpecAt(scheduled, specBoundary).snapshot_id).toBe("spec-2")

  const gapped = structuredClone(scheduled)
  gapped.venue_risk_policy_epochs[0].valid_until = "2026-07-14T03:00:00Z"
  expect(() => prepareReplayInputData({ request: scheduledRequest, dataset_manifest: gapped, bars, funding_events: fundingEvents }))
    .toThrow("ordered, non-overlapping, and contiguous")
})

test("supplemental PIT join selects the last visible revision and excludes future corrections", () => {
  const supplementalFacts: ReplaySupplementalFact[] = [
    {
      schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
      record_id: "oi-btc-1", source_id: "binance-open-interest", entity_key: "BTCUSDT", fact_key: "open_interest",
      event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-13T20:01:00Z", received_at: "2026-07-13T20:01:01Z",
      revision_id: "revision-1", source_sequence: 1, payload: { open_interest: "100" },
      content_hash: canonicalHash({ open_interest: "100" }),
    },
    {
      schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
      record_id: "oi-btc-2", source_id: "binance-open-interest", entity_key: "BTCUSDT", fact_key: "open_interest",
      event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-14T02:00:00Z", received_at: "2026-07-14T02:00:01Z",
      revision_id: "revision-2", source_sequence: 2, payload: { open_interest: "110" },
      content_hash: canonicalHash({ open_interest: "110" }),
    },
    {
      schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
      record_id: "oi-eth-1", source_id: "binance-open-interest", entity_key: "ETHUSDT", fact_key: "open_interest",
      event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-14T00:00:00Z", received_at: "2026-07-14T00:00:01Z",
      revision_id: "revision-1", source_sequence: 3, payload: { open_interest: "200" },
      content_hash: canonicalHash({ open_interest: "200" }),
    },
  ]
  const supplementalHash = canonicalHash(supplementalFacts)
  const supplementalRequirementSet = {
    schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
    mode: "signal_time_complete" as const,
    undeclared_input_policy: "reject" as const,
    requirements: [
      { requirement_id: "btc-open-interest", source_id: "binance-open-interest", entity_key: "BTCUSDT", fact_key: "open_interest", event_time_start_inclusive: "2026-07-13T20:00:00Z", event_time_end_inclusive: "2026-07-13T20:00:00Z", minimum_visible_event_count: 1, maximum_latest_event_age_ms: 14_400_000 },
      { requirement_id: "eth-open-interest", source_id: "binance-open-interest", entity_key: "ETHUSDT", fact_key: "open_interest", event_time_start_inclusive: "2026-07-13T20:00:00Z", event_time_end_inclusive: "2026-07-13T20:00:00Z", minimum_visible_event_count: 1, maximum_latest_event_age_ms: 14_400_000 },
    ],
  }
  const supplementalRequirementSetHash = canonicalHash(supplementalRequirementSet)
  const dataHash = replayDatasetHash(bars, fundingEvents, [], supplementalFacts)
  const supplementalManifest: ReplayDatasetManifest = {
    ...manifest(dataHash),
    supplemental_facts: {
      coverage: "signal_time_snapshot", record_count: supplementalFacts.length,
      source_ids: ["binance-open-interest"], content_hash: supplementalHash,
      requirement_set_hash: supplementalRequirementSetHash,
    },
  }
  const supplementalRequest = {
    ...request(dataHash),
    supplemental_facts_hash: supplementalHash,
    supplemental_requirement_set: supplementalRequirementSet,
    supplemental_requirement_set_hash: supplementalRequirementSetHash,
  }
  const prepared = prepareReplayInputData({
    request: supplementalRequest,
    dataset_manifest: supplementalManifest,
    bars,
    funding_events: fundingEvents,
    supplemental_facts: supplementalFacts,
  })
  expect(prepared.supplemental_evidence.selected_record_ids).toEqual(["oi-btc-1", "oi-eth-1"])
  expect(prepared.supplemental_evidence.future_revision_count).toBe(1)
  expect(prepared.supplemental_evidence.requirement_evaluations.map((evaluation) => evaluation.requirement_id)).toEqual(["btc-open-interest", "eth-open-interest"])
  expect(prepared.supplemental_evidence.selected_records_hash).toBe(canonicalHash(
    selectReplaySupplementalFactsAt(supplementalFacts, request().order.signal_time),
  ))
  expect(prepared.supplemental_evidence.decision_input_snapshot_hash).toBe(prepared.decision_input_snapshot.snapshot_hash)
  expect(prepared.decision_input_snapshot.selected_records.map((fact) => fact.record_id)).toEqual(["oi-btc-1", "oi-eth-1"])
  expect(selectReplaySupplementalFactsAt(supplementalFacts, request().order.signal_time)).toEqual(
    selectReplaySupplementalFactsAt(supplementalFacts.filter((fact) => fact.record_id !== "oi-btc-2"), request().order.signal_time),
  )
  expect(prepared.limitations.map((limitation) => limitation.code)).not.toContain("supplemental-signal-derivation-harness-bound")
  const factsWithoutFutureRevision = supplementalFacts.filter((fact) => fact.record_id !== "oi-btc-2")
  const factsWithoutFutureHash = canonicalHash(factsWithoutFutureRevision)
  const dataWithoutFutureHash = replayDatasetHash(bars, fundingEvents, [], factsWithoutFutureRevision)
  const preparedWithoutFutureRevision = prepareReplayInputData({
    request: { ...supplementalRequest, dataset_hash: dataWithoutFutureHash, supplemental_facts_hash: factsWithoutFutureHash },
    dataset_manifest: {
      ...supplementalManifest,
      data_hash: dataWithoutFutureHash,
      supplemental_facts: {
        ...supplementalManifest.supplemental_facts,
        record_count: factsWithoutFutureRevision.length,
        content_hash: factsWithoutFutureHash,
      },
    },
    bars, funding_events: fundingEvents, supplemental_facts: factsWithoutFutureRevision,
  })
  expect(preparedWithoutFutureRevision.decision_input_snapshot.snapshot_hash).toBe(prepared.decision_input_snapshot.snapshot_hash)

  const tampered = supplementalFacts.map((fact, index) => index === 0 ? { ...fact, payload: { open_interest: "999" } } : fact)
  expect(() => prepareReplayInputData({
    request: supplementalRequest, dataset_manifest: supplementalManifest,
    bars, funding_events: fundingEvents, supplemental_facts: tampered,
  })).toThrow("payload hash mismatch")
  expect(() => prepareReplayInputData({
    request: supplementalRequest, dataset_manifest: supplementalManifest,
    bars, funding_events: fundingEvents, supplemental_facts: [...supplementalFacts].reverse(),
  })).toThrow("ordered by source_id and source_sequence")
  const incompleteFacts = supplementalFacts.filter((fact) => fact.entity_key !== "ETHUSDT")
  const incompleteHash = canonicalHash(incompleteFacts)
  const incompleteDataHash = replayDatasetHash(bars, fundingEvents, [], incompleteFacts)
  expect(() => prepareReplayInputData({
    request: { ...supplementalRequest, dataset_hash: incompleteDataHash, supplemental_facts_hash: incompleteHash },
    dataset_manifest: {
      ...supplementalManifest,
      data_hash: incompleteDataHash,
      supplemental_facts: { ...supplementalManifest.supplemental_facts, record_count: incompleteFacts.length, content_hash: incompleteHash },
    },
    bars, funding_events: fundingEvents, supplemental_facts: incompleteFacts,
  })).toThrow("eth-open-interest has insufficient visible events")

  const staleRequirementSet = structuredClone(supplementalRequirementSet)
  staleRequirementSet.requirements[0].maximum_latest_event_age_ms = 14_399_999
  const staleRequirementSetHash = canonicalHash(staleRequirementSet)
  expect(() => prepareReplayInputData({
    request: { ...supplementalRequest, supplemental_requirement_set: staleRequirementSet, supplemental_requirement_set_hash: staleRequirementSetHash },
    dataset_manifest: { ...supplementalManifest, supplemental_facts: { ...supplementalManifest.supplemental_facts, requirement_set_hash: staleRequirementSetHash } },
    bars, funding_events: fundingEvents, supplemental_facts: supplementalFacts,
  })).toThrow("btc-open-interest is stale at decision time")

  const undeclared = { ...supplementalFacts[0], record_id: "volume-1", fact_key: "volume", revision_id: "volume-v1", source_sequence: 4 }
  undeclared.content_hash = canonicalHash(undeclared.payload)
  const undeclaredFacts = [...supplementalFacts, undeclared]
  const undeclaredHash = canonicalHash(undeclaredFacts)
  expect(() => prepareReplayInputData({
    request: { ...supplementalRequest, dataset_hash: replayDatasetHash(bars, fundingEvents, [], undeclaredFacts), supplemental_facts_hash: undeclaredHash },
    dataset_manifest: { ...supplementalManifest, data_hash: replayDatasetHash(bars, fundingEvents, [], undeclaredFacts), supplemental_facts: { ...supplementalManifest.supplemental_facts, record_count: undeclaredFacts.length, content_hash: undeclaredHash } },
    bars, funding_events: fundingEvents, supplemental_facts: undeclaredFacts,
  })).toThrow("outside the frozen requirement set")
})

test("data adapter preserves grid gaps and emits survivorship limitations", () => {
  const gapBars = [bars[0], { ...bars[1], open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z" }]
  const dataHash = replayDatasetHash(gapBars, [])
  const gapManifest: ReplayDatasetManifest = {
    ...manifest(dataHash), row_count: gapBars.length, last_close_time: gapBars[1].close_time, observed_through: gapBars[1].close_time,
    instrument: { ...manifest().instrument, status_history: "current_snapshot_only" },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "survivor_only" },
  }
  const prepared = prepareReplayInputData({ request: request(dataHash), dataset_manifest: gapManifest, bars: gapBars })
  expect(prepared.limitations.map((item) => item.code)).toEqual(["dataset-grid-gap", "instrument-history-incomplete", "survivor-only-universe"])
})

test("data adapter certifies only a complete point-in-time mark grid", () => {
  const dataHash = replayDatasetHash(bars, fundingEvents, markEvents)
  const markManifest: ReplayDatasetManifest = {
    ...manifest(dataHash), mark_coverage: "complete_grid", mark_interval_ms: 7_200_000, mark_event_count: markEvents.length, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
  }
  const prepared = prepareReplayInputData({
    request: request(dataHash), dataset_manifest: markManifest, bars, funding_events: fundingEvents, mark_events: markEvents,
  })
  expect(prepared.mark_events).toEqual(markEvents)

  const lagged = markEvents.map((event, index) => index === 1 ? { ...event, available_at: "2026-07-14T02:00:01Z" } : event)
  expect(() => prepareReplayInputData({
    request: request(replayDatasetHash(bars, fundingEvents, lagged)),
    dataset_manifest: { ...markManifest, data_hash: replayDatasetHash(bars, fundingEvents, lagged) },
    bars, funding_events: fundingEvents, mark_events: lagged,
  })).toThrow("not available at event time")

  expect(() => prepareReplayInputData({
    request: request(dataHash), dataset_manifest: { ...markManifest, mark_event_count: markEvents.length - 1 },
    bars, funding_events: fundingEvents, mark_events: markEvents,
  })).toThrow("count")
})
