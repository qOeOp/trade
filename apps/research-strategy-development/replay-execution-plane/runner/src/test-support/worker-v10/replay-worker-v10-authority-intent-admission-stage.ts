import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createReplayAttemptLeaseObservationSnapshot, type ReplayAttemptLeaseObservationBody, type ReplayDispatchClockAttestation } from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV, type ReplayDecisionHarnessWorkerV10ActivatedStdioCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import { assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10AuthorityTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { createReplayWorkerV10LeaseClockEvidenceFixture } from "./replay-worker-v10-lease-clock-evidence-fixture"
import { assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentLineage, buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent } from "../../lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import { issueReplayWorkerV10AuthorityProcessLaunchIntent, readReplayWorkerV10AuthorityProcessLaunchIntent } from "../../lib/replay-worker-v10-authority-process-launch-intent-registry"

export interface ReplayWorkerV10AuthorityIntentAdmissionStageInput {
  registry_root: string
  lease_observation_body: ReplayAttemptLeaseObservationBody
  authority_transport: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  activated_stdio: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  authority_command: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand
  authority_command_clock: ReplayDispatchClockAttestation
}

export function runReplayWorkerV10AuthorityIntentAdmissionStage(
  input: ReplayWorkerV10AuthorityIntentAdmissionStageInput,
) {
  const observation = createReplayAttemptLeaseObservationSnapshot({
    ...input.lease_observation_body,
    observation_id: "lease-observation-envelope-authority-intent",
    observation_ref: "observation://replay-attempt-lease/authority-intent",
    observed_at: "2026-07-14T00:00:48Z",
  })
  const evidence = createReplayWorkerV10LeaseClockEvidenceFixture({
    observation,
    registered_at: "2026-07-14T00:00:49Z",
    read_at: "2026-07-14T00:00:50Z",
    read_started_monotonic_ns: "6000000",
  })
  const clock = evidence.build_clock("2026-07-14T00:00:51Z", "6000100")
  const intentInput = {
    source_authority_execution_admission_command: input.authority_command,
    post_command_clock_attestation: clock,
  }
  const intent = buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(intentInput)
  expect(intent.status).toBe("intent_committed_capsule_and_process_not_materialized")
  expect(intent.source_authority_execution_admission_command_hash)
    .toBe(input.authority_command.command_hash)
  expect(intent.source_authority_transport_contract_hash).toBe(input.authority_transport.contract_hash)
  expect(intent.process_artifact_hash).toBe(input.activated_stdio.artifact.sha256)
  expect(intent.process_artifact_file_name).toBe("worker-v10-authority-stdio.mjs")
  expect(intent.intent_issued_at).toBe(clock.registry_read_completed_at)
  expect(intent.authority_capsule_environment_variable)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV)
  expect(intent.authority_capsule_fields).toEqual(input.activated_stdio.authority_capsule_fields)
  expect(intent.authority_capsule_intent_binding)
    .toBe("intent_hash_added_after_exact_intent_commit_not_embedded_in_payload")
  expect(intent.blockers).toEqual([
    "authority_capsule_not_materialized",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(intent.authority_process_launch_intent_instance_count).toBe(1)
  expect(intent.authority_capsule_instance_count).toBe(0)
  expect(intent.process_launch_receipt_count).toBe(0)
  expect(intent.admitted_process_instance_count).toBe(0)
  expect(intent.request_frame_instance_count).toBe(0)
  expect(intent.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(intent))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentLineage(
    intent,
    intentInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent({
    ...intentInput,
    post_command_clock_attestation: input.authority_command_clock,
  })).toThrow("parent, revalidation, or executable binding drift")
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent({
    ...intent,
    process_artifact_hash:
      input.predecessor_successor_transport_contract.successor_process_artifact_hash,
  })).toThrow("parent, revalidation, or executable binding drift")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-intent-missing-"))
  try {
    expect(() => issueReplayWorkerV10AuthorityProcessLaunchIntent({
      registry_root: missingRoot,
      ...intentInput,
    })).toThrow("requires the exact durable Authority Command")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: input.registry_root,
    ...intentInput,
  })).toEqual(intent)
  expect(readReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: input.registry_root,
    ...intentInput,
  })).toEqual(intent)
  expect(() => issueReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: input.registry_root,
    source_authority_execution_admission_command: input.authority_command,
    post_command_clock_attestation:
      evidence.build_clock("2026-07-14T00:00:52Z", "6000200"),
  })).toThrow("natural key has different evidence")
  return {
    intent_input: intentInput,
    intent,
    intent_registry_receipt: evidence.registry_receipt,
  }
}
