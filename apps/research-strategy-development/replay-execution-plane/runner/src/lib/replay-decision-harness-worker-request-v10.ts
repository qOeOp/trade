import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  type ReplayDecisionHarnessLogicalRequestIdentityUpgrade,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerRequestV10Materialization,
  createReplayDecisionHarnessWorkerRequestV10,
  createReplayDecisionHarnessWorkerRequestV10Materialization,
  type ReplayDecisionHarnessWorkerRequestV10Materialization,
  type ReplayDecisionHarnessWorkerRequestV10MaterializationBody,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"

export interface ReplayDecisionHarnessWorkerRequestV10MaterializationInput {
  source_identity_upgrade: ReplayDecisionHarnessLogicalRequestIdentityUpgrade
}

export function buildReplayDecisionHarnessWorkerRequestV10Materialization(
  input: ReplayDecisionHarnessWorkerRequestV10MaterializationInput,
): ReplayDecisionHarnessWorkerRequestV10Materialization {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessWorkerRequestV10Materialization({
    ...bodyWithoutId,
    materialization_id: `decision-harness-worker-request-v10-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage(
  value: ReplayDecisionHarnessWorkerRequestV10Materialization,
  input: ReplayDecisionHarnessWorkerRequestV10MaterializationInput,
): void {
  assertReplayDecisionHarnessWorkerRequestV10Materialization(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessWorkerRequestV10Materialization({
    ...bodyWithoutId,
    materialization_id: `decision-harness-worker-request-v10-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker Request v10 materialization parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessWorkerRequestV10MaterializationInput,
): Omit<ReplayDecisionHarnessWorkerRequestV10MaterializationBody, "materialization_id"> {
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade(input.source_identity_upgrade)
  const source = input.source_identity_upgrade
  const assemblyV3 = source.source_invocation_identity_set.code_admission.source_assembly_v4.source_assembly_v3
  const assemblyV2 = assemblyV3.source_assembly_v2
  const requests = source.entries.map((sourceEntry, index) => {
    const v2Entry = assemblyV2.entries[index]
    const v3Entry = assemblyV3.entries[index]
    if (!v2Entry || !v3Entry) throw new Error("decision harness Worker Request v10 input entity is missing")
    const stateSnapshot = v3Entry.state_input_materialization?.decision_state_snapshot ?? null
    return createReplayDecisionHarnessWorkerRequestV10({
      schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
      worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
      identity_policy_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
      logical_request_id: sourceEntry.logical_request_id,
      legacy_v9_invocation_id: sourceEntry.legacy_v9_invocation_id,
      legacy_migration_status: "compatibility_alias_v9_execution_path_unchanged",
      run_id: sourceEntry.run_id,
      code_admission_hash: sourceEntry.code_admission_hash,
      source_bundle_hash: sourceEntry.source_bundle_hash,
      artifact_hash: sourceEntry.artifact_hash,
      request_context: structuredClone(v2Entry.harness_context),
      request_context_hash: sourceEntry.request_context_hash,
      decision_input_snapshot: structuredClone(v2Entry.decision_input_snapshot),
      decision_input_snapshot_hash: sourceEntry.decision_input_snapshot_hash,
      decision_market_input_snapshot: structuredClone(v2Entry.decision_market_input_snapshot),
      decision_market_input_snapshot_hash: sourceEntry.decision_market_input_snapshot_hash,
      decision_state_snapshot: structuredClone(stateSnapshot),
      decision_state_snapshot_hash: sourceEntry.decision_state_snapshot_hash,
      execution_admission: "not_granted",
      execution_envelope: null,
      transport_status: "not_invoked",
    })
  })
  return {
    schema_version: REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_SCHEMA_VERSION,
    materialization_policy_version: REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_POLICY_VERSION,
    scope: "pre_execution_non_economic_worker_request_v10_materialization",
    owner: "replay_runner_protocol_admission",
    purpose: "materialize_self_validating_worker_request_v10_without_transport_or_execution",
    activation_status: "contract_materialized_non_executable",
    parent_validation: "embedded_r4_107_upgrade_and_exact_input_entity_projection",
    field_policy: "exact_whitelist_no_attempt_or_process_fields",
    self_validation_policy: "content_hashes_logical_id_and_request_hash",
    migration_policy: "v9_execution_unchanged_v10_contract_only",
    activation_gate: "response_echo_execution_envelope_transport_and_worker_certification_required",
    source_identity_upgrade_id: source.upgrade_id,
    source_identity_upgrade_hash: source.upgrade_hash,
    source_identity_upgrade: structuredClone(source),
    worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
    identity_policy_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
    request_count: requests.length,
    requests,
    requests_hash: canonicalHash(requests),
    request_hashes_hash: canonicalHash(requests.map((request) => request.request_hash)),
    logical_request_ids_hash: canonicalHash(requests.map((request) => request.logical_request_id)),
    request_identity_uniqueness: "unique_within_frozen_schedule",
    response_contract: "not_materialized",
    execution_envelope: "not_materialized",
    process_instance_identity: "not_materialized",
    execution_attempt_identity: "not_materialized",
    transport: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  }
}
