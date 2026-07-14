import {
  assertReplayDatasetManifest,
  assertReplayMarketBars,
  replayDatasetHash,
  replayDatasetManifestHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayLimitation,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"

export interface PreparedReplayInputData {
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  entry_index: number
  dataset_manifest_hash: string
  limitations: ReplayLimitation[]
}

export function prepareReplayInputData(input: {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
}): PreparedReplayInputData {
  const { request, dataset_manifest: manifest } = input
  assertReplayDatasetManifest(manifest)
  assertReplayMarketBars(input.bars)
  if (input.bars.length === 0) throw new Error("Replay requires at least one closed bar")
  const executableTime = Date.parse(request.order.earliest_executable_time)
  if (!Number.isFinite(executableTime)) throw new Error("earliest executable time must be an ISO timestamp")
  const fundingEvents = validateReplayFundingEvents(input.funding_events || [])
  validateManifestBinding(request, manifest, input.bars, fundingEvents)
  const entryIndex = input.bars.findIndex((bar) => Date.parse(bar.open_time) >= executableTime)
  if (entryIndex < 0) throw new Error("dataset contains no bar at or after earliest executable time")
  return {
    bars: input.bars,
    funding_events: fundingEvents,
    entry_index: entryIndex,
    dataset_manifest_hash: replayDatasetManifestHash(manifest),
    limitations: detectDatasetLimitations(manifest, input.bars),
  }
}

function validateManifestBinding(
  request: ReplayExecutionRequest,
  manifest: ReplayDatasetManifest,
  bars: ReplayMarketBar[],
  fundingEvents: ReplayFundingEvent[],
): void {
  if (manifest.manifest_ref !== request.dataset_manifest_ref) throw new Error("dataset manifest ref does not match Replay request")
  if (manifest.data_hash !== request.dataset_hash) throw new Error("dataset manifest hash binding does not match Replay request")
  const actualDataHash = replayDatasetHash(bars, fundingEvents)
  if (actualDataHash !== manifest.data_hash) throw new Error("Replay dataset content hash mismatch")
  if (manifest.symbol !== request.symbol || manifest.timeframe !== request.timeframe) throw new Error("dataset symbol/timeframe does not match Replay request")
  if (manifest.row_count !== bars.length) throw new Error("dataset row_count does not match supplied bars")
  const first = bars[0]
  const last = bars.at(-1)
  if (!first || !last) throw new Error("Replay requires a non-empty dataset")
  if (manifest.first_open_time !== first.open_time || manifest.last_close_time !== last.close_time) {
    throw new Error("dataset manifest window does not match supplied bars")
  }
  const observedThrough = Date.parse(manifest.observed_through)
  if (fundingEvents.some((event) => Date.parse(event.timestamp) > observedThrough)) {
    throw new Error("funding event is not available by manifest observed_through")
  }
  const firstOpen = Date.parse(manifest.first_open_time)
  const lastClose = Date.parse(manifest.last_close_time)
  if (fundingEvents.some((event) => Date.parse(event.timestamp) < firstOpen || Date.parse(event.timestamp) > lastClose)) {
    throw new Error("funding event falls outside the dataset manifest window")
  }
  validateInstrumentWindow(request, manifest, bars)
  validateBarGrid(manifest, bars)
}

function validateInstrumentWindow(
  request: ReplayExecutionRequest,
  manifest: ReplayDatasetManifest,
  bars: ReplayMarketBar[],
): void {
  const tradingEnabled = Date.parse(manifest.instrument.trading_enabled_at)
  const delisted = manifest.instrument.delisted_at === null ? Number.POSITIVE_INFINITY : Date.parse(manifest.instrument.delisted_at)
  const signal = Date.parse(request.order.signal_time)
  const executable = Date.parse(request.order.earliest_executable_time)
  if (signal < tradingEnabled || signal >= delisted || executable < tradingEnabled || executable >= delisted) {
    throw new Error("Replay signal or execution window falls outside instrument trading lifecycle")
  }
  if (bars.some((bar) => Date.parse(bar.open_time) < tradingEnabled || Date.parse(bar.close_time) > delisted)) {
    throw new Error("dataset contains pre-listing or post-delisting bars")
  }
}

function validateBarGrid(manifest: ReplayDatasetManifest, bars: ReplayMarketBar[]): void {
  const origin = Date.parse(bars[0].open_time)
  for (const [index, bar] of bars.entries()) {
    const open = Date.parse(bar.open_time)
    const close = Date.parse(bar.close_time)
    if (close - open !== manifest.interval_ms) throw new Error(`bar ${index} duration does not match manifest interval_ms`)
    if ((open - origin) % manifest.interval_ms !== 0) throw new Error(`bar ${index} is not aligned to the manifest time grid`)
  }
}

function detectDatasetLimitations(manifest: ReplayDatasetManifest, bars: ReplayMarketBar[]): ReplayLimitation[] {
  const limitations: ReplayLimitation[] = []
  let missingBars = 0
  for (let index = 1; index < bars.length; index += 1) {
    const previousOpen = Date.parse(bars[index - 1].open_time)
    const currentOpen = Date.parse(bars[index].open_time)
    missingBars += Math.max(0, currentOpen - previousOpen) / manifest.interval_ms - 1
  }
  if (missingBars > 0) limitations.push({
    code: "dataset-grid-gap",
    severity: "resolution_limited",
    detail: `Dataset is missing ${missingBars} expected bar(s); elapsed time is preserved and the next observed open uses gap-fill semantics.`,
  })
  if (manifest.instrument.status_history === "current_snapshot_only") limitations.push({
    code: "instrument-history-incomplete",
    severity: "resolution_limited",
    detail: "Instrument lifecycle is based on a current snapshot rather than complete point-in-time status history.",
  })
  if (manifest.universe.survivorship === "survivor_only") limitations.push({
    code: "survivor-only-universe",
    severity: "resolution_limited",
    detail: "Dataset universe excludes unavailable inactive/delisted history and cannot support survivorship-robust conclusions.",
  })
  return limitations
}

export function validateReplayFundingEvents(events: ReplayFundingEvent[]): ReplayFundingEvent[] {
  let prior = Number.NEGATIVE_INFINITY
  return [...events].map((event) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.timestamp)) {
      throw new Error("funding events must use RFC 3339 UTC timestamps")
    }
    const timestamp = Date.parse(event.timestamp)
    if (!Number.isFinite(timestamp) || timestamp < prior) throw new Error("funding events must be ordered ISO timestamps")
    if (!Number.isFinite(event.rate)) throw new Error("funding rate must be finite")
    if (!Number.isFinite(event.mark_price) || event.mark_price <= 0) throw new Error("funding mark_price must be positive")
    prior = timestamp
    return event
  })
}

export function fundingEventsInWindow(
  events: ReplayFundingEvent[],
  startInclusive: string,
  endInclusive: string,
): ReplayFundingEvent[] {
  const start = Date.parse(startInclusive)
  const end = Date.parse(endInclusive)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error("invalid funding evidence window")
  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp)
    return timestamp >= start && timestamp <= end
  })
}
