import { createHash } from "node:crypto"
import {
  createReadStream,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import { basename, dirname, relative, resolve } from "node:path"
import { canonicalHash } from "../../../../../../contracts/runtime-core/src/canonical-json"
import {
  assertProjectRuntimePath,
  repoRoot,
} from "../../../../../../contracts/runtime-core/src/paths"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperDataSnapshotBinding,
  type DeveloperDataSnapshotBinding,
} from "../../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"

export const DATA_SPLIT_SEGMENT_SNAPSHOT_SCHEMA_VERSION =
  "trade.rd-data-split-segment-snapshot.v1" as const

export interface DataSplitSegmentSnapshot {
  schema_version: typeof DATA_SPLIT_SEGMENT_SNAPSHOT_SCHEMA_VERSION
  snapshot_ref: string
  split_id: string
  hypothesis_id: string
  dataset_id: string
  symbol: string
  segment: "discovery" | "validation"
  timeframe: string
  row_count: number
  first_open_at: string
  last_open_at: string
  report_ref: string
  report_hash: string
  manifest_ref: string
  manifest_hash: string
  content_ref: string
  content_hash: string
  snapshot_hash: string
}

export async function bindDataSplitSegmentSnapshot(input: {
  report_path: string
  dataset_id: string
  segment: "discovery" | "validation"
  timeframe: string
}): Promise<DataSplitSegmentSnapshot> {
  if (input.segment !== "discovery" && input.segment !== "validation") {
    throw new Error("Developer data binding cannot open locked holdout")
  }
  const root = realpathSync(repoRoot())
  const reportPath = safeRuntimeFile(root, input.report_path, "report_path")
  const reportBytes = boundedJson(reportPath, 4 * 1024 * 1024, "split report")
  const report = record(JSON.parse(reportBytes.toString("utf8")))
  if (report.schema_version !== "trade-flow.strategy-data-split.v1") {
    throw new Error("data split report schema is unsupported")
  }
  const splitId = nonempty(report.split_id, "split_id")
  const hypothesisId = nonempty(report.hypothesis_id, "hypothesis_id")
  const dataset = records(report.datasets).find(
    (item) => nonempty(item.dataset_id, "dataset_id") === input.dataset_id,
  )
  if (!dataset) throw new Error(`data split dataset is missing: ${input.dataset_id}`)
  const segment = records(dataset.segments).find(
    (item) => item.segment === input.segment,
  )
  if (!segment) throw new Error(`data split segment is missing: ${input.segment}`)

  const manifestPath = safeRuntimeFile(
    root,
    nonempty(segment.manifest_path, "manifest_path"),
    "manifest_path",
  )
  const manifestBytes = boundedJson(manifestPath, 4 * 1024 * 1024, "segment manifest")
  const manifest = record(JSON.parse(manifestBytes.toString("utf8")))
  if (manifest.schema_version !== 2
    || record(manifest.split).split_id !== splitId
    || record(manifest.split).segment !== input.segment) {
    throw new Error("segment manifest identity drifted from split report")
  }
  if (manifest.symbol !== dataset.symbol || manifest.requested_symbol !== dataset.symbol) {
    throw new Error("segment manifest symbol drifted from split report")
  }
  const timeframe = record(record(manifest.timeframes)[input.timeframe])
  const contentFile = nonempty(timeframe.file, "timeframe.file")
  if (basename(contentFile) !== contentFile) {
    throw new Error("segment content file must stay beside its manifest")
  }
  const contentPath = safeRuntimeFile(
    root,
    resolve(dirname(manifestPath), contentFile),
    "content file",
  )
  const contentHash = await hashFile(contentPath)
  if (contentHash !== digest(timeframe.content_sha256, "timeframe.content_sha256")) {
    throw new Error("segment content hash drifted from manifest")
  }
  const rowCount = positiveInteger(timeframe.rows, "timeframe.rows")
  if (rowCount !== positiveInteger(segment.rows, "segment.rows")) {
    throw new Error("segment row count drifted from manifest")
  }

  const body = {
    schema_version: DATA_SPLIT_SEGMENT_SNAPSHOT_SCHEMA_VERSION,
    snapshot_ref: [
      "dataset-split:/",
      encodeURIComponent(splitId),
      encodeURIComponent(input.dataset_id),
      input.segment,
      encodeURIComponent(input.timeframe),
    ].join("/"),
    split_id: splitId,
    hypothesis_id: hypothesisId,
    dataset_id: nonempty(input.dataset_id, "dataset_id"),
    symbol: nonempty(dataset.symbol, "symbol"),
    segment: input.segment,
    timeframe: nonempty(input.timeframe, "timeframe"),
    row_count: rowCount,
    first_open_at: utc(segment.first_open_at, "first_open_at"),
    last_open_at: utc(segment.last_open_at, "last_open_at"),
    report_ref: repoRelative(root, reportPath),
    report_hash: hashBytes(reportBytes),
    manifest_ref: repoRelative(root, manifestPath),
    manifest_hash: hashBytes(manifestBytes),
    content_ref: repoRelative(root, contentPath),
    content_hash: contentHash,
  }
  return { ...body, snapshot_hash: canonicalHash(body) }
}

