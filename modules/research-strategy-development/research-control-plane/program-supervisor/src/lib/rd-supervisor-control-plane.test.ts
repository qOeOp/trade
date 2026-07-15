import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { executePlannedResearchWithControlPlane } from "./rd-supervisor-runner"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { seedDefaultResearchControlPlane } from "../../../state-store/src/lib/research-universe-default-seed"
import {
  appendProposalRevision,
  candidateIdentityHash,
  registerExperiment,
  registerTrialGroup,
  trialGroupIdentityHash,
} from "../../../state-store/src/lib/research-control-plane"
import { applySystemTransition } from "../../../state-store/src/lib/research-control-plane-operations"
import { RESEARCH_LIFECYCLE_RULE_VERSION } from "../../../state-store/src/lib/research-control-plane-schema"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION } from "../../../state-store/src/lib/research-contract-validator"
import { IDENTITY_HASH_POLICY_VERSION, hashIdentityPayload } from "../../../state-store/src/lib/research-identity-hash"

const NOW = "2026-07-14T07:00:00Z"

test("supervisor reserves Trial and publishes immutable Result around Replay execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-control-boundary-"))
  const dbPath = join(dir, "rd.db")
  const db = new Database(dbPath)
  try {
    seedExperiment(db)
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

function seedExperiment(db: Database): void {
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, NOW)
  const candidate = {
    candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    parameter_assignment_json: { lookback: 20 }, candidate_ordinal: 1, created_at: NOW,
  }
  const groupWithoutHash = {
    trial_group_id: "group-1", hypothesis_scope_ref: "hypothesis-1",
    identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION, candidate_mode: "enumerated" as const,
    search_space_json: { schema_version: "trade-flow.rd-search-space.v1", candidates: 1 },
    selection_protocol_json: { schema_version: "trade-flow.rd-selection.v1", method: "predeclared" },
    max_trials: 1, trial_accounting_policy_version: "trade-flow.trial-accounting.v1",
    registered_at: NOW, created_at: NOW, candidates: [candidate],
  }
  const groupHash = trialGroupIdentityHash(groupWithoutHash)
  registerTrialGroup(db, { ...groupWithoutHash, group_hash: groupHash })
  const contract = experimentContract(groupHash)
  const contractHash = hashIdentityPayload(contract)
  appendProposalRevision(db, {
    proposal_id: "proposal-1", planner_run_id: "planner-1", proposal_kind: "experiment",
    revision: 1, proposal_hash: contractHash, identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
    proposal_json: contract, validation_status: "valid",
    validation_ref: `validator://${RESEARCH_CONTRACT_VALIDATOR_VERSION}/proposal-1`, created_at: NOW,
  })
  registerExperiment(db, {
    experiment_id: "experiment-1", proposal_id: "proposal-1", proposal_revision: 1,
    canonical_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    hypothesis_id: "hypothesis-1", code_family_id: "time_series_momentum_v1",
    trial_group_id: "group-1", trial_group_hash: groupHash, contract_hash: contractHash,
    identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
    contract_validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION,
    lifecycle_rule_version: RESEARCH_LIFECYCLE_RULE_VERSION, scope_policy_version: "trade-flow.rd-scope.v1",
    contract_json: contract, bootstrap_event_id: "event-register", bootstrap_idempotency_key: "event-key-register",
    registered_at: NOW,
  })
  applySystemTransition(db, {
    experiment_id: "experiment-1", expected_version: 1, trigger_type: "system",
    trigger_value: "pre_run_gate_passed", trigger_ref: "gate://passed",
    event_id: "event-discovery", idempotency_key: "event-key-discovery", created_at: NOW,
  })
  db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
}

function experimentContract(groupHash: string): Record<string, unknown> {
  return {
    schema_version: "trade-flow.rd-experiment-contract.v3",
    canonical_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    code_family_id: "time_series_momentum_v1", implementation_version: "v1",
    contract_versions: {
      identity_hash_policy: IDENTITY_HASH_POLICY_VERSION, validator: RESEARCH_CONTRACT_VALIDATOR_VERSION,
      lifecycle_rule: RESEARCH_LIFECYCLE_RULE_VERSION, scope_policy: "trade-flow.rd-scope.v1",
    },
    hypothesis: { falsifiable_claim: "trend persists after costs" },
    economic_rationale: { why_exists: "slow positioning" },
    asset_universe_definition: { venue: "binance-usdm", selection_timestamp_rule: "point_in_time" },
    timeframe: { signal: "4h", execution: "4h" }, sampling_and_alignment: { closed_candle_only: true },
    required_data: ["surface:ohlcv"], feature_definition: {}, target_definition: {},
    forecast_definition: {}, signal_definition: {}, position_rule: {}, portfolio_construction: {},
    risk_rule: {}, execution_rule: {}, transaction_cost_model: {}, expected_holding_period: {},
    benchmark: {}, validation_plan: {}, rejection_criteria: ["fails after costs"],
    trial_group_ref: { trial_group_id: "group-1", group_hash: groupHash },
    candidate_registration: { candidate_ids: ["candidate-1"] }, parent_experiment_id: null,
    random_seed: 1, code_commit_ref: "git://code", harness_commit_ref: "git://harness",
    data_snapshot_ref: "data://snapshot", assumptions_ref: "assumptions://v1",
    replay_execution_input: {
      supplemental_requirement_set_schema_version: "trade.rd-replay-supplemental-requirement-set.v1",
      supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
    },
  }
}
