import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { buildSinglePositionLedger, calculateFundingCashflowV3 } from "../../accounting/src/lib/replay-accounting"
import { buildReplayJournal } from "../../accounting/src/lib/replay-journal"
import { buildCertifiedSinglePositionProjection } from "../../accounting/src/lib/replay-position-accounting"
import { REPLAY_JOURNAL_POLICY_VERSION, canonicalHash, createReplaySingleDecisionSchedule, replayDatasetHash, type ReplayDatasetManifest, type ReplayExecutionRequest, type ReplayFundingEvent, type ReplayMarkEvent, type ReplayMarketBar } from "../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../contracts/src/lib/replay-decimal"
import { executeReplayKernel } from "../../engine/src/lib/replay-reference-engine"
import { compareReplayEventKeys } from "../../engine/src/lib/replay-event-key"
import { deriveReplayMetrics } from "../../metrics/src/lib/replay-metrics"

interface GoldenFixture {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  expected_semantic_digest: string
}

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/certified-single-position-v19.json", import.meta.url), "utf8",
)) as GoldenFixture
const openPositionFixture = JSON.parse(readFileSync(
  new URL("./fixtures/certified-open-position-v1.json", import.meta.url), "utf8",
)) as { bars: ReplayMarketBar[]; expected_semantic_digest: string }
const liquidationFixture = JSON.parse(readFileSync(
  new URL("./fixtures/certified-liquidation-v1.json", import.meta.url), "utf8",
)) as { bars: ReplayMarketBar[]; mark_events: ReplayMarkEvent[]; isolated_collateral: number; liquidation_fee_bps: number; expected_semantic_digest: string }

test("golden: certified single-position semantic digest is stable", () => {
  const result = executeReplayKernel(fixture)
  expect(semanticDigest(result)).toBe(fixture.expected_semantic_digest)
  expect(result.order_events.map((event) => event.kind)).toEqual([
    "submitted", "activated", "filled",
    "submitted", "activated", "submitted", "activated",
    "triggered", "filled", "cancelled",
  ])
  expect(result.fills.every((fill) => result.order_events.some((event) => event.order_id === fill.order_id && event.kind === "filled"))).toBe(true)
  expect(result.fingerprint.journal_policy_version).toBe(REPLAY_JOURNAL_POLICY_VERSION)
  expect(result.fingerprint.margin_policy_hash).toBe(canonicalHash(fixture.request.margin_policy))
  expect(result.trial_balance.policy_version).toBe(REPLAY_JOURNAL_POLICY_VERSION)
  expect(result.trial_balance.isolated_margin_collateral_balance).toBe(0)
  expect(result.trial_balance.settled_cash_balance).toBe(result.equity_bridge.cash_balance)
  expect(result.journal.filter((entry) => entry.kind === "collateral_reserve" || entry.kind === "collateral_release").map((entry) => entry.kind)).toEqual([
    "collateral_reserve",
    "collateral_release",
  ])
  expect(result.margin_snapshots[0].stage).toBe("post_entry")
  expect(result.margin_snapshots.at(-1)?.stage).toBe("terminal")
  expect(result.margin_snapshots.some((snapshot) => snapshot.stage === "path")).toBe(true)
  expect(result.margin_snapshots.filter((snapshot) => snapshot.stage === "path").map((snapshot) => [snapshot.mark_source, snapshot.resolution])).toEqual([
    ["funding_mark", "exact"],
    ["bar_adverse_extreme", "ohlcv_adverse_extreme"],
  ])
  expect(result.margin_snapshots.map((snapshot) => snapshot.snapshot_sequence)).toEqual(
    result.margin_snapshots.map((_, index) => index + 1),
  )
  for (let index = 1; index < result.order_events.length; index += 1) {
    expect(compareReplayEventKeys(result.order_events[index - 1].event_key, result.order_events[index].event_key)).toBeLessThan(0)
  }
  const mergedEvidenceKeys = [...result.source_events.map((event) => event.event_key), ...result.order_events.map((event) => event.event_key)]
    .sort(compareReplayEventKeys)
  for (let index = 1; index < mergedEvidenceKeys.length; index += 1) {
    expect(compareReplayEventKeys(mergedEvidenceKeys[index - 1], mergedEvidenceKeys[index])).toBeLessThan(0)
  }
})

