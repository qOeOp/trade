import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { run } from "./main"

type JSONRecord = Record<string, unknown>

test("replay runner requires a manifest", () => {
  const result = run([])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /requires --manifest/)
})

test("replay runner executes registered strategy", () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-runner-"))
  const csvPath = join(dir, "BTCUSDT-4h.csv")
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(csvPath, buildCsv())
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "BTCUSDT-4h.csv",
      },
    },
  }))

  const result = run(["--manifest", manifestPath, "--strategy-id", "S-BTC-4H-TREND-PULLBACK"])
  assert.equal(result.ok, true)
  const data = asRecord(result.data)
  assert.equal(data.strategy_id, "S-BTC-4H-TREND-PULLBACK")
  assert.equal(data.timeframe, "4h")
  assert.ok(Number(data.sample_count) > 0)
})

function buildCsv(): string {
  const lines = ["date,timestamp,open,high,low,close,volume"]
  const start = 1_700_000_000_000
  let close = 100
  for (let index = 0; index < 260; index += 1) {
    const trend = index < 220 ? 0.25 : 0.35
    const pullback = index > 220 && index % 8 === 0 ? -3 : 0
    const open = close
    close = close + trend + pullback
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - (pullback < 0 ? Math.abs(pullback) + 0.5 : 0.4)
    const timestamp = start + index * 4 * 60 * 60 * 1000
    lines.push(`${new Date(timestamp).toISOString()},${timestamp},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},${1000 + index}`)
  }
  return `${lines.join("\n")}\n`
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
