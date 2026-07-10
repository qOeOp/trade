import { hashCanonical } from "./replay-core"
import { asRecord, numberOrUndefined, stringField, type JSONRecord } from "./json"

type SetupBehavior = "open_setup" | "observe_setup" | "act_on_setup" | "close_setup" | "review_setup"
type SetupBackend = "rd_artifact" | "shadow_evidence" | "live_plan_event"

interface SetupEvent {
  event_key: string
  chain_id: string
  behavior: SetupBehavior
  backend: SetupBackend
  source: string
  created_at: string
  payload: JSONRecord
}

interface SetupProjection {
  chain_id: string
  status: "open" | "closed"
  side?: "long" | "short"
  entry?: number
  initial_stop?: number
  active_stop?: number
  target?: number
  bars_held: number
  mfe_r: number | null
  mae_r: number | null
  close_r: number | null
  break_even_armed: boolean
  exit_reason?: string
  exit_time?: string
  exit_price?: number
  r?: number
  last_observed_at?: string
  event_count: number
}

interface BuildSetupEventInput {
  chainId: string
  behavior: SetupBehavior
  backend: SetupBackend
  source: string
  createdAt: string
  payload: JSONRecord
}

function buildSetupEvent(input: BuildSetupEventInput): SetupEvent {
  const createdAt = normalizeTime(input.createdAt) || new Date().toISOString()
  const keySeed = {
    chain_id: input.chainId,
    behavior: input.behavior,
    backend: input.backend,
    source: input.source,
    created_at: createdAt,
    payload: input.payload,
  }
  return {
    event_key: hashCanonical(keySeed).slice(0, 32),
    chain_id: input.chainId,
    behavior: input.behavior,
    backend: input.backend,
    source: input.source,
    created_at: createdAt,
    payload: input.payload,
  }
}

function projectSetupEvents(events: SetupEvent[]): SetupProjection {
  const first = events[0]
  const projection: SetupProjection = {
    chain_id: first?.chain_id || "",
    status: "open",
    bars_held: 0,
    mfe_r: null,
    mae_r: null,
    close_r: null,
    break_even_armed: false,
    event_count: events.length,
  }

  for (const event of events) {
    const payload = asRecord(event.payload)
    if (!projection.chain_id) projection.chain_id = event.chain_id
    if (event.behavior === "open_setup") {
      projection.status = "open"
      projection.side = parseSide(payload.side) || projection.side
      projection.entry = numberOrUndefined(payload.entry) ?? projection.entry
      projection.initial_stop = numberOrUndefined(payload.initial_stop) ?? numberOrUndefined(payload.stop) ?? projection.initial_stop
      projection.active_stop = numberOrUndefined(payload.active_stop) ?? numberOrUndefined(payload.stop) ?? projection.active_stop
      projection.target = numberOrUndefined(payload.target) ?? projection.target
      continue
    }
    if (event.behavior === "observe_setup") {
      projection.bars_held = numberOrUndefined(payload.bars_held) ?? projection.bars_held
      projection.active_stop = numberOrUndefined(payload.active_stop) ?? projection.active_stop
      projection.target = numberOrUndefined(payload.target) ?? projection.target
      projection.mfe_r = maxNullable(projection.mfe_r, numberOrUndefined(payload.mfe_r))
      projection.mae_r = minNullable(projection.mae_r, numberOrUndefined(payload.mae_r))
      projection.close_r = numberOrUndefined(payload.close_r) ?? projection.close_r
      projection.break_even_armed = projection.break_even_armed || payload.break_even_armed === true
      projection.last_observed_at = stringField(payload.bar_closed_at) || stringField(payload.observed_at) || event.created_at
      continue
    }
    if (event.behavior === "close_setup") {
      projection.status = "closed"
      projection.exit_reason = stringField(payload.exit_reason)
      projection.exit_time = stringField(payload.exit_time)
      projection.exit_price = numberOrUndefined(payload.exit_price)
      projection.r = numberOrUndefined(payload.r)
      projection.bars_held = numberOrUndefined(payload.bars_held) ?? projection.bars_held
    }
  }
  projection.mfe_r = roundNullable(projection.mfe_r)
  projection.mae_r = roundNullable(projection.mae_r)
  projection.close_r = roundNullable(projection.close_r)
  projection.r = projection.r === undefined ? undefined : round(projection.r)
  return projection
}

function parseSide(value: unknown): "long" | "short" | undefined {
  const side = stringField(value)
  return side === "long" || side === "short" ? side : undefined
}

function maxNullable(current: number | null, next: number | undefined): number | null {
  if (next === undefined) return current
  return current === null ? next : Math.max(current, next)
}

function minNullable(current: number | null, next: number | undefined): number | null {
  if (next === undefined) return current
  return current === null ? next : Math.min(current, next)
}

function normalizeTime(value: unknown): string {
  const parsed = Date.parse(stringField(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""
}

function roundNullable(value: number | null): number | null {
  return value === null ? null : round(value)
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

export {
  buildSetupEvent,
  projectSetupEvents,
  type SetupBackend,
  type SetupBehavior,
  type SetupEvent,
  type SetupProjection,
}
