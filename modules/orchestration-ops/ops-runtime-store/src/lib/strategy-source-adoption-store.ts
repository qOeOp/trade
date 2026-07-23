import type { Database } from "bun:sqlite"
import { canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"

export type StrategySourceAdoptionStatus =
  | "accepted"
  | "validating"
  | "candidate_certified"
  | "rejected"
  | "failed"

export type StrategySourceAdoptionFailureClass =
  | "validation_failed"
  | "quality_failed"
  | "replay_audit_failed"
  | "runtime_failed"

export interface StrategySourceAdoptionResult {
  schema_version: "trade.strategy-source-adoption-result.v1"
  adoption_id: string
  source_candidate_manifest_hash: string
  base_source_revision: string
  base_source_commit: string
  candidate_source_revision: string
  adopted_strategy_ref: string
  certified_manifest_ref: string
  certified_manifest_hash: string
  source_archive_ref: string
  source_archive_hash: string
  certified_at: string
  deployment_authority: "none"
  trading_authority: false
}

export interface StrategySourceAdoptionRecord {
  adoption_id: string
  source_candidate_manifest_ref: string
  source_candidate_manifest_hash: string
  source_revision: string
  strategy_source_ref: string
  strategy_source_hash: string
  status: StrategySourceAdoptionStatus
  attempt_count: number
  accepted_at: string
  updated_at: string
  result: StrategySourceAdoptionResult | null
  failure_class: StrategySourceAdoptionFailureClass | null
}

export function ensureStrategySourceAdoptionStoreSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_source_adoption (
      adoption_id TEXT PRIMARY KEY,
      source_candidate_manifest_ref TEXT NOT NULL UNIQUE,
      source_candidate_manifest_hash TEXT NOT NULL UNIQUE,
      source_revision TEXT NOT NULL,
      strategy_source_ref TEXT NOT NULL,
      strategy_source_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN (
        'accepted', 'validating', 'candidate_certified', 'rejected', 'failed'
      )),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      accepted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
      failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN (
        'validation_failed', 'quality_failed', 'replay_audit_failed',
        'runtime_failed'
      ))
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_source_adoption_status
      ON strategy_source_adoption(status, accepted_at, adoption_id);
    CREATE TRIGGER IF NOT EXISTS strategy_source_adoption_identity_no_update
    BEFORE UPDATE OF adoption_id, source_candidate_manifest_ref,
      source_candidate_manifest_hash, source_revision, strategy_source_ref,
      strategy_source_hash, accepted_at
    ON strategy_source_adoption
    BEGIN
      SELECT RAISE(ABORT, 'Strategy source adoption identity is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS strategy_source_adoption_no_delete
    BEFORE DELETE ON strategy_source_adoption
    BEGIN
      SELECT RAISE(ABORT, 'Strategy source adoption record is durable');
    END;
  `)
}

export function admitStrategySourceAdoption(
  db: Database,
  input: {
    adoption_id: string
    source_candidate_manifest_ref: string
    source_candidate_manifest_hash: string
    source_revision: string
    strategy_source_ref: string
    strategy_source_hash: string
    accepted_at: string
  },
): StrategySourceAdoptionRecord {
  ensureStrategySourceAdoptionStoreSchema(db)
  const candidate = {
    adoption_id: identifier(input.adoption_id, "adoption_id"),
    source_candidate_manifest_ref: repoPath(
      input.source_candidate_manifest_ref,
      "source_candidate_manifest_ref",
    ),
    source_candidate_manifest_hash: digest(
      input.source_candidate_manifest_hash,
      "source_candidate_manifest_hash",
    ),
    source_revision: revision(input.source_revision, "source_revision"),
    strategy_source_ref: strategyRef(input.strategy_source_ref),
    strategy_source_hash: digest(
      input.strategy_source_hash,
      "strategy_source_hash",
    ),
    accepted_at: canonicalTime(input.accepted_at, "accepted_at"),
  }
  const existing = readStrategySourceAdoption(db, candidate.adoption_id)
    ?? readByManifestHash(db, candidate.source_candidate_manifest_hash)
  if (existing) {
    const comparable = {
      adoption_id: existing.adoption_id,
      source_candidate_manifest_ref:
        existing.source_candidate_manifest_ref,
      source_candidate_manifest_hash:
        existing.source_candidate_manifest_hash,
      source_revision: existing.source_revision,
      strategy_source_ref: existing.strategy_source_ref,
      strategy_source_hash: existing.strategy_source_hash,
      accepted_at: existing.accepted_at,
    }
    if (canonicalJson(comparable) !== canonicalJson(candidate)) {
      throw new Error("Strategy source adoption identity drifted")
    }
    return existing
  }
  db.query(`
    INSERT INTO strategy_source_adoption(
      adoption_id, source_candidate_manifest_ref,
      source_candidate_manifest_hash, source_revision, strategy_source_ref,
      strategy_source_hash, status, accepted_at, updated_at
    ) VALUES (
      $adoption_id, $manifest_ref, $manifest_hash, $source_revision,
      $strategy_ref, $strategy_hash, 'accepted', $accepted_at, $accepted_at
    )
  `).run({
    $adoption_id: candidate.adoption_id,
    $manifest_ref: candidate.source_candidate_manifest_ref,
    $manifest_hash: candidate.source_candidate_manifest_hash,
    $source_revision: candidate.source_revision,
    $strategy_ref: candidate.strategy_source_ref,
    $strategy_hash: candidate.strategy_source_hash,
    $accepted_at: candidate.accepted_at,
  })
  return requireAdoption(db, candidate.adoption_id)
}

export function startStrategySourceAdoption(
  db: Database,
  adoptionIdValue: string,
  startedAtValue: string,
): StrategySourceAdoptionRecord {
  const adoptionId = identifier(adoptionIdValue, "adoption_id")
  const startedAt = canonicalTime(startedAtValue, "started_at")
  const current = requireAdoption(db, adoptionId)
  if (current.status === "candidate_certified") return current
  if (current.status === "rejected") {
    throw new Error("Rejected Strategy source adoption is terminal")
  }
  db.query(`
    UPDATE strategy_source_adoption
    SET status='validating', attempt_count=attempt_count + 1,
        failure_class=NULL, updated_at=$updated_at
    WHERE adoption_id=$adoption_id
  `).run({ $adoption_id: adoptionId, $updated_at: startedAt })
  return requireAdoption(db, adoptionId)
}

export function completeStrategySourceAdoption(
  db: Database,
  resultValue: StrategySourceAdoptionResult,
): StrategySourceAdoptionRecord {
  const result = resultContract(resultValue)
  const current = requireAdoption(db, result.adoption_id)
  if (current.result) {
    if (canonicalJson(current.result) !== canonicalJson(result)) {
      throw new Error("Strategy source adoption result drifted")
    }
    return current
  }
  if (current.source_candidate_manifest_hash
      !== result.source_candidate_manifest_hash) {
    throw new Error("Strategy source adoption result identity drifted")
  }
  const update = db.query(`
    UPDATE strategy_source_adoption
    SET status='candidate_certified', result_json=$result_json,
        failure_class=NULL, updated_at=$updated_at
    WHERE adoption_id=$adoption_id AND status='validating'
  `).run({
    $adoption_id: result.adoption_id,
    $result_json: canonicalJson(result),
    $updated_at: result.certified_at,
  })
  if (update.changes !== 1) {
    throw new Error("Strategy source adoption result was not committed")
  }
  return requireAdoption(db, result.adoption_id)
}

export function failStrategySourceAdoption(
  db: Database,
  input: {
    adoption_id: string
    status: "rejected" | "failed"
    failure_class: StrategySourceAdoptionFailureClass
    failed_at: string
  },
): StrategySourceAdoptionRecord {
  const adoptionId = identifier(input.adoption_id, "adoption_id")
  const current = requireAdoption(db, adoptionId)
  if (current.status === "candidate_certified"
      || current.status === "rejected") {
    return current
  }
  db.query(`
    UPDATE strategy_source_adoption
    SET status=$status, failure_class=$failure_class, updated_at=$updated_at
    WHERE adoption_id=$adoption_id
  `).run({
    $adoption_id: adoptionId,
    $status: input.status,
    $failure_class: failureClass(input.failure_class),
    $updated_at: canonicalTime(input.failed_at, "failed_at"),
  })
  return requireAdoption(db, adoptionId)
}

export function readStrategySourceAdoption(
  db: Database,
  adoptionIdValue: string,
): StrategySourceAdoptionRecord | undefined {
  ensureStrategySourceAdoptionStoreSchema(db)
  return readStrategySourceAdoptionReadonly(db, adoptionIdValue)
}

export function readStrategySourceAdoptionReadonly(
  db: Database,
  adoptionIdValue: string,
): StrategySourceAdoptionRecord | undefined {
  const row = db.query(`
    SELECT * FROM strategy_source_adoption WHERE adoption_id=$adoption_id
  `).get({
    $adoption_id: identifier(adoptionIdValue, "adoption_id"),
  }) as Record<string, unknown> | null
  return row ? projection(row) : undefined
}

export function listRecoverableStrategySourceAdoptions(
  db: Database,
  limitValue: number,
): StrategySourceAdoptionRecord[] {
  ensureStrategySourceAdoptionStoreSchema(db)
  if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 100) {
    throw new Error("Strategy source adoption recovery limit is invalid")
  }
  return (db.query(`
    SELECT * FROM strategy_source_adoption
    WHERE status IN ('accepted', 'validating', 'failed')
    ORDER BY accepted_at, adoption_id
    LIMIT $limit
  `).all({ $limit: limitValue }) as Array<Record<string, unknown>>)
    .map(projection)
}

export function listCertifiedStrategySourceAdoptions(
  db: Database,
  limitValue: number,
): StrategySourceAdoptionRecord[] {
  if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 1_000) {
    throw new Error("Strategy source adoption certified limit is invalid")
  }
  return (db.query(`
    SELECT * FROM strategy_source_adoption
    WHERE status='candidate_certified' AND result_json IS NOT NULL
    ORDER BY updated_at, adoption_id
    LIMIT $limit
  `).all({ $limit: limitValue }) as Array<Record<string, unknown>>)
    .map(projection)
}

function readByManifestHash(
  db: Database,
  manifestHash: string,
): StrategySourceAdoptionRecord | undefined {
  const row = db.query(`
    SELECT * FROM strategy_source_adoption
    WHERE source_candidate_manifest_hash=$manifest_hash
  `).get({ $manifest_hash: manifestHash }) as Record<string, unknown> | null
  return row ? projection(row) : undefined
}

function requireAdoption(
  db: Database,
  adoptionId: string,
): StrategySourceAdoptionRecord {
  const value = readStrategySourceAdoption(db, adoptionId)
  if (!value) throw new Error("Strategy source adoption is missing")
  return value
}

function projection(
  row: Record<string, unknown>,
): StrategySourceAdoptionRecord {
  return {
    adoption_id: identifier(String(row.adoption_id), "adoption_id"),
    source_candidate_manifest_ref: repoPath(
      String(row.source_candidate_manifest_ref),
      "source_candidate_manifest_ref",
    ),
    source_candidate_manifest_hash: digest(
      String(row.source_candidate_manifest_hash),
      "source_candidate_manifest_hash",
    ),
    source_revision: revision(String(row.source_revision), "source_revision"),
    strategy_source_ref: strategyRef(String(row.strategy_source_ref)),
    strategy_source_hash: digest(
      String(row.strategy_source_hash),
      "strategy_source_hash",
    ),
    status: status(String(row.status)),
    attempt_count: Number(row.attempt_count),
    accepted_at: canonicalTime(String(row.accepted_at), "accepted_at"),
    updated_at: canonicalTime(String(row.updated_at), "updated_at"),
    result: row.result_json == null
      ? null
      : resultContract(JSON.parse(String(row.result_json))),
    failure_class: row.failure_class == null
      ? null
      : failureClass(String(row.failure_class)),
  }
}

function resultContract(value: StrategySourceAdoptionResult): StrategySourceAdoptionResult {
  if (!value
      || value.schema_version !== "trade.strategy-source-adoption-result.v1"
      || value.deployment_authority !== "none"
      || value.trading_authority !== false) {
    throw new Error("Strategy source adoption result is unsupported")
  }
  return {
    schema_version: "trade.strategy-source-adoption-result.v1",
    adoption_id: identifier(value.adoption_id, "adoption_id"),
    source_candidate_manifest_hash: digest(
      value.source_candidate_manifest_hash,
      "source_candidate_manifest_hash",
    ),
    base_source_revision: revision(
      value.base_source_revision,
      "base_source_revision",
    ),
    base_source_commit: commit(value.base_source_commit, "base_source_commit"),
    candidate_source_revision: commit(
      value.candidate_source_revision,
      "candidate_source_revision",
    ),
    adopted_strategy_ref: strategyRef(value.adopted_strategy_ref),
    certified_manifest_ref: repoPath(
      value.certified_manifest_ref,
      "certified_manifest_ref",
    ),
    certified_manifest_hash: digest(
      value.certified_manifest_hash,
      "certified_manifest_hash",
    ),
    source_archive_ref: repoPath(
      value.source_archive_ref,
      "source_archive_ref",
    ),
    source_archive_hash: digest(
      value.source_archive_hash,
      "source_archive_hash",
    ),
    certified_at: canonicalTime(value.certified_at, "certified_at"),
    deployment_authority: "none",
    trading_authority: false,
  }
}

function status(value: string): StrategySourceAdoptionStatus {
  if (!["accepted", "validating", "candidate_certified", "rejected", "failed"]
    .includes(value)) {
    throw new Error("Strategy source adoption status is invalid")
  }
  return value as StrategySourceAdoptionStatus
}

function failureClass(value: string): StrategySourceAdoptionFailureClass {
  if (!["validation_failed", "quality_failed", "replay_audit_failed", "runtime_failed"]
    .includes(value)) {
    throw new Error("Strategy source adoption failure class is invalid")
  }
  return value as StrategySourceAdoptionFailureClass
}

function identifier(value: unknown, field: string): string {
  const text = required(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function repoPath(value: unknown, field: string): string {
  const text = required(value, field)
  if (text.startsWith("/") || text.includes("\0")
      || text.split("/").includes("..")) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function strategyRef(value: unknown): string {
  const text = repoPath(value, "strategy_source_ref")
  if (!/^strategies\/[a-z0-9][a-z0-9-]{0,127}\.md$/.test(text)) {
    throw new Error("strategy_source_ref is invalid")
  }
  return text
}

function revision(value: unknown, field: string): string {
  const text = required(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function commit(value: unknown, field: string): string {
  const text = required(value, field)
  if (!/^[a-f0-9]{40,64}$/.test(text)) throw new Error(`${field} is invalid`)
  return text
}

function digest(value: unknown, field: string): string {
  const text = required(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${field} is invalid`)
  return text
}

function canonicalTime(value: unknown, field: string): string {
  const text = required(value, field)
  const date = new Date(text)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return text
}

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value
}
