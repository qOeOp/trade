import {
  REPLAY_MAINTENANCE_BREACH_SCHEMA_VERSION,
  compareReplayEventKeys,
  type ReplayExecutionRequest,
  type ReplayDatasetManifest,
  type ReplayFundingEvent,
  type ReplayInstrumentAccountingSpec,
  type ReplayLedgerEntry,
  type ReplayMarginSnapshot,
  type ReplayMaintenanceBreachObservation,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplayPositionProjection,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import { quantizeReplayDifferenceProduct } from "../../../contracts/src/lib/replay-decimal"
import { buildReplayMarginSnapshot } from "../../../accounting/src/lib/replay-margin"
import { resolveReplayVenueRiskPolicyAt } from "../../../data-adapter/src/lib/replay-data-adapter"

export class ReplayMarginTerminalError extends Error {
  readonly maintenance_breach: ReplayMaintenanceBreachObservation | undefined

  constructor(
    readonly code: "initial-margin-deficit-without-resize" | "maintenance-margin-breach-without-liquidation",
    readonly terminal_snapshot: ReplayMarginSnapshot,
  ) {
    super(code === "initial-margin-deficit-without-resize"
      ? `post-entry initial margin exceeds frozen collateral at ${terminal_snapshot.timestamp}; Replay does not resize the Trial order`
      : `maintenance margin was breached at ${terminal_snapshot.timestamp}; no liquidation model is bound`)
    this.name = "ReplayMarginTerminalError"
    this.maintenance_breach = code === "maintenance-margin-breach-without-liquidation"
      ? buildReplayMaintenanceBreachObservation(terminal_snapshot)
      : undefined
  }
}

export class ReplayLiquidationDeficitError extends Error {
  readonly code = "liquidation-deficit-unsupported" as const
  readonly maintenance_breach: ReplayMaintenanceBreachObservation

  constructor(
    readonly terminal_snapshot: ReplayMarginSnapshot,
    readonly remaining_collateral: number,
  ) {
    super(`simulated full liquidation leaves ${remaining_collateral} collateral at ${terminal_snapshot.timestamp}; deficit, insurance fund, and ADL are unsupported`)
    this.name = "ReplayLiquidationDeficitError"
    this.maintenance_breach = buildReplayMaintenanceBreachObservation(terminal_snapshot, "simulated_full_close")
  }
}

export function buildReplayMaintenanceBreachObservation(
  snapshot: ReplayMarginSnapshot,
  executionStatus: ReplayMaintenanceBreachObservation["execution_status"] = "not_simulated",
): ReplayMaintenanceBreachObservation {
  if (snapshot.maintenance_margin_sufficient
      || !snapshot.maintenance_breach_observed
      || snapshot.state === "flat"
      || snapshot.state === "healthy") {
    throw new Error("Replay maintenance breach observation requires the first breached margin snapshot")
  }
  return {
    schema_version: REPLAY_MAINTENANCE_BREACH_SCHEMA_VERSION,
    observation_id: `${snapshot.snapshot_id}:maintenance-breach`,
    event_key: snapshot.event_key,
    timestamp: snapshot.timestamp,
    margin_snapshot_id: snapshot.snapshot_id,
    venue_risk_policy_snapshot_id: snapshot.venue_risk_policy_snapshot_id,
    venue_risk_policy_snapshot_hash: snapshot.venue_risk_policy_snapshot_hash,
    position_event_id: snapshot.position_event_id,
    mark_source_ref: snapshot.mark_source_ref,
    mark_source: snapshot.mark_source,
    resolution: snapshot.resolution,
    trigger: snapshot.maintenance_trigger,
    trigger_state: snapshot.state,
    margin_balance: snapshot.margin_balance,
    maintenance_margin_requirement: snapshot.maintenance_margin_requirement,
    maintenance_margin_headroom: snapshot.maintenance_margin_headroom,
    terminal_priority: snapshot.breach_terminal_priority,
    execution_status: executionStatus,
    authoritative_result: false,
  }
}

export function assertReplayPostEntryMargin(snapshot: ReplayMarginSnapshot): void {
  if (snapshot.stage !== "post_entry") throw new Error("Replay initial margin admission requires the post-entry snapshot")
  if (!snapshot.maintenance_margin_sufficient) {
    throw new ReplayMarginTerminalError("maintenance-margin-breach-without-liquidation", snapshot)
  }
  if (!snapshot.initial_margin_sufficient) {
    throw new ReplayMarginTerminalError("initial-margin-deficit-without-resize", snapshot)
  }
}

export function buildReplayPathMarginSnapshots(input: {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  accounting_spec: ReplayInstrumentAccountingSpec
  positions: ReplayPositionProjection[]
  source_events: ReplaySourceEvent[]
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  mark_events: ReplayMarkEvent[]
  exact_mark_coverage: boolean
  ledger: ReplayLedgerEntry[]
  first_sequence: number
}): ReplayMarginSnapshot[] {
  const entryPosition = input.positions[0]
  if (!entryPosition || entryPosition.state !== "open") throw new Error("Replay margin path requires an open entry Position")
  const snapshots: ReplayMarginSnapshot[] = []
  for (const source of input.source_events) {
    if (source.kind === "instrument_delisted"
        || compareReplayEventKeys(source.event_key, entryPosition.event_key) <= 0) continue
    if (input.exact_mark_coverage && (source.kind === "bar_open" || source.kind === "bar_range")) continue
    const observation = marginObservation(input.request, source, input.bars, input.funding_events, input.mark_events)
    const position = [...input.positions].reverse().find(
      (candidate) => compareReplayEventKeys(candidate.event_key, source.event_key) <= 0,
    )
    if (!position || position.state !== "open") continue
    const riskPolicy = resolveReplayVenueRiskPolicyAt(input.dataset_manifest, source.event_key.event_time)
    const snapshot = buildReplayMarginSnapshot({
      run_id: input.request.run_id,
      stage: "path",
      snapshot_sequence: input.first_sequence + snapshots.length,
      accounting_spec: input.accounting_spec,
      margin_policy: {
        ...input.request.margin_policy,
        initial_margin_rate: riskPolicy.initial_margin_rate,
        maintenance_tier: structuredClone(riskPolicy.maintenance_tier),
      },
      venue_risk_policy_snapshot: riskPolicy,
      position,
      event_key: source.event_key,
      mark_source_ref: source.source_event_id,
      mark_source: observation.mark_source,
      resolution: observation.resolution,
      mark_price: observation.mark_price,
      unrealized_pnl: unrealizedPnl(position, observation.mark_price, input.accounting_spec.settlement_increment),
      ledger: input.ledger,
    })
    snapshots.push(snapshot)
    if (!snapshot.maintenance_margin_sufficient) {
      throw new ReplayMarginTerminalError("maintenance-margin-breach-without-liquidation", snapshot)
    }
  }
  return snapshots
}

function marginObservation(
  request: ReplayExecutionRequest,
  source: ReplaySourceEvent,
  bars: ReplayMarketBar[],
  fundingEvents: ReplayFundingEvent[],
  markEvents: ReplayMarkEvent[],
): Pick<ReplayMarginSnapshot, "mark_price" | "mark_source" | "resolution"> {
  if (source.kind === "funding") {
    const event = fundingEvents[source.source_index]
    if (!event) throw new Error("Replay margin path funding source is missing")
    return { mark_price: event.mark_price, mark_source: "funding_mark", resolution: "exact" }
  }
  if (source.kind === "mark") {
    const event = markEvents[source.source_index]
    if (!event) throw new Error("Replay margin path mark source is missing")
    return { mark_price: event.mark_price, mark_source: "mark_event", resolution: "exact" }
  }
  const bar = bars[source.source_index]
  if (!bar) throw new Error("Replay margin path bar source is missing")
  if (source.kind === "bar_open") return { mark_price: bar.open, mark_source: "bar_open", resolution: "exact" }
  return {
    mark_price: request.order.side === "long" ? bar.low : bar.high,
    mark_source: "bar_adverse_extreme",
    resolution: "ohlcv_adverse_extreme",
  }
}

function unrealizedPnl(
  position: ReplayPositionProjection,
  markPrice: number,
  settlementIncrement: string,
): number {
  return quantizeReplayDifferenceProduct(
    markPrice,
    position.average_entry_price!,
    Math.abs(position.signed_quantity),
    Math.sign(position.signed_quantity) as -1 | 1,
    settlementIncrement,
    "floor",
  )
}
