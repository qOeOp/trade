import {
  compileMarketDataSubscriptionPlan,
  type MarketDataDemand,
  type MarketDataSubscriptionPlan,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  buildMarketDataFactRef,
  compileMarketDataFactRef,
  type MarketDataFactRef,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"
import {
  compileOhlcvCoverageAudit,
  type OhlcvCoverageAudit,
} from "../../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import {
  canonicalHash,
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  assertForwardObservationMarketDataDemand,
  assertForwardObservationProgram,
  type ForwardObservationProgram,
} from "./forward-observation-program"

export const FORWARD_OBSERVATION_CANDLE_SEGMENT_SCHEMA_VERSION =
  "trade.rd-forward-observation-candle-segment.v1" as const

export interface ForwardCandleSliceRef {
  schema_version: "market-data.candle-slice-export.v1"
  slice_ref: string
  manifest_path: string
  content_sha256: string
  rows: number
  first_open_ts: number
  last_open_ts: number
}

export interface ForwardObservationCandleSegmentBody {
  schema_version:
    typeof FORWARD_OBSERVATION_CANDLE_SEGMENT_SCHEMA_VERSION
  segment_id: string
  program_id: string
  program_hash: string
  previous_segment: {
    segment_id: string
    segment_hash: string
    end_open_time: string
  } | null
  demand: MarketDataDemand
  demand_accepted_at: string
  subscription_plan: MarketDataSubscriptionPlan
  coverage_audit: OhlcvCoverageAudit
  market_data_fact: MarketDataFactRef
  candle_slice: ForwardCandleSliceRef
  window: {
    start_open_time: string
    end_open_time: string
    data_watermark: string
    row_count: number
  }
  created_at: string
  authority: {
    forward_dataset_materialization_authority: "segment_only"
    forward_replay_admission_authority: "none"
    deployment_authority: "none"
    trading_authority: false
  }
}

export interface ForwardObservationCandleSegment
  extends ForwardObservationCandleSegmentBody {
  segment_hash: string
}

export function createForwardObservationCandleSegment(input: {
  program: ForwardObservationProgram
  previous_segment:
    ForwardObservationCandleSegmentBody["previous_segment"]
  demand: MarketDataDemand
  demand_accepted_at: string
  subscription_plan: MarketDataSubscriptionPlan
  coverage_audit: OhlcvCoverageAudit
  market_data_fact?: MarketDataFactRef
  candle_slice: ForwardCandleSliceRef
  created_at: string
}): ForwardObservationCandleSegment {
  assertForwardObservationProgram(input.program)
  const demand = assertForwardObservationMarketDataDemand(
    input.program,
    input.demand,
  )
  const demandAcceptedAt = utc(
    input.demand_accepted_at,
    "demand_accepted_at",
  )
  if (Date.parse(demandAcceptedAt) < Date.parse(demand.lease.issued_at)
      || Date.parse(demandAcceptedAt) > Date.parse(demand.lease.expires_at)) {
    throw new Error("Forward candle segment demand receipt is outside its lease")
  }
  const plan = compileMarketDataSubscriptionPlan(
    input.subscription_plan,
  )
  const audit = compileOhlcvCoverageAudit(input.coverage_audit)
  const createdAt = utc(input.created_at, "created_at")
  if (plan.observed_at !== audit.observed_at
      || createdAt !== audit.observed_at
      || Date.parse(createdAt) < Date.parse(demandAcceptedAt)) {
    throw new Error("Forward candle segment observation chronology drifted")
  }
  if (plan.status !== "ready"
      || !plan.active_demand_ids.includes(demand.demand_id)
      || plan.deferred_demand_ids.includes(demand.demand_id)) {
    throw new Error("Forward candle segment demand is not selected and active")
  }
  const subscription = plan.subscriptions.find((item) => (
    item.product === "ohlcv"
    && item.symbol === input.program.symbol
    && item.timeframe === input.program.timeframe
    && item.demand_ids.includes(demand.demand_id)
  ))
  if (!subscription
      || subscription.coverage_start == null
      || Date.parse(subscription.coverage_start)
        > Date.parse(input.program.first_observation_open_time)
      || subscription.coverage_end != null) {
    throw new Error("Forward candle segment subscription binding drifted")
  }

  const timeframeMs = audit.timeframe_ms
  const previous = compilePrevious(input.previous_segment)
  const expectedStart = previous == null
    ? Date.parse(input.program.first_observation_open_time)
    : Date.parse(previous.end_open_time) + timeframeMs
  const start = audit.requested_open_range.start_open_time
  const end = audit.requested_open_range.end_open_time
  if (audit.exchange !== "binanceusdm"
      || audit.symbol !== input.program.symbol
      || audit.timeframe !== input.program.timeframe
      || !audit.complete
      || start !== expectedStart
      || audit.first_open_time !== start
      || audit.last_open_time !== end) {
    throw new Error("Forward candle segment coverage binding drifted")
  }
  const dataWatermark = end + timeframeMs
  if (Date.parse(createdAt) < dataWatermark) {
    throw new Error("Forward candle segment includes an unclosed candle")
  }

  const candleSlice = compileSlice(
    input.candle_slice,
    audit.expected_count,
    start,
    end,
  )
  const marketDataFact = buildMarketDataFactRef({
    product: "ohlcv",
    venue: "binance_usdm",
    symbol: input.program.symbol,
    requirement: {
      timeframe: input.program.timeframe,
      indicator_set_ref: null,
      minimum_depth: null,
    },
    consumer_binding: {
      demand_ids: [demand.demand_id],
      source_plan_hash: plan.plan_hash,
    },
    source: {
      ref: audit.source_ref,
      content_hash: audit.audit_hash,
    },
    coverage: {
      kind: "half_open",
      start_at: new Date(start).toISOString(),
      end_at: new Date(dataWatermark).toISOString(),
      completeness: "complete",
    },
    freshness: {
      kind: "immutable",
      as_of: new Date(dataWatermark).toISOString(),
      observed_at: audit.observed_at,
      max_freshness_ms: null,
      status: "not_applicable",
    },
  })
  if (input.market_data_fact != null
      && canonicalJson(compileMarketDataFactRef(input.market_data_fact))
        !== canonicalJson(marketDataFact)) {
    throw new Error("Forward candle segment MarketDataFact drifted")
  }
  const segmentIdentity = canonicalHash({
    program_hash: input.program.program_hash,
    previous_segment_hash: previous?.segment_hash ?? null,
    demand_hash: demand.demand_hash,
    subscription_plan_hash: plan.plan_hash,
    coverage_audit_hash: audit.audit_hash,
    candle_slice_content_sha256: candleSlice.content_sha256,
    start_open_time: start,
    end_open_time: end,
  })
  const body: ForwardObservationCandleSegmentBody = {
    schema_version:
      FORWARD_OBSERVATION_CANDLE_SEGMENT_SCHEMA_VERSION,
    segment_id: `forward-segment:${segmentIdentity}`,
    program_id: input.program.program_id,
    program_hash: input.program.program_hash,
    previous_segment: previous,
    demand,
    demand_accepted_at: demandAcceptedAt,
    subscription_plan: plan,
    coverage_audit: audit,
    market_data_fact: marketDataFact,
    candle_slice: candleSlice,
    window: {
      start_open_time: new Date(start).toISOString(),
      end_open_time: new Date(end).toISOString(),
      data_watermark: new Date(dataWatermark).toISOString(),
      row_count: audit.expected_count,
    },
    created_at: createdAt,
    authority: {
      forward_dataset_materialization_authority: "segment_only",
      forward_replay_admission_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    },
  }
  return { ...body, segment_hash: canonicalHash(body) }
}

