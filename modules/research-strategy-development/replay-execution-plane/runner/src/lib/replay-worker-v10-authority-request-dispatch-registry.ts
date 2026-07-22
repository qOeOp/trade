import type {
  ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import {
  assertReplayWorkerV10AuthorityDispatchLiveSession,
  assertReplayWorkerV10AuthorityDispatchReceiptAttempt,
  buildReplayWorkerV10AuthorityRequestFrame,
  replayWorkerV10AuthorityRequestBytes,
  requireReplayWorkerV10DurableAuthorityLaunch,
} from "./replay-worker-v10-authority-request-dispatch-context"
import {
  buildReplayWorkerV10AuthorityDispatchAttempt,
  buildReplayWorkerV10AuthorityDispatchReceipt,
  replayWorkerV10AuthorityDispatchKey,
} from "./replay-worker-v10-authority-request-dispatch-records"
import {
  commitReplayWorkerV10AuthorityDispatchAttempt,
  persistReplayWorkerV10AuthorityDispatchReceipt,
  readReplayWorkerV10AuthorityDispatchAttemptRecord,
  readReplayWorkerV10AuthorityDispatchReceiptRecord,
} from "./replay-worker-v10-authority-request-dispatch-store"
import type {
  DispatchReplayWorkerV10AuthorityRequestInput,
  ReplayWorkerV10AuthorityRequestDispatchOutcome,
  ReplayWorkerV10AuthorityRequestDispatchReadInput,
} from "./replay-worker-v10-authority-request-dispatch-types"

export type {
  DispatchReplayWorkerV10AuthorityRequestInput,
  ReplayWorkerV10AuthorityRequestDispatchDisposition,
  ReplayWorkerV10AuthorityRequestDispatchOutcome,
} from "./replay-worker-v10-authority-request-dispatch-types"

export async function dispatchReplayWorkerV10AuthorityRequest(
  input: DispatchReplayWorkerV10AuthorityRequestInput,
): Promise<ReplayWorkerV10AuthorityRequestDispatchOutcome> {
  const context = readContext(input)
  const existing = readReplayWorkerV10AuthorityDispatchReceiptRecord(input.registry_root, context.key)
  if (existing) return { receipt: existing, disposition: "durable_receipt_without_live_handle" }
  if (readReplayWorkerV10AuthorityDispatchAttemptRecord(input.registry_root, context.key)) {
    throw indeterminateAttempt()
  }
  assertReplayWorkerV10AuthorityDispatchLiveSession(input)
  const clock = input.clock ?? { now: () => new Date().toISOString() }
  const attempt = buildReplayWorkerV10AuthorityDispatchAttempt(
    context.key,
    input.source_process_launch_receipt,
    context.frame,
    context.request_bytes,
    clock.now(),
  )
  if (!commitReplayWorkerV10AuthorityDispatchAttempt(input.registry_root, attempt)) {
    const winner = readReplayWorkerV10AuthorityDispatchReceiptRecord(input.registry_root, context.key)
    if (winner) return { receipt: winner, disposition: "durable_receipt_without_live_handle" }
    throw indeterminateAttempt()
  }
  const transport = input.source_process_launch_receipt.source_launch_attempt.source_spawn_revalidation
    .source_authority_capsule.source_authority_process_launch_intent
    .source_authority_execution_admission_command.source_authority_transport_contract
  const writeStartedAt = clock.now()
  let writeCompletedAt: string | null = null
  const capture = await input.session.dispatchOpaqueRequest({
    request_bytes: context.request_bytes,
    timeout_ms: transport.timeout_ms,
    max_stdout_bytes: transport.max_response_frame_bytes,
    max_stderr_bytes: transport.max_response_frame_bytes,
    on_request_written: () => { writeCompletedAt = clock.now() },
  })
  const processCompletedAt = clock.now()
  if (writeCompletedAt === null) {
    throw new Error("Authority Request Dispatch completed without a Request write observation")
  }
  const receipt = buildReplayWorkerV10AuthorityDispatchReceipt({
    key: context.key,
    launch: input.source_process_launch_receipt,
    frame: context.frame,
    request_bytes: context.request_bytes,
    attempt,
    capture,
    write_started_at: writeStartedAt,
    write_completed_at: writeCompletedAt,
    process_completed_at: processCompletedAt,
  })
  return {
    receipt: persistReplayWorkerV10AuthorityDispatchReceipt(input.registry_root, receipt),
    disposition: "new_opaque_transport_capture",
  }
}

export function readReplayWorkerV10AuthorityRequestDispatchAttempt(
  input: ReplayWorkerV10AuthorityRequestDispatchReadInput,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt | null {
  const context = readContext(input)
  return readReplayWorkerV10AuthorityDispatchAttemptRecord(input.registry_root, context.key)
}

export function readReplayWorkerV10AuthorityRequestDispatchReceipt(
  input: ReplayWorkerV10AuthorityRequestDispatchReadInput,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt | null {
  const context = readContext(input)
  const receipt = readReplayWorkerV10AuthorityDispatchReceiptRecord(input.registry_root, context.key)
  if (!receipt) return null
  assertReplayWorkerV10AuthorityDispatchReceiptAttempt(
    receipt.source_dispatch_attempt_hash,
    readReplayWorkerV10AuthorityDispatchAttemptRecord(input.registry_root, context.key),
  )
  return receipt
}

function readContext(input: ReplayWorkerV10AuthorityRequestDispatchReadInput) {
  requireReplayWorkerV10DurableAuthorityLaunch(input)
  const frame = buildReplayWorkerV10AuthorityRequestFrame(input.source_process_launch_receipt)
  return {
    frame,
    key: replayWorkerV10AuthorityDispatchKey(input.source_process_launch_receipt, frame),
    request_bytes: replayWorkerV10AuthorityRequestBytes(input.source_process_launch_receipt, frame),
  }
}

function indeterminateAttempt(): Error {
  return new Error("Authority Request Dispatch Attempt is pending or indeterminate; automatic rewrite is forbidden")
}
