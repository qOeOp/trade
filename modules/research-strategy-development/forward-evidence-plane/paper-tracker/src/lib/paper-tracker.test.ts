import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { createRdShadowTrackerFromForwardHoldout, updateRdShadowTracker } from "./paper-tracker"

test("rd paper tracker keeps a fresh forward signal open until post-entry candles exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const manifestPath = writeManifest(dir, [[100, 101, 99, 100]])
    const state = createRdShadowTrackerFromForwardHoldout(report(manifestPath), {
      now: "2026-07-09T04:10:00.000Z",
      maxHoldBars: 3,
    })
    assert.equal(state.status, "open")
    assert.equal(state.schema_version, 2)
    assert.equal(state.summary.open_count, 1)
    assert.equal(state.summary.event_count, 1)
    assert.equal(state.paper_positions[0].last_evaluated_index, 0)
    assert.equal(state.paper_positions[0].events[0].behavior, "open_setup")
    assert.equal(state.paper_positions[0].events[0].backend, "rd_artifact")
    assert.equal(state.paper_positions[0].projection.status, "open")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd paper tracker closes short target and emits review draft", () => {
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
    assert.deepEqual(position.events.map((event) => event.behavior), ["open_setup", "observe_setup", "close_setup", "review_setup"])
    assert.equal(position.projection.status, "closed")
    assert.equal(position.projection.mfe_r, 2.2)
    assert.equal(position.projection.mae_r, -0.2)
    assert.equal(position.projection.close_r, 1)
    assert.equal(position.projection.exit_reason, "target")
    assert.equal(position.review_draft?.execution_attribution_required, true)
    assert.equal(position.review_draft?.can_be_strategy_evidence, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd paper tracker uses stop-first policy when stop and target touch together", () => {
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

test("rd paper tracker can update an existing open state and carry break-even stop", () => {
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
    assert.equal(position.projection.break_even_armed, true)
    assert.equal(position.projection.mfe_r, 0.8)
    assert.equal(position.projection.mae_r, -0.2)
    assert.deepEqual(position.events.map((event) => event.behavior), ["open_setup", "observe_setup", "observe_setup", "close_setup", "review_setup"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd paper tracker update accepts script response wrapped state", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const firstManifest = writeManifest(join(dir, "first"), [[100, 101, 99, 100]])
    const nextManifest = writeManifest(join(dir, "next"), [
      [100, 101, 99, 100],
      [100, 101, 89, 95],
    ])
    const state = createRdShadowTrackerFromForwardHoldout(report(firstManifest), {
      now: "2026-07-09T04:10:00.000Z",
      maxHoldBars: 3,
    })
    const updated = updateRdShadowTracker({ ok: true, data: state }, {
      now: "2026-07-09T08:10:00.000Z",
      manifestRefs: [{ datasetId: "ALT", manifestPath: nextManifest }],
    })
    assert.equal(updated.paper_positions[0].status, "closed")
    assert.equal(updated.paper_positions[0].outcome, "target")
    assert.equal(updated.schema_version, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd paper tracker suppresses repeated same-side entries while a matching position is open", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const manifestPath = writeManifest(dir, [
      [100, 101, 99, 100],
      [100, 101, 99, 100],
    ])
    const state = createRdShadowTrackerFromForwardHoldout(report(manifestPath), {
      now: "2026-07-09T04:10:00.000Z",
      maxHoldBars: 3,
    })
    const same = updateRdShadowTracker(state, {
      now: "2026-07-09T08:10:00.000Z",
      forwardReport: report(manifestPath),
    })
    assert.equal(same.summary.position_count, 1)

    const merged = updateRdShadowTracker(same, {
      now: "2026-07-09T08:12:00.000Z",
      forwardReport: shiftedReport(manifestPath),
    })
    assert.equal(merged.summary.position_count, 1)
    assert.equal(merged.summary.open_count, 1)
    const latestMergedEvent = merged.paper_positions[0].events[merged.paper_positions[0].events.length - 1]
    assert.equal(latestMergedEvent?.behavior, "observe_setup")
    assert.equal(latestMergedEvent?.payload.event_type, "rd_reinforce_signal")
    assert.equal(latestMergedEvent?.payload.suppression_reason, "open_same_symbol_candidate_side")

    const repeated = updateRdShadowTracker(merged, {
      now: "2026-07-09T08:13:00.000Z",
      forwardReport: shiftedReport(manifestPath),
    })
    assert.equal(repeated.summary.position_count, 1)
    assert.equal(repeated.summary.event_count, merged.summary.event_count)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd paper tracker allows a new entry after the matching position closes", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const firstManifest = writeManifest(join(dir, "first"), [
      [100, 101, 99, 100],
      [100, 101, 89, 95],
    ])
    const nextManifest = writeManifest(join(dir, "next"), [
      [100, 101, 99, 100],
      [100, 101, 89, 95],
      [95, 96, 94, 95],
    ])
    const closed = createRdShadowTrackerFromForwardHoldout(report(firstManifest), {
      now: "2026-07-09T08:10:00.000Z",
      maxHoldBars: 3,
    })
    assert.equal(closed.summary.closed_count, 1)

    const merged = updateRdShadowTracker(closed, {
      now: "2026-07-09T08:12:00.000Z",
      forwardReport: shiftedReport(nextManifest),
      manifestRefs: [{ datasetId: "ALT", manifestPath: nextManifest }],
    })
    assert.equal(merged.summary.position_count, 2)
    assert.equal(merged.paper_positions[1].events[0].behavior, "open_setup")
    assert.equal(merged.paper_positions[1].entry_index, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rd paper tracker normalizes legacy duplicate open positions", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-shadow-tracker-"))
  try {
    const manifestPath = writeManifest(dir, [
      [100, 101, 99, 100],
      [100, 101, 99, 100],
    ])
    const state = createRdShadowTrackerFromForwardHoldout(report(manifestPath), {
      now: "2026-07-09T04:10:00.000Z",
      maxHoldBars: 3,
    })
    const legacy = structuredClone(state)
    const duplicate = structuredClone(legacy.paper_positions[0])
    duplicate.position_id = "legacy-duplicate-position"
    duplicate.rd_chain_id = "rd-legacy-duplicate-position"
    duplicate.signal_time = "2026-07-09T04:00:00.000Z"
    duplicate.opened_at = "2026-07-09T08:00:00.000Z"
    duplicate.entry_index = 2
    duplicate.last_evaluated_index = 1
    legacy.paper_positions.push(duplicate)

    const normalized = updateRdShadowTracker(legacy, {
      now: "2026-07-09T08:20:00.000Z",
    })

    assert.equal(normalized.summary.position_count, 1)
    assert.equal(normalized.summary.open_count, 1)
    const latestNormalizedEvent = normalized.paper_positions[0].events[normalized.paper_positions[0].events.length - 1]
    assert.equal(latestNormalizedEvent?.payload.event_type, "rd_reinforce_signal")
    assert.equal(latestNormalizedEvent?.payload.suppressed_position_id, "legacy-duplicate-position")
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

function shiftedReport(manifestPath: string) {
  const raw = report(manifestPath)
  const record = raw.data.records[0]
  record.latest_candle_open = "2026-07-09T04:00:00.000Z"
  record.latest_candle_closed_at = "2026-07-09T08:00:00.000Z"
  record.signal.signal_time = "2026-07-09T04:00:00.000Z"
  record.signal.signal.signal_index = 1
  record.signal.signal.entry_index = 2
  return raw
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
