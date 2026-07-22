import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_L2_COMPACTED_EPOCH_SOURCE_SCHEMA_VERSION,
  assertReplayL2DepthReadBatch,
  type ReplayL2CompactedEpochSource,
  type ReplayL2DepthRow,
} from "../../../contracts/src/lib/replay-l2-depth-contracts"
import { materializeReplayL2DepthReadBatch } from "./replay-l2-depth-read"

describe("Replay L2 bounded source adapter", () => {
  test("binds one compacted epoch and proves bounded U/u/pu continuity", () => {
    const source = buildSource()
    const rows = buildRows()
    const full = materializeReplayL2DepthReadBatch({
      source,
      offset: 0,
      requested_limit: 100,
      predecessor_row: null,
      rows,
    })
    expect(full.row_count).toBe(2)
    expect(full.next_offset).toBe(2)
    expect(full.exhausted).toBe(true)
    expect(full.economic_authority).toBe("none")
    expect(full.runner_compatibility).toBe("not_bound")
    assertReplayL2DepthReadBatch(full)

    const tail = materializeReplayL2DepthReadBatch({
      source,
      offset: 1,
      requested_limit: 1,
      predecessor_row: rows[0]!,
      rows: [rows[1]!],
    })
    expect(tail.predecessor_final_update_id).toBe(105)
    expect(tail.batch_hash).toBe(materializeReplayL2DepthReadBatch({
      source,
      offset: 1,
      requested_limit: 1,
      predecessor_row: rows[0]!,
      rows: [rows[1]!],
    }).batch_hash)
  })

  test("rejects missing predecessor, frame gaps, raw drift, and incomplete read claims", () => {
    const source = buildSource()
    const rows = buildRows()
    expect(() => materializeReplayL2DepthReadBatch({
      source, offset: 1, requested_limit: 1, predecessor_row: null, rows: [rows[1]!],
    })).toThrow("requires the preceding row")

    const gap = buildRow({ frame_index: 2, local_receive_time_ms: 1_100,
      first_update_id: 106, final_update_id: 110, previous_final_update_id: 104 })
    expect(() => materializeReplayL2DepthReadBatch({
      source, offset: 1, requested_limit: 1, predecessor_row: rows[0]!, rows: [gap],
    })).toThrow("frame gap")

    expect(() => materializeReplayL2DepthReadBatch({
      source,
      offset: 0,
      requested_limit: 2,
      predecessor_row: null,
      rows: [{ ...rows[0]!, raw_payload: `${rows[0]!.raw_payload} ` }, rows[1]!],
    })).toThrow("raw payload hash mismatch")

    expect(() => materializeReplayL2DepthReadBatch({
      source, offset: 0, requested_limit: 2, predecessor_row: null, rows: [rows[0]!],
    })).toThrow("does not close requested bounded coverage")
  })
})

function buildSource(): ReplayL2CompactedEpochSource {
  const body = {
    schema_version: REPLAY_L2_COMPACTED_EPOCH_SOURCE_SCHEMA_VERSION,
    compaction_id: `l2-compaction:${"a".repeat(64)}`,
    epoch_id: "binance-usdm:BTCUSDT:fixture-0001",
    venue_id: "binance-usdm" as const,
    symbol: "BTCUSDT",
    stream_epoch: "fixture-0001",
    source_manifest_path: "tmp/l2-order-book-service/fixture/epoch-manifest.json",
    source_manifest_hash: "b".repeat(64),
    parquet_path: "tmp/l2-order-book-compactor/fixture/epoch.parquet",
    parquet_hash: "c".repeat(64),
    parquet_bytes: 1_024,
    row_count: 2,
    first_local_receive_time_ms: 1_000,
    last_local_receive_time_ms: 1_100,
    first_final_update_id: 105,
    last_final_update_id: 110,
    continuity_scope: "single_epoch_contiguous" as const,
    external_completeness: "not_verified" as const,
    retention_class: "compacted_pinned" as const,
    deletion_eligible: false as const,
    admitted_at: "2026-07-22T10:11:00Z",
  }
  const sourceHash = canonicalHash(body)
  return { ...body, source_id: `l2-compacted-epoch:${sourceHash}`, source_hash: sourceHash }
}

function buildRows(): ReplayL2DepthRow[] {
  return [
    buildRow({ frame_index: 1, local_receive_time_ms: 1_000,
      first_update_id: 101, final_update_id: 105, previous_final_update_id: 100 }),
    buildRow({ frame_index: 2, local_receive_time_ms: 1_100,
      first_update_id: 106, final_update_id: 110, previous_final_update_id: 105 }),
  ]
}

function buildRow(input: {
  frame_index: number
  local_receive_time_ms: number
  first_update_id: number
  final_update_id: number
  previous_final_update_id: number
}): ReplayL2DepthRow {
  const eventTime = input.local_receive_time_ms
  const transactionTime = eventTime - 1
  const rawPayload = JSON.stringify({
    stream: "btcusdt@depth@100ms",
    data: {
      e: "depthUpdate",
      E: eventTime,
      T: transactionTime,
      s: "BTCUSDT",
      U: input.first_update_id,
      u: input.final_update_id,
      pu: input.previous_final_update_id,
      b: [],
      a: [],
    },
  })
  return {
    schema_version: "trade.l2-parquet-row.v1",
    symbol: "BTCUSDT",
    stream_epoch: "fixture-0001",
    frame_index: input.frame_index,
    local_receive_time_ms: eventTime,
    exchange_event_time_ms: eventTime,
    transaction_time_ms: transactionTime,
    first_update_id: input.first_update_id,
    final_update_id: input.final_update_id,
    previous_final_update_id: input.previous_final_update_id,
    raw_payload_hash: createHash("sha256").update(rawPayload).digest("hex"),
    raw_payload: rawPayload,
  }
}
