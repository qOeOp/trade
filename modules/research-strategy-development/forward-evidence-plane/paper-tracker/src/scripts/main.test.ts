import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { run } from "./main"

type JSONRecord = Record<string, unknown>

test("legacy rd shadow tracker CLI exposes canonical J05 skipped result for placeholder trackers", () => {
  const result = run([
    "--shadow-tracker-job",
    "--json",
    JSON.stringify({
      cycle_id: "cycle-j05-skip",
      trackers: [{ tracker_id: "placeholder", artifact_scope: "./tmp/artifacts/strategy-rnd" }],
    }),
  ])

  assert.equal(result.ok, true)
  const data = asRecord(result.data)
  const runtimeResult = asRecord(data.runtime_result)
  assert.equal(runtimeResult.schema_id, "trade.domain-runtime.domain-job-result.v1")
  assert.equal(runtimeResult.domain, "research-strategy-development")
  assert.equal(runtimeResult.job_id, "rd_forward_shadow_trackers")
  assert.equal(runtimeResult.status, "skipped")
  assert.deepEqual(runtimeResult.writes, {})
  assert.deepEqual(asRecord(runtimeResult.audit).skipped_count, 1)
})

test("legacy rd shadow tracker CLI exposes canonical J05 paper artifact result", () => {
  const dir = "tmp/check/rd-shadow-tracker-job"
  const absoluteDir = join(repoRoot(), dir)
  rmSync(absoluteDir, { recursive: true, force: true })
  mkdirSync(absoluteDir, { recursive: true })
  try {
    const manifestPath = writeManifest(join(dir, "dataset"))
    const forwardPath = join(dir, "forward.json")
    const outputPath = join(dir, "shadow.json")
    const catalogDbPath = join(dir, "catalog.db")
    writeFileSync(join(repoRoot(), forwardPath), `${JSON.stringify(forwardReport(manifestPath), null, 2)}\n`)

    const result = run([
      "--shadow-tracker-job",
      "--catalog-db",
      catalogDbPath,
      "--json",
      JSON.stringify({
        cycle_id: "cycle-j05-ok",
        now: "2026-07-09T08:10:00.000Z",
        trackers: [{
          tracker_id: "alt-shadow",
          forward_result_path: forwardPath,
          output_path: outputPath,
          max_hold_bars: 3,
        }],
      }),
    ])

    assert.equal(result.ok, true)
    const data = asRecord(result.data)
    const runtimeResult = asRecord(data.runtime_result)
    assert.equal(runtimeResult.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.equal(runtimeResult.domain, "research-strategy-development")
    assert.equal(runtimeResult.job_id, "rd_forward_shadow_trackers")
    assert.equal(runtimeResult.status, "ok")
    assert.deepEqual(runtimeResult.writes, { artifact_catalog: true })
    assert.deepEqual(runtimeResult.output_refs, [outputPath])
    assert.equal(asRecord(runtimeResult.audit).runnable_count, 1)
    const trackerResult = asRecord(asArray(data.trackers)[0])
    assert.equal(trackerResult.status, "ok")
    assert.equal(trackerResult.output_ref, outputPath)
  } finally {
    rmSync(absoluteDir, { recursive: true, force: true })
  }
})

function forwardReport(manifestPath: string): JSONRecord {
  return {
    ok: true,
    data: {
      strategy_id: "S-TEST",
      setup_id: "setup",
      frozen_at: "2026-07-09T01:15:07.000Z",
      now: "2026-07-09T04:10:00.000Z",
      timeframe: "4h",
      frozen_candidate: { candidate_id: "C-1", family: "time_series_momentum_v1", parameter_count: 8, candidate_hash: "abc" },
      records: [{
        dataset_id: "ALT",
        manifest_path: manifestPath,
        symbol: "ALTUSDT",
        latest_candle_open: "2026-07-09T00:00:00.000Z",
        latest_candle_closed_at: "2026-07-09T04:00:00.000Z",
        eligible: true,
        blocked_by: [],
        signal: {
          candidate_id: "C-1",
          candidate_hash: "abc",
          strategy_id: "S-TEST",
          symbol: "ALTUSDT",
          timeframe: "4h",
          signal_time: "2026-07-09T00:00:00.000Z",
          entry_reference: 100,
          action: "entry",
          signal: {
            side: "short",
            signal_index: 0,
            entry_index: 1,
            entry: 100,
            stop: 105,
            target: 90,
            break_even_after_r: 0.5,
            break_even_offset_r: 0,
            reason: "test",
          },
        },
      }],
    },
  }
}

function writeManifest(dir: string): string {
  const absoluteDir = join(repoRoot(), dir)
  mkdirSync(absoluteDir, { recursive: true })
  writeFileSync(join(absoluteDir, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    ["2026-07-09T00:00:00.000Z", Date.parse("2026-07-09T00:00:00.000Z"), 100, 101, 99, 100, 1000].join(","),
    ["2026-07-09T04:00:00.000Z", Date.parse("2026-07-09T04:00:00.000Z"), 100, 101, 89, 95, 1000].join(","),
  ].join("\n"))
  const path = join(absoluteDir, "manifest.json")
  writeFileSync(path, JSON.stringify({
    schema_version: 2,
    closed_candles_only: true,
    symbol: "ALTUSDT",
    timeframes: { "4h": { file: "4h.csv" } },
  }))
  return path
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
