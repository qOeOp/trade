import { expect } from "bun:test"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  createReplayDispatchClockAttestation,
  replayDispatchClockAttestationIdentityHash,
  type ReplayAttemptLeaseObservationRegistryReadReceipt,
  type ReplayDispatchClockAttestation,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  readReplayWorkerV10AuthorityResponseValidation,
} from "./replay-worker-v10-authority-response-validation-registry"
import {
  readReplayWorkerV10AuthorityRequestDispatchReceipt,
} from "./replay-worker-v10-authority-request-dispatch-registry"
import {
  readReplayWorkerV10AuthorityProcessLaunchReceipt,
} from "./replay-worker-v10-authority-process-launch-registry"
import {
  readReplayWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "./replay-worker-v10-authority-spawn-boundary-revalidation-registry"
import {
  readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest,
} from "./replay-worker-v10-authority-spawn-boundary-revalidation-request-registry"
import { readReplayWorkerV10AuthorityCapsule } from "./replay-worker-v10-authority-capsule-registry"
import {
  readReplayWorkerV10AuthorityProcessLaunchIntent,
} from "./replay-worker-v10-authority-process-launch-intent-registry"
import {
  readReplayWorkerV10AuthorityExecutionAdmissionCommand,
} from "./replay-worker-v10-authority-execution-admission-command-registry"
import {
  readReplayWorkerV10AuthorityTransportContract,
} from "./replay-worker-v10-authority-transport-contract-registry"
import {
  readReplayWorkerV10ActivatedStdioCapability,
} from "./replay-worker-v10-activated-stdio-capability-registry"
import {
  readReplayWorkerV10AuthorityFrameBuildContract,
} from "./replay-worker-v10-authority-frame-build-contract-registry"
import {
  readReplayWorkerV10ProcessLaunchReadinessGate,
} from "./replay-worker-v10-process-launch-readiness-gate-registry"
import {
  buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-process-launch-intent"
import {
  issueReplayWorkerV10ProcessLaunchIntent,
  readReplayWorkerV10ProcessLaunchIntent,
} from "./replay-worker-v10-process-launch-intent-registry"
import {
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-execution-admission-command"
import {
  issueReplayWorkerV10ExecutionAdmissionCommand,
  readReplayWorkerV10ExecutionAdmissionCommand,
} from "./replay-worker-v10-execution-admission-command-registry"
import {
  readReplayWorkerV10ExecutionAdmissionClockAttestation,
  registerReplayWorkerV10ExecutionAdmissionClockAttestation,
} from "./replay-worker-v10-execution-admission-clock-attestation-registry"
import {
  readReplayWorkerV10ExecutionAdmissionRegistryProvenance,
} from "./replay-worker-v10-execution-admission-registry-provenance-registry"
import {
  readReplayWorkerV10ExecutionAdmissionPreIssueBundle,
} from "./replay-worker-v10-execution-admission-pre-issue-registry"
import {
  readReplayWorkerV10ExecutionAdmissionContract,
} from "./replay-worker-v10-execution-admission-contract-registry"
import {
  readReplayWorkerV10SuccessorTransportContract,
} from "./replay-worker-v10-successor-transport-contract-registry"
import { readReplayWorkerV10NegativeProbeReceipt } from "./replay-worker-v10-negative-probe-registry"
import { readReplayWorkerV10TransportContract } from "./replay-worker-v10-transport-contract-registry"

type RegistryInput<T extends (input: never) => unknown> =
  Omit<Parameters<T>[0], "registry_root">

export interface ReplayWorkerV10UpstreamIntegrityStageInput {
  registry_root: string
  authority_response_validation:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityResponseValidation>>
  authority_dispatch_receipt:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityRequestDispatchReceipt>>
  authority_process_receipt:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityProcessLaunchReceipt>>
  spawn_revalidation:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthoritySpawnBoundaryRevalidation>>
  spawn_revalidation_input:
    RegistryInput<typeof readReplayWorkerV10AuthoritySpawnBoundaryRevalidation>
  spawn_revalidation_request:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest>>
  spawn_revalidation_request_input:
    RegistryInput<typeof readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest>
  authority_capsule: NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityCapsule>>
  authority_capsule_input: RegistryInput<typeof readReplayWorkerV10AuthorityCapsule>
  authority_intent:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityProcessLaunchIntent>>
  authority_intent_input: RegistryInput<typeof readReplayWorkerV10AuthorityProcessLaunchIntent>
  authority_command:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityExecutionAdmissionCommand>>
  authority_command_input:
    RegistryInput<typeof readReplayWorkerV10AuthorityExecutionAdmissionCommand>
  authority_transport:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityTransportContract>>
  authority_transport_input: RegistryInput<typeof readReplayWorkerV10AuthorityTransportContract>
  activated_stdio: NonNullable<ReturnType<typeof readReplayWorkerV10ActivatedStdioCapability>>
  activated_stdio_input: RegistryInput<typeof readReplayWorkerV10ActivatedStdioCapability>
  authority_frame_build:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityFrameBuildContract>>
  authority_build_input: RegistryInput<typeof readReplayWorkerV10AuthorityFrameBuildContract>
  process_launch_readiness:
    NonNullable<ReturnType<typeof readReplayWorkerV10ProcessLaunchReadinessGate>>
  process_readiness_input: RegistryInput<typeof readReplayWorkerV10ProcessLaunchReadinessGate>
  post_command_registry_receipt: ReplayAttemptLeaseObservationRegistryReadReceipt
  post_command_read_at: string
  post_command_clock_attestation: ReplayDispatchClockAttestation
  execution_admission_command:
    NonNullable<ReturnType<typeof readReplayWorkerV10ExecutionAdmissionCommand>>
  process_launch_intent: NonNullable<ReturnType<typeof readReplayWorkerV10ProcessLaunchIntent>>
  process_intent_input: RegistryInput<typeof readReplayWorkerV10ProcessLaunchIntent>
  registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceipt
  clock_attestation: ReplayDispatchClockAttestation
  registry_provenance:
    NonNullable<ReturnType<typeof readReplayWorkerV10ExecutionAdmissionRegistryProvenance>>
  clock_binding:
    NonNullable<ReturnType<typeof readReplayWorkerV10ExecutionAdmissionClockAttestation>>
  command_input: RegistryInput<typeof readReplayWorkerV10ExecutionAdmissionCommand>
  clock_binding_input: RegistryInput<typeof readReplayWorkerV10ExecutionAdmissionClockAttestation>
  registry_provenance_input:
    RegistryInput<typeof readReplayWorkerV10ExecutionAdmissionRegistryProvenance>
  pre_issue_input: RegistryInput<typeof readReplayWorkerV10ExecutionAdmissionPreIssueBundle>
  execution_admission_contract:
    NonNullable<ReturnType<typeof readReplayWorkerV10ExecutionAdmissionContract>>
  successor_transport_contract:
    NonNullable<ReturnType<typeof readReplayWorkerV10SuccessorTransportContract>>
  negative_probe_receipt: NonNullable<ReturnType<typeof readReplayWorkerV10NegativeProbeReceipt>>
  durable_stdio_capability:
    Parameters<typeof readReplayWorkerV10NegativeProbeReceipt>[0]["source_stdio_capability"]
  worker_v10_transport_contract:
    NonNullable<ReturnType<typeof readReplayWorkerV10TransportContract>>
  transport_contract_input: RegistryInput<typeof readReplayWorkerV10TransportContract>
}

export function runReplayWorkerV10UpstreamIntegrityStage(
  input: ReplayWorkerV10UpstreamIntegrityStageInput,
): void {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const authorityResponseValidation = input.authority_response_validation
  const authorityDispatchReceipt = input.authority_dispatch_receipt
  const authorityProcessReceipt = input.authority_process_receipt
  const spawnRevalidation = input.spawn_revalidation
  const spawnRevalidationInput = input.spawn_revalidation_input
  const spawnRevalidationRequest = input.spawn_revalidation_request
  const spawnRevalidationRequestInput = input.spawn_revalidation_request_input
  const authorityCapsule = input.authority_capsule
  const authorityCapsuleInput = input.authority_capsule_input
  const authorityIntent = input.authority_intent
  const authorityIntentInput = input.authority_intent_input
  const authorityCommand = input.authority_command
  const authorityCommandInput = input.authority_command_input
  const authorityTransport = input.authority_transport
  const authorityTransportInput = input.authority_transport_input
  const activatedStdio = input.activated_stdio
  const activatedStdioInput = input.activated_stdio_input
  const authorityFrameBuild = input.authority_frame_build
  const authorityBuildInput = input.authority_build_input
  const processLaunchReadiness = input.process_launch_readiness
  const processReadinessInput = input.process_readiness_input
  const postCommandRegistryReceipt = input.post_command_registry_receipt
  const postCommandReadAt = input.post_command_read_at
  const postCommandClockAttestation = input.post_command_clock_attestation
  const executionAdmissionCommand = input.execution_admission_command
  const processLaunchIntent = input.process_launch_intent
  const processIntentInput = input.process_intent_input
  const registryReadReceipt = input.registry_read_receipt
  const clockAttestation = input.clock_attestation
  const registryProvenance = input.registry_provenance
  const clockBinding = input.clock_binding
  const commandInput = input.command_input
  const clockBindingInput = input.clock_binding_input
  const registryProvenanceInput = input.registry_provenance_input
  const preIssueInput = input.pre_issue_input
  const executionAdmissionContract = input.execution_admission_contract
  const successorTransportContract = input.successor_transport_contract
  const negativeProbeReceipt = input.negative_probe_receipt
  const durableStdioCapability = input.durable_stdio_capability
  const workerV10TransportContract = input.worker_v10_transport_contract
  const transportContractInput = input.transport_contract_input

  const authorityResponseValidationFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-authority-response-validation-${authorityResponseValidation.validation_key}.json`)
  if (!authorityResponseValidationFile) throw new Error("expected Worker v10 Authority Response Validation file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityResponseValidationFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityResponseValidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_dispatch_receipt: authorityDispatchReceipt,
  })).toThrow()

  const authorityDispatchReceiptFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-authority-request-dispatch-receipt-${authorityDispatchReceipt.receipt_key}.json`)
  if (!authorityDispatchReceiptFile) throw new Error("expected Worker v10 Authority Request Dispatch Receipt file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityDispatchReceiptFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityRequestDispatchReceipt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_process_launch_receipt: authorityProcessReceipt,
  })).toThrow()

  const authorityProcessReceiptFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-authority-process-launch-receipt-${authorityProcessReceipt.receipt_key}.json`)
  if (!authorityProcessReceiptFile) throw new Error("expected Worker v10 Authority Process Launch Receipt file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityProcessReceiptFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityProcessLaunchReceipt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_spawn_revalidation: spawnRevalidation,
  })).toThrow()

  const spawnRevalidationFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-authority-spawn-revalidation-${spawnRevalidation.binding_key}.json`)
  if (!spawnRevalidationFile) throw new Error("expected Worker v10 Authority Spawn Revalidation file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, spawnRevalidationFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...spawnRevalidationInput,
  })).toThrow()
  const spawnRevalidationRequestFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-authority-spawn-revalidation-request-${spawnRevalidationRequest.request_key}.json`)
  if (!spawnRevalidationRequestFile) throw new Error("expected Worker v10 spawn revalidation Request file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, spawnRevalidationRequestFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
    registry_root: dispatchEvidenceRegistryRoot,
    ...spawnRevalidationRequestInput,
  })).toThrow()

  const authorityCapsuleFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-authority-capsule-${authorityCapsule.capsule_key}.json`)
  if (!authorityCapsuleFile) throw new Error("expected Worker v10 Authority Capsule file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityCapsuleFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityCapsuleInput,
  })).toThrow()

  const authorityIntentFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-authority-process-launch-intent-${authorityIntent.intent_key}.json`)
  if (!authorityIntentFile) throw new Error("expected Worker v10 Authority Process Launch Intent file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityIntentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityIntentInput,
  })).toThrow()

  const authorityCommandFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-authority-execution-command-${authorityCommand.command_key}.json`)
  if (!authorityCommandFile) throw new Error("expected Worker v10 Authority Execution Admission Command file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityCommandFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityCommandInput,
  })).toThrow()

  const authorityTransportFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-authority-transport-${authorityTransport.contract_key}.json`)
  if (!authorityTransportFile) throw new Error("expected Worker v10 Authority Transport Contract file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityTransportFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityTransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityTransportInput,
  })).toThrow()

  const activatedStdioFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-activated-stdio-${activatedStdio.capability_key}.json`)
  if (!activatedStdioFile) throw new Error("expected Worker v10 Activated Stdio Capability file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, activatedStdioFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ActivatedStdioCapability({
    registry_root: dispatchEvidenceRegistryRoot,
    ...activatedStdioInput,
  })).toThrow()

  const authorityBuildFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-authority-frame-build-${authorityFrameBuild.contract_key}.json`)
  if (!authorityBuildFile) throw new Error("expected Worker v10 Authority Frame Build Contract file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityBuildFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityFrameBuildContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityBuildInput,
  })).toThrow()

  const processReadinessFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-process-launch-readiness-${processLaunchReadiness.gate_key}.json`)
  if (!processReadinessFile) throw new Error("expected Worker v10 Process Launch Readiness Gate file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, processReadinessFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ProcessLaunchReadinessGate({
    registry_root: dispatchEvidenceRegistryRoot,
    ...processReadinessInput,
  })).toThrow()

  const alternatePostCommandClockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: postCommandRegistryReceipt.receipt_hash,
    registry_read_started_at: postCommandReadAt,
    registry_read_completed_at: "2026-07-14T00:00:42Z",
    registry_read_started_monotonic_ns: "4000000",
    registry_read_completed_monotonic_ns: "4000200",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const alternatePostCommandClockAttestation = createReplayDispatchClockAttestation({
    ...((({ attestation_hash: _hash, ...body }) => body)(postCommandClockAttestation)),
    attestation_id: `replay-dispatch-clock-attestation-${alternatePostCommandClockIdentityHash.slice(0, 24)}`,
    attestation_ref: `attestation://replay-dispatch-clock/${alternatePostCommandClockIdentityHash.slice(0, 24)}`,
    registry_read_completed_at: "2026-07-14T00:00:42Z",
    registry_read_completed_monotonic_ns: "4000200",
  })
  const alternateProcessLaunchIntent = buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    source_execution_admission_command: executionAdmissionCommand,
    post_command_clock_attestation: alternatePostCommandClockAttestation,
  })
  expect(alternateProcessLaunchIntent.intent_key).toBe(processLaunchIntent.intent_key)
  expect(alternateProcessLaunchIntent.intent_hash).not.toBe(processLaunchIntent.intent_hash)
  expect(() => issueReplayWorkerV10ProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    source_execution_admission_command: executionAdmissionCommand,
    post_command_clock_attestation: alternatePostCommandClockAttestation,
  })).toThrow("natural key is already issued with different evidence")
  const processIntentFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name === `worker-v10-process-launch-intent-${processLaunchIntent.intent_key}.json`)
  if (!processIntentFile) throw new Error("expected Worker v10 Process Launch Intent file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, processIntentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...processIntentInput,
  })).toThrow()

  const alternateClockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: registryReadReceipt.receipt_hash,
    registry_read_started_at: registryReadReceipt.read_at,
    registry_read_completed_at: "2026-07-14T00:00:37Z",
    registry_read_started_monotonic_ns: "3000000",
    registry_read_completed_monotonic_ns: "3000200",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const alternateClockAttestation = createReplayDispatchClockAttestation({
    ...((({ attestation_hash: _hash, ...body }) => body)(clockAttestation)),
    attestation_id: `replay-dispatch-clock-attestation-${alternateClockIdentityHash.slice(0, 24)}`,
    attestation_ref: `attestation://replay-dispatch-clock/${alternateClockIdentityHash.slice(0, 24)}`,
    registry_read_completed_at: "2026-07-14T00:00:37Z",
    registry_read_completed_monotonic_ns: "3000200",
  })
  const alternateClockBindingInput = {
    source_registry_provenance: registryProvenance,
    control_plane_clock_attestation: alternateClockAttestation,
  }
  const alternateClockBinding = registerReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...alternateClockBindingInput,
  })
  const alternateCommand = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand({
    source_clock_binding: alternateClockBinding,
  })
  expect(alternateCommand.command_key).toBe(executionAdmissionCommand.command_key)
  expect(alternateCommand.command_hash).not.toBe(executionAdmissionCommand.command_hash)
  expect(() => issueReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    source_clock_binding: alternateClockBinding,
  })).toThrow("natural key is already issued with different evidence")

  const commandFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name.startsWith("worker-v10-execution-admission-command-"))
  if (!commandFile) throw new Error("expected Execution Admission Command file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, commandFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...commandInput,
  })).toThrow()
  const clockBindingFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-execution-admission-clock-attestation-${clockBinding.binding_key}.json`)
  if (!clockBindingFile) throw new Error("expected Execution Admission clock attestation file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, clockBindingFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...clockBindingInput,
  })).toThrow()
  const registryProvenanceFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name.startsWith("worker-v10-execution-admission-registry-provenance-"))
  if (!registryProvenanceFile) throw new Error("expected Execution Admission registry provenance file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, registryProvenanceFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: dispatchEvidenceRegistryRoot,
    ...registryProvenanceInput,
  })).toThrow()
  const preIssueFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name.startsWith("worker-v10-execution-admission-pre-issue-"))
  if (!preIssueFile) throw new Error("expected Replay Worker v10 Execution Admission pre-issue file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, preIssueFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: dispatchEvidenceRegistryRoot,
    ...preIssueInput,
  })).toThrow()

  const executionAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-execution-admission-contract-${executionAdmissionContract.contract_key}.json`)
  if (!executionAdmissionFile) throw new Error("expected Replay Worker v10 Execution Admission Contract file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, executionAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_transport_contract: successorTransportContract,
  })).toThrow()

  const successorTransportFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-transport-contract-${successorTransportContract.contract_key}.json`)
  if (!successorTransportFile) throw new Error("expected Replay Worker v10 successor Transport Contract file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorTransportFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorTransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_negative_probe_receipt: negativeProbeReceipt,
  })).toThrow()

  const negativeProbeFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-negative-probe-receipt-${negativeProbeReceipt.receipt_key}.json`)
  if (!negativeProbeFile) throw new Error("expected Replay Worker v10 negative probe receipt file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, negativeProbeFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10NegativeProbeReceipt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_stdio_capability: durableStdioCapability,
  })).toThrow()

  const transportContractFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-transport-contract-${workerV10TransportContract.contract_key}.json`)
  if (!transportContractFile) throw new Error("expected Replay Worker v10 Transport Contract registry file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, transportContractFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10TransportContract({
    registry_root: dispatchEvidenceRegistryRoot,
    ...transportContractInput,
  })).toThrow()
}
