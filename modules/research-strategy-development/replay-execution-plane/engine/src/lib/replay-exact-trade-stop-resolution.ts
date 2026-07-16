import {
  REPLAY_EXACT_TRADE_STOP_RESOLUTION_SCHEMA_VERSION,
  assertReplayAggregateTradeCoverageBinding,
  canonicalHash,
  canonicalJson,
  type ReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
} from "../../../contracts/src/lib/replay-contracts"

export interface ReplayExactTradeTriggerReference {
  aggregate_trade_id: number
  trade_time: string
  reference_price: number
}

export interface ReplayExactTradeStopResolution {
  schema_version: typeof REPLAY_EXACT_TRADE_STOP_RESOLUTION_SCHEMA_VERSION
  run_id: string
  position_side: "long" | "short"
  entry_trigger_price: number
  protective_stop_price: number
  target_price: number
  coverage_attestation_hash: string
  events_hash: string
  outcome: "untriggered" | "entry_triggered_position_open" | "entry_triggered_then_protection_triggered"
  entry_trigger: ReplayExactTradeTriggerReference | null
  terminal_trigger: (ReplayExactTradeTriggerReference & { role: "stop" | "target" }) | null
  consumed_through_aggregate_trade_id: number
  resolution_scope: "price-trigger-order-only"
  limitations: [
    "external-archive-completeness-not-verified",
    "insurance-and-adl-trades-not-represented",
    "not-fill-queue-slippage-or-market-impact-evidence",
  ]
  resolution_hash: string
}

export interface ReplayExactTradeStopResolutionInput {
  run_id: string
  position_side: "long" | "short"
  entry_trigger_price: number
  protective_stop_price: number
  target_price: number
  coverage_attestation: ReplayAggregateTradeCoverageAttestation
  events: ReplayAggregateTradeEvent[]
}

export function resolveReplayExactTradeStopPath(
  input: ReplayExactTradeStopResolutionInput,
): ReplayExactTradeStopResolution {
  assertInput(input)
  return buildResolution(input)
}

export function assertReplayExactTradeStopResolution(
  value: ReplayExactTradeStopResolution,
  input: ReplayExactTradeStopResolutionInput,
): void {
  assertInput(input)
  const expected = buildResolution(input)
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("exact-trade Stop resolution does not match its ordered event evidence")
  }
}

function assertInput(input: ReplayExactTradeStopResolutionInput): void {
  if (input.run_id.trim() === "") throw new Error("exact-trade Stop resolution requires run_id")
  for (const [field, value] of Object.entries({
    entry_trigger_price: input.entry_trigger_price,
    protective_stop_price: input.protective_stop_price,
    target_price: input.target_price,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`exact-trade Stop ${field} must be positive`)
  }
  if (input.position_side === "long") {
    if (!(input.protective_stop_price < input.entry_trigger_price && input.entry_trigger_price < input.target_price)) {
      throw new Error("long exact-trade Stop prices must satisfy stop < entry trigger < target")
    }
  } else if (input.position_side === "short") {
    if (!(input.target_price < input.entry_trigger_price && input.entry_trigger_price < input.protective_stop_price)) {
      throw new Error("short exact-trade Stop prices must satisfy target < entry trigger < stop")
    }
  } else throw new Error("exact-trade Stop position side is unsupported")
  assertReplayAggregateTradeCoverageBinding(input.coverage_attestation, input.events)
}

function buildResolution(input: ReplayExactTradeStopResolutionInput): ReplayExactTradeStopResolution {
  const entryIndex = input.events.findIndex((event) => input.position_side === "long"
    ? event.price >= input.entry_trigger_price
    : event.price <= input.entry_trigger_price)
  const entryEvent = entryIndex >= 0 ? input.events[entryIndex] : undefined
  let terminalEvent: ReplayAggregateTradeEvent | undefined
  let terminalRole: "stop" | "target" | undefined
  if (entryEvent) {
    for (const event of input.events.slice(entryIndex + 1)) {
      const stopTriggered = input.position_side === "long"
        ? event.price <= input.protective_stop_price
        : event.price >= input.protective_stop_price
      const targetTriggered = input.position_side === "long"
        ? event.price >= input.target_price
        : event.price <= input.target_price
      if (stopTriggered || targetTriggered) {
        terminalEvent = event
        terminalRole = stopTriggered ? "stop" : "target"
        break
      }
    }
  }
  const consumedThrough = terminalEvent ?? input.events.at(-1)!
  const body: Omit<ReplayExactTradeStopResolution, "resolution_hash"> = {
    schema_version: REPLAY_EXACT_TRADE_STOP_RESOLUTION_SCHEMA_VERSION,
    run_id: input.run_id,
    position_side: input.position_side,
    entry_trigger_price: input.entry_trigger_price,
    protective_stop_price: input.protective_stop_price,
    target_price: input.target_price,
    coverage_attestation_hash: input.coverage_attestation.attestation_hash,
    events_hash: input.coverage_attestation.events_hash,
    outcome: !entryEvent
      ? "untriggered"
      : terminalEvent ? "entry_triggered_then_protection_triggered" : "entry_triggered_position_open",
    entry_trigger: entryEvent ? triggerReference(entryEvent) : null,
    terminal_trigger: terminalEvent && terminalRole
      ? { ...triggerReference(terminalEvent), role: terminalRole }
      : null,
    consumed_through_aggregate_trade_id: consumedThrough.aggregate_trade_id,
    resolution_scope: "price-trigger-order-only",
    limitations: [
      "external-archive-completeness-not-verified",
      "insurance-and-adl-trades-not-represented",
      "not-fill-queue-slippage-or-market-impact-evidence",
    ],
  }
  return { ...body, resolution_hash: canonicalHash(body) }
}

function triggerReference(event: ReplayAggregateTradeEvent): ReplayExactTradeTriggerReference {
  return {
    aggregate_trade_id: event.aggregate_trade_id,
    trade_time: event.trade_time,
    reference_price: event.price,
  }
}
