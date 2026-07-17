import {
  REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
  canonicalHash,
} from "./replay-contracts"
import {
  assertReplayDecisionHarnessCodeAdmission,
  type ReplayDecisionHarnessCodeAdmission,
} from "./replay-decision-harness-code-admission"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_SET_SCHEMA_VERSION = "trade.rd-replay-decision-harness-invocation-identity-set.v1" as const
export const REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_ENTRY_SCHEMA_VERSION = "trade.rd-replay-decision-harness-invocation-identity-entry.v1" as const
export const REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_POLICY_VERSION = "rd-replay-decision-harness-invocation-identity-v1" as const

export interface ReplayDecisionHarnessInvocationIdInput {
  run_id: string
  source_bundle_hash: string
  artifact_hash: string
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
  decision_state_snapshot_hash: string | null
}

export function deriveReplayDecisionHarnessInvocationId(
  input: ReplayDecisionHarnessInvocationIdInput,
): string {
  requireText(input.run_id, "decision harness invocation run identity")
  for (const item of [input.source_bundle_hash, input.artifact_hash, input.decision_input_snapshot_hash,
    input.decision_market_input_snapshot_hash]) {
    requireHash(item, "decision harness invocation identity input hash")
  }
  if (input.decision_state_snapshot_hash !== null) {
    requireHash(input.decision_state_snapshot_hash, "decision harness invocation State hash")
  }
  return canonicalHash(input)
}

export interface ReplayDecisionHarnessInvocationIdentityEntry {
  schema_version: typeof REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  source_assembly_v2_entry_hash: string
  source_assembly_v3_entry_hash: string
  request_context_hash: string
  source_bundle_hash: string
  artifact_hash: string
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
  decision_state_snapshot_hash: string | null
  identity_derivation: "existing_worker_request_v9_six_field_canonical_hash"
  request_context_direct_binding: "not_in_legacy_invocation_id_parent_bound_only"
  invocation_id: string
  logical_identity_semantics: "worker_input_identity_shared_by_reproducibility_pair"
  process_instance_identity: "not_materialized"
  execution_attempt_identity: "not_materialized"
  worker_request: null
  harness_invocation: "forbidden"
  execution_effect: "none"
  entry_hash: string
}

export type ReplayDecisionHarnessInvocationIdentityEntryBody = Omit<
  ReplayDecisionHarnessInvocationIdentityEntry, "entry_hash"
>

export interface ReplayDecisionHarnessInvocationIdentitySet {
  schema_version: typeof REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_SET_SCHEMA_VERSION
  identity_set_id: string
  identity_set_hash: string
  identity_policy_version: typeof REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_POLICY_VERSION
  scope: "pre_worker_non_economic_logical_invocation_identity_materialization"
  owner: "replay_runner_invocation_admission"
  purpose: "derive_existing_worker_v9_logical_input_identities_without_worker_request_or_process_start"
  parent_validation: "embedded_code_admission_schema_hash_and_complete_entry_binding"
  identity_formula_compatibility: "exact_existing_worker_request_v9_derivation"
  request_context_identity_limit: "context_not_direct_hash_member_parent_evidence_only"
  reproducibility_pair_identity: "same_logical_invocation_id_for_both_processes"
  process_instance_identity: "not_materialized"
  execution_attempt_identity: "not_materialized"
  retry_identity: "not_materialized"
  code_admission_id: string
  code_admission_hash: string
  code_admission: ReplayDecisionHarnessCodeAdmission
  source_assembly_v4_id: string
  source_assembly_v4_hash: string
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION
  run_id: string
  entry_count: number
  entries: ReplayDecisionHarnessInvocationIdentityEntry[]
  entries_hash: string
  entry_hashes_hash: string
  invocation_ids_hash: string
  invocation_identity_count: number
  invocation_identity_uniqueness: "unique_within_frozen_schedule"
  invocation_identity_materialization: "complete_logical_identity_set"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
  runner_execution_compatibility: "logical_identity_ready_non_executable"
  worker_request_count: 0
}

export type ReplayDecisionHarnessInvocationIdentitySetBody = Omit<
  ReplayDecisionHarnessInvocationIdentitySet, "identity_set_hash"
>

export function createReplayDecisionHarnessInvocationIdentityEntry(
  body: ReplayDecisionHarnessInvocationIdentityEntryBody,
): ReplayDecisionHarnessInvocationIdentityEntry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplayDecisionHarnessInvocationIdentityEntry(value)
  return value
}

