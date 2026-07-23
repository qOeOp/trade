import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { Database } from "bun:sqlite"
import {
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { runOwnerToolRecordSync } from "../../../../../contracts/runtime-core/src/owner-tool-client"
import {
  assertProjectRuntimePath,
  displayPath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  createDeveloperDataSnapshotBinding,
  type DeveloperDataSnapshotBinding,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import {
  ensureResearchStateSchema,
} from "../../../state-store/src/lib/research-state-store"
import {
  assertFormalReplayContext,
  loadFormalReplayContext,
  persistFormalReplayImmutableJson,
  type FormalReplayContext,
} from "./formal-replay-runner"

export const FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA =
  "trade.rd-formal-replay-data-prepare-request.v1" as const
export const FORMAL_REPLAY_DATA_PREPARE_RESULT_SCHEMA =
  "trade.rd-formal-replay-data-prepare-result.v1" as const
const OWNER_COMPILE_REQUEST_SCHEMA =
  "trade.rd-formal-replay-data-bundle-compile-request.v1" as const
const OWNER_COMPILE_RESULT_SCHEMA =
  "trade.rd-formal-replay-data-bundle-compile-result.v1" as const

interface SourceRef {
  ref: string
  sha256: string
}

interface FormalReplayDataPrepareRequest {
  schema_version: typeof FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA
  request_registration_id: string
  request_registration_hash: string
  data_snapshot_binding: DeveloperDataSnapshotBinding
  funding_events_source: SourceRef | null
  mark_events_source: SourceRef | null
  supplemental_facts_source: SourceRef | null
  output_ref: string
  environment_id: string
}

export interface FormalReplayDataPrepareResult {
  schema_version: typeof FORMAL_REPLAY_DATA_PREPARE_RESULT_SCHEMA
  request_registration_id: string
  request_registration_hash: string
  data_snapshot_binding_hash: string
  bundle_ref: string
  bundle_sha256: string
  dataset_manifest_hash: string
  dataset_hash: string
  row_count: number
  recovered: boolean
  replay_authority: "none_until_registered_attempt"
  review_authority: "none"
  deployment_authority: "none"
  trading_authority: false
}

interface Dependencies {
  load_context(db: Database, registrationId: string): FormalReplayContext
  compile(args: string[]): JSONRecord
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  load_context: loadFormalReplayContext,
  compile: (args) => runOwnerToolRecordSync(
    "research.replay-execution",
    args,
    "formal Replay data bundle compiler",
  ),
}

export function prepareFormalReplayData(
  dbPath: string,
  rawRequest: JSONRecord,
  dependencies: Dependencies = DEFAULT_DEPENDENCIES,
): FormalReplayDataPrepareResult {
  const request = parseRequest(rawRequest)
  assertProjectRuntimePath(dbPath)
  const db = new Database(resolveRepoPath(dbPath))
  try {
    ensureDatabaseIdentity(
      db,
      buildDatabaseIdentity(request.environment_id, "research_state_store"),
    )
    ensureResearchStateSchema(db)
    const context = dependencies.load_context(
      db,
      request.request_registration_id,
    )
    assertFormalReplayContext(request, context)
    assertSnapshotBinding(
      request.data_snapshot_binding,
      context.manifest,
    )
    const compileRequest = {
      schema_version: OWNER_COMPILE_REQUEST_SCHEMA,
      dataset_manifest: context.manifest,
      ohlcv_source: {
        ref: request.data_snapshot_binding.content_ref,
        sha256: request.data_snapshot_binding.content_hash,
      },
      funding_events_source: request.funding_events_source,
      mark_events_source: request.mark_events_source,
      supplemental_facts_source: request.supplemental_facts_source,
      output_ref: request.output_ref,
    }
    const inputRef = persistCompileRequest(request.output_ref, compileRequest)
    const ownerResult = dependencies.compile([
      "--compile-data-bundle",
      "--input",
      inputRef,
    ])
    return validateOwnerResult(request, context.stored_manifest_hash, ownerResult)
  } finally {
    db.close()
  }
}

function parseRequest(value: JSONRecord): FormalReplayDataPrepareRequest {
  const expected = [
    "data_snapshot_binding",
    "environment_id",
    "funding_events_source",
    "mark_events_source",
    "output_ref",
    "request_registration_hash",
    "request_registration_id",
    "schema_version",
    "supplemental_facts_source",
  ]
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)
      || value.schema_version !== FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA) {
    throw new Error("formal Replay data prepare request contract is invalid")
  }
  const request = value as unknown as FormalReplayDataPrepareRequest
  identifier(request.request_registration_id, "request_registration_id")
  digest(request.request_registration_hash, "request_registration_hash")
  identifier(request.environment_id, "environment_id")
  const binding = createDeveloperDataSnapshotBinding(
    record(
      request.data_snapshot_binding,
      "data_snapshot_binding",
    ) as unknown as DeveloperDataSnapshotBinding,
  )
  if (binding.binding_hash !== request.data_snapshot_binding.binding_hash) {
    throw new Error("formal Replay data snapshot binding hash drifted")
  }
  const outputRef = runtimeRef(request.output_ref, "output_ref")
  return {
    schema_version: FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA,
    request_registration_id: request.request_registration_id,
    request_registration_hash: request.request_registration_hash,
    data_snapshot_binding: binding,
    funding_events_source: optionalSource(
      request.funding_events_source,
      "funding_events_source",
    ),
    mark_events_source: optionalSource(
      request.mark_events_source,
      "mark_events_source",
    ),
    supplemental_facts_source: optionalSource(
      request.supplemental_facts_source,
      "supplemental_facts_source",
    ),
    output_ref: outputRef,
    environment_id: request.environment_id,
  }
}

