import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { executePlannedResearchWithControlPlane } from "./rd-supervisor-runner"
import { candidateIdentityHash } from "../../../state-store/src/lib/research-control-plane"
import { IDENTITY_HASH_POLICY_VERSION } from "../../../state-store/src/lib/research-identity-hash"
import { runStrategyRndLoop } from "../../../../agent-roles/developer/rd-loop-runner/src/lib/rd-loop-runner"
import { strategyRndLoopInputFromJson } from "../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-inputs"
import { assertExactCompatibilityEvaluationResult } from "./compatibility-evaluation-runner"
import type { ExperimentEvaluationWorkPackage } from "../../../contracts/src/lib/experiment-evaluation-work-package"
import {
  seedControlPlaneExperiment,
  writeReplayManifest,
} from "../test-support/rd-supervisor-control-plane-fixture"

const NOW = "2026-07-14T07:00:00Z"

test("compatibility evaluation artifact binds the exact deployment environment", () => {
  const work = {
    batch_run_id: "batch-run-1",
    package_id: "package-1",
    trial_count: 1,
    trials: [{ evaluation_candidate_id: "evaluation-candidate-1" }],
    data_snapshot_binding: {
      manifest_ref: "tmp/discovery/manifest.json",
      timeframe: "4h",
    },
    evaluation_policy: {
      max_hold_bars: 18,
      fee_bps: 2,
      slippage_bps: 1,
      adverse_funding_bps_per_8h: 1,
      oos_split_ratio: 0.3,
    },
  } as unknown as ExperimentEvaluationWorkPackage
  const result = {
    run_id: "batch-run-1",
    batch: {
      batch_id: "package-1",
      trial_count: 1,
      candidates: [{ candidate_id: "evaluation-candidate-1" }],
    },
    input: {
      environment_id: "test:exact-evaluation",
      manifest_path: "tmp/discovery/manifest.json",
      timeframe: "4h",
      max_hold_bars: 18,
      fee_bps: 2,
      slippage_bps: 1,
      funding_bps_per_8h: 1,
      oos_split: 0.3,
      search_trial_count: 1,
    },
  }

  assert.doesNotThrow(() =>
    assertExactCompatibilityEvaluationResult(work, result, "test:exact-evaluation"))
  assert.throws(
    () => assertExactCompatibilityEvaluationResult(work, result, "test:other-evaluation"),
    /input drifted/,
  )
})

