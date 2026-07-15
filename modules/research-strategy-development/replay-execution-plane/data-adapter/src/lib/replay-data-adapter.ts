import {
  assertReplayDatasetManifest,
  assertReplayMarketBars,
  assertReplaySupplementalFact,
  canonicalHash,
  replayDatasetHash,
  replayDatasetManifestHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayInstrumentSpecSnapshot,
  type ReplayLimitation,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplaySupplementalEvidence,
  type ReplaySupplementalFact,
  type ReplayVenueRiskPolicySnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import { isReplayIncrementAligned } from "../../../contracts/src/lib/replay-decimal"

export interface PreparedReplayInputData {
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  mark_events: ReplayMarkEvent[]
  supplemental_facts: ReplaySupplementalFact[]
  supplemental_evidence: ReplaySupplementalEvidence
  entry_index: number
  dataset_manifest_hash: string
  limitations: ReplayLimitation[]
}

export function prepareReplayInputData(input: {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
  mark_events?: ReplayMarkEvent[]
  supplemental_facts?: ReplaySupplementalFact[]
}): PreparedReplayInputData {
  const { request, dataset_manifest: manifest } = input
  assertReplayDatasetManifest(manifest)
  assertReplayMarketBars(input.bars)
  if (input.bars.length === 0) throw new Error("Replay requires at least one closed bar")
  const executableTime = Date.parse(request.order.earliest_executable_time)
  if (!Number.isFinite(executableTime)) throw new Error("earliest executable time must be an ISO timestamp")
  const fundingEvents = validateReplayFundingEvents(input.funding_events || [])
  const markEvents = validateReplayMarkEvents(input.mark_events || [])
  const supplementalFacts = validateReplaySupplementalFacts(input.supplemental_facts || [])
  const entryIndex = input.bars.findIndex((bar) => Date.parse(bar.open_time) >= executableTime)
  if (entryIndex < 0) throw new Error("dataset contains no bar at or after earliest executable time")
  const supplementalEvidence = validateManifestBinding(
    request, manifest, input.bars, fundingEvents, markEvents, supplementalFacts, input.bars[entryIndex].open_time,
  )
  return {
    bars: input.bars,
    funding_events: fundingEvents,
    mark_events: markEvents,
    supplemental_facts: supplementalFacts,
    supplemental_evidence: supplementalEvidence,
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
  markEvents: ReplayMarkEvent[],
  supplementalFacts: ReplaySupplementalFact[],
  entryTime: string,
): ReplaySupplementalEvidence {
  if (manifest.manifest_ref !== request.dataset_manifest_ref) throw new Error("dataset manifest ref does not match Replay request")
  if (manifest.data_hash !== request.dataset_hash) throw new Error("dataset manifest hash binding does not match Replay request")
  const actualDataHash = replayDatasetHash(bars, fundingEvents, markEvents, supplementalFacts)
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
  validateMarkCoverage(manifest, markEvents, observedThrough, firstOpen, lastClose)
  const supplementalEvidence = validateSupplementalBinding(request, manifest, supplementalFacts, observedThrough)
  validatePointInTimePolicyBindings(request, manifest, firstOpen, lastClose, entryTime, observedThrough)
  validateInstrumentWindow(request, manifest, bars)
  validateBarGrid(manifest, bars)
  return supplementalEvidence
}

function validateSupplementalBinding(
  request: ReplayExecutionRequest,
  manifest: ReplayDatasetManifest,
  facts: ReplaySupplementalFact[],
  observedThrough: number,
): ReplaySupplementalEvidence {
  const declared = manifest.supplemental_facts
  const contentHash = canonicalHash(facts)
  if (declared.record_count !== facts.length) throw new Error("supplemental fact count does not match dataset manifest")
  if (declared.content_hash !== contentHash || request.supplemental_facts_hash !== contentHash) {
    throw new Error("supplemental facts hash does not match Replay request and dataset manifest")
  }
  const sourceIds = [...new Set(facts.map((fact) => fact.source_id))].sort()
  if (canonicalHash(sourceIds) !== canonicalHash(declared.source_ids)) {
    throw new Error("supplemental fact source ids do not match dataset manifest")
  }
  if (facts.some((fact) => Date.parse(fact.received_at) > observedThrough)) {
    throw new Error("supplemental fact was received after manifest observed_through")
  }
  const selected = selectReplaySupplementalFactsAt(facts, request.order.signal_time)
  return {
    visibility_policy: "signal_time_snapshot",
    decision_time: request.order.signal_time,
    supplied_record_count: facts.length,
    selected_record_ids: selected.map((fact) => fact.record_id),
    selected_records_hash: canonicalHash(selected),
    future_revision_count: facts.filter((fact) => Date.parse(fact.availability_at) > Date.parse(request.order.signal_time)).length,
  }
}

export function validateReplaySupplementalFacts(facts: ReplaySupplementalFact[]): ReplaySupplementalFact[] {
  const records = structuredClone(facts)
  const recordIds = new Set<string>()
  const revisionIds = new Set<string>()
  const priorSequenceBySource = new Map<string, number>()
  const priorAvailabilityByGroup = new Map<string, number>()
  let priorCanonicalKey = ""
  for (const fact of records) {
    assertReplaySupplementalFact(fact)
    const canonicalKey = `${fact.source_id}\u0000${String(fact.source_sequence).padStart(16, "0")}`
    if (canonicalKey <= priorCanonicalKey) throw new Error("supplemental facts must be ordered by source_id and source_sequence")
    priorCanonicalKey = canonicalKey
    const priorSequence = priorSequenceBySource.get(fact.source_id)
    if (priorSequence !== undefined && fact.source_sequence <= priorSequence) {
      throw new Error("supplemental fact source_sequence must strictly increase within each source")
    }
    priorSequenceBySource.set(fact.source_id, fact.source_sequence)
    if (recordIds.has(fact.record_id)) throw new Error("supplemental fact record_id must be unique")
    recordIds.add(fact.record_id)
    const group = supplementalFactGroupKey(fact)
    const revisionKey = `${group}\u0000${fact.revision_id}`
    if (revisionIds.has(revisionKey)) throw new Error("supplemental fact revision_id must be unique within one fact history")
    revisionIds.add(revisionKey)
    const availability = Date.parse(fact.availability_at)
    const priorAvailability = priorAvailabilityByGroup.get(group)
    if (priorAvailability !== undefined && availability <= priorAvailability) {
      throw new Error("supplemental fact revisions must have strictly increasing availability_at")
    }
    priorAvailabilityByGroup.set(group, availability)
  }
  return records
}

export function selectReplaySupplementalFactsAt(
  facts: ReplaySupplementalFact[],
  decisionTime: string,
): ReplaySupplementalFact[] {
  const cutoff = Date.parse(decisionTime)
  if (!Number.isFinite(cutoff)) throw new Error("supplemental fact selection requires an RFC 3339 decision time")
  const selected = new Map<string, ReplaySupplementalFact>()
  for (const fact of facts) {
    if (Date.parse(fact.availability_at) > cutoff) continue
    selected.set(supplementalFactGroupKey(fact), fact)
  }
  return [...selected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, fact]) => structuredClone(fact))
}

