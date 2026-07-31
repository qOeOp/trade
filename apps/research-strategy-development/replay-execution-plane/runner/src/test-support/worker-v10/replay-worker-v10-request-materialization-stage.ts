import { expect } from "bun:test"
import type {
  ReplayDecisionHarnessLogicalRequestIdentityUpgrade,
} from "../../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10,
  assertReplayDecisionHarnessWorkerRequestV10Materialization,
  type ReplayDecisionHarnessWorkerRequestV10,
  type ReplayDecisionHarnessWorkerRequestV10Materialization,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import type {
  ReplayDecisionStateSnapshot,
} from "../../../../contracts/src/lib/replay-contracts"
import type {
  ReplayDecisionWorkerInputAssemblyV2,
} from "../../../../contracts/src/lib/replay-decision-worker-input-assembly-v2"
import {
  assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage,
  buildReplayDecisionHarnessWorkerRequestV10Materialization,
} from "../../lib/replay-decision-harness-worker-request-v10"

export interface ReplayWorkerV10RequestMaterializationStageInput {
  identity_upgrade: ReplayDecisionHarnessLogicalRequestIdentityUpgrade
  source_assembly_v2: ReplayDecisionWorkerInputAssemblyV2
  decision_state_snapshot: ReplayDecisionStateSnapshot
  profile(stage: string): void
}

export interface ReplayWorkerV10RequestMaterializationStageOutput {
  request_materialization: ReplayDecisionHarnessWorkerRequestV10Materialization
  first_request: ReplayDecisionHarnessWorkerRequestV10
}

export function runReplayWorkerV10RequestMaterializationStage(
  input: ReplayWorkerV10RequestMaterializationStageInput,
): ReplayWorkerV10RequestMaterializationStageOutput {
  const identityUpgrade = input.identity_upgrade
  const sourceAssemblyV2 = input.source_assembly_v2
  const snapshot = input.decision_state_snapshot

  const requestV10Input = { source_identity_upgrade: identityUpgrade }
  const requestV10Materialization = buildReplayDecisionHarnessWorkerRequestV10Materialization(requestV10Input)
  expect(requestV10Materialization.owner).toBe("replay_runner_protocol_admission")
  expect(requestV10Materialization.activation_status).toBe("contract_materialized_non_executable")
  expect(requestV10Materialization.field_policy).toBe("exact_whitelist_no_attempt_or_process_fields")
  expect(requestV10Materialization.self_validation_policy).toBe("content_hashes_logical_id_and_request_hash")
  expect(requestV10Materialization.migration_policy).toBe("v9_execution_unchanged_v10_contract_only")
  expect(requestV10Materialization.activation_gate)
    .toBe("response_echo_execution_envelope_transport_and_worker_certification_required")
  expect(requestV10Materialization.request_count).toBe(2)
  expect(requestV10Materialization.response_contract).toBe("not_materialized")
  expect(requestV10Materialization.execution_envelope).toBe("not_materialized")
  expect(requestV10Materialization.transport).toBe("forbidden")
  expect(requestV10Materialization.harness_invocation).toBe("forbidden")
  expect(requestV10Materialization.trial_authority).toBe("none")
  const firstRequestV10 = requestV10Materialization.requests[0]!
  expect(firstRequestV10.schema_version).toBe("trade.rd-replay-decision-harness-worker-request.v10")
  expect(firstRequestV10.worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v10")
  expect(firstRequestV10.logical_request_id).toBe(identityUpgrade.entries[0]!.logical_request_id)
  expect(firstRequestV10.legacy_v9_invocation_id).toBe(identityUpgrade.entries[0]!.legacy_v9_invocation_id)
  expect(firstRequestV10.request_context).toEqual(sourceAssemblyV2.entries[0]!.harness_context)
  expect(firstRequestV10.decision_input_snapshot).toEqual(sourceAssemblyV2.entries[0]!.decision_input_snapshot)
  expect(firstRequestV10.decision_market_input_snapshot)
    .toEqual(sourceAssemblyV2.entries[0]!.decision_market_input_snapshot)
  expect(firstRequestV10.decision_state_snapshot).toBeNull()
  expect(requestV10Materialization.requests[1]!.decision_state_snapshot).toEqual(snapshot)
  expect(firstRequestV10.execution_admission).toBe("not_granted")
  expect(firstRequestV10.execution_envelope).toBeNull()
  expect(firstRequestV10.transport_status).toBe("not_invoked")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10(firstRequestV10)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerRequestV10Materialization(requestV10Materialization)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage(
    requestV10Materialization,
    requestV10Input,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerRequestV10Materialization({
    source_identity_upgrade: structuredClone(identityUpgrade),
  })).toEqual(requestV10Materialization)
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    attempt_lease_hash: firstRequestV10.request_hash,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    logical_request_id: "b".repeat(64),
  })).toThrow("logical identity or self-hash drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    request_context: {
      ...firstRequestV10.request_context,
      candidate_hash: "b".repeat(64),
    },
  })).toThrow("embedded input hash or run binding drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10Materialization({
    ...requestV10Materialization,
    transport: "stdio" as never,
  })).toThrow("unsupported decision harness Worker Request v10 materialization authority")

  input.profile("worker request identity")
  return {
    request_materialization: requestV10Materialization,
    first_request: firstRequestV10,
  }
}
