import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { buildSinglePositionLedger, calculateFundingCashflow } from "../../accounting/src/lib/replay-accounting"
import { canonicalHash, replayDatasetHash, type ReplayDatasetManifest, type ReplayExecutionRequest, type ReplayFundingEvent, type ReplayMarketBar } from "../../contracts/src/lib/replay-contracts"
import { executeReplayKernel } from "../../engine/src/lib/replay-reference-engine"
import { deriveReplayMetrics } from "../../metrics/src/lib/replay-metrics"

interface GoldenFixture {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  expected_semantic_digest: string
}

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/certified-single-position-v1.json", import.meta.url), "utf8",
)) as GoldenFixture

test("golden: certified single-position semantic digest is stable", () => {
  const result = executeReplayKernel(fixture)
  expect(semanticDigest(result)).toBe(fixture.expected_semantic_digest)
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
    }
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
  const scaled = executeReplayKernel(boundInput(request, bars, fundingEvents))
  expect(scaled.fills.at(-1)?.order_role).toBe(base.fills.at(-1)?.order_role)
  expect(scaled.metrics.return_fraction).toBeCloseTo(base.metrics.return_fraction, 10)
  expect(scaled.metrics.net_pnl).toBeCloseTo(base.metrics.net_pnl * scale, 10)
})

test("parity: engine result equals accounting and metrics component projections", () => {
  const result = executeReplayKernel(fixture)
  const entry = result.fills[0]
  const exit = result.fills[1]
  const realized = result.ledger.find((item) => item.kind === "realized_pnl")?.amount || 0
  const fundingCashflows = fixture.funding_events.map((event) => calculateFundingCashflow(
    event.mark_price, fixture.request.order.quantity, event.rate, fixture.request.order.side,
  ))
  const ledger = buildSinglePositionLedger({
    run_id: fixture.request.run_id,
    initial_cash: fixture.request.initial_cash,
    entry_time: entry.timestamp,
    fills: [entry, exit],
    funding_events: fixture.funding_events,
    funding_cashflows: fundingCashflows,
    realized_pnl: realized,
    ending_equity: result.metrics.ending_equity,
  })
  expect(ledger).toEqual(result.ledger)
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
  return canonicalHash({ fills: result.fills, ledger: result.ledger, metrics: result.metrics, limitations: result.limitations })
}

function boundInput(request: ReplayExecutionRequest, bars: ReplayMarketBar[], fundingEvents: ReplayFundingEvent[] = []) {
  const dataHash = replayDatasetHash(bars, fundingEvents)
  const last = bars.at(-1)
  if (!last || !bars[0]) throw new Error("certification fixture requires bars")
  return {
    request: { ...request, dataset_hash: dataHash },
    dataset_manifest: {
      ...fixture.dataset_manifest,
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
