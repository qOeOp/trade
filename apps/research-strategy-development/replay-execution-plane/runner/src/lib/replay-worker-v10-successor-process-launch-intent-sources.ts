import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { assertReplayAttemptLeaseObservationEnvelopeView } from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import { assertReplayDispatchClockAttestationView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import { assertReplayAttemptLeaseObservationRegistryReadReceiptView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
  ReplayWorkerV10SuccessorProcessLaunchIntentSources,
} from "./replay-worker-v10-successor-process-launch-intent-types"

export function readReplayWorkerV10SuccessorProcessLaunchIntentSources(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
): ReplayWorkerV10SuccessorProcessLaunchIntentSources {
  if (input.registry_root.trim() === "") {
    throw new Error("successor Process Launch Intent registry root is required")
  }
  const command = readAdmissionSnapshot<ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission>(
    input.registry_root,
    `worker-v10-successor-execution-command-admission-${input.source_successor_execution_command_admission.admission_key}.json`,
    input.source_successor_execution_command_admission.admission_key,
    input.source_successor_execution_command_admission.admission_hash,
    "R4.148 Command Admission",
  )
  const execution = readAdmissionSnapshot<ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission>(
    input.registry_root,
    `worker-v10-successor-execution-contract-${input.source_successor_execution_contract_admission.admission_key}.json`,
    input.source_successor_execution_contract_admission.admission_key,
    input.source_successor_execution_contract_admission.admission_hash,
    "R4.147 Execution Contract Admission",
  )
  const stdio = readAdmissionSnapshot<ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission>(
    input.registry_root,
    `worker-v10-successor-execution-stdio-probe-${input.source_successor_stdio_probe_admission.admission_key}.json`,
    input.source_successor_stdio_probe_admission.admission_key,
    input.source_successor_stdio_probe_admission.admission_hash,
    "R4.146 Stdio Probe Admission",
  )
  return {
    command: command.value,
    command_file_sha256: command.file_sha256,
    execution: execution.value,
    execution_file_sha256: execution.file_sha256,
    stdio: stdio.value,
    stdio_file_sha256: stdio.file_sha256,
  }
}

export function validateReplayWorkerV10SuccessorProcessLaunchIntentSources(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
  sources: ReplayWorkerV10SuccessorProcessLaunchIntentSources,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(sources.command)
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(sources.execution)
  assertReplayAttemptLeaseObservationEnvelopeView(input.post_command_lease_observation)
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(input.post_command_registry_read_receipt)
  assertReplayDispatchClockAttestationView(input.post_command_clock_attestation)
  assertSelfHash(sources.command, "admission_hash", "R4.148")
  assertSelfHash(sources.execution, "admission_hash", "R4.147")
  assertSelfHash(sources.stdio, "admission_hash", "R4.146")
  const parent = sources.command
  const command = parent.successor_execution_admission_command
  const execution = sources.execution
  const stdio = sources.stdio.successor_stdio_artifact_evidence
  const observation = input.post_command_lease_observation
  const receipt = input.post_command_registry_read_receipt
  const clock = input.post_command_clock_attestation
  if (parent.source_successor_execution_contract_admission_hash !== execution.admission_hash
      || execution.source_successor_execution_stdio_probe_admission_hash !== sources.stdio.admission_hash
      || execution.successor_stdio_capability_hash !== sources.stdio.successor_stdio_capability_hash
      || canonicalJson(receipt.source_observation) !== canonicalJson(observation)
      || canonicalJson(clock.source_registry_read_receipt) !== canonicalJson(receipt)
      || observation.attempt_id !== command.attempt_id
      || observation.attempt_ordinal !== command.attempt_ordinal
      || observation.worker_id !== command.worker_id
      || observation.lease_generation !== command.lease_generation
      || receipt.current_attempt_status !== "running"
      || receipt.current_attempt_lease_hash !== command.current_attempt_lease_hash
      || clock.current_attempt_lease_hash !== command.current_attempt_lease_hash
      || Date.parse(observation.observed_at) <= Date.parse(command.issued_at)
      || Date.parse(clock.registry_read_started_at) <= Date.parse(command.issued_at)
      || command.valid_before !== receipt.current_attempt_lease.lease_expires_at
      || stdio.artifact.sha256 !== command.successor_process_artifact_hash
      || stdio.artifact.sha256
        !== execution.successor_artifact_bound_transport_contract.successor_process_artifact_hash
      || command.transport_contract_hash
        !== execution.successor_artifact_bound_transport_contract_hash) {
    throw new Error("successor Process Launch Intent source or post-Command revalidation drift")
  }
}

function readAdmissionSnapshot<T extends object>(
  root: string,
  fileName: string,
  expectedKey: string,
  expectedHash: string,
  label: string,
): { value: T; file_sha256: string } {
  if (!/^[a-f0-9]{64}$/.test(expectedKey) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error(`successor Process Launch Intent ${label} reference is invalid`)
  }
  const path = join(resolve(root), fileName)
  if (!existsSync(path)) throw new Error(`successor Process Launch Intent requires exact durable ${label}`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`successor Process Launch Intent ${label} must be a regular file`)
  }
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as T
  const record = value as unknown as Record<string, unknown>
  if (record.admission_key !== expectedKey || record.admission_hash !== expectedHash) {
    throw new Error(`successor Process Launch Intent ${label} key or hash drift`)
  }
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error(`successor Process Launch Intent ${label} is not canonical`)
  }
  return {
    value,
    file_sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  }
}

function assertSelfHash(value: object, field: string, label: string): void {
  const body = structuredClone(value) as Record<string, unknown>
  const hash = body[field]
  delete body[field]
  if (typeof hash !== "string" || hash !== canonicalHash(body)) {
    throw new Error(`successor Process Launch Intent ${label} self-hash mismatch`)
  }
}
