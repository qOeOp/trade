import {
  assertReplayDecisionOutput,
  canonicalHash,
  type ReplayDecisionOutput,
  type ReplaySupplementalValue,
} from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10,
  assertReplayDecisionHarnessWorkerRequestV10Materialization,
  type ReplayDecisionHarnessWorkerRequestV10,
  type ReplayDecisionHarnessWorkerRequestV10Materialization,
} from "./replay-decision-harness-worker-request-v10"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION = "trade.rd-replay-decision-harness-worker-response.v10" as const
export const REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_CONTRACT_SCHEMA_VERSION = "trade.rd-replay-decision-harness-worker-response-contract.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_POLICY_VERSION = "rd-replay-decision-harness-worker-response-v10-policy-v1" as const

export interface ReplayDecisionHarnessWorkerResponseV10 {
  schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  logical_request_id: string
  request_hash: string
  run_id: string
  code_admission_hash: string
  source_bundle_hash: string
  artifact_hash: string
  request_context_hash: string
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
  decision_state_snapshot_hash: string | null
  decision_output: ReplayDecisionOutput
  decision_output_hash: string
  trace: ReplaySupplementalValue
  trace_hash: string
  authority_status: "unadmitted_worker_claim"
  response_hash: string
}

export type ReplayDecisionHarnessWorkerResponseV10Body = Omit<ReplayDecisionHarnessWorkerResponseV10, "response_hash">

export const REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS = Object.freeze([
  "artifact_hash", "authority_status", "code_admission_hash", "decision_input_snapshot_hash",
  "decision_market_input_snapshot_hash", "decision_output", "decision_output_hash", "decision_state_snapshot_hash",
  "logical_request_id", "request_context_hash", "request_hash", "response_hash", "run_id", "schema_version",
  "source_bundle_hash", "trace", "trace_hash", "worker_protocol_version",
].sort())

export const REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS = Object.freeze([
  "logical_request_id", "request_hash", "run_id", "code_admission_hash", "source_bundle_hash", "artifact_hash",
  "request_context_hash", "decision_input_snapshot_hash", "decision_market_input_snapshot_hash",
  "decision_state_snapshot_hash",
])

export interface ReplayDecisionHarnessWorkerResponseV10Contract {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_hash: string
  response_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_POLICY_VERSION
  scope: "pre_execution_non_economic_worker_response_v10_contract"
  owner: "replay_runner_protocol_admission"
  purpose: "freeze_worker_response_v10_wire_and_exact_request_echo_without_response_instance"
  activation_status: "schema_frozen_response_not_materialized"
  parent_validation: "embedded_r4_108_request_materialization"
  field_policy: "exact_whitelist"
  request_echo_policy: "all_logical_request_identity_and_input_hashes_exact"
  response_self_validation: "decision_output_trace_and_response_hashes"
  decision_output_policy: "typed_shape_and_hash_only_schedule_authority_not_granted"
  migration_policy: "v9_response_and_receipt_execution_path_unchanged"
  source_request_materialization_id: string
  source_request_materialization_hash: string
  source_request_materialization: ReplayDecisionHarnessWorkerRequestV10Materialization
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  worker_response_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
  response_field_whitelist: string[]
  request_echo_fields: string[]
  response_instance_count: 0
  response_instances: []
  response_admission: "not_granted"
  execution_envelope: "not_materialized"
  process_receipt: "not_materialized"
  harness_receipt: "not_materialized"
  transport: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerResponseV10ContractBody = Omit<
  ReplayDecisionHarnessWorkerResponseV10Contract, "contract_hash"
>

export function createReplayDecisionHarnessWorkerResponseV10Contract(
  body: ReplayDecisionHarnessWorkerResponseV10ContractBody,
): ReplayDecisionHarnessWorkerResponseV10Contract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerResponseV10Contract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerResponseV10(
  value: ReplayDecisionHarnessWorkerResponseV10,
  request?: ReplayDecisionHarnessWorkerRequestV10,
): void {
  assertFields(value, REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS, "decision harness Worker Response v10")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.authority_status !== "unadmitted_worker_claim") {
    throw new Error("unsupported decision harness Worker Response v10 authority")
  }
  requireText(value.run_id, "decision harness Worker Response v10 run identity")
  for (const item of [value.logical_request_id, value.request_hash, value.code_admission_hash,
    value.source_bundle_hash, value.artifact_hash, value.request_context_hash,
    value.decision_input_snapshot_hash, value.decision_market_input_snapshot_hash,
    value.decision_output_hash, value.trace_hash, value.response_hash]) {
    requireHash(item, "decision harness Worker Response v10 hash")
  }
  if (value.decision_state_snapshot_hash !== null) {
    requireHash(value.decision_state_snapshot_hash, "decision harness Worker Response v10 State hash")
  }
  assertReplayDecisionOutput(value.decision_output)
  if (value.decision_output_hash !== canonicalHash(value.decision_output)
      || value.trace_hash !== canonicalHash(value.trace)) {
    throw new Error("decision harness Worker Response v10 payload hash drift")
  }
  if (request) {
    assertReplayDecisionHarnessWorkerRequestV10(request)
    for (const field of REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS) {
      const key = field as keyof ReplayDecisionHarnessWorkerRequestV10
      if (canonicalHash(value[key as keyof ReplayDecisionHarnessWorkerResponseV10]) !== canonicalHash(request[key])) {
        throw new Error("decision harness Worker Response v10 Request echo drift")
      }
    }
  }
  const { response_hash: responseHash, ...body } = value
  if (responseHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker Response v10 self-hash drift")
  }
}

