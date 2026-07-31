import { readFileSync } from "node:fs"
import { resolveReadablePath } from "../../../../../../contracts/runtime-core/src/paths"
import { loadManifest } from "../../../legacy-research-data/src/lib/legacy-research-data"
import {
  hashCanonical,
  hashFile,
  replayContentHash,
  replayDataHash,
  replayHarnessHash,
} from "../../../legacy-replay-identity/src/lib/legacy-replay-identity"

type JSONRecord = Record<string, unknown>

interface LegacyProvenanceCandle {
  timestamp: number
}

interface LegacyProvenanceTrade {
  exit_time: string
}

interface ReplayProvenance {
  harness_hash: string
  data_hash: string
  assumptions_hash: string
  data_ref: string
  timeframe: string
  data_schema_version: number
  closed_candles_only: boolean
  manifest_checksum_verified: boolean
  temporal_contract: ReplayTemporalContract
  supplemental_data?: Array<{ ref: string; content_sha256: string }>
}

interface ReplayTemporalContract {
  method: "closed_candle_replay_v1"
  timeframe: string
  closed_candle_only: boolean
  reference_at: string | null
  availability_at: string | null
  lookback_start: string | null
  label_end: string | null
  universe_selected_at: string | null
  universe_selection_source: string
  label_policy: string
  supplemental_data: ReplaySupplementalTemporalContract[]
}

interface ReplaySupplementalTemporalContract {
  ref: string
  reference_at: string | null
  availability_at: string | null
  availability_source: string
}

function buildReplayProvenance(
  manifestPath: string,
  timeframe: string,
  intervalMilliseconds: number,
  assumptions: JSONRecord,
  trades: LegacyProvenanceTrade[],
  candles: LegacyProvenanceCandle[],
  supplementalDataRefs: string[] = [],
): ReplayProvenance {
  const manifest = loadManifest(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const declaredChecksum = stringField(item.content_sha256)
  const supplementalData = [...new Set(supplementalDataRefs)].sort().map((ref) => ({
    ref,
    content_sha256: hashFile(ref),
  }))
  const refs = supplementalData.map((item) => item.ref)
  const actualDataHash = replayDataHash(manifestPath, timeframe, refs)
  const contentHash = replayContentHash(manifestPath, timeframe)
  return {
    harness_hash: replayHarnessHash(),
    data_hash: actualDataHash,
    assumptions_hash: hashCanonical(assumptions),
    data_ref: manifestPath,
    timeframe,
    data_schema_version: Number(manifest.schema_version) || 0,
    closed_candles_only: manifest.closed_candles_only === true,
    manifest_checksum_verified: Boolean(declaredChecksum && declaredChecksum === contentHash),
    temporal_contract: buildTemporalContract(manifest, timeframe, intervalMilliseconds, candles, trades, refs),
    ...(supplementalData.length > 0 ? { supplemental_data: supplementalData } : {}),
  }
}

function buildTemporalContract(
  manifest: JSONRecord,
  timeframe: string,
  intervalMilliseconds: number,
  candles: LegacyProvenanceCandle[],
  trades: LegacyProvenanceTrade[],
  supplementalDataRefs: string[],
): ReplayTemporalContract {
  const first = candles[0]
  const last = candles[candles.length - 1]
  const referenceAt = last ? new Date(last.timestamp).toISOString() : null
  const availabilityAt = last ? new Date(last.timestamp + intervalMilliseconds).toISOString() : null
  const latestTradeExit = trades
    .map((trade) => Date.parse(trade.exit_time))
    .filter(Number.isFinite)
    .reduce((max, timestamp) => Math.max(max, timestamp), Number.NEGATIVE_INFINITY)
  const labelEnd = Number.isFinite(latestTradeExit)
    ? new Date(latestTradeExit + intervalMilliseconds).toISOString()
    : availabilityAt
  const universe = readUniverseSelectionTime(manifest, first)
  return {
    method: "closed_candle_replay_v1",
    timeframe,
    closed_candle_only: manifest.closed_candles_only === true,
    reference_at: referenceAt,
    availability_at: availabilityAt,
    lookback_start: first ? new Date(first.timestamp).toISOString() : null,
    label_end: labelEnd,
    universe_selected_at: universe.value,
    universe_selection_source: universe.source,
    label_policy: "signals use closed candles; entries occur on next open; trade labels are only available after the exit candle closes; selection-validation train labels crossing the OOS boundary are purged",
    supplemental_data: supplementalDataRefs.map(readSupplementalTemporalContract),
  }
}

function emptyTemporalContract(timeframe: string): ReplayTemporalContract {
  return {
    method: "closed_candle_replay_v1",
    timeframe,
    closed_candle_only: false,
    reference_at: null,
    availability_at: null,
    lookback_start: null,
    label_end: null,
    universe_selected_at: null,
    universe_selection_source: "not_declared",
    label_policy: "not_evaluated",
    supplemental_data: [],
  }
}

function readUniverseSelectionTime(manifest: JSONRecord, first: LegacyProvenanceCandle | undefined): { value: string | null; source: string } {
  const declared = firstString(manifest.universe_selected_at, manifest.universe_selection_time)
  if (declared) return { value: normalizeIsoTime(declared), source: "manifest_universe_selected_at" }
  const generated = firstString(manifest.generated_at, manifest.created_at)
  if (generated) return { value: normalizeIsoTime(generated), source: "manifest_generated_at" }
  return { value: first ? new Date(first.timestamp).toISOString() : null, source: "dataset_start_fallback" }
}

function readSupplementalTemporalContract(ref: string): ReplaySupplementalTemporalContract {
  try {
    const report = asRecord(JSON.parse(readFileSync(resolveReadablePath(ref), "utf8")))
    const data = asRecord(report.data)
    const rawTime = firstString(report.generated_at, report.created_at, report.updated_at, data.generated_at, data.created_at, data.updated_at)
    const normalized = rawTime ? normalizeIsoTime(rawTime) : null
    return {
      ref,
      reference_at: normalized,
      availability_at: normalized,
      availability_source: normalized ? "declared_report_time" : "not_declared",
    }
  } catch {
    return { ref, reference_at: null, availability_at: null, availability_source: "unreadable" }
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringField(value)
    if (text) return text
  }
  return ""
}

function normalizeIsoTime(value: string): string {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
}

export {
  buildReplayProvenance,
  buildTemporalContract,
  emptyTemporalContract,
  type LegacyProvenanceCandle,
  type LegacyProvenanceTrade,
  type ReplayProvenance,
  type ReplaySupplementalTemporalContract,
  type ReplayTemporalContract,
}
