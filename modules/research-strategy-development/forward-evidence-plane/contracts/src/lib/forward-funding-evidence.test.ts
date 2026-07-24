import { expect, test } from "bun:test"
import {
  buildFundingCoverageAudit,
} from "../../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import {
  buildMarketDataFactRefV2,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"
import {
  buildFundingReplaySliceRef,
} from "../../../../../contracts/market-data-demand-contract/src/funding-replay-slice-contract"
import {
  createForwardObservationProgram,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"
import type {
  ForwardDatasetCandidate,
} from "./forward-dataset-candidate"
import {
  assertForwardFundingEvidenceBinding,
  buildForwardFundingMarketDataDemand,
  createForwardFundingEvidenceBinding,
  forwardFundingCoverageWindow,
} from "./forward-funding-evidence"

const HASH = "a".repeat(64)

test("Forward funding binds exact owner evidence including the last-close millisecond without authority", () => {
  const program = createForwardObservationProgram({
    program_id: "forward-program-1",
    source_admission_id: "forward-source-1",
    source_binding_hash: HASH,
    experiment_id: "experiment-1",
    decision_id: "decision-1",
    draft_id: "draft-1",
    strategy_id: "S-1",
    strategy_version: "draft-1",
    strategy_policy_hash: HASH,
    selected_trial_id: "trial-1",
    historical_replay_request_registration_id: "registration-1",
    historical_replay_request_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    frozen_at: "2026-07-23T00:00:00.000Z",
    market_data_demand_id: "rd-forward:source-1",
    created_at: "2026-07-23T00:01:00.000Z",
  })
  const candidate = {
    schema_version: "trade.rd-forward-dataset-candidate.v1",
    candidate_id: "forward-dataset:candidate-1",
    candidate_hash: "b".repeat(64),
    program_id: program.program_id,
    program_hash: program.program_hash,
    segment_chain: [{
      segment_id: "segment-1",
      segment_hash: HASH,
      slice_ref: `market-data://candle-slice/${HASH}`,
      slice_content_sha256: HASH,
    }],
    head_segment_id: "segment-1",
    head_segment_hash: HASH,
    window: {
      first_open_time: "2026-07-23T04:00:00.000Z",
      last_open_time: "2026-07-23T04:00:00.000Z",
      data_watermark: "2026-07-23T08:00:00.000Z",
      row_count: 1,
    },
    dataset_components: {
      bars: "complete",
      funding_events: "empty_unverified",
      mark_events: "empty_unverified",
      supplemental_facts: "empty_unverified",
    },
    bars_artifact_ref:
      `data/artifacts/research/forward-dataset-candidates/${HASH}/dataset.json`,
    bars_artifact_sha256: HASH,
    ohlcv_only_replay_dataset_hash: HASH,
    created_at: "2026-07-23T08:00:00.000Z",
    authority: {
      dataset_candidate_authority: "ohlcv_materialization_only",
      forward_replay_admission_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    },
  } satisfies ForwardDatasetCandidate
  const window = forwardFundingCoverageWindow(candidate)
  expect(window.end_at).toBe("2026-07-23T08:00:00.001Z")
  const demand = buildForwardFundingMarketDataDemand(program, candidate, {
    issued_at: "2026-07-23T08:00:01.000Z",
  })
  const events = [{
    timestamp: "2026-07-23T08:00:00.000Z",
    rate: 0.0001,
    mark_price: 119_000,
  }]
  const audit = buildFundingCoverageAudit({
    venue: "binance_usdm",
    symbol: program.symbol,
    coverage: {
      start_at: window.start_at,
      end_at: window.end_at,
      completeness: "provider_page_exhaustion",
    },
    source: {
      capability: "binance_usdm_rest_funding_rate",
      ref: "funding-archive:BTCUSDT:source",
      content_hash: "c".repeat(64),
      page_receipts: [{
        page_ordinal: 0,
        requested_start_ms: Date.parse(window.start_at),
        requested_end_ms: Date.parse(window.end_at) - 1,
        row_count: 1,
        first_event_ms: Date.parse(events[0]!.timestamp),
        last_event_ms: Date.parse(events[0]!.timestamp),
        response_hash: "d".repeat(64),
      }],
      event_count: events.length,
      events_hash: "e".repeat(64),
      external_authenticity: "not_verified",
    },
    audited_at: "2026-07-23T08:00:02.000Z",
  })
  const fact = buildMarketDataFactRefV2({
    product: "funding_events",
    venue: "binance_usdm",
    symbol: program.symbol,
    requirement: {
      timeframe: null,
      indicator_set_ref: null,
      minimum_depth: null,
    },
    consumer_binding: {
      demand_ids: [demand.demand_id],
      source_plan_hash: "f".repeat(64),
    },
    source: {
      ref: audit.source.ref,
      content_hash: audit.source.events_hash,
    },
    coverage: {
      kind: "half_open",
      start_at: window.start_at,
      end_at: window.end_at,
      completeness: "complete",
    },
    freshness: {
      kind: "immutable",
      as_of: window.end_at,
      observed_at: audit.audited_at,
      max_freshness_ms: null,
      status: "not_applicable",
    },
  })
  const slice = buildFundingReplaySliceRef({
    symbol: program.symbol,
    coverage_start: window.start_at,
    coverage_end: window.end_at,
    source_archive_id: audit.source.ref,
    coverage_audit_hash: audit.audit_hash,
    normalized_events_hash: audit.source.events_hash,
    events,
  })
  const binding = createForwardFundingEvidenceBinding({
    program,
    candidate,
    demand,
    demand_accepted_at: "2026-07-23T08:00:03.000Z",
    owner_commit_status: "created",
    coverage_audit: audit,
    market_data_fact: fact,
    funding_slice: slice,
    verified_events: events,
    created_at: "2026-07-23T08:00:04.000Z",
  })
  expect(binding.authority.forward_replay_admission_authority).toBe("none")
  expect(() => assertForwardFundingEvidenceBinding({
    program,
    candidate,
    binding,
    verified_events: events,
  })).not.toThrow()
  expect(() => createForwardFundingEvidenceBinding({
    program,
    candidate,
    demand,
    demand_accepted_at: "2026-07-23T08:00:03.000Z",
    owner_commit_status: "created",
    coverage_audit: audit,
    market_data_fact: fact,
    funding_slice: slice,
    verified_events: [{ ...events[0]!, mark_price: 0 }],
    created_at: "2026-07-23T08:00:04.000Z",
  })).toThrow()
})