export function createReplayDecisionHarnessInvocationIdentitySet(
  body: ReplayDecisionHarnessInvocationIdentitySetBody,
): ReplayDecisionHarnessInvocationIdentitySet {
  const value = { ...structuredClone(body), identity_set_hash: canonicalHash(body) }
  assertReplayDecisionHarnessInvocationIdentitySet(value)
  return value
}

export function assertReplayDecisionHarnessInvocationIdentityEntry(
  value: ReplayDecisionHarnessInvocationIdentityEntry,
): void {
  assertFields(value, ENTRY_FIELDS, "decision harness invocation identity entry")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_ENTRY_SCHEMA_VERSION
      || value.identity_derivation !== "existing_worker_request_v9_six_field_canonical_hash"
      || value.request_context_direct_binding !== "not_in_legacy_invocation_id_parent_bound_only"
      || value.logical_identity_semantics !== "worker_input_identity_shared_by_reproducibility_pair"
      || value.process_instance_identity !== "not_materialized"
      || value.execution_attempt_identity !== "not_materialized"
      || value.worker_request !== null || value.harness_invocation !== "forbidden"
      || value.execution_effect !== "none") {
    throw new Error("unsupported decision harness invocation identity entry authority")
  }
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("decision harness invocation identity sequence or phase is invalid")
  }
  requireUtc(value.decision_time, "decision harness invocation identity decision time")
  for (const item of [value.source_assembly_v2_entry_hash, value.source_assembly_v3_entry_hash,
    value.request_context_hash, value.source_bundle_hash, value.artifact_hash,
    value.decision_input_snapshot_hash, value.decision_market_input_snapshot_hash, value.invocation_id,
    value.entry_hash]) {
    requireHash(item, "decision harness invocation identity entry hash")
  }
  if (value.decision_state_snapshot_hash !== null) {
    requireHash(value.decision_state_snapshot_hash, "decision harness invocation identity State hash")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) {
    throw new Error("decision harness invocation identity entry hash mismatch")
  }
}

