import {
  canonicalHash,
  type ReplayEventKey,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayLimitation,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import { compareReplayEventKeys } from "./replay-event-key"
import { buildReplaySourceEvents } from "./replay-source-events"

export type ReplayReducedExit =
  | { role: "stop" | "target"; timestamp: string; rawPrice: number; triggerSource: "bar_open" | "bar_range"; sourceSequence: number }
  | { role: "strategy_exit"; timestamp: string; rawPrice: number; triggerSource: "bar_open"; sourceSequence: number }
  | { role: "liquidation"; timestamp: string; rawPrice: number; triggerSource: "mark" | "funding_mark"; triggerSourceRef: string; sourceSequence: number }
  | { role: "end_of_data"; timestamp: string; rawPrice: number; triggerSource: null; sourceSequence: number }

export interface ReplaySourceReduction<TEntry, TTerminal> {
  exit: ReplayReducedExit
  source_events: ReplaySourceEvent[]
  applied_funding_sources: ReplaySourceEvent[]
  entry_transition: TEntry
  terminal_transition: TTerminal
}

export interface ReplaySourceBoundary<TEntry> {
  next_source_offset: number
  source_events: ReplaySourceEvent[]
  applied_funding_sources: ReplaySourceEvent[]
  entry_transition: TEntry | null
}

export class ReplayInstrumentTerminalError extends Error {
  readonly code = "instrument-delisted-with-open-position" as const

  constructor(readonly terminal_event: ReplaySourceEvent) {
    super(`instrument was delisted with an open evidence position at ${terminal_event.event_key.event_time}; no settlement price is bound`)
    this.name = "ReplayInstrumentTerminalError"
  }
}

export function reduceReplaySourceEvents<TEntry extends object, TTerminal>(input: {
  request: ReplayExecutionRequest
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  mark_events: ReplayMarkEvent[]
  exact_mark_coverage: boolean
  entry_index: number
  delisted_at: string | null
  limitations: ReplayLimitation[]
  resume?: ReplaySourceBoundary<TEntry>
  on_source_boundary?: (boundary: ReplaySourceBoundary<TEntry>) => void
  activate_entry: (source: ReplaySourceEvent) => TEntry
  get_entry_fill_event_key: (entry: TEntry) => ReplayEventKey
  get_active_stop_price: (entry: TEntry) => number
  observe_exact_risk: (
    source: ReplaySourceEvent,
    entry: TEntry,
    appliedFundingSources: ReplaySourceEvent[],
  ) => ReplayReducedExit | null
  observe_strategy_exit: (source: ReplaySourceEvent, entry: TEntry) => ReplayReducedExit | null
  complete_exit: (exit: ReplayReducedExit, entry: TEntry) => TTerminal
}): ReplaySourceReduction<TEntry, TTerminal> {
  const entryBar = input.bars[input.entry_index]
  const lastBar = input.bars.at(-1)
  if (!entryBar || !lastBar) throw new Error("Replay source reducer requires entry and terminal bars")
  const sourceEvents = buildReplaySourceEvents({
    bars: input.bars,
    funding_events: input.funding_events,
    mark_events: input.mark_events,
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

  const checkpoint = (nextSourceOffset: number): void => input.on_source_boundary?.({
    next_source_offset: nextSourceOffset,
    source_events: [...consumed],
    applied_funding_sources: [...appliedFunding],
    entry_transition: entryTransition ?? null,
  })

  for (let sourceOffset = resumeOffset; sourceOffset < sourceEvents.length; sourceOffset += 1) {
    const source = sourceEvents[sourceOffset]
    consumed.push(source)
    if (source.kind === "instrument_delisted") throw new ReplayInstrumentTerminalError(source)
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
      entryTransition = input.activate_entry(source)
    }
    if (entryTransition === undefined) throw new Error("Replay entry bar_open must be consumed before in-position market events")
    const bar = input.bars[source.source_index]
    if (!bar) throw new Error("Replay source event references a missing bar")
    const isLong = input.request.order.side === "long"
    const activeStopPrice = input.get_active_stop_price(entryTransition)

    if (source.kind === "bar_open") {
      const stopGap = isLong ? bar.open <= activeStopPrice : bar.open >= activeStopPrice
      if (stopGap) return reduction(
        { role: "stop", timestamp: bar.open_time, rawPrice: bar.open, triggerSource: "bar_open", sourceSequence: source.source_index + 1 },
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
      const targetGap = isLong ? bar.open >= input.request.order.target_price : bar.open <= input.request.order.target_price
      if (targetGap) return reduction(
        { role: "target", timestamp: bar.open_time, rawPrice: bar.open, triggerSource: "bar_open", sourceSequence: source.source_index + 1 },
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
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
    const targetTouched = isLong ? bar.high >= input.request.order.target_price : bar.low <= input.request.order.target_price
    if (stopTouched && targetTouched) {
      input.limitations.push({
        code: "ohlcv-stop-target-collision",
        severity: "resolution_limited",
        detail: "OHLCV cannot prove intrabar path; certified conservative policy resolves stop before target.",
      })
      return reduction(
        { role: "stop", timestamp: bar.close_time, rawPrice: activeStopPrice, triggerSource: "bar_range", sourceSequence: source.source_index + 1 },
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
    }
    if (stopTouched) return reduction(
      { role: "stop", timestamp: bar.close_time, rawPrice: activeStopPrice, triggerSource: "bar_range", sourceSequence: source.source_index + 1 },
      consumed,
      appliedFunding,
      entryTransition,
      input.complete_exit,
    )
    if (targetTouched) return reduction(
      { role: "target", timestamp: bar.close_time, rawPrice: input.request.order.target_price, triggerSource: "bar_range", sourceSequence: source.source_index + 1 },
      consumed,
      appliedFunding,
      entryTransition,
      input.complete_exit,
    )
    checkpoint(sourceOffset + 1)
  }

  input.limitations.push({
    code: "end-of-data-open-position-marked",
    severity: "info",
    detail: input.exact_mark_coverage
      ? "Open evidence position remains open and is valued at the final exact mark event; no synthetic exit Fill is created."
      : "Open evidence position remains open and is valued at the final closed bar close; no synthetic exit Fill is created.",
  })
  if (entryTransition === undefined) throw new Error("Replay source reducer reached end-of-data before entry activation")
  const finalMark = input.exact_mark_coverage ? input.mark_events.at(-1) : undefined
  return reduction(
    {
      role: "end_of_data",
      timestamp: finalMark?.timestamp ?? lastBar.close_time,
      rawPrice: finalMark?.mark_price ?? lastBar.close,
      triggerSource: null,
      sourceSequence: finalMark?.source_sequence ?? input.bars.length,
    },
    consumed,
    appliedFunding,
    entryTransition,
    input.complete_exit,
  )
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
