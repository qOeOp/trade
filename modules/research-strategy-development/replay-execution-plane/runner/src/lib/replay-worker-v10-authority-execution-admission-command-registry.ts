import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  type ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandKey,
  type ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-authority-execution-admission-command"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayWorkerV10AuthorityTransportContractEntry,
} from "./replay-worker-v10-authority-transport-contract-registry"

export interface ReplayWorkerV10AuthorityExecutionAdmissionCommandRegistryInput {
  registry_root: string
  source_authority_transport_contract: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
}

export function issueReplayWorkerV10AuthorityExecutionAdmissionCommand(
  input: ReplayWorkerV10AuthorityExecutionAdmissionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(input)
  const path = commandPath(input.registry_root, expected.command_key)
  const existing = readCommand(path)
  if (existing) return sameCommand(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readCommand(path)
    if (winner) return sameCommand(winner, expected)
    throw error
  }
  return parseCommand(content)
}

export function readReplayWorkerV10AuthorityExecutionAdmissionCommand(
  input: ReplayWorkerV10AuthorityExecutionAdmissionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand | null {
  requireInput(input)
  const value = readCommand(commandPath(input.registry_root, commandKey(input)))
  if (!value) return null
  requireDurableParent(input)
  return sameCommand(value, buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(input))
}

function requireDurableParent(input: ReplayWorkerV10AuthorityExecutionAdmissionCommandRegistryInput): void {
  requireInput(input)
  const transport = input.source_authority_transport_contract
  const durable = readReplayWorkerV10AuthorityTransportContractEntry({
    registry_root: input.registry_root,
    contract_key: transport.contract_key,
  })
  if (!durable || durable.contract_hash !== transport.contract_hash) {
    throw new Error("Authority Execution Admission Command requires the exact durable Authority Transport Contract")
  }
}

function requireInput(input: ReplayWorkerV10AuthorityExecutionAdmissionCommandRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Authority Execution Admission Command registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(input.source_authority_transport_contract)
  assertReplayDispatchClockAttestationView(input.control_plane_clock_attestation)
}

function sameCommand(
  existing: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  expected: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
): ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Authority Execution Admission Command natural key has different evidence")
  }
  return existing
}

function readCommand(path: string): ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Authority Execution Admission Command entry must be a regular file")
  }
  return parseCommand(readFileSync(path, "utf8"))
}

function parseCommand(content: string): ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Authority Execution Admission Command entry is not canonical")
  }
  return value
}

function commandKey(input: ReplayWorkerV10AuthorityExecutionAdmissionCommandRegistryInput): string {
  const transport = input.source_authority_transport_contract
  const oldCommand = transport.source_activated_stdio_capability.source_authority_frame_build_contract
    .source_launch_readiness_gate.source_process_launch_intent.source_execution_admission_command
  return replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandKey({
    transport_contract_hash: transport.contract_hash,
    worker_request_hash: transport.target_worker_request_hash,
    logical_request_id: transport.target_logical_request_id,
    attempt_id: oldCommand.attempt_id,
    attempt_ordinal: oldCommand.attempt_ordinal,
    worker_id: oldCommand.worker_id,
    lease_generation: oldCommand.lease_generation,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
}

function commandPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-execution-command-${key}.json`)
}
