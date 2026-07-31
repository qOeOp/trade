import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("market data quality gate passes valid manifests", () => {
  const result = run(["--json", JSON.stringify({
    schema_version: "trade.protocol.market-data-manifest.v1",
    manifest_ref: "market_data_store:manifest/BTCUSDT/4h",
    layer: "canonical_facts",
    symbol_scope: ["BTCUSDT"],
    time_window: { start_at: "2026-07-01T00:00:00Z", end_at: "2026-07-02T00:00:00Z" },
    content_hash: "sha256:abc",
    freshness: { as_of: "2026-07-02T00:00:00Z", max_age_seconds: 3600 },
  })]) as { ok: boolean; data: { status: string; issues: unknown[] } }

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "passed")
  assert.deepEqual(result.data.issues, [])
})

test("market data quality gate blocks incomplete manifests", () => {
  const result = run(["--json", "{}"]) as { ok: boolean; data: { status: string; issues: unknown[] } }

  assert.equal(result.ok, false)
  assert.equal(result.data.status, "blocked")
  assert.ok(result.data.issues.length > 0)
})