export function assertReplayDecisionHarnessWorkerResponseV10Contract(
  value: ReplayDecisionHarnessWorkerResponseV10Contract,
): void {
  assertFields(value, CONTRACT_FIELDS, "decision harness Worker Response v10 contract")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_CONTRACT_SCHEMA_VERSION
      || value.response_policy_version !== REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_POLICY_VERSION
      || value.scope !== "pre_execution_non_economic_worker_response_v10_contract"
      || value.owner !== "replay_runner_protocol_admission"
      || value.purpose !== "freeze_worker_response_v10_wire_and_exact_request_echo_without_response_instance"
      || value.activation_status !== "schema_frozen_response_not_materialized"
      || value.parent_validation !== "embedded_r4_108_request_materialization"
      || value.field_policy !== "exact_whitelist"
      || value.request_echo_policy !== "all_logical_request_identity_and_input_hashes_exact"
      || value.response_self_validation !== "decision_output_trace_and_response_hashes"
      || value.decision_output_policy !== "typed_shape_and_hash_only_schedule_authority_not_granted"
      || value.migration_policy !== "v9_response_and_receipt_execution_path_unchanged"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.worker_request_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
      || value.worker_response_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
      || canonicalHash(value.response_field_whitelist) !== canonicalHash(REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS)
      || canonicalHash(value.request_echo_fields) !== canonicalHash(REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS)
      || value.response_instance_count !== 0 || value.response_instances.length !== 0
      || value.response_admission !== "not_granted" || value.execution_envelope !== "not_materialized"
      || value.process_receipt !== "not_materialized" || value.harness_receipt !== "not_materialized"
      || value.transport !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker Response v10 contract authority")
  }
  for (const item of [value.contract_id, value.source_request_materialization_id]) {
    requireText(item, "decision harness Worker Response v10 contract identity")
  }
  for (const item of [value.contract_hash, value.source_request_materialization_hash]) {
    requireHash(item, "decision harness Worker Response v10 contract hash")
  }
  assertReplayDecisionHarnessWorkerRequestV10Materialization(value.source_request_materialization)
  if (value.source_request_materialization_id !== value.source_request_materialization.materialization_id
      || value.source_request_materialization_hash !== value.source_request_materialization.materialization_hash) {
    throw new Error("decision harness Worker Response v10 contract parent binding drift")
  }
  const { contract_hash: contractHash, ...body } = value
  const { contract_id: contractId, ...bodyWithoutId } = body
  if (contractId !== `decision-harness-worker-response-v10-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || contractHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker Response v10 contract identity or hash mismatch")
  }
}

const CONTRACT_FIELDS = ["activation_status", "contract_hash", "contract_id", "decision_output_authority",
  "decision_output_policy", "economic_authority", "execution_envelope", "field_policy", "harness_invocation",
  "harness_receipt", "migration_policy", "order_authority", "owner", "parent_validation", "process_receipt",
  "purpose", "request_echo_fields", "request_echo_policy", "response_admission", "response_field_whitelist",
  "response_instance_count", "response_instances", "response_policy_version", "response_self_validation",
  "schema_version", "scope", "signal_authority", "source_request_materialization",
  "source_request_materialization_hash", "source_request_materialization_id", "transport", "trial_authority",
  "worker_protocol_version", "worker_request_schema_version", "worker_response_schema_version"].sort()

function assertFields(value: object, expected: readonly string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
