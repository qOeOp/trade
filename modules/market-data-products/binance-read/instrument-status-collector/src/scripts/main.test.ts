import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  createInstrumentStatusSourceBatchFromAcquisition,
  readInstrumentStatusAcquisitionPayload,
  readInstrumentStatusAcquisitionReceipt,
} from "../../../../market-data-store/src/lib/market-data-store"
import { parseArgs, parseCurrentSymbolStatus, run } from "./main"

function clock(): () => string {
  let second = 0
  return () => `2026-07-15T00:00:${String(second++).padStart(2, "0")}Z`
}

test("collector records retry response bytes and a terminal current snapshot receipt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-collector-"))
  const dbPath = join(dir, "market-data.db")
  let calls = 0
  try {
    const response = await run([
      "--symbol", "BTCUSDT",
      "--db", dbPath,
      "--acquisition-id", "snapshot-retry-1",
      "--max-attempts", "3",
    ], {
      now: clock(),
      sleep: async () => undefined,
      fetchFn: async () => {
        calls += 1
        if (calls === 1) return new Response('{"code":-1003}', { status: 429 })
        return new Response('{"symbols":[{"symbol":"BTCUSDT","status":"TRADING"}]}', { status: 200 })
      },
    })
    assert.equal(response.ok, true)
    if (!response.ok) return
    assert.equal(response.data.observed_status, "TRADING")
    assert.equal(response.data.receipt.source_capability, "current_snapshot_only")
    assert.equal(response.data.receipt.external_authenticity, "not_verified")
    assert.deepEqual(response.data.receipt.attempts.map((attempt) => [attempt.outcome, attempt.failure_class, attempt.retryable]), [
      ["failed", "rate_limited", true],
      ["succeeded", null, false],
    ])
    const db = new Database(dbPath)
    try {
      const stored = readInstrumentStatusAcquisitionReceipt(db, "snapshot-retry-1")
      assert.deepEqual(stored, response.data.receipt)
      for (const attempt of response.data.receipt.attempts) {
        assert.ok(readInstrumentStatusAcquisitionPayload(db, attempt.response_payload_ref!))
      }
    } finally {
      db.close()
    }
    assert.throws(() => createInstrumentStatusSourceBatchFromAcquisition({
      receipt: response.data.receipt,
      batch_id: "forbidden-history-batch",
      batch_sequence: 1,
      source_ref: "binance-rest:exchange-info",
      previous_batch_hash: null,
    }), /only a successful historical event archive/)
    const replay = await run([
      "--symbol", "BTCUSDT",
      "--db", dbPath,
      "--acquisition-id", "snapshot-retry-1",
    ], {
      fetchFn: async () => { throw new Error("existing acquisition must not refetch") },
    })
    assert.equal(replay.ok, true)
    if (replay.ok) {
      assert.equal(replay.data.commit_status, "existing")
      assert.equal(replay.data.observed_status, "TRADING")
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("collector preserves an invalid successful HTTP body and does not retry it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-collector-invalid-"))
  let calls = 0
  try {
    const response = await run([
      "--symbol", "BTCUSDT",
      "--db", join(dir, "market-data.db"),
      "--acquisition-id", "snapshot-invalid-1",
      "--max-attempts", "3",
    ], {
      now: clock(),
      sleep: async () => undefined,
      fetchFn: async () => {
        calls += 1
        return new Response('{"symbols":[]}', { status: 200 })
      },
    })
    assert.equal(response.ok, false)
    assert.equal(calls, 1)
    assert.equal(response.data?.receipt.attempts[0].failure_class, "invalid_response")
    assert.equal(response.data?.receipt.attempts[0].retryable, false)
    assert.ok(response.data?.receipt.attempts[0].response_hash)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("collector validates CLI bounds and exchangeInfo symbol status", () => {
  assert.throws(() => parseArgs([]), /--symbol is required/)
  assert.throws(() => parseArgs(["--symbol", "BTCUSDT", "--max-attempts", "6"]), /between 1 and 5/)
  assert.equal(parseCurrentSymbolStatus('{"symbols":[{"symbol":"BTCUSDT","status":"SETTLING"}]}', "BTCUSDT"), "SETTLING")
  assert.throws(() => parseCurrentSymbolStatus("not-json", "BTCUSDT"), /invalid Binance exchangeInfo JSON/)
})
