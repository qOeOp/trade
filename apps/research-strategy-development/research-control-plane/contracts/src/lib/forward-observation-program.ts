import {
  buildMarketDataDemand,
  compileMarketDataDemand,
  type MarketDataDemand,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { timeframeMilliseconds } from "../../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import {
  canonicalHash,
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"

export const FORWARD_OBSERVATION_PROGRAM_SCHEMA_VERSION =
  "trade.rd-forward-observation-program.v1" as const

export interface ForwardObservationProgramBody {
  schema_version: typeof FORWARD_OBSERVATION_PROGRAM_SCHEMA_VERSION
  program_id: string
  source_admission_id: string
  source_binding_hash: string
  experiment_id: string
  decision_id: string
  draft_id: string
  strategy_id: string
  strategy_version: string
  strategy_policy_hash: string
  selected_trial_id: string
  historical_replay_request_registration_id: string
  historical_replay_request_hash: string
  symbol: string
  timeframe: string
  frozen_at: string
  first_observation_open_time: string
  market_data_demand_id: string
  created_at: string
  authority: {
    market_data_demand_authority: "request_only"
    forward_session_authority: "none"
    deployment_authority: "none"
    trading_authority: false
  }
}

export interface ForwardObservationProgram
  extends ForwardObservationProgramBody {
  program_hash: string
}

export function createForwardObservationProgram(
  input: Omit<
    ForwardObservationProgramBody,
    "schema_version" | "first_observation_open_time" | "authority"
  >,
): ForwardObservationProgram {
  const timeframe = timeframeValue(input.timeframe)
  const frozenAt = utc(input.frozen_at, "frozen_at")
  const firstOpen = firstStrictlyPostFreezeOpen(
    Date.parse(frozenAt),
    timeframeMilliseconds(timeframe),
  )
  const createdAt = utc(input.created_at, "created_at")
  if (Date.parse(createdAt) < Date.parse(frozenAt)) {
    throw new Error("Forward observation program cannot predate Candidate freeze")
  }
  const body: ForwardObservationProgramBody = {
    schema_version: FORWARD_OBSERVATION_PROGRAM_SCHEMA_VERSION,
    program_id: identifier(input.program_id, "program_id"),
    source_admission_id: identifier(
      input.source_admission_id,
      "source_admission_id",
    ),
    source_binding_hash: digest(
      input.source_binding_hash,
      "source_binding_hash",
    ),
    experiment_id: identifier(input.experiment_id, "experiment_id"),
    decision_id: identifier(input.decision_id, "decision_id"),
    draft_id: identifier(input.draft_id, "draft_id"),
    strategy_id: identifier(input.strategy_id, "strategy_id"),
    strategy_version: identifier(
      input.strategy_version,
      "strategy_version",
    ),
    strategy_policy_hash: digest(
      input.strategy_policy_hash,
      "strategy_policy_hash",
    ),
    selected_trial_id: identifier(
      input.selected_trial_id,
      "selected_trial_id",
    ),
    historical_replay_request_registration_id: identifier(
      input.historical_replay_request_registration_id,
      "historical_replay_request_registration_id",
    ),
    historical_replay_request_hash: digest(
      input.historical_replay_request_hash,
      "historical_replay_request_hash",
    ),
    symbol: symbol(input.symbol),
    timeframe,
    frozen_at: frozenAt,
    first_observation_open_time: new Date(firstOpen).toISOString(),
    market_data_demand_id: identifier(
      input.market_data_demand_id,
      "market_data_demand_id",
    ),
    created_at: createdAt,
    authority: {
      market_data_demand_authority: "request_only",
      forward_session_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    },
  }
  return { ...body, program_hash: canonicalHash(body) }
}

export function assertForwardObservationProgram(
  value: ForwardObservationProgram,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Forward observation program must be an object")
  }
  const { program_hash: _hash, ...body } = value
  const expected = createForwardObservationProgram({
    program_id: body.program_id,
    source_admission_id: body.source_admission_id,
    source_binding_hash: body.source_binding_hash,
    experiment_id: body.experiment_id,
    decision_id: body.decision_id,
    draft_id: body.draft_id,
    strategy_id: body.strategy_id,
    strategy_version: body.strategy_version,
    strategy_policy_hash: body.strategy_policy_hash,
    selected_trial_id: body.selected_trial_id,
    historical_replay_request_registration_id:
      body.historical_replay_request_registration_id,
    historical_replay_request_hash:
      body.historical_replay_request_hash,
    symbol: body.symbol,
    timeframe: body.timeframe,
    frozen_at: body.frozen_at,
    market_data_demand_id: body.market_data_demand_id,
    created_at: body.created_at,
  })
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Forward observation program is non-canonical or hash-drifted")
  }
}

export function buildForwardObservationMarketDataDemand(
  program: ForwardObservationProgram,
  input: { issued_at: string; lease_duration_ms?: number },
): MarketDataDemand {
  assertForwardObservationProgram(program)
  const issuedAt = minuteFloor(utc(input.issued_at, "issued_at"))
  if (Date.parse(issuedAt) < Date.parse(program.created_at)) {
    throw new Error("Forward market-data demand cannot predate its program")
  }
  const leaseDuration = boundedInteger(
    input.lease_duration_ms ?? 86_400_000,
    60_000,
    30 * 86_400_000,
    "lease_duration_ms",
  )
  return buildMarketDataDemand({
    demand_id: program.market_data_demand_id,
    consumer_owner: "research-forward-evidence",
    consumer_kind: "research",
    subject_ref: `rd-forward-program:${program.program_id}`,
    venue: "binance_usdm",
    symbol: program.symbol,
    priority: "research",
    requirements: [{
      product: "ohlcv",
      timeframe: program.timeframe,
      indicator_set_ref: null,
      coverage_start: program.first_observation_open_time,
      coverage_end: null,
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

export function assertForwardObservationMarketDataDemand(
  program: ForwardObservationProgram,
  value: unknown,
): MarketDataDemand {
  assertForwardObservationProgram(program)
  const demand = compileMarketDataDemand(value)
  const expected = buildForwardObservationMarketDataDemand(program, {
    issued_at: demand.lease.issued_at,
    lease_duration_ms:
      Date.parse(demand.lease.expires_at)
      - Date.parse(demand.lease.issued_at),
  })
  if (canonicalJson(demand) !== canonicalJson(expected)) {
    throw new Error("Forward market-data demand drifted from its program")
  }
  return demand
}

function firstStrictlyPostFreezeOpen(
  frozenAt: number,
  timeframeMs: number,
): number {
  return (Math.floor(frozenAt / timeframeMs) + 1) * timeframeMs
}

function minuteFloor(value: string): string {
  return new Date(
    Math.floor(Date.parse(value) / 60_000) * 60_000,
  ).toISOString()
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

function symbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) {
    throw new Error("symbol is invalid")
  }
  return value
}

function timeframeValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("timeframe is invalid")
  timeframeMilliseconds(value)
  return value
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)
      || Number(value) < minimum
      || Number(value) > maximum) {
    throw new Error(`${field} is outside its allowed range`)
  }
  return Number(value)
}
