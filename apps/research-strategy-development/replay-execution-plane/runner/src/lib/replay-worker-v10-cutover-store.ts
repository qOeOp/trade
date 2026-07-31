import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10CutoverReceipt,
  type ReplayDecisionHarnessWorkerV10CutoverReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas, writeReplayImmutableCasWithDisposition } from "./replay-local-artifact-store"
import { readReplayWorkerV10CanonicalRecord } from "./replay-worker-v10-canonical-record-store"

export function commitReplayWorkerV10CutoverAttempt(
  root: string,
  key: string,
  pairContractHash: string,
  spawnRevalidationHash: string,
): boolean {
  const attempt = {
    schema_version: "trade.rd-replay-decision-harness-worker-v10-cutover-attempt.v1",
    cutover_key: key,
    source_pair_contract_hash: pairContractHash,
    source_successor_spawn_revalidation_hash: spawnRevalidationHash,
    status: "spawn_slot_committed_outcome_pending",
  } as const
  return writeReplayImmutableCasWithDisposition(
    join(resolve(root), `worker-v10-cutover-attempt-${key}.json`),
    `${canonicalJson(attempt)}\n`,
  ).created
}

export function readReplayWorkerV10CutoverReceiptRecord(
  root: string,
  key: string,
): ReplayDecisionHarnessWorkerV10CutoverReceipt | null {
  return readReplayWorkerV10CanonicalRecord(
    join(resolve(root), `worker-v10-cutover-receipt-${key}.json`),
    "Worker v10 cutover receipt",
    assertReplayDecisionHarnessWorkerV10CutoverReceipt,
  )
}

export function persistReplayWorkerV10CutoverReceipt(
  root: string,
  receipt: ReplayDecisionHarnessWorkerV10CutoverReceipt,
): ReplayDecisionHarnessWorkerV10CutoverReceipt {
  const path = join(resolve(root), `worker-v10-cutover-receipt-${receipt.receipt_key}.json`)
  writeReplayImmutableCas(path, `${canonicalJson(receipt)}\n`)
  const durable = readReplayWorkerV10CutoverReceiptRecord(root, receipt.receipt_key)
  if (!durable) throw new Error("Worker v10 cutover receipt disappeared after commit")
  return durable
}
