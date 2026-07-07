import assert from "node:assert/strict"
import test from "node:test"
import { fetchBrkFactors, fetchDeribitDvol } from "./external-features"

test("Deribit DVOL pagination returns ordered closes", async () => {
  const start = Date.parse("2024-01-01T00:00:00Z")
  const points = await fetchDeribitDvol("BTC", start, start + 3_600_000, async () => ({ result: { data: [[start, 1, 2, 1, 1.5]], continuation: null } }))
  assert.deepEqual(points.map((item) => item.value), [1.5])
})

test("BRK factors map 4h arrays to timestamps", async () => {
  const start = Date.parse("2024-01-01T00:00:00Z")
  const result = await fetchBrkFactors(start, start + 4 * 3_600_000, async () => ({ data: [1, 2] }))
  assert.deepEqual(result["onchain.btc_mvrv"].map((item) => item.value), [1, 2])
})
