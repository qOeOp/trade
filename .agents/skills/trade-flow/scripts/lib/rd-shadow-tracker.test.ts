import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { createRdShadowTrackerFromForwardHoldout, updateRdShadowTracker } from "./rd-shadow-tracker"

test("rd shadow tracker keeps a fresh forward signal open until post-entry candles exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const manifestPath = writeManifest(dir, [[100, 101, 99, 100]])
    const state = createRdShadowTrackerFromForwardHoldout(report(manifestPath), {
      now: "2026-07-09T04:10:00.000Z",
      maxHoldBars: 3,
    })
    assert.equal(state.status, "open")
    assert.equal(state.summary.open_count, 1)
    assert.equal(state.paper_positions[0].last_evaluated_index, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd shadow tracker closes short target and emits review draft", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const manifestPath = writeManifest(dir, [
      [100, 101, 99, 100],
      [100, 101, 89, 95],
    ])
    const state = createRdShadowTrackerFromForwardHoldout(report(manifestPath), {
      now: "2026-07-09T08:10:00.000Z",
      maxHoldBars: 3,
    })
    const position = state.paper_positions[0]
    assert.equal(state.status, "closed")
    assert.equal(position.status, "closed")
    assert.equal(position.outcome, "target")
    assert.equal(position.r, 2)
    assert.equal(position.review_draft?.execution_attribution_required, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd shadow tracker uses stop-first policy when stop and target touch together", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const manifestPath = writeManifest(dir, [
      [100, 101, 99, 100],
      [100, 106, 89, 95],
    ])
    const state = createRdShadowTrackerFromForwardHoldout(report(manifestPath), {
      now: "2026-07-09T08:10:00.000Z",
      maxHoldBars: 3,
    })
    assert.equal(state.paper_positions[0].outcome, "stop")
    assert.equal(state.paper_positions[0].r, -1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd shadow tracker can update an existing open state and carry break-even stop", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const firstManifest = writeManifest(join(dir, "first"), [[100, 101, 99, 100]])
    const nextManifest = writeManifest(join(dir, "next"), [
      [100, 101, 99, 100],
      [100, 101, 96, 98],
      [98, 100, 97, 99],
    ])
    const state = createRdShadowTrackerFromForwardHoldout(report(firstManifest), {
      now: "2026-07-09T04:10:00.000Z",
      maxHoldBars: 3,
    })
    const updated = updateRdShadowTracker(state, {
      now: "2026-07-09T12:10:00.000Z",
      manifestRefs: [{ datasetId: "ALT", manifestPath: nextManifest }],
    })
    const position = updated.paper_positions[0]
    assert.equal(position.status, "closed")
    assert.equal(position.outcome, "stop")
    assert.equal(position.r, 0)
    assert.equal(position.stop, 100)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function report(manifestPath: string) {
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

function writeManifest(dir: string, ohlc: Array<[number, number, number, number]>): string {
  mkdirSync(dir, { recursive: true })
  const rows = ohlc.map(([open, high, low, close], index) => {
    const timestamp = Date.parse("2026-07-09T00:00:00.000Z") + index * 4 * 60 * 60 * 1000
    return [new Date(timestamp).toISOString(), timestamp, open, high, low, close, 1000].join(",")
  })
  writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const path = join(dir, "manifest.json")
  writeFileSync(path, JSON.stringify({
    schema_version: 2,
    closed_candles_only: true,
    symbol: "ALTUSDT",
    timeframes: { "4h": { file: "4h.csv" } },
  }))
  return path
}