export function assertForwardObservationCandleSegment(
  program: ForwardObservationProgram,
  value: ForwardObservationCandleSegment,
  previousSegment?: ForwardObservationCandleSegment | null,
): void {
  const expected = createForwardObservationCandleSegment({
    program,
    previous_segment: previousSegment === undefined
      ? value.previous_segment
      : previousSegment == null
        ? null
        : {
            segment_id: previousSegment.segment_id,
            segment_hash: previousSegment.segment_hash,
            end_open_time: previousSegment.window.end_open_time,
          },
    demand: value.demand,
    demand_accepted_at: value.demand_accepted_at,
    subscription_plan: value.subscription_plan,
    coverage_audit: value.coverage_audit,
    market_data_fact: value.market_data_fact,
    candle_slice: value.candle_slice,
    created_at: value.created_at,
  })
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Forward candle segment is non-canonical or hash-drifted")
  }
}

function compilePrevious(
  value: ForwardObservationCandleSegmentBody["previous_segment"],
): ForwardObservationCandleSegmentBody["previous_segment"] {
  if (value == null) return null
  return {
    segment_id: identifier(value.segment_id, "previous segment_id"),
    segment_hash: digest(value.segment_hash, "previous segment_hash"),
    end_open_time: utc(
      value.end_open_time,
      "previous end_open_time",
    ),
  }
}

function compileSlice(
  value: ForwardCandleSliceRef,
  rows: number,
  firstOpen: number,
  lastOpen: number,
): ForwardCandleSliceRef {
  if (value?.schema_version !== "market-data.candle-slice-export.v1"
      || value.rows !== rows
      || value.first_open_ts !== firstOpen
      || value.last_open_ts !== lastOpen) {
    throw new Error("Forward candle segment slice window drifted")
  }
  const hash = digest(value.content_sha256, "slice content_sha256")
  if (value.slice_ref !== `market-data://candle-slice/${hash}`) {
    throw new Error("Forward candle segment slice_ref drifted")
  }
  const manifestPath = String(value.manifest_path)
  if (!/^data\/artifacts\/market-data\/candle-slices\/[a-f0-9]{64}\/manifest\.json$/
    .test(manifestPath)
      || !manifestPath.includes(hash)) {
    throw new Error("Forward candle segment manifest_path drifted")
  }
  return {
    schema_version: "market-data.candle-slice-export.v1",
    slice_ref: value.slice_ref,
    manifest_path: manifestPath,
    content_sha256: hash,
    rows,
    first_open_ts: firstOpen,
    last_open_ts: lastOpen,
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function digest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be sha256`)
  }
  return value
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