function supplementalFactGroupKey(fact: ReplaySupplementalFact): string {
  return `${fact.source_id}\u0000${fact.entity_key}\u0000${fact.fact_key}\u0000${fact.event_time}`
}

function validatePointInTimePolicyBindings(
  request: ReplayExecutionRequest,
  manifest: ReplayDatasetManifest,
  firstOpen: number,
  lastClose: number,
  entryTime: string,
  observedThrough: number,
): void {
  const risks = manifest.venue_risk_policy_epochs
  const specs = manifest.instrument.spec_epochs
  validateSnapshotScheduleCoversWindow(risks, firstOpen, lastClose, observedThrough, "venue risk policy")
  validateSnapshotScheduleCoversWindow(specs, firstOpen, lastClose, observedThrough, "instrument spec")
  const venueId = risks[0].venue_id
  if (risks.some((risk) => risk.symbol !== manifest.symbol || risk.venue_id !== venueId)
      || specs.some((spec) => spec.symbol !== manifest.symbol || spec.venue_id !== venueId)) {
    throw new Error("policy schedule symbol or venue does not match dataset manifest")
  }
  if (request.venue_risk_policy_schedule_hash !== canonicalHash(risks)) {
    throw new Error("venue risk policy schedule hash does not match Replay request")
  }
  const instrumentSpecHash = canonicalHash({ epochs: specs, accounting: manifest.instrument.accounting })
  if (request.instrument_spec_schedule_hash !== instrumentSpecHash) {
    throw new Error("instrument spec schedule hash does not match Replay request")
  }
  const entryRisk = resolveReplayVenueRiskPolicyAt(manifest, entryTime)
  if (request.margin_policy.initial_margin_rate !== entryRisk.initial_margin_rate
      || canonicalHash(request.margin_policy.maintenance_tier) !== canonicalHash(entryRisk.maintenance_tier)
      || request.cost_policy.liquidation_fee_bps !== entryRisk.liquidation_fee_bps) {
    throw new Error("Replay request entry risk parameters do not match the active venue risk policy epoch")
  }
}