test("golden: open terminal Position is marked without a synthetic exit Fill", () => {
  const request = structuredClone(fixture.request)
  request.run_id = "golden-open-run"
  request.idempotency_key = "golden-open-idempotency"
  const result = executeReplayKernel(boundInput(request, openPositionFixture.bars))
  expect(semanticDigest(result)).toBe(openPositionFixture.expected_semantic_digest)
  expect(result.fills.map((fill) => fill.order_role)).toEqual(["entry"])
  expect(result.positions.at(-1)?.state).toBe("open")
  expect(result.valuation_snapshot.mark_source).toBe("bar_close")
  expect(result.equity_bridge.ending_equity).toBe(addReplayDecimalValues(
    result.equity_bridge.cash_balance,
    result.equity_bridge.position_valuation,
  ))
  expect(result.trial_balance.position_valuation_balance).toBe(result.equity_bridge.position_valuation)
  expect(result.trial_balance.wallet_cash_balance).toBe(0)
  expect(result.trial_balance.isolated_margin_collateral_balance).toBe(result.equity_bridge.cash_balance)
  expect(result.trial_balance.settled_cash_balance).toBe(result.equity_bridge.cash_balance)
  expect(result.journal.some((entry) => entry.kind === "collateral_reserve")).toBe(true)
  expect(result.journal.some((entry) => entry.kind === "collateral_release")).toBe(false)
  expect(result.margin_snapshots[0].state).toBe("healthy")
  expect(result.margin_snapshots.filter((snapshot) => snapshot.stage === "path").map((snapshot) => [snapshot.mark_source, snapshot.resolution])).toEqual([
    ["bar_adverse_extreme", "ohlcv_adverse_extreme"],
    ["bar_open", "exact"],
    ["bar_adverse_extreme", "ohlcv_adverse_extreme"],
  ])
  expect(result.margin_snapshots.at(-1)?.liquidation_evaluated).toBe(false)
})

test("golden: exact-risk full liquidation conserves the unified ledger", () => {
  const request = structuredClone(fixture.request)
  request.run_id = "golden-liquidation-run"
  request.idempotency_key = "golden-liquidation-idempotency"
  request.margin_policy.isolated_collateral = liquidationFixture.isolated_collateral
  request.cost_policy.liquidation_fee_bps = liquidationFixture.liquidation_fee_bps
  const dataHash = replayDatasetHash(liquidationFixture.bars, [], liquidationFixture.mark_events)
  request.dataset_hash = dataHash
  const result = executeReplayKernel({
    request,
    dataset_manifest: {
      ...structuredClone(fixture.dataset_manifest),
      data_hash: dataHash,
      row_count: liquidationFixture.bars.length,
      first_open_time: liquidationFixture.bars[0].open_time,
      last_close_time: liquidationFixture.bars.at(-1)!.close_time,
      observed_through: liquidationFixture.bars.at(-1)!.close_time,
      mark_coverage: "complete_grid",
      mark_interval_ms: 14_400_000,
      mark_event_count: liquidationFixture.mark_events.length, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    },
    bars: liquidationFixture.bars,
    mark_events: liquidationFixture.mark_events,
  })
  expect(semanticDigest(result)).toBe(liquidationFixture.expected_semantic_digest)
  expect(result.liquidation?.liquidation_fill_id).toBe(result.fills.at(-1)?.fill_id)
  expect(result.ledger.filter((entry) => entry.kind === "liquidation_fee")).toHaveLength(1)
  expect(result.trial_balance.debit_total).toBe(result.trial_balance.credit_total)
  expect(result.trial_balance.ending_equity).toBe(result.metrics.ending_equity)
  expect(result.margin_snapshots.filter((snapshot) => snapshot.maintenance_breach_observed)).toHaveLength(1)
})