function assertSnapshotBinding(
  binding: DeveloperDataSnapshotBinding,
  manifest: JSONRecord,
): void {
  const firstOpen = timestamp(manifest.first_open_time, "manifest.first_open_time")
  const lastClose = timestamp(manifest.last_close_time, "manifest.last_close_time")
  const intervalMs = positiveInteger(manifest.interval_ms, "manifest.interval_ms")
  if (binding.symbol !== manifest.symbol
      || binding.timeframe !== manifest.timeframe
      || binding.row_count !== manifest.row_count
      || timestamp(binding.first_open_at, "binding.first_open_at") !== firstOpen
      || timestamp(binding.last_open_at, "binding.last_open_at") + intervalMs !== lastClose) {
    throw new Error("formal Replay data snapshot binding drifted from registered Dataset Manifest")
  }
}

function persistCompileRequest(
  outputRef: string,
  request: JSONRecord,
): string {
  const bytesHash = createHash("sha256")
    .update(canonicalJson(request))
    .digest("hex")
  const path = resolve(
    dirname(resolveRepoPath(outputRef)),
    "compile-input",
    `${bytesHash}.json`,
  )
  persistFormalReplayImmutableJson(
    path,
    request,
    "formal Replay data compile input",
  )
  return displayPath(path)
}

function validateOwnerResult(
  request: FormalReplayDataPrepareRequest,
  manifestHash: string,
  value: JSONRecord,
): FormalReplayDataPrepareResult {
  if (value.schema_version !== OWNER_COMPILE_RESULT_SCHEMA
      || value.bundle_ref !== request.output_ref
      || value.dataset_manifest_hash !== manifestHash
      || value.replay_authority !== "none_until_registered_attempt"
      || value.review_authority !== "none"
      || value.deployment_authority !== "none"
      || value.trading_authority !== false) {
    throw new Error("formal Replay data bundle compiler result drifted")
  }
  return {
    schema_version: FORMAL_REPLAY_DATA_PREPARE_RESULT_SCHEMA,
    request_registration_id: request.request_registration_id,
    request_registration_hash: request.request_registration_hash,
    data_snapshot_binding_hash: request.data_snapshot_binding.binding_hash,
    bundle_ref: text(value.bundle_ref, "bundle_ref"),
    bundle_sha256: digest(value.bundle_sha256, "bundle_sha256"),
    dataset_manifest_hash: digest(
      value.dataset_manifest_hash,
      "dataset_manifest_hash",
    ),
    dataset_hash: digest(value.dataset_hash, "dataset_hash"),
    row_count: positiveInteger(value.row_count, "row_count"),
    recovered: value.recovered === true,
    replay_authority: "none_until_registered_attempt",
    review_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function optionalSource(value: unknown, field: string): SourceRef | null {
  if (value === null) return null
  const source = record(value, field)
  if (JSON.stringify(Object.keys(source).sort())
      !== JSON.stringify(["ref", "sha256"])) {
    throw new Error(`${field} contract is invalid`)
  }
  return {
    ref: runtimeRef(source.ref, `${field}.ref`),
    sha256: digest(source.sha256, `${field}.sha256`),
  }
}

function runtimeRef(value: unknown, field: string): string {
  const ref = text(value, field)
  assertProjectRuntimePath(ref)
  return displayPath(resolveRepoPath(ref))
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(result)) {
    throw new Error(`${field} is invalid`)
  }
  return result
}

function digest(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
  return result
}

function timestamp(value: unknown, field: string): number {
  const result = text(value, field)
  const parsed = Date.parse(result)
  if (!Number.isFinite(parsed)) throw new Error(`${field} is invalid`)
  return parsed
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${field} must be a positive integer`)
  }
  return Number(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}
