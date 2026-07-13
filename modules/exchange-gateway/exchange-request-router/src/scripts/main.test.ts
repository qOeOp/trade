import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("exchange request router classifies write routes", () => {
  const result = run(["--json", JSON.stringify({
    action: "place_entry",
    symbol: "BTCUSDT",
    mode: "live_small",
    idempotency_key: "idem-1",
  })]) as { ok: boolean; data: { request_kind: string; route: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.request_kind, "write")
  assert.equal(result.data.route, "exchange-write-pre-adapter-gate")
})

test("exchange request router rejects unsupported actions", () => {
  const result = run(["--json", JSON.stringify({ action: "invent_order" })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /request_kind|unsupported/)
})