test("property: exact-risk liquidation is deterministic for long and short", () => {
  for (const [side, triggerMark] of [["long", 80.4], ["short", 119.4]] as const) {
    const request = structuredClone(fixture.request)
    request.run_id = `liquidation-${side}`
    request.idempotency_key = request.run_id
    request.order.side = side
    request.order.stop_price = side === "long" ? 90 : 110
    request.order.target_price = side === "long" ? 110 : 90
    request.decision_schedule = createReplaySingleDecisionSchedule(request.order)
    request.decision_schedule_hash = canonicalHash(request.decision_schedule)
    request.margin_policy.isolated_collateral = 20
    request.cost_policy.liquidation_fee_bps = 10
    const marks: ReplayMarkEvent[] = [
      { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
      { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: triggerMark },
    ]
    const input = boundExactMarkInput(request, liquidationFixture.bars, marks)
    const first = executeReplayKernel(input)
    const second = executeReplayKernel(input)
    expect(canonicalHash(first)).toBe(canonicalHash(second))
    expect(first.fills.at(-1)?.order_role).toBe("liquidation")
    expect(first.fills.at(-1)?.side).toBe(side === "long" ? "sell" : "buy")
    expect(first.positions.at(-1)?.state).toBe("flat")
    expect(first.liquidation?.trigger_observation.execution_status).toBe("simulated_full_close")
  }
})

test("property: ledger and metric conservation holds across long and short exits", () => {
  for (const side of ["long", "short"] as const) {
    for (const exit of ["stop", "target"] as const) {
      const request = structuredClone(fixture.request)
      request.run_id = `${side}-${exit}`
      request.idempotency_key = request.run_id
      request.order.side = side
      request.order.stop_price = side === "long" ? 90 : 110
      request.order.target_price = side === "long" ? 110 : 90
      request.decision_schedule = createReplaySingleDecisionSchedule(request.order)
      request.decision_schedule_hash = canonicalHash(request.decision_schedule)
      const bar = structuredClone(fixture.bars[0])
      bar.high = (side === "long" && exit === "target") || (side === "short" && exit === "stop") ? 111 : 105
      bar.low = (side === "long" && exit === "stop") || (side === "short" && exit === "target") ? 89 : 95
      bar.close = 100
      const result = executeReplayKernel(boundInput(request, [bar]))
      expect(result.ledger.at(-1)?.balance_after).toBe(result.metrics.ending_equity)
      expect(result.metrics.net_pnl).toBeCloseTo(result.metrics.ending_equity - request.initial_cash, 10)
      expect(result.fills.at(-1)?.reduce_only).toBe(true)
      expect(result.margin_snapshots.find((snapshot) => snapshot.mark_source === "bar_adverse_extreme")?.mark_price).toBe(
        side === "long" ? bar.low : bar.high,
      )
      expect(result.trial_balance.debit_total).toBe(result.trial_balance.credit_total)
      expect(result.trial_balance.wallet_cash_balance).toBe(result.metrics.ending_equity)
      expect(result.trial_balance.isolated_margin_collateral_balance).toBe(0)
      expect(result.trial_balance.settled_cash_balance).toBe(result.metrics.ending_equity)
    }
  }
})

test("causality: fills and monetary ledger facts bind to exact EventKeys", () => {
  const result = executeReplayKernel(fixture)
  for (const fill of result.fills) {
    const orderEvent = result.order_events.find((event) => event.order_id === fill.order_id && event.kind === "filled")
    expect(orderEvent?.event_key).toEqual(fill.event_key)
    expect(fill.timestamp).toBe(fill.event_key.event_time)
  }
  for (const entry of result.ledger) {
    expect(entry.timestamp).toBe(entry.event_key.event_time)
    if (entry.kind === "funding") {
      expect(result.source_events.find((event) => event.source_event_id === entry.ref)?.event_key).toEqual(entry.event_key)
    }
    if (entry.kind === "fee" || entry.kind === "realized_pnl") {
      expect(result.fills.find((fill) => fill.fill_id === entry.ref)?.event_key).toEqual(entry.event_key)
    }
  }
  expect(result.ledger[0].event_key.boundary_phase).toBe(70)
  expect(result.ledger.at(-1)?.event_key.boundary_phase).toBe(100)
  for (const position of result.positions) {
    const fill = result.fills.find((candidate) => candidate.fill_id === position.cause_fill_id)
    if (!fill) throw new Error(`position projection has no cause Fill: ${position.cause_fill_id}`)
    expect(position.event_key).toEqual(fill.event_key)
    expect(position.timestamp).toBe(position.event_key.event_time)
  }
  for (const journalEntry of result.journal) {
    expect(journalEntry.timestamp).toBe(journalEntry.event_key.event_time)
    expect(journalEntry.legs[0].amount).toBe(journalEntry.legs[1].amount)
    expect(journalEntry.legs[0].asset).toBe(fixture.dataset_manifest.instrument.accounting.settlement_asset)
    expect(journalEntry.legs[1].asset).toBe(fixture.dataset_manifest.instrument.accounting.settlement_asset)
  }
  for (const snapshot of result.margin_snapshots) {
    expect(snapshot.timestamp).toBe(snapshot.event_key.event_time)
    expect(result.positions.some((position) => position.position_event_id === snapshot.position_event_id)).toBe(true)
    expect(snapshot.liquidation_evaluated).toBe(false)
  }
})

test("metamorphic: scaling prices and cash preserves return fraction and exit role", () => {
  const base = executeReplayKernel(fixture)
  const scale = 3
  const request = structuredClone(fixture.request)
  request.run_id = "scaled"
  request.idempotency_key = "scaled"
  request.initial_cash *= scale
  request.margin_policy.isolated_collateral *= scale
  request.order.stop_price *= scale
  request.order.target_price *= scale
  request.decision_schedule = createReplaySingleDecisionSchedule(request.order)
  request.decision_schedule_hash = canonicalHash(request.decision_schedule)
  const bars = fixture.bars.map((bar) => ({
    ...bar,
    open: bar.open * scale,
    high: bar.high * scale,
    low: bar.low * scale,
    close: bar.close * scale,
  }))
  const fundingEvents = fixture.funding_events.map((event) => ({ ...event, mark_price: event.mark_price * scale }))
  const scaledInput = boundInput(request, bars, fundingEvents)
  scaledInput.dataset_manifest.instrument.accounting.price_increment = "0.03"
  scaledInput.dataset_manifest.instrument.accounting.settlement_increment = "0.00000003"
  scaledInput.request.instrument_spec_schedule_hash = canonicalHash({
    epochs: scaledInput.dataset_manifest.instrument.spec_epochs,
    accounting: scaledInput.dataset_manifest.instrument.accounting,
  })
  const scaled = executeReplayKernel(scaledInput)
  expect(scaled.fills.at(-1)?.order_role).toBe(base.fills.at(-1)?.order_role)
  expect(scaled.metrics.return_fraction).toBe(base.metrics.return_fraction)
  expect(scaled.metrics.net_pnl).toBe(addReplayDecimalValues(base.metrics.net_pnl, base.metrics.net_pnl, base.metrics.net_pnl))
})

test("parity: engine result equals accounting and metrics component projections", () => {
  const result = executeReplayKernel(fixture)
  const entry = result.fills[0]
  const exit = result.fills[1]
  const accountingSpec = fixture.dataset_manifest.instrument.accounting
  const fundingCashflows = fixture.funding_events.map((event) => calculateFundingCashflowV3(
    event.mark_price,
    result.fills[0].quantity,
    event.rate,
    fixture.request.order.side,
    accountingSpec.settlement_increment,
  ))
  const ledger = buildSinglePositionLedger({
    run_id: fixture.request.run_id,
    initial_cash: fixture.request.initial_cash,
    initial_event_key: result.ledger[0].event_key,
    ending_event_key: result.ledger.at(-1)!.event_key,
    fills: [entry, exit],
    positions: result.positions,
    funding_events: fixture.funding_events,
    funding_cashflows: fundingCashflows,
    funding_refs: result.ledger.filter((entry) => entry.kind === "funding").map((entry) => entry.ref),
    funding_event_keys: result.ledger.filter((entry) => entry.kind === "funding").map((entry) => entry.event_key),
    settlement_increment: accountingSpec.settlement_increment,
  })
  expect(ledger).toEqual(result.ledger)
  expect(buildReplayJournal({
    run_id: fixture.request.run_id,
    settlement_asset: fixture.dataset_manifest.instrument.accounting.settlement_asset,
    settlement_increment: accountingSpec.settlement_increment,
    ledger,
    valuation_snapshot: result.valuation_snapshot,
    equity_bridge: result.equity_bridge,
    margin_snapshots: result.margin_snapshots,
  })).toEqual({ journal: result.journal, trial_balance: result.trial_balance })
  expect(buildCertifiedSinglePositionProjection({
    run_id: fixture.request.run_id,
    symbol: fixture.request.symbol,
    accounting_spec: accountingSpec,
    fills: [entry, exit],
  })).toEqual(result.positions)
  expect(deriveReplayMetrics({
    initial_cash: fixture.request.initial_cash,
    fills: result.fills,
    ledger,
    equity_bridge: result.equity_bridge,
    margin_snapshots: result.margin_snapshots,
  })).toEqual(result.metrics)
})

test("metamorphic: appending data after a terminal fill does not change semantic evidence", () => {
  const base = executeReplayKernel(fixture)
  const futureBar: ReplayMarketBar = {
    open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z",
    open: 109, high: 500, low: 1, close: 250, volume: 20, closed: true,
  }
  const extended = executeReplayKernel(boundInput(fixture.request, [...fixture.bars, futureBar], fixture.funding_events))
  expect(semanticDigest(extended)).toBe(semanticDigest(base))
})

test("data integrity: changing a bar without changing the frozen manifest is rejected", () => {
  const changedBars = fixture.bars.map((bar) => ({ ...bar, close: bar.close - 1 }))
  expect(() => executeReplayKernel({ ...fixture, bars: changedBars })).toThrow("content hash mismatch")
})

function semanticDigest(result: ReturnType<typeof executeReplayKernel>): string {
  return canonicalHash({ source_events: result.source_events, order_events: result.order_events, fills: result.fills, positions: result.positions, ledger: result.ledger, valuation_snapshot: result.valuation_snapshot, equity_bridge: result.equity_bridge, margin_snapshots: result.margin_snapshots, liquidation: result.liquidation, journal: result.journal, trial_balance: result.trial_balance, metrics: result.metrics, limitations: result.limitations })
}

function boundInput(request: ReplayExecutionRequest, bars: ReplayMarketBar[], fundingEvents: ReplayFundingEvent[] = []) {
  const dataHash = replayDatasetHash(bars, fundingEvents)
  const last = bars.at(-1)
  if (!last || !bars[0]) throw new Error("certification fixture requires bars")
  return {
    request: { ...request, dataset_hash: dataHash },
    dataset_manifest: {
      ...fixture.dataset_manifest,
      instrument: structuredClone(fixture.dataset_manifest.instrument),
      universe: structuredClone(fixture.dataset_manifest.universe),
      data_hash: dataHash,
      row_count: bars.length,
      first_open_time: bars[0].open_time,
      last_close_time: last.close_time,
      observed_through: last.close_time,
    },
    bars,
    funding_events: fundingEvents,
  }
}

function boundExactMarkInput(request: ReplayExecutionRequest, bars: ReplayMarketBar[], marks: ReplayMarkEvent[]) {
  const dataHash = replayDatasetHash(bars, [], marks)
  const last = bars.at(-1)
  if (!last || !bars[0]) throw new Error("exact Mark fixture requires bars")
  return {
    request: { ...request, dataset_hash: dataHash },
    dataset_manifest: {
      ...structuredClone(fixture.dataset_manifest),
      data_hash: dataHash,
      row_count: bars.length,
      first_open_time: bars[0].open_time,
      last_close_time: last.close_time,
      observed_through: last.close_time,
      mark_coverage: "complete_grid" as const,
      mark_interval_ms: 14_400_000,
      mark_event_count: marks.length, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    },
    bars,
    mark_events: marks,
  }
}
