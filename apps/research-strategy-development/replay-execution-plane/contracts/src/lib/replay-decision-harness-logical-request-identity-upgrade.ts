import { canonicalHash } from "./replay-contracts"
import {
  assertReplayDecisionHarnessInvocationIdentitySet,
  type ReplayDecisionHarnessInvocationIdentitySet,
} from "./replay-decision-harness-invocation-identity"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_SCHEMA_VERSION = "trade.rd-replay-decision-harness-logical-request-identity-upgrade.v1" as const
export const REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_ENTRY_SCHEMA_VERSION = "trade.rd-replay-decision-harness-logical-request-identity-upgrade-entry.v1" as const
export const REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION = "rd-replay-logical-worker-request-identity-v2" as const
export const REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION = "rd-replay-harness-worker-stdio-v10" as const
export const REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION = "trade.rd-replay-decision-harness-worker-request.v10" as const

export interface ReplayDecisionHarnessLogicalRequestIdInput {
  identity_policy_version: typeof REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
  target_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  target_worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  run_id: string
  code_admission_hash: string
  source_bundle_hash: string
  artifact_hash: string
  request_context_hash: string
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
  decision_state_snapshot_hash: string | null
}

export function deriveReplayDecisionHarnessLogicalRequestId(
  input: ReplayDecisionHarnessLogicalRequestIdInput,
): string {
  if (input.identity_policy_version !== REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
      || input.target_worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || input.target_worker_request_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION) {
    throw new Error("unsupported decision harness logical request identity policy")
  }
  requireText(input.run_id, "decision harness logical request run identity")
  for (const item of [input.code_admission_hash, input.source_bundle_hash, input.artifact_hash,
    input.request_context_hash, input.decision_input_snapshot_hash, input.decision_market_input_snapshot_hash]) {
    requireHash(item, "decision harness logical request identity input hash")
  }
  if (input.decision_state_snapshot_hash !== null) {
    requireHash(input.decision_state_snapshot_hash, "decision harness logical request State hash")
  }
  return canonicalHash(input)
}

export interface ReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry {
  schema_version: typeof REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  source_invocation_identity_entry_hash: string
  legacy_v9_invocation_id: string
  legacy_identity_status: "compatibility_alias_not_target_authority"
  run_id: string
  code_admission_hash: string
  source_bundle_hash: string
  artifact_hash: string
  request_context_hash: string
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
  decision_state_snapshot_hash: string | null
  identity_derivation: "v2_policy_protocol_context_code_admission_and_snapshot_hashes"
  logical_request_id: string
  attempt_lease_binding: "excluded_from_logical_identity"
  worker_request: null
  harness_invocation: "forbidden"
  execution_effect: "none"
  entry_hash: string
}

export type ReplayDecisionHarnessLogicalRequestIdentityUpgradeEntryBody = Omit<
  ReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry, "entry_hash"
>

export interface ReplayDecisionHarnessLogicalRequestIdentityUpgrade {
  schema_version: typeof REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_SCHEMA_VERSION
  upgrade_id: string
  upgrade_hash: string
  identity_policy_version: typeof REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
  scope: "pre_worker_non_economic_next_epoch_logical_request_identity_upgrade"
  owner: "replay_runner_protocol_admission"
  purpose: "freeze_context_and_code_admission_bound_logical_request_identity_before_worker_request_v10"
  activation_status: "identity_policy_frozen_worker_request_not_materialized"
  parent_validation: "embedded_r4_106_identity_set_and_exact_entry_projection"
  target_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  target_worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  logical_identity_policy: "protocol_context_code_admission_and_phase_required_snapshot_hashes"
  request_context_direct_binding: "required"
  code_admission_direct_binding: "required"
  attempt_identity_policy: "separate_execution_envelope_not_logical_request_hash"
  attempt_lease_binding: "forbidden"
  retry_stability: "same_frozen_inputs_and_code_admission_same_logical_request_id"
  legacy_migration: "retain_v9_id_as_compatibility_alias_not_target_authority"
  process_instance_identity: "not_materialized"
  execution_attempt_identity: "not_materialized"
  source_invocation_identity_set_id: string
  source_invocation_identity_set_hash: string
  source_invocation_identity_set: ReplayDecisionHarnessInvocationIdentitySet
  code_admission_hash: string
  run_id: string
  entry_count: number
  entries: ReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry[]
  entries_hash: string
  entry_hashes_hash: string
  logical_request_ids_hash: string
  logical_request_identity_count: number
  logical_request_identity_uniqueness: "unique_within_frozen_schedule"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
  runner_execution_compatibility: "next_epoch_identity_ready_non_executable"
  worker_request_count: 0
}

