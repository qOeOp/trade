import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { runSlowTrackWorkflowDryRun } from "./slow-track-workflow"
import { ensureSchema } from "./plan-events"
import type { Runner } from "./observe-adapter"

test("slow track workflow dry-run builds real watchlist without live action", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "trade-flow-slow-workflow-"))
  const dataDir = join(repoRoot, ".agents/skills/trade-flow/data")
  mkdirSync(join(repoRoot, "profile"), { recursive: true })
  mkdirSync(join(repoRoot, "strategies"), { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(repoRoot, "profile/account_config.json"), JSON.stringify({
    max_open_risk_pct: 0.03,
    max_day_loss_pct: 0.05,
  }))
  writeFileSync(
    join(repoRoot, "strategies/s-btc.md"),
    "---\nstrategy_id: S-BTC\nname: BTC Live\nstatus: live-small\ntags: [btc, usdm]\n---\nbody\n",
  )
  const db = new Database(":memory:")
  ensureSchema(db)
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const runner: Runner = async (command, options) => {
    calls.push({ command, cwd: options?.cwd })
    if (options?.cwd?.endsWith("binance-account-snapshot")) {
      return jsonOk({
        generated_at: "2026-07-08T16:00:00+08:00",
        balances: [{ asset: "USDT", balance: "1000" }],
        positions: [],
        openOrders: { regular: [], protective: [] },
        errors: {},
      })
    }
    if (options?.cwd?.endsWith("binance-market-scan")) {
      return jsonOk({
        summary: { eligibleSymbols: 2 },
        filters: { direction: "both" },
        candidates: {
          long: [{
            symbol: "BTCUSDT",
            priceChangePercent: "3.5",
            quoteVolume: "1000000000",
            score: 430,
            tags: ["very-liquid", "trend-up-day"],
          }],
          short: [{
            symbol: "ETHUSDT",
            priceChangePercent: "-2.1",
            quoteVolume: "800000000",
            score: 290,
            tags: ["liquid", "trend-down-day"],
          }],
        },
      })
    }
    if (options?.cwd?.endsWith("binance-symbol-snapshot")) {
      const symbol = command[command.indexOf("--symbol") + 1]
      return jsonOk({
        symbol,
        ticker24h: { lastPrice: symbol === "BTCUSDT" ? "65000" : "3500" },
        priceSnapshot: { markPrice: symbol === "BTCUSDT" ? "65010" : "3498" },
        premiumIndex: { markPrice: "65010", lastFundingRate: "0.0001" },
        openInterest: { openInterest: "12345" },
      })
    }
    if (options?.cwd?.endsWith("ohlcv-fetch")) {
      const symbol = command[command.indexOf("--symbol") + 1]
      const outputDir = command[command.indexOf("--output-dir") + 1]
      return jsonOk({
        symbol,
        manifest_path: join(outputDir, "manifest.json"),
        output_dir: outputDir,
        timeframes: {
          "1d": { rows: 100, first_open_ts: 1, last_open_ts: 100 },
          "4h": { rows: 100, first_open_ts: 1, last_open_ts: 100 },
          "1h": { rows: 100, first_open_ts: 1, last_open_ts: 100 },
        },
      })
    }
    if (options?.cwd?.endsWith("tech-indicators")) {
      return jsonOk({
        symbol: "BTC/USDT:USDT",
        generated_at: "2026-07-08T16:00:02+08:00",
        summary: { bias: "bullish", suggestion: "wait for pullback to support" },
        timeframes: {
          "1d": { trend: "up", core_context: { current_price: 65000 }, supports: [], resistances: [] },
          "4h": {
            trend: "up",
            core_context: { current_price: 65000, atr_14: 1000 },
            position_in_range: "upper",
            bullish_invalidation: "close below 64000",
            bearish_invalidation: "close above 66000",
            supports: [{ price: 64000, zone_low: 63800, zone_high: 64200, strength: "strong", touches: 3, distance_from_price_pct: -0.015 }],
            resistances: [{ price: 67000, zone_low: 66800, zone_high: 67200, strength: "medium", touches: 2, distance_from_price_pct: 0.03 }],
            trendlines: [],
          },
          "1h": { trend: "up", core_context: { current_price: 65000 }, supports: [], resistances: [] },
        },
        summary_markdown: "# BTC Technical Analysis\n",
      })
    }
    throw new Error("unexpected runner call")
  }

  try {
    const result = await runSlowTrackWorkflowDryRun({
      repoRoot,
      dataDir,
      runId: "run-slow-test",
      db,
      runner,
    })
    assert.equal(result.mode, "analysis-only")
    assert.equal(isAbsolute(String(result.artifact_path)), false)
    assert.equal((result.trade_decision as { target_action: string }).target_action, "no_action")
    assert.equal((result.strategy_pool as { live_small_ready: unknown[] }).live_small_ready.length, 1)
    assert.equal((result.watchlist as unknown[]).length, 2)
    assert.equal((result.watchlist as Array<{ symbol: string; strategy_usage: { matched_live_small_strategies: string[] } }>)[0].symbol, "BTCUSDT")
    assert.deepEqual((result.watchlist as Array<{ strategy_usage: { matched_live_small_strategies: string[] } }>)[0].strategy_usage.matched_live_small_strategies, ["S-BTC"])
    const ohlcv = (result.watchlist as Array<{ technical_analysis: { ohlcv: { manifest_path: string; output_dir: string } } }>)[0].technical_analysis.ohlcv
    assert.equal(ohlcv.manifest_path, "tmp/market/run-slow-test/BTCUSDT/manifest.json")
    assert.equal(ohlcv.output_dir, "tmp/market/run-slow-test/BTCUSDT")
    assert.equal(isAbsolute(ohlcv.manifest_path), false)
    const indicatorCall = calls.find((call) => call.cwd?.endsWith("tech-indicators") && call.command.includes("--manifest"))
    assert.equal(indicatorCall?.command[indicatorCall.command.indexOf("--manifest") + 1], join(repoRoot, "tmp/market/run-slow-test/BTCUSDT/manifest.json"))
    assert.equal((result.watchlist as Array<{ operator_suggestion: { action: string } }>)[0].operator_suggestion.action, "watch_long_setup")
    assert.match(readFileSync(join(repoRoot, String(result.artifact_path)), "utf8"), /BTCUSDT/)
    assert.equal(calls.some((call) => call.command.includes("--run-live-small")), false)
  } finally {
    db.close()
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("slow track workflow reports account snapshot unavailable without inventing action", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "trade-flow-slow-no-account-"))
  const dataDir = join(repoRoot, ".agents/skills/trade-flow/data")
  mkdirSync(join(repoRoot, "profile"), { recursive: true })
  mkdirSync(join(repoRoot, "strategies"), { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(repoRoot, "profile/account_config.json"), "{}")
  writeFileSync(join(repoRoot, "strategies/s-draft.md"), "---\nstrategy_id: S-DRAFT\nstatus: draft\n---\n")
  const db = new Database(":memory:")
  ensureSchema(db)
  const runner: Runner = async (_command, options) => {
    if (options?.cwd?.endsWith("binance-account-snapshot")) {
      return { ok: false, error: "missing env", stdout: "", stderr: "", exitCode: 1 }
    }
    if (options?.cwd?.endsWith("binance-market-scan")) {
      return jsonOk({ candidates: { long: [], short: [] } })
    }
    return jsonOk({})
  }

  try {
    const result = await runSlowTrackWorkflowDryRun({
      repoRoot,
      dataDir,
      runId: "run-no-account",
      db,
      runner,
    })
    assert.equal(isAbsolute(String(result.artifact_path)), false)
    assert.equal((result.account_state as { ok: boolean }).ok, false)
    assert.equal((result.trade_decision as { reason: string }).reason, "account_snapshot_unavailable")
  } finally {
    db.close()
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("slow track workflow analyzes every default watchlist candidate", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "trade-flow-slow-full-analysis-"))
  const dataDir = join(repoRoot, ".agents/skills/trade-flow/data")
  mkdirSync(join(repoRoot, "profile"), { recursive: true })
  mkdirSync(join(repoRoot, "strategies"), { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(repoRoot, "profile/account_config.json"), "{}")
  writeFileSync(join(repoRoot, "strategies/s-draft.md"), "---\nstrategy_id: S-DRAFT\nstatus: draft\n---\n")
  const db = new Database(":memory:")
  ensureSchema(db)
  const analyzedSymbols: string[] = []
  const runner: Runner = async (command, options) => {
    if (options?.cwd?.endsWith("binance-account-snapshot")) {
      return jsonOk({
        generated_at: "2026-07-08T16:00:00+08:00",
        balances: [],
        positions: [],
        openOrders: { regular: [], protective: [] },
        errors: {},
      })
    }
    if (options?.cwd?.endsWith("binance-market-scan")) {
      return jsonOk({
        candidates: {
          long: ["AAAUSDT", "BBBUSDT", "CCCUSDT"].map((symbol, index) => ({
            symbol,
            priceChangePercent: String(index + 1),
            quoteVolume: "100000000",
            score: 100 - index,
            tags: ["liquid"],
          })),
          short: [],
        },
      })
    }
    if (options?.cwd?.endsWith("binance-symbol-snapshot")) {
      const symbol = command[command.indexOf("--symbol") + 1]
      return jsonOk({
        symbol,
        ticker24h: { lastPrice: "1" },
        priceSnapshot: { markPrice: "1" },
        premiumIndex: { markPrice: "1", lastFundingRate: "0" },
        openInterest: { openInterest: "1000" },
      })
    }
    if (options?.cwd?.endsWith("ohlcv-fetch")) {
      const symbol = command[command.indexOf("--symbol") + 1]
      analyzedSymbols.push(symbol)
      return jsonOk({
        symbol,
        manifest_path: join(repoRoot, "tmp/market/run-full-analysis", symbol, "manifest.json"),
        output_dir: join(repoRoot, "tmp/market/run-full-analysis", symbol),
        timeframes: {},
      })
    }
    if (options?.cwd?.endsWith("tech-indicators")) {
      return jsonOk({
        summary: { bias: "slightly-bullish", suggestion: "wait" },
        timeframes: {
          "1d": {},
          "4h": {},
          "1h": {},
        },
      })
    }
    throw new Error("unexpected runner call")
  }

  try {
    const result = await runSlowTrackWorkflowDryRun({
      repoRoot,
      dataDir,
      runId: "run-full-analysis",
      db,
      runner,
    })
    assert.equal(isAbsolute(String(result.artifact_path)), false)
    assert.deepEqual(analyzedSymbols, ["AAAUSDT", "BBBUSDT", "CCCUSDT"])
    assert.equal((result.watchlist as Array<{ technical_analysis: { indicators?: { ok?: boolean } } }>)[2].technical_analysis.indicators?.ok, true)
  } finally {
    db.close()
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

function jsonOk(data: unknown) {
  return {
    ok: true as const,
    data: { ok: true, data },
    stdout: "{}",
    stderr: "",
  }
}
