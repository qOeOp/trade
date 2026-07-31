import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, relative, resolve } from "node:path"
import {
  assertProjectRuntimePath,
  displayPath,
  repoRoot,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  assertReplayDatasetManifest,
  assertReplayMarketBars,
  assertReplaySupplementalFact,
  canonicalHash,
  replayDatasetHash,
  replayDatasetManifestHash,
  type ReplayDatasetManifest,
  type ReplayFundingEvent,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplaySupplementalFact,
} from "../../../contracts/src/lib/replay-contracts"

export const FORMAL_REPLAY_DATA_BUNDLE_SCHEMA =
  "trade.rd-formal-replay-data-bundle.v1" as const
export const FORMAL_REPLAY_DATA_BUNDLE_COMPILE_REQUEST_SCHEMA =
  "trade.rd-formal-replay-data-bundle-compile-request.v1" as const
export const FORMAL_REPLAY_DATA_BUNDLE_COMPILE_RESULT_SCHEMA =
  "trade.rd-formal-replay-data-bundle-compile-result.v1" as const

const MAX_SOURCE_BYTES = 256 * 1024 * 1024
const OHLCV_HEADER = "date,timestamp,open,high,low,close,volume"

interface SourceRef {
  ref: string
  sha256: string
}

export interface FormalReplayDataBundleCompileRequest {
  schema_version: typeof FORMAL_REPLAY_DATA_BUNDLE_COMPILE_REQUEST_SCHEMA
  dataset_manifest: ReplayDatasetManifest
  ohlcv_source: SourceRef
  funding_events_source: SourceRef | null
  mark_events_source: SourceRef | null
  supplemental_facts_source: SourceRef | null
  output_ref: string
}

export interface FormalReplayDataBundleCompileResult {
  schema_version: typeof FORMAL_REPLAY_DATA_BUNDLE_COMPILE_RESULT_SCHEMA
  bundle_ref: string
  bundle_sha256: string
  dataset_manifest_hash: string
  dataset_hash: string
  row_count: number
  funding_event_count: number
  mark_event_count: number
  supplemental_fact_count: number
  recovered: boolean
  replay_authority: "none_until_registered_attempt"
  review_authority: "none"
  deployment_authority: "none"
  trading_authority: false
}

export function compileFormalReplayDataBundle(
  rawRequest: JSONRecord,
): FormalReplayDataBundleCompileResult {
  const request = parseRequest(rawRequest)
  const manifest = structuredClone(request.dataset_manifest)
  assertReplayDatasetManifest(manifest)
  const bars = readBars(request.ohlcv_source, manifest.interval_ms)
  const fundingEvents = readOptionalArray<ReplayFundingEvent>(
    request.funding_events_source,
    "funding events",
  )
  const markEvents = readOptionalArray<ReplayMarkEvent>(
    request.mark_events_source,
    "mark events",
  )
  const supplementalFacts = readOptionalArray<ReplaySupplementalFact>(
    request.supplemental_facts_source,
    "supplemental facts",
  )
  assertReplayMarketBars(bars)
  assertFundingEvents(fundingEvents)
  assertMarkEvents(markEvents)
  for (const fact of supplementalFacts) assertReplaySupplementalFact(fact)
  assertManifestData(
    manifest,
    bars,
    fundingEvents,
    markEvents,
    supplementalFacts,
  )
  const body = {
    schema_version: FORMAL_REPLAY_DATA_BUNDLE_SCHEMA,
    dataset_manifest_hash: replayDatasetManifestHash(manifest),
    bars,
    funding_events: fundingEvents,
    mark_events: markEvents,
    supplemental_facts: supplementalFacts,
  }
  const persisted = persistImmutableJson(request.output_ref, body)
  return {
    schema_version: FORMAL_REPLAY_DATA_BUNDLE_COMPILE_RESULT_SCHEMA,
    bundle_ref: persisted.ref,
    bundle_sha256: persisted.sha256,
    dataset_manifest_hash: body.dataset_manifest_hash,
    dataset_hash: manifest.data_hash,
    row_count: bars.length,
    funding_event_count: fundingEvents.length,
    mark_event_count: markEvents.length,
    supplemental_fact_count: supplementalFacts.length,
    recovered: persisted.recovered,
    replay_authority: "none_until_registered_attempt",
    review_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function parseRequest(value: JSONRecord): FormalReplayDataBundleCompileRequest {
  const expected = [
    "dataset_manifest",
    "funding_events_source",
    "mark_events_source",
    "ohlcv_source",
    "output_ref",
    "schema_version",
    "supplemental_facts_source",
  ]
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)
      || value.schema_version !== FORMAL_REPLAY_DATA_BUNDLE_COMPILE_REQUEST_SCHEMA) {
    throw new Error("formal Replay data bundle compile request contract is invalid")
  }
  const request = value as unknown as FormalReplayDataBundleCompileRequest
  const outputRef = runtimeRef(request.output_ref, "output_ref")
  const parsed: FormalReplayDataBundleCompileRequest = {
    schema_version: FORMAL_REPLAY_DATA_BUNDLE_COMPILE_REQUEST_SCHEMA,
    dataset_manifest: record(
      request.dataset_manifest,
      "dataset_manifest",
    ) as unknown as ReplayDatasetManifest,
    ohlcv_source: sourceRef(request.ohlcv_source, "ohlcv_source"),
    funding_events_source: optionalSourceRef(
      request.funding_events_source,
      "funding_events_source",
    ),
    mark_events_source: optionalSourceRef(
      request.mark_events_source,
      "mark_events_source",
    ),
    supplemental_facts_source: optionalSourceRef(
      request.supplemental_facts_source,
      "supplemental_facts_source",
    ),
    output_ref: outputRef,
  }
  const sourceRefs = [
    parsed.ohlcv_source.ref,
    parsed.funding_events_source?.ref,
    parsed.mark_events_source?.ref,
    parsed.supplemental_facts_source?.ref,
  ].filter((item): item is string => Boolean(item))
  if (sourceRefs.includes(outputRef)) {
    throw new Error("formal Replay data bundle output cannot overwrite a source")
  }
  return parsed
}

