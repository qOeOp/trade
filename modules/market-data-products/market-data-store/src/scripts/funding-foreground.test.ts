import assert from "node:assert/strict"
import test from "node:test"
import { fetchFundingWindow, parseArgs } from "./funding-foreground"

test("funding worker arguments keep database and public request controls bounded", () => {
  const parsed = parseArgs([])
  assert.equal(parsed.marketDataDb, "data/market_data.db")
  assert.equal(parsed.maxJobsPerCycle, 2)
  assert.throws(() => parseArgs(["--market-data-db", "/tmp/other.db"]), /fixed/)
  assert.throws(() => parseArgs(["--request-timeout-ms", "999"]), /between/)
  assert.throws(() => parseArgs(["--endpoint", "https://other"]), /unknown/)
})

test("funding fetch uses fixed endpoint and advances only by the last provider event", async () => {
  const requests: URL[] = []
  const firstRows = Array.from({ length: 1_000 }, (_, index) => ({
    fundingTime: 1_000 + index,
    fundingRate: "0",
  }))
  const bodies = [JSON.stringify(firstRows), "[]"]
  const pages = await fetchFundingWindow({
    target_id: "funding:BTCUSDT:test",
    symbol: "BTCUSDT",
    coverage_start: new Date(1_000).toISOString(),
    coverage_end: new Date(10_000).toISOString(),
    demand_ids: ["demand"],
  }, 1_000, async (input) => {
    requests.push(new URL(input))
    return {
      ok: true,
      status: 200,
      text: async () => bodies.shift()!,
    }
  })
  assert.equal(pages.length, 2)
  assert.equal(requests[0]?.origin, "https://fapi.binance.com")
  assert.equal(requests[0]?.pathname, "/fapi/v1/fundingRate")
  assert.equal(requests[1]?.searchParams.get("startTime"), "2000")
  assert.equal(requests[0]?.searchParams.get("limit"), "1000")
})
