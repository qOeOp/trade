import type {
  ReplayEventKey,
  ReplayExecutionRequest,
  ReplayFundingEvent,
  ReplayLimitation,
  ReplayMarketBar,
  ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import { compareReplayEventKeys } from "./replay-event-key"
import { buildReplaySourceEvents } from "./replay-source-events"

export type ReplayReducedExit =
  | { role: "stop" | "target"; timestamp: string; rawPrice: number; triggerSource: "bar_open" | "bar_range"; sourceSequence: number }
  | { role: "end_of_data"; timestamp: string; rawPrice: number; triggerSource: null; sourceSequence: number }

export interface ReplaySourceReduction<TEntry, TTerminal> {
  exit: ReplayReducedExit
  source_events: ReplaySourceEvent[]
  applied_funding_sources: ReplaySourceEvent[]
  entry_transition: TEntry
  terminal_transition: TTerminal
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
  entry_index: number
  delisted_at: string | null
  limitations: ReplayLimitation[]
  activate_entry: (source: ReplaySourceEvent) => TEntry
  get_entry_fill_event_key: (entry: TEntry) => ReplayEventKey
  complete_exit: (exit: ReplayReducedExit, entry: TEntry) => TTerminal
}): ReplaySourceReduction<TEntry, TTerminal> {
  const entryBar = input.bars[input.entry_index]
  const lastBar = input.bars.at(-1)
  if (!entryBar || !lastBar) throw new Error("Replay source reducer requires entry and terminal bars")
  const sourceEvents = buildReplaySourceEvents({
    bars: input.bars,
    funding_events: input.funding_events,
    delisted_at: input.delisted_at,
    start_time: entryBar.open_time,
    end_time: lastBar.close_time,
  })
  const consumed: ReplaySourceEvent[] = []
  const appliedFunding: ReplaySourceEvent[] = []
  let entryTransition: TEntry | undefined

  for (const source of sourceEvents) {
    consumed.push(source)
    if (source.kind === "instrument_delisted") throw new ReplayInstrumentTerminalError(source)
    if (source.kind === "funding") {
      if (entryTransition !== undefined
          && compareReplayEventKeys(source.event_key, input.get_entry_fill_event_key(entryTransition)) > 0) appliedFunding.push(source)
      continue
    }
    if (source.source_index < input.entry_index) continue
    if (source.kind === "bar_open" && source.source_index === input.entry_index && entryTransition === undefined) {
      entryTransition = input.activate_entry(source)
    }
    if (entryTransition === undefined) throw new Error("Replay entry bar_open must be consumed before in-position market events")
    const bar = input.bars[source.source_index]
    if (!bar) throw new Error("Replay source event references a missing bar")
    const isLong = input.request.order.side === "long"

    if (source.kind === "bar_open") {
      const stopGap = isLong ? bar.open <= input.request.order.stop_price : bar.open >= input.request.order.stop_price
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
      continue
    }

    const stopTouched = isLong ? bar.low <= input.request.order.stop_price : bar.high >= input.request.order.stop_price
    const targetTouched = isLong ? bar.high >= input.request.order.target_price : bar.low <= input.request.order.target_price
    if (stopTouched && targetTouched) {
      input.limitations.push({
        code: "ohlcv-stop-target-collision",
        severity: "resolution_limited",
        detail: "OHLCV cannot prove intrabar path; certified conservative policy resolves stop before target.",
      })
      return reduction(
        { role: "stop", timestamp: bar.close_time, rawPrice: input.request.order.stop_price, triggerSource: "bar_range", sourceSequence: source.source_index + 1 },
        consumed,
        appliedFunding,
        entryTransition,
        input.complete_exit,
      )
    }
    if (stopTouched) return reduction(
      { role: "stop", timestamp: bar.close_time, rawPrice: input.request.order.stop_price, triggerSource: "bar_range", sourceSequence: source.source_index + 1 },
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
  }

  input.limitations.push({
    code: "end-of-data-forced-close",
    severity: "info",
    detail: "Open evidence position was marked closed at the final closed bar for finite Result accounting.",
  })
  if (entryTransition === undefined) throw new Error("Replay source reducer reached end-of-data before entry activation")
  return reduction(
    { role: "end_of_data", timestamp: lastBar.close_time, rawPrice: lastBar.close, triggerSource: null, sourceSequence: input.bars.length },
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