function validateSnapshotScheduleCoversWindow<T extends { effective_at: string; valid_until: string | null; observed_at: string }>(
  snapshots: T[],
  firstOpen: number,
  lastClose: number,
  observedThrough: number,
  field: string,
): void {
  const first = snapshots[0]
  const last = snapshots.at(-1)!
  if (firstOpen < Date.parse(first.effective_at)
      || (first.valid_until !== null && firstOpen >= Date.parse(first.valid_until))) {
    throw new Error(`${field} schedule does not start with the epoch active at the Replay window start`)
  }
  if (lastClose < Date.parse(last.effective_at)
      || (last.valid_until !== null && lastClose >= Date.parse(last.valid_until))) {
    throw new Error(`${field} schedule does not cover the complete Replay window`)
  }
  if (snapshots.some((snapshot) => Date.parse(snapshot.observed_at) > observedThrough)) {
    throw new Error(`${field} schedule contains an epoch unavailable by manifest observed_through`)
  }
}

export function resolveReplayVenueRiskPolicyAt(
  manifest: ReplayDatasetManifest,
  timestamp: string,
): ReplayVenueRiskPolicySnapshot {
  return resolveReplaySnapshotAt(manifest.venue_risk_policy_epochs, timestamp, "venue risk policy")
}

export function resolveReplayInstrumentSpecAt(
  manifest: ReplayDatasetManifest,
  timestamp: string,
): ReplayInstrumentSpecSnapshot {
  return resolveReplaySnapshotAt(manifest.instrument.spec_epochs, timestamp, "instrument spec")
}

function resolveReplaySnapshotAt<T extends { effective_at: string; valid_until: string | null }>(
  snapshots: T[],
  timestamp: string,
  field: string,
): T {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) throw new Error(`${field} resolution requires an RFC 3339 timestamp`)
  const snapshot = snapshots.find((candidate) => Date.parse(candidate.effective_at) <= time
    && (candidate.valid_until === null || time < Date.parse(candidate.valid_until)))
  if (!snapshot) throw new Error(`${field} schedule has no epoch at ${timestamp}`)
  return snapshot
}

function validateMarkCoverage(
  manifest: ReplayDatasetManifest,
  events: ReplayMarkEvent[],
  observedThrough: number,
  firstOpen: number,
  lastClose: number,
): void {
  if (events.length !== manifest.mark_event_count) throw new Error("mark event count does not match dataset manifest")
  if (manifest.mark_coverage === "none") {
    if (events.length !== 0) throw new Error("mark coverage none cannot supply mark events")
    return
  }
  const interval = manifest.mark_interval_ms
  if (interval === null) throw new Error("complete mark coverage requires mark_interval_ms")
  const expectedCount = (lastClose - firstOpen) / interval + 1
  if (!Number.isSafeInteger(expectedCount) || expectedCount !== events.length) {
    throw new Error("complete mark coverage does not span the manifest window on its declared grid")
  }
  for (const [index, event] of events.entries()) {
    const timestamp = Date.parse(event.timestamp)
    if (timestamp !== firstOpen + index * interval) throw new Error(`mark event ${index} is not aligned to the complete mark grid`)
    if (Date.parse(event.available_at) !== timestamp) throw new Error(`mark event ${index} is not available at event time`)
    if (timestamp > observedThrough) throw new Error(`mark event ${index} is not available by manifest observed_through`)
    if (!isReplayIncrementAligned(event.mark_price, manifest.instrument.accounting.price_increment)) {
      throw new Error(`mark event ${index} price does not align to instrument price increment`)
    }
  }
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
  if (manifest.supplemental_facts.coverage === "signal_time_snapshot") limitations.push({
    code: "supplemental-signal-derivation-harness-bound",
    severity: "info",
    detail: "Replay certifies the signal-time supplemental view and lineage; the precomputed Signal derivation remains bound to the frozen harness rather than being recomputed by the engine.",
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

export function validateReplayMarkEvents(events: ReplayMarkEvent[]): ReplayMarkEvent[] {
  let priorTimestamp = Number.NEGATIVE_INFINITY
  let priorSequence = -1
  return [...events].map((event, index) => {
    const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
    if (!timestampPattern.test(event.timestamp) || !timestampPattern.test(event.available_at)) {
      throw new Error("mark events must use RFC 3339 UTC timestamps")
    }
    const timestamp = Date.parse(event.timestamp)
    const availableAt = Date.parse(event.available_at)
    if (!Number.isFinite(timestamp) || !Number.isFinite(availableAt) || timestamp <= priorTimestamp) {
      throw new Error("mark events must have strictly ordered ISO timestamps")
    }
    if (!Number.isSafeInteger(event.source_sequence) || event.source_sequence <= priorSequence) {
      throw new Error("mark events must have strictly increasing non-negative source_sequence")
    }
    if (!Number.isFinite(event.mark_price) || event.mark_price <= 0) throw new Error(`mark event ${index} mark_price must be positive`)
    priorTimestamp = timestamp
    priorSequence = event.source_sequence
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
