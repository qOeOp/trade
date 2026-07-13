import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export interface PolicySnapshot {
  policy_hash: string
  source_hash: string
  profile?: string
  snapshot_json: JSONRecord
  created_at: string
}

export interface ApprovedStrategyRef {
  strategy_ref: string
  strategy_id: string
  policy_hash: string
  status: string
  source_path: string
  source_hash: string
  approved_at?: string
  updated_at: string
}

export function ensurePolicyRegistrySchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS policy_snapshot (
      policy_hash   TEXT PRIMARY KEY,
      source_hash   TEXT NOT NULL,
      profile       TEXT,
      snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
      created_at    TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS approved_strategy_ref (
      strategy_ref  TEXT PRIMARY KEY,
      strategy_id   TEXT NOT NULL,
      policy_hash   TEXT NOT NULL,
      status        TEXT NOT NULL,
      source_path   TEXT NOT NULL,
      source_hash   TEXT NOT NULL,
      approved_at   TEXT,
      updated_at    TEXT NOT NULL,
      FOREIGN KEY (policy_hash) REFERENCES policy_snapshot(policy_hash)
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_approved_strategy_status ON approved_strategy_ref(status, updated_at DESC)")
}

export function recordPolicySnapshot(db: Database, snapshot: PolicySnapshot): void {
  validatePolicySnapshot(snapshot)
  db.query(`
    INSERT INTO policy_snapshot(policy_hash, source_hash, profile, snapshot_json, created_at)
    VALUES ($policy_hash, $source_hash, $profile, $snapshot_json, $created_at)
    ON CONFLICT(policy_hash) DO NOTHING
  `).run({
    $policy_hash: snapshot.policy_hash,
    $source_hash: snapshot.source_hash,
    $profile: snapshot.profile ?? null,
    $snapshot_json: JSON.stringify(snapshot.snapshot_json),
    $created_at: snapshot.created_at,
  })
}

export function upsertApprovedStrategyRef(db: Database, ref: ApprovedStrategyRef): void {
  validateApprovedStrategyRef(ref)
  db.query(`
    INSERT INTO approved_strategy_ref(
      strategy_ref, strategy_id, policy_hash, status, source_path, source_hash, approved_at, updated_at
    )
    VALUES (
      $strategy_ref, $strategy_id, $policy_hash, $status, $source_path, $source_hash, $approved_at, $updated_at
    )
    ON CONFLICT(strategy_ref) DO UPDATE SET
      strategy_id = excluded.strategy_id,
      policy_hash = excluded.policy_hash,
      status = excluded.status,
      source_path = excluded.source_path,
      source_hash = excluded.source_hash,
      approved_at = excluded.approved_at,
      updated_at = excluded.updated_at
  `).run({
    $strategy_ref: ref.strategy_ref,
    $strategy_id: ref.strategy_id,
    $policy_hash: ref.policy_hash,
    $status: ref.status,
    $source_path: ref.source_path,
    $source_hash: ref.source_hash,
    $approved_at: ref.approved_at ?? null,
    $updated_at: ref.updated_at,
  })
}

export function readPolicySnapshot(db: Database, policyHash: string): PolicySnapshot | null {
  const row = db.query(`
    SELECT policy_hash, source_hash, profile, snapshot_json, created_at
    FROM policy_snapshot
    WHERE policy_hash = $policy_hash
  `).get({ $policy_hash: policyHash }) as PolicySnapshotRow | null
  return row ? policySnapshotFromRow(row) : null
}

export function listApprovedStrategyRefs(db: Database, status = "live-small"): ApprovedStrategyRef[] {
  const rows = db.query(`
    SELECT strategy_ref, strategy_id, policy_hash, status, source_path, source_hash, approved_at, updated_at
    FROM approved_strategy_ref
    WHERE status = $status
    ORDER BY updated_at DESC, strategy_ref
  `).all({ $status: status }) as ApprovedStrategyRefRow[]
  return rows.map(approvedStrategyRefFromRow)
}

export function buildPolicySnapshot(input: JSONRecord): PolicySnapshot {
  const now = stringField(input.created_at) || stringField(input.now) || new Date().toISOString()
  return {
    policy_hash: stringField(input.policy_hash),
    source_hash: stringField(input.source_hash),
    profile: stringField(input.profile) || undefined,
    snapshot_json: asRecord(input.snapshot_json ?? input.snapshot),
    created_at: now,
  }
}

export function buildApprovedStrategyRef(input: JSONRecord): ApprovedStrategyRef {
  const now = stringField(input.updated_at) || stringField(input.now) || new Date().toISOString()
  return {
    strategy_ref: stringField(input.strategy_ref),
    strategy_id: stringField(input.strategy_id),
    policy_hash: stringField(input.policy_hash),
    status: stringField(input.status),
    source_path: stringField(input.source_path),
    source_hash: stringField(input.source_hash),
    approved_at: stringField(input.approved_at) || undefined,
    updated_at: now,
  }
}

function validatePolicySnapshot(snapshot: PolicySnapshot): void {
  if (!snapshot.policy_hash || !snapshot.source_hash || !snapshot.created_at) {
    throw new Error("policy_hash, source_hash, and created_at are required")
  }
  if (Object.keys(snapshot.snapshot_json).length === 0) {
    throw new Error("snapshot_json is required")
  }
}

function validateApprovedStrategyRef(ref: ApprovedStrategyRef): void {
  if (!ref.strategy_ref || !ref.strategy_id || !ref.policy_hash || !ref.status || !ref.source_path || !ref.source_hash || !ref.updated_at) {
    throw new Error("strategy_ref, strategy_id, policy_hash, status, source_path, source_hash, and updated_at are required")
  }
}

interface PolicySnapshotRow {
  policy_hash: string
  source_hash: string
  profile: string | null
  snapshot_json: string
  created_at: string
}

interface ApprovedStrategyRefRow {
  strategy_ref: string
  strategy_id: string
  policy_hash: string
  status: string
  source_path: string
  source_hash: string
  approved_at: string | null
  updated_at: string
}

function policySnapshotFromRow(row: PolicySnapshotRow): PolicySnapshot {
  return {
    policy_hash: row.policy_hash,
    source_hash: row.source_hash,
    profile: row.profile ?? undefined,
    snapshot_json: JSON.parse(row.snapshot_json) as JSONRecord,
    created_at: row.created_at,
  }
}

function approvedStrategyRefFromRow(row: ApprovedStrategyRefRow): ApprovedStrategyRef {
  return {
    strategy_ref: row.strategy_ref,
    strategy_id: row.strategy_id,
    policy_hash: row.policy_hash,
    status: row.status,
    source_path: row.source_path,
    source_hash: row.source_hash,
    approved_at: row.approved_at ?? undefined,
    updated_at: row.updated_at,
  }
}
