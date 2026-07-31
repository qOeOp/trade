import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { relative, resolve } from "node:path"
import { admitL2EpochManifest } from "./l2-epoch-manifest"

export interface L2AdmissionReconcileInput {
  repository_root: string
  scan_roots: string[]
  observed_at?: string
}

export interface L2AdmissionReconcileResult {
  schema_version: "trade.l2-admission-reconcile-result.v1"
  observed_at: string
  scanned_manifests: number
  created: number
  existing: number
  rejected_incomplete: number
  rejected_invalid: number
  unchanged: number
  unsafe_paths: number
  problems: Array<{ manifest_path: string; outcome: "rejected_incomplete" | "rejected_invalid"; reason: string }>
}

export function ensureL2AdmissionObservationSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS l2_epoch_admission_observation (
      manifest_path       TEXT NOT NULL,
      manifest_hash       TEXT NOT NULL,
      first_seen_at       TEXT NOT NULL,
      last_seen_at        TEXT NOT NULL,
      observation_count   INTEGER NOT NULL,
      outcome             TEXT NOT NULL,
      reason              TEXT NOT NULL,
      epoch_id            TEXT,
      PRIMARY KEY(manifest_path, manifest_hash)
    )
  `)
}

export function reconcileL2EpochManifests(db: Database, input: L2AdmissionReconcileInput): L2AdmissionReconcileResult {
  const root = realpathSync(resolve(input.repository_root))
  const observedAt = input.observed_at ?? new Date().toISOString()
  requireUtc(observedAt)
  if (input.scan_roots.length === 0) throw new Error("at least one L2 scan root is required")
  ensureL2AdmissionObservationSchema(db)
  const discovered = new Set<string>()
  let unsafePaths = 0
  for (const scanRoot of input.scan_roots) {
    const absolute = resolveScanRoot(root, scanRoot)
    if (!existsSync(absolute)) continue
    unsafePaths += collectManifests(root, absolute, discovered)
  }
  const result: L2AdmissionReconcileResult = {
    schema_version: "trade.l2-admission-reconcile-result.v1",
    observed_at: observedAt,
    scanned_manifests: discovered.size,
    created: 0,
    existing: 0,
    rejected_incomplete: 0,
    rejected_invalid: 0,
    unchanged: 0,
    unsafe_paths: unsafePaths,
    problems: [],
  }
  for (const manifestPath of [...discovered].sort()) reconcileOne(db, root, manifestPath, observedAt, result)
  return result
}

function reconcileOne(db: Database, root: string, manifestPath: string, observedAt: string, result: L2AdmissionReconcileResult): void {
  const bytes = readFileSync(manifestPath)
  const manifestHash = createHash("sha256").update(bytes).digest("hex")
  const manifestRef = relative(root, manifestPath).replaceAll("\\", "/")
  const previous = db.query(`
    SELECT outcome, epoch_id FROM l2_epoch_admission_observation
    WHERE manifest_path = $manifest_path AND manifest_hash = $manifest_hash
  `).get({ $manifest_path: manifestRef, $manifest_hash: manifestHash }) as { outcome: string; epoch_id: string | null } | null
  if (previous != null && observationStillCloses(db, previous)) {
    touchObservation(db, manifestRef, manifestHash, observedAt)
    result.unchanged += 1
    return
  }
  try {
    const admission = admitL2EpochManifest(db, {
      repository_root: root,
      manifest_path: manifestRef,
      admitted_at: observedAt,
    })
    recordObservation(db, manifestRef, manifestHash, observedAt, "admitted", admission.commit_status, admission.epoch.epoch_id)
    result[admission.commit_status] += 1
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const outcome = reason.includes("only complete L2 epochs") ? "rejected_incomplete" : "rejected_invalid"
    recordObservation(db, manifestRef, manifestHash, observedAt, outcome, reason, null)
    result[outcome] += 1
    if (result.problems.length < 100) result.problems.push({ manifest_path: manifestRef, outcome, reason })
  }
}

function observationStillCloses(db: Database, value: { outcome: string; epoch_id: string | null }): boolean {
  if (value.outcome !== "admitted") return true
  if (value.epoch_id == null) return false
  const row = db.query("SELECT 1 AS present FROM l2_epoch_manifest WHERE epoch_id = $epoch_id")
    .get({ $epoch_id: value.epoch_id }) as { present: number } | null
  return row?.present === 1
}

function recordObservation(
  db: Database,
  manifestPath: string,
  manifestHash: string,
  observedAt: string,
  outcome: "admitted" | "rejected_incomplete" | "rejected_invalid",
  reason: string,
  epochId: string | null,
): void {
  db.query(`
    INSERT INTO l2_epoch_admission_observation(
      manifest_path, manifest_hash, first_seen_at, last_seen_at,
      observation_count, outcome, reason, epoch_id
    ) VALUES (
      $manifest_path, $manifest_hash, $observed_at, $observed_at,
      1, $outcome, $reason, $epoch_id
    )
    ON CONFLICT(manifest_path, manifest_hash) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      observation_count = l2_epoch_admission_observation.observation_count + 1,
      outcome = excluded.outcome,
      reason = excluded.reason,
      epoch_id = excluded.epoch_id
  `).run({
    $manifest_path: manifestPath,
    $manifest_hash: manifestHash,
    $observed_at: observedAt,
    $outcome: outcome,
    $reason: reason,
    $epoch_id: epochId,
  })
}

function touchObservation(db: Database, manifestPath: string, manifestHash: string, observedAt: string): void {
  db.query(`
    UPDATE l2_epoch_admission_observation
    SET last_seen_at = $observed_at, observation_count = observation_count + 1
    WHERE manifest_path = $manifest_path AND manifest_hash = $manifest_hash
  `).run({ $observed_at: observedAt, $manifest_path: manifestPath, $manifest_hash: manifestHash })
}

function collectManifests(root: string, directory: string, output: Set<string>): number {
  let unsafePaths = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      unsafePaths += 1
      continue
    }
    ensureInside(root, realpathSync(path))
    if (stat.isDirectory()) unsafePaths += collectManifests(root, path, output)
    else if (stat.isFile() && /^epoch-\d+-manifest\.json$/.test(entry.name)) output.add(path)
  }
  return unsafePaths
}

function resolveScanRoot(root: string, ref: string): string {
  const normalized = ref.replaceAll("\\", "/").replace(/\/$/, "")
  if (!(normalized === "data/l2" || normalized.startsWith("data/l2/")
    || normalized.startsWith("tmp/l2-order-book-service/"))) {
    throw new Error("L2 scan roots must stay under data/l2/ or tmp/l2-order-book-service/")
  }
  const path = resolve(root, ref)
  ensureInside(root, path)
  return path
}

function ensureInside(root: string, path: string): void {
  const value = relative(root, path).replaceAll("\\", "/")
  if (value === ".." || value.startsWith("../") || value.length === 0) throw new Error("L2 scan path escapes repository")
}

function requireUtc(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("observed_at must be an RFC 3339 UTC timestamp")
  }
}
