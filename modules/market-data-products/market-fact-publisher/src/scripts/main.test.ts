import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("market fact publisher builds market data manifests", () => {
  const result = run(["--json", JSON.stringify({
    manifest_ref: "market_data_store:features/BTCUSDT/4h",
    layer: "features",
    symbol_scope: ["BTCUSDT"],
    time_window: { start_at: "2026-07-01T00:00:00Z", end_at: "2026-07-02T00:00:00Z" },
    content_hash: "sha256:features",
    freshness: { as_of: "2026-07-02T00:00:00Z", max_age_seconds: 3600 },
    input_refs: ["market_data_store:manifest/BTCUSDT/4h"],
    feature_hash: "sha256:feature-hash",
  })]) as { ok: boolean; data: { schema_version: string; layer: string; feature_hash: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "trade.protocol.market-data-manifest.v1")
  assert.equal(result.data.layer, "features")
  assert.equal(result.data.feature_hash, "sha256:feature-hash")
})

test("market fact publisher rejects incomplete payloads", () => {
  const result = run(["--json", "{}"])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /manifest_ref/)
})
