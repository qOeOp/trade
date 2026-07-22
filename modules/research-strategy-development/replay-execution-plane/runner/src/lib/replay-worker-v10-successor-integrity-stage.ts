import { expect } from "bun:test"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  readReplayWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "./replay-worker-v10-successor-spawn-boundary-revalidation-registry"
import {
  readReplayWorkerV10SuccessorAuthorityCapsule,
} from "./replay-worker-v10-successor-authority-capsule-registry"
import {
  readReplayWorkerV10SuccessorProcessLaunchIntent,
} from "./replay-worker-v10-successor-process-launch-intent-registry"
import {
  readReplayWorkerV10SuccessorExecutionAdmissionCommand,
  readReplayWorkerV10SuccessorExecutionCommandAdmission,
  readReplayWorkerV10SuccessorExecutionDispatchClaim,
} from "./replay-worker-v10-successor-execution-command-registry"
import {
  readReplayWorkerV10SuccessorExecutionAdmission,
  readReplayWorkerV10SuccessorExecutionArtifactTransport,
  readReplayWorkerV10SuccessorExecutionContract,
} from "./replay-worker-v10-successor-execution-contract-registry"
import {
  readReplayWorkerV10SuccessorExecutionStdioProbe,
} from "./replay-worker-v10-successor-execution-stdio-probe-registry"
import {
  readReplayWorkerV10SuccessorExecutionTransport,
} from "./replay-worker-v10-successor-execution-transport-registry"
import {
  readReplayWorkerV10SuccessorExecutionEnvelope,
} from "./replay-worker-v10-successor-execution-envelope-registry"
import {
  readReplayWorkerV10SuccessorLeaseAdmission,
} from "./replay-worker-v10-successor-lease-admission-registry"
import {
  readReplayWorkerV10SuccessorVerificationAuthorityContract,
} from "./replay-worker-v10-successor-verification-authority-contract-registry"
import {
  readReplayWorkerV10ReproducibilityPairContract,
} from "./replay-worker-v10-reproducibility-pair-contract-registry"
import {
  readReplayWorkerV10AuthorityScheduleAdmission,
} from "./replay-worker-v10-authority-schedule-admission-registry"
import type { runReplayWorkerV10SuccessorCommandStage } from "./replay-worker-v10-successor-command-stage"
import type { runReplayWorkerV10SuccessorIntentStage } from "./replay-worker-v10-successor-intent-stage"
import type { runReplayWorkerV10SuccessorCapsuleStage } from "./replay-worker-v10-successor-capsule-stage"
import type { runReplayWorkerV10SuccessorSpawnStage } from "./replay-worker-v10-successor-spawn-stage"

export interface ReplayWorkerV10SuccessorIntegrityStageInput {
  registry_root: string
  command_stage: ReturnType<typeof runReplayWorkerV10SuccessorCommandStage>
  intent_stage: ReturnType<typeof runReplayWorkerV10SuccessorIntentStage>
  capsule_stage: ReturnType<typeof runReplayWorkerV10SuccessorCapsuleStage>
  spawn_stage: ReturnType<typeof runReplayWorkerV10SuccessorSpawnStage>
  execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  stdio_probe_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionContract>[0][
      "source_successor_execution_stdio_probe_admission"
    ]
  transport_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionStdioProbe>[0][
      "source_successor_execution_transport_admission"
    ]
  envelope_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionTransport>[0][
      "source_successor_execution_envelope_admission"
    ]
  lease_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionEnvelope>[0][
      "source_successor_lease_admission"
    ]
  authority_contract:
    Parameters<typeof readReplayWorkerV10SuccessorLeaseAdmission>[0][
      "source_successor_authority_contract"
    ]
  renewal_request:
    Parameters<typeof readReplayWorkerV10SuccessorLeaseAdmission>[0]["source_renewal_request"]
  reproducibility_pair_contract:
    Parameters<typeof readReplayWorkerV10SuccessorVerificationAuthorityContract>[0][
      "source_reproducibility_pair_contract"
    ]
  authority_schedule_admission:
    Parameters<typeof readReplayWorkerV10ReproducibilityPairContract>[0][
      "source_schedule_admission"
    ]
  authority_response_validation:
    Parameters<typeof readReplayWorkerV10AuthorityScheduleAdmission>[0][
      "source_response_validation"
    ]
  replay_execution_request:
    Parameters<typeof readReplayWorkerV10AuthorityScheduleAdmission>[0][
      "source_replay_execution_request"
    ]
}

