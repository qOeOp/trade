import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import { displayPath, repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import {
  bindDataSplitSegmentSnapshot,
  developerDataBindingFromSegmentSnapshot,
} from "./data-split-segment-snapshot"
import { run as runSegmentSnapshot } from "../scripts/segment-snapshot"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test("data split owner binds exact report, manifest, and content without opening holdout", async () => {
  const root = mkdtempSync(join(repoRoot(), "tmp", "test-runs", "data-split-snapshot-"))
  roots.push(root)
  const discovery = join(root, "btcusdt", "discovery")
  mkdirSync(discovery, { recursive: true })
  const csv = "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00.000Z,1767225600000,1,2,1,2,10\n"
  const contentHash = createHash("sha256").update(csv).digest("hex")
  writeFileSync(join(discovery, "4h.csv"), csv)
  const manifestPath = join(discovery, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 2,
    symbol: "BTCUSDT",
    requested_symbol: "BTCUSDT",
    split: { split_id: "split-1", segment: "discovery" },
    timeframes: {
      "4h": {
        file: "4h.csv",
        rows: 1,
        content_sha256: contentHash,
      },
    },
  }))
  const reportPath = join(root, "report.json")
  writeFileSync(reportPath, JSON.stringify({
    schema_version: "trade-flow.strategy-data-split.v1",
    split_id: "split-1",
    hypothesis_id: "hypothesis-1",
    datasets: [{
      dataset_id: "BTCUSDT",
      symbol: "BTCUSDT",
      segments: [{
        segment: "discovery",
        manifest_path: displayPath(manifestPath),
        rows: 1,
        first_open_at: "2026-01-01T00:00:00.000Z",
        last_open_at: "2026-01-01T00:00:00.000Z",
      }],
    }],
  }))

  const snapshot = await bindDataSplitSegmentSnapshot({
    report_path: displayPath(reportPath),
    dataset_id: "BTCUSDT",
    segment: "discovery",
    timeframe: "4h",
  })
  expect(snapshot.content_hash).toBe(contentHash)
  expect(snapshot.snapshot_ref).toBe("dataset-split://split-1/BTCUSDT/discovery/4h")
  expect(snapshot.snapshot_hash).toMatch(/^[a-f0-9]{64}$/)
  const binding = developerDataBindingFromSegmentSnapshot({
    snapshot,
    dataset_kinds: ["ohlcv"],
    exchange: "binanceusdm",
  })
  expect(binding.schema_version).toBe("trade.rd-developer-data-snapshot-binding.v3")
  expect(binding.content_hash).toBe(contentHash)
  expect(binding.manifest_hash).toBe(snapshot.manifest_hash)
  expect(binding.binding_hash).toMatch(/^[a-f0-9]{64}$/)

  const response = await runSegmentSnapshot([
    "--json",
    JSON.stringify({
      report_path: displayPath(reportPath),
      dataset_id: "BTCUSDT",
      segment: "discovery",
      timeframe: "4h",
      exchange: "binanceusdm",
      dataset_kinds: ["ohlcv"],
    }),
  ]) as {
    ok: true
    data: {
      snapshot: { snapshot_hash: string }
      data_snapshot_binding: { schema_version: string; binding_hash: string }
    }
  }
  expect(response.ok).toBe(true)
  expect(response.data.snapshot.snapshot_hash).toBe(snapshot.snapshot_hash)
  expect(response.data.data_snapshot_binding.schema_version)
    .toBe("trade.rd-developer-data-snapshot-binding.v3")
  expect(response.data.data_snapshot_binding.binding_hash).toBe(binding.binding_hash)
  const partialResponse = await runSegmentSnapshot([
    "--json",
    JSON.stringify({
      report_path: displayPath(reportPath),
      dataset_id: "BTCUSDT",
      segment: "discovery",
      timeframe: "4h",
      exchange: "binanceusdm",
    }),
  ])
  expect(partialResponse.ok).toBe(false)

  writeFileSync(join(discovery, "4h.csv"), `${csv}tampered\n`)
  await expect(bindDataSplitSegmentSnapshot({
    report_path: displayPath(reportPath),
    dataset_id: "BTCUSDT",
    segment: "discovery",
    timeframe: "4h",
  })).rejects.toThrow("content hash drifted")
  await expect(bindDataSplitSegmentSnapshot({
    report_path: displayPath(reportPath),
    dataset_id: "BTCUSDT",
    segment: "locked_holdout" as "discovery",
    timeframe: "4h",
  })).rejects.toThrow("cannot open locked holdout")
})
