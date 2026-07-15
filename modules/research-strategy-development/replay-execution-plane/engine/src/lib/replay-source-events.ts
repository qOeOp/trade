import type {
  ReplayFundingEvent,
  ReplayInstrumentStatusSnapshot,
  ReplayMarkEvent,
  ReplayMarketBar,
  ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import { compareReplayEventKeys, createReplayEventKey } from "./replay-event-key"

export function buildReplaySourceEvents(input: {
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  mark_events: ReplayMarkEvent[]
  instrument_status_epochs?: ReplayInstrumentStatusSnapshot[]
  delisted_at?: string | null
  start_time: string
  end_time: string
}): ReplaySourceEvent[] {
  const start = Date.parse(input.start_time)
  const end = Date.parse(input.end_time)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error("invalid Replay source-event window")
  const events: ReplaySourceEvent[] = []
  const inWindow = (timestamp: string): boolean => {
    const value = Date.parse(timestamp)
    return value >= start && value <= end
  }
  if (input.delisted_at && inWindow(input.delisted_at)) events.push(instrumentDelistedSourceEvent(input.delisted_at))
  for (const [index, status] of (input.instrument_status_epochs ?? []).entries()) {
    if (index === 0 || !inWindow(status.effective_at)) continue
    events.push(instrumentStatusSourceEvent(status, index))
  }
  for (const [index, bar] of input.bars.entries()) {
    const sourceSequence = index + 1
    if (inWindow(bar.open_time)) events.push(sourceEvent("bar_open", index, bar.open_time, 20, sourceSequence))
    if (inWindow(bar.close_time)) events.push(sourceEvent("bar_range", index, bar.close_time, 20, sourceSequence))
  }
  for (const [index, event] of input.funding_events.entries()) {
    if (inWindow(event.timestamp)) events.push(sourceEvent("funding", index, event.timestamp, 10, index + 1))
  }
  for (const [index, event] of input.mark_events.entries()) {
    if (inWindow(event.timestamp)) events.push(sourceEvent("mark", index, event.timestamp, 15, event.source_sequence))
  }
  events.sort((left, right) => compareReplayEventKeys(left.event_key, right.event_key))
  for (let index = 1; index < events.length; index += 1) {
    if (compareReplayEventKeys(events[index - 1].event_key, events[index].event_key) >= 0) {
      throw new Error("Replay source events must have unique increasing EventKeys")
    }
  }
  return events
}

function sourceEvent(
  kind: "bar_open" | "bar_range" | "funding" | "mark",
  sourceIndex: number,
  eventTime: string,
  boundaryPhase: 10 | 15 | 20,
  sourceSequence: number,
): ReplaySourceEvent {
  const sourceEventId = `source:${kind}:${sourceSequence}:${eventTime}`
  return {
    source_event_id: sourceEventId,
    kind,
    source_index: sourceIndex,
    event_key: createReplayEventKey({
      event_time: eventTime,
      boundary_phase: boundaryPhase,
      source_sequence: sourceSequence,
      event_subphase: 0,
      stable_event_id: sourceEventId,
    }),
  }
}

export function instrumentStatusSourceEvent(
  status: ReplayInstrumentStatusSnapshot,
  sourceIndex: number,
): ReplaySourceEvent {
  const kind = status.status === "halted" ? "instrument_halted" : "instrument_resumed"
  const sourceEventId = `source:${kind}:${sourceIndex}:${status.effective_at}`
  return {
    source_event_id: sourceEventId,
    kind,
    source_index: sourceIndex,
    instrument_status_snapshot_id: status.snapshot_id,
    event_key: createReplayEventKey({
      event_time: status.effective_at,
      boundary_phase: 0,
      source_sequence: sourceIndex + 1,
      event_subphase: 0,
      stable_event_id: sourceEventId,
    }),
  }
}

export function instrumentDelistedSourceEvent(eventTime: string): ReplaySourceEvent {
  const sourceEventId = `source:instrument_delisted:0:${eventTime}`
  return {
    source_event_id: sourceEventId,
    kind: "instrument_delisted",
    source_index: 0,
    event_key: createReplayEventKey({
      event_time: eventTime,
      boundary_phase: 0,
      source_sequence: 0,
      event_subphase: 0,
      stable_event_id: sourceEventId,
    }),
  }
}
