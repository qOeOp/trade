import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashIdentityPayload } from "../../../contracts/src/lib/research-identity-hash"
import { compileDraftStrategyInput } from "./draft-strategy-compiler"
import { materializeDraftStrategy } from "./strategy-registry"
import {
  publishStrategySourceCandidate,
} from "./strategy-source-candidate"
import {
  assertStrategySourceCandidate,
  type StrategySourceCandidate,
} from "../../../contracts/src/lib/strategy-source-candidate-contract"

const CONTRACT_HASH = "a".repeat(64)
const GROUP_HASH = "b".repeat(64)
const RESULT_HASH = "c".repeat(64)
const BUILD_HASH = "d".repeat(64)
const EXECUTABLE_HASH = "e".repeat(64)
const PROVENANCE_HASH = "f".repeat(64)
const AGENT_REQUEST_HASH = "1".repeat(64)
const AGENT_RESULT_HASH = "2".repeat(64)
const PARAMS = {
  lookback_bars: 20,
  reward_risk: 2,
  side: "long",
  stop_atr: 1,
}

test("Registry compiler derives one Draft solely from accepted owner facts", () => {
  const db = fixture()
  const root = mkdtempSync(join(tmpdir(), "rd-registry-compiler-"))
  try {
    const strategyRoot = join(root, "strategies")
    const compiled = compileDraftStrategyInput(db, {
      decision_id: "decision-1",
      strategy_root: strategyRoot,
    })
    expect(compiled.authorization.primary_result_id).toBe("result-1")
    expect(compiled.authorization.selected_candidate_id).toBe("candidate-1")
    expect(compiled.policy_source.candidate.params).toEqual(PARAMS)
    expect(compiled.policy_source.objective).toBe(
      "Test a bounded closed-candle momentum mechanism.",
    )
    expect(compiled.policy_source.candidate.timeframe).toBe("4h")
    expect(compiled.source_revision).toBe("0123456789abcdef")
    expect(compiled.source_provenance_hash).toBe(PROVENANCE_HASH)
    expect(compiled.replay_code_evidence).toEqual({
      decision_harness_build_artifact_hash: BUILD_HASH,
      decision_harness_runtime_executable_hash: EXECUTABLE_HASH,
    })
    const binding = materializeDraftStrategy(db, compiled)
    expect(binding.materialization_status).toBe("ready")
    expect(readFileSync(binding.strategy_ref, "utf8")).toContain(
      "family: time_series_momentum_v1",
    )
    expect(materializeDraftStrategy(
      db,
      compileDraftStrategyInput(db, {
        decision_id: "decision-1",
        strategy_root: strategyRoot,
      }),
    )).toEqual(binding)
    const candidate = publishStrategySourceCandidate({
      decision_root: root,
      compiled,
      binding,
    })
    expect(candidate.manifest.strategy_source.ref).toBe(
      `strategies/${binding.strategy_ref.split("/").at(-1)}`,
    )
    expect(candidate.manifest.strategy_source.sha256).toBe(
      binding.strategy_policy_hash,
    )
    expect(candidate.manifest.authority).toEqual({
      release_authority: "candidate_source_only",
      deployment_authority: "none",
      trading_authority: false,
    })
    expect(() => assertStrategySourceCandidate(candidate.manifest)).not.toThrow()
    const persisted = JSON.parse(
      readFileSync(candidate.manifest_ref, "utf8"),
    ) as StrategySourceCandidate
    expect(persisted).toEqual(candidate.manifest)
    expect(publishStrategySourceCandidate({
      decision_root: root,
      compiled,
      binding,
    })).toEqual(candidate)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("Registry compiler rejects selected Candidate and Replay fingerprint drift", () => {
  const candidateDrift = fixture()
  try {
    candidateDrift.query(`
      UPDATE rd_trial_group_candidate
      SET parameter_assignment_json='{"lookback_bars":40}'
    `).run()
    expect(() => compileDraftStrategyInput(candidateDrift, {
      decision_id: "decision-1",
      strategy_root: "tmp/strategies",
    })).toThrow("parameter identity drifted")
  } finally {
    candidateDrift.close()
  }
  const replayDrift = fixture()
  try {
    replayDrift.query(`
      UPDATE rd_experiment_result
      SET summary_json=json_set(summary_json, '$.result.fingerprint.candidate_hash', $hash)
    `).run({ $hash: "d".repeat(64) })
    expect(() => compileDraftStrategyInput(replayDrift, {
      decision_id: "decision-1",
      strategy_root: "tmp/strategies",
    })).toThrow("fingerprint drifted")
  } finally {
    replayDrift.close()
  }
})

function fixture(): Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE rd_review_decision(
      decision_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      reviewer_run_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale_ref TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE rd_review_decision_result(
      decision_id TEXT NOT NULL,
      result_id TEXT NOT NULL,
      evidence_role TEXT NOT NULL
    );
    CREATE TABLE rd_experiment_contract(
      experiment_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      proposal_revision INTEGER NOT NULL,
      hypothesis_id TEXT NOT NULL,
      code_family_id TEXT NOT NULL,
      trial_group_id TEXT NOT NULL,
      trial_group_hash TEXT NOT NULL,
      contract_hash TEXT NOT NULL,
      identity_hash_policy_version TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      selected_candidate_id TEXT,
      selected_trial_id TEXT,
      candidate_hash TEXT,
      candidate_frozen_at TEXT
    );
    CREATE TABLE rd_experiment_result(
      result_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      trial_id TEXT,
      run_id TEXT NOT NULL,
      artifact_ref TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );
    CREATE TABLE rd_trial_group_candidate(
      trial_group_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_identity_hash TEXT NOT NULL,
      parameter_assignment_json TEXT NOT NULL
    );
    CREATE TABLE rd_planner_proposal_revision(
      proposal_id TEXT NOT NULL,
      proposal_revision INTEGER NOT NULL,
      submission_json TEXT NOT NULL
    );
    CREATE TABLE rd_replay_request_registration(
      trial_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      replay_request_json TEXT NOT NULL
    );
    CREATE TABLE rd_developer_contract_freeze(
      validation_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL
    );
    CREATE TABLE rd_developer_contract_draft_validation(
      validation_id TEXT NOT NULL,
      brief_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL
    );
    CREATE TABLE rd_developer_contract_draft(
      brief_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      developer_run_id TEXT NOT NULL
    );
    CREATE TABLE rd_developer_agent_draft_provenance(
      brief_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      developer_run_id TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      provenance_hash TEXT NOT NULL,
      agent_run_request_hash TEXT NOT NULL,
      agent_run_result_hash TEXT NOT NULL
    );
  `)
  const candidateHash = hashIdentityPayload(PARAMS)
  db.query(`
    INSERT INTO rd_review_decision VALUES (
      'decision-1', 'experiment-1', 'reviewer-1', 'accept_for_draft',
      'agent-artifact://reviewer-1', '2026-07-23T01:00:00.000Z'
    )
  `).run()
  db.query(`
    INSERT INTO rd_review_decision_result VALUES (
      'decision-1', 'result-1', 'primary'
    )
  `).run()
  db.query(`
    INSERT INTO rd_experiment_contract VALUES (
      'experiment-1', 'proposal-1', 1, 'hypothesis-1',
      'time_series_momentum_v1', 'group-1', $group_hash, $contract_hash,
      'trade-flow.identity-hash.v1', 'draft_frozen',
      'candidate-1', 'trial-1', $candidate_hash, '2026-07-23T01:00:00.000Z'
    )
  `).run({
    $group_hash: GROUP_HASH,
    $contract_hash: CONTRACT_HASH,
    $candidate_hash: candidateHash,
  })
  db.query(`
    INSERT INTO rd_experiment_result VALUES (
      'result-1', 'experiment-1', 'trial-1', 'run-1',
      'artifact://formal-result-1', $summary
    )
  `).run({
    $summary: JSON.stringify({
      result: {
        status: "completed",
        fingerprint: {
          result_hash: RESULT_HASH,
          candidate_hash: candidateHash,
          experiment_contract_hash: CONTRACT_HASH,
          decision_harness_build_artifact_hash: BUILD_HASH,
          decision_harness_runtime_executable_hash: EXECUTABLE_HASH,
        },
      },
    }),
  })
  db.query(`
    INSERT INTO rd_trial_group_candidate VALUES (
      'group-1', 'candidate-1', $candidate_hash, $parameters
    )
  `).run({
    $candidate_hash: candidateHash,
    $parameters: JSON.stringify(PARAMS),
  })
  db.query(`
    INSERT INTO rd_planner_proposal_revision VALUES (
      'proposal-1', 1, $proposal
    )
  `).run({
    $proposal: JSON.stringify({
      proposal_id: "proposal-1",
      hypothesis_id: "hypothesis-1",
      objective: "Test a bounded closed-candle momentum mechanism.",
    }),
  })
  db.query(`
    INSERT INTO rd_replay_request_registration VALUES (
      'trial-1', 'run-1', $request
    )
  `).run({
    $request: JSON.stringify({
      experiment_id: "experiment-1",
      trial_id: "trial-1",
      candidate_id: "candidate-1",
      timeframe: "4h",
    }),
  })
  db.query(`
    INSERT INTO rd_developer_contract_freeze VALUES (
      'validation-1', 'experiment-1'
    )
  `).run()
  db.query(`
    INSERT INTO rd_developer_contract_draft_validation VALUES (
      'validation-1', 'brief-1', 1
    )
  `).run()
  db.query(`
    INSERT INTO rd_developer_contract_draft VALUES (
      'brief-1', 1, 'developer-run-1'
    )
  `).run()
  db.query(`
    INSERT INTO rd_developer_agent_draft_provenance VALUES (
      'brief-1', 1, 'developer-run-1', '0123456789abcdef',
      $provenance_hash, $agent_request_hash, $agent_result_hash
    )
  `).run({
    $provenance_hash: PROVENANCE_HASH,
    $agent_request_hash: AGENT_REQUEST_HASH,
    $agent_result_hash: AGENT_RESULT_HASH,
  })
  return db
}
