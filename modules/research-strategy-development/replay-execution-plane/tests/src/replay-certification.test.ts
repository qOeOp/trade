import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { buildSinglePositionLedger, calculateFundingCashflowV3 } from "../../accounting/src/lib/replay-accounting"
import { buildReplayJournal } from "../../accounting/src/lib/replay-journal"
import { buildCertifiedSinglePositionProjection } from "../../accounting/src/lib/replay-position-accounting"
import { REPLAY_JOURNAL_POLICY_VERSION, canonicalHash, replayDatasetHash, type ReplayDatasetManifest, type ReplayExecutionRequest, type ReplayFundingEvent, type ReplayMarketBar } from "../../contracts/src/lib/replay-contracts"
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
  new URL("./fixtures/certified-single-position-v7.json", import.meta.url), "utf8",
)) as GoldenFixture

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
  expect(result.trial_balance.policy_version).toBe(REPLAY_JOURNAL_POLICY_VERSION)
  for (let index = 1; index < result.order_events.length; index += 1) {
    expect(compareReplayEventKeys(result.order_events[index - 1].event_key, result.order_events[index].event_key)).toBeLessThan(0)
  }
  const mergedEvidenceKeys = [...result.source_events.map((event) => event.event_key), ...result.order_events.map((event) => event.event_key)]
    .sort(compareReplayEventKeys)
  for (let index = 1; index < mergedEvidenceKeys.length; index += 1) {
    expect(compareReplayEventKeys(mergedEvidenceKeys[index - 1], mergedEvidenceKeys[index])).toBeLessThan(0)
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
      const bar = structuredClone(fixture.bars[0])
      bar.high = (side === "long" && exit === "target") || (side === "short" && exit === "stop") ? 111 : 105
      bar.low = (side === "long" && exit === "stop") || (side === "short" && exit === "target") ? 89 : 95
      bar.close = 100
      const result = executeReplayKernel(boundInput(request, [bar]))
      expect(result.ledger.at(-1)?.balance_after).toBe(result.metrics.ending_equity)
      expect(result.metrics.net_pnl).toBeCloseTo(result.metrics.ending_equity - request.initial_cash, 10)
      expect(result.fills.at(-1)?.reduce_only).toBe(true)
      expect(result.trial_balance.debit_total).toBe(result.trial_balance.credit_total)
      expect(result.trial_balance.wallet_cash_balance).toBe(result.metrics.ending_equity)
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
})

test("metamorphic: scaling prices and cash preserves return fraction and exit role", () => {
  const base = executeReplayKernel(fixture)
  const scale = 3
  const request = structuredClone(fixture.request)
  request.run_id = "scaled"
  request.idempotency_key = "scaled"
  request.initial_cash *= scale
  request.order.stop_price *= scale
  request.order.target_price *= scale
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
  })).toEqual({ journal: result.journal, trial_balance: result.trial_balance })
  expect(buildCertifiedSinglePositionProjection({
    run_id: fixture.request.run_id,
    symbol: fixture.request.symbol,
    accounting_spec: accountingSpec,
    fills: [entry, exit],
  })).toEqual(result.positions)
  expect(deriveReplayMetrics({ initial_cash: fixture.request.initial_cash, fills: result.fills, ledger })).toEqual(result.metrics)
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
  return canonicalHash({ source_events: result.source_events, order_events: result.order_events, fills: result.fills, positions: result.positions, ledger: result.ledger, journal: result.journal, trial_balance: result.trial_balance, metrics: result.metrics, limitations: result.limitations })
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