export type ReplayDecisionHarnessLogicalRequestIdentityUpgradeBody = Omit<
  ReplayDecisionHarnessLogicalRequestIdentityUpgrade, "upgrade_hash"
>

export function createReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry(
  body: ReplayDecisionHarnessLogicalRequestIdentityUpgradeEntryBody,
): ReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry(value)
  return value
}

export function createReplayDecisionHarnessLogicalRequestIdentityUpgrade(
  body: ReplayDecisionHarnessLogicalRequestIdentityUpgradeBody,
): ReplayDecisionHarnessLogicalRequestIdentityUpgrade {
  const value = { ...structuredClone(body), upgrade_hash: canonicalHash(body) }
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade(value)
  return value
}

export function assertReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry(
  value: ReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry,
): void {
  assertFields(value, ENTRY_FIELDS, "decision harness logical request identity upgrade entry")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_ENTRY_SCHEMA_VERSION
      || value.legacy_identity_status !== "compatibility_alias_not_target_authority"
      || value.identity_derivation !== "v2_policy_protocol_context_code_admission_and_snapshot_hashes"
      || value.attempt_lease_binding !== "excluded_from_logical_identity"
      || value.worker_request !== null || value.harness_invocation !== "forbidden"
      || value.execution_effect !== "none") {
    throw new Error("unsupported decision harness logical request identity upgrade entry authority")
  }
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("decision harness logical request identity upgrade sequence or phase is invalid")
  }
  requireUtc(value.decision_time, "decision harness logical request identity upgrade decision time")
  requireText(value.run_id, "decision harness logical request identity upgrade run identity")
  for (const item of [value.source_invocation_identity_entry_hash, value.legacy_v9_invocation_id,
    value.code_admission_hash, value.source_bundle_hash, value.artifact_hash, value.request_context_hash,
    value.decision_input_snapshot_hash, value.decision_market_input_snapshot_hash, value.logical_request_id,
    value.entry_hash]) {
    requireHash(item, "decision harness logical request identity upgrade entry hash")
  }
  if (value.decision_state_snapshot_hash !== null) {
    requireHash(value.decision_state_snapshot_hash, "decision harness logical request identity upgrade State hash")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) {
    throw new Error("decision harness logical request identity upgrade entry hash mismatch")
  }
}

