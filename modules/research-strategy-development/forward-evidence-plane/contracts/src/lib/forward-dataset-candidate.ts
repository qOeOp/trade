import {
  canonicalHash,
  canonicalJson,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  assertReplayMarketBars,
  replayDatasetHash,
  type ReplayMarketBar,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  assertForwardObservationCandleSegment,
  type ForwardObservationCandleSegment,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-candle-segment"
import {
  assertForwardObservationProgram,
  type ForwardObservationProgram,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"

export const FORWARD_DATASET_CANDIDATE_SCHEMA_VERSION =
  "trade.rd-forward-dataset-candidate.v1" as const

export interface ForwardDatasetCandidateBody {
  schema_version: typeof FORWARD_DATASET_CANDIDATE_SCHEMA_VERSION
  candidate_id: string
  program_id: string
  program_hash: string
  segment_chain: Array<{
    segment_id: string
    segment_hash: string
    slice_ref: string
    slice_content_sha256: string
  }>
  head_segment_id: string
  head_segment_hash: string
  window: {
    first_open_time: string
    last_open_time: string
    data_watermark: string
    row_count: number
  }
  dataset_components: {
    bars: "complete"
    funding_events: "empty_unverified"
    mark_events: "empty_unverified"
    supplemental_facts: "empty_unverified"
  }
  bars_artifact_ref: string
  bars_artifact_sha256: string
  ohlcv_only_replay_dataset_hash: string
  created_at: string
  authority: {
    dataset_candidate_authority: "ohlcv_materialization_only"
    forward_replay_admission_authority: "none"
    deployment_authority: "none"
    trading_authority: false
  }
}

export interface ForwardDatasetCandidate
  extends ForwardDatasetCandidateBody {
  candidate_hash: string
}

export function createForwardDatasetCandidate(input: {
  program: ForwardObservationProgram
  segments: ForwardObservationCandleSegment[]
  bars: ReplayMarketBar[]
  bars_artifact_ref: string
  bars_artifact_sha256: string
  created_at: string
}): ForwardDatasetCandidate {
  assertForwardObservationProgram(input.program)
  if (input.segments.length < 1 || input.segments.length > 100_000) {
    throw new Error("Forward dataset segment chain is empty or unbounded")
  }
  assertReplayMarketBars(input.bars)
  const segmentChain: ForwardDatasetCandidateBody["segment_chain"] = []
  let previous: ForwardObservationCandleSegment | null = null
  let expectedRows = 0
  for (const segment of input.segments) {
    assertForwardObservationCandleSegment(
      input.program,
      segment,
      previous,
    )
    segmentChain.push({
      segment_id: segment.segment_id,
      segment_hash: segment.segment_hash,
      slice_ref: segment.candle_slice.slice_ref,
      slice_content_sha256: segment.candle_slice.content_sha256,
    })
    expectedRows += segment.window.row_count
    previous = segment
  }
  if (input.bars.length !== expectedRows) {
    throw new Error("Forward dataset row count drifted from segment chain")
  }
  const first = input.segments[0]!
  const head = input.segments.at(-1)!
  const timeframeMs = head.coverage_audit.timeframe_ms
  for (let index = 0; index < input.bars.length; index += 1) {
    const bar = input.bars[index]!
    const expectedOpen =
      Date.parse(first.window.start_open_time) + index * timeframeMs
    if (Date.parse(bar.open_time) !== expectedOpen
        || Date.parse(bar.close_time) !== expectedOpen + timeframeMs
        || !bar.closed) {
      throw new Error("Forward dataset bars are not one closed gapless grid")
    }
  }
  if (input.bars[0]!.open_time !== first.window.start_open_time
      || input.bars.at(-1)!.open_time !== head.window.end_open_time
      || input.bars.at(-1)!.close_time !== head.window.data_watermark) {
    throw new Error("Forward dataset bar boundary drifted from segments")
  }
  const datasetHash = replayDatasetHash(input.bars)
  if (input.bars_artifact_sha256 !== datasetHash) {
    throw new Error("Forward dataset artifact hash drifted")
  }
  const artifactRef =
    `data/artifacts/research/forward-dataset-candidates/${datasetHash}/dataset.json`
  if (input.bars_artifact_ref !== artifactRef) {
    throw new Error("Forward dataset artifact ref drifted")
  }
  const createdAt = utc(input.created_at, "created_at")
  if (Date.parse(createdAt) < Date.parse(head.window.data_watermark)) {
    throw new Error("Forward dataset candidate predates its watermark")
  }
  const identityHash = canonicalHash({
    program_hash: input.program.program_hash,
    head_segment_hash: head.segment_hash,
    dataset_hash: datasetHash,
  })
  const body: ForwardDatasetCandidateBody = {
    schema_version: FORWARD_DATASET_CANDIDATE_SCHEMA_VERSION,
    candidate_id: `forward-dataset:${identityHash}`,
    program_id: input.program.program_id,
    program_hash: input.program.program_hash,
    segment_chain: segmentChain,
    head_segment_id: head.segment_id,
    head_segment_hash: head.segment_hash,
    window: {
      first_open_time: first.window.start_open_time,
      last_open_time: head.window.end_open_time,
      data_watermark: head.window.data_watermark,
      row_count: input.bars.length,
    },
    dataset_components: {
      bars: "complete",
      funding_events: "empty_unverified",
      mark_events: "empty_unverified",
      supplemental_facts: "empty_unverified",
    },
    bars_artifact_ref: artifactRef,
    bars_artifact_sha256: datasetHash,
    ohlcv_only_replay_dataset_hash: datasetHash,
    created_at: createdAt,
    authority: {
      dataset_candidate_authority: "ohlcv_materialization_only",
      forward_replay_admission_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    },
  }
  return { ...body, candidate_hash: canonicalHash(body) }
}

export function assertForwardDatasetCandidate(
  program: ForwardObservationProgram,
  segments: ForwardObservationCandleSegment[],
  bars: ReplayMarketBar[],
  value: ForwardDatasetCandidate,
): void {
  const expected = createForwardDatasetCandidate({
    program,
    segments,
    bars,
    bars_artifact_ref: value.bars_artifact_ref,
    bars_artifact_sha256: value.bars_artifact_sha256,
    created_at: value.created_at,
  })
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Forward dataset candidate is non-canonical or drifted")
  }
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
