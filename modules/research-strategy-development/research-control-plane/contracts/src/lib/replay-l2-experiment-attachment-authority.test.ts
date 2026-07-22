import { expect, test } from "bun:test"
import { canonicalControlPlaneHash } from "./control-plane-contracts"
import {
  REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS,
  REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_SCHEMA_VERSION,
  assertReplayL2ExperimentAttachmentAuthoritySnapshot,
  createReplayL2ExperimentAttachmentAuthoritySnapshot,
} from "./replay-l2-experiment-attachment-authority"

const HASH = "a".repeat(64)

function authority() {
  return createReplayL2ExperimentAttachmentAuthoritySnapshot({
    schema_version: REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_SCHEMA_VERSION,
    authority_snapshot_id: "l2-authority-1",
    authority_snapshot_ref: "authority://l2/trial-1",
    status: "authorized",
    issued_at: "2026-07-14T03:27:00Z",
    authority_id: "research-control-plane",
    authority_policy_version: "rd-replay-l2-experiment-attachment-v1",
    trial_id: "trial-1",
    run_id: "run-1",
    reservation_ref: "reservation://trial-1",
    reservation_hash: HASH,
    request_schema_version: "trade.rd-replay-execution-request.v38",
    request_hash: HASH,
    dataset_manifest_id: "manifest-1",
    dataset_manifest_ref: "dataset://manifest-1",
    dataset_data_hash: HASH,
    dataset_manifest_hash: HASH,
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_id: "l2-compacted-epoch:fixture",
    source_hash: HASH,
    compaction_id: "l2-compaction:fixture",
    epoch_id: "epoch-1",
    stream_epoch: "stream-epoch-1",
    source_row_count: 49,
    source_parquet_hash: HASH,
    source_retention_class: "compacted_pinned",
    source_deletion_eligible: false,
    batch_id: "replay-l2-depth-batch:fixture",
    batch_hash: HASH,
    batch_rows_hash: HASH,
    batch_offset: 10,
    batch_row_count: 20,
    batch_next_offset: 30,
    frame_start_inclusive: 11,
    frame_end_exclusive: 31,
    batch_exhausted: false,
    attachment_scope: "one_exact_validated_batch_within_one_compacted_epoch",
    gap_policy: "reject_missing_frame_and_cross_epoch_join",
    economic_authority: "none",
    runner_compatibility: "not_bound",
    external_completeness: "not_verified",
    limitations: [...REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS],
    limitations_hash: canonicalControlPlaneHash(REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS),
  })
}

test("L2 experiment attachment freezes one non-economic epoch batch", () => {
  const value = authority()
  expect(() => assertReplayL2ExperimentAttachmentAuthoritySnapshot(value)).not.toThrow()
  expect(value.authority_snapshot_hash).toHaveLength(64)
  expect(value.runner_compatibility).toBe("not_bound")
  expect(value.economic_authority).toBe("none")
})

test("L2 experiment attachment rejects frame, capability, and field drift", () => {
  const value = authority()
  expect(() => assertReplayL2ExperimentAttachmentAuthoritySnapshot({
    ...value,
    frame_end_exclusive: 32,
  })).toThrow("bounds")
  expect(() => assertReplayL2ExperimentAttachmentAuthoritySnapshot({
    ...value,
    runner_compatibility: "bound",
  } as unknown as typeof value)).toThrow("unsupported")
  expect(() => assertReplayL2ExperimentAttachmentAuthoritySnapshot({
    ...value,
    injected: true,
  } as typeof value)).toThrow("field whitelist drift")
})
