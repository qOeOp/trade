import { createHash } from "node:crypto"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_L2_DEPTH_ADAPTER_POLICY_VERSION,
  REPLAY_L2_DEPTH_LIMITATIONS,
  REPLAY_L2_DEPTH_READ_BATCH_SCHEMA_VERSION,
  assertReplayL2CompactedEpochSource,
  assertReplayL2DepthReadBatch,
  assertReplayL2DepthRow,
  replayL2DepthReadBatchHash,
  type ReplayL2CompactedEpochSource,
  type ReplayL2DepthReadBatch,
  type ReplayL2DepthRow,
} from "../../../contracts/src/lib/replay-l2-depth-contracts"

export interface ReplayL2DepthReadInput {
  source: ReplayL2CompactedEpochSource
  offset: number
  requested_limit: number
  predecessor_row: ReplayL2DepthRow | null
  rows: ReplayL2DepthRow[]
}

export function materializeReplayL2DepthReadBatch(
  input: ReplayL2DepthReadInput,
): ReplayL2DepthReadBatch {
  assertReplayL2CompactedEpochSource(input.source)
  requireInteger(input.offset, "offset", 0)
  requireInteger(input.requested_limit, "requested_limit", 1, 1_000)
  if (input.offset > input.source.row_count) throw new Error("Replay L2 read offset exceeds source coverage")
  const expectedRows = Math.min(input.requested_limit, input.source.row_count - input.offset)
  if (input.rows.length !== expectedRows) throw new Error("Replay L2 read does not close requested bounded coverage")
  if (input.offset === 0 && input.predecessor_row !== null) {
    throw new Error("Replay L2 first batch cannot carry a predecessor")
  }
  if (input.offset > 0 && input.predecessor_row === null) {
    throw new Error("Replay L2 non-zero offset requires the preceding row")
  }

  const source = input.source
  const predecessor = input.predecessor_row
  if (predecessor != null) {
    assertBoundRow(predecessor, source, input.offset)
  }
  let previous = predecessor
  input.rows.forEach((row, index) => {
    assertBoundRow(row, source, input.offset + index + 1)
    if (previous != null) {
      if (row.previous_final_update_id !== previous.final_update_id
          || row.final_update_id <= previous.final_update_id
          || row.local_receive_time_ms < previous.local_receive_time_ms) {
        throw new Error("Replay L2 bounded read contains a frame gap, reversal, or time regression")
      }
    }
    previous = row
  })

  const first = input.rows[0]
  if (input.offset === 0 && (first == null
    || first.local_receive_time_ms !== source.first_local_receive_time_ms
    || first.final_update_id !== source.first_final_update_id)) {
    throw new Error("Replay L2 first batch does not match source coverage")
  }
  const nextOffset = input.offset + input.rows.length
  const exhausted = nextOffset === source.row_count
  const terminal = input.rows.at(-1) ?? predecessor
  if (exhausted && (terminal == null
    || terminal.local_receive_time_ms !== source.last_local_receive_time_ms
    || terminal.final_update_id !== source.last_final_update_id
    || terminal.frame_index !== source.row_count)) {
    throw new Error("Replay L2 exhausted batch does not close source coverage")
  }

  const rowsHash = canonicalHash(input.rows)
  const predecessorFinalUpdateId = predecessor?.final_update_id ?? null
  const identity = canonicalHash({
    source_hash: source.source_hash,
    offset: input.offset,
    requested_limit: input.requested_limit,
    predecessor_final_update_id: predecessorFinalUpdateId,
    rows_hash: rowsHash,
  })
  const body = {
    schema_version: REPLAY_L2_DEPTH_READ_BATCH_SCHEMA_VERSION,
    policy_version: REPLAY_L2_DEPTH_ADAPTER_POLICY_VERSION,
    batch_id: `replay-l2-depth-batch:${identity}`,
    source_id: source.source_id,
    source_hash: source.source_hash,
    compaction_id: source.compaction_id,
    offset: input.offset,
    requested_limit: input.requested_limit,
    row_count: input.rows.length,
    next_offset: nextOffset,
    exhausted,
    predecessor_final_update_id: predecessorFinalUpdateId,
    rows: input.rows,
    rows_hash: rowsHash,
    continuity_result: "passed" as const,
    gap_policy: "reject_missing_frame_and_cross_epoch_join" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    external_completeness: "not_verified" as const,
    limitations: [...REPLAY_L2_DEPTH_LIMITATIONS],
  }
  const result: ReplayL2DepthReadBatch = {
    ...body,
    batch_hash: replayL2DepthReadBatchHash(body),
  }
  assertReplayL2DepthReadBatch(result)
  return result
}

function assertBoundRow(
  row: ReplayL2DepthRow,
  source: ReplayL2CompactedEpochSource,
  expectedFrameIndex: number,
): void {
  assertReplayL2DepthRow(row)
  if (row.symbol !== source.symbol || row.stream_epoch !== source.stream_epoch
      || row.frame_index !== expectedFrameIndex
      || row.local_receive_time_ms < source.first_local_receive_time_ms
      || row.local_receive_time_ms > source.last_local_receive_time_ms
      || row.final_update_id < source.first_final_update_id
      || row.final_update_id > source.last_final_update_id) {
    throw new Error("Replay L2 row differs from compacted epoch source")
  }
  if (sha256(row.raw_payload) !== row.raw_payload_hash) throw new Error("Replay L2 raw payload hash mismatch")
  const envelope = parseRawEnvelope(row.raw_payload)
  if (envelope.data.s !== row.symbol || envelope.data.E !== row.exchange_event_time_ms
      || envelope.data.T !== row.transaction_time_ms || envelope.data.U !== row.first_update_id
      || envelope.data.u !== row.final_update_id || envelope.data.pu !== row.previous_final_update_id) {
    throw new Error("Replay L2 normalized row differs from raw payload")
  }
}

function parseRawEnvelope(value: string): {
  data: { s: string; E: number; T: number; U: number; u: number; pu: number }
} {
  const parsed = JSON.parse(value) as unknown
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Replay L2 raw payload is not a combined stream envelope")
  }
  const data = (parsed as Record<string, unknown>).data
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Replay L2 raw payload is missing depth data")
  }
  const record = data as Record<string, unknown>
  const result = { s: record.s, E: record.E, T: record.T, U: record.U, u: record.u, pu: record.pu }
  if (typeof result.s !== "string" || ![result.E, result.T, result.U, result.u, result.pu]
    .every((item) => typeof item === "number" && Number.isSafeInteger(item) && item > 0)) {
    throw new Error("Replay L2 raw payload depth identity is invalid")
  }
  return { data: result as { s: string; E: number; T: number; U: number; u: number; pu: number } }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function requireInteger(value: number, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Replay L2 ${field} must be a safe integer between ${minimum} and ${maximum}`)
  }
}
