import {
  assertReplayDecisionInputSnapshot,
  assertReplayDecisionMarketInputSnapshot,
  assertReplayDecisionStateSnapshot,
  canonicalHash,
  type ReplayDecisionHarnessContext,
  type ReplayDecisionInputSnapshot,
  type ReplayDecisionMarketInputSnapshot,
  type ReplayDecisionStateSnapshot,
} from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  deriveReplayDecisionHarnessLogicalRequestId,
  type ReplayDecisionHarnessLogicalRequestIdentityUpgrade,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_SCHEMA_VERSION = "trade.rd-replay-decision-harness-worker-request-materialization.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_POLICY_VERSION = "rd-replay-decision-harness-worker-request-v10-materialization-v1" as const

export interface ReplayDecisionHarnessWorkerRequestV10 {
  schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  identity_policy_version: typeof REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
  logical_request_id: string
  legacy_v9_invocation_id: string
  legacy_migration_status: "compatibility_alias_v9_execution_path_unchanged"
  run_id: string
  code_admission_hash: string
  source_bundle_hash: string
  artifact_hash: string
  request_context: ReplayDecisionHarnessContext
  request_context_hash: string
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_input_snapshot_hash: string
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_market_input_snapshot_hash: string
  decision_state_snapshot: ReplayDecisionStateSnapshot | null
  decision_state_snapshot_hash: string | null
  execution_admission: "not_granted"
  execution_envelope: null
  transport_status: "not_invoked"
  request_hash: string
}

export type ReplayDecisionHarnessWorkerRequestV10Body = Omit<ReplayDecisionHarnessWorkerRequestV10, "request_hash">

