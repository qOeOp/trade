import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import {
  ensureNonOverlappingManifests,
  readCalibrationGate,
  readHypothesisCertificateGate,
  readPanelNegativeControlGate,
  runStrategyRndCampaignWithDeps,
  type StrategyRndCampaignDeps,
} from "../../../rd-campaign-runner/src/lib/rd-campaign-runner"
import { resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"

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

test("strategy R&D campaign rejects validation without locked holdout embargo", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-embargo-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1_000_000, 2_000_000)
    const validation = writeManifest(join(dir, "validation"), 3_000_000, 4_000_000)
    assert.throws(
      () => runStrategyRndCampaignWithDeps({
        campaignId: "campaign-embargo",
        artifactRoot: join(dir, "artifacts"),
        hypotheses: [{
          hypothesisId: "h1",
          thesisCertificate: thesisCertificate(),
          manifestPath: discovery,
          validationManifestPath: validation,
          candidates: [{ candidateId: "candidate-1" }],
        }],
      }, {
        resolveCandidateCount: () => 1,
        runLoop: () => {
          throw new Error("should not run")
        },
      }),
      /holdout embargo/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign reports missing discovery manifest explicitly", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-missing-discovery-"))
  try {
    const validation = writeManifest(join(dir, "validation"), 300_000_000, 320_000_000)
    assert.throws(
      () => runStrategyRndCampaignWithDeps({
        campaignId: "campaign-missing-discovery",
        artifactRoot: join(dir, "artifacts"),
        hypotheses: [{
          hypothesisId: "h1",
          thesisCertificate: thesisCertificate(),
          manifestPath: "",
          validationManifestPath: validation,
          candidates: [{ candidateId: "candidate-1" }],
        }],
      }, {
        resolveCandidateCount: () => 1,
        runLoop: () => {
          throw new Error("should not run")
        },
      }),
      /requires discovery_manifest_path/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign stops with zero trials when thesis certificate is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-certificate-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1_000_000, 2_000_000)
    const validation = writeManifest(join(dir, "validation"), 300_000_000, 320_000_000)
    const report = runStrategyRndCampaignWithDeps({
      campaignId: "campaign-missing-certificate",
      artifactRoot: join(dir, "artifacts"),
      hypotheses: [{
        hypothesisId: "h1",
        manifestPath: discovery,
        validationManifestPath: validation,
        candidates: [{ candidateId: "candidate-1" }],
      }],
    }, {
      resolveCandidateCount: () => {
        throw new Error("should not count trials")
      },
      runLoop: () => {
        throw new Error("should not run")
      },
    })

    assert.equal(report.stop_reason, "hypothesis_certificate_failed")
    assert.equal(report.trials_used, 0)
    assert.equal(report.hypotheses_run, 0)
    assert.deepEqual(report.hypothesis_certificates[0].blocked_by, ["RND-HYPOTHESIS-CERTIFICATE-MISSING"])
    assert.equal(readHypothesisCertificateGate({ hypothesisId: "h2", manifestPath: discovery, validationManifestPath: validation, candidates: [] }).accepted, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign orchestrates discovery then external validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-orchestration-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1_000_000, 2_000_000)
    const validation = writeManifest(join(dir, "validation"), 300_000_000, 320_000_000)
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
              failure_summary: { primary_failure_area: "none" },
              reliability_gate: { status: "candidate_ready" },
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
        assert.equal(input.antiOverfitStage, "external_validation")
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
        thesisCertificate: thesisCertificate(),
        manifestPath: discovery,
        validationManifestPath: validation,
        candidates: [{ candidateId: "candidate-1" }],
      }],
    }, deps)

    assert.deepEqual(calls, ["campaign-fixture-h1-discovery", "campaign-fixture-h1-validation"])
    assert.equal(report.stop_reason, "validated_candidate_found")
    assert.equal(report.outcome, "validated_candidate_found")
    assert.equal(report.validation_evaluations, 1)
    assert.equal(report.holdout_evaluations, 0)
    assert.equal(report.validated_candidate?.candidate_id, "candidate-1-external-validation")
    assert.deepEqual(report.runs[0].discovery_failure_summary, { primary_failure_area: "none" })
    assert.deepEqual(report.runs[0].discovery_reliability_gate, { status: "candidate_ready" })
    assert.equal(existsSync(resolveRepoPath(report.artifact_ref)), true)
    assert.equal(existsSync(resolveRepoPath(report.dossier_ref)), true)
    const artifact = JSON.parse(readFileSync(resolveRepoPath(report.artifact_ref), "utf8")) as { campaign_id: string }
    assert.equal(artifact.campaign_id, "campaign-fixture")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign blocks validation when panel negative control fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-panel-negative-control-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1_000_000, 2_000_000)
    const validation = writeManifest(join(dir, "validation"), 300_000_000, 320_000_000)
    const panelReportPath = join(dir, "panel.json")
    writeFileSync(panelReportPath, JSON.stringify({
      panel_id: "panel-fixture",
      candidates: [{
        candidate_id: "candidate-1",
        panel_negative_controls: {
          method: "cross_candidate_asset_shuffle_v1",
          status: "evaluated",
          passed: false,
        },
        gate: {
          accepted: false,
          blocked_by: [{ check_id: "PANEL-ASSET-SHUFFLE" }],
        },
      }],
    }))
    const calls: string[] = []
    const report = runStrategyRndCampaignWithDeps({
      campaignId: "campaign-panel-negative-control",
      panelReportPath,
      artifactRoot: join(dir, "artifacts"),
      hypotheses: [{
        hypothesisId: "h1",
        thesisCertificate: thesisCertificate(),
        manifestPath: discovery,
        validationManifestPath: validation,
        candidates: [{ candidateId: "candidate-1" }],
      }],
    }, {
      resolveCandidateCount: () => 1,
      runLoop: (input) => {
        calls.push(input.runId || "")
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
              replay: {},
            },
          },
        }
      },
    })

    assert.deepEqual(calls, ["campaign-panel-negative-control-h1-discovery"])
    assert.equal(report.stop_reason, "panel_negative_control_failed")
    assert.equal(report.outcome, "no_validated_candidate")
    assert.equal(report.holdout_evaluations, 0)
    assert.equal(report.runs[0].validation_run_ref, null)
    assert.deepEqual((report.runs[0].panel_negative_control_gate as { blocked_by: string[] }).blocked_by, ["PANEL-ASSET-SHUFFLE"])
    assert.equal(readPanelNegativeControlGate(panelReportPath, "candidate-1-external-validation").blocked, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D campaign stops before exceeding trial budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-campaign-budget-"))
  try {
    const discovery = writeManifest(join(dir, "discovery"), 1_000_000, 2_000_000)
    const validation = writeManifest(join(dir, "validation"), 300_000_000, 320_000_000)
    let loopCalls = 0
    const report = runStrategyRndCampaignWithDeps({
      campaignId: "campaign-budget",
      maxTotalTrials: 1,
      artifactRoot: join(dir, "artifacts"),
      hypotheses: [{
        hypothesisId: "h1",
        thesisCertificate: thesisCertificate(),
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
