import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { hashCanonical, replayDataHash, replayHarnessHash } from "../../../../compatibility/replay-engine/src/lib/replay-core"
import { run } from "./main"

test("certifies the exact compatibility replay harness fingerprint", () => {
  const result = run(["--json", "{}"])
  assert.equal(result.ok, true)
  assert.equal(record(result.data).harness_hash, replayHarnessHash())
})

test("preserves legacy data and assumptions fingerprint semantics", () => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-replay-fingerprint-"))
  const csvPath = join(dir, "BTCUSDT-4h.csv")
  const manifestPath = join(dir, "manifest.json")
  const supplementalPath = join(dir, "factor.json")
  const csv = "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1767225600000,1,2,0.5,1.5,10\n"
  writeFileSync(csvPath, csv)
  writeFileSync(supplementalPath, JSON.stringify({ factor: "trend" }))
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 2,
    symbol: "BTCUSDT",
    closed_candles_only: true,
    timeframes: {
      "4h": {
        file: "BTCUSDT-4h.csv",
        content_sha256: createHash("sha256").update(csv).digest("hex"),
      },
    },
  }))
  const assumptions = { fee_bps: 4, nested: { z: 1, a: true } }
  const result = run(["--json", JSON.stringify({
    manifest_path: manifestPath,
    timeframe: "4h",
    supplemental_data_refs: [supplementalPath],
    assumptions,
  })])
  const data = record(result.data)
  assert.equal(result.ok, true)
  assert.equal(data.data_hash, replayDataHash(manifestPath, "4h", [supplementalPath]))
  assert.equal(data.assumptions_hash, hashCanonical(assumptions))
})

test("rejects partial data identity", () => {
  const result = run(["--json", JSON.stringify({ manifest_path: "manifest.json" })])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /provided together/)
})

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