function sourceRef(value: unknown, field: string): SourceRef {
  const source = record(value, field)
  const expected = ["ref", "sha256"]
  if (JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(expected)) {
    throw new Error(`${field} contract is invalid`)
  }
  return {
    ref: runtimeRef(source.ref, `${field}.ref`),
    sha256: digest(source.sha256, `${field}.sha256`),
  }
}

function optionalSourceRef(value: unknown, field: string): SourceRef | null {
  return value === null ? null : sourceRef(value, field)
}

function readBars(source: SourceRef, intervalMs: number): ReplayMarketBar[] {
  const bytes = readSource(source, "OHLCV source")
  const text = bytes.toString("utf8")
  if (text.includes("\0")) throw new Error("OHLCV source contains binary data")
  const lines = text.trimEnd().split(/\r?\n/)
  if (lines.shift() !== OHLCV_HEADER || lines.length < 1) {
    throw new Error("OHLCV source header or row set is invalid")
  }
  let priorTimestamp = Number.NEGATIVE_INFINITY
  return lines.map((line, index) => {
    const fields = line.split(",")
    if (fields.length !== 7) {
      throw new Error(`OHLCV row ${index + 1} field count is invalid`)
    }
    const timestamp = Number(fields[1])
    if (!Number.isSafeInteger(timestamp)
        || timestamp <= priorTimestamp
        || Date.parse(fields[0]!) !== timestamp) {
      throw new Error(`OHLCV row ${index + 1} timestamp is invalid`)
    }
    priorTimestamp = timestamp
    const bar: ReplayMarketBar = {
      open_time: new Date(timestamp).toISOString(),
      close_time: new Date(timestamp + intervalMs).toISOString(),
      open: decimal(fields[2], `OHLCV row ${index + 1} open`),
      high: decimal(fields[3], `OHLCV row ${index + 1} high`),
      low: decimal(fields[4], `OHLCV row ${index + 1} low`),
      close: decimal(fields[5], `OHLCV row ${index + 1} close`),
      volume: decimal(fields[6], `OHLCV row ${index + 1} volume`),
      closed: true,
    }
    return bar
  })
}

function readOptionalArray<T>(source: SourceRef | null, label: string): T[] {
  if (!source) return []
  const parsed = JSON.parse(readSource(source, label).toString("utf8"))
  if (!Array.isArray(parsed)) throw new Error(`${label} source must contain one JSON array`)
  return parsed as T[]
}

function readSource(source: SourceRef, label: string): Buffer {
  const path = safeExistingRuntimeFile(source.ref, label)
  const size = statSync(path).size
  if (size < 2 || size > MAX_SOURCE_BYTES) {
    throw new Error(`${label} size is outside the bounded compiler envelope`)
  }
  const bytes = readFileSync(path)
  if (sha256(bytes) !== source.sha256) throw new Error(`${label} content drifted`)
  return bytes
}

