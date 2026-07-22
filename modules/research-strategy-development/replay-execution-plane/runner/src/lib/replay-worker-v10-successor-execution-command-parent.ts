import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { assertReplayAttemptLeaseObservationEnvelopeView } from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import { assertReplayDispatchClockAttestationView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import { assertReplayAttemptLeaseObservationRegistryReadReceiptView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayWorkerV10SuccessorExecutionCommandParentSnapshot,
  ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
} from "./replay-worker-v10-successor-execution-command-types"

export function readReplayWorkerV10SuccessorExecutionCommandParent(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayWorkerV10SuccessorExecutionCommandParentSnapshot {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Command registry root is required")
  }
  const expected = input.source_successor_execution_contract_admission
  if (typeof expected?.admission_key !== "string" || !/^[a-f0-9]{64}$/.test(expected.admission_key)
      || typeof expected.admission_hash !== "string" || !/^[a-f0-9]{64}$/.test(expected.admission_hash)) {
    throw new Error("successor execution Command R4.147 parent reference is invalid")
  }
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-execution-contract-${expected.admission_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor execution Command requires its exact durable R4.147 parent")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Command R4.147 parent must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const durable = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  if (durable.admission_key !== expected.admission_key || durable.admission_hash !== expected.admission_hash) {
    throw new Error("successor execution Command R4.147 direct parent key or hash drift")
  }
  if (content !== `${canonicalJson(durable)}\n`) {
    throw new Error("successor execution Command R4.147 direct parent is not canonical")
  }
  return {
    source: durable,
    file_sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  }
}

export function assertReplayWorkerV10SuccessorExecutionCommandParentSelfHash(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): void {
  const { admission_hash: admissionHash, ...body } = source
  if (admissionHash !== canonicalHash(body)) {
    throw new Error("successor execution Command R4.147 direct parent self-hash mismatch")
  }
}

export function validateReplayWorkerV10SuccessorExecutionCommandAuthority(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): void {
  if (input.registry_root.trim() === "" || input.dispatcher_claimant_id.trim() === "") {
    throw new Error("successor execution Command registry root and claimant are required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(parent)
  assertReplayAttemptLeaseObservationEnvelopeView(input.source_current_lease_observation)
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(input.control_plane_registry_read_receipt)
  assertReplayDispatchClockAttestationView(input.control_plane_clock_attestation)
  const observation = input.source_current_lease_observation
  const receipt = input.control_plane_registry_read_receipt
  const clock = input.control_plane_clock_attestation
  const lease = receipt.current_attempt_lease
  const claimedAt = Date.parse(input.claimed_at)
  if (!Number.isFinite(claimedAt)
      || canonicalJson(receipt.source_observation) !== canonicalJson(observation)
      || canonicalJson(clock.source_registry_read_receipt) !== canonicalJson(receipt)
      || observation.attempt_id !== parent.attempt_id
      || observation.attempt_ordinal !== parent.attempt_ordinal
      || observation.worker_id !== parent.worker_id
      || observation.lease_generation !== parent.successor_lease_generation
      || lease.status !== "running"
      || claimedAt < Date.parse(lease.heartbeat_at)
      || claimedAt >= Date.parse(observation.observed_at)
      || parent.target_worker_request_execution_admission !== "not_granted"
      || parent.target_worker_request_transport_status !== "not_invoked") {
    throw new Error("successor execution Command authority evidence or chronology drift")
  }
}
