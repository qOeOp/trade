import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  hashCanonical,
  replayDataHash,
  replayHarnessHash,
  replayHarnessSourceRefs,
} from "./legacy-replay-identity"

test("preserves the legacy canonical hash", () => {
  assert.equal(
    hashCanonical({ z: 1, a: true, nested: { b: 2, a: 1 } }),
    "29ea1fa11cfb92a6928cb3dc3b6df9132dc41c682a39d22d62e368bf909b161c",
  )
})

test("binds manifest identity, candle bytes, and supplemental bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-replay-identity-"))
  const csv = "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1767225600000,1,2,0.5,1.5,10\n"
  const csvPath = join(dir, "BTCUSDT-4h.csv")
  const manifestPath = join(dir, "manifest.json")
  const supplementalPath = join(dir, "factor.json")
  writeFileSync(csvPath, csv)
  writeFileSync(supplementalPath, JSON.stringify({ factor: "trend" }))
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 2,
    symbol: "BTCUSDT",
    closed_candles_only: true,
    timeframes: { "4h": { file: "BTCUSDT-4h.csv", content_sha256: createHash("sha256").update(csv).digest("hex") } },
  }))
  assert.match(replayDataHash(manifestPath, "4h", [supplementalPath]), /^[a-f0-9]{64}$/)
})

test("binds the legacy research kernel source set", () => {
  assert.match(replayHarnessHash(), /^[a-f0-9]{64}$/)
  assert.ok(replayHarnessSourceRefs().includes("../contracts/runtime-core/src/paths.ts"))
  assert.ok(replayHarnessSourceRefs().includes("replay-execution-plane/accounting/src/lib/replay-accounting.ts"))
})

test("binds relocated candidate and factor owners without stale kernel refs", () => {
  const refs = replayHarnessSourceRefs()
  assert.ok(refs.includes("agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-batch.ts"))
  assert.ok(refs.includes("agent-roles/developer/strategy-family-engine/src/lib/factor-engine.ts"))
  assert.ok(refs.includes("agent-roles/developer/strategy-family-engine/src/lib/factor-research.ts"))
  assert.ok(refs.includes("agent-roles/developer/strategy-family-engine/src/lib/rnd-families/trend-pullback.family.ts"))
  assert.equal(refs.some((ref) => ref.includes("legacy-research-kernel/src/lib/factor-")), false)
  assert.equal(refs.some((ref) => ref.includes("legacy-research-kernel/src/lib/rnd-")), false)
})
