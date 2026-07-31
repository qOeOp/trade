import { Database } from "bun:sqlite"
import { asRecord, numberOrUndefined, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export interface GovernanceEvidence {
  evidence_id: string
  strategy_id: string
  setup_id?: string
  evidence_kind: string
  source_ref: string
  policy_hash?: string
  content_hash?: string
  body_json: JSONRecord
  created_at: string
}

export interface PromotionDecision {
  decision_id: string
  strategy_id: string
  from_status?: string
  to_status: string
  verdict: string
  evidence_refs_json: string[]
  reason_json?: JSONRecord
  decided_at: string
}

export interface ClosedFlowReview {
  review_id: string
  chain_id: string
  strategy_id?: string
  setup_id?: string
  outcome?: string
  pnl_r?: number
  review_ref: string
  body_json: JSONRecord
  reviewed_at: string
}

export interface ReviewBatch {
  batch_id: string
  status: string
  input_refs_json: string[]
  summary_json?: JSONRecord
  created_at: string
}

export function ensureGovernanceLedgerSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS governance_evidence (
      evidence_id   TEXT PRIMARY KEY,
      strategy_id   TEXT NOT NULL,
      setup_id      TEXT,
      evidence_kind TEXT NOT NULL,
      source_ref    TEXT NOT NULL,
      policy_hash   TEXT,
      content_hash  TEXT,
      body_json     TEXT NOT NULL CHECK(json_valid(body_json)),
      created_at    TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS promotion_decision (
      decision_id      TEXT PRIMARY KEY,
      strategy_id      TEXT NOT NULL,
      from_status      TEXT,
      to_status        TEXT NOT NULL,
      verdict          TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL CHECK(json_valid(evidence_refs_json)),
      reason_json      TEXT CHECK(reason_json IS NULL OR json_valid(reason_json)),
      decided_at       TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS closed_flow_review (
      review_id    TEXT PRIMARY KEY,
      chain_id     TEXT NOT NULL,
      strategy_id  TEXT,
      setup_id     TEXT,
      outcome      TEXT,
      pnl_r        REAL,
      review_ref   TEXT NOT NULL,
      body_json    TEXT NOT NULL CHECK(json_valid(body_json)),
      reviewed_at  TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS review_batch (
      batch_id      TEXT PRIMARY KEY,
      status        TEXT NOT NULL,
      input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json)),
      summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
      created_at    TEXT NOT NULL
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_governance_evidence_strategy ON governance_evidence(strategy_id, created_at DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_promotion_decision_strategy ON promotion_decision(strategy_id, decided_at DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_closed_flow_review_chain ON closed_flow_review(chain_id)")
}

export function recordGovernanceEvidence(db: Database, evidence: GovernanceEvidence): void {
  validateGovernanceEvidence(evidence)
  db.query(`
    INSERT INTO governance_evidence(evidence_id, strategy_id, setup_id, evidence_kind, source_ref, policy_hash, content_hash, body_json, created_at)
    VALUES ($evidence_id, $strategy_id, $setup_id, $evidence_kind, $source_ref, $policy_hash, $content_hash, $body_json, $created_at)
  `).run({
    $evidence_id: evidence.evidence_id,
    $strategy_id: evidence.strategy_id,
    $setup_id: evidence.setup_id ?? null,
    $evidence_kind: evidence.evidence_kind,
    $source_ref: evidence.source_ref,
    $policy_hash: evidence.policy_hash ?? null,
    $content_hash: evidence.content_hash ?? null,
    $body_json: JSON.stringify(evidence.body_json),
    $created_at: evidence.created_at,
  })
}

export function recordPromotionDecision(db: Database, decision: PromotionDecision): void {
  validatePromotionDecision(decision)
  db.query(`
    INSERT INTO promotion_decision(decision_id, strategy_id, from_status, to_status, verdict, evidence_refs_json, reason_json, decided_at)
    VALUES ($decision_id, $strategy_id, $from_status, $to_status, $verdict, $evidence_refs_json, $reason_json, $decided_at)
  `).run({
    $decision_id: decision.decision_id,
    $strategy_id: decision.strategy_id,
    $from_status: decision.from_status ?? null,
    $to_status: decision.to_status,
    $verdict: decision.verdict,
    $evidence_refs_json: JSON.stringify(decision.evidence_refs_json),
    $reason_json: decision.reason_json ? JSON.stringify(decision.reason_json) : null,
    $decided_at: decision.decided_at,
  })
}

export function recordClosedFlowReview(db: Database, review: ClosedFlowReview): void {
  validateClosedFlowReview(review)
  db.query(`
    INSERT INTO closed_flow_review(review_id, chain_id, strategy_id, setup_id, outcome, pnl_r, review_ref, body_json, reviewed_at)
    VALUES ($review_id, $chain_id, $strategy_id, $setup_id, $outcome, $pnl_r, $review_ref, $body_json, $reviewed_at)
  `).run({
    $review_id: review.review_id,
    $chain_id: review.chain_id,
    $strategy_id: review.strategy_id ?? null,
    $setup_id: review.setup_id ?? null,
    $outcome: review.outcome ?? null,
    $pnl_r: review.pnl_r ?? null,
    $review_ref: review.review_ref,
    $body_json: JSON.stringify(review.body_json),
    $reviewed_at: review.reviewed_at,
  })
}

export function recordReviewBatch(db: Database, batch: ReviewBatch): void {
  validateReviewBatch(batch)
  db.query(`
    INSERT INTO review_batch(batch_id, status, input_refs_json, summary_json, created_at)
    VALUES ($batch_id, $status, $input_refs_json, $summary_json, $created_at)
  `).run({
    $batch_id: batch.batch_id,
    $status: batch.status,
    $input_refs_json: JSON.stringify(batch.input_refs_json),
    $summary_json: batch.summary_json ? JSON.stringify(batch.summary_json) : null,
    $created_at: batch.created_at,
  })
}

export function buildGovernanceEvidence(input: JSONRecord): GovernanceEvidence {
  return {
    evidence_id: stringField(input.evidence_id),
    strategy_id: stringField(input.strategy_id),
    setup_id: stringField(input.setup_id) || undefined,
    evidence_kind: stringField(input.evidence_kind),
    source_ref: stringField(input.source_ref),
    policy_hash: stringField(input.policy_hash) || undefined,
    content_hash: stringField(input.content_hash) || undefined,
    body_json: asRecord(input.body_json ?? input.body),
    created_at: stringField(input.created_at) || stringField(input.now) || new Date().toISOString(),
  }
}

export function buildPromotionDecision(input: JSONRecord): PromotionDecision {
  return {
    decision_id: stringField(input.decision_id),
    strategy_id: stringField(input.strategy_id),
    from_status: stringField(input.from_status) || undefined,
    to_status: stringField(input.to_status),
    verdict: stringField(input.verdict),
    evidence_refs_json: stringList(input.evidence_refs_json ?? input.evidence_refs),
    reason_json: optionalRecord(input.reason_json ?? input.reason),
    decided_at: stringField(input.decided_at) || stringField(input.now) || new Date().toISOString(),
  }
}

export function buildClosedFlowReview(input: JSONRecord): ClosedFlowReview {
  return {
    review_id: stringField(input.review_id),
    chain_id: stringField(input.chain_id),
    strategy_id: stringField(input.strategy_id) || undefined,
    setup_id: stringField(input.setup_id) || undefined,
    outcome: stringField(input.outcome) || undefined,
    pnl_r: numberOrUndefined(input.pnl_r ?? input.pnl_R ?? input.r),
    review_ref: stringField(input.review_ref),
    body_json: asRecord(input.body_json ?? input.body),
    reviewed_at: stringField(input.reviewed_at) || stringField(input.now) || new Date().toISOString(),
  }
}

export function buildReviewBatch(input: JSONRecord): ReviewBatch {
  return {
    batch_id: stringField(input.batch_id),
    status: stringField(input.status),
    input_refs_json: stringList(input.input_refs_json ?? input.input_refs),
    summary_json: optionalRecord(input.summary_json ?? input.summary),
    created_at: stringField(input.created_at) || stringField(input.now) || new Date().toISOString(),
  }
}

function validateGovernanceEvidence(evidence: GovernanceEvidence): void {
  if (!evidence.evidence_id || !evidence.strategy_id || !evidence.evidence_kind || !evidence.source_ref || !evidence.created_at) {
    throw new Error("evidence_id, strategy_id, evidence_kind, source_ref, and created_at are required")
  }
}

function validatePromotionDecision(decision: PromotionDecision): void {
  if (!decision.decision_id || !decision.strategy_id || !decision.to_status || !decision.verdict || !decision.decided_at) {
    throw new Error("decision_id, strategy_id, to_status, verdict, and decided_at are required")
  }
}

function validateClosedFlowReview(review: ClosedFlowReview): void {
  if (!review.review_id || !review.chain_id || !review.review_ref || !review.reviewed_at) {
    throw new Error("review_id, chain_id, review_ref, and reviewed_at are required")
  }
}

function validateReviewBatch(batch: ReviewBatch): void {
  if (!batch.batch_id || !batch.status || !batch.created_at) {
    throw new Error("batch_id, status, and created_at are required")
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function optionalRecord(value: unknown): JSONRecord | undefined {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : undefined
}
