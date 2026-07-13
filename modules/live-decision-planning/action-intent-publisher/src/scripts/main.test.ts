import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("action intent publisher emits action intent refs", () => {
  const result = run(["--json", JSON.stringify({
    intent_ref: "artifact_catalog:artifact/action-intent-1",
    intent_kind: "trade_plan",
    status: "proposed",
    symbol: "BTCUSDT",
    side: "long",
    source_refs: ["artifact_catalog:artifact/trade-plan-1"],
    expires_at: "2026-07-11T04:00:00Z",
    content_hash: "sha256:intent",
  })]) as { ok: boolean; data: { schema_version: string; intent_ref: string; side: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "trade.protocol.action-intent-ref.v1")
  assert.equal(result.data.intent_ref, "artifact_catalog:artifact/action-intent-1")
  assert.equal(result.data.side, "long")
})

test("action intent publisher rejects payloads without refs", () => {
  const result = run(["--json", JSON.stringify({
    intent_ref: "artifact_catalog:artifact/action-intent-1",
    intent_kind: "trade_plan",
    status: "proposed",
    content_hash: "sha256:intent",
  })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /source_refs/)
})
