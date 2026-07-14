import { createHash } from "node:crypto"
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
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
  const prior = readByIdempotency(db, input.idempotency_key)
  if (prior) return bindingFromPrior(prior, input, strategyId, strategyRef, policyHash)

  db.query(`
    INSERT INTO rd_strategy_draft(
      draft_id, strategy_id, strategy_version, strategy_ref, strategy_policy_hash,
      materialization_status, authorization_json, policy_source_json,
      idempotency_key, error_message, created_at, updated_at
    ) VALUES (
      $draft_id, $strategy_id, $version, NULL, NULL,
      'pending', $authorization, $source, $idempotency_key, NULL, $created_at, $created_at
    )
  `).run({
    $draft_id: input.draft_id,
    $strategy_id: strategyId,
    $version: input.strategy_version,
    $authorization: JSON.stringify(input.authorization),
    $source: JSON.stringify(input.policy_source),
    $idempotency_key: input.idempotency_key,
    $created_at: input.created_at,
  })

  try {
    mkdirSync(input.strategy_root, { recursive: true })
    const temporary = `${strategyRef}.${sha256(input.idempotency_key).slice(0, 12)}.tmp`
    writeFileSync(temporary, markdown, "utf8")
    renameSync(temporary, strategyRef)
    db.query(`
      UPDATE rd_strategy_draft
      SET strategy_ref=$strategy_ref, strategy_policy_hash=$hash,
          materialization_status='ready', error_message=NULL, updated_at=$updated_at
      WHERE draft_id=$draft_id AND materialization_status='pending'
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
      WHERE draft_id=$draft_id
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

function bindingFromPrior(
  prior: DraftRow,
  input: MaterializeDraftStrategyInput,
  strategyId: string,
  strategyRef: string,
  policyHash: string,
): StrategyDraftBinding {
  if (prior.draft_id !== input.draft_id || prior.strategy_id !== strategyId
      || prior.strategy_version !== input.strategy_version
      || prior.authorization_json !== JSON.stringify(input.authorization)) {
    throw new Error("Draft Strategy idempotency key was reused with different authority or identity")
  }
  if (prior.materialization_status !== "ready") {
    throw new Error(`Draft Strategy materialization is ${prior.materialization_status}: ${prior.error_message || "retry requires owner recovery"}`)
  }
  if (prior.strategy_ref !== strategyRef || prior.strategy_policy_hash !== policyHash) {
    throw new Error("Draft Strategy source changed after materialization")
  }
  return readyBinding(prior)
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
