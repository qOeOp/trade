import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { relative, resolve } from "node:path"
import { canonicalHash, canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"
import { readL2EpochManifest } from "./l2-epoch-manifest"

export const L2_COMPACTION_JOB_SCHEMA_VERSION = "trade.l2-compaction-job.v1" as const
export const L2_COMPACTION_PROPOSAL_SCHEMA_VERSION = "trade.l2-compaction-proposal.v1" as const
export const L2_COMPACTION_POLICY_VERSION = "l2-raw-parquet-zstd-v1" as const

export interface L2CompactionJob {
  schema_version: typeof L2_COMPACTION_JOB_SCHEMA_VERSION
  job_id: string
  epoch_id: string
  symbol: string
  stream_epoch: string
  source_manifest_path: string
  source_manifest_hash: string
  output_path: string
  proposal_path: string
  policy_version: typeof L2_COMPACTION_POLICY_VERSION
  batch_rows: number
}

export interface L2CompactionProposal {
  schema_version: typeof L2_COMPACTION_PROPOSAL_SCHEMA_VERSION
  job_id: string
  epoch_id: string
  symbol: string
  stream_epoch: string
  source_manifest_path: string
  source_manifest_hash: string
  policy_version: typeof L2_COMPACTION_POLICY_VERSION
  parquet_path: string
  parquet_hash: string
  parquet_bytes: number
  row_count: number
  first_local_receive_time_ms: number
  last_local_receive_time_ms: number
  first_final_update_id: number
  last_final_update_id: number
  created_at_ms: number
}

export interface AdmittedL2Compaction {
  compaction_id: string
  proposal_path: string
  proposal_hash: string
  admitted_at: string
  proposal: L2CompactionProposal
}

export function ensureL2CompactionSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS l2_epoch_compaction_job (
      job_id                TEXT PRIMARY KEY,
      epoch_id              TEXT NOT NULL UNIQUE,
      source_manifest_hash  TEXT NOT NULL,
      output_path           TEXT NOT NULL UNIQUE,
      proposal_path         TEXT NOT NULL UNIQUE,
      policy_version        TEXT NOT NULL,
      batch_rows            INTEGER NOT NULL,
      job_json              TEXT NOT NULL CHECK(json_valid(job_json)),
      prepared_at           TEXT NOT NULL,
      FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS l2_epoch_compaction (
      compaction_id         TEXT PRIMARY KEY,
      job_id                TEXT NOT NULL UNIQUE,
      epoch_id              TEXT NOT NULL UNIQUE,
      proposal_path         TEXT NOT NULL UNIQUE,
      proposal_hash         TEXT NOT NULL UNIQUE,
      parquet_path          TEXT NOT NULL UNIQUE,
      parquet_hash          TEXT NOT NULL UNIQUE,
      parquet_bytes         INTEGER NOT NULL,
      row_count             INTEGER NOT NULL,
      policy_version        TEXT NOT NULL,
      proposal_json         TEXT NOT NULL CHECK(json_valid(proposal_json)),
      admitted_at           TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES l2_epoch_compaction_job(job_id),
      FOREIGN KEY(epoch_id) REFERENCES l2_epoch_manifest(epoch_id)
    )
  `)
}

export function prepareL2CompactionJob(db: Database, input: {
  repository_root: string
  epoch_id: string
  output_base?: string
  batch_rows?: number
  prepared_at?: string
}): { commit_status: "created" | "existing"; job: L2CompactionJob } {
  const epoch = readL2EpochManifest(db, requireString(input.epoch_id, "epoch_id"))
  if (epoch == null) throw new Error("L2 epoch is not admitted")
  const existing = db.query(`SELECT job_json FROM l2_epoch_compaction_job WHERE epoch_id = $epoch_id`)
    .get({ $epoch_id: epoch.epoch_id }) as { job_json: string } | null
  if (existing != null) return { commit_status: "existing", job: parseJob(Buffer.from(existing.job_json)) }

  realpathSync(resolve(input.repository_root))
  const outputBase = input.output_base ?? "data/l2-parquet"
  requireCompactionRef(outputBase, "output_base", true)
  const batchRows = input.batch_rows ?? 10_000
  requireSafeInteger(batchRows, "batch_rows", 1, 10_000)
  const identity = canonicalHash({
    epoch_id: epoch.epoch_id,
    source_manifest_hash: epoch.manifest_hash,
    policy_version: L2_COMPACTION_POLICY_VERSION,
  })
  const stem = identity.slice(0, 32)
  const job: L2CompactionJob = {
    schema_version: L2_COMPACTION_JOB_SCHEMA_VERSION,
    job_id: `l2-compact:${identity}`,
    epoch_id: epoch.epoch_id,
    symbol: epoch.manifest.symbol,
    stream_epoch: epoch.manifest.stream_epoch,
    source_manifest_path: epoch.manifest_path,
    source_manifest_hash: epoch.manifest_hash,
    output_path: `${outputBase}/${epoch.manifest.symbol}/${stem}.parquet`,
    proposal_path: `${outputBase}/${epoch.manifest.symbol}/${stem}.proposal.json`,
    policy_version: L2_COMPACTION_POLICY_VERSION,
    batch_rows: batchRows,
  }
  const preparedAt = input.prepared_at ?? new Date().toISOString()
  requireUtc(preparedAt, "prepared_at")
  db.query(`
    INSERT INTO l2_epoch_compaction_job(
      job_id, epoch_id, source_manifest_hash, output_path, proposal_path,
      policy_version, batch_rows, job_json, prepared_at
    ) VALUES (
      $job_id, $epoch_id, $source_manifest_hash, $output_path, $proposal_path,
      $policy_version, $batch_rows, $job_json, $prepared_at
    )
  `).run({
    $job_id: job.job_id,
    $epoch_id: job.epoch_id,
    $source_manifest_hash: job.source_manifest_hash,
    $output_path: job.output_path,
    $proposal_path: job.proposal_path,
    $policy_version: job.policy_version,
    $batch_rows: job.batch_rows,
    $job_json: canonicalJson(job),
    $prepared_at: preparedAt,
  })
  return { commit_status: "created", job }
}

export function admitL2CompactionProposal(db: Database, input: {
  repository_root: string
  proposal_path: string
  admitted_at?: string
}): { commit_status: "created" | "existing"; compaction: AdmittedL2Compaction } {
  const root = realpathSync(resolve(input.repository_root))
  const proposalPath = resolveCompactionPath(root, input.proposal_path, "proposal_path")
  const proposalBytes = readRegularFile(realpathSync(proposalPath), "proposal")
  const proposal = parseProposal(proposalBytes)
  const proposalRef = normalizedRelative(root, proposalPath)
  const proposalHash = sha256(proposalBytes)
  const jobRow = db.query(`SELECT job_json FROM l2_epoch_compaction_job WHERE job_id = $job_id`)
    .get({ $job_id: proposal.job_id }) as { job_json: string } | null
  if (jobRow == null) throw new Error("L2 compaction proposal has no owner-issued job")
  const job = parseJob(Buffer.from(jobRow.job_json))
  assertProposalClosesJob(proposal, proposalRef, job)
  const epoch = readL2EpochManifest(db, proposal.epoch_id)
  if (epoch == null || epoch.manifest_hash !== proposal.source_manifest_hash || epoch.manifest.recorded_frames !== proposal.row_count) {
    throw new Error("L2 compaction proposal does not close admitted epoch evidence")
  }
  if (proposal.first_local_receive_time_ms < epoch.manifest.started_at_ms
    || proposal.last_local_receive_time_ms > epoch.manifest.finished_at_ms
    || proposal.last_final_update_id !== epoch.manifest.last_update_id) {
    throw new Error("L2 compaction proposal coverage differs from admitted epoch")
  }
  const parquetPath = resolveCompactionPath(root, proposal.parquet_path, "parquet_path")
  const parquetBytes = readRegularFile(realpathSync(parquetPath), "Parquet")
  if (parquetBytes.byteLength !== proposal.parquet_bytes || sha256(parquetBytes) !== proposal.parquet_hash) {
    throw new Error("L2 Parquet byte/hash evidence mismatch")
  }
  const admittedAt = input.admitted_at ?? new Date().toISOString()
  requireUtc(admittedAt, "admitted_at")
  const compactionId = `l2-compaction:${proposalHash}`
  let commitStatus: "created" | "existing" = "created"
  const commit = db.transaction(() => {
    const existing = db.query(`SELECT proposal_hash FROM l2_epoch_compaction WHERE job_id = $job_id`)
      .get({ $job_id: job.job_id }) as { proposal_hash: string } | null
    if (existing != null) {
      if (existing.proposal_hash !== proposalHash) throw new Error("L2 compaction already exists with different content")
      commitStatus = "existing"
    } else {
      db.query(`
        INSERT INTO l2_epoch_compaction(
          compaction_id, job_id, epoch_id, proposal_path, proposal_hash,
          parquet_path, parquet_hash, parquet_bytes, row_count, policy_version,
          proposal_json, admitted_at
        ) VALUES (
          $compaction_id, $job_id, $epoch_id, $proposal_path, $proposal_hash,
          $parquet_path, $parquet_hash, $parquet_bytes, $row_count, $policy_version,
          $proposal_json, $admitted_at
        )
      `).run({
        $compaction_id: compactionId,
        $job_id: job.job_id,
        $epoch_id: proposal.epoch_id,
        $proposal_path: proposalRef,
        $proposal_hash: proposalHash,
        $parquet_path: proposal.parquet_path,
        $parquet_hash: proposal.parquet_hash,
        $parquet_bytes: proposal.parquet_bytes,
        $row_count: proposal.row_count,
        $policy_version: proposal.policy_version,
        $proposal_json: proposalBytes.toString("utf8"),
        $admitted_at: admittedAt,
      })
      const retained = db.query(`
        UPDATE l2_epoch_retention
        SET retention_class = 'compacted_pinned', compaction_ref = $compaction_ref,
          deletion_eligible = 0, updated_at = $updated_at
        WHERE epoch_id = $epoch_id AND retention_class = 'raw_hot'
          AND compaction_ref IS NULL AND deletion_eligible = 0
      `).run({ $compaction_ref: compactionId, $updated_at: admittedAt, $epoch_id: proposal.epoch_id })
      if (retained.changes !== 1) throw new Error("L2 raw retention state is not eligible for compaction pinning")
    }
  })
  commit()
  const compaction = readL2Compaction(db, compactionId)
  if (compaction == null) throw new Error("admitted L2 compaction is unreadable")
  return { commit_status: commitStatus, compaction }
}

export function readL2Compaction(db: Database, compactionId: string): AdmittedL2Compaction | null {
  const row = db.query(`
    SELECT compaction_id, proposal_path, proposal_hash, proposal_json, admitted_at
    FROM l2_epoch_compaction WHERE compaction_id = $compaction_id
  `).get({ $compaction_id: compactionId }) as {
    compaction_id: string
    proposal_path: string
    proposal_hash: string
    proposal_json: string
    admitted_at: string
  } | null
  if (row == null) return null
  const bytes = Buffer.from(row.proposal_json)
  if (sha256(bytes) !== row.proposal_hash) throw new Error("stored L2 compaction proposal hash mismatch")
  return {
    compaction_id: row.compaction_id,
    proposal_path: row.proposal_path,
    proposal_hash: row.proposal_hash,
    admitted_at: row.admitted_at,
    proposal: parseProposal(bytes),
  }
}

function assertProposalClosesJob(proposal: L2CompactionProposal, proposalRef: string, job: L2CompactionJob): void {
  if (proposalRef !== job.proposal_path || proposal.job_id !== job.job_id || proposal.epoch_id !== job.epoch_id
    || proposal.symbol !== job.symbol || proposal.stream_epoch !== job.stream_epoch
    || proposal.source_manifest_path !== job.source_manifest_path || proposal.source_manifest_hash !== job.source_manifest_hash
    || proposal.policy_version !== job.policy_version || proposal.parquet_path !== job.output_path) {
    throw new Error("L2 compaction proposal differs from owner-issued job")
  }
}

function parseJob(bytes: Buffer): L2CompactionJob {
  const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>
  if (value.schema_version !== L2_COMPACTION_JOB_SCHEMA_VERSION || value.policy_version !== L2_COMPACTION_POLICY_VERSION) {
    throw new Error("unsupported L2 compaction job")
  }
  return {
    schema_version: L2_COMPACTION_JOB_SCHEMA_VERSION,
    job_id: requireString(value.job_id, "job_id"),
    epoch_id: requireString(value.epoch_id, "epoch_id"),
    symbol: requireString(value.symbol, "symbol"),
    stream_epoch: requireString(value.stream_epoch, "stream_epoch"),
    source_manifest_path: requireString(value.source_manifest_path, "source_manifest_path"),
    source_manifest_hash: requireHash(value.source_manifest_hash, "source_manifest_hash"),
    output_path: requireCompactionRef(value.output_path, "output_path"),
    proposal_path: requireCompactionRef(value.proposal_path, "proposal_path"),
    policy_version: L2_COMPACTION_POLICY_VERSION,
    batch_rows: requireSafeInteger(value.batch_rows, "batch_rows", 1, 10_000),
  }
}

function parseProposal(bytes: Buffer): L2CompactionProposal {
  const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>
  if (value.schema_version !== L2_COMPACTION_PROPOSAL_SCHEMA_VERSION || value.policy_version !== L2_COMPACTION_POLICY_VERSION) {
    throw new Error("unsupported L2 compaction proposal")
  }
  const firstReceive = requireSafeInteger(value.first_local_receive_time_ms, "first_local_receive_time_ms", 1)
  const lastReceive = requireSafeInteger(value.last_local_receive_time_ms, "last_local_receive_time_ms", firstReceive)
  const firstUpdate = requireSafeInteger(value.first_final_update_id, "first_final_update_id", 1)
  const lastUpdate = requireSafeInteger(value.last_final_update_id, "last_final_update_id", firstUpdate)
  return {
    schema_version: L2_COMPACTION_PROPOSAL_SCHEMA_VERSION,
    job_id: requireString(value.job_id, "job_id"),
    epoch_id: requireString(value.epoch_id, "epoch_id"),
    symbol: requireString(value.symbol, "symbol"),
    stream_epoch: requireString(value.stream_epoch, "stream_epoch"),
    source_manifest_path: requireString(value.source_manifest_path, "source_manifest_path"),
    source_manifest_hash: requireHash(value.source_manifest_hash, "source_manifest_hash"),
    policy_version: L2_COMPACTION_POLICY_VERSION,
    parquet_path: requireCompactionRef(value.parquet_path, "parquet_path"),
    parquet_hash: requireHash(value.parquet_hash, "parquet_hash"),
    parquet_bytes: requireSafeInteger(value.parquet_bytes, "parquet_bytes", 1),
    row_count: requireSafeInteger(value.row_count, "row_count", 1),
    first_local_receive_time_ms: firstReceive,
    last_local_receive_time_ms: lastReceive,
    first_final_update_id: firstUpdate,
    last_final_update_id: lastUpdate,
    created_at_ms: requireSafeInteger(value.created_at_ms, "created_at_ms", 1),
  }
}

function resolveCompactionPath(root: string, ref: string, field: string): string {
  requireCompactionRef(ref, field)
  const path = resolve(root, ref)
  const rel = normalizedRelative(root, path)
  if (rel === ".." || rel.startsWith("../") || rel.length === 0) throw new Error(`${field} escapes repository`)
  return path
}

function requireCompactionRef(value: unknown, field: string, allowBase = false): string {
  const text = requireString(value, field).replaceAll("\\", "/").replace(/\/$/, "")
  if (text.startsWith("/") || text.split("/").includes("..")) throw new Error(`${field} must be repository-relative`)
  const prefixes = ["data/l2-parquet", "tmp/l2-order-book-compactor"]
  if (!prefixes.some((prefix) => text.startsWith(`${prefix}/`) || (allowBase && text === prefix))) {
    throw new Error(`${field} is outside L2 compaction roots`)
  }
  return text
}

function readRegularFile(path: string, label: string): Buffer {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`L2 ${label} must be a regular non-symlink file`)
  return readFileSync(path)
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/")
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  return value
}

function requireHash(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return text
}

function requireSafeInteger(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be a safe integer between ${minimum} and ${maximum}`)
  }
  return value
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
