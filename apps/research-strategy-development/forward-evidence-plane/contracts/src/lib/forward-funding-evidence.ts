import {
  buildMarketDataDemandV2,
  compileMarketDataDemand,
  type MarketDataDemand,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  compileMarketDataFactRef,
  type MarketDataFactRef,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"
import {
  compileFundingCoverageAudit,
  type FundingCoverageAudit,
} from "../../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import {
  assertFundingReplaySliceContent,
  compileFundingReplaySliceRef,
  type FundingReplayEvent,
  type FundingReplaySliceRef,
} from "../../../../../contracts/market-data-demand-contract/src/funding-replay-slice-contract"
import {
  canonicalHash,
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import type {
  ForwardObservationProgram,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"
import type {
  ForwardDatasetCandidate,
} from "./forward-dataset-candidate"

export const FORWARD_FUNDING_EVIDENCE_BINDING_SCHEMA =
  "trade.rd-forward-funding-evidence-binding.v1" as const

export interface ForwardFundingEvidenceBinding {
  schema_version: typeof FORWARD_FUNDING_EVIDENCE_BINDING_SCHEMA
  binding_id: string
  candidate_id: string
  candidate_hash: string
  program_id: string
  program_hash: string
  demand: MarketDataDemand
  demand_accepted_at: string
  owner_commit_status: "created" | "renewed" | "existing"
  coverage_audit: FundingCoverageAudit
  market_data_fact: MarketDataFactRef
  funding_slice: FundingReplaySliceRef
  created_at: string
  authority: {
    evidence_binding_authority: "funding_component_only"
    forward_replay_admission_authority: "none"
    deployment_authority: "none"
    trading_authority: false
  }
  binding_hash: string
}

export function forwardFundingCoverageWindow(
  candidate: Pick<ForwardDatasetCandidate, "window">,
): { start_at: string; end_at: string } {
  const startAt = utc(candidate.window.first_open_time, "first_open_time")
  const watermark = Date.parse(
    utc(candidate.window.data_watermark, "data_watermark"),
  )
  if (watermark >= 8_640_000_000_000_000) {
    throw new Error("Forward funding watermark cannot advance by one millisecond")
  }
  const endAt = new Date(watermark + 1).toISOString()
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw new Error("Forward funding coverage window is invalid")
  }
  return { start_at: startAt, end_at: endAt }
}

export function buildForwardFundingMarketDataDemand(
  program: ForwardObservationProgram,
  candidate: ForwardDatasetCandidate,
  input: {
    issued_at: string
    lease_duration_ms?: number
  },
): MarketDataDemand {
  assertCandidateLineage(program, candidate)
  const issuedAt = utc(input.issued_at, "issued_at")
  if (Date.parse(issuedAt) < Date.parse(candidate.created_at)) {
    throw new Error("Forward funding demand cannot predate its candidate")
  }
  const leaseDuration = integer(
    input.lease_duration_ms ?? 86_400_000,
    60_000,
    30 * 86_400_000,
    "lease_duration_ms",
  )
  const window = forwardFundingCoverageWindow(candidate)
  return buildMarketDataDemandV2({
    demand_id:
      `rd-forward-funding:${candidate.candidate_hash.slice(0, 48)}`,
    consumer_owner: "research-forward-evidence",
    consumer_kind: "research",
    subject_ref: `rd-forward-dataset:${candidate.candidate_id}`,
    venue: "binance_usdm",
    symbol: program.symbol,
    priority: "research",
    requirements: [{
      product: "funding_events",
      timeframe: null,
      indicator_set_ref: null,
      coverage_start: window.start_at,
      coverage_end: window.end_at,
      max_freshness_ms: 60_000,
      minimum_depth: null,
    }],
    lease: {
      issued_at: issuedAt,
      expires_at: new Date(
        Date.parse(issuedAt) + leaseDuration,
      ).toISOString(),
      renewal_grace_ms: 0,
    },
  })
}

export function createForwardFundingEvidenceBinding(input: {
  program: ForwardObservationProgram
  candidate: ForwardDatasetCandidate
  demand: unknown
  demand_accepted_at: string
  owner_commit_status: "created" | "renewed" | "existing"
  coverage_audit: unknown
  market_data_fact: unknown
  funding_slice: unknown
  verified_events: unknown
  created_at: string
}): ForwardFundingEvidenceBinding {
  assertCandidateLineage(input.program, input.candidate)
  const demand = compileMarketDataDemand(input.demand)
  const expectedDemand = buildForwardFundingMarketDataDemand(
    input.program,
    input.candidate,
    {
      issued_at: demand.lease.issued_at,
      lease_duration_ms:
        Date.parse(demand.lease.expires_at)
        - Date.parse(demand.lease.issued_at),
    },
  )
  if (canonicalJson(demand) !== canonicalJson(expectedDemand)) {
    throw new Error("Forward funding demand drifted from candidate")
  }
  const audit = compileFundingCoverageAudit(input.coverage_audit)
  const fact = compileMarketDataFactRef(input.market_data_fact)
  const slice = compileFundingReplaySliceRef(input.funding_slice)
  const verifiedEvents = assertFundingReplaySliceContent(
    slice,
    input.verified_events,
  )
  const window = forwardFundingCoverageWindow(input.candidate)
  if (audit.symbol !== input.program.symbol
      || audit.coverage.start_at !== window.start_at
      || audit.coverage.end_at !== window.end_at
      || fact.schema_version !== "trade.market-data-fact-ref.v2"
      || fact.product !== "funding_events"
      || fact.symbol !== input.program.symbol
      || fact.coverage.start_at !== window.start_at
      || fact.coverage.end_at !== window.end_at
      || !fact.consumer_binding.demand_ids.includes(demand.demand_id)
      || fact.source.ref !== audit.source.ref
      || fact.source.content_hash !== audit.source.events_hash
      || slice.symbol !== input.program.symbol
      || slice.coverage.start_at !== window.start_at
      || slice.coverage.end_at !== window.end_at
      || slice.source.archive_id !== audit.source.ref
      || slice.source.coverage_audit_hash !== audit.audit_hash
      || slice.source.normalized_events_hash !== audit.source.events_hash
      || slice.row_count !== audit.source.event_count
      || verifiedEvents.length !== audit.source.event_count) {
    throw new Error("Forward funding evidence lineage drifted")
  }
  const acceptedAt = utc(
    input.demand_accepted_at,
    "demand_accepted_at",
  )
  const createdAt = utc(input.created_at, "created_at")
  if (Date.parse(acceptedAt) < Date.parse(demand.lease.issued_at)
      || Date.parse(createdAt) < Date.parse(acceptedAt)
      || Date.parse(createdAt) < Date.parse(audit.audited_at)
      || Date.parse(createdAt) < Date.parse(fact.freshness.observed_at)) {
    throw new Error("Forward funding evidence chronology drifted")
  }
  const ownerCommitStatus = commitStatus(input.owner_commit_status)
  const identityHash = canonicalHash({
    candidate_hash: input.candidate.candidate_hash,
    demand_hash: demand.demand_hash,
    fact_hash: fact.fact_hash,
    slice_hash: slice.slice_hash,
  })
  const body = {
    schema_version: FORWARD_FUNDING_EVIDENCE_BINDING_SCHEMA,
    binding_id: `forward-funding:${identityHash}`,
    candidate_id: input.candidate.candidate_id,
    candidate_hash: input.candidate.candidate_hash,
    program_id: input.program.program_id,
    program_hash: input.program.program_hash,
    demand,
    demand_accepted_at: acceptedAt,
    owner_commit_status: ownerCommitStatus,
    coverage_audit: audit,
    market_data_fact: fact,
    funding_slice: slice,
    created_at: createdAt,
    authority: {
      evidence_binding_authority: "funding_component_only" as const,
      forward_replay_admission_authority: "none" as const,
      deployment_authority: "none" as const,
      trading_authority: false as const,
    },
  }
  return { ...body, binding_hash: canonicalHash(body) }
}

export function assertForwardFundingEvidenceBinding(input: {
  program: ForwardObservationProgram
  candidate: ForwardDatasetCandidate
  binding: ForwardFundingEvidenceBinding
  verified_events: FundingReplayEvent[]
}): void {
  const expected = createForwardFundingEvidenceBinding({
    program: input.program,
    candidate: input.candidate,
    demand: input.binding.demand,
    demand_accepted_at: input.binding.demand_accepted_at,
    owner_commit_status: input.binding.owner_commit_status,
    coverage_audit: input.binding.coverage_audit,
    market_data_fact: input.binding.market_data_fact,
    funding_slice: input.binding.funding_slice,
    verified_events: input.verified_events,
    created_at: input.binding.created_at,
  })
  if (canonicalJson(input.binding) !== canonicalJson(expected)) {
    throw new Error(
      "Forward funding evidence binding is non-canonical or drifted",
    )
  }
}

function assertCandidateLineage(
  program: ForwardObservationProgram,
  candidate: ForwardDatasetCandidate,
): void {
  if (candidate.program_id !== program.program_id
      || candidate.program_hash !== program.program_hash
      || !/^[a-f0-9]{64}$/.test(candidate.candidate_hash)
      || Date.parse(utc(candidate.created_at, "candidate.created_at"))
        < Date.parse(utc(
          candidate.window.data_watermark,
          "candidate.data_watermark",
        ))) {
    throw new Error("Forward funding Candidate lineage drifted")
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

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)
      || Number(value) < minimum
      || Number(value) > maximum) {
    throw new Error(`${field} is outside bounds`)
  }
  return Number(value)
}

function commitStatus(
  value: unknown,
): ForwardFundingEvidenceBinding["owner_commit_status"] {
  if (value !== "created"
      && value !== "renewed"
      && value !== "existing") {
    throw new Error("owner_commit_status is unsupported")
  }
  return value
}
