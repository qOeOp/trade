import { expect } from "bun:test"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readReplayWorkerV10ActivatedStdioCapability } from "./replay-worker-v10-activated-stdio-capability-registry"
import { readReplayWorkerV10AuthorityCapsule } from "./replay-worker-v10-authority-capsule-registry"
import { readReplayWorkerV10AuthorityExecutionAdmissionCommand } from "./replay-worker-v10-authority-execution-admission-command-registry"
import { readReplayWorkerV10AuthorityFrameBuildContract } from "./replay-worker-v10-authority-frame-build-contract-registry"
import { readReplayWorkerV10AuthorityProcessLaunchIntent } from "./replay-worker-v10-authority-process-launch-intent-registry"
import { readReplayWorkerV10AuthorityProcessLaunchReceipt } from "./replay-worker-v10-authority-process-launch-registry"
import { readReplayWorkerV10AuthorityRequestDispatchReceipt } from "./replay-worker-v10-authority-request-dispatch-registry"
import { readReplayWorkerV10AuthorityResponseValidation } from "./replay-worker-v10-authority-response-validation-registry"
import { readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest } from "./replay-worker-v10-authority-spawn-boundary-revalidation-request-registry"
import { readReplayWorkerV10AuthoritySpawnBoundaryRevalidation } from "./replay-worker-v10-authority-spawn-boundary-revalidation-registry"
import { readReplayWorkerV10AuthorityTransportContract } from "./replay-worker-v10-authority-transport-contract-registry"
import { readReplayWorkerV10ProcessLaunchReadinessGate } from "./replay-worker-v10-process-launch-readiness-gate-registry"

type RegistryInput<T extends (input: never) => unknown> =
  Omit<Parameters<T>[0], "registry_root">

export interface ReplayWorkerV10AuthorityChainIntegrityStageInput {
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
}

export function runReplayWorkerV10AuthorityChainIntegrityStage(
  input: ReplayWorkerV10AuthorityChainIntegrityStageInput,
): void {
  const root = input.registry_root
  const responseFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-response-validation-${input.authority_response_validation.validation_key}.json`)
  if (!responseFile) throw new Error("expected Worker v10 Authority Response Validation file")
  writeFileSync(join(root, responseFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityResponseValidation({
    registry_root: root,
    source_dispatch_receipt: input.authority_dispatch_receipt,
  })).toThrow()

  const dispatchFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-request-dispatch-receipt-${input.authority_dispatch_receipt.receipt_key}.json`)
  if (!dispatchFile) throw new Error("expected Worker v10 Authority Request Dispatch Receipt file")
  writeFileSync(join(root, dispatchFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityRequestDispatchReceipt({
    registry_root: root,
    source_process_launch_receipt: input.authority_process_receipt,
  })).toThrow()

  const processFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-process-launch-receipt-${input.authority_process_receipt.receipt_key}.json`)
  if (!processFile) throw new Error("expected Worker v10 Authority Process Launch Receipt file")
  writeFileSync(join(root, processFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityProcessLaunchReceipt({
    registry_root: root,
    source_spawn_revalidation: input.spawn_revalidation,
  })).toThrow()

  const revalidationFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-spawn-revalidation-${input.spawn_revalidation.binding_key}.json`)
  if (!revalidationFile) throw new Error("expected Worker v10 Authority Spawn Revalidation file")
  writeFileSync(join(root, revalidationFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
    registry_root: root,
    ...input.spawn_revalidation_input,
  })).toThrow()

  const requestFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-spawn-revalidation-request-${input.spawn_revalidation_request.request_key}.json`)
  if (!requestFile) throw new Error("expected Worker v10 spawn revalidation Request file")
  writeFileSync(join(root, requestFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
    registry_root: root,
    ...input.spawn_revalidation_request_input,
  })).toThrow()

  const capsuleFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-capsule-${input.authority_capsule.capsule_key}.json`)
  if (!capsuleFile) throw new Error("expected Worker v10 Authority Capsule file")
  writeFileSync(join(root, capsuleFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityCapsule({
    registry_root: root,
    ...input.authority_capsule_input,
  })).toThrow()

  const intentFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-process-launch-intent-${input.authority_intent.intent_key}.json`)
  if (!intentFile) throw new Error("expected Worker v10 Authority Process Launch Intent file")
  writeFileSync(join(root, intentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: root,
    ...input.authority_intent_input,
  })).toThrow()

  const commandFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-execution-command-${input.authority_command.command_key}.json`)
  if (!commandFile) throw new Error("expected Worker v10 Authority Execution Admission Command file")
  writeFileSync(join(root, commandFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: root,
    ...input.authority_command_input,
  })).toThrow()

  const transportFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-transport-${input.authority_transport.contract_key}.json`)
  if (!transportFile) throw new Error("expected Worker v10 Authority Transport Contract file")
  writeFileSync(join(root, transportFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityTransportContract({
    registry_root: root,
    ...input.authority_transport_input,
  })).toThrow()

  const stdioFile = readdirSync(root).find((name) => name
    === `worker-v10-activated-stdio-${input.activated_stdio.capability_key}.json`)
  if (!stdioFile) throw new Error("expected Worker v10 Activated Stdio Capability file")
  writeFileSync(join(root, stdioFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ActivatedStdioCapability({
    registry_root: root,
    ...input.activated_stdio_input,
  })).toThrow()

  const buildFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-frame-build-${input.authority_frame_build.contract_key}.json`)
  if (!buildFile) throw new Error("expected Worker v10 Authority Frame Build Contract file")
  writeFileSync(join(root, buildFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityFrameBuildContract({
    registry_root: root,
    ...input.authority_build_input,
  })).toThrow()

  const readinessFile = readdirSync(root).find((name) => name
    === `worker-v10-process-launch-readiness-${input.process_launch_readiness.gate_key}.json`)
  if (!readinessFile) throw new Error("expected Worker v10 Process Launch Readiness Gate file")
  writeFileSync(join(root, readinessFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ProcessLaunchReadinessGate({
    registry_root: root,
    ...input.process_readiness_input,
  })).toThrow()
}
