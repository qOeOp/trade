import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { evaluateRndSignal, runStrategyRndBatch, runStrategyRndCampaign, runStrategyRndLoop, strategyRndBatchInputFromJson } from "./strategy-rnd"

test("strategy R&D parser normalizes factor discovery options", () => {
  const input = strategyRndBatchInputFromJson({
    manifest_path: "/tmp/manifest.json",
    factor_discover: true,
    anti_overfit_stage: "external_validation",
    search_trial_count: 7,
    factor_research_options: { horizon_bars: 8, min_samples: 500, max_correlation: 0.8 },
    candidates: [{ candidate_id: "C-1", params: { side: "long" } }],
  })

  assert.equal(input.factorDiscover, true)
  assert.equal(input.antiOverfitStage, "external_validation")
  assert.equal(input.searchTrialCount, 7)
  assert.equal(input.factorResearchOptions?.horizonBars, 8)
  assert.equal(input.factorResearchOptions?.minSamples, 500)
  assert.equal(input.factorResearchOptions?.maxCorrelation, 0.8)
})

test("latest strategy signal injects a live entry reference into the replay family", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-signal-"))
  try {
    const entryPrice = buildReplayCandles().at(-1)!.close
    const result = evaluateRndSignal({
      manifestPath: writeManifest(dir),
      entryPrice,
      now: new Date(1_700_000_000_000 + 280 * 4 * 60 * 60 * 1000).toISOString(),
      candidate: {
        candidateId: "C-LIVE-SIGNAL",
        family: "trend_pullback_v1",
        params: { side: "both", fast_ema: 50, slow_ema: 200, pullback_atr: 10, stop_atr: 0.5, max_risk_atr: 20, reward_risk: 2 },
      },
    })
    assert.equal(result.entry_reference, entryPrice)
    assert.equal(result.action, "entry")
    assert.equal((result.signal as { entry: number }).entry, entryPrice)
    assert.equal(typeof result.candidate_hash, "string")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("latest strategy signal rejects stale candles", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-stale-signal-"))
  try {
    assert.throws(() => evaluateRndSignal({
      manifestPath: writeManifest(dir),
      entryPrice: 100,
      now: "2026-01-01T00:00:00.000Z",
      candidate: { candidateId: "C-STALE", params: { side: "both" } },
    }), /latest closed candle is stale/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch runs bounded predeclared candidates", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-"))
  try {
    const manifestPath = writeManifest(dir)
    const indicatorReportPath = join(dir, "indicator-report.json")
    writeFileSync(indicatorReportPath, JSON.stringify({
      ok: true,
      data: {
        selected_indicators: {
          vpci: {
            category: "volume",
            defaults: { period_short: 5, period_long: 20 },
            observe: "看量价方向一致还是背离。",
          },
          stc: {
            category: "momentum",
            defaults: { fast: 23, slow: 50, length: 10 },
            observe: "看 25/75 区域穿越和方向切换。",
          },
        },
        timeframes: {
          "4h": {
            features: {
              vpci: {
                status: "ok",
                values: buildFeaturePoints(280, 1),
              },
            },
            structure_validation: {
              support: {
                sample_count: 88,
                respect_rate: 0.93,
                break_rate: 0.07,
              },
            },
          },
        },
      },
    }))
    const report = runStrategyRndBatch({
      batchId: "rnd-test",
      hypothesis: "trend pullback variants",
      manifestPath,
      indicatorReportPath,
      oosSplitRatio: 0.3,
      maxHoldBars: 8,
      feeBps: 2,
      slippageBps: 1,
      searchTrialCount: 7,
      candidates: [{
        candidateId: "C-LONG-EMA50",
        description: "long-only EMA50 pullback",
        parameterCount: 7,
        params: {
          side: "long",
          fast_ema: 50,
          slow_ema: 200,
          pullback_atr: 0.25,
          stop_atr: 0.5,
          max_risk_atr: 1.25,
          reward_risk: 1.5,
          indicator_filters: [{
            indicator_id: "vpci",
            op: "gt",
            value: 0,
          }],
        },
      }],
    })

    assert.equal(report.batch_id, "rnd-test")
    assert.equal(report.trial_count, 1)
    assert.equal(report.guardrails.no_auto_promote, true)
    assert.equal(report.selection_audit.method, "four_block_rank_reversal")
    assert.equal(report.selection_audit.declared_trials, 7)
    assert.equal(report.candidates.length, 1)
    assert.equal(report.candidates[0].replay.strategy_id, "C-LONG-EMA50")
    assert.equal((report.candidates[0].replay.assumptions.anti_overfit as { trial_count: number }).trial_count, 7)
    assert.ok(["candidate_found", "no_promote"].includes(report.outcome))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch refuses excessive trial budget", () => {
  const candidates = Array.from({ length: 11 }, (_, index) => ({
    candidateId: `C-${index}`,
    params: { side: "long" },
  }))

  assert.throws(
    () => runStrategyRndBatch({
      manifestPath: "/tmp/manifest.json",
      candidates,
    }),
    /trial_count 11 exceeds 10/,
  )
})

test("strategy R&D batch reports actionable failure summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-failure-summary-"))
  try {
    const report = runStrategyRndBatch({
      manifestPath: writeManifest(dir),
      candidates: [{
        candidateId: "C-TOO-COMPLEX",
        parameterCount: 9,
        params: { side: "long" },
      }],
    })

    assert.equal(report.outcome, "no_promote")
    assert.equal(report.failure_summary.rejected_candidate_count, 1)
    assert.equal(report.failure_summary.top_blockers.some((item) => item.check_id === "RND-PARAM-COUNT"), true)
    assert.notEqual(report.failure_summary.primary_failure_area, "none")
    assert.ok(report.failure_summary.next_system_actions.length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch rejects duplicate candidate ids", () => {
  assert.throws(() => runStrategyRndBatch({
    manifestPath: "/tmp/manifest.json",
    candidates: [
      { candidateId: "DUP", params: { side: "long" } },
      { candidateId: "DUP", params: { side: "short" } },
    ],
  }), /candidate_id must be unique/)
})

test("parameter stability does not perturb discrete EMA selectors", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-stability-"))
  try {
    const report = runStrategyRndBatch({
      manifestPath: writeManifest(dir),
      candidates: [{
        candidateId: "C-STABILITY",
        parameterCount: 6,
        params: { side: "long", fastEma: 50, slowEma: 200, pullbackAtr: 0.25, stopAtr: 0.5, maxRiskAtr: 1.25, rewardRisk: 2 },
      }],
    })
    const stability = (report.candidates[0].replay.assumptions.robustness as { parameter_stability: { results: Array<{ parameter: string }> } }).parameter_stability
    assert.deepEqual(stability.results.map((item) => item.parameter), ["pullbackAtr", "pullbackAtr", "stopAtr", "stopAtr", "maxRiskAtr", "maxRiskAtr"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch executes structure breakout retest family without future levels", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-structure-"))
  try {
    const manifestPath = writeStructureManifest(dir)
    const report = runStrategyRndBatch({
      batchId: "rnd-structure-test",
      hypothesis: "range resistance breakout followed by a defended retest",
      manifestPath,
      timeframe: "4h",
      maxHoldBars: 8,
      feeBps: 2,
      slippageBps: 1,
      candidates: [{
        candidateId: "C-STRUCTURE-LONG",
        description: "long breakout and retest of rolling resistance",
        family: "structure_breakout_retest_v1",
        parameterCount: 7,
        params: {
          side: "long",
          lookback_bars: 40,
          breakout_buffer_atr: 0.1,
          retest_tolerance_atr: 0.5,
          stop_atr: 0.25,
          max_risk_atr: 2,
          reward_risk: 2,
        },
      }],
    })

    assert.equal(report.candidates[0].family, "structure_breakout_retest_v1")
    assert.equal(report.candidates[0].replay.strategy_id, "C-STRUCTURE-LONG")
    assert.ok(report.candidates[0].replay.sample_count > 0)
    assert.equal(report.candidates[0].replay.trades[0].reason, "rnd structure breakout retest long")
    assert.equal(report.candidates[0].params.lookbackBars, 40)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch composes generic factor conditions without indicator-specific branches", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-factor-compose-"))
  try {
    const manifestPath = writeManifest(dir)
    const indicatorReportPath = join(dir, "factor-report.json")
    writeFileSync(indicatorReportPath, JSON.stringify({
      data: {
        selected_indicators: {},
        timeframes: {
          "4h": {
            features: {
              "vpci.value": {
                status: "ok",
                factor_id: "vpci.value",
                source_indicator: "vpci",
                output: "value",
                category: "volume",
                roles: ["confirmation"],
                allowed_transforms: ["level", "slope"],
                values: buildFeaturePoints(280, 1),
              },
            },
          },
        },
      },
    }))
    const report = runStrategyRndBatch({
      manifestPath,
      indicatorReportPath,
      factorCompose: true,
      factorSeeds: [{
        factorId: "vpci.value",
        role: "confirmation",
        transform: "level",
        lookback: 1,
        op: "gt",
        value: 0,
      }],
      maxFactorsPerCandidate: 2,
      candidates: [{
        candidateId: "BASE-LONG",
        family: "trend_pullback_v1",
        parameterCount: 7,
        params: { side: "long" },
      }],
    })

    assert.equal(report.candidate_source, "bounded_factor_composition")
    assert.equal(report.trial_count, 1)
    assert.equal(report.candidates[0].parameter_count, 8)
    assert.equal((report.candidates[0].params.factorConditions as Array<{ factorId: string }>)[0].factorId, "vpci.value")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch discovers statistically screened factor seeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-factor-discovery-"))
  try {
    const closes = Array.from({ length: 900 }, (_, index) => 100 + Math.sin(index / 35) * 12 + Math.sin(index / 4) * (Math.floor(index / 90) % 2 === 0 ? 1.5 : 5))
    const rows = closes.map((close, index) => {
      const open = closes[Math.max(0, index - 1)]
      const timestamp = 1_700_000_000_000 + index * 4 * 60 * 60 * 1000
      return [new Date(timestamp).toISOString(), timestamp, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close, 1_000 + index].join(",")
    })
    writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
    const manifestPath = join(dir, "manifest.json")
    writeFileSync(manifestPath, JSON.stringify({ symbol: "BTCUSDT", timeframes: { "4h": { file: "4h.csv" } } }))
    const baseCandidate = { candidateId: "BASE-BOTH", family: "trend_pullback_v1", parameterCount: 6, params: { side: "both" } }
    const baseline = runStrategyRndBatch({ manifestPath, candidates: [baseCandidate] })
    const outcomes = new Map(baseline.candidates[0].replay.trades.map((trade) => [trade.signal_time, trade.r]))
    const reportPath = join(dir, "factor-report.json")
    writeFileSync(reportPath, JSON.stringify({ data: { timeframes: { "4h": { features: {
      "forward.proxy": {
        status: "ok",
        factor_id: "forward.proxy",
        source_indicator: "test",
        output: "value",
        category: "momentum",
        roles: ["confirmation"],
        allowed_transforms: ["level"],
        values: closes.map((_, index) => ({
          timestamp: new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
          value: outcomes.get(new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString()) ?? 0,
        })),
      },
    } } } } }))

    const report = runStrategyRndBatch({
      manifestPath,
      indicatorReportPath: reportPath,
      factorDiscover: true,
      factorCompose: true,
      factorResearchOptions: { lookback: 1, minSamples: 10, minAbsIc: 0.05 },
      candidates: [baseCandidate],
    })

    assert.equal(report.candidate_source, "scientific_factor_discovery")
    assert.equal(report.factor_research?.method, "setup_conditioned_rank_ic")
    assert.equal(report.factor_research?.profiles[0].sample_count, outcomes.size)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D loop writes artifact and compact JSONL ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-loop-"))
  try {
    const manifestPath = writeManifest(dir)
    const indicatorReportPath = join(dir, "indicator-report.json")
    const artifactRoot = join(dir, "artifacts")
    const ledgerPath = join(dir, "strategy-rnd-ledger.jsonl")
    writeFileSync(indicatorReportPath, JSON.stringify({
      ok: true,
      data: {
        selected_indicators: {
          vpci: {
            category: "volume",
            defaults: { period_short: 5, period_long: 20 },
            observe: "volume confirmation",
          },
        },
        timeframes: {
          "4h": {
            features: {
              vpci: { status: "ok", values: buildFeaturePoints(280, 1) },
            },
          },
        },
      },
    }))

    const report = runStrategyRndLoop({
      runId: "rnd-loop-test",
      batchId: "batch-loop-test",
      manifestPath,
      indicatorReportPath,
      artifactRoot,
      ledgerPath,
      candidates: [{ candidateId: "C-LOOP", parameterCount: 1, params: { side: "long" } }],
      now: "2026-07-07T00:00:00.000Z",
    })

    assert.equal(report.run_id, "rnd-loop-test")
    assert.equal(report.ledger_ref, ledgerPath)
    assert.equal(existsSync(report.artifact_ref), true)
    const ledgerLines = readFileSync(ledgerPath, "utf8").trim().split("\n")
    assert.equal(ledgerLines.length, 1)
    const record = JSON.parse(ledgerLines[0]) as { run_id: string; artifact_ref: string; trial_count: number }
    assert.equal(record.run_id, "rnd-loop-test")
    assert.equal(record.artifact_ref, report.artifact_ref)
    assert.equal(record.trial_count, report.batch.trial_count)
    const artifact = JSON.parse(readFileSync(report.artifact_ref, "utf8")) as { stop_reason: string }
    assert.equal(artifact.stop_reason, report.stop_reason)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D loop rejects duplicate run ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-idempotence-"))
  try {
    const input = {
      runId: "same-run",
      manifestPath: writeManifest(dir),
      artifactRoot: join(dir, "artifacts"),
      ledgerPath: join(dir, "strategy-rnd-ledger.jsonl"),
      candidates: [{ candidateId: "C-1", parameterCount: 1, params: { side: "long" } }],
    }
    runStrategyRndLoop(input)
    assert.throws(() => runStrategyRndLoop(input), /run_id already exists/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D loop permits one evaluation per locked holdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-holdout-once-"))
  try {
    const manifestPath = writeManifest(dir)
    const common = {
      manifestPath,
      artifactRoot: join(dir, "artifacts"),
      ledgerPath: join(dir, "strategy-rnd-ledger.jsonl"),
      antiOverfitStage: "locked_holdout" as const,
      oosSplitRatio: 0.3,
      candidates: [{ candidateId: "C-1", parameterCount: 1, params: { side: "long" } }],
    }
    runStrategyRndLoop({ ...common, runId: "holdout-first" })
    assert.throws(
      () => runStrategyRndLoop({ ...common, runId: "holdout-second" }),
      /locked holdout has already been evaluated/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign continues after a failed hypothesis", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-"))
  try {
    const discoveryDir = join(dir, "discovery")
    const validationDir = join(dir, "validation")
    mkdirSync(discoveryDir)
    mkdirSync(validationDir)
    const discoveryManifest = writeManifest(discoveryDir, 1_700_000_000_000)
    const validationManifest = writeManifest(validationDir, 1_600_000_000_000)
    const ledgerPath = join(dir, "strategy-rnd-ledger.jsonl")
    const candidate = {
      candidateId: "C-LONG",
      parameterCount: 7,
      params: {
        side: "long",
        fast_ema: 50,
        slow_ema: 200,
        pullback_atr: 0.25,
        stop_atr: 0.5,
        max_risk_atr: 1.25,
        reward_risk: 2,
      },
    }
    const report = runStrategyRndCampaign({
      campaignId: "campaign-test",
      maxTotalTrials: 2,
      artifactRoot: join(dir, "artifacts"),
      ledgerPath,
      now: "2026-07-07T00:00:00.000Z",
      hypotheses: ["h1", "h2"].map((hypothesisId) => ({
        hypothesisId,
        hypothesis: `test ${hypothesisId}`,
        manifestPath: discoveryManifest,
        validationManifestPath: validationManifest,
        candidates: [{ ...candidate, candidateId: `${candidate.candidateId}-${hypothesisId}` }],
      })),
    })

    assert.equal(report.outcome, "no_validated_candidate")
    assert.equal(report.stop_reason, "hypothesis_queue_exhausted")
    assert.equal(report.hypotheses_run, 2)
    assert.equal(report.trials_used, 2)
    assert.equal(report.runs.every((run) => run.discovery_outcome === "no_promote"), true)
    assert.equal(readFileSync(ledgerPath, "utf8").trim().split("\n").length, 2)
    assert.equal(existsSync(report.artifact_ref), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign stops before search when calibration fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-calibration-"))
  try {
    const discoveryDir = join(dir, "discovery")
    const validationDir = join(dir, "validation")
    mkdirSync(discoveryDir)
    mkdirSync(validationDir)
    const calibrationReport = join(dir, "calibration.json")
    const ledgerPath = join(dir, "strategy-rnd-ledger.jsonl")
    writeFileSync(calibrationReport, JSON.stringify({
      ok: true,
      data: {
        calibrated: false,
        failure_analysis: {
          findings: [
            { check_id: "CAL-NULL-NOT-BEATEN", severity: "blocker" },
            { check_id: "CAL-PANEL-BREADTH", severity: "warning" },
          ],
        },
      },
    }))
    const report = runStrategyRndCampaign({
      campaignId: "campaign-calibration-test",
      calibrationReportPath: calibrationReport,
      artifactRoot: join(dir, "artifacts"),
      ledgerPath,
      hypotheses: [{
        hypothesisId: "h1",
        manifestPath: writeManifest(discoveryDir, 1_700_000_000_000),
        validationManifestPath: writeManifest(validationDir, 1_600_000_000_000),
        candidates: [{ candidateId: "C-1", params: { side: "long" } }],
      }],
    })

    assert.equal(report.stop_reason, "calibration_failed")
    assert.equal(report.trials_used, 0)
    assert.equal(report.hypotheses_run, 0)
    assert.equal((report.calibration_gate as { blocked: boolean; blocker_count: number }).blocked, true)
    assert.equal((report.calibration_gate as { blocker_count: number }).blocker_count, 1)
    assert.equal(existsSync(ledgerPath), false)
    assert.equal(existsSync(report.artifact_ref), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign rejects overlapping validation data", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-overlap-"))
  try {
    const manifestPath = writeManifest(dir)
    assert.throws(() => runStrategyRndCampaign({
      campaignId: "campaign-overlap-test",
      hypotheses: [{
        hypothesisId: "h1",
        manifestPath,
        validationManifestPath: manifestPath,
        candidates: [{ candidateId: "C-1", params: { side: "long" } }],
      }],
    }), /manifests overlap/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function buildFeaturePoints(count: number, value: number): Array<{ timestamp: string; value: number }> {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
    value,
  }))
}

function writeManifest(dir: string, startTimestamp = 1_700_000_000_000): string {
  writeFileSync(join(dir, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    ...buildReplayCandles().map((item, index) => [
      new Date(startTimestamp + index * 4 * 60 * 60 * 1000).toISOString(),
      startTimestamp + index * 4 * 60 * 60 * 1000,
      item.open,
      item.high,
      item.low,
      item.close,
      item.volume,
    ].join(",")),
  ].join("\n"))
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "4h.csv",
      },
    },
  }))
  return manifestPath
}

function writeStructureManifest(dir: string): string {
  const candles = Array.from({ length: 280 }, (_, index) => {
    const center = 100 + Math.sin(index / 3) * 0.25
    return {
      open: Number((center - 0.1).toFixed(2)),
      high: Number((center + 0.5).toFixed(2)),
      low: Number((center - 0.5).toFixed(2)),
      close: Number((center + 0.1).toFixed(2)),
      volume: 1000 + index,
    }
  })
  candles[230] = { open: 100.2, high: 103.2, low: 100, close: 103, volume: 1800 }
  candles[231] = { open: 103, high: 103.1, low: 100.65, close: 101.2, volume: 1700 }
  candles[232] = { open: 101.2, high: 105, low: 101, close: 104.5, volume: 1900 }
  candles[233] = { open: 104.5, high: 106, low: 104, close: 105.5, volume: 1600 }

  writeFileSync(join(dir, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    ...candles.map((item, index) => [
      new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
      1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
      item.open,
      item.high,
      item.low,
      item.close,
      item.volume,
    ].join(",")),
  ].join("\n"))
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "4h.csv",
      },
    },
  }))
  return manifestPath
}

function buildReplayCandles(): Array<{ open: number; high: number; low: number; close: number; volume: number }> {
  const candles: Array<{ open: number; high: number; low: number; close: number; volume: number }> = []
  let close = 100
  for (let index = 0; index < 280; index += 1) {
    const trend = index < 240 ? 0.25 : 0.35
    const pullback = index > 220 && index % 8 === 0 ? -3 : 0
    const open = close
    close = close + trend + pullback
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - (pullback < 0 ? Math.abs(pullback) + 0.5 : 0.4)
    candles.push({
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000 + index,
    })
  }
  return candles
}
