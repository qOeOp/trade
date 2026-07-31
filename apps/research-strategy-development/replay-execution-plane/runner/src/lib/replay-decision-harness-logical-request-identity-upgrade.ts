import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  createReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  createReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry,
  deriveReplayDecisionHarnessLogicalRequestId,
  type ReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  type ReplayDecisionHarnessLogicalRequestIdentityUpgradeBody,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessInvocationIdentitySet,
  type ReplayDecisionHarnessInvocationIdentitySet,
} from "../../../contracts/src/lib/replay-decision-harness-invocation-identity"

export interface ReplayDecisionHarnessLogicalRequestIdentityUpgradeInput {
  source_invocation_identity_set: ReplayDecisionHarnessInvocationIdentitySet
}

export function buildReplayDecisionHarnessLogicalRequestIdentityUpgrade(
  input: ReplayDecisionHarnessLogicalRequestIdentityUpgradeInput,
): ReplayDecisionHarnessLogicalRequestIdentityUpgrade {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...bodyWithoutId,
    upgrade_id: `decision-harness-logical-request-upgrade-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessLogicalRequestIdentityUpgradeLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessLogicalRequestIdentityUpgradeLineage(
  value: ReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  input: ReplayDecisionHarnessLogicalRequestIdentityUpgradeInput,
): void {
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...bodyWithoutId,
    upgrade_id: `decision-harness-logical-request-upgrade-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness logical request identity upgrade parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessLogicalRequestIdentityUpgradeInput,
): Omit<ReplayDecisionHarnessLogicalRequestIdentityUpgradeBody, "upgrade_id"> {
  assertReplayDecisionHarnessInvocationIdentitySet(input.source_invocation_identity_set)
  const source = input.source_invocation_identity_set
  const entries = source.entries.map((sourceEntry) => createReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry({
    schema_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_ENTRY_SCHEMA_VERSION,
    decision_sequence: sourceEntry.decision_sequence,
    decision_time: sourceEntry.decision_time,
    decision_phase: sourceEntry.decision_phase,
    source_invocation_identity_entry_hash: sourceEntry.entry_hash,
    legacy_v9_invocation_id: sourceEntry.invocation_id,
    legacy_identity_status: "compatibility_alias_not_target_authority",
    run_id: source.run_id,
    code_admission_hash: source.code_admission_hash,
    source_bundle_hash: sourceEntry.source_bundle_hash,
    artifact_hash: sourceEntry.artifact_hash,
    request_context_hash: sourceEntry.request_context_hash,
    decision_input_snapshot_hash: sourceEntry.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: sourceEntry.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: sourceEntry.decision_state_snapshot_hash,
    identity_derivation: "v2_policy_protocol_context_code_admission_and_snapshot_hashes",
    logical_request_id: deriveReplayDecisionHarnessLogicalRequestId({
      identity_policy_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
      target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
      target_worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
      run_id: source.run_id,
      code_admission_hash: source.code_admission_hash,
      source_bundle_hash: sourceEntry.source_bundle_hash,
      artifact_hash: sourceEntry.artifact_hash,
      request_context_hash: sourceEntry.request_context_hash,
      decision_input_snapshot_hash: sourceEntry.decision_input_snapshot_hash,
      decision_market_input_snapshot_hash: sourceEntry.decision_market_input_snapshot_hash,
      decision_state_snapshot_hash: sourceEntry.decision_state_snapshot_hash,
    }),
    attempt_lease_binding: "excluded_from_logical_identity",
    worker_request: null,
    harness_invocation: "forbidden",
    execution_effect: "none",
  }))
  return {
    schema_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_SCHEMA_VERSION,
    identity_policy_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
    scope: "pre_worker_non_economic_next_epoch_logical_request_identity_upgrade",
    owner: "replay_runner_protocol_admission",
    purpose: "freeze_context_and_code_admission_bound_logical_request_identity_before_worker_request_v10",
    activation_status: "identity_policy_frozen_worker_request_not_materialized",
    parent_validation: "embedded_r4_106_identity_set_and_exact_entry_projection",
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    target_worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
    logical_identity_policy: "protocol_context_code_admission_and_phase_required_snapshot_hashes",
    request_context_direct_binding: "required",
    code_admission_direct_binding: "required",
    attempt_identity_policy: "separate_execution_envelope_not_logical_request_hash",
    attempt_lease_binding: "forbidden",
    retry_stability: "same_frozen_inputs_and_code_admission_same_logical_request_id",
    legacy_migration: "retain_v9_id_as_compatibility_alias_not_target_authority",
    process_instance_identity: "not_materialized",
    execution_attempt_identity: "not_materialized",
    source_invocation_identity_set_id: source.identity_set_id,
    source_invocation_identity_set_hash: source.identity_set_hash,
    source_invocation_identity_set: structuredClone(source),
    code_admission_hash: source.code_admission_hash,
    run_id: source.run_id,
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    logical_request_ids_hash: canonicalHash(entries.map((entry) => entry.logical_request_id)),
    logical_request_identity_count: entries.length,
    logical_request_identity_uniqueness: "unique_within_frozen_schedule",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
    runner_execution_compatibility: "next_epoch_identity_ready_non_executable",
    worker_request_count: 0,
  }
}
