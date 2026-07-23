import { Database } from "bun:sqlite"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { readFamilyEvaluationProtocol } from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
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
import {
  IDENTITY_HASH_POLICY_VERSION,
  hashIdentityPayload,
} from "../../../state-store/src/lib/research-identity-hash"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { seedDefaultResearchControlPlane } from "../../../state-store/src/lib/research-universe-default-seed"

export function writeReplayManifest(directory: string): string {
  const rows = ["date,timestamp,open,high,low,close,volume"]
  let close = 100
  for (let index = 0; index < 360; index += 1) {
    const open = close
    close += 0.2 + (index > 220 && index % 9 === 0 ? -2.5 : 0)
    const timestamp = 1_700_000_000_000 + index * 4 * 60 * 60 * 1_000
    rows.push([
      new Date(timestamp).toISOString(),
      timestamp,
      open.toFixed(4),
      (Math.max(open, close) + 0.5).toFixed(4),
      (Math.min(open, close) - 0.5).toFixed(4),
      close.toFixed(4),
      String(1_000 + index),
    ].join(","))
  }
  writeFileSync(join(directory, "4h.csv"), rows.join("\n"))
  const manifestPath = join(directory, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: { "4h": { file: "4h.csv" } },
  }))
  return manifestPath
}

export function seedControlPlaneExperiment(db: Database, now: string): void {
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, now)
  const candidate = {
    candidate_id: "candidate-1",
    candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    parameter_assignment_json: { lookback: 20 },
    candidate_ordinal: 1,
    created_at: now,
  }
  const groupWithoutHash = {
    trial_group_id: "group-1",
    hypothesis_scope_ref: "hypothesis-1",
    identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
    candidate_mode: "enumerated" as const,
    search_space_json: {
      schema_version: "trade-flow.rd-search-space.v1",
      candidates: 1,
    },
    selection_protocol_json: {
      schema_version: "trade-flow.rd-selection.v1",
      method: "predeclared",
    },
    max_trials: 1,
    trial_accounting_policy_version: "trade-flow.trial-accounting.v1",
    registered_at: now,
    created_at: now,
    candidates: [candidate],
  }
  const groupHash = trialGroupIdentityHash(groupWithoutHash)
  registerTrialGroup(db, { ...groupWithoutHash, group_hash: groupHash })
  const contract = experimentContract(groupHash)
  const contractHash = hashIdentityPayload(contract)
  appendProposalRevision(db, {
    proposal_id: "proposal-1",
    planner_run_id: "planner-1",
    proposal_kind: "experiment",
    revision: 1,
    proposal_hash: contractHash,
    identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
    proposal_json: contract,
    validation_status: "valid",
    validation_ref: `validator://${RESEARCH_CONTRACT_VALIDATOR_VERSION}/proposal-1`,
    created_at: now,
  })
  registerExperiment(db, {
    experiment_id: "experiment-1",
    proposal_id: "proposal-1",
    proposal_revision: 1,
    canonical_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    hypothesis_id: "hypothesis-1",
    code_family_id: "time_series_momentum_v1",
    trial_group_id: "group-1",
    trial_group_hash: groupHash,
    contract_hash: contractHash,
    identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
    contract_validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION,
    lifecycle_rule_version: RESEARCH_LIFECYCLE_RULE_VERSION,
    scope_policy_version: "trade-flow.rd-scope.v1",
    contract_json: contract,
    bootstrap_event_id: "event-register",
    bootstrap_idempotency_key: "event-key-register",
    registered_at: now,
  })
  applySystemTransition(db, {
    experiment_id: "experiment-1",
    expected_version: 1,
    trigger_type: "system",
    trigger_value: "pre_run_gate_passed",
    trigger_ref: "gate://passed",
    event_id: "event-discovery",
    idempotency_key: "event-key-discovery",
    created_at: now,
  })
  db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
}

function experimentContract(groupHash: string): Record<string, unknown> {
  const protocol = readFamilyEvaluationProtocol(
    "canonical:trend/time-series-trend/time-series-momentum",
  )
  if (!protocol) throw new Error("supervisor fixture evaluation protocol is missing")
  return {
    schema_version: "trade-flow.rd-experiment-contract.v3",
    canonical_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    code_family_id: "time_series_momentum_v1",
    implementation_version: "v1",
    contract_versions: {
      identity_hash_policy: IDENTITY_HASH_POLICY_VERSION,
      validator: RESEARCH_CONTRACT_VALIDATOR_VERSION,
      lifecycle_rule: RESEARCH_LIFECYCLE_RULE_VERSION,
      scope_policy: "trade-flow.rd-scope.v1",
    },
    hypothesis: { falsifiable_claim: "trend persists after costs" },
    economic_rationale: { why_exists: "slow positioning" },
    asset_universe_definition: {
      venue: "binance-usdm",
      selection_timestamp_rule: "point_in_time",
    },
    timeframe: { signal: "4h", execution: "4h" },
    sampling_and_alignment: { closed_candle_only: true },
    required_data: ["surface:ohlcv"],
    feature_definition: {},
    target_definition: {},
    forecast_definition: {},
    signal_definition: {},
    position_rule: {},
    portfolio_construction: {},
    risk_rule: {},
    execution_rule: {},
    transaction_cost_model: {},
    expected_holding_period: {},
    benchmark: {
      evaluation_protocol_ref: protocol.protocol_ref,
      evaluation_protocol_hash: protocol.protocol_hash,
      evaluation_owner_ref: protocol.evaluation_owner_ref,
      execution_profile: protocol.execution_profile,
    },
    validation_plan: {
      evaluation_protocol_ref: protocol.protocol_ref,
      evaluation_protocol_hash: protocol.protocol_hash,
    },
    rejection_criteria: ["fails after costs"],
    trial_group_ref: { trial_group_id: "group-1", group_hash: groupHash },
    candidate_registration: { candidate_ids: ["candidate-1"] },
    parent_experiment_id: null,
    random_seed: 1,
    code_commit_ref: "git://code",
    harness_commit_ref: "git://harness",
    data_snapshot_ref: "data://snapshot",
    assumptions_ref: "assumptions://v1",
    replay_execution_input: {
      supplemental_requirement_set_schema_version:
        "trade.rd-replay-supplemental-requirement-set.v1",
      supplemental_requirement_set_hash:
        "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
    },
  }
}
