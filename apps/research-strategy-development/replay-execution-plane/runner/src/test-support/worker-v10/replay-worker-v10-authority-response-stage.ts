import { expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  canonicalHash,
  canonicalJson,
  type ReplayExecutionRequest,
} from "../../../../contracts/src/lib/replay-contracts"
import {
  createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import {
  decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-response-validation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_DISTINCT_BINDINGS,
  REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_SAME_BINDINGS,
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import {
  readReplayWorkerV10AuthorityResponseValidation,
  registerReplayWorkerV10AuthorityResponseValidation,
} from "../../lib/replay-worker-v10-authority-response-validation-registry"
import {
  readReplayWorkerV10AuthorityScheduleAdmission,
  registerReplayWorkerV10AuthorityScheduleAdmission,
} from "../../lib/replay-worker-v10-authority-schedule-admission-registry"
import {
  readReplayWorkerV10ReproducibilityPairContract,
  registerReplayWorkerV10ReproducibilityPairContract,
} from "../../lib/replay-worker-v10-reproducibility-pair-contract-registry"
import type {
  readReplayWorkerV10AuthorityRequestDispatchAttempt,
  readReplayWorkerV10AuthorityRequestDispatchReceipt,
} from "../../lib/replay-worker-v10-authority-request-dispatch-registry"
import type {
  readReplayWorkerV10AuthorityProcessLaunchReceipt,
} from "../../lib/replay-worker-v10-authority-process-launch-registry"
import { expectAuthorityResponseAndSchedule } from "./replay-worker-v10-authority-stage.assertions"

export interface ReplayWorkerV10AuthorityResponseStageInput {
  registry_root: string
  dispatch_receipt:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityRequestDispatchReceipt>>
  dispatch_attempt:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityRequestDispatchAttempt>>
  process_receipt:
    NonNullable<ReturnType<typeof readReplayWorkerV10AuthorityProcessLaunchReceipt>>
  replay_execution_request: ReplayExecutionRequest
  profile(stage: string): void
}

export function runReplayWorkerV10AuthorityResponseStage(
  input: ReplayWorkerV10AuthorityResponseStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const authorityDispatchReceipt = input.dispatch_receipt
  const authorityDispatchAttempt = input.dispatch_attempt
  const authorityProcessReceipt = input.process_receipt
  const requestValue = input.replay_execution_request
  const replayProfile = input.profile

  const withAuthorityRawCapture = (stdout: Buffer, stderr = Buffer.alloc(0)) => {
    const { receipt_hash: _receiptHash, ...body } = authorityDispatchReceipt
    return createReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt({
      ...body,
      stdout_bytes_read: stdout.byteLength,
      stdout_bytes_hash: createHash("sha256").update(stdout).digest("hex"),
      stdout_bytes_base64: stdout.toString("base64"),
      stderr_bytes_read: stderr.byteLength,
      stderr_bytes_hash: createHash("sha256").update(stderr).digest("hex"),
      stderr_bytes_base64: stderr.toString("base64"),
    })
  }
  const malformedUtf8Decode = decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture(
    withAuthorityRawCapture(Buffer.from([0xff])),
  )
  expect(malformedUtf8Decode.status).toBe("rejected")
  if (malformedUtf8Decode.status !== "rejected") throw new Error("expected malformed UTF-8 rejection")
  expect(malformedUtf8Decode.error_code).toBe("response_frame_malformed_utf8")
  const trailingFrameDecode = decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture(
    withAuthorityRawCapture(Buffer.concat([
      Buffer.from(authorityDispatchReceipt.stdout_bytes_base64, "base64"),
      Buffer.from("{}\n", "utf8"),
    ])),
  )
  expect(trailingFrameDecode.status).toBe("rejected")
  if (trailingFrameDecode.status !== "rejected") throw new Error("expected trailing Frame rejection")
  expect(trailingFrameDecode.error_code).toBe("response_frame_not_single_canonical_json_utf8_lf")
  const echoDriftFrame = JSON.parse(
    Buffer.from(authorityDispatchReceipt.stdout_bytes_base64, "base64").toString("utf8"),
  ) as Record<string, unknown>
  echoDriftFrame.execution_admission_command_hash = "f".repeat(64)
  const { frame_hash: _oldFrameHash, ...echoDriftBody } = echoDriftFrame
  echoDriftFrame.frame_hash = canonicalHash(echoDriftBody)
  const echoDriftDecode = decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture(
    withAuthorityRawCapture(Buffer.from(`${canonicalJson(echoDriftFrame)}\n`, "utf8")),
  )
  expect(echoDriftDecode.status).toBe("rejected")
  if (echoDriftDecode.status !== "rejected") throw new Error("expected Response echo rejection")
  expect(echoDriftDecode.error_code).toBe("response_frame_contract_or_echo_invalid")
  const stderrDecode = decodeReplayDecisionHarnessWorkerV10AuthorityResponseCapture(
    withAuthorityRawCapture(
      Buffer.from(authorityDispatchReceipt.stdout_bytes_base64, "base64"),
      Buffer.from("unexpected stderr\n", "utf8"),
    ),
  )
  expect(stderrDecode.status).toBe("rejected")
  if (stderrDecode.status !== "rejected") throw new Error("expected stderr rejection")
  expect(stderrDecode.error_code).toBe("transport_outcome_not_admissible")

  const missingAuthorityResponseRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-response-missing-"))
  try {
    expect(() => registerReplayWorkerV10AuthorityResponseValidation({
      registry_root: missingAuthorityResponseRoot,
      source_dispatch_receipt: authorityDispatchReceipt,
    })).toThrow("requires the exact durable Spawn Boundary Revalidation")
  } finally {
    rmSync(missingAuthorityResponseRoot, { recursive: true, force: true })
  }
  const authorityResponseValidation = registerReplayWorkerV10AuthorityResponseValidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_dispatch_receipt: authorityDispatchReceipt,
  })
  replayProfile("authority response validation")
  expect(readReplayWorkerV10AuthorityResponseValidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_dispatch_receipt: authorityDispatchReceipt,
  })).toEqual(authorityResponseValidation)
  expect(registerReplayWorkerV10AuthorityResponseValidation({
    registry_root: dispatchEvidenceRegistryRoot,
    source_dispatch_receipt: authorityDispatchReceipt,
  })).toEqual(authorityResponseValidation)

  const missingAuthorityScheduleRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-schedule-missing-"))
  try {
    expect(() => registerReplayWorkerV10AuthorityScheduleAdmission({
      registry_root: missingAuthorityScheduleRoot,
      source_response_validation: authorityResponseValidation,
      source_replay_execution_request: requestValue,
    })).toThrow("requires the exact durable Spawn Boundary Revalidation")
  } finally {
    rmSync(missingAuthorityScheduleRoot, { recursive: true, force: true })
  }
  expect(() => registerReplayWorkerV10AuthorityScheduleAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_response_validation: authorityResponseValidation,
    source_replay_execution_request: { ...requestValue, assumptions_hash: "f".repeat(64) },
  })).toThrow("does not match Control Plane Attempt lease")
  const authorityScheduleAdmission = registerReplayWorkerV10AuthorityScheduleAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_response_validation: authorityResponseValidation,
    source_replay_execution_request: requestValue,
  })
  expectAuthorityResponseAndSchedule({
    validation: authorityResponseValidation,
    schedule: authorityScheduleAdmission,
    request: requestValue,
  })
  expect(readReplayWorkerV10AuthorityScheduleAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_response_validation: authorityResponseValidation,
    source_replay_execution_request: requestValue,
  })).toEqual(authorityScheduleAdmission)
  expect(registerReplayWorkerV10AuthorityScheduleAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_response_validation: authorityResponseValidation,
    source_replay_execution_request: structuredClone(requestValue),
  })).toEqual(authorityScheduleAdmission)

  const missingReproducibilityRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-pair-missing-"))
  try {
    expect(() => registerReplayWorkerV10ReproducibilityPairContract({
      registry_root: missingReproducibilityRoot,
      source_schedule_admission: authorityScheduleAdmission,
    })).toThrow("requires the exact durable Spawn Boundary Revalidation")
  } finally {
    rmSync(missingReproducibilityRoot, { recursive: true, force: true })
  }
  const reproducibilityPairContract = registerReplayWorkerV10ReproducibilityPairContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_schedule_admission: authorityScheduleAdmission,
  })
  replayProfile("reproducibility pair")
  expect(reproducibilityPairContract.status)
    .toBe("requirements_frozen_second_response_and_pair_not_materialized")
  expect(reproducibilityPairContract.logical_request_id)
    .toBe(authorityDispatchAttempt.request_frame.logical_request_id)
  if (authorityProcessReceipt.process_instance_id === null
      || authorityProcessReceipt.observed_child_pid === null) {
    throw new Error("expected successful first authority process identity")
  }
  expect(reproducibilityPairContract.source_process_instance_id)
    .toBe(authorityProcessReceipt.process_instance_id)
  expect(reproducibilityPairContract.source_observed_child_pid)
    .toBe(authorityProcessReceipt.observed_child_pid)
  expect(reproducibilityPairContract.required_same_bindings)
    .toEqual([...REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_SAME_BINDINGS])
  expect(reproducibilityPairContract.required_distinct_bindings)
    .toEqual([...REPLAY_DECISION_HARNESS_WORKER_V10_REPRODUCIBILITY_DISTINCT_BINDINGS])
  expect(reproducibilityPairContract.capsule_reuse_policy)
    .toBe("forbidden_second_process_requires_distinct_command_intent_capsule_lineage")
  expect(reproducibilityPairContract.successor_authority_policy)
    .toBe("not_selected_same_attempt_new_generation_or_control_plane_authorized_new_attempt_only")
  expect(reproducibilityPairContract.first_schedule_admission_count).toBe(1)
  expect(reproducibilityPairContract.second_schedule_admission_count).toBe(0)
  expect(reproducibilityPairContract.response_instance_count).toBe(1)
  expect(reproducibilityPairContract.required_response_instance_count).toBe(2)
  expect(reproducibilityPairContract.reproducibility_pair_count).toBe(0)
  expect(reproducibilityPairContract.harness_receipt_count).toBe(0)
  expect(reproducibilityPairContract.blockers).toEqual([
    "successor_verification_authority_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ])
  expect(reproducibilityPairContract.signal_authority).toBe("none")
  expect(reproducibilityPairContract.order_authority).toBe("none")
  expect(reproducibilityPairContract.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(
    reproducibilityPairContract,
  )).not.toThrow()
  expect(readReplayWorkerV10ReproducibilityPairContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_schedule_admission: authorityScheduleAdmission,
  })).toEqual(reproducibilityPairContract)
  expect(registerReplayWorkerV10ReproducibilityPairContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_schedule_admission: structuredClone(authorityScheduleAdmission),
  })).toEqual(reproducibilityPairContract)

  return {
    response_validation: authorityResponseValidation,
    schedule_admission: authorityScheduleAdmission,
    reproducibility_pair_contract: reproducibilityPairContract,
  }
}
