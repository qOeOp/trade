import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("market data store CLI upserts and reads manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "market-data-store-"))
  const dbPath = join(dir, "market.duckdb")
  try {
    run(parseArgs(["--db", dbPath, "--action", "init"]))
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_manifest",
      "--json",
      JSON.stringify({
        manifest_id: "manifest-cli",
        dataset_kind: "ohlcv",
        source: "binance_klines",
        exchange: "binance_usdm",
        content_hash: "sha256:cli",
        manifest_path: "data/ohlcv/manifest-cli.json",
      }),
    ]))
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_manifest",
      "--json",
      JSON.stringify({ manifest_id: "manifest-cli" }),
    ])) as { manifest: { source: string } }
    assert.equal(result.manifest.source, "binance_klines")

    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_funding",
      "--json",
      JSON.stringify({
        events: [
          { manifest_id: "funding-cli", exchange: "binanceusdm", symbol: "BTCUSDT", funding_time: 100, funding_rate: 0.0001 },
          { manifest_id: "funding-cli", exchange: "binanceusdm", symbol: "BTCUSDT", funding_time: 200, funding_rate: -0.0002 },
        ],
      }),
    ]))
    const funding = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_funding",
      "--json",
      JSON.stringify({ symbol: "BTCUSDT", since_ts: 150 }),
    ])) as { events: Array<{ funding_time: number; funding_rate: number }> }
    assert.deepEqual(funding.events.map((event) => event.funding_time), [200])

    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "upsert_feature_manifest",
      "--json",
      JSON.stringify({
        feature_manifest_id: "features-cli",
        source_manifest_id: "funding-cli",
        feature_set_id: "crypto-market-features.v1",
        symbol: "BTCUSDT",
        timeframe: "4h",
        content_hash: "sha256:features",
        manifest_path: "data/features/features-cli.json",
      }),
    ]))
    const feature = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "read_feature_manifest",
      "--json",
      JSON.stringify({ feature_manifest_id: "features-cli" }),
    ])) as { manifest: { feature_set_id: string } }
    const features = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "list_feature_manifests",
      "--json",
      JSON.stringify({ symbol: "BTCUSDT", feature_set_id: "crypto-market-features.v1" }),
    ])) as { manifests: Array<{ feature_manifest_id: string }> }
    assert.equal(feature.manifest.feature_set_id, "crypto-market-features.v1")
    assert.deepEqual(features.manifests.map((item) => item.feature_manifest_id), ["features-cli"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
