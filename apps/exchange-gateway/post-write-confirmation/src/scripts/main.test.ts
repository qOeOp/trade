import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("post-write confirmation emits exchange command refs", () => {
  const result = run(["--json", JSON.stringify({
    command_ref: "exchange_runtime_store:command/cmd-1",
    client_order_id: "client-1",
    action: "place_entry",
    status: "confirmed",
    idempotency_key: "idem-1",
    result_ref: "exchange_runtime_store:command/cmd-1:result",
    exchange_order_ids: ["123"],
  })]) as { ok: boolean; data: { schema_version: string; status: string; exchange_order_ids: string[] } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "trade.protocol.exchange-command-ref.v1")
  assert.equal(result.data.status, "confirmed")
  assert.deepEqual(result.data.exchange_order_ids, ["123"])
})

test("post-write confirmation rejects missing command refs", () => {
  const result = run(["--json", JSON.stringify({
    client_order_id: "client-1",
    action: "place_entry",
    idempotency_key: "idem-1",
  })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /command_ref/)
})
