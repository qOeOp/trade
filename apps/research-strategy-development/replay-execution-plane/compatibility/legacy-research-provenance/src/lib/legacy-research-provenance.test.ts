import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { buildReplayProvenance, emptyTemporalContract } from "./legacy-research-provenance"

test("binds legacy identity and closed-candle temporal provenance", () => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-research-provenance-"))
  const candlePath = join(dir, "BTCUSDT-4h.csv")
  const supplementalPath = join(dir, "supplemental.json")
  const manifestPath = join(dir, "manifest.json")
  const candleBytes = "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1767225600000,1,2,0.5,1.5,10\n"
  writeFileSync(candlePath, candleBytes)
  writeFileSync(supplementalPath, JSON.stringify({ generated_at: "2026-01-02T08:00:00+08:00" }))
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 2,
    symbol: "BTCUSDT",
    closed_candles_only: true,
    universe_selected_at: "2025-12-31T08:00:00+08:00",
    timeframes: { "4h": { file: "BTCUSDT-4h.csv", content_sha256: createHash("sha256").update(candleBytes).digest("hex") } },
  }))

  const provenance = buildReplayProvenance(
    manifestPath,
    "4h",
    14_400_000,
    { fee_bps: 1 },
    [{ exit_time: "2026-01-01T08:00:00Z" }],
    [{ timestamp: 1767225600000 }],
    [supplementalPath],
  )
  assert.equal(provenance.manifest_checksum_verified, true)
  assert.equal(provenance.temporal_contract.universe_selected_at, "2025-12-31T00:00:00.000Z")
  assert.equal(provenance.temporal_contract.label_end, "2026-01-01T12:00:00.000Z")
  assert.equal(provenance.temporal_contract.supplemental_data[0].availability_at, "2026-01-02T00:00:00.000Z")
})

test("preserves the unbound temporal shell", () => {
  assert.deepEqual(emptyTemporalContract("4h"), {
    method: "closed_candle_replay_v1",
    timeframe: "4h",
    closed_candle_only: false,
    reference_at: null,
    availability_at: null,
    lookback_start: null,
    label_end: null,
    universe_selected_at: null,
    universe_selection_source: "not_declared",
    label_policy: "not_evaluated",
    supplemental_data: [],
  })
})