export function runReplayWorkerV10SuccessorIntegrityStage(
  input: ReplayWorkerV10SuccessorIntegrityStageInput,
): void {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const successorCommandStage = input.command_stage
  const successorIntentStage = input.intent_stage
  const successorCapsuleStage = input.capsule_stage
  const successorSpawnResult = input.spawn_stage.result
  const successorSpawnRequest = successorSpawnResult.revalidation_request
  const successorSpawnReceipt = successorSpawnResult.control_plane_revalidation_receipt
  const successorSpawnRevalidation = successorSpawnResult.spawn_boundary_revalidation
  const successorCommandInput = successorCommandStage.command_input
  const successorCommandAdmission = successorCommandStage.command_admission
  const successorDispatchClaim = successorCommandStage.dispatch_claim
  const successorExecutionCommand = successorCommandStage.execution_command
  const successorIntentInput = successorIntentStage.intent_input
  const successorProcessLaunchIntent = successorIntentStage.process_launch_intent
  const successorCapsuleInput = successorCapsuleStage.capsule_input
  const successorAuthorityCapsule = successorCapsuleStage.authority_capsule
  const successorCapsuleFile = successorCapsuleStage.capsule_file
  const successorIntentFile = successorCapsuleStage.intent_file
  const successorExecutionContractAdmission = input.execution_contract_admission
  const successorExecutionAdmission =
    successorExecutionContractAdmission.successor_execution_admission_contract
  const successorArtifactTransport =
    successorExecutionContractAdmission.successor_artifact_bound_transport_contract
  const successorStdioProbeAdmission = input.stdio_probe_admission
  const successorTransportAdmission = input.transport_admission
  const successorEnvelopeAdmission = input.envelope_admission
  const successorLeaseAdmission = input.lease_admission
  const successorAuthorityContract = input.authority_contract
  const successorLeaseResult = { renewal_request: input.renewal_request }
  const reproducibilityPairContract = input.reproducibility_pair_contract
  const authorityScheduleAdmission = input.authority_schedule_admission
  const authorityResponseValidation = input.authority_response_validation
  const requestValue = input.replay_execution_request

  const successorSpawnRequestFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-spawn-revalidation-request-${successorSpawnRequest.request_key}.json`)
  if (!successorSpawnRequestFile) throw new Error("expected successor Spawn Revalidation Request file")
  const successorSpawnReceiptFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-spawn-revalidation-receipt-${successorSpawnRequest.request_key}.json`)
  if (!successorSpawnReceiptFile) throw new Error("expected successor Spawn Revalidation Receipt file")
  const successorSpawnBindingFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-spawn-revalidation-${successorSpawnRevalidation.binding_key}.json`)
  if (!successorSpawnBindingFile) throw new Error("expected successor Spawn Revalidation Binding file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorSpawnBindingFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_capsule: successorAuthorityCapsule,
    source_successor_process_launch_intent: successorProcessLaunchIntent,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorSpawnBindingFile),
    `${canonicalJson(successorSpawnRevalidation)}\n`, "utf8")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorSpawnReceiptFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_capsule: successorAuthorityCapsule,
    source_successor_process_launch_intent: successorProcessLaunchIntent,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorSpawnReceiptFile),
    `${canonicalJson(successorSpawnReceipt)}\n`, "utf8")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorSpawnRequestFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_capsule: successorAuthorityCapsule,
    source_successor_process_launch_intent: successorProcessLaunchIntent,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorSpawnRequestFile),
    `${canonicalJson(successorSpawnRequest)}\n`, "utf8")

  writeFileSync(join(dispatchEvidenceRegistryRoot, successorCapsuleFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCapsuleInput,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_capsule: successorAuthorityCapsule,
    source_successor_process_launch_intent: successorProcessLaunchIntent,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorCapsuleFile),
    `${canonicalJson(successorAuthorityCapsule)}\n`, "utf8")

  writeFileSync(join(dispatchEvidenceRegistryRoot, successorIntentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorIntentInput,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCapsuleInput,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_capsule: successorAuthorityCapsule,
    source_successor_process_launch_intent: successorProcessLaunchIntent,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorIntentFile),
    `${canonicalJson(successorProcessLaunchIntent)}\n`, "utf8")

  const intentCommandParentFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-command-admission-${successorCommandAdmission.admission_key}.json`)
  if (!intentCommandParentFile) throw new Error("expected Intent R4.148 parent file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, intentCommandParentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorIntentInput,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, intentCommandParentFile),
    `${canonicalJson(successorCommandAdmission)}\n`, "utf8")

  const intentExecutionParentFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-contract-${successorExecutionContractAdmission.admission_key}.json`)
  if (!intentExecutionParentFile) throw new Error("expected Intent R4.147 parent file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, intentExecutionParentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorIntentInput,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, intentExecutionParentFile),
    `${canonicalJson(successorExecutionContractAdmission)}\n`, "utf8")

  const intentStdioParentFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-stdio-probe-${successorStdioProbeAdmission.admission_key}.json`)
  if (!intentStdioParentFile) throw new Error("expected Intent R4.146 parent file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, intentStdioParentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorIntentInput,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, intentStdioParentFile),
    `${canonicalJson(successorStdioProbeAdmission)}\n`, "utf8")

  const successorDispatchClaimFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-dispatch-claim-${successorDispatchClaim.claim_key}.json`)
  if (!successorDispatchClaimFile) throw new Error("expected successor Dispatch Claim file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorDispatchClaimFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionDispatchClaim({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorDispatchClaimFile),
    `${canonicalJson(successorDispatchClaim)}\n`, "utf8")

  const successorExecutionCommandFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-command-${successorExecutionCommand.command_key}.json`)
  if (!successorExecutionCommandFile) throw new Error("expected successor Execution Command file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorExecutionCommandFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorExecutionCommandFile),
    `${canonicalJson(successorExecutionCommand)}\n`, "utf8")

  const successorCommandAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-command-admission-${successorCommandAdmission.admission_key}.json`)
  if (!successorCommandAdmissionFile) throw new Error("expected successor Command Admission file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorCommandAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionCommandAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })).toThrow()
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorCommandAdmissionFile),
    `${canonicalJson(successorCommandAdmission)}\n`, "utf8")

  const successorExecutionContractAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-contract-${successorExecutionContractAdmission.admission_key}.json`)
  if (!successorExecutionContractAdmissionFile) {
    throw new Error("expected Worker v10 successor execution Contract Admission file")
  }
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorExecutionContractAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_stdio_probe_admission: successorStdioProbeAdmission,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorExecutionCommandAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })).toThrow()

  const successorExecutionAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-admission-${successorExecutionAdmission.contract_key}.json`)
  if (!successorExecutionAdmissionFile) {
    throw new Error("expected successor Worker v10 Execution Admission Contract file")
  }
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorExecutionAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_stdio_probe_admission: successorStdioProbeAdmission,
  })).toThrow()

  const successorArtifactTransportFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-artifact-transport-${successorArtifactTransport.contract_key}.json`)
  if (!successorArtifactTransportFile) {
    throw new Error("expected successor artifact-bound Worker v10 Transport Contract file")
  }
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorArtifactTransportFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionArtifactTransport({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_stdio_probe_admission: successorStdioProbeAdmission,
  })).toThrow()

  const successorStdioProbeAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-stdio-probe-${successorStdioProbeAdmission.admission_key}.json`)
  if (!successorStdioProbeAdmissionFile) {
    throw new Error("expected Worker v10 successor execution Stdio Probe Admission file")
  }
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorStdioProbeAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_transport_admission: successorTransportAdmission,
  })).toThrow()

  const successorTransportAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-transport-${successorTransportAdmission.admission_key}.json`)
  if (!successorTransportAdmissionFile) {
    throw new Error("expected Worker v10 successor execution Transport Admission file")
  }
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorTransportAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionTransport({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_execution_envelope_admission: successorEnvelopeAdmission,
  })).toThrow()

  const successorEnvelopeAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-execution-envelope-${successorEnvelopeAdmission.admission_key}.json`)
  if (!successorEnvelopeAdmissionFile) {
    throw new Error("expected Worker v10 successor Execution Envelope Admission file")
  }
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorEnvelopeAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_lease_admission: successorLeaseAdmission,
  })).toThrow()

  const successorLeaseAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-lease-admission-${successorLeaseAdmission.admission_key}.json`)
  if (!successorLeaseAdmissionFile) throw new Error("expected Worker v10 successor Lease Admission file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorLeaseAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorLeaseAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_contract: successorAuthorityContract,
    source_renewal_request: successorLeaseResult.renewal_request,
  })).toThrow()

  const successorAuthorityContractFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-verification-authority-contract-${successorAuthorityContract.contract_key}.json`)
  if (!successorAuthorityContractFile) {
    throw new Error("expected Worker v10 successor verification authority Contract file")
  }
  writeFileSync(join(dispatchEvidenceRegistryRoot, successorAuthorityContractFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorVerificationAuthorityContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_reproducibility_pair_contract: reproducibilityPairContract,
  })).toThrow()

  const reproducibilityPairContractFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-reproducibility-pair-contract-${reproducibilityPairContract.contract_key}.json`)
  if (!reproducibilityPairContractFile) throw new Error("expected Worker v10 Reproducibility Pair Contract file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, reproducibilityPairContractFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ReproducibilityPairContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_schedule_admission: authorityScheduleAdmission,
  })).toThrow()

  const authorityScheduleAdmissionFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-authority-schedule-admission-${authorityScheduleAdmission.admission_key}.json`)
  if (!authorityScheduleAdmissionFile) throw new Error("expected Worker v10 Authority Schedule Admission file")
  writeFileSync(join(dispatchEvidenceRegistryRoot, authorityScheduleAdmissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityScheduleAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_response_validation: authorityResponseValidation,
    source_replay_execution_request: requestValue,
  })).toThrow()
}
