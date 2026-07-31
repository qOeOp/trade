import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  replayDecisionHarnessWorkerV10ExecutionAdmissionCommandKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import { buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "./replay-decision-harness-worker-v10-execution-admission-command"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10ExecutionAdmissionClockAttestation } from "./replay-worker-v10-execution-admission-clock-attestation-registry"

export interface ReplayWorkerV10ExecutionAdmissionCommandRegistryInput {
  registry_root: string
  source_clock_binding: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation
}

export interface ReplayWorkerV10ExecutionAdmissionCommandEntryInput {
  registry_root: string
  command_key: string
}

export function issueReplayWorkerV10ExecutionAdmissionCommand(
  input: ReplayWorkerV10ExecutionAdmissionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(input)
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

export function readReplayWorkerV10ExecutionAdmissionCommand(
  input: ReplayWorkerV10ExecutionAdmissionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand | null {
  requireInput(input)
  const value = readCommand(commandPath(input.registry_root, commandKey(input.source_clock_binding)))
  if (!value) return null
  requireDurableParent(input)
  return sameCommand(value, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(input))
}

export function readReplayWorkerV10ExecutionAdmissionCommandEntry(
  input: ReplayWorkerV10ExecutionAdmissionCommandEntryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand | null {
  if (input.registry_root.trim() === "" || !/^[0-9a-f]{64}$/.test(input.command_key)) {
    throw new Error("Execution Admission Command entry identity is invalid")
  }
  const value = readCommand(commandPath(input.registry_root, input.command_key))
  if (value && value.command_key !== input.command_key) {
    throw new Error("Execution Admission Command entry key mismatch")
  }
  return value
}

function requireDurableParent(input: ReplayWorkerV10ExecutionAdmissionCommandRegistryInput): void {
  requireInput(input)
  const binding = input.source_clock_binding
  const durable = readReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: input.registry_root,
    source_registry_provenance: binding.source_registry_provenance,
    control_plane_clock_attestation: binding.control_plane_clock_attestation,
  })
  if (!durable || durable.binding_hash !== binding.binding_hash) {
    throw new Error("Execution Admission Command requires the exact durable clock attestation binding")
  }
}

function requireInput(input: ReplayWorkerV10ExecutionAdmissionCommandRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Execution Admission Command registry root is required")
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(input.source_clock_binding)
}

function commandKey(binding: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation): string {
  return replayDecisionHarnessWorkerV10ExecutionAdmissionCommandKey({
    worker_request_hash: binding.target_worker_request_hash,
    logical_request_id: binding.target_logical_request_id,
    attempt_id: binding.attempt_id,
    attempt_ordinal: binding.attempt_ordinal,
    worker_id: binding.worker_id,
    lease_generation: binding.lease_generation,
    command_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
}

function sameCommand(existing: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  expected: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Execution Admission Command natural key is already issued with different evidence")
  }
  return existing
}

function readCommand(path: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Execution Admission Command entry must be a regular file")
  return parseCommand(readFileSync(path, "utf8"))
}

function parseCommand(content: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Execution Admission Command entry is not canonical")
  return value
}

function commandPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-execution-admission-command-${key}.json`)
}
