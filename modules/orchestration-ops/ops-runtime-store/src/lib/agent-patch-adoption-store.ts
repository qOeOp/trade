import type { Database } from "bun:sqlite"
import type { AgentArtifactRef } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"

export type AgentPatchAdoptionStatus =
  | "accepted"
  | "validating"
  | "candidate_certified"
  | "rejected"
  | "failed"

export type AgentPatchAdoptionFailureClass =
  | "validation_failed"
  | "quality_failed"
  | "replay_audit_failed"
  | "runtime_failed"

export interface AgentPatchAdoptionResultProjection {
  schema_version: "trade.agent-patch-adoption-result.v1"
  adoption_id: string
  run_id: string
  request_hash: string
  scope_hash: string
  patch_sha256: string
  base_source_revision: string
  candidate_source_revision: string
  manifest_ref: string
  manifest_sha256: string
  certified_at: string
  deployment_authority: "none"
}

export interface AgentPatchAdoptionRecord {
  adoption_id: string
  run_id: string
  request_hash: string
  scope_hash: string
  patch: AgentArtifactRef
  status: AgentPatchAdoptionStatus
  attempt_count: number
  accepted_at: string
  updated_at: string
  result: AgentPatchAdoptionResultProjection | null
  failure_class: AgentPatchAdoptionFailureClass | null
}

export function ensureAgentPatchAdoptionStoreSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_patch_adoption (
      adoption_id   TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL UNIQUE,
      request_hash  TEXT NOT NULL,
      scope_hash    TEXT NOT NULL,
      patch_json    TEXT NOT NULL CHECK(json_valid(patch_json)),
      status        TEXT NOT NULL CHECK(status IN (
        'accepted', 'validating', 'candidate_certified', 'rejected', 'failed'
      )),
      active_slot   INTEGER UNIQUE CHECK(active_slot IS NULL OR active_slot=1),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      accepted_at   TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      result_json   TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
      failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN (
        'validation_failed', 'quality_failed', 'replay_audit_failed', 'runtime_failed'
      )),
      FOREIGN KEY(run_id) REFERENCES agent_run(run_id)
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_patch_adoption_status
    ON agent_patch_adoption(status, updated_at, adoption_id)
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_patch_adoption_identity_update
    BEFORE UPDATE OF adoption_id, run_id, request_hash, scope_hash, patch_json, accepted_at
    ON agent_patch_adoption
    BEGIN SELECT RAISE(ABORT, 'Agent patch adoption identity is immutable'); END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_agent_patch_adoption_delete
    BEFORE DELETE ON agent_patch_adoption
    BEGIN SELECT RAISE(ABORT, 'Agent patch adoption record is durable'); END
  `)
}

export function admitAgentPatchAdoption(db: Database, input: {
  adoption_id: string
  run_id: string
  request_hash: string
  scope_hash: string
  patch: AgentArtifactRef
  accepted_at: string
}): AgentPatchAdoptionRecord {
  const candidate = {
    adoption_id: identifier(input.adoption_id, "adoption_id"),
    run_id: identifier(input.run_id, "run_id"),
    request_hash: digest(input.request_hash, "request_hash"),
    scope_hash: digest(input.scope_hash, "scope_hash"),
    patch: patchArtifact(input.patch),
    accepted_at: canonicalTime(input.accepted_at, "accepted_at"),
  }
  const existing = readAgentPatchAdoption(db, candidate.adoption_id)
    ?? readByRun(db, candidate.run_id)
  if (existing) {
    if (existing.adoption_id !== candidate.adoption_id
      || existing.run_id !== candidate.run_id
      || existing.request_hash !== candidate.request_hash
      || existing.scope_hash !== candidate.scope_hash
      || existing.accepted_at !== candidate.accepted_at
      || canonicalJson(existing.patch) !== canonicalJson(candidate.patch)) {
      throw new Error("Agent patch adoption identity drifted")
    }
    return existing
  }
  db.query(`
    INSERT INTO agent_patch_adoption(
      adoption_id, run_id, request_hash, scope_hash, patch_json,
      status, active_slot, accepted_at, updated_at
    ) VALUES (
      $adoption_id, $run_id, $request_hash, $scope_hash, $patch_json,
      'accepted', NULL, $accepted_at, $accepted_at
    )
  `).run({
    $adoption_id: candidate.adoption_id,
    $run_id: candidate.run_id,
    $request_hash: candidate.request_hash,
    $scope_hash: candidate.scope_hash,
    $patch_json: canonicalJson(candidate.patch),
    $accepted_at: candidate.accepted_at,
  })
  return requireAdoption(db, candidate.adoption_id)
}

export function startAgentPatchAdoption(
  db: Database,
  adoptionIdValue: string,
  startedAtValue: string,
): AgentPatchAdoptionRecord {
  const adoptionId = identifier(adoptionIdValue, "adoption_id")
  const startedAt = canonicalTime(startedAtValue, "started_at")
  const current = requireAdoption(db, adoptionId)
  if (terminal(current.status)) return current
  db.query(`
    UPDATE agent_patch_adoption
    SET status='validating',
        active_slot=1,
        attempt_count=attempt_count + 1,
        updated_at=$updated_at,
        failure_class=NULL
    WHERE adoption_id=$adoption_id
      AND status IN ('accepted', 'validating')
  `).run({ $adoption_id: adoptionId, $updated_at: startedAt })
  return requireAdoption(db, adoptionId)
}

export function completeAgentPatchAdoption(
  db: Database,
  resultValue: AgentPatchAdoptionResultProjection,
): AgentPatchAdoptionRecord {
  const result = adoptionResult(resultValue)
  const current = requireAdoption(db, result.adoption_id)
  if (current.result) {
    if (canonicalJson(current.result) !== canonicalJson(result)) {
      throw new Error("Agent patch adoption result drifted")
    }
    return current
  }
  if (current.status !== "validating"
    || current.run_id !== result.run_id
    || current.request_hash !== result.request_hash
    || current.scope_hash !== result.scope_hash
    || current.patch.sha256 !== result.patch_sha256) {
    throw new Error("Agent patch adoption result identity drifted")
  }
  const updated = db.query(`
    UPDATE agent_patch_adoption
    SET status='candidate_certified',
        active_slot=NULL,
        updated_at=$updated_at,
        result_json=$result_json,
        failure_class=NULL
    WHERE adoption_id=$adoption_id
      AND status='validating'
      AND result_json IS NULL
  `).run({
    $adoption_id: result.adoption_id,
    $updated_at: result.certified_at,
    $result_json: canonicalJson(result),
  })
  if (updated.changes !== 1) {
    throw new Error("Agent patch adoption result was not committed")
  }
  return requireAdoption(db, result.adoption_id)
}

export function failAgentPatchAdoption(db: Database, input: {
  adoption_id: string
  status: "rejected" | "failed"
  failure_class: AgentPatchAdoptionFailureClass
  failed_at: string
}): AgentPatchAdoptionRecord {
  const adoptionId = identifier(input.adoption_id, "adoption_id")
  const failedAt = canonicalTime(input.failed_at, "failed_at")
  const current = requireAdoption(db, adoptionId)
  if (terminal(current.status)) return current
  db.query(`
    UPDATE agent_patch_adoption
    SET status=$status,
        active_slot=NULL,
        updated_at=$updated_at,
        failure_class=$failure_class
    WHERE adoption_id=$adoption_id
      AND status IN ('accepted', 'validating')
      AND result_json IS NULL
  `).run({
    $adoption_id: adoptionId,
    $status: input.status,
    $updated_at: failedAt,
    $failure_class: failureClass(input.failure_class),
  })
  return requireAdoption(db, adoptionId)
}

export function readAgentPatchAdoption(
  db: Database,
  adoptionIdValue: string,
): AgentPatchAdoptionRecord | null {
  const adoptionId = identifier(adoptionIdValue, "adoption_id")
  const row = db.query(`
    SELECT * FROM agent_patch_adoption WHERE adoption_id=$adoption_id
  `).get({ $adoption_id: adoptionId }) as Record<string, unknown> | null
  return row ? decode(row) : null
}

export function listRecoverableAgentPatchAdoptions(
  db: Database,
  limit = 100,
): AgentPatchAdoptionRecord[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Agent patch adoption recovery limit is invalid")
  }
  return (db.query(`
    SELECT * FROM agent_patch_adoption
    WHERE status IN ('accepted', 'validating')
    ORDER BY CASE status WHEN 'validating' THEN 0 ELSE 1 END,
             accepted_at ASC, adoption_id ASC
    LIMIT $limit
  `).all({ $limit: limit }) as Array<Record<string, unknown>>).map(decode)
}

function readByRun(db: Database, runId: string): AgentPatchAdoptionRecord | null {
  const row = db.query(`
    SELECT * FROM agent_patch_adoption WHERE run_id=$run_id
  `).get({ $run_id: runId }) as Record<string, unknown> | null
  return row ? decode(row) : null
}

function requireAdoption(
  db: Database,
  adoptionId: string,
): AgentPatchAdoptionRecord {
  const value = readAgentPatchAdoption(db, adoptionId)
  if (!value) throw new Error("Agent patch adoption is missing")
  return value
}

function decode(row: Record<string, unknown>): AgentPatchAdoptionRecord {
  return {
    adoption_id: identifier(String(row.adoption_id), "adoption_id"),
    run_id: identifier(String(row.run_id), "run_id"),
    request_hash: digest(String(row.request_hash), "request_hash"),
    scope_hash: digest(String(row.scope_hash), "scope_hash"),
    patch: patchArtifact(JSON.parse(String(row.patch_json)) as AgentArtifactRef),
    status: adoptionStatus(String(row.status)),
    attempt_count: integer(row.attempt_count, "attempt_count"),
    accepted_at: canonicalTime(String(row.accepted_at), "accepted_at"),
    updated_at: canonicalTime(String(row.updated_at), "updated_at"),
    result: row.result_json == null
      ? null
      : adoptionResult(
          JSON.parse(String(row.result_json)) as AgentPatchAdoptionResultProjection,
        ),
    failure_class: row.failure_class == null
      ? null
      : failureClass(String(row.failure_class)),
  }
}

function adoptionResult(
  value: AgentPatchAdoptionResultProjection,
): AgentPatchAdoptionResultProjection {
  if (!value || value.schema_version !== "trade.agent-patch-adoption-result.v1"
    || value.deployment_authority !== "none") {
    throw new Error("Agent patch adoption result is unsupported")
  }
  return {
    schema_version: "trade.agent-patch-adoption-result.v1",
    adoption_id: identifier(value.adoption_id, "adoption_id"),
    run_id: identifier(value.run_id, "run_id"),
    request_hash: digest(value.request_hash, "request_hash"),
    scope_hash: digest(value.scope_hash, "scope_hash"),
    patch_sha256: digest(value.patch_sha256, "patch_sha256"),
    base_source_revision: revision(
      value.base_source_revision,
      "base_source_revision",
    ),
    candidate_source_revision: commit(
      value.candidate_source_revision,
      "candidate_source_revision",
    ),
    manifest_ref: repoPath(value.manifest_ref, "manifest_ref"),
    manifest_sha256: digest(value.manifest_sha256, "manifest_sha256"),
    certified_at: canonicalTime(value.certified_at, "certified_at"),
    deployment_authority: "none",
  }
}

function patchArtifact(value: AgentArtifactRef): AgentArtifactRef {
  if (!value || value.media_type !== "text/x-diff") {
    throw new Error("Agent patch adoption patch is invalid")
  }
  return {
    ref: artifactRef(value.ref),
    sha256: digest(value.sha256, "patch.sha256"),
    media_type: "text/x-diff",
    bytes: integer(value.bytes, "patch.bytes"),
  }
}

function artifactRef(value: string): string {
  const text = required(value, "patch.ref")
  if (text.startsWith("/") || text.split("/").includes("..")) {
    throw new Error("patch.ref is invalid")
  }
  return text
}

function adoptionStatus(value: string): AgentPatchAdoptionStatus {
  if (!["accepted", "validating", "candidate_certified", "rejected", "failed"]
    .includes(value)) {
    throw new Error("Agent patch adoption status is invalid")
  }
  return value as AgentPatchAdoptionStatus
}

function failureClass(value: string): AgentPatchAdoptionFailureClass {
  if (!["validation_failed", "quality_failed", "replay_audit_failed", "runtime_failed"]
    .includes(value)) {
    throw new Error("Agent patch adoption failure class is invalid")
  }
  return value as AgentPatchAdoptionFailureClass
}

function terminal(value: AgentPatchAdoptionStatus): boolean {
  return ["candidate_certified", "rejected", "failed"].includes(value)
}

function identifier(value: string, field: string): string {
  const text = required(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function revision(value: string, field: string): string {
  const text = required(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function commit(value: string, field: string): string {
  const text = required(value, field)
  if (!/^[a-f0-9]{40,64}$/.test(text)) throw new Error(`${field} is invalid`)
  return text
}

function digest(value: string, field: string): string {
  const text = required(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${field} is invalid`)
  return text
}

function repoPath(value: string, field: string): string {
  const text = required(value, field).replaceAll("\\", "/")
  if (text.startsWith("/") || text.split("/").includes("..")) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function canonicalTime(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function integer(value: unknown, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0 || number > 32 * 1024 * 1024) {
    throw new Error(`${field} is invalid`)
  }
  return number
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value
    || value.includes("\0")) {
    throw new Error(`${field} is required`)
  }
  return value
}
