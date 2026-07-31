import {
  timeframeMilliseconds,
} from "../../apps/contracts/market-data-demand-contract/src/ohlcv-coverage-contract"
import type {
  ForwardObservationCandleSegment,
} from "../../apps/research-strategy-development/research-control-plane/contracts/src/lib/forward-observation-candle-segment"
import type {
  ForwardObservationProgram,
} from "../../apps/research-strategy-development/research-control-plane/contracts/src/lib/forward-observation-program"

export interface ForwardCandleSegmentWindow {
  start_open_time: number
  end_open_time: number
  row_count: number
}

export function nextForwardCandleSegmentWindow(
  program: ForwardObservationProgram,
  latest: ForwardObservationCandleSegment | undefined,
  observedAt: string,
  maxRows: number,
): ForwardCandleSegmentWindow | undefined {
  const observedAtMs = Date.parse(canonicalTime(observedAt))
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1_000_000) {
    throw new Error("maxRows is outside the owner export limit")
  }
  const timeframeMs = timeframeMilliseconds(program.timeframe)
  const start = latest == null
    ? Date.parse(program.first_observation_open_time)
    : Date.parse(latest.window.end_open_time) + timeframeMs
  const latestClosedOpen =
    Math.floor(observedAtMs / timeframeMs) * timeframeMs - timeframeMs
  if (latestClosedOpen < start) return undefined
  const end = Math.min(
    latestClosedOpen,
    start + (maxRows - 1) * timeframeMs,
  )
  return {
    start_open_time: start,
    end_open_time: end,
    row_count: ((end - start) / timeframeMs) + 1,
  }
}

function canonicalTime(value: string): string {
  if (!Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error("observedAt must be canonical UTC")
  }
  return value
}
