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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

