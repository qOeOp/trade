import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Database } from "bun:sqlite"
import { loadStrategyFile, parseFrontmatter } from "./loaders"
import type { ReplayResult } from "./replay-core"

type JSONRecord = Record<string, unknown>
type StrategyStatus = "draft" | "shadow" | "live-small" | "paused"
type EvidenceKind = "replay" | "shadow" | "live_small" | "review_batch"

interface StrategyEvidenceRecord {
  evidence_id: string
  created_at: string
  strategy_id: string
  setup_id: string
  kind: EvidenceKind
  policy_hash: string
  source_ref: string
  stats: EvidenceStats
  anti_overfit?: AntiOverfitProof
  gate?: JSONRecord
  notes?: string
}

interface EvidenceStats {
  sample_count: number
  win_rate?: number
  avg_r: number
  total_r: number
  max_drawdown_r?: number
  profit_factor?: number
}

interface AntiOverfitProof {
  method: "out_of_sample" | "walk_forward"
  oos_stats: EvidenceStats
  train_stats?: EvidenceStats
  trial_count?: number
  parameter_count?: number
  notes?: string
}

interface StrategyReviewReport {
  strategy_id: string
  strategy_path: string
  status: string
  policy_hash: string
  evidence: {
    fresh: StrategyEvidenceRecord[]
    stale: StrategyEvidenceRecord[]
  }
  latest: {
    replay: StrategyEvidenceRecord | null
    shadow: StrategyEvidenceRecord | null
    live_small: StrategyEvidenceRecord | null
    review_batch: StrategyEvidenceRecord | null
  }
  db_review_stats: EvidenceStats | null
  gate: StrategyPromotionGate
}

interface StrategyPromotionGate {
  shadow_candidate: boolean
  live_small_candidate: boolean
  blocked_by: Array<{ check_id: string; reason: string }>
}

interface PromoteStrategyInput {
  strategyPath: string
  ledgerPath: string
  toStatus: StrategyStatus
  db?: Database
  yes?: boolean
  now?: string
}

const DEFAULT_SETUP_ID = "default"

