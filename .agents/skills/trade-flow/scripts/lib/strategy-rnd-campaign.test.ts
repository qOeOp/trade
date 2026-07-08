import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import {
  ensureNonOverlappingManifests,
  readCalibrationGate,
  runStrategyRndCampaignWithDeps,
  type StrategyRndCampaignDeps,
} from "./strategy-rnd-campaign"

test("strategy R&D campaign gate reads calibration blockers", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-gate-"))
  try {
    const reportPath = join(dir, "calibration.json")
    writeFileSync(reportPath, JSON.stringify({
      ok: true,
      data: {
        calibrated: false,
        failure_analysis: {
          findings: [
            { check_id: "CAL-BLOCK", severity: "blocker" },
            { check_id: "CAL-WARN", severity: "warning" },
          ],
        },
      },
    }))

    const gate = readCalibrationGate(reportPath)
    assert.equal(gate.calibrated, false)
    assert.equal(gate.blocked, true)
    assert.equal(gate.blocker_count, 1)
    assert.deepEqual(gate.blocked_by, ["CAL-BLOCK"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign rejects overlapping discovery and validation manifests", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-overlap-helper-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1000, 2000)
    const validation = writeManifest(join(dir, "validation"), 1500, 2500)
    assert.throws(() => ensureNonOverlappingManifests(discovery, validation, "4h"), /manifests overlap/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign orchestrates discovery then locked validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-orchestration-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1000, 2000)
    const validation = writeManifest(join(dir, "validation"), 3000, 4000)
    const calls: string[] = []
    const deps: StrategyRndCampaignDeps = {
      resolveCandidateCount: () => 1,
      runLoop: (input) => {
        calls.push(input.runId || "")
        if (input.runId?.endsWith("-discovery")) {
          return {
            artifact_ref: join(dir, "discovery-artifact.json"),
            batch: {
              outcome: "candidate_found",
              trial_count: 1,
              winner: {
                candidate_id: "candidate-1",
                description: "candidate",
                family: "trend_pullback_v1",
                parameter_count: 1,
                params: { side: "long" },
                replay: {
                  assumptions: {
                    robustness: {
                      parameter_stability: { method: "fixture" },
                    },
                  },
                },
              },
            },
          }
        }
        assert.equal(input.antiOverfitStage, "locked_holdout")
        assert.equal(input.searchTrialCount, 1)
        assert.deepEqual(input.parameterStability, { method: "fixture" })
        return {
          artifact_ref: join(dir, "validation-artifact.json"),
          batch: {
            outcome: "candidate_found",
            trial_count: 1,
            winner: {
              candidate_id: "candidate-1-external-validation",
              description: "validated",
              family: "trend_pullback_v1",
              parameter_count: 1,
              params: { side: "long" },
              replay: {},
            },
          },
        }
      },
    }

    const report = runStrategyRndCampaignWithDeps({
      campaignId: "campaign-fixture",
      artifactRoot: join(dir, "artifacts"),
      ledgerPath: join(dir, "ledger.jsonl"),
      now: "2026-07-08T12:00:00Z",
      hypotheses: [{
        hypothesisId: "h1",
        manifestPath: discovery,
        validationManifestPath: validation,
        candidates: [{ candidateId: "candidate-1" }],
      }],
    }, deps)

    assert.deepEqual(calls, ["campaign-fixture-h1-discovery", "campaign-fixture-h1-validation"])
    assert.equal(report.stop_reason, "validated_candidate_found")
    assert.equal(report.outcome, "validated_candidate_found")
    assert.equal(report.holdout_evaluations, 1)
    assert.equal(report.validated_candidate?.candidate_id, "candidate-1-external-validation")
    assert.equal(existsSync(report.artifact_ref), true)
    const artifact = JSON.parse(readFileSync(report.artifact_ref, "utf8")) as { campaign_id: string }
    assert.equal(artifact.campaign_id, "campaign-fixture")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign stops before exceeding trial budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-budget-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1000, 2000)
    const validation = writeManifest(join(dir, "validation"), 3000, 4000)
    let loopCalls = 0
    const report = runStrategyRndCampaignWithDeps({
      campaignId: "campaign-budget",
      maxTotalTrials: 1,
      artifactRoot: join(dir, "artifacts"),
      hypotheses: [{
        hypothesisId: "h1",
        manifestPath: discovery,
        validationManifestPath: validation,
        candidates: [{ candidateId: "candidate-1" }],
      }],
    }, {
      resolveCandidateCount: () => 2,
      runLoop: () => {
        loopCalls += 1
        throw new Error("should not run")
      },
    })

    assert.equal(loopCalls, 0)
    assert.equal(report.stop_reason, "trial_budget_exhausted")
    assert.equal(report.hypotheses_run, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeManifest(dir: string, first: number, last: number): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "4h.csv"), [
    "timestamp,open_time,open,high,low,close,volume",
    `2026-07-08T00:00:00Z,${first},100,101,99,100.5,1000`,
    `2026-07-08T04:00:00Z,${last},100.5,102,100,101,1000`,
  ].join("\n"))
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 1,
    symbol: "BTCUSDT",
    exchange: "binance-usdm",
    closed_candles_only: true,
    columns: ["timestamp", "open_time", "open", "high", "low", "close", "volume"],
    source: { provider: "fixture", market: "usdm" },
    timeframes: {
      "4h": {
        file: "4h.csv",
        first_open_ts: first,
        last_open_ts: last,
      },
    },
  }))
  return manifestPath
}
