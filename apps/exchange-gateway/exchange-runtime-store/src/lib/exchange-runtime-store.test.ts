import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildExchangeCommand,
  buildExchangeResult,
  buildExchangeSnapshotRef,
  ensureExchangeRuntimeSchema,
  readExchangeCommandByIdempotencyKey,
  readExchangeResultsForCommand,
  recordExchangeCommand,
  recordExchangeResult,
  recordExchangeSnapshotRef,
  updateExchangeCommandStatus,
} from "./exchange-runtime-store"

test("exchange runtime store records command/result audit trail", () => {
  const db = new Database(":memory:")
  ensureExchangeRuntimeSchema(db)
  try {
    const command = buildExchangeCommand({
      command_id: "cmd-1",
      idempotency_key: "idem-1",
      command_type: "order_place",
      symbol: "BTCUSDT",
      requested_by_ref: "plan_event/obs-1",
      request: { side: "BUY", quantity: "0.01" },
      now: "2026-07-11T00:00:00Z",
    })
    recordExchangeCommand(db, command)
    updateExchangeCommandStatus(db, "cmd-1", "submitted")
    recordExchangeResult(db, buildExchangeResult({
      result_id: "res-1",
      command_id: "cmd-1",
      exchange_ref: "binance:order/123",
      result: { orderId: 123 },
      confirmed: { status: "NEW" },
      now: "2026-07-11T00:00:01Z",
    }))

    const saved = readExchangeCommandByIdempotencyKey(db, "idem-1")
    assert.equal(saved?.status, "submitted")
    assert.equal(saved?.request_json.side, "BUY")
    const results = readExchangeResultsForCommand(db, "cmd-1")
    assert.equal(results.length, 1)
    assert.equal(results[0].exchange_ref, "binance:order/123")
    assert.equal(results[0].confirmed_json?.status, "NEW")
  } finally {
    db.close()
  }
})

test("exchange runtime store enforces idempotency and records snapshot refs", () => {
  const db = new Database(":memory:")
  ensureExchangeRuntimeSchema(db)
  try {
    const input = {
      command_type: "order_cancel",
      idempotency_key: "same-key",
      requested_by_ref: "job/J03",
      request: { symbol: "ETHUSDT" },
    }
    recordExchangeCommand(db, buildExchangeCommand({ ...input, command_id: "cmd-a" }))
    assert.throws(() => recordExchangeCommand(db, buildExchangeCommand({ ...input, command_id: "cmd-b" })), /UNIQUE/)

    recordExchangeSnapshotRef(db, buildExchangeSnapshotRef({
      snapshot_id: "snap-1",
      snapshot_kind: "account_snapshot",
      body_ref: "artifact://snapshots/account-1.json",
      symbol: "ETHUSDT",
    }))
    const row = db.query("SELECT body_ref FROM exchange_snapshot_ref WHERE snapshot_id='snap-1'").get() as { body_ref: string }
    assert.equal(row.body_ref, "artifact://snapshots/account-1.json")
  } finally {
    db.close()
  }
})