test("supervisor reserves Trial and publishes immutable Result around Replay execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-control-boundary-"))
  const dbPath = join(dir, "rd.db")
  const db = new Database(dbPath)
  try {
    seedControlPlaneExperiment(db, NOW)
    db.close()
    const result = executePlannedResearchWithControlPlane("research.rd-loop-runner", {
      now: NOW,
      control_plane: {
        experiment_id: "experiment-1", trial_group_id: "group-1", run_id: "run-1",
        result_id: "result-1", result_idempotency_key: "result-key-1",
        stage_id: "historical_validation", result_type_id: "replay", completed_at: NOW,
        trials: [{
          trial_id: "trial-1", trial_group_id: "group-1", experiment_id: "experiment-1",
          trial_ordinal: 1, candidate_id: "candidate-1",
          candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
          identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
          run_id: "run-1", idempotency_key: "trial-key-1", created_at: NOW,
        }],
      },
    }, {
      runLoop: () => ({
        run_id: "run-1", artifact_ref: "artifact://replay/result-1",
        evidence_fingerprint_json: {
          policy_hash: "policy", harness_hash: "harness", data_hash: "data",
          assumptions_hash: "assumptions", temporal_contract: "closed-candle",
        },
        outcome: "no_promote",
      }),
      runCampaign: () => { throw new Error("campaign should not run") },
    }, dbPath)
    assert.equal(result.artifact_ref, "artifact://replay/result-1")
    const verify = new Database(dbPath, { readonly: true })
    try {
      assert.equal((verify.query("SELECT status FROM rd_trial WHERE trial_id='trial-1'").get() as { status: string }).status, "completed")
      assert.equal((verify.query("SELECT artifact_ref FROM rd_experiment_result WHERE result_id='result-1'").get() as { artifact_ref: string }).artifact_ref, "artifact://replay/result-1")
      assert.equal((verify.query("SELECT COUNT(*) AS count FROM rd_knowledge_edge WHERE edge_type='produces'").get() as { count: number }).count, 1)
    } finally {
      verify.close()
    }
  } finally {
    try { db.close() } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

test("supervisor derives aggregate evidence fingerprint from real-shaped nested Replay provenance", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-control-fingerprint-"))
  const dbPath = join(dir, "rd.db")
  const artifactPath = join(dir, "result.json")
  const db = new Database(dbPath)
  try {
    seedControlPlaneExperiment(db, NOW)
    db.close()
    const replayResult = {
      run_id: "run-1",
      artifact_ref: artifactPath,
      stop_reason: "no_promote",
      batch: {
        candidates: [{
          candidate_id: "candidate-1",
          replay: {
            provenance: {
              harness_hash: "harness-real",
              data_hash: "data-real",
              assumptions_hash: "assumptions-real",
              temporal_contract: { method: "closed_candle_replay_v1", closed_candle_only: true },
            },
          },
        }],
      },
    }
    writeFileSync(artifactPath, JSON.stringify(replayResult))
    executePlannedResearchWithControlPlane("research.rd-loop-runner", {
      now: NOW,
      control_plane: controlBoundary(),
    }, {
      runLoop: () => replayResult,
      runCampaign: () => { throw new Error("campaign should not run") },
    }, dbPath)

    const verify = new Database(dbPath, { readonly: true })
    try {
      const row = verify.query("SELECT evidence_fingerprint_json FROM rd_experiment_result WHERE result_id='result-1'").get() as { evidence_fingerprint_json: string }
      const fingerprint = JSON.parse(row.evidence_fingerprint_json) as Record<string, unknown>
      assert.equal(fingerprint.schema_version, "trade-flow.rd-aggregate-evidence-fingerprint.v1")
      assert.equal(fingerprint.replay_component_count, 1)
      assert.match(String(fingerprint.artifact_content_hash), /^[a-f0-9]{64}$/)
      assert.match(String(fingerprint.identity_binding_hash), /^[a-f0-9]{64}$/)
    } finally {
      verify.close()
    }
  } finally {
    try { db.close() } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Result publication failure cannot leave a completed Trial without a Result", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-control-atomic-"))
  const dbPath = join(dir, "rd.db")
  const db = new Database(dbPath)
  try {
    seedControlPlaneExperiment(db, NOW)
    db.close()
    assert.throws(() => executePlannedResearchWithControlPlane("research.rd-loop-runner", {
      now: NOW,
      control_plane: controlBoundary({ run_id: "wrong-run" }),
    }, {
      runLoop: () => ({
        run_id: "wrong-run",
        artifact_ref: "artifact://replay/result-atomic",
        evidence_fingerprint_json: {
          policy_hash: "policy", harness_hash: "harness", data_hash: "data",
          assumptions_hash: "assumptions", temporal_contract: "closed-candle",
        },
      }),
      runCampaign: () => { throw new Error("campaign should not run") },
    }, dbPath), /matching completed Trial run/)

    const verify = new Database(dbPath, { readonly: true })
    try {
      assert.equal((verify.query("SELECT status FROM rd_trial WHERE trial_id='trial-1'").get() as { status: string }).status, "failed")
      assert.equal((verify.query("SELECT COUNT(*) AS count FROM rd_experiment_result").get() as { count: number }).count, 0)
    } finally {
      verify.close()
    }
  } finally {
    try { db.close() } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

test("real R&D loop publishes aggregate fingerprint and Result through Control Plane", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-control-real-loop-"))
  const dbPath = join(dir, "rd.db")
  const manifestPath = writeReplayManifest(dir)
  const db = new Database(dbPath)
  try {
    seedControlPlaneExperiment(db, NOW)
    db.close()
    const result = executePlannedResearchWithControlPlane("research.rd-loop-runner", {
      now: NOW,
      run_id: "run-1",
      batch_id: "batch-real-control-plane",
      manifest_path: manifestPath,
      artifact_root: join(dir, "artifacts"),
      catalog_db_path: join(dir, "catalog.db"),
      candidates: [{ candidate_id: "candidate-1", family: "trend_pullback_v1", params: { side: "long" } }],
      control_plane: controlBoundary(),
    }, {
      runLoop: (payload) => runStrategyRndLoop(strategyRndLoopInputFromJson(payload)) as unknown as Record<string, unknown>,
      runCampaign: () => { throw new Error("campaign should not run") },
    }, dbPath)
    assert.equal(result.run_id, "run-1")

    const verify = new Database(dbPath, { readonly: true })
    try {
      const row = verify.query("SELECT artifact_ref, evidence_fingerprint_json FROM rd_experiment_result WHERE result_id='result-1'").get() as {
        artifact_ref: string
        evidence_fingerprint_json: string
      }
      const fingerprint = JSON.parse(row.evidence_fingerprint_json) as Record<string, unknown>
      assert.equal(row.artifact_ref, result.artifact_ref)
      assert.equal(fingerprint.schema_version, "trade-flow.rd-aggregate-evidence-fingerprint.v1")
      assert.ok(Number(fingerprint.replay_component_count) >= 1)
      assert.match(String(fingerprint.artifact_content_hash), /^[a-f0-9]{64}$/)
      assert.equal((verify.query("SELECT status FROM rd_trial WHERE trial_id='trial-1'").get() as { status: string }).status, "completed")
    } finally {
      verify.close()
    }
  } finally {
    try { db.close() } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

function controlBoundary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    experiment_id: "experiment-1", trial_group_id: "group-1", run_id: "run-1",
    result_id: "result-1", result_idempotency_key: "result-key-1",
    stage_id: "historical_validation", result_type_id: "replay", completed_at: NOW,
    trials: [{
      trial_id: "trial-1", trial_group_id: "group-1", experiment_id: "experiment-1",
      trial_ordinal: 1, candidate_id: "candidate-1",
      candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
      identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
      run_id: "run-1", idempotency_key: "trial-key-1", created_at: NOW,
    }],
    ...overrides,
  }
}
