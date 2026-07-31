import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas, writeReplayImmutableCasWithDisposition } from "./replay-local-artifact-store"
import { readReplayWorkerV10CanonicalRecord } from "./replay-worker-v10-canonical-record-store"

export function commitReplayWorkerV10AuthorityDispatchAttempt(
  root: string,
  attempt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
): boolean {
  return writeReplayImmutableCasWithDisposition(
    dispatchAttemptPath(root, attempt.dispatch_attempt_key),
    `${canonicalJson(attempt)}\n`,
  ).created
}

export function readReplayWorkerV10AuthorityDispatchAttemptRecord(
  root: string,
  key: string,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt | null {
  return readReplayWorkerV10CanonicalRecord(
    dispatchAttemptPath(root, key),
    "Authority Request Dispatch Attempt",
    assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt,
  )
}

export function persistReplayWorkerV10AuthorityDispatchReceipt(
  root: string,
  receipt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt {
  writeReplayImmutableCas(
    dispatchReceiptPath(root, receipt.receipt_key),
    `${canonicalJson(receipt)}\n`,
  )
  const durable = readReplayWorkerV10AuthorityDispatchReceiptRecord(root, receipt.receipt_key)
  if (!durable) throw new Error("Authority Request Dispatch Receipt disappeared after commit")
  return durable
}

export function readReplayWorkerV10AuthorityDispatchReceiptRecord(
  root: string,
  key: string,
): ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt | null {
  return readReplayWorkerV10CanonicalRecord(
    dispatchReceiptPath(root, key),
    "Authority Request Dispatch Receipt",
    assertReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt,
  )
}

function dispatchAttemptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-request-dispatch-attempt-${key}.json`)
}

function dispatchReceiptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-request-dispatch-receipt-${key}.json`)
}
