import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("execution router CLI emits command specs", () => {
  const result = run(["--json", JSON.stringify({
    repoRoot: "/repo",
    target_action: "cancel_order",
    symbol: "BTCUSDT",
    request: { all: true },
  })]) as { ok: boolean; data: { target_action: string; tool: string; cwd: string; command: string[] } }

  assert.equal(result.ok, true)
  assert.equal(result.data.target_action, "cancel_order")
  assert.equal(result.data.tool, "binance-order-cancel")
  assert.equal(result.data.cwd, "/repo/modules/exchange-gateway/binance-write/order-cancel")
  assert.deepEqual(result.data.command.slice(0, 4), ["bun", "src/scripts/main.ts", "--symbol", "BTCUSDT"])
})

test("execution router CLI rejects no_action", () => {
  const result = run(["--json", JSON.stringify({ target_action: "no_action" })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /no_action/)
})
