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
import { buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "./replay-decision-harness-worker-v10-execution-admission-command"
import { buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent } from "./replay-decision-harness-worker-v10-process-launch-intent"
import { readReplayWorkerV10ExecutionAdmissionClockAttestation, registerReplayWorkerV10ExecutionAdmissionClockAttestation } from "./replay-worker-v10-execution-admission-clock-attestation-registry"
import { readReplayWorkerV10ExecutionAdmissionCommand, issueReplayWorkerV10ExecutionAdmissionCommand } from "./replay-worker-v10-execution-admission-command-registry"
import { readReplayWorkerV10ExecutionAdmissionContract } from "./replay-worker-v10-execution-admission-contract-registry"
import { readReplayWorkerV10ExecutionAdmissionPreIssueBundle } from "./replay-worker-v10-execution-admission-pre-issue-registry"
import { readReplayWorkerV10ExecutionAdmissionRegistryProvenance } from "./replay-worker-v10-execution-admission-registry-provenance-registry"
import { readReplayWorkerV10NegativeProbeReceipt } from "./replay-worker-v10-negative-probe-registry"
import { issueReplayWorkerV10ProcessLaunchIntent, readReplayWorkerV10ProcessLaunchIntent } from "./replay-worker-v10-process-launch-intent-registry"
import { readReplayWorkerV10SuccessorTransportContract } from "./replay-worker-v10-successor-transport-contract-registry"
import { readReplayWorkerV10TransportContract } from "./replay-worker-v10-transport-contract-registry"

type RegistryInput<T extends (input: never) => unknown> =
  Omit<Parameters<T>[0], "registry_root">

export interface ReplayWorkerV10ExecutionChainIntegrityStageInput {
  registry_root: string
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

export function runReplayWorkerV10ExecutionChainIntegrityStage(
  input: ReplayWorkerV10ExecutionChainIntegrityStageInput,
): void {
  const root = input.registry_root
  const alternatePostCommandClockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: input.post_command_registry_receipt.receipt_hash,
    registry_read_started_at: input.post_command_read_at,
    registry_read_completed_at: "2026-07-14T00:00:42Z",
    registry_read_started_monotonic_ns: "4000000",
    registry_read_completed_monotonic_ns: "4000200",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const alternatePostCommandClockAttestation = createReplayDispatchClockAttestation({
    ...((({ attestation_hash: _hash, ...body }) => body)(input.post_command_clock_attestation)),
    attestation_id: `replay-dispatch-clock-attestation-${alternatePostCommandClockIdentityHash.slice(0, 24)}`,
    attestation_ref: `attestation://replay-dispatch-clock/${alternatePostCommandClockIdentityHash.slice(0, 24)}`,
    registry_read_completed_at: "2026-07-14T00:00:42Z",
    registry_read_completed_monotonic_ns: "4000200",
  })
  const alternateProcessLaunchIntent = buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    source_execution_admission_command: input.execution_admission_command,
    post_command_clock_attestation: alternatePostCommandClockAttestation,
  })
  expect(alternateProcessLaunchIntent.intent_key).toBe(input.process_launch_intent.intent_key)
  expect(alternateProcessLaunchIntent.intent_hash).not.toBe(input.process_launch_intent.intent_hash)
  expect(() => issueReplayWorkerV10ProcessLaunchIntent({
    registry_root: root,
    source_execution_admission_command: input.execution_admission_command,
    post_command_clock_attestation: alternatePostCommandClockAttestation,
  })).toThrow("natural key is already issued with different evidence")

  const processIntentFile = readdirSync(root).find((name) => name
    === `worker-v10-process-launch-intent-${input.process_launch_intent.intent_key}.json`)
  if (!processIntentFile) throw new Error("expected Worker v10 Process Launch Intent file")
  writeFileSync(join(root, processIntentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ProcessLaunchIntent({
    registry_root: root,
    ...input.process_intent_input,
  })).toThrow()

  const alternateClockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: input.registry_read_receipt.receipt_hash,
    registry_read_started_at: input.registry_read_receipt.read_at,
    registry_read_completed_at: "2026-07-14T00:00:37Z",
    registry_read_started_monotonic_ns: "3000000",
    registry_read_completed_monotonic_ns: "3000200",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const alternateClockAttestation = createReplayDispatchClockAttestation({
    ...((({ attestation_hash: _hash, ...body }) => body)(input.clock_attestation)),
    attestation_id: `replay-dispatch-clock-attestation-${alternateClockIdentityHash.slice(0, 24)}`,
    attestation_ref: `attestation://replay-dispatch-clock/${alternateClockIdentityHash.slice(0, 24)}`,
    registry_read_completed_at: "2026-07-14T00:00:37Z",
    registry_read_completed_monotonic_ns: "3000200",
  })
  const alternateClockBinding = registerReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: root,
    source_registry_provenance: input.registry_provenance,
    control_plane_clock_attestation: alternateClockAttestation,
  })
  const alternateCommand = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand({
    source_clock_binding: alternateClockBinding,
  })
  expect(alternateCommand.command_key).toBe(input.execution_admission_command.command_key)
  expect(alternateCommand.command_hash).not.toBe(input.execution_admission_command.command_hash)
  expect(() => issueReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: root,
    source_clock_binding: alternateClockBinding,
  })).toThrow("natural key is already issued with different evidence")

  const commandFile = readdirSync(root)
    .find((name) => name.startsWith("worker-v10-execution-admission-command-"))
  if (!commandFile) throw new Error("expected Execution Admission Command file")
  writeFileSync(join(root, commandFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: root,
    ...input.command_input,
  })).toThrow()
  const clockFile = readdirSync(root).find((name) => name
    === `worker-v10-execution-admission-clock-attestation-${input.clock_binding.binding_key}.json`)
  if (!clockFile) throw new Error("expected Execution Admission clock attestation file")
  writeFileSync(join(root, clockFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: root,
    ...input.clock_binding_input,
  })).toThrow()
  const provenanceFile = readdirSync(root)
    .find((name) => name.startsWith("worker-v10-execution-admission-registry-provenance-"))
  if (!provenanceFile) throw new Error("expected Execution Admission registry provenance file")
  writeFileSync(join(root, provenanceFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: root,
    ...input.registry_provenance_input,
  })).toThrow()
  const preIssueFile = readdirSync(root)
    .find((name) => name.startsWith("worker-v10-execution-admission-pre-issue-"))
  if (!preIssueFile) throw new Error("expected Replay Worker v10 Execution Admission pre-issue file")
  writeFileSync(join(root, preIssueFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: root,
    ...input.pre_issue_input,
  })).toThrow()

  const admissionFile = readdirSync(root).find((name) => name
    === `worker-v10-execution-admission-contract-${input.execution_admission_contract.contract_key}.json`)
  if (!admissionFile) throw new Error("expected Replay Worker v10 Execution Admission Contract file")
  writeFileSync(join(root, admissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ExecutionAdmissionContract({
    registry_root: root,
    source_successor_transport_contract: input.successor_transport_contract,
  })).toThrow()
  const successorFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-transport-contract-${input.successor_transport_contract.contract_key}.json`)
  if (!successorFile) throw new Error("expected Replay Worker v10 successor Transport Contract file")
  writeFileSync(join(root, successorFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorTransportContract({
    registry_root: root,
    source_negative_probe_receipt: input.negative_probe_receipt,
  })).toThrow()
  const probeFile = readdirSync(root).find((name) => name
    === `worker-v10-negative-probe-receipt-${input.negative_probe_receipt.receipt_key}.json`)
  if (!probeFile) throw new Error("expected Replay Worker v10 negative probe receipt file")
  writeFileSync(join(root, probeFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10NegativeProbeReceipt({
    registry_root: root,
    source_stdio_capability: input.durable_stdio_capability,
  })).toThrow()
  const transportFile = readdirSync(root).find((name) => name
    === `worker-v10-transport-contract-${input.worker_v10_transport_contract.contract_key}.json`)
  if (!transportFile) throw new Error("expected Replay Worker v10 Transport Contract registry file")
  writeFileSync(join(root, transportFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10TransportContract({
    registry_root: root,
    ...input.transport_contract_input,
  })).toThrow()
}
