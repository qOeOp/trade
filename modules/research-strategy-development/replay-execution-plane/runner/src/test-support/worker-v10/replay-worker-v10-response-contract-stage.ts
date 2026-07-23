import { expect } from "bun:test"
import { canonicalHash } from "../../../../contracts/src/lib/replay-contracts"
import type {
  ReplayDecisionHarnessWorkerRequestV10,
  ReplayDecisionHarnessWorkerRequestV10Materialization,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerResponseV10,
  assertReplayDecisionHarnessWorkerResponseV10Contract,
  type ReplayDecisionHarnessWorkerResponseV10,
  type ReplayDecisionHarnessWorkerResponseV10Body,
  type ReplayDecisionHarnessWorkerResponseV10Contract,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessWorkerResponseV10ContractLineage,
  buildReplayDecisionHarnessWorkerResponseV10Contract,
} from "../../lib/replay-decision-harness-worker-response-v10-contract"

export interface ReplayWorkerV10ResponseContractStageInput {
  request_materialization: ReplayDecisionHarnessWorkerRequestV10Materialization
  first_request: ReplayDecisionHarnessWorkerRequestV10
}

export interface ReplayWorkerV10ResponseContractStageOutput {
  response_contract: ReplayDecisionHarnessWorkerResponseV10Contract
  response: ReplayDecisionHarnessWorkerResponseV10
}

export function runReplayWorkerV10ResponseContractStage(
  input: ReplayWorkerV10ResponseContractStageInput,
): ReplayWorkerV10ResponseContractStageOutput {
  const requestV10Materialization = input.request_materialization
  const firstRequestV10 = input.first_request

  const responseV10ContractInput = { source_request_materialization: requestV10Materialization }
  const responseV10Contract = buildReplayDecisionHarnessWorkerResponseV10Contract(responseV10ContractInput)
  expect(responseV10Contract.owner).toBe("replay_runner_protocol_admission")
  expect(responseV10Contract.activation_status).toBe("schema_frozen_response_not_materialized")
  expect(responseV10Contract.worker_response_schema_version)
    .toBe("trade.rd-replay-decision-harness-worker-response.v10")
  expect(responseV10Contract.response_field_whitelist).toEqual([...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS])
  expect(responseV10Contract.request_echo_fields)
    .toEqual([...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS])
  expect(responseV10Contract.decision_output_policy)
    .toBe("typed_shape_and_hash_only_schedule_authority_not_granted")
  expect(responseV10Contract.migration_policy).toBe("v9_response_and_receipt_execution_path_unchanged")
  expect(responseV10Contract.response_instance_count).toBe(0)
  expect(responseV10Contract.response_instances).toEqual([])
  expect(responseV10Contract.response_admission).toBe("not_granted")
  expect(responseV10Contract.execution_envelope).toBe("not_materialized")
  expect(responseV10Contract.process_receipt).toBe("not_materialized")
  expect(responseV10Contract.harness_receipt).toBe("not_materialized")
  expect(responseV10Contract.transport).toBe("forbidden")
  expect(responseV10Contract.harness_invocation).toBe("forbidden")
  expect(responseV10Contract.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10Contract(responseV10Contract)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerResponseV10ContractLineage(
    responseV10Contract,
    responseV10ContractInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerResponseV10Contract({
    source_request_materialization: structuredClone(requestV10Materialization),
  })).toEqual(responseV10Contract)
  const responseOutput = { action: "no_action" as const }
  const responseTrace = { fixture: "schema-validation-only" }
  const responseV10Body: ReplayDecisionHarnessWorkerResponseV10Body = {
    schema_version: "trade.rd-replay-decision-harness-worker-response.v10",
    worker_protocol_version: firstRequestV10.worker_protocol_version,
    logical_request_id: firstRequestV10.logical_request_id,
    request_hash: firstRequestV10.request_hash,
    run_id: firstRequestV10.run_id,
    code_admission_hash: firstRequestV10.code_admission_hash,
    source_bundle_hash: firstRequestV10.source_bundle_hash,
    artifact_hash: firstRequestV10.artifact_hash,
    request_context_hash: firstRequestV10.request_context_hash,
    decision_input_snapshot_hash: firstRequestV10.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: firstRequestV10.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: firstRequestV10.decision_state_snapshot_hash,
    decision_output: responseOutput,
    decision_output_hash: canonicalHash(responseOutput),
    trace: responseTrace,
    trace_hash: canonicalHash(responseTrace),
    authority_status: "unadmitted_worker_claim",
  }
  const responseV10 = { ...responseV10Body, response_hash: canonicalHash(responseV10Body) }
  expect(() => assertReplayDecisionHarnessWorkerResponseV10(responseV10, firstRequestV10)).not.toThrow()
  const echoDriftBody = { ...responseV10Body, request_hash: "b".repeat(64) }
  expect(() => assertReplayDecisionHarnessWorkerResponseV10({
    ...echoDriftBody,
    response_hash: canonicalHash(echoDriftBody),
  }, firstRequestV10)).toThrow("Request echo drift")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10({
    ...responseV10,
    execution_envelope_hash: firstRequestV10.request_hash,
  } as never, firstRequestV10)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10Contract({
    ...responseV10Contract,
    response_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker Response v10 contract authority")
  return {
    response_contract: responseV10Contract,
    response: responseV10,
  }
}