export interface ReplayDecisionHarnessWorkerRequestV10Materialization {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_SCHEMA_VERSION
  materialization_id: string
  materialization_hash: string
  materialization_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_POLICY_VERSION
  scope: "pre_execution_non_economic_worker_request_v10_materialization"
  owner: "replay_runner_protocol_admission"
  purpose: "materialize_self_validating_worker_request_v10_without_transport_or_execution"
  activation_status: "contract_materialized_non_executable"
  parent_validation: "embedded_r4_107_upgrade_and_exact_input_entity_projection"
  field_policy: "exact_whitelist_no_attempt_or_process_fields"
  self_validation_policy: "content_hashes_logical_id_and_request_hash"
  migration_policy: "v9_execution_unchanged_v10_contract_only"
  activation_gate: "response_echo_execution_envelope_transport_and_worker_certification_required"
  source_identity_upgrade_id: string
  source_identity_upgrade_hash: string
  source_identity_upgrade: ReplayDecisionHarnessLogicalRequestIdentityUpgrade
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  identity_policy_version: typeof REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
  request_count: number
  requests: ReplayDecisionHarnessWorkerRequestV10[]
  requests_hash: string
  request_hashes_hash: string
  logical_request_ids_hash: string
  request_identity_uniqueness: "unique_within_frozen_schedule"
  response_contract: "not_materialized"
  execution_envelope: "not_materialized"
  process_instance_identity: "not_materialized"
  execution_attempt_identity: "not_materialized"
  transport: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerRequestV10MaterializationBody = Omit<
  ReplayDecisionHarnessWorkerRequestV10Materialization, "materialization_hash"
>

export function createReplayDecisionHarnessWorkerRequestV10(
  body: ReplayDecisionHarnessWorkerRequestV10Body,
): ReplayDecisionHarnessWorkerRequestV10 {
  const value = { ...structuredClone(body), request_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerRequestV10(value)
  return value
}

export function createReplayDecisionHarnessWorkerRequestV10Materialization(
  body: ReplayDecisionHarnessWorkerRequestV10MaterializationBody,
): ReplayDecisionHarnessWorkerRequestV10Materialization {
  const value = { ...structuredClone(body), materialization_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerRequestV10Materialization(value)
  return value
}

export function assertReplayDecisionHarnessWorkerRequestV10(
  value: ReplayDecisionHarnessWorkerRequestV10,
): void {
  assertFields(value, REQUEST_FIELDS, "decision harness Worker Request v10")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.identity_policy_version !== REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
      || value.legacy_migration_status !== "compatibility_alias_v9_execution_path_unchanged"
      || value.execution_admission !== "not_granted" || value.execution_envelope !== null
      || value.transport_status !== "not_invoked") {
    throw new Error("unsupported decision harness Worker Request v10 authority")
  }
  requireText(value.run_id, "decision harness Worker Request v10 run identity")
  for (const item of [value.logical_request_id, value.legacy_v9_invocation_id, value.code_admission_hash,
    value.source_bundle_hash, value.artifact_hash, value.request_context_hash,
    value.decision_input_snapshot_hash, value.decision_market_input_snapshot_hash, value.request_hash]) {
    requireHash(item, "decision harness Worker Request v10 hash")
  }
  if (value.decision_state_snapshot_hash !== null) {
    requireHash(value.decision_state_snapshot_hash, "decision harness Worker Request v10 State hash")
  }
  assertReplayDecisionInputSnapshot(value.decision_input_snapshot)
  assertReplayDecisionMarketInputSnapshot(value.decision_market_input_snapshot)
  if (value.decision_state_snapshot !== null) assertReplayDecisionStateSnapshot(value.decision_state_snapshot)
  const context = value.request_context
  const stateRequired = context.decision_phase === "position_open"
  if (context.run_id !== value.run_id
      || value.request_context_hash !== canonicalHash(context)
      || value.decision_input_snapshot_hash !== value.decision_input_snapshot.snapshot_hash
      || value.decision_market_input_snapshot_hash !== value.decision_market_input_snapshot.snapshot_hash
      || value.decision_state_snapshot_hash !== (value.decision_state_snapshot?.snapshot_hash ?? null)
      || value.decision_input_snapshot.run_id !== value.run_id
      || value.decision_market_input_snapshot.run_id !== value.run_id
      || value.decision_input_snapshot.decision_time !== context.decision_time
      || value.decision_market_input_snapshot.decision_time !== context.decision_time
      || value.decision_market_input_snapshot.symbol !== context.symbol
      || value.decision_market_input_snapshot.timeframe !== context.timeframe
      || stateRequired !== (value.decision_state_snapshot !== null)
      || value.decision_state_snapshot !== null && (
        value.decision_state_snapshot.run_id !== value.run_id
        || value.decision_state_snapshot.decision_time !== context.decision_time
        || value.decision_state_snapshot.decision_sequence !== context.decision_sequence
      )) {
    throw new Error("decision harness Worker Request v10 embedded input hash or run binding drift")
  }
  const expectedLogicalId = deriveReplayDecisionHarnessLogicalRequestId({
    identity_policy_version: value.identity_policy_version,
    target_worker_protocol_version: value.worker_protocol_version,
    target_worker_request_schema_version: value.schema_version,
    run_id: value.run_id,
    code_admission_hash: value.code_admission_hash,
    source_bundle_hash: value.source_bundle_hash,
    artifact_hash: value.artifact_hash,
    request_context_hash: value.request_context_hash,
    decision_input_snapshot_hash: value.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: value.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: value.decision_state_snapshot_hash,
  })
  const { request_hash: requestHash, ...body } = value
  if (value.logical_request_id !== expectedLogicalId || requestHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker Request v10 logical identity or self-hash drift")
  }
}

export function assertReplayDecisionHarnessWorkerRequestV10Materialization(
  value: ReplayDecisionHarnessWorkerRequestV10Materialization,
): void {
  assertFields(value, MATERIALIZATION_FIELDS, "decision harness Worker Request v10 materialization")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_SCHEMA_VERSION
      || value.materialization_policy_version !== REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_MATERIALIZATION_POLICY_VERSION
      || value.scope !== "pre_execution_non_economic_worker_request_v10_materialization"
      || value.owner !== "replay_runner_protocol_admission"
      || value.purpose !== "materialize_self_validating_worker_request_v10_without_transport_or_execution"
      || value.activation_status !== "contract_materialized_non_executable"
      || value.parent_validation !== "embedded_r4_107_upgrade_and_exact_input_entity_projection"
      || value.field_policy !== "exact_whitelist_no_attempt_or_process_fields"
      || value.self_validation_policy !== "content_hashes_logical_id_and_request_hash"
      || value.migration_policy !== "v9_execution_unchanged_v10_contract_only"
      || value.activation_gate !== "response_echo_execution_envelope_transport_and_worker_certification_required"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.worker_request_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
      || value.identity_policy_version !== REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION
      || value.request_identity_uniqueness !== "unique_within_frozen_schedule"
      || value.response_contract !== "not_materialized" || value.execution_envelope !== "not_materialized"
      || value.process_instance_identity !== "not_materialized"
      || value.execution_attempt_identity !== "not_materialized"
      || value.transport !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker Request v10 materialization authority")
  }
  for (const item of [value.materialization_id, value.source_identity_upgrade_id]) {
    requireText(item, "decision harness Worker Request v10 materialization identity")
  }
  for (const item of [value.materialization_hash, value.source_identity_upgrade_hash, value.requests_hash,
    value.request_hashes_hash, value.logical_request_ids_hash]) {
    requireHash(item, "decision harness Worker Request v10 materialization hash")
  }
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade(value.source_identity_upgrade)
  const source = value.source_identity_upgrade
  if (value.source_identity_upgrade_id !== source.upgrade_id
      || value.source_identity_upgrade_hash !== source.upgrade_hash) {
    throw new Error("decision harness Worker Request v10 materialization parent binding drift")
  }
  const logicalIds: string[] = []
  for (const [index, request] of value.requests.entries()) {
    assertReplayDecisionHarnessWorkerRequestV10(request)
    const sourceEntry = source.entries[index]
    if (!sourceEntry || request.logical_request_id !== sourceEntry.logical_request_id
        || request.legacy_v9_invocation_id !== sourceEntry.legacy_v9_invocation_id
        || request.run_id !== sourceEntry.run_id || request.code_admission_hash !== sourceEntry.code_admission_hash
        || request.source_bundle_hash !== sourceEntry.source_bundle_hash
        || request.artifact_hash !== sourceEntry.artifact_hash
        || request.request_context_hash !== sourceEntry.request_context_hash
        || request.decision_input_snapshot_hash !== sourceEntry.decision_input_snapshot_hash
        || request.decision_market_input_snapshot_hash !== sourceEntry.decision_market_input_snapshot_hash
        || request.decision_state_snapshot_hash !== sourceEntry.decision_state_snapshot_hash) {
      throw new Error("decision harness Worker Request v10 exact parent projection drift")
    }
    logicalIds.push(request.logical_request_id)
  }
  if (!Number.isSafeInteger(value.request_count) || value.request_count < 1
      || value.request_count !== value.requests.length || value.request_count !== source.entry_count
      || new Set(logicalIds).size !== logicalIds.length
      || value.requests_hash !== canonicalHash(value.requests)
      || value.request_hashes_hash !== canonicalHash(value.requests.map((request) => request.request_hash))
      || value.logical_request_ids_hash !== canonicalHash(logicalIds)) {
    throw new Error("decision harness Worker Request v10 materialization fold drift")
  }
  const { materialization_hash: materializationHash, ...body } = value
  const { materialization_id: materializationId, ...bodyWithoutId } = body
  if (materializationId !== `decision-harness-worker-request-v10-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || materializationHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker Request v10 materialization identity or hash mismatch")
  }
}

const REQUEST_FIELDS = ["artifact_hash", "code_admission_hash", "decision_input_snapshot",
  "decision_input_snapshot_hash", "decision_market_input_snapshot", "decision_market_input_snapshot_hash",
  "decision_state_snapshot", "decision_state_snapshot_hash", "execution_admission", "execution_envelope",
  "identity_policy_version", "legacy_migration_status", "legacy_v9_invocation_id", "logical_request_id",
  "request_context", "request_context_hash", "request_hash", "run_id", "schema_version", "source_bundle_hash",
  "transport_status", "worker_protocol_version"].sort()
const MATERIALIZATION_FIELDS = ["activation_gate", "activation_status", "decision_output_authority",
  "economic_authority", "execution_attempt_identity", "execution_envelope", "field_policy", "harness_invocation",
  "identity_policy_version", "logical_request_ids_hash", "materialization_hash", "materialization_id",
  "materialization_policy_version", "migration_policy", "order_authority", "owner", "parent_validation",
  "process_instance_identity", "purpose", "request_count", "request_hashes_hash", "request_identity_uniqueness",
  "requests", "requests_hash", "response_contract", "schema_version", "scope", "self_validation_policy",
  "signal_authority", "source_identity_upgrade", "source_identity_upgrade_hash", "source_identity_upgrade_id",
  "transport", "trial_authority", "worker_protocol_version", "worker_request_schema_version"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
