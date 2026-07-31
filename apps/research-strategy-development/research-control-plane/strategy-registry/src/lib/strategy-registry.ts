import { createHash } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  STRATEGY_DRAFT_BINDING_SCHEMA_VERSION,
  assertDraftStrategyAuthorization,
  type DraftStrategyAuthorization,
  type StrategyDraftBinding,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  lintStrategyPolicyShape,
  renderStrategyPolicyMarkdown,
  strategyIDFromSlug,
  strategyPolicySlug,
  type StrategyPolicySource,
} from "../../../strategy-policy-writer/src/lib/strategy-policy-writer"

export interface MaterializeDraftStrategyInput {
  draft_id: string
  strategy_version: string
  idempotency_key: string
  strategy_root: string
  created_at: string
  authorization: DraftStrategyAuthorization
  policy_source: StrategyPolicySource
}

interface DraftRow {
  draft_id: string
  strategy_id: string
  strategy_version: string
  strategy_ref: string | null
  strategy_policy_hash: string | null
  materialization_status: "pending" | "ready" | "failed"
  authorization_json: string
  policy_source_json: string
  idempotency_key: string
  error_message: string | null
  created_at: string
}

export function ensureStrategyRegistrySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_strategy_draft (
      draft_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      strategy_ref TEXT,
      strategy_policy_hash TEXT,
      materialization_status TEXT NOT NULL CHECK(materialization_status IN ('pending', 'ready', 'failed')),
      authorization_json TEXT NOT NULL,
      policy_source_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(strategy_id, strategy_version)
    );
  `)
}

export function materializeDraftStrategy(db: Database, input: MaterializeDraftStrategyInput): StrategyDraftBinding {
  ensureStrategyRegistrySchema(db)
  assertInput(input)
  const markdown = renderStrategyPolicyMarkdown(input.policy_source)
  const lint = lintStrategyPolicyShape(markdown)
  if (!lint.valid) throw new Error(`strategy policy shape failed: ${lint.errors.join("; ")}`)
  const slug = strategyPolicySlug(input.policy_source.candidate.candidate_id)
  const strategyId = strategyIDFromSlug(slug)
  const strategyRef = join(input.strategy_root, `${slug}.md`)
  const policyHash = sha256(markdown)
  const prior = reserveDraft(
    db,
    input,
    strategyId,
  )
  assertPriorIdentity(prior, input, strategyId)
  if (prior.materialization_status === "ready") {
    assertReadySource(prior, strategyRef, policyHash, markdown)
    return readyBinding(prior)
  }

  try {
    commitStrategySource(
      input.strategy_root,
      strategyRef,
      markdown,
      input.idempotency_key,
    )
    db.query(`
      UPDATE rd_strategy_draft
      SET strategy_ref=$strategy_ref, strategy_policy_hash=$hash,
          materialization_status='ready', error_message=NULL, updated_at=$updated_at
      WHERE draft_id=$draft_id AND materialization_status!='ready'
    `).run({
      $strategy_ref: strategyRef,
      $hash: policyHash,
      $updated_at: input.created_at,
      $draft_id: input.draft_id,
    })
  } catch (error) {
    db.query(`
      UPDATE rd_strategy_draft
      SET materialization_status='failed', error_message=$error, updated_at=$updated_at
      WHERE draft_id=$draft_id AND materialization_status!='ready'
    `).run({
      $error: error instanceof Error ? error.message : String(error),
      $updated_at: input.created_at,
      $draft_id: input.draft_id,
    })
    throw error
  }
  const ready = readByIdempotency(db, input.idempotency_key)
  if (!ready || ready.materialization_status !== "ready") throw new Error("Draft Strategy registry commit failed")
  return readyBinding(ready)
}

export function readReadyDraftStrategy(db: Database, draftId: string): StrategyDraftBinding | undefined {
  ensureStrategyRegistrySchema(db)
  const row = db.query(`SELECT * FROM rd_strategy_draft WHERE draft_id=$draft_id`).get({ $draft_id: draftId }) as DraftRow | null
  return row?.materialization_status === "ready" ? readyBinding(row) : undefined
}

function reserveDraft(
  db: Database,
  input: MaterializeDraftStrategyInput,
  strategyId: string,
): DraftRow {
  return db.transaction(() => {
    const prior = readByIdempotency(db, input.idempotency_key)
    if (prior) return prior
    const inserted = db.query(`
      INSERT INTO rd_strategy_draft(
        draft_id, strategy_id, strategy_version, strategy_ref, strategy_policy_hash,
        materialization_status, authorization_json, policy_source_json,
        idempotency_key, error_message, created_at, updated_at
      ) VALUES (
        $draft_id, $strategy_id, $version, NULL, NULL,
        'pending', $authorization, $source, $idempotency_key, NULL, $created_at, $created_at
      )
      ON CONFLICT DO NOTHING
    `).run({
      $draft_id: input.draft_id,
      $strategy_id: strategyId,
      $version: input.strategy_version,
      $authorization: canonicalJson(input.authorization),
      $source: canonicalJson(input.policy_source),
      $idempotency_key: input.idempotency_key,
      $created_at: input.created_at,
    })
    if (inserted.changes !== 1) {
      const raced = readByIdempotency(db, input.idempotency_key)
      if (raced) return raced
      throw new Error("Draft Strategy identity collides with another Registry record")
    }
    const reserved = readByIdempotency(db, input.idempotency_key)
    if (!reserved) throw new Error("Draft Strategy reservation disappeared")
    return reserved
  }).immediate()
}

function assertPriorIdentity(
  prior: DraftRow,
  input: MaterializeDraftStrategyInput,
  strategyId: string,
): void {
  if (prior.draft_id !== input.draft_id || prior.strategy_id !== strategyId
      || prior.strategy_version !== input.strategy_version
      || canonicalJson(JSON.parse(prior.authorization_json)) !== canonicalJson(input.authorization)
      || canonicalJson(JSON.parse(prior.policy_source_json)) !== canonicalJson(input.policy_source)) {
    throw new Error("Draft Strategy idempotency key was reused with different authority or identity")
  }
}

function assertReadySource(
  prior: DraftRow,
  strategyRef: string,
  policyHash: string,
  markdown: string,
): void {
  if (prior.strategy_ref !== strategyRef || prior.strategy_policy_hash !== policyHash) {
    throw new Error("Draft Strategy source changed after materialization")
  }
  assertExactRegularFile(strategyRef, markdown)
}

function commitStrategySource(
  strategyRoot: string,
  strategyRef: string,
  markdown: string,
  idempotencyKey: string,
): void {
  mkdirSync(strategyRoot, { recursive: true, mode: 0o700 })
  const rootStat = lstatSync(strategyRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Draft Strategy root is not a regular directory")
  }
  if (existsSync(strategyRef)) {
    assertExactRegularFile(strategyRef, markdown)
    return
  }
  const temporary = `${strategyRef}.${sha256(idempotencyKey).slice(0, 12)}.tmp`
  if (existsSync(temporary)) {
    assertExactRegularFile(temporary, markdown)
  } else {
    writeFileSync(temporary, markdown, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
  }
  fsyncFile(temporary)
  try {
    linkSync(temporary, strategyRef)
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error
    assertExactRegularFile(strategyRef, markdown)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  fsyncDirectory(strategyRoot)
  assertExactRegularFile(strategyRef, markdown)
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "EEXIST"
}

function assertExactRegularFile(path: string, expected: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Draft Strategy source is not a regular file")
  }
  if (readFileSync(path, "utf8") !== expected) {
    throw new Error("Draft Strategy source content drifted")
  }
}

function fsyncFile(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function readyBinding(row: DraftRow): StrategyDraftBinding {
  if (!row.strategy_ref || !row.strategy_policy_hash || row.materialization_status !== "ready") {
    throw new Error("Draft Strategy is not ready")
  }
  return {
    schema_version: STRATEGY_DRAFT_BINDING_SCHEMA_VERSION,
    draft_id: row.draft_id,
    strategy_id: row.strategy_id,
    strategy_version: row.strategy_version,
    strategy_ref: row.strategy_ref,
    strategy_policy_hash: row.strategy_policy_hash,
    materialization_status: "ready",
    created_at: row.created_at,
    authorization: JSON.parse(row.authorization_json) as DraftStrategyAuthorization,
  }
}

function readByIdempotency(db: Database, key: string): DraftRow | undefined {
  return db.query(`SELECT * FROM rd_strategy_draft WHERE idempotency_key=$key`).get({ $key: key }) as DraftRow | null || undefined
}

function assertInput(input: MaterializeDraftStrategyInput): void {
  assertDraftStrategyAuthorization(input.authorization)
  for (const [field, value] of Object.entries({
    draft_id: input.draft_id,
    strategy_version: input.strategy_version,
    idempotency_key: input.idempotency_key,
    strategy_root: input.strategy_root,
  })) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  }
  if (!Number.isFinite(Date.parse(input.created_at))) throw new Error("created_at must be an ISO timestamp")
  if (input.policy_source.candidate.candidate_id !== input.authorization.selected_candidate_id) {
    throw new Error("policy source Candidate does not match Draft authorization")
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
