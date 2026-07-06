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
import type { ReplayResult } from "./replay-core"

test("strategy review separates fresh and stale evidence by policy hash", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "draft", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: positiveReplay(),
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
    replayResult: positiveReplay(),
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
    replayResult: {
      ...positiveReplay(),
      assumptions: {},
    },
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
    replayResult: {
      ...positiveReplay(),
      assumptions: {
        anti_overfit: {
          method: "out_of_sample",
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
      },
    },
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
    replayResult: {
      ...positiveReplay(),
      assumptions: {
        anti_overfit: {
          method: "walk_forward",
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
      },
    },
    now: "2026-01-01T00:00:00.000Z",
  })

  const report = reviewStrategy({ strategyPath, ledgerPath })

  assert.equal(report.gate.shadow_candidate, false)
  assert.equal(report.gate.blocked_by.some((item) => item.check_id === "S-SEARCH-BUDGET"), true)
})

test("strategy promote to live-small requires shadow evidence", () => {
  const dir = makeDir()
  const strategyPath = writeStrategy(dir, "shadow", "Rule v1")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  appendReplayEvidence({
    strategyPath,
    ledgerPath,
    replayResult: positiveReplay(),
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
  const result = promoteStrategy({ strategyPath, ledgerPath, toStatus: "live-small", yes: true })
  assert.equal(result.status, "updated")
  assert.match(readFileSync(strategyPath, "utf8"), /status: live-small/)
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

function positiveReplay(): ReplayResult {
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
    assumptions: {
      anti_overfit: {
        method: "out_of_sample",
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
    },
    notes: ["positive mechanical replay"],
  }
}
