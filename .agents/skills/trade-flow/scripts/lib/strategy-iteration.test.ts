import { test } from "bun:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { ensureSchema, appendPlanEvent } from "../main"
import {
  appendReplayEvidence,
  appendStrategyEvidence,
  policyHashForFile,
  promoteStrategy,
  reviewStrategy,
} from "./strategy-iteration"
import { hashCanonical, replayContentHash, replayDataHash, replayHarnessHash, type ReplayResult } from "./replay-core"

test("strategy review separates fresh and stale evidence by policy hash", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: positiveReplay(dir),
    now: "2026-01-01T00:00:00.000Z",
  })

  writeStrategy(dir, "draft", "Rule v2")
  const report = reviewStrategy({ strategyPath, ledgerPath })

  assert.equal(report.evidence.fresh.length, 0)
  assert.equal(report.evidence.stale.length, 1)
  assert.equal(report.gate.shadow_candidate, false)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-REPLAY-MISSING"), true)
})

test("strategy promote to shadow requires positive fresh replay evidence", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")

  assert.throws(
    () => promoteStrategy({ strategyPath, ledgerPath, toStatus: "shadow" }),
    /S-REPLAY-MISSING/,
  )

  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: positiveReplay(dir),
    now: "2026-01-01T00:00:00.000Z",
  })
  const dryRun = promoteStrategy({ strategyPath, ledgerPath, toStatus: "shadow" })
  assert.equal(dryRun.status, "dry-run")
  assert.match(readFileSync(strategyPath, "utf8"), /status: draft/)

  const updated = promoteStrategy({ strategyPath, ledgerPath, toStatus: "shadow", yes: true })
  assert.equal(updated.status, "updated")
  assert.match(readFileSync(strategyPath, "utf8"), /status: shadow/)
})

test("strategy promote blocks replay evidence without anti-overfit proof", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: replayWithAssumptions(dir, {}),
    now: "2026-01-01T00:00:00.000Z",
  })

  const report = reviewStrategy({ strategyPath, ledgerPath })

  assert.equal(report.gate.shadow_candidate, false)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-OOS-MISSING"), true)
  assert.throws(
    () => promoteStrategy({ strategyPath, ledgerPath, toStatus: "shadow" }),
    /S-OOS-MISSING/,
  )
})

test("strategy promote blocks weak out-of-sample replay evidence", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: replayWithAssumptions(dir, {
        anti_overfit: {
          method: "out_of_sample",
          stage: "locked_holdout",
          oos_stats: {
            sample_count: 12,
            win_rate: 0.25,
            avg_r: -0.1,
            total_r: -1.2,
            profit_factor: 0.8,
          },
          trial_count: 3,
          parameter_count: 4,
        },
      }),
    now: "2026-01-01T00:00:00.000Z",
  })

  const report = reviewStrategy({ strategyPath, ledgerPath })

  assert.equal(report.gate.shadow_candidate, false)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-OOS-WEAK"), true)
})

test("strategy promote blocks excessive search budget", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: replayWithAssumptions(dir, {
        anti_overfit: {
          method: "walk_forward",
          stage: "locked_holdout",
          oos_stats: {
            sample_count: 12,
            win_rate: 0.5,
            avg_r: 0.08,
            total_r: 0.96,
            profit_factor: 1.2,
          },
          trial_count: 11,
          parameter_count: 4,
        },
      }),
    now: "2026-01-01T00:00:00.000Z",
  })

  const report = reviewStrategy({ strategyPath, ledgerPath })

  assert.equal(report.gate.shadow_candidate, false)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-SEARCH-BUDGET"), true)
})

test("selection validation cannot authorize shadow", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  const replay = positiveReplay(dir)
  const assumptions = structuredClone(replay.assumptions) as Record<string, any>
  assumptions.anti_overfit.stage = "selection_validation"
  appendReplayEvidence({ strategyPath, ledgerPath, replayResult: replayWithAssumptions(dir, assumptions) })

  const report = reviewStrategy({ strategyPath, ledgerPath })
  assert.equal(report.gate.shadow_candidate, false)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-HOLDOUT-MISSING"), true)
})

