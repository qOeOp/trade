import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"

import { replayDataHash } from "../../../../../replay-execution-plane/compatibility/replay-engine/src/lib/replay-core"
import { createRdProgramState, readRdProgramState, writeRdProgramState } from "../../../../program-control/src/lib/rd-program-state"
import { runStrategyRndBatch } from "../../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-batch"
import { strategyRndBatchInputFromJson } from "../../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-inputs"
import { runStrategyRndCampaign } from "../../../../../agent-roles/developer/rd-campaign-runner/src/lib/rd-campaign-runner"
import { runStrategyRndLoop } from "../../../../../agent-roles/developer/rd-loop-runner/src/lib/rd-loop-runner"
import { loadRndLedger } from "../../../../experiment-ledger/src/lib/rd-ledger"
import { resolveRepoPath } from "../../../../../../contracts/runtime-core/src/paths"

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
    assert.equal(report.statistical_report.method, "full_trial_statistical_report_v1")
    assert.equal(report.statistical_report.trial_universe.declared_trials, 7)
    assert.deepEqual(report.statistical_report.trial_universe.candidate_ids, ["C-LONG-EMA50"])
    assert.equal(report.candidates.length, 1)
    assert.equal(report.candidates[0].replay.strategy_id, "C-LONG-EMA50")
    assert.equal(report.candidates[0].negative_controls.method, "side_flip_and_entry_lag")
    assert.equal((report.candidates[0].replay.assumptions.temporal_integrity as { status: string }).status, "passed")
    assert.deepEqual(report.candidates[0].negative_controls.controls.map((item) => item.control_id), ["side_flip", "entry_lag_3"])
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
    assert.equal(report.reliability_gate.status, "blocked")
    assert.equal(report.reliability_gate.more_trials_allowed, false)
    assert.equal(report.reliability_gate.sample_profile.candidate_count, 1)
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
    assert.equal(report.candidates[0].params.lookback_bars, 40)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("time-series momentum family can declare break-even protection", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-break-even-"))
  try {
    const report = runStrategyRndBatch({
      manifestPath: writeManifest(dir),
      timeframe: "4h",
      maxHoldBars: 8,
      candidates: [{
        candidateId: "C-TSM-BE",
        family: "time_series_momentum_v1",
        parameterCount: 8,
        params: {
          side: "long",
          lookback_bars: 20,
          threshold_atr: 0.5,
          stop_atr: 1,
          max_risk_atr: 3,
          reward_risk: 2,
          break_even_after_r: 1,
          break_even_offset_r: 0,
        },
      }],
    })

    assert.equal(report.candidates[0].family, "time_series_momentum_v1")
    assert.equal(report.candidates[0].params.break_even_after_r, 1)
    assert.equal(report.candidates[0].params.break_even_offset_r, 0)
    assert.equal(report.candidates[0].replay.assumptions.protective_stop_policy, "optional_break_even_stop_activates_next_bar")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("funding carry family uses exact funding events with correct short carry direction", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-funding-carry-"))
  try {
    const start = 1_700_000_000_000
    const manifestPath = writeManifest(dir, start)
    const fundingReportPath = writeFundingEventsReport(dir, start, start + 280 * 4 * 60 * 60 * 1000, 0.0002)
    const report = runStrategyRndBatch({
      manifestPath,
      indicatorReportPath: fundingReportPath,
      timeframe: "4h",
      maxHoldBars: 8,
      fundingBpsPer8h: 0,
      candidates: [{
        candidateId: "C-FUNDING-CARRY-SHORT",
        family: "funding_carry_v1",
        parameterCount: 6,
        params: {
          side: "short",
          funding_lookback_events: 3,
          min_abs_funding_rate: 0.0001,
          stop_atr: 1,
          max_risk_atr: 3,
          reward_risk: 1.5,
        },
      }],
    })

    const candidate = report.candidates[0]
    assert.equal(candidate.family, "funding_carry_v1")
    assert.equal(candidate.replay.assumptions.funding_model, "historical_events_entry_notional")
    assert.equal(asRecord(candidate.replay.assumptions.funding_event_coverage).status, "complete")
    assert.ok(candidate.replay.sample_count > 0)
    const trade = candidate.replay.trades[0]
    assert.equal(trade.reason, "rnd funding carry short")
    assert.equal(typeof asRecord(trade.meta).avg_funding_rate, "number")
    assert.ok(Number(trade.funding_r) < 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("funding carry family treats factor filters as strategy hypothesis components", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-funding-carry-filter-"))
  try {
    const start = 1_700_000_000_000
    const manifestPath = writeManifest(dir, start)
    const indicatorReportPath = writeFundingEventsReportWithFeature(dir, start, start + 280 * 4 * 60 * 60 * 1000, 0.0002, -1)
    const report = runStrategyRndBatch({
      manifestPath,
      indicatorReportPath,
      timeframe: "4h",
      maxHoldBars: 8,
      fundingBpsPer8h: 0,
      candidates: [{
        candidateId: "C-FUNDING-CARRY-FILTERED",
        family: "funding_carry_v1",
        parameterCount: 7,
        params: {
          side: "short",
          funding_lookback_events: 3,
          min_abs_funding_rate: 0.0001,
          stop_atr: 1,
          max_risk_atr: 3,
          reward_risk: 1.5,
          factor_conditions: [{
            factor_id: "vpci.value",
            role: "filter",
            transform: "level",
            lookback: 1,
            op: "gt",
            value: 0,
          }],
        },
      }],
    })

    const candidate = report.candidates[0]
    const factorConditions = asArray(candidate.params.factor_conditions).map(asRecord)
    assert.equal(factorConditions[0].factor_id, "vpci.value")
    assert.equal(candidate.replay.sample_count, 0)
    assert.ok(candidate.gate.blocked_by.some((block) => block.check_id === "RND-FEATURE-CAUSALITY"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("funding unwind risk guard family requires weak flow and choppy state", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-funding-unwind-risk-guard-"))
  try {
    const start = 1_700_000_000_000
    const manifestPath = writeManifest(dir, start)
    const indicatorReportPath = writeFundingEventsReportWithVfiChop(dir, start, start + 280 * 4 * 60 * 60 * 1000, 0.0002, -0.1, 55)
    const report = runStrategyRndBatch({
      manifestPath,
      indicatorReportPath,
      timeframe: "4h",
      maxHoldBars: 4,
      fundingBpsPer8h: 0,
      candidates: [{
        candidateId: "C-FUNDING-UNWIND-RISK-GUARD",
        family: "funding_unwind_risk_guard_v1",
        parameterCount: 8,
        params: {
          side: "short",
          funding_lookback_events: 3,
          min_abs_funding_rate: 0.0001,
          stop_atr: 0.85,
          max_risk_atr: 3,
          reward_risk: 1,
          vfi_weak_max: 0,
          chopiness_min: 50,
          max_adverse_move_atr: 100,
          max_short_close_location: 1,
        },
      }],
    })

    const candidate = report.candidates[0]
    assert.equal(candidate.family, "funding_unwind_risk_guard_v1")
    assert.equal(candidate.params.cooldown_bars, 12)
    assert.ok(candidate.replay.sample_count > 0)
    const trade = candidate.replay.trades[0]
    assert.equal(trade.reason, "rnd funding unwind risk guard short")
    assert.equal(asRecord(trade.meta).vfi, -0.1)
    assert.equal(asRecord(trade.meta).chopiness, 55)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("relative weakness momentum family consumes benchmark data causally", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-relative-weakness-"))
  try {
    const assetDir = join(dir, "asset")
    const benchmarkDir = join(dir, "benchmark")
    mkdirSync(assetDir)
    mkdirSync(benchmarkDir)
    const assetManifest = writeRelativeManifest(assetDir, "ALTUSDT", "weak")
    const benchmarkManifest = writeRelativeManifest(benchmarkDir, "BTCUSDT", "benchmark")
    const report = runStrategyRndBatch({
      manifestPath: assetManifest,
      timeframe: "4h",
      maxHoldBars: 8,
      candidates: [{
        candidateId: "C-REL-WEAK-SHORT",
        family: "relative_weakness_momentum_v1",
        parameterCount: 8,
        params: {
          side: "short",
          benchmark_manifest_path: benchmarkManifest,
          lookback_bars: 40,
          relative_threshold_atr: 0.5,
          stop_atr: 1,
          max_risk_atr: 3,
          reward_risk: 2,
          break_even_after_r: 0.5,
        },
      }],
    })

    const candidate = report.candidates[0]
    assert.ok(candidate)
    assert.equal(candidate.family, "relative_weakness_momentum_v1")
    assert.equal(candidate.params.benchmark_manifest_path, benchmarkManifest)
    assert.ok(candidate.replay.sample_count > 0)
    const trade = candidate.replay.trades[0]
    assert.ok(trade)
    assert.ok(trade.meta)
    assert.equal(trade.reason, "rnd relative weakness momentum short")
    assert.equal(typeof trade.meta.benchmark_return, "number")
    assert.equal(candidate.replay.provenance.data_hash, replayDataHash(assetManifest, "4h", [benchmarkManifest]))
    assert.equal(candidate.replay.provenance.supplemental_data?.[0].ref, benchmarkManifest)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("relative weakness momentum can require matching benchmark regime", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-relative-regime-"))
  try {
    const assetDir = join(dir, "asset")
    const strongBenchmarkDir = join(dir, "strong-benchmark")
    const weakBenchmarkDir = join(dir, "weak-benchmark")
    mkdirSync(assetDir)
    mkdirSync(strongBenchmarkDir)
    mkdirSync(weakBenchmarkDir)
    const assetManifest = writeRelativeManifest(assetDir, "ALTUSDT", "weak")
    const strongBenchmarkManifest = writeRelativeManifest(strongBenchmarkDir, "BTCUSDT", "benchmark")
    const weakBenchmarkManifest = writeRelativeManifest(weakBenchmarkDir, "BTCUSDT", "benchmark-weak")
    const report = runStrategyRndBatch({
      manifestPath: assetManifest,
      timeframe: "4h",
      maxHoldBars: 8,
      candidates: [{
        candidateId: "C-REL-WEAK-STRONG-BTC",
        family: "relative_weakness_momentum_v1",
        parameterCount: 8,
        params: {
          side: "short",
          benchmark_manifest_path: strongBenchmarkManifest,
          benchmark_return_max: -0.01,
          lookback_bars: 40,
          relative_threshold_atr: 0.5,
          stop_atr: 1,
          max_risk_atr: 3,
          reward_risk: 2,
        },
      }, {
        candidateId: "C-REL-WEAK-WEAK-BTC",
        family: "relative_weakness_momentum_v1",
        parameterCount: 8,
        params: {
          side: "short",
          benchmark_manifest_path: weakBenchmarkManifest,
          benchmark_return_max: -0.01,
          lookback_bars: 40,
          relative_threshold_atr: 0.5,
          stop_atr: 1,
          max_risk_atr: 3,
          reward_risk: 2,
        },
      }],
    })

    const [strongBtcCandidate, weakBtcCandidate] = report.candidates
    assert.ok(strongBtcCandidate)
    assert.ok(weakBtcCandidate)
    assert.equal(strongBtcCandidate.params.benchmark_return_max, -0.01)
    assert.equal(strongBtcCandidate.replay.sample_count, 0)
    assert.ok(weakBtcCandidate.replay.sample_count > 0)
    const weakBtcTrade = weakBtcCandidate.replay.trades[0]
    assert.ok(weakBtcTrade)
    assert.ok(weakBtcTrade.meta)
    assert.ok((weakBtcTrade.meta.benchmark_return as number) <= -0.01)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("relative weakness family can test reversion without adding a new family", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-relative-reversion-"))
  try {
    const assetDir = join(dir, "asset")
    const benchmarkDir = join(dir, "benchmark")
    mkdirSync(assetDir)
    mkdirSync(benchmarkDir)
    const assetManifest = writeRelativeManifest(assetDir, "ALTUSDT", "weak")
    const benchmarkManifest = writeRelativeManifest(benchmarkDir, "BTCUSDT", "benchmark-weak")
    const report = runStrategyRndBatch({
      manifestPath: assetManifest,
      timeframe: "4h",
      maxHoldBars: 8,
      candidates: [{
        candidateId: "C-REL-REVERSION-LONG",
        family: "relative_weakness_momentum_v1",
        parameterCount: 8,
        params: {
          side: "long",
          signal_mode: "reversion",
          benchmark_manifest_path: benchmarkManifest,
          benchmark_return_max: -0.01,
          lookback_bars: 40,
          relative_threshold_atr: 0.5,
          stop_atr: 1,
          max_risk_atr: 3,
          reward_risk: 2,
        },
      }],
    })

    const candidate = report.candidates[0]
    assert.ok(candidate)
    assert.equal(candidate.params.signal_mode, "reversion")
    assert.ok(candidate.replay.sample_count > 0)
    const trade = candidate.replay.trades[0]
    assert.ok(trade)
    assert.ok(trade.meta)
    assert.equal(trade.reason, "rnd relative weakness reversion long")
    assert.ok((trade.meta.relative_atr as number) <= -0.5)
    assert.ok((trade.meta.benchmark_return as number) <= -0.01)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("relative weakness reversion can wait for a reversal close confirmation", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-relative-confirmation-"))
  try {
    const assetDir = join(dir, "asset")
    const benchmarkDir = join(dir, "benchmark")
    mkdirSync(assetDir)
    mkdirSync(benchmarkDir)
    const assetManifest = writeRelativeManifest(assetDir, "ALTUSDT", "strong-reversal")
    const benchmarkManifest = writeRelativeManifest(benchmarkDir, "BTCUSDT", "benchmark")
    const report = runStrategyRndBatch({
      manifestPath: assetManifest,
      timeframe: "4h",
      maxHoldBars: 8,
      candidates: [{
        candidateId: "C-REL-REVERSION-SHORT-RAW",
        family: "relative_weakness_momentum_v1",
        parameterCount: 8,
        params: {
          side: "short",
          signal_mode: "reversion",
          benchmark_manifest_path: benchmarkManifest,
          benchmark_return_min: 0.01,
          lookback_bars: 40,
          relative_threshold_atr: 0.5,
          stop_atr: 1,
          reward_risk: 2,
        },
      }, {
        candidateId: "C-REL-REVERSION-SHORT-CONFIRMED",
        family: "relative_weakness_momentum_v1",
        parameterCount: 8,
        params: {
          side: "short",
          signal_mode: "reversion",
          confirmation_mode: "reversal_close",
          benchmark_manifest_path: benchmarkManifest,
          benchmark_return_min: 0.01,
          lookback_bars: 40,
          relative_threshold_atr: 0.5,
          stop_atr: 1,
        },
      }],
    })

    const raw = report.candidates[0]
    const confirmed = report.candidates[1]
    assert.ok(raw)
    assert.ok(confirmed)
    assert.equal(confirmed.params.confirmation_mode, "reversal_close")
    assert.ok(raw.replay.sample_count > confirmed.replay.sample_count)
    assert.ok(confirmed.replay.sample_count > 0)
    const trade = confirmed.replay.trades[0]
    assert.ok(trade)
    assert.ok(trade.meta)
    assert.equal(trade.meta.confirmation_mode, "reversal_close")
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
    assert.equal((report.candidates[0].params.factor_conditions as Array<{ factor_id: string }>)[0].factor_id, "vpci.value")
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
    writeFileSync(reportPath, JSON.stringify({ data: { timeframes: { "4h": { feature_causality: {
      method: "provider_prefix_recompute_v1", status: "passed", coverage: "sampled",
      eligible_cutoffs: 899, checked_cutoffs: 200, factor_count: 1, comparison_count: 200,
      mismatch_count: 0, mismatch_examples_truncated: false, mismatches: [],
    }, features: {
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
    assert.equal(report.factor_research?.selection_scope.total_target_count, outcomes.size)
    assert.equal(report.factor_research?.profiles[0].sample_count, report.factor_research?.selection_scope.selected_target_count)
    assert.ok(Number(report.factor_research?.selection_scope.oos_target_count) > 0)
    assert.ok(Number(report.factor_research?.selection_scope.selected_target_count) < outcomes.size)
    assert.match(report.factor_research?.selection_identity_hash || "", /^[a-f0-9]{64}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D loop writes artifact and catalog ledger", () => {
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
    assert.equal(report.ledger_ref, join(artifactRoot, "data_catalog.db"))
    assert.equal(existsSync(resolveRepoPath(report.artifact_ref)), true)
    const ledgerRecords = loadRndLedger({ catalogDbPath: report.ledger_ref })
    assert.equal(ledgerRecords.length, 1)
    const record = ledgerRecords[0] as { run_id: string; artifact_ref: string; trial_count: number }
    assert.equal(record.run_id, "rnd-loop-test")
    assert.equal(record.artifact_ref, report.artifact_ref)
    assert.equal(record.trial_count, report.batch.trial_count)
    const artifact = JSON.parse(readFileSync(resolveRepoPath(report.artifact_ref), "utf8")) as { artifact_ref: string; ledger_ref: string; stop_reason: string }
    assert.equal(artifact.artifact_ref, report.artifact_ref)
    assert.equal(artifact.ledger_ref, report.ledger_ref)
    assert.equal(artifact.stop_reason, report.stop_reason)
    const catalog = new Database(join(artifactRoot, "data_catalog.db"))
    try {
      assert.equal((catalog.query("SELECT count(*) AS count FROM artifact").get() as { count: number }).count, 1)
      assert.equal((catalog.query("SELECT count(*) AS count FROM research_report WHERE report_kind='strategy_rnd_loop'").get() as { count: number }).count, 1)
      assert.equal((catalog.query("SELECT count(*) AS count FROM strategy_rnd_run WHERE run_id='rnd-loop-test'").get() as { count: number }).count, 1)
    } finally {
      catalog.close()
    }
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

test("strategy R&D loop can write back durable R&D program state", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-loop-state-"))
  try {
    const artifactRoot = join(dir, "artifacts")
    const stateRef = rdProgramRef("rd-loop-state")
    const catalogDbPath = join(artifactRoot, "data_catalog.db")
    writeRdProgramState(stateRef, createRdProgramState({
      programId: "rd-loop-state",
      objective: "learn from loop output",
      now: "2026-07-07T00:00:00.000Z",
      budget: { max_hypotheses: 3, max_trials_total: 9 },
    }))

    const report = runStrategyRndLoop({
      runId: "rnd-loop-state",
      batchId: "batch-loop-state",
      manifestPath: writeManifest(dir),
      artifactRoot,
      catalogDbPath,
      rdProgramRef: stateRef,
      candidates: [{ candidateId: "C-STATE", parameterCount: 1, params: { side: "long" } }],
      now: "2026-07-07T01:00:00.000Z",
    })

    assert.equal(report.rd_program_state?.action, "update")
    assert.equal(report.rd_program_state?.state.usage.hypotheses_run, 1)
    assert.equal(report.rd_program_state?.state.usage.trials_used, report.batch.trial_count)
    const state = readRdProgramState(stateRef)
    assert.equal(state.artifact_refs.includes(report.artifact_ref), true)
    assert.equal(state.latest_failure_summary?.primary_failure_area !== undefined, true)
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
    const artifactRoot = join(dir, "artifacts")
    const stateRef = rdProgramRef("rd-campaign-state")
    writeRdProgramState(stateRef, createRdProgramState({
      programId: "rd-campaign-state",
      objective: "learn from campaign output",
      now: "2026-07-07T00:00:00.000Z",
      budget: { max_hypotheses: 5, max_trials_total: 10 },
    }))
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
      artifactRoot,
      ledgerPath,
      rdProgramRef: stateRef,
      now: "2026-07-07T00:00:00.000Z",
      hypotheses: ["h1", "h2"].map((hypothesisId) => ({
        hypothesisId,
        thesisCertificate: thesisCertificate(),
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
    assert.equal(report.runs.every((run) => Boolean(run.discovery_failure_summary)), true)
    assert.equal(loadRndLedger({ catalogDbPath: report.ledger_ref }).length, 2)
    assert.equal(existsSync(resolveRepoPath(report.artifact_ref)), true)
    assert.equal(report.rd_program_state?.state.usage.hypotheses_run, 2)
    assert.equal(report.rd_program_state?.state.usage.trials_used, 2)
    assert.equal(readRdProgramState(stateRef).latest_failure_summary?.primary_failure_area !== undefined, true)
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
            { check_id: "CAL-NEGATIVE-CONTROL-NOT-BEATEN", severity: "blocker" },
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
        thesisCertificate: thesisCertificate(),
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
    assert.equal(existsSync(resolveRepoPath(report.artifact_ref)), true)
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
        thesisCertificate: thesisCertificate(),
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

function writeFundingEventsReport(dir: string, firstTimestamp: number, lastTimestamp: number, value: number): string {
  const events = []
  for (let timestamp = firstTimestamp; timestamp <= lastTimestamp; timestamp += 8 * 60 * 60 * 1000) {
    events.push({ timestamp: new Date(timestamp).toISOString(), value })
  }
  const path = join(dir, "market-features.json")
  writeFileSync(path, JSON.stringify({ data: { market_events: { funding: events } } }))
  return path
}

function writeFundingEventsReportWithFeature(dir: string, firstTimestamp: number, lastTimestamp: number, fundingValue: number, factorValue: number): string {
  const events = []
  for (let timestamp = firstTimestamp; timestamp <= lastTimestamp; timestamp += 8 * 60 * 60 * 1000) {
    events.push({ timestamp: new Date(timestamp).toISOString(), value: fundingValue })
  }
  const path = join(dir, "market-features-with-factor.json")
  writeFileSync(path, JSON.stringify({
    data: {
      market_events: { funding: events },
      timeframes: {
        "4h": {
          features: {
            "vpci.value": {
              status: "ok",
              factor_id: "vpci.value",
              source_indicator: "vpci",
              output: "value",
              category: "volume",
              roles: ["confirmation", "filter"],
              allowed_transforms: ["level"],
              values: buildFeaturePoints(280, factorValue),
            },
          },
        },
      },
    },
  }))
  return path
}

function writeFundingEventsReportWithVfiChop(dir: string, firstTimestamp: number, lastTimestamp: number, fundingValue: number, vfiValue: number, chopinessValue: number): string {
  const events = []
  for (let timestamp = firstTimestamp; timestamp <= lastTimestamp; timestamp += 8 * 60 * 60 * 1000) {
    events.push({ timestamp: new Date(timestamp).toISOString(), value: fundingValue })
  }
  const path = join(dir, "market-features-with-vfi-chop.json")
  writeFileSync(path, JSON.stringify({
    data: {
      market_events: { funding: events },
      timeframes: {
        "4h": {
          features: {
            "vfi.value": {
              status: "ok",
              factor_id: "vfi.value",
              source_indicator: "vfi",
              output: "value",
              category: "volume",
              roles: ["confirmation", "filter"],
              allowed_transforms: ["level"],
              values: buildFeaturePoints(280, vfiValue),
            },
            "chopiness.value": {
              status: "ok",
              factor_id: "chopiness.value",
              source_indicator: "chopiness",
              output: "value",
              category: "volatility",
              roles: ["regime", "filter"],
              allowed_transforms: ["level"],
              values: buildFeaturePoints(280, chopinessValue),
            },
          },
        },
      },
    },
  }))
  return path
}

function thesisCertificate() {
  return {
    edgeType: "structural trend continuation",
    behavioralHypothesis: "late momentum buyers defend pullbacks after trend confirmation",
    marketParticipants: "trend followers and trapped countertrend liquidity",
    regime: "liquid perpetual markets with persistent directional drift",
    invalidation: "fails when pullbacks no longer hold above trend support",
    costSensitivity: "edge must survive fee, slippage, and funding stress",
    candidateUniverse: "trend pullback family with fixed long side parameters",
    negativeControls: ["side_flip", "entry_lag"],
  }
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

function writeRelativeManifest(dir: string, symbol: string, kind: "weak" | "benchmark" | "benchmark-weak" | "strong-reversal"): string {
  const candles: Array<{ open: number; high: number; low: number; close: number; volume: number }> = []
  let close = 100
  for (let index = 0; index < 280; index += 1) {
    const drift = relativeFixtureDrift(kind, index)
    const open = close
    close = close + drift
    candles.push({
      open: Number(open.toFixed(4)),
      high: Number((Math.max(open, close) + 0.8).toFixed(4)),
      low: Number((Math.min(open, close) - 0.8).toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: 1000 + index,
    })
  }
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
    symbol,
    timeframes: {
      "4h": {
        file: "4h.csv",
      },
    },
  }))
  return manifestPath
}

function relativeFixtureDrift(kind: "weak" | "benchmark" | "benchmark-weak" | "strong-reversal", index: number): number {
  if (kind === "benchmark") return 0.12
  if (kind === "benchmark-weak" && index >= 210) return -0.08
  if (kind === "strong-reversal") return index >= 210 && index % 8 === 0 ? -0.55 : 0.22
  return index < 210 ? 0.05 : -0.18
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function rdProgramRef(programId: string): string {
  return `research_state_store:rd_program/${programId}`
}
