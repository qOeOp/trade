import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  readRememberedReplayDurableParentValidation,
  readReplayDurableParentValidationReceipt,
  rememberReplayDurableParentValidation,
  registerReplayDurableParentValidationReceipt,
} from "./replay-durable-parent-validation-receipt"
import { readReplayWorkerV10SuccessorExecutionEnvelope } from "./replay-worker-v10-successor-execution-envelope-registry"
import type { RegisterReplayWorkerV10SuccessorExecutionTransportInput } from "./replay-worker-v10-successor-execution-transport-types"

export function requireReplayWorkerV10SuccessorExecutionTransportParent(
  input: RegisterReplayWorkerV10SuccessorExecutionTransportInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  return readReplayWorkerV10SuccessorExecutionEnvelopeParent(input)
}

export function readReplayWorkerV10SuccessorExecutionEnvelopeParent(
  input: RegisterReplayWorkerV10SuccessorExecutionTransportInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Transport registry root is required")
  }
  const expected = input.source_successor_execution_envelope_admission
  if (typeof expected?.admission_key !== "string"
      || !/^[a-f0-9]{64}$/.test(expected.admission_key)
      || typeof expected.admission_hash !== "string"
      || !/^[a-f0-9]{64}$/.test(expected.admission_hash)) {
    throw new Error("successor execution Transport Envelope Admission reference is invalid")
  }
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-execution-envelope-${expected.admission_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor execution Transport requires the exact durable R4.144 Envelope Admission")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Transport R4.144 Envelope Admission must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const fileSha256 = createHash("sha256").update(content, "utf8").digest("hex")
  const receipt = readReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_envelope_admission",
    parent_key: expected.admission_key,
  })
  if (receipt?.parent_self_hash === expected.admission_hash
      && receipt.parent_canonical_file_sha256 === fileSha256) {
    const durable = readRememberedReplayDurableParentValidation<
      ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
    >({
      registry_root: input.registry_root,
      parent_kind: "worker_v10_successor_execution_envelope_admission",
      parent_key: expected.admission_key,
      parent_canonical_file_sha256: fileSha256,
    })
    if (durable) {
      if (durable.admission_key !== expected.admission_key
          || durable.admission_hash !== expected.admission_hash) {
        throw new Error("successor execution Transport R4.144 Envelope Admission reference drift")
      }
      return durable
    }
  }
  const durable = readReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: input.registry_root,
    source_successor_lease_admission: expected.source_successor_lease_admission,
  })
  if (!durable || durable.admission_hash !== expected.admission_hash) {
    throw new Error("successor execution Transport requires the exact durable R4.144 Envelope Admission")
  }
  const validatedReceipt = registerReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_envelope_admission",
    parent_key: durable.admission_key,
    parent_self_hash: durable.admission_hash,
    parent_canonical_content: content,
  })
  rememberReplayDurableParentValidation({
    registry_root: input.registry_root,
    parent_kind: validatedReceipt.parent_kind,
    parent_key: validatedReceipt.parent_key,
    parent_canonical_file_sha256: validatedReceipt.parent_canonical_file_sha256,
    value: durable,
  })
  return durable
}

export function extractReplayWorkerV10PredecessorTransportContract(
  envelopeAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
): ReplayDecisionHarnessWorkerV10TransportContract {
  const pair = envelopeAdmission.source_successor_lease_admission.source_successor_authority_contract
    .source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const predecessorCommand = command.source_authority_transport_contract.source_activated_stdio_capability
    .source_authority_frame_build_contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const transport = predecessorCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract.source_negative_probe_receipt
    .source_stdio_capability.source_transport_contract
  if (transport.source_execution_envelope_hash
      !== envelopeAdmission.source_predecessor_execution_envelope_hash) {
    throw new Error("successor execution Transport Admission does not embed its exact predecessor Transport")
  }
  return structuredClone(transport)
}
