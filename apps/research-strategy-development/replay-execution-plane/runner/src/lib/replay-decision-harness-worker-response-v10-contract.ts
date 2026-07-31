import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_CONTRACT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerResponseV10Contract,
  createReplayDecisionHarnessWorkerResponseV10Contract,
  type ReplayDecisionHarnessWorkerResponseV10Contract,
  type ReplayDecisionHarnessWorkerResponseV10ContractBody,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessWorkerRequestV10Materialization,
  type ReplayDecisionHarnessWorkerRequestV10Materialization,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"

export interface ReplayDecisionHarnessWorkerResponseV10ContractInput {
  source_request_materialization: ReplayDecisionHarnessWorkerRequestV10Materialization
}

export function buildReplayDecisionHarnessWorkerResponseV10Contract(
  input: ReplayDecisionHarnessWorkerResponseV10ContractInput,
): ReplayDecisionHarnessWorkerResponseV10Contract {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessWorkerResponseV10Contract({
    ...bodyWithoutId,
    contract_id: `decision-harness-worker-response-v10-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessWorkerResponseV10ContractLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessWorkerResponseV10ContractLineage(
  value: ReplayDecisionHarnessWorkerResponseV10Contract,
  input: ReplayDecisionHarnessWorkerResponseV10ContractInput,
): void {
  assertReplayDecisionHarnessWorkerResponseV10Contract(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessWorkerResponseV10Contract({
    ...bodyWithoutId,
    contract_id: `decision-harness-worker-response-v10-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker Response v10 contract parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessWorkerResponseV10ContractInput,
): Omit<ReplayDecisionHarnessWorkerResponseV10ContractBody, "contract_id"> {
  assertReplayDecisionHarnessWorkerRequestV10Materialization(input.source_request_materialization)
  const source = input.source_request_materialization
  return {
    schema_version: REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_CONTRACT_SCHEMA_VERSION,
    response_policy_version: REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_POLICY_VERSION,
    scope: "pre_execution_non_economic_worker_response_v10_contract",
    owner: "replay_runner_protocol_admission",
    purpose: "freeze_worker_response_v10_wire_and_exact_request_echo_without_response_instance",
    activation_status: "schema_frozen_response_not_materialized",
    parent_validation: "embedded_r4_108_request_materialization",
    field_policy: "exact_whitelist",
    request_echo_policy: "all_logical_request_identity_and_input_hashes_exact",
    response_self_validation: "decision_output_trace_and_response_hashes",
    decision_output_policy: "typed_shape_and_hash_only_schedule_authority_not_granted",
    migration_policy: "v9_response_and_receipt_execution_path_unchanged",
    source_request_materialization_id: source.materialization_id,
    source_request_materialization_hash: source.materialization_hash,
    source_request_materialization: structuredClone(source),
    worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
    worker_response_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
    response_field_whitelist: [...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS],
    request_echo_fields: [...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS],
    response_instance_count: 0,
    response_instances: [],
    response_admission: "not_granted",
    execution_envelope: "not_materialized",
    process_receipt: "not_materialized",
    harness_receipt: "not_materialized",
    transport: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  }
}