test("strategy promote blocks replay qualification failures", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  const replay = positiveReplay(dir)
  const assumptions = structuredClone(replay.assumptions) as Record<string, any>
  assumptions.funding_event_coverage = { status: "partial", event_count: 3 }
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: replayWithAssumptions(dir, assumptions),
    qualification: {
      panel_null_gate: {
        status: "evaluated",
        blocked: true,
        blocked_by: ["PANEL-ASSET-SHUFFLE"],
      },
    },
  })

  const report = reviewStrategy({ strategyPath, ledgerPath })
  assert.equal(report.gate.shadow_candidate, false)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-FUNDING-COVERAGE"), true)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-PANEL-NULL"), true)
  assert.equal(report.diagnostics.qualification.funding_event_coverage_status, "partial")
  assert.equal(report.diagnostics.qualification.panel_null_status, "evaluated")
  assert.equal(report.diagnostics.qualification.panel_null_blocked, true)
  assert.deepEqual(report.diagnostics.qualification.blocked_by, ["S-FUNDING-COVERAGE", "S-PANEL-NULL"])
  assert.equal(report.diagnostics.failure_attribution.some((item) => item.area === "funding_coverage"), true)
  assert.equal(report.diagnostics.failure_attribution.some((item) => item.area === "panel_null"), true)
  const ledgerRecord = JSON.parse(readFileSync(ledgerPath, "utf8").trim()) as { qualification: { funding_event_coverage: { status: string }; panel_null_gate: { blocked: boolean } } }
  assert.equal(ledgerRecord.qualification.funding_event_coverage.status, "partial")
  assert.equal(ledgerRecord.qualification.panel_null_gate.blocked, true)
})

test("replay evidence becomes stale when source data changes", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({ strategyPath, ledgerPath, replayResult: positiveReplay(dir) })
  writeFileSync(join(dir, "4h.csv"), "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1,100,102,99,101,1\n")

  const report = reviewStrategy({ strategyPath, ledgerPath })
  assert.equal(report.evidence.fresh.length, 0)
  assert.equal(report.evidence.stale_reasons[0].check_ids.includes("E-DATA-UNAVAILABLE"), true)
})

test("replay evidence becomes stale when its factor report changes", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  const factorPath = join(dir, "factor-report.json")
  writeFileSync(factorPath, JSON.stringify({ version: 1, factors: ["trend"] }))
  const replay = positiveReplay(dir)
  const manifestPath = join(dir, "manifest.json")
  replay.provenance = {
    ...replay.provenance,
    data_hash: replayDataHash(manifestPath, "4h", [factorPath]),
    supplemental_data: [{ ref: factorPath, content_sha256: "recorded-by-replay" }],
  }
  appendReplayEvidence({ strategyPath, ledgerPath, replayResult: replay })
  writeFileSync(factorPath, JSON.stringify({ version: 2, factors: ["trend", "volume"] }))

  const report = reviewStrategy({ strategyPath, ledgerPath })
  assert.equal(report.evidence.fresh.length, 0)
  assert.equal(report.evidence.stale_reasons[0].check_ids.includes("E-DATA-STALE"), true)
})

test("strategy promote to live-small requires shadow evidence", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "shadow", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: positiveReplay(dir),
    now: "2026-01-01T00:00:00.000Z",
  })

  assert.throws(
    () => promoteStrategy({ strategyPath, ledgerPath, toStatus: "live-small" }),
    /S-SHADOW-MISSING/,
  )

  appendStrategyEvidence({
    strategyPath,
    ledgerPath,
    kind: "shadow",
    stats: {
      sample_count: 21,
      win_rate: 0.52,
      avg_r: 0.08,
      total_r: 1.68,
      max_drawdown_r: 3,
      profit_factor: 1.2,
    },
    now: "2026-01-02T00:00:00.000Z",
  })
  assert.throws(
    () => promoteStrategy({ strategyPath, ledgerPath, toStatus: "live-small" }),
    /S-SHADOW-ATTRIBUTION-MISSING/,
  )

  appendStrategyEvidence({
    strategyPath,
    ledgerPath,
    kind: "shadow",
    stats: {
      sample_count: 21,
      win_rate: 0.52,
      avg_r: 0.08,
      total_r: 1.68,
      max_drawdown_r: 3,
      profit_factor: 1.2,
    },
    executionAttribution: {
      total_fee_drag: 0.02,
      total_slippage_drag: 0.01,
      total_funding_drag: 0,
      total_cost_drag: 0.03,
    },
    now: "2026-01-03T00:00:00.000Z",
  })
  const result = promoteStrategy({ strategyPath, ledgerPath, toStatus: "live-small", yes: true })
  assert.equal(result.status, "updated")
  assert.match(readFileSync(strategyPath, "utf8"), /status: live-small/)
})

test("strategy policy hash ignores pre-certificate research and replay notes", () => {
  const dir = makeDir()
  const policy = "## Setup Certificate\n\nentry_rule: same\n\n## Signal Stack\n\nUse rule A."
  const strategyPath = writeStrategy(dir, "draft", `Research refs v1\n\n${policy}`)
  const firstHash = policyHashForFile(strategyPath)

  writeStrategy(dir, "draft", `Research refs v2\nReplay refs changed.\n\n${policy}`)
  assert.equal(policyHashForFile(strategyPath), firstHash)

  writeStrategy(dir, "draft", `Research refs v2\n\n## Setup Certificate\n\nentry_rule: changed\n\n## Signal Stack\n\nUse rule A.`)
  assert.notEqual(policyHashForFile(strategyPath), firstHash)
})