export function assertReplayDecisionHarnessLogicalRequestIdentityUpgrade(
  value: ReplayDecisionHarnessLogicalRequestIdentityUpgrade,
): void {
  assertFields(value, UPGRADE_FIELDS, "decision harness logical request identity upgrade")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_UPGRADE_SCHEMA_VERSION
      || value.identity_policy_version !== REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_next_epoch_logical_request_identity_upgrade"
      || value.owner !== "replay_runner_protocol_admission"
      || value.purpose !== "freeze_context_and_code_admission_bound_logical_request_identity_before_worker_request_v10"
      || value.activation_status !== "identity_policy_frozen_worker_request_not_materialized"
      || value.parent_validation !== "embedded_r4_106_identity_set_and_exact_entry_projection"
      || value.target_worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.target_worker_request_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
      || value.logical_identity_policy !== "protocol_context_code_admission_and_phase_required_snapshot_hashes"
      || value.request_context_direct_binding !== "required" || value.code_admission_direct_binding !== "required"
      || value.attempt_identity_policy !== "separate_execution_envelope_not_logical_request_hash"
      || value.attempt_lease_binding !== "forbidden"
      || value.retry_stability !== "same_frozen_inputs_and_code_admission_same_logical_request_id"
      || value.legacy_migration !== "retain_v9_id_as_compatibility_alias_not_target_authority"
      || value.process_instance_identity !== "not_materialized"
      || value.execution_attempt_identity !== "not_materialized"
      || value.logical_request_identity_uniqueness !== "unique_within_frozen_schedule"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none"
      || value.runner_execution_compatibility !== "next_epoch_identity_ready_non_executable"
      || value.worker_request_count !== 0) {
    throw new Error("unsupported decision harness logical request identity upgrade authority")
  }
  for (const item of [value.upgrade_id, value.source_invocation_identity_set_id, value.run_id]) {
    requireText(item, "decision harness logical request identity upgrade identity")
  }
  for (const item of [value.upgrade_hash, value.source_invocation_identity_set_hash,
    value.code_admission_hash, value.entries_hash, value.entry_hashes_hash, value.logical_request_ids_hash]) {
    requireHash(item, "decision harness logical request identity upgrade hash")
  }
  assertReplayDecisionHarnessInvocationIdentitySet(value.source_invocation_identity_set)
  const source = value.source_invocation_identity_set
  if (value.source_invocation_identity_set_id !== source.identity_set_id
      || value.source_invocation_identity_set_hash !== source.identity_set_hash
      || value.code_admission_hash !== source.code_admission_hash || value.run_id !== source.run_id) {
    throw new Error("decision harness logical request identity upgrade parent binding drift")
  }
  const logicalRequestIds: string[] = []
  for (const [index, entry] of value.entries.entries()) {
    assertReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry(entry)
    const sourceEntry = source.entries[index]
    if (!sourceEntry || entry.decision_sequence !== sourceEntry.decision_sequence
        || entry.decision_time !== sourceEntry.decision_time || entry.decision_phase !== sourceEntry.decision_phase
        || entry.source_invocation_identity_entry_hash !== sourceEntry.entry_hash
        || entry.legacy_v9_invocation_id !== sourceEntry.invocation_id || entry.run_id !== source.run_id
        || entry.code_admission_hash !== source.code_admission_hash
        || entry.source_bundle_hash !== sourceEntry.source_bundle_hash
        || entry.artifact_hash !== sourceEntry.artifact_hash
        || entry.request_context_hash !== sourceEntry.request_context_hash
        || entry.decision_input_snapshot_hash !== sourceEntry.decision_input_snapshot_hash
        || entry.decision_market_input_snapshot_hash !== sourceEntry.decision_market_input_snapshot_hash
        || entry.decision_state_snapshot_hash !== sourceEntry.decision_state_snapshot_hash) {
      throw new Error("decision harness logical request identity upgrade entry parent binding drift")
    }
    const expectedId = deriveReplayDecisionHarnessLogicalRequestId({
      identity_policy_version: value.identity_policy_version,
      target_worker_protocol_version: value.target_worker_protocol_version,
      target_worker_request_schema_version: value.target_worker_request_schema_version,
      run_id: entry.run_id,
      code_admission_hash: entry.code_admission_hash,
      source_bundle_hash: entry.source_bundle_hash,
      artifact_hash: entry.artifact_hash,
      request_context_hash: entry.request_context_hash,
      decision_input_snapshot_hash: entry.decision_input_snapshot_hash,
      decision_market_input_snapshot_hash: entry.decision_market_input_snapshot_hash,
      decision_state_snapshot_hash: entry.decision_state_snapshot_hash,
    })
    if (entry.logical_request_id !== expectedId) {
      throw new Error("decision harness logical request identity upgrade derivation drift")
    }
    logicalRequestIds.push(entry.logical_request_id)
  }
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count < 1
      || value.entry_count !== value.entries.length || value.entry_count !== source.entry_count
      || value.logical_request_identity_count !== value.entry_count
      || new Set(logicalRequestIds).size !== logicalRequestIds.length
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((entry) => entry.entry_hash))
      || value.logical_request_ids_hash !== canonicalHash(logicalRequestIds)) {
    throw new Error("decision harness logical request identity upgrade fold drift")
  }
  const { upgrade_hash: upgradeHash, ...body } = value
  const { upgrade_id: upgradeId, ...bodyWithoutId } = body
  if (upgradeId !== `decision-harness-logical-request-upgrade-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || upgradeHash !== canonicalHash(body)) {
    throw new Error("decision harness logical request identity upgrade identity or hash mismatch")
  }
}

const ENTRY_FIELDS = ["artifact_hash", "attempt_lease_binding", "code_admission_hash",
  "decision_input_snapshot_hash", "decision_market_input_snapshot_hash", "decision_phase", "decision_sequence",
  "decision_state_snapshot_hash", "decision_time", "entry_hash", "execution_effect", "harness_invocation",
  "identity_derivation", "legacy_identity_status", "legacy_v9_invocation_id", "logical_request_id",
  "request_context_hash", "run_id", "schema_version", "source_bundle_hash",
  "source_invocation_identity_entry_hash", "worker_request"].sort()
const UPGRADE_FIELDS = ["activation_status", "attempt_identity_policy", "attempt_lease_binding",
  "code_admission_direct_binding", "code_admission_hash", "decision_output_authority", "economic_authority",
  "entries", "entries_hash", "entry_count", "entry_hashes_hash", "execution_attempt_identity",
  "harness_invocation", "identity_policy_version", "legacy_migration", "logical_identity_policy",
  "logical_request_identity_count", "logical_request_identity_uniqueness", "logical_request_ids_hash",
  "order_authority", "owner", "parent_validation", "process_instance_identity", "purpose",
  "request_context_direct_binding", "retry_stability", "run_id", "runner_execution_compatibility",
  "schema_version", "scope", "signal_authority", "source_invocation_identity_set",
  "source_invocation_identity_set_hash", "source_invocation_identity_set_id", "target_worker_protocol_version",
  "target_worker_request_schema_version", "trial_authority", "upgrade_hash", "upgrade_id",
  "worker_request_count", "worker_request_materialization"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
