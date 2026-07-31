import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10ActivatedStdioCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS,
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { assertReplayDecisionHarnessWorkerV10AuthorityTransportContractLineage, buildReplayDecisionHarnessWorkerV10AuthorityTransportContract } from "../../lib/replay-decision-harness-worker-v10-authority-transport-contract"
import { readReplayWorkerV10AuthorityTransportContract, registerReplayWorkerV10AuthorityTransportContract } from "../../lib/replay-worker-v10-authority-transport-contract-registry"

export interface ReplayWorkerV10AuthorityTransportContractStageInput {
  registry_root: string
  activated_stdio: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
}

export function runReplayWorkerV10AuthorityTransportContractStage(
  input: ReplayWorkerV10AuthorityTransportContractStageInput,
) {
  const transportInput = { source_activated_stdio_capability: input.activated_stdio }
  const transport = buildReplayDecisionHarnessWorkerV10AuthorityTransportContract(transportInput)
  expect(transport.status)
    .toBe("activated_artifact_bound_authority_issuance_blocked_zero_process")
  expect(transport.activated_process_artifact_hash).toBe(input.activated_stdio.artifact.sha256)
  expect(transport.source_predecessor_transport_contract_hash)
    .toBe(input.predecessor_successor_transport_contract.contract_hash)
  expect(transport.request_frame_schema_version)
    .toBe(input.activated_stdio.request_frame_schema_version)
  expect(transport.response_frame_schema_version)
    .toBe(input.activated_stdio.response_frame_schema_version)
  expect(transport.authority_capsule_intent_binding)
    .toBe("future_successor_intent_hash_derived_at_spawn_not_stored_in_intent_payload")
  expect(transport.process_receipt_required_bindings)
    .toEqual(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS)
  expect(transport.blockers).toEqual([
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(transport.activated_stdio_artifact_count).toBe(1)
  expect(transport.authority_transport_contract_instance_count).toBe(1)
  expect(transport.successor_execution_admission_command_count).toBe(0)
  expect(transport.successor_process_launch_intent_count).toBe(0)
  expect(transport.authority_capsule_instance_count).toBe(0)
  expect(transport.process_launch_receipt_count).toBe(0)
  expect(transport.request_frame_instance_count).toBe(0)
  expect(transport.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(transport))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContractLineage(
    transport,
    transportInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContract({
    ...transport,
    activated_process_artifact_hash:
      input.predecessor_successor_transport_contract.successor_process_artifact_hash,
  })).toThrow("parent or artifact binding drift")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-transport-missing-"))
  try {
    expect(() => registerReplayWorkerV10AuthorityTransportContract({
      registry_root: missingRoot,
      ...transportInput,
    })).toThrow("requires the exact durable Activated Stdio Capability")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10AuthorityTransportContract({
    registry_root: input.registry_root,
    ...transportInput,
  })).toEqual(transport)
  expect(readReplayWorkerV10AuthorityTransportContract({
    registry_root: input.registry_root,
    ...transportInput,
  })).toEqual(transport)
  return { transport_input: transportInput, transport }
}