export function developerDataBindingFromSegmentSnapshot(input: {
  snapshot: DataSplitSegmentSnapshot
  dataset_kinds: string[]
  exchange: string
  evidence_ref?: string
}): DeveloperDataSnapshotBinding {
  const snapshot = input.snapshot
  if (snapshot.schema_version !== DATA_SPLIT_SEGMENT_SNAPSHOT_SCHEMA_VERSION
      || canonicalHash(withoutSnapshotHash(snapshot)) !== snapshot.snapshot_hash) {
    throw new Error("Data Split Segment Snapshot is non-canonical or hash-drifted")
  }
  return createDeveloperDataSnapshotBinding({
    schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
    snapshot_ref: snapshot.snapshot_ref,
    snapshot_hash: snapshot.snapshot_hash,
    dataset_kinds: input.dataset_kinds,
    hypothesis_id: snapshot.hypothesis_id,
    symbol: snapshot.symbol,
    exchange: input.exchange,
    segment: snapshot.segment,
    timeframe: snapshot.timeframe,
    row_count: snapshot.row_count,
    first_open_at: snapshot.first_open_at,
    last_open_at: snapshot.last_open_at,
    report_ref: snapshot.report_ref,
    report_hash: snapshot.report_hash,
    manifest_ref: snapshot.manifest_ref,
    manifest_hash: snapshot.manifest_hash,
    content_ref: snapshot.content_ref,
    content_hash: snapshot.content_hash,
    evidence_ref: input.evidence_ref ?? snapshot.snapshot_ref,
  })
}

function withoutSnapshotHash(snapshot: DataSplitSegmentSnapshot): JSONRecord {
  const { snapshot_hash: _hash, ...body } = snapshot
  return body
}

function safeRuntimeFile(root: string, path: string, field: string): string {
  const value = nonempty(path, field)
  assertProjectRuntimePath(value)
  const resolved = realpathSync(resolve(root, value))
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith("..") || resolve(root, rel) !== resolved) {
    throw new Error(`${field} escapes the repository`)
  }
  const top = rel.split(/[\\/]/)[0]
  if (top !== "data" && top !== "tmp") throw new Error(`${field} must stay under data/ or tmp/`)
  if (!statSync(resolved).isFile()) throw new Error(`${field} must be a regular file`)
  return resolved
}

function boundedJson(path: string, maxBytes: number, field: string): Buffer {
  const size = statSync(path).size
  if (size < 2 || size > maxBytes) throw new Error(`${field} size is invalid`)
  return readFileSync(path)
}

function repoRelative(root: string, path: string): string {
  return relative(root, path).split("\\").join("/")
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

function record(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JSONRecord
    : {}
}

function records(value: unknown): JSONRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(`${field} is required`)
  }
  return value
}

function digest(value: unknown, field: string): string {
  const normalized = nonempty(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return normalized
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${field} must be a positive integer`)
  }
  return Number(value)
}

function utc(value: unknown, field: string): string {
  const normalized = nonempty(value, field)
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return normalized
}