function appendStrategyEvidence(input: {
  strategyPath: string
  ledgerPath: string
  kind: EvidenceKind
  setupId?: string
  stats: EvidenceStats
  antiOverfit?: AntiOverfitProof
  sourceRef?: string
  gate?: JSONRecord
  notes?: string
  now?: string
}): StrategyEvidenceRecord {
  const strategy = loadStrategyFile(input.strategyPath)
  const record: StrategyEvidenceRecord = {
    evidence_id: randomUUID(),
    created_at: input.now || new Date().toISOString(),
    strategy_id: strategy.strategy_id,
    setup_id: input.setupId || DEFAULT_SETUP_ID,
    kind: input.kind,
    policy_hash: policyHashForFile(input.strategyPath),
    source_ref: input.sourceRef || "",
    stats: normalizeEvidenceStats(input.stats),
    ...(input.antiOverfit ? { anti_overfit: normalizeAntiOverfitProof(input.antiOverfit) } : {}),
    ...(input.gate ? { gate: input.gate } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  }
  appendJsonLine(input.ledgerPath, record)
  return record
}

function appendReplayEvidence(input: {
  strategyPath: string
  ledgerPath: string
  replayResult: ReplayResult
  setupId?: string
  sourceRef?: string
  now?: string
}): StrategyEvidenceRecord {
  return appendStrategyEvidence({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    kind: "replay",
    setupId: input.setupId,
    sourceRef: input.sourceRef,
    now: input.now,
    stats: {
      sample_count: input.replayResult.sample_count,
      win_rate: input.replayResult.win_rate,
      avg_r: input.replayResult.avg_r,
      total_r: input.replayResult.total_r,
      max_drawdown_r: input.replayResult.max_drawdown_r,
      profit_factor: input.replayResult.profit_factor,
    },
    antiOverfit: readAntiOverfitProof(input.replayResult.assumptions),
    gate: input.replayResult.gate,
    notes: input.replayResult.notes.join(" "),
  })
}

function reviewStrategy(input: {
  strategyPath: string
  ledgerPath: string
  db?: Database
}): StrategyReviewReport {
  const strategy = loadStrategyFile(input.strategyPath)
  const policyHash = policyHashForFile(input.strategyPath)
  const allEvidence = loadEvidenceLedger(input.ledgerPath).filter((record) => record.strategy_id === strategy.strategy_id)
  const fresh = allEvidence.filter((record) => record.policy_hash === policyHash)
  const stale = allEvidence.filter((record) => record.policy_hash !== policyHash)
  const dbReviewStats = input.db ? readDbReviewStats(input.db, strategy.strategy_id) : null
  const combinedFresh = dbReviewStats
    ? [...fresh, buildReviewBatchEvidence(strategy.strategy_id, policyHash, dbReviewStats)]
    : fresh
  const latest = {
    replay: latestEvidence(combinedFresh, "replay"),
    shadow: latestEvidence(combinedFresh, "shadow"),
    live_small: latestEvidence(combinedFresh, "live_small"),
    review_batch: latestEvidence(combinedFresh, "review_batch"),
  }

  return {
    strategy_id: strategy.strategy_id,
    strategy_path: strategy.path,
    status: strategy.status,
    policy_hash: policyHash,
    evidence: { fresh: combinedFresh, stale },
    latest,
    db_review_stats: dbReviewStats,
    gate: evaluateStrategyGate(latest),
  }
}

function promoteStrategy(input: PromoteStrategyInput): {
  status: "dry-run" | "updated"
  from_status: string
  to_status: StrategyStatus
  report: StrategyReviewReport
  updated_path?: string
} {
  const report = reviewStrategy({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    db: input.db,
  })
  const blockedBy = blockedForTransition(report, input.toStatus)
  if (blockedBy.length > 0) {
    throw new Error(`strategy promotion blocked: ${blockedBy.map((item) => item.check_id).join(", ")}`)
  }
  if (!input.yes) {
    return {
      status: "dry-run",
      from_status: report.status,
      to_status: input.toStatus,
      report,
    }
  }
  updateStrategyStatus(input.strategyPath, input.toStatus)
  return {
    status: "updated",
    from_status: report.status,
    to_status: input.toStatus,
    report: reviewStrategy({
      strategyPath: input.strategyPath,
      ledgerPath: input.ledgerPath,
      db: input.db,
    }),
    updated_path: input.strategyPath,
  }
}

function evaluateStrategyGate(latest: StrategyReviewReport["latest"]): StrategyPromotionGate {
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  const replay = latest.replay
  if (!replay) {
    blockedBy.push({ check_id: "S-REPLAY-MISSING", reason: "fresh replay evidence is required" })
  } else if (!isPositiveEvidence(replay.stats)) {
    blockedBy.push({ check_id: "S-REPLAY-WEAK", reason: "fresh replay evidence is not positive after costs" })
  } else {
    blockedBy.push(...evaluateAntiOverfit(replay))
  }

  const shadow = latest.shadow
  if (!shadow) {
    blockedBy.push({ check_id: "S-SHADOW-MISSING", reason: "fresh shadow evidence is required before live-small" })
  } else {
    if (shadow.stats.sample_count < 20) {
      blockedBy.push({ check_id: "S-SHADOW-SAMPLE", reason: `shadow sample_count ${shadow.stats.sample_count} is below 20` })
    }
    if (!isPositiveEvidence(shadow.stats)) {
      blockedBy.push({ check_id: "S-SHADOW-WEAK", reason: "fresh shadow evidence is not positive" })
    }
  }

  const replayOk = Boolean(replay && isPositiveEvidence(replay.stats) && evaluateAntiOverfit(replay).length === 0)
  const shadowOk = Boolean(shadow && shadow.stats.sample_count >= 20 && isPositiveEvidence(shadow.stats))
  return {
    shadow_candidate: replayOk,
    live_small_candidate: replayOk && shadowOk,
    blocked_by: blockedBy,
  }
}

function blockedForTransition(report: StrategyReviewReport, toStatus: StrategyStatus): Array<{ check_id: string; reason: string }> {
  if (toStatus === "draft" || toStatus === "paused") {
    return []
  }
  if (toStatus === "shadow" && !report.gate.shadow_candidate) {
    return report.gate.blocked_by.filter((item) => item.check_id.startsWith("S-REPLAY"))
  }
  if (toStatus === "live-small" && !report.gate.live_small_candidate) {
    return report.gate.blocked_by
  }
  return []
}

function policyHashForFile(path: string): string {
  const raw = readFileSync(path, "utf8")
  const { frontmatter, body } = parseFrontmatter(raw)
  const normalizedFrontmatter = {
    strategy_id: stringField(frontmatter.strategy_id) || stringField(frontmatter.id),
    name: stringField(frontmatter.name),
    tags: arrayOfStrings(frontmatter.tags),
  }
  return createHash("sha256")
    .update(JSON.stringify(normalizedFrontmatter))
    .update("\n")
    .update(body.trim())
    .digest("hex")
}

function updateStrategyStatus(path: string, status: StrategyStatus): void {
  const raw = readFileSync(path, "utf8")
  const { frontmatter, body } = parseFrontmatter(raw)
  const next = {
    ...frontmatter,
    status,
  }
  writeFileSync(path, `---\n${formatSimpleYaml(next)}---\n\n${body.trimStart()}`)
}

function loadEvidenceLedger(path: string): StrategyEvidenceRecord[] {
  if (!existsSync(path)) {
    return []
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StrategyEvidenceRecord)
}

function readDbReviewStats(db: Database, strategyId: string): EvidenceStats | null {
  const rows = db.query(`
    SELECT body_json FROM plan_event
    WHERE kind='review'
      AND json_extract(body_json, '$.strategy_ref') = $strategy_id
    ORDER BY created_at ASC
  `).all({ $strategy_id: strategyId }) as Array<{ body_json: string }>
  const reviews = rows.map((row) => JSON.parse(row.body_json) as JSONRecord)
  if (reviews.length === 0) {
    return null
  }
  const rValues = reviews.map((review) => Number(review.r ?? review.pnl_r ?? review.pnl_R)).filter(Number.isFinite)
  const pnlPctValues = reviews.map((review) => Number(review.pnl_pct)).filter(Number.isFinite)
  const wins = reviews.filter((review) => stringField(review.outcome) === "win").length
  const losses = reviews.filter((review) => stringField(review.outcome) === "loss").length
  const totalR = rValues.length > 0
    ? sum(rValues)
    : sum(pnlPctValues.map((value) => value / 100))
  const sampleCount = reviews.length
  return {
    sample_count: sampleCount,
    win_rate: round(wins / sampleCount),
    avg_r: round(totalR / sampleCount),
    total_r: round(totalR),
    profit_factor: losses > 0 ? round(wins / losses) : wins > 0 ? Number.POSITIVE_INFINITY : 0,
  }
}

function buildReviewBatchEvidence(strategyId: string, policyHash: string, stats: EvidenceStats): StrategyEvidenceRecord {
  return {
    evidence_id: "db-review-batch",
    created_at: new Date(0).toISOString(),
    strategy_id: strategyId,
    setup_id: DEFAULT_SETUP_ID,
    kind: "review_batch",
    policy_hash: policyHash,
    source_ref: "trade.db:plan_event.review",
    stats,
  }
}

function appendJsonLine(path: string, value: StrategyEvidenceRecord): void {
  mkdirSync(dirname(path), { recursive: true })
  const line = `${JSON.stringify(value)}\n`
  writeFileSync(path, line, { flag: "a" })
}

function latestEvidence(records: StrategyEvidenceRecord[], kind: EvidenceKind): StrategyEvidenceRecord | null {
  return records
    .filter((record) => record.kind === kind)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
}

function normalizeEvidenceStats(stats: EvidenceStats): EvidenceStats {
  return {
    sample_count: Number(stats.sample_count) || 0,
    win_rate: optionalNumber(stats.win_rate),
    avg_r: Number(stats.avg_r) || 0,
    total_r: Number(stats.total_r) || 0,
    max_drawdown_r: optionalNumber(stats.max_drawdown_r),
    profit_factor: optionalNumber(stats.profit_factor),
  }
}

function isPositiveEvidence(stats: EvidenceStats): boolean {
  return stats.sample_count >= 1
    && stats.avg_r > 0
    && stats.total_r > 0
    && (stats.profit_factor === undefined || stats.profit_factor >= 1.05)
    && (stats.max_drawdown_r === undefined || stats.max_drawdown_r <= 10)
}

function evaluateAntiOverfit(record: StrategyEvidenceRecord): Array<{ check_id: string; reason: string }> {
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  const proof = record.anti_overfit
  if (!proof) {
    return [{ check_id: "S-OOS-MISSING", reason: "fresh replay evidence must include out_of_sample or walk_forward proof" }]
  }
  if (proof.method !== "out_of_sample" && proof.method !== "walk_forward") {
    blockedBy.push({ check_id: "S-OOS-METHOD", reason: "anti_overfit.method must be out_of_sample or walk_forward" })
  }
  if (proof.oos_stats.sample_count < 10) {
    blockedBy.push({ check_id: "S-OOS-SAMPLE", reason: `oos sample_count ${proof.oos_stats.sample_count} is below 10` })
  }
  if (!isPositiveEvidence(proof.oos_stats)) {
    blockedBy.push({ check_id: "S-OOS-WEAK", reason: "out-of-sample evidence is not positive after costs" })
  }
  if (proof.trial_count !== undefined && proof.trial_count > 10) {
    blockedBy.push({ check_id: "S-SEARCH-BUDGET", reason: `trial_count ${proof.trial_count} exceeds 10` })
  }
  if (proof.parameter_count !== undefined && proof.parameter_count > 8) {
    blockedBy.push({ check_id: "S-PARAM-COUNT", reason: `parameter_count ${proof.parameter_count} exceeds 8` })
  }
  return blockedBy
}

function readAntiOverfitProof(assumptions: JSONRecord): AntiOverfitProof | undefined {
  const proof = assumptions.anti_overfit
  return proof && typeof proof === "object" ? proof as AntiOverfitProof : undefined
}

function normalizeAntiOverfitProof(proof: AntiOverfitProof): AntiOverfitProof {
  return {
    method: proof.method,
    oos_stats: normalizeEvidenceStats(proof.oos_stats),
    ...(proof.train_stats ? { train_stats: normalizeEvidenceStats(proof.train_stats) } : {}),
    ...(optionalNumber(proof.trial_count) !== undefined ? { trial_count: optionalNumber(proof.trial_count) } : {}),
    ...(optionalNumber(proof.parameter_count) !== undefined ? { parameter_count: optionalNumber(proof.parameter_count) } : {}),
    ...(proof.notes ? { notes: proof.notes } : {}),
  }
}

function formatSimpleYaml(value: JSONRecord): string {
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${formatYamlValue(item)}`)
    .join("\n")
    .concat("\n")
}

function formatYamlValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`
  }
  return String(value ?? "")
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

export {
  appendReplayEvidence,
  appendStrategyEvidence,
  blockedForTransition,
  evaluateStrategyGate,
  loadEvidenceLedger,
  policyHashForFile,
  promoteStrategy,
  reviewStrategy,
  updateStrategyStatus,
  type EvidenceKind,
  type EvidenceStats,
  type AntiOverfitProof,
  type StrategyEvidenceRecord,
  type StrategyPromotionGate,
  type StrategyReviewReport,
  type StrategyStatus,
}
