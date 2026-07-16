import {
  canonicalHash,
  type ReplayEventKey,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayLimitation,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplayOhlcvResolutionEvidence,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import { compareReplayEventKeys } from "./replay-event-key"
import { createReplaySimpleBracketOhlcvResolution, type ReplayOhlcvResolutionEconomics } from "./replay-ohlcv-resolution"
import { buildReplaySourceEvents } from "./replay-source-events"
import { isReplayExplicitHaltInterval, ReplayDataContinuityError } from "../../../data-adapter/src/lib/replay-data-adapter"

export type ReplayReducedExit =
  | { role: "stop" | "target"; timestamp: string; rawPrice: number; triggerSource: "bar_open" | "bar_range"; sourceSequence: number; resolution_evidence: ReplayOhlcvResolutionEvidence }
  | { role: "strategy_exit"; timestamp: string; rawPrice: number; triggerSource: "bar_open"; sourceSequence: number }
  | { role: "liquidation"; timestamp: string; rawPrice: number; triggerSource: "mark" | "funding_mark"; triggerSourceRef: string; sourceSequence: number }
  | { role: "end_of_data"; timestamp: string; rawPrice: number; triggerSource: null; sourceSequence: number }

export interface ReplaySourceReduction<TEntry, TTerminal> {
  exit: ReplayReducedExit
  source_events: ReplaySourceEvent[]
  applied_funding_sources: ReplaySourceEvent[]
  entry_transition: TEntry | null
  terminal_transition: TTerminal | null
}

export interface ReplaySourceBoundary<TEntry> {
  next_source_offset: number
  source_events: ReplaySourceEvent[]
  applied_funding_sources: ReplaySourceEvent[]
  entry_transition: TEntry | null
}

export interface ReplayActiveProtection {
  protection_generation: number
  remaining_quantity: number
  stop_order_id: string
  stop_trigger_price: number
  target_order_id: string
  target_trigger_price: number
}

export class ReplayInstrumentTerminalError extends Error {
  readonly code = "instrument-delisted-with-open-position" as const

  constructor(readonly terminal_event: ReplaySourceEvent) {
    super(`instrument was delisted with an open evidence position at ${terminal_event.event_key.event_time}; no settlement price is bound`)
    this.name = "ReplayInstrumentTerminalError"
  }
}

export class ReplayPendingEntryDelistedError extends Error {
  readonly code = "instrument-delisted-with-pending-entry" as const

  constructor(readonly terminal_event: ReplaySourceEvent) {
    super(`instrument was delisted while the Limit entry was still pending at ${terminal_event.event_key.event_time}`)
    this.name = "ReplayPendingEntryDelistedError"
  }
}

export function reduceReplaySourceEvents<TEntry extends object, TTerminal>(input: {
  request: ReplayExecutionRequest
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  mark_events: ReplayMarkEvent[]
  instrument_status_epochs: ReplayInstrumentStatusSnapshot[]
  exact_mark_coverage: boolean
  entry_index: number
  delisted_at: string | null
  limitations: ReplayLimitation[]
  resolution_economics: ReplayOhlcvResolutionEconomics
  resume?: ReplaySourceBoundary<TEntry>
  on_source_boundary?: (boundary: ReplaySourceBoundary<TEntry>) => void
  activate_entry: (source: ReplaySourceEvent) => TEntry | null
  observe_pending_entry: (source: ReplaySourceEvent) => TEntry | null
  get_entry_fill_event_key: (entry: TEntry) => ReplayEventKey
  get_active_protection: (entry: TEntry) => ReplayActiveProtection
  observe_exact_risk: (
    source: ReplaySourceEvent,
    entry: TEntry,
    appliedFundingSources: ReplaySourceEvent[],
  ) => ReplayReducedExit | null
  observe_strategy_exit: (source: ReplaySourceEvent, entry: TEntry) => ReplayReducedExit | null
  apply_partial_reduce: (source: ReplaySourceEvent, entry: TEntry) => void
  complete_exit: (exit: ReplayReducedExit, entry: TEntry) => TTerminal
}): ReplaySourceReduction<TEntry, TTerminal> {
  const entryBar = input.bars[input.entry_index]
  const lastBar = input.bars.at(-1)
  if (!entryBar || !lastBar) throw new Error("Replay source reducer requires entry and terminal bars")
  const sourceEvents = buildReplaySourceEvents({
    bars: input.bars,
    funding_events: input.funding_events,
    mark_events: input.mark_events,
    instrument_status_epochs: input.instrument_status_epochs,
    delisted_at: input.delisted_at,
    start_time: entryBar.open_time,
    end_time: lastBar.close_time,
  })
  const resumeOffset = input.resume?.next_source_offset ?? 0
  if (!Number.isSafeInteger(resumeOffset) || resumeOffset < 0 || resumeOffset > sourceEvents.length) {
    throw new Error("Replay resume source offset is outside the deterministic source stream")
  }
  const expectedPrefix = sourceEvents.slice(0, resumeOffset)
  if (input.resume && canonicalHash(input.resume.source_events) !== canonicalHash(expectedPrefix)) {
    throw new Error("Replay resume source prefix does not match the deterministic source stream")
  }
  const consumed: ReplaySourceEvent[] = [...(input.resume?.source_events ?? [])]
  const appliedFunding: ReplaySourceEvent[] = [...(input.resume?.applied_funding_sources ?? [])]
  let entryTransition: TEntry | undefined = input.resume?.entry_transition ?? undefined
  let instrumentTrading = true
  for (const source of consumed) {
    if (source.kind === "instrument_halted") instrumentTrading = false
    if (source.kind === "instrument_resumed") instrumentTrading = true
  }

  const checkpoint = (nextSourceOffset: number): void => input.on_source_boundary?.({
    next_source_offset: nextSourceOffset,
    source_events: [...consumed],
    applied_funding_sources: [...appliedFunding],
    entry_transition: entryTransition ?? null,
  })

  for (let sourceOffset = resumeOffset; sourceOffset < sourceEvents.length; sourceOffset += 1) {
    const source = sourceEvents[sourceOffset]
    consumed.push(source)
    if (source.kind === "instrument_delisted") {
      if (entryTransition === undefined && input.request.order.entry_execution.order_type === "limit") {
        throw new ReplayPendingEntryDelistedError(source)
      }
      throw new ReplayInstrumentTerminalError(source)
    }
    if (source.kind === "instrument_halted" || source.kind === "instrument_resumed") {
      instrumentTrading = source.kind === "instrument_resumed"
      checkpoint(sourceOffset + 1)
      continue
    }
    if (source.kind === "funding") {
      if (entryTransition !== undefined
          && compareReplayEventKeys(source.event_key, input.get_entry_fill_event_key(entryTransition)) > 0) appliedFunding.push(source)
      if (entryTransition !== undefined) {
        const riskExit = input.observe_exact_risk(source, entryTransition, appliedFunding)
        if (riskExit) return reduction(riskExit, consumed, appliedFunding, entryTransition, input.complete_exit)
      }
      checkpoint(sourceOffset + 1)
      continue
    }
    if (source.kind === "mark") {
      if (entryTransition !== undefined) {
        const riskExit = input.observe_exact_risk(source, entryTransition, appliedFunding)
        if (riskExit) return reduction(riskExit, consumed, appliedFunding, entryTransition, input.complete_exit)
      }
      checkpoint(sourceOffset + 1)
      continue
    }
    if (source.source_index < input.entry_index) {
      checkpoint(sourceOffset + 1)
      continue
    }
    if (source.kind === "bar_open" && source.source_index === input.entry_index && entryTransition === undefined) {
      if (!instrumentTrading) throw new Error("Replay cannot activate an entry while instrument trading is halted")
      entryTransition = input.activate_entry(source) ?? undefined
    }
    let pendingEntryCreated = false
    if (entryTransition === undefined && (source.kind === "bar_open" || source.kind === "bar_range")) {
      if (!instrumentTrading) throw new Error("Replay cannot observe a pending entry while instrument trading is halted")
      entryTransition = input.observe_pending_entry(source) ?? undefined
      pendingEntryCreated = entryTransition !== undefined
    }
    const bar = input.bars[source.source_index]
    if (!bar) throw new Error("Replay source event references a missing bar")
    if (entryTransition === undefined) {
      assertNextBarContinuity(input, source, bar)
      checkpoint(sourceOffset + 1)
      continue
    }
    if (pendingEntryCreated) {
      checkpoint(sourceOffset + 1)
      continue
    }
    const isLong = input.request.order.side === "long"
    const activeProtection = input.get_active_protection(entryTransition)
    const activeStopPrice = activeProtection.stop_trigger_price
    const activeTargetPrice = activeProtection.target_trigger_price

    if (source.kind === "bar_open") {
      if (!instrumentTrading) throw new Error("Replay cannot consume a market open while instrument trading is halted")
      const stopGap = isLong ? bar.open <= activeStopPrice : bar.open >= activeStopPrice
      if (stopGap) return reduction(
        {
          role: "stop", timestamp: bar.open_time, rawPrice: bar.open, triggerSource: "bar_open", sourceSequence: source.source_index + 1,
          resolution_evidence: createReplaySimpleBracketOhlcvResolution({
            run_id: input.request.run_id, source_event: source, bar, position_side: input.request.order.side,
            active_protection: activeProtection,
            economics: input.resolution_economics,
            observation_kind: "bar_open_gap", stop_touched: true, target_touched: false,
            canonical_terminal_role: "stop",
          }),
        },
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
      const targetGap = isLong ? bar.open >= activeTargetPrice : bar.open <= activeTargetPrice
      if (targetGap) return reduction(
        {
          role: "target", timestamp: bar.open_time, rawPrice: bar.open, triggerSource: "bar_open", sourceSequence: source.source_index + 1,
          resolution_evidence: createReplaySimpleBracketOhlcvResolution({
            run_id: input.request.run_id, source_event: source, bar, position_side: input.request.order.side,
            active_protection: activeProtection,
            economics: input.resolution_economics,
            observation_kind: "bar_open_gap", stop_touched: false, target_touched: true,
            canonical_terminal_role: "target",
          }),
        },
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
      input.apply_partial_reduce(source, entryTransition)
      const strategyExit = input.observe_strategy_exit(source, entryTransition)
      if (strategyExit) return reduction(
        strategyExit,
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
      checkpoint(sourceOffset + 1)
      continue
    }

    const stopTouched = isLong ? bar.low <= activeStopPrice : bar.high >= activeStopPrice
    const targetTouched = isLong ? bar.high >= activeTargetPrice : bar.low <= activeTargetPrice
    if (stopTouched && targetTouched) {
      input.limitations.push({
        code: "ohlcv-stop-target-collision",
        severity: "resolution_limited",
        detail: "OHLCV cannot prove intrabar path; certified conservative policy resolves stop before target.",
      })
      return reduction(
        {
          role: "stop", timestamp: bar.close_time, rawPrice: activeStopPrice, triggerSource: "bar_range", sourceSequence: source.source_index + 1,
          resolution_evidence: createReplaySimpleBracketOhlcvResolution({
            run_id: input.request.run_id, source_event: source, bar, position_side: input.request.order.side,
            active_protection: activeProtection,
            economics: input.resolution_economics,
            observation_kind: "bar_range_touch", stop_touched: true, target_touched: true,
            canonical_terminal_role: "stop",
          }),
        },
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
    }
    if (stopTouched) return reduction(
      {
        role: "stop", timestamp: bar.close_time, rawPrice: activeStopPrice, triggerSource: "bar_range", sourceSequence: source.source_index + 1,
        resolution_evidence: createReplaySimpleBracketOhlcvResolution({
          run_id: input.request.run_id, source_event: source, bar, position_side: input.request.order.side,
          active_protection: activeProtection,
          economics: input.resolution_economics,
          observation_kind: "bar_range_touch", stop_touched: true, target_touched: false,
          canonical_terminal_role: "stop",
        }),
      },
      consumed,
      appliedFunding,
      entryTransition,
      input.complete_exit,
    )
    if (targetTouched) return reduction(
      {
        role: "target", timestamp: bar.close_time, rawPrice: activeTargetPrice, triggerSource: "bar_range", sourceSequence: source.source_index + 1,
        resolution_evidence: createReplaySimpleBracketOhlcvResolution({
          run_id: input.request.run_id, source_event: source, bar, position_side: input.request.order.side,
          active_protection: activeProtection,
          economics: input.resolution_economics,
          observation_kind: "bar_range_touch", stop_touched: false, target_touched: true,
          canonical_terminal_role: "target",
        }),
      },
      consumed,
      appliedFunding,
      entryTransition,
      input.complete_exit,
    )
    assertNextBarContinuity(input, source, bar)
    checkpoint(sourceOffset + 1)
  }

  const finalMark = input.exact_mark_coverage ? input.mark_events.at(-1) : undefined
  const exit: ReplayReducedExit = {
    role: "end_of_data",
    timestamp: finalMark?.timestamp ?? lastBar.close_time,
    rawPrice: finalMark?.mark_price ?? lastBar.close,
    triggerSource: null,
    sourceSequence: finalMark?.source_sequence ?? input.bars.length,
  }
  if (entryTransition === undefined) {
    return {
      exit,
      source_events: [...consumed],
      applied_funding_sources: [...appliedFunding],
      entry_transition: null,
      terminal_transition: null,
    }
  }
  input.limitations.push({
    code: "end-of-data-open-position-marked",
    severity: "info",
    detail: input.exact_mark_coverage
      ? "Open evidence position remains open and is valued at the final exact mark event; no synthetic exit Fill is created."
      : "Open evidence position remains open and is valued at the final closed bar close; no synthetic exit Fill is created.",
  })
  return reduction(exit, consumed, appliedFunding, entryTransition, input.complete_exit)
}

function assertNextBarContinuity(
  input: { bars: ReplayMarketBar[]; instrument_status_epochs: ReplayInstrumentStatusSnapshot[] },
  source: ReplaySourceEvent,
  bar: ReplayMarketBar,
): void {
  if (source.kind !== "bar_range") return
  const nextBar = input.bars[source.source_index + 1]
  if (!nextBar || Date.parse(nextBar.open_time) === Date.parse(bar.close_time)
      || isReplayExplicitHaltInterval(input.instrument_status_epochs, bar.close_time, nextBar.open_time)) return
  const interval = Date.parse(bar.close_time) - Date.parse(bar.open_time)
  const missingBarCount = (Date.parse(nextBar.open_time) - Date.parse(bar.close_time)) / interval
  if (!Number.isSafeInteger(missingBarCount) || missingBarCount <= 0) {
    throw new Error("Replay reached a non-canonical market-data grid discontinuity")
  }
  throw new ReplayDataContinuityError({
    gap_kind: "open_position_grid_gap",
    gap_start: bar.close_time,
    next_observed_open: nextBar.open_time,
    missing_bar_count: missingBarCount,
    interval_ms: interval,
    policy: "fail_before_unobserved_interval_effects",
  })
}

function reduction<TEntry, TTerminal>(
  exit: ReplayReducedExit,
  sourceEvents: ReplaySourceEvent[],
  appliedFundingSources: ReplaySourceEvent[],
  entryTransition: TEntry,
  completeExit: (exit: ReplayReducedExit, entry: TEntry) => TTerminal,
): ReplaySourceReduction<TEntry, TTerminal> {
  return {
    exit,
    source_events: [...sourceEvents],
    applied_funding_sources: [...appliedFundingSources],
    entry_transition: entryTransition,
    terminal_transition: completeExit(exit, entryTransition),
  }
}