function assertManifestData(
  manifest: ReplayDatasetManifest,
  bars: ReplayMarketBar[],
  fundingEvents: ReplayFundingEvent[],
  markEvents: ReplayMarkEvent[],
  supplementalFacts: ReplaySupplementalFact[],
): void {
  const first = bars[0]
  const last = bars.at(-1)
  const datasetHash = replayDatasetHash(
    bars,
    fundingEvents,
    markEvents,
    supplementalFacts,
  )
  if (!first || !last
      || manifest.row_count !== bars.length
      || manifest.first_open_time !== first.open_time
      || manifest.last_close_time !== last.close_time
      || manifest.mark_event_count !== markEvents.length
      || manifest.supplemental_facts.record_count !== supplementalFacts.length
      || manifest.supplemental_facts.content_hash !== canonicalHash(supplementalFacts)
      || manifest.data_hash !== datasetHash) {
    throw new Error("formal Replay data facts drifted from the registered Dataset Manifest")
  }
  if (manifest.mark_coverage === "none" && markEvents.length !== 0) {
    throw new Error("formal Replay manifest declares no mark-event coverage")
  }
}

function assertFundingEvents(events: ReplayFundingEvent[]): void {
  let prior = Number.NEGATIVE_INFINITY
  for (const [index, event] of events.entries()) {
    const timestamp = utc(event.timestamp, `funding_events[${index}].timestamp`)
    if (timestamp <= prior
        || !finite(event.rate)
        || !positive(event.mark_price)) {
      throw new Error(`funding_events[${index}] is invalid`)
    }
    prior = timestamp
  }
}

function assertMarkEvents(events: ReplayMarkEvent[]): void {
  let prior = Number.NEGATIVE_INFINITY
  for (const [index, event] of events.entries()) {
    const timestamp = utc(event.timestamp, `mark_events[${index}].timestamp`)
    const availableAt = utc(
      event.available_at,
      `mark_events[${index}].available_at`,
    )
    if (timestamp < prior
        || availableAt < timestamp
        || !Number.isSafeInteger(event.source_sequence)
        || event.source_sequence < 0
        || !positive(event.mark_price)) {
      throw new Error(`mark_events[${index}] is invalid`)
    }
    prior = timestamp
  }
}

function persistImmutableJson(
  ref: string,
  body: JSONRecord,
): { ref: string; sha256: string; recovered: boolean } {
  const path = safeOutputRuntimePath(ref)
  const bytes = Buffer.from(`${canonicalJson(body)}\n`)
  const digest = sha256(bytes)
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) {
      throw new Error("formal Replay data bundle output identity collision")
    }
    return { ref: displayPath(path), sha256: digest, recovered: true }
  }
  const partial = `${path}.partial-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(partial, bytes, { flag: "wx", mode: 0o600 })
    linkSync(partial, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST"
        && existsSync(path)
        && readFileSync(path).equals(bytes)) {
      return { ref: displayPath(path), sha256: digest, recovered: true }
    }
    throw error
  } finally {
    if (existsSync(partial)) unlinkSync(partial)
  }
  return { ref: displayPath(path), sha256: digest, recovered: false }
}

function safeExistingRuntimeFile(ref: string, field: string): string {
  const root = realpathSync(repoRoot())
  const path = resolveRepoPath(runtimeRef(ref, field))
  if (!existsSync(path)) throw new Error(`${field} is missing`)
  const sourceInfo = lstatSync(path)
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error(`${field} must be a regular non-symlink file`)
  }
  const real = realpathSync(path)
  const rel = relative(root, real)
  if (!rel || rel.startsWith("..") || resolve(root, rel) !== real
      || !sourceInfo.isFile()) {
    throw new Error(`${field} escapes the repository or is not a regular file`)
  }
  return real
}

function safeOutputRuntimePath(ref: string): string {
  const root = realpathSync(repoRoot())
  const path = resolveRepoPath(runtimeRef(ref, "output_ref"))
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const parent = realpathSync(dirname(path))
  const rel = relative(root, parent)
  if (!rel || rel.startsWith("..") || resolve(root, rel) !== parent) {
    throw new Error("formal Replay data bundle output parent escapes the repository")
  }
  if (existsSync(path)) {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("formal Replay data bundle output must be a regular file")
    }
    const real = realpathSync(path)
    const targetRel = relative(root, real)
    if (!targetRel || targetRel.startsWith("..") || resolve(root, targetRel) !== real) {
      throw new Error("formal Replay data bundle output escapes the repository")
    }
  }
  return path
}

function runtimeRef(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${field} is required`)
  }
  assertProjectRuntimePath(value)
  return displayPath(resolveRepoPath(value))
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}

function digest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
  return value
}

function decimal(value: unknown, field: string): number {
  if (typeof value !== "string"
      || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`${field} must be a non-negative plain decimal`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} is outside numeric range`)
  return parsed
}

function utc(value: unknown, field: string): number {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error(`${field} must be RFC 3339 UTC`)
  }
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new Error(`${field} is invalid`)
  return time
}

function finite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value)
}

function positive(value: unknown): boolean {
  return finite(value) && Number(value) > 0
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