test("strategy review can include DB review stats without changing the ledger", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "shadow", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  const db = new Database(join(dir, "trade.db"))
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "review-1",
      chain_id: "flow-1",
      kind: "review",
      created_at: "2026-01-01T00:00:00.000Z",
      body_json: {
        strategy_ref: "S-TEST",
        outcome: "win",
        pnl_r: 1.2,
        pnl_pct: 2,
        thesis_held: true,
        key_lesson: "worked",
        promote_to_strategy: false,
      },
    })
    appendPlanEvent(db, {
      event_key: "review-2",
      chain_id: "flow-2",
      kind: "review",
      created_at: "2026-01-02T00:00:00.000Z",
      body_json: {
        strategy_ref: "S-TEST",
        outcome: "loss",
        pnl_r: -0.5,
        pnl_pct: -1,
        thesis_held: false,
        key_lesson: "failed",
        promote_to_strategy: false,
      },
    })

    const report = reviewStrategy({ strategyPath, ledgerPath, db })

    assert.equal(report.db_review_stats?.sample_count, 2)
    assert.equal(report.db_review_stats?.total_r, 0.7)
    assert.equal(report.latest.review_batch?.kind, "review_batch")
    assert.equal(policyHashForFile(strategyPath), report.policy_hash)
  } finally {
    db.close()
  }
})

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "strategy-iteration-"))
}

function writeStrategy(dir: string, status: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "s-test.md")
  writeFileSync(path, `---\nstrategy_id: S-TEST\nname: Test Strategy\nstatus: ${status}\ntags: [test]\n---\n\n# Test\n\n${body}\n`)
  return path
}

function positiveReplay(dir: string): ReplayResult {
  const csvPath = join(dir, "4h.csv")
  const manifestPath = join(dir, "manifest.json")
  if (!readFileIfExists(csvPath)) {
    writeFileSync(csvPath, "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1,100,101,99,100,1\n")
    const manifest = { schema_version: 2, closed_candles_only: true, symbol: "BTCUSDT", exchange: "binanceusdm", columns: ["date", "timestamp", "open", "high", "low", "close", "volume"], timeframes: { "4h": { file: "4h.csv", content_sha256: "" } } }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    manifest.timeframes["4h"].content_sha256 = replayContentHash(manifestPath, "4h")
    writeFileSync(manifestPath, JSON.stringify(manifest))
  }
  const assumptions = {
    anti_overfit: {
      method: "out_of_sample",
      stage: "locked_holdout",
      oos_stats: {
        sample_count: 12,
        win_rate: 0.5,
        avg_r: 0.09,
        total_r: 1.08,
        max_drawdown_r: 3,
        profit_factor: 1.2,
      },
      train_stats: {
        sample_count: 20,
        win_rate: 0.5,
        avg_r: 0.14,
        total_r: 2.8,
        max_drawdown_r: 4,
        profit_factor: 1.35,
      },
      trial_count: 3,
      parameter_count: 4,
    },
    robustness: {
      regime_slices: [
        { regime: "bull_low_vol", sample_count: 8, avg_r: 0.1, total_r: 0.8, profit_factor: 1.2 },
        { regime: "bear_high_vol", sample_count: 7, avg_r: 0.08, total_r: 0.56, profit_factor: 1.15 },
      ],
      cost_stress: { extra_bps_per_side: 5, stats: { sample_count: 32, avg_r: 0.07, total_r: 2.24, profit_factor: 1.15 } },
      parameter_stability: { method: "fixed_plus_minus_10pct", evaluation_count: 6, positive_ratio: 1, worst_avg_r: 0.04 },
    },
  }
  return {
    strategy_id: "S-TEST",
    symbol: "BTCUSDT",
    timeframe: "4h",
    sample_count: 32,
    win_rate: 0.5,
    avg_r: 0.12,
    total_r: 3.84,
    max_drawdown_r: 4,
    profit_factor: 1.3,
    expectancy_r: 0.12,
    gate: {
      shadow_candidate: true,
      live_small_candidate: false,
      blocked_by: [],
    },
    trades: [],
    assumptions,
    provenance: {
      harness_hash: replayHarnessHash(),
      data_hash: replayDataHash(manifestPath, "4h"),
      assumptions_hash: hashCanonical(assumptions),
      data_ref: manifestPath,
      timeframe: "4h",
      data_schema_version: 2,
      closed_candles_only: true,
      manifest_checksum_verified: true,
    },
    notes: ["positive mechanical replay"],
  }
}

function replayWithAssumptions(dir: string, assumptions: Record<string, unknown>): ReplayResult {
  const replay = positiveReplay(dir)
  return {
    ...replay,
    assumptions,
    provenance: {
      ...replay.provenance,
      assumptions_hash: hashCanonical(assumptions),
    },
  }
}

function readFileIfExists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}