export function assertReplayDecisionHarnessInvocationIdentitySet(
  value: ReplayDecisionHarnessInvocationIdentitySet,
): void {
  assertFields(value, SET_FIELDS, "decision harness invocation identity set")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_SET_SCHEMA_VERSION
      || value.identity_policy_version !== REPLAY_DECISION_HARNESS_INVOCATION_IDENTITY_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_logical_invocation_identity_materialization"
      || value.owner !== "replay_runner_invocation_admission"
      || value.purpose !== "derive_existing_worker_v9_logical_input_identities_without_worker_request_or_process_start"
      || value.parent_validation !== "embedded_code_admission_schema_hash_and_complete_entry_binding"
      || value.identity_formula_compatibility !== "exact_existing_worker_request_v9_derivation"
      || value.request_context_identity_limit !== "context_not_direct_hash_member_parent_evidence_only"
      || value.reproducibility_pair_identity !== "same_logical_invocation_id_for_both_processes"
      || value.process_instance_identity !== "not_materialized"
      || value.execution_attempt_identity !== "not_materialized" || value.retry_identity !== "not_materialized"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
      || value.worker_request_schema_version !== REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION
      || value.invocation_identity_uniqueness !== "unique_within_frozen_schedule"
      || value.invocation_identity_materialization !== "complete_logical_identity_set"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none"
      || value.runner_execution_compatibility !== "logical_identity_ready_non_executable"
      || value.worker_request_count !== 0) {
    throw new Error("unsupported decision harness invocation identity set authority")
  }
  for (const item of [value.identity_set_id, value.code_admission_id, value.source_assembly_v4_id, value.run_id]) {
    requireText(item, "decision harness invocation identity set identity")
  }
  for (const item of [value.identity_set_hash, value.code_admission_hash, value.source_assembly_v4_hash,
    value.entries_hash, value.entry_hashes_hash, value.invocation_ids_hash]) {
    requireHash(item, "decision harness invocation identity set hash")
  }
  assertReplayDecisionHarnessCodeAdmission(value.code_admission)
  const assemblyV4 = value.code_admission.source_assembly_v4
  const assemblyV3 = assemblyV4.source_assembly_v3
  const assemblyV2 = assemblyV3.source_assembly_v2
  if (value.code_admission_id !== value.code_admission.admission_id
      || value.code_admission_hash !== value.code_admission.admission_hash
      || value.source_assembly_v4_id !== assemblyV4.assembly_id
      || value.source_assembly_v4_hash !== assemblyV4.assembly_hash
      || value.run_id !== assemblyV2.run_id) {
    throw new Error("decision harness invocation identity parent binding drift")
  }
  const invocationIds: string[] = []
  for (const [index, entry] of value.entries.entries()) {
    assertReplayDecisionHarnessInvocationIdentityEntry(entry)
    const sourceV2Entry = assemblyV2.entries[index]
    const sourceV3Entry = assemblyV3.entries[index]
    if (!sourceV2Entry || !sourceV3Entry
        || entry.decision_sequence !== sourceV2Entry.decision_sequence
        || entry.decision_time !== sourceV2Entry.decision_time
        || entry.decision_phase !== sourceV2Entry.decision_phase
        || entry.source_assembly_v2_entry_hash !== sourceV2Entry.entry_hash
        || entry.source_assembly_v3_entry_hash !== sourceV3Entry.entry_hash
        || entry.request_context_hash !== sourceV2Entry.harness_context_hash
        || entry.source_bundle_hash !== assemblyV4.source_bundle_hash
        || entry.artifact_hash !== assemblyV4.build_artifact_hash
        || entry.decision_input_snapshot_hash !== sourceV2Entry.decision_input_snapshot_hash
        || entry.decision_market_input_snapshot_hash !== sourceV2Entry.decision_market_input_snapshot_hash) {
      throw new Error("decision harness invocation identity entry parent binding drift")
    }
    const stateHash = sourceV3Entry.state_input_materialization?.decision_state_snapshot_hash ?? null
    const expectedInvocationId = deriveReplayDecisionHarnessInvocationId({
      run_id: value.run_id,
      source_bundle_hash: entry.source_bundle_hash,
      artifact_hash: entry.artifact_hash,
      decision_input_snapshot_hash: entry.decision_input_snapshot_hash,
      decision_market_input_snapshot_hash: entry.decision_market_input_snapshot_hash,
      decision_state_snapshot_hash: stateHash,
    })
    if (entry.decision_state_snapshot_hash !== stateHash || entry.invocation_id !== expectedInvocationId) {
      throw new Error("decision harness invocation identity derivation drift")
    }
    invocationIds.push(entry.invocation_id)
  }
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count < 1
      || value.entry_count !== value.entries.length || value.entry_count !== assemblyV3.entry_count
      || value.invocation_identity_count !== value.entry_count
      || new Set(invocationIds).size !== invocationIds.length
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((entry) => entry.entry_hash))
      || value.invocation_ids_hash !== canonicalHash(invocationIds)) {
    throw new Error("decision harness invocation identity set fold drift")
  }
  const { identity_set_hash: identitySetHash, ...body } = value
  const { identity_set_id: identitySetId, ...bodyWithoutId } = body
  if (identitySetId !== `decision-harness-invocation-identities-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || identitySetHash !== canonicalHash(body)) {
    throw new Error("decision harness invocation identity set identity or hash mismatch")
  }
}

const ENTRY_FIELDS = ["artifact_hash", "decision_input_snapshot_hash", "decision_market_input_snapshot_hash",
  "decision_phase", "decision_sequence", "decision_state_snapshot_hash", "decision_time", "entry_hash",
  "execution_attempt_identity", "execution_effect", "harness_invocation", "identity_derivation", "invocation_id",
  "logical_identity_semantics", "process_instance_identity", "request_context_direct_binding",
  "request_context_hash", "schema_version", "source_assembly_v2_entry_hash", "source_assembly_v3_entry_hash",
  "source_bundle_hash", "worker_request"].sort()
const SET_FIELDS = ["code_admission", "code_admission_hash", "code_admission_id", "decision_output_authority",
  "economic_authority", "entries", "entries_hash", "entry_count", "entry_hashes_hash",
  "execution_attempt_identity", "harness_invocation", "identity_formula_compatibility", "identity_policy_version",
  "identity_set_hash", "identity_set_id", "invocation_identity_count", "invocation_identity_materialization",
  "invocation_identity_uniqueness", "invocation_ids_hash", "order_authority", "owner", "parent_validation",
  "process_instance_identity", "purpose", "reproducibility_pair_identity", "request_context_identity_limit",
  "retry_identity", "run_id", "runner_execution_compatibility", "schema_version", "scope", "signal_authority",
  "source_assembly_v4_hash", "source_assembly_v4_id", "trial_authority", "worker_protocol_version",
  "worker_request_count", "worker_request_materialization", "worker_request_schema_version"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
