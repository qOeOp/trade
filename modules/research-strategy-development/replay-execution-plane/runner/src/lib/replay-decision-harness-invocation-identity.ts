import {
  REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
  canonicalHash,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_SET_SCHEMA_VERSION,
  assertReplayDecisionHarnessInvocationIdentitySet,
  createReplayDecisionHarnessInvocationIdentityEntry,
  createReplayDecisionHarnessInvocationIdentitySet,
  deriveReplayDecisionHarnessInvocationId,
  type ReplayDecisionHarnessInvocationIdentitySet,
  type ReplayDecisionHarnessInvocationIdentitySetBody,
} from "../../../contracts/src/lib/replay-decision-harness-invocation-identity"
import {
  assertReplayDecisionHarnessCodeAdmission,
  type ReplayDecisionHarnessCodeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-code-admission"

export interface ReplayDecisionHarnessInvocationIdentityInput {
  code_admission: ReplayDecisionHarnessCodeAdmission
}

export function buildReplayDecisionHarnessInvocationIdentitySet(
  input: ReplayDecisionHarnessInvocationIdentityInput,
): ReplayDecisionHarnessInvocationIdentitySet {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessInvocationIdentitySet({
    ...bodyWithoutId,
    identity_set_id: `decision-harness-invocation-identities-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessInvocationIdentityLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessInvocationIdentityLineage(
  value: ReplayDecisionHarnessInvocationIdentitySet,
  input: ReplayDecisionHarnessInvocationIdentityInput,
): void {
  assertReplayDecisionHarnessInvocationIdentitySet(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessInvocationIdentitySet({
    ...bodyWithoutId,
    identity_set_id: `decision-harness-invocation-identities-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness invocation identity parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessInvocationIdentityInput,
): Omit<ReplayDecisionHarnessInvocationIdentitySetBody, "identity_set_id"> {
  assertReplayDecisionHarnessCodeAdmission(input.code_admission)
  const assemblyV4 = input.code_admission.source_assembly_v4
  const assemblyV3 = assemblyV4.source_assembly_v3
  const assemblyV2 = assemblyV3.source_assembly_v2
  const entries = assemblyV3.entries.map((sourceV3Entry, index) => {
    const sourceV2Entry = assemblyV2.entries[index]
    if (!sourceV2Entry) throw new Error("decision harness invocation identity source entry is missing")
    const stateHash = sourceV3Entry.state_input_materialization?.decision_state_snapshot_hash ?? null
    return createReplayDecisionHarnessInvocationIdentityEntry({
      schema_version: REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_ENTRY_SCHEMA_VERSION,
      decision_sequence: sourceV2Entry.decision_sequence,
      decision_time: sourceV2Entry.decision_time,
      decision_phase: sourceV2Entry.decision_phase,
      source_assembly_v2_entry_hash: sourceV2Entry.entry_hash,
      source_assembly_v3_entry_hash: sourceV3Entry.entry_hash,
      request_context_hash: sourceV2Entry.harness_context_hash,
      source_bundle_hash: assemblyV4.source_bundle_hash,
      artifact_hash: assemblyV4.build_artifact_hash,
      decision_input_snapshot_hash: sourceV2Entry.decision_input_snapshot_hash,
      decision_market_input_snapshot_hash: sourceV2Entry.decision_market_input_snapshot_hash,
      decision_state_snapshot_hash: stateHash,
      identity_derivation: "existing_worker_request_v9_six_field_canonical_hash",
      request_context_direct_binding: "not_in_legacy_invocation_id_parent_bound_only",
      invocation_id: deriveReplayDecisionHarnessInvocationId({
        run_id: assemblyV2.run_id,
        source_bundle_hash: assemblyV4.source_bundle_hash,
        artifact_hash: assemblyV4.build_artifact_hash,
        decision_input_snapshot_hash: sourceV2Entry.decision_input_snapshot_hash,
        decision_market_input_snapshot_hash: sourceV2Entry.decision_market_input_snapshot_hash,
        decision_state_snapshot_hash: stateHash,
      }),
      logical_identity_semantics: "worker_input_identity_shared_by_reproducibility_pair",
      process_instance_identity: "not_materialized",
      execution_attempt_identity: "not_materialized",
      worker_request: null,
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
  return {
    schema_version: REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_SET_SCHEMA_VERSION,
    identity_policy_version: REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_POLICY_VERSION,
    scope: "pre_worker_non_economic_logical_invocation_identity_materialization",
    owner: "replay_runner_invocation_admission",
    purpose: "derive_existing_worker_v9_logical_input_identities_without_worker_request_or_process_start",
    parent_validation: "embedded_code_admission_schema_hash_and_complete_entry_binding",
    identity_formula_compatibility: "exact_existing_worker_request_v9_derivation",
    request_context_identity_limit: "context_not_direct_hash_member_parent_evidence_only",
    reproducibility_pair_identity: "same_logical_invocation_id_for_both_processes",
    process_instance_identity: "not_materialized",
    execution_attempt_identity: "not_materialized",
    retry_identity: "not_materialized",
    code_admission_id: input.code_admission.admission_id,
    code_admission_hash: input.code_admission.admission_hash,
    code_admission: structuredClone(input.code_admission),
    source_assembly_v4_id: assemblyV4.assembly_id,
    source_assembly_v4_hash: assemblyV4.assembly_hash,
    worker_protocol_version: REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
    worker_request_schema_version: REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
    run_id: assemblyV2.run_id,
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    invocation_ids_hash: canonicalHash(entries.map((entry) => entry.invocation_id)),
    invocation_identity_count: entries.length,
    invocation_identity_uniqueness: "unique_within_frozen_schedule",
    invocation_identity_materialization: "complete_logical_identity_set",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
    runner_execution_compatibility: "logical_identity_ready_non_executable",
    worker_request_count: 0,
  }
}
