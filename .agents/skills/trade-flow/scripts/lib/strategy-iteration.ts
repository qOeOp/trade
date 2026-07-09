import { createHash, randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import type { Database } from "bun:sqlite"
import { loadStrategyFile, parseFrontmatter } from "./loaders"
import { hashCanonical, replayDataHash, replayHarnessHash, type ReplayProvenance, type ReplayResult } from "./replay-core"
import { defaultCatalogDbPathForGeneratedPath, listCatalogStrategyEvidence, upsertCatalogStrategyEvidence } from "./data-catalog"

type JSONRecord = Record<string, unknown>
const STRATEGY_STATUSES = ["draft", "shadow", "live-small", "paused"] as const
type StrategyStatus = typeof STRATEGY_STATUSES[number]
const EVIDENCE_KINDS = ["replay", "shadow", "live_small", "review_batch"] as const
type EvidenceKind = typeof EVIDENCE_KINDS[number]
const PROMOTE_RESULT_STATUSES = ["dry-run", "updated"] as const
type PromoteResultStatus = typeof PROMOTE_RESULT_STATUSES[number]

interface StrategyEvidenceRecord {
  evidence_id: string
  created_at: string
  strategy_id: string
  setup_id: string
  kind: EvidenceKind
  policy_hash: string
  fingerprint?: EvidenceFingerprint
  replay_context?: { assumptions: JSONRecord }
  source_ref: string
  stats: EvidenceStats
  anti_overfit?: AntiOverfitProof
  robustness?: RobustnessProof
  execution_attribution?: ExecutionAttribution
  qualification?: EvidenceQualification
  gate?: JSONRecord
  notes?: string
}

interface EvidenceFingerprint extends ReplayProvenance {
  policy_hash: string
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
  stage?: "selection_validation" | "external_validation" | "locked_holdout"
  oos_stats: EvidenceStats
  train_stats?: EvidenceStats
  trial_count?: number
  parameter_count?: number
  notes?: string
}

interface RobustnessProof {
  regime_slices: Array<{ regime: string; sample_count: number; avg_r: number; total_r: number; profit_factor?: number; max_drawdown_r?: number }>
  cost_stress: { extra_bps_per_side: number; stats: EvidenceStats }
  parameter_stability?: { method?: string; evaluation_count: number; positive_ratio: number; worst_avg_r: number }
}

interface ExecutionAttribution {
  total_fee_drag?: number
  total_slippage_drag?: number
  total_funding_drag?: number
  total_cost_drag?: number
  notes?: string
}

interface EvidenceQualification {
  funding_event_coverage?: JSONRecord
  panel_null_gate?: JSONRecord
}

interface StrategyReviewReport {
  strategy_id: string
  strategy_path: string
  status: string
  policy_hash: string
  evidence: {
    fresh: StrategyEvidenceRecord[]
    stale: StrategyEvidenceRecord[]
    stale_reasons: Array<{ evidence_id: string; check_ids: string[] }>
  }
  latest: {
    replay: StrategyEvidenceRecord | null
    shadow: StrategyEvidenceRecord | null
    live_small: StrategyEvidenceRecord | null
    review_batch: StrategyEvidenceRecord | null
  }
  db_review_stats: EvidenceStats | null
  diagnostics: StrategyReviewDiagnostics
  gate: StrategyPromotionGate
}

interface StrategyReviewDiagnostics {
  qualification: {
    funding_event_coverage_status: string | null
    panel_null_status: string | null
    panel_null_blocked: boolean | null
    blocked_by: string[]
  }
  decay: StrategyDecayDiagnostics
  cost_model_feedback: CostModelFeedback
  failure_attribution: Array<{ area: string; count: number; check_ids: string[]; next_action: string }>
}

interface StrategyDecayDiagnostics {
  status: "not_evaluated" | "stable" | "degraded" | "failed"
  blocked_by: Array<{ check_id: string; reason: string }>
  comparisons: Array<{
    from: EvidenceKind
    to: EvidenceKind
    from_sample_count: number
    to_sample_count: number
    avg_r_ratio: number | null
    avg_r_delta: number
    total_r_delta: number
    from_cost_drag: number | null
    to_cost_drag: number | null
    status: "stable" | "degraded" | "failed"
  }>
}

interface CostModelFeedback {
  status: "not_evaluated" | "missing_attribution" | "ready"
  source_kind: EvidenceKind | null
  sample_count: number
  observed_drag_r_per_trade: {
    fee: number | null
    slippage: number | null
    funding: number | null
    total: number | null
  }
  replay_assumed_cost_drag_r_per_trade: number | null
  cost_drag_delta_r_per_trade: number | null
  recommended_extra_cost_r_per_trade: number | null
  capacity_buckets: Array<{
    bucket: "unknown_size"
    sample_count: number
    avg_slippage_drag_r: number | null
    avg_total_cost_drag_r: number | null
  }>
  recommended_action: string
}

interface StrategyPromotionGate {
  shadow_candidate: boolean
  live_small_candidate: boolean
  blocked_by: Array<{ check_id: string; reason: string }>
}

interface PromoteStrategyInput {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  toStatus: StrategyStatus
  db?: Database
  yes?: boolean
  now?: string
}

interface StrategyCycleInput {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  db?: Database
  setupId?: string
  promoteTo?: StrategyStatus
  yes?: boolean
  now?: string
}

interface PromoteStrategyResult {
  status: PromoteResultStatus
  from_status: string
  to_status: StrategyStatus
  report: StrategyReviewReport
  updated_path?: string
}

const SHADOW_EVIDENCE_SYNC_STATUSES = ["created", "reused", "skipped"] as const
type ShadowEvidenceSyncStatus = typeof SHADOW_EVIDENCE_SYNC_STATUSES[number]

interface ShadowEvidenceSyncResult {
  status: ShadowEvidenceSyncStatus
  source_ref?: string
  evidence?: StrategyEvidenceRecord
  reason?: string
}

interface StrategyCycleResult {
  shadow_evidence: ShadowEvidenceSyncResult
  report: StrategyReviewReport
  promotion?: PromoteStrategyResult
}

const DEFAULT_SETUP_ID = "default"
const MIN_OOS_EFFECTIVE_SAMPLE_COUNT = 10
const MIN_OOS_RAW_SAMPLE_COUNT = 20
const MIN_OOS_AVG_R_MARGIN = 0.05
const MIN_OOS_TOTAL_R_MARGIN = 1
const MIN_OOS_PROFIT_FACTOR = 1.1
const MIN_SHADOW_AVG_R_RETENTION = 0.5
const MIN_LIVE_AVG_R_RETENTION = 0.5

function appendStrategyEvidence(input: {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  kind: EvidenceKind
  setupId?: string
  stats: EvidenceStats
  antiOverfit?: AntiOverfitProof
  robustness?: RobustnessProof
  executionAttribution?: ExecutionAttribution
  qualification?: EvidenceQualification
  sourceRef?: string
  gate?: JSONRecord
  notes?: string
  now?: string
  fingerprint?: EvidenceFingerprint
  replayContext?: { assumptions: JSONRecord }
}): StrategyEvidenceRecord {
  const strategy = loadStrategyFile(input.strategyPath)
  const record: StrategyEvidenceRecord = {
    evidence_id: randomUUID(),
    created_at: input.now || new Date().toISOString(),
    strategy_id: strategy.strategy_id,
    setup_id: input.setupId || DEFAULT_SETUP_ID,
    kind: input.kind,
    policy_hash: policyHashForFile(input.strategyPath),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    ...(input.replayContext ? { replay_context: input.replayContext } : {}),
    source_ref: input.sourceRef || "",
    stats: normalizeEvidenceStats(input.stats),
    ...(input.antiOverfit ? { anti_overfit: normalizeAntiOverfitProof(input.antiOverfit) } : {}),
    ...(input.robustness ? { robustness: input.robustness } : {}),
    ...(input.executionAttribution ? { execution_attribution: normalizeExecutionAttribution(input.executionAttribution) } : {}),
    ...(input.qualification ? { qualification: normalizeQualification(input.qualification) } : {}),
    ...(input.gate ? { gate: input.gate } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  }
  upsertCatalogStrategyEvidence({
    catalogDbPath: evidenceCatalogDbPath(input),
    record: record as unknown as JSONRecord,
    now: record.created_at,
  })
  return record
}

function appendReplayEvidence(input: {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  replayResult: ReplayResult
  setupId?: string
  sourceRef?: string
  now?: string
  qualification?: EvidenceQualification
}): StrategyEvidenceRecord {
  const policyHash = policyHashForFile(input.strategyPath)
  const provenance = input.replayResult.provenance
  if (!provenance?.harness_hash || !provenance.data_hash || !provenance.assumptions_hash || !provenance.data_ref) {
    throw new Error("replay evidence requires complete provenance")
  }
  return appendStrategyEvidence({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    catalogDbPath: input.catalogDbPath,
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
    robustness: readRobustnessProof(input.replayResult.assumptions),
    qualification: replayQualification(input.replayResult, input.qualification),
    gate: input.replayResult.gate,
    notes: input.replayResult.notes.join(" "),
    fingerprint: { policy_hash: policyHash, ...provenance },
    replayContext: { assumptions: input.replayResult.assumptions },
  })
}

function appendShadowEvidenceFromReviews(input: {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  db: Database
  setupId?: string
  sourceRef?: string
  now?: string
}): StrategyEvidenceRecord {
  const strategy = loadStrategyFile(input.strategyPath)
  const snapshot = readDbReviewSnapshot(input.db, strategy.strategy_id, input.setupId)
  if (snapshot.reviews.length === 0) {
    throw new Error("shadow evidence requires at least one matching review event")
  }
  return appendShadowEvidenceRecord({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    catalogDbPath: input.catalogDbPath,
    reviews: snapshot.reviews,
    setupId: input.setupId,
    sourceRef: input.sourceRef || snapshot.source_ref,
    now: input.now,
  })
}

function appendShadowEvidenceRecord(input: {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  reviews: JSONRecord[]
  setupId?: string
  sourceRef: string
  now?: string
}): StrategyEvidenceRecord {
  return appendStrategyEvidence({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    catalogDbPath: input.catalogDbPath,
    kind: "shadow",
    setupId: input.setupId,
    sourceRef: input.sourceRef,
    stats: evidenceStatsFromReviews(input.reviews),
    executionAttribution: executionAttributionFromReviews(input.reviews),
    now: input.now,
  })
}

function syncShadowEvidenceFromReviews(input: {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  db?: Database
  setupId?: string
  now?: string
}): ShadowEvidenceSyncResult {
  if (!input.db) {
    return { status: "skipped", reason: "db_not_provided" }
  }
  const strategy = loadStrategyFile(input.strategyPath)
  const snapshot = readDbReviewSnapshot(input.db, strategy.strategy_id, input.setupId)
  if (snapshot.reviews.length === 0) {
    return { status: "skipped", source_ref: snapshot.source_ref, reason: "no_matching_reviews" }
  }
  const policyHash = policyHashForFile(input.strategyPath)
  const existing = loadEvidenceLedger(input).find((record) => (
    record.strategy_id === strategy.strategy_id
    && record.kind === "shadow"
    && record.source_ref === snapshot.source_ref
    && evidenceStaleReasons(record, policyHash).length === 0
  ))
  if (existing) {
    return { status: "reused", source_ref: snapshot.source_ref, evidence: existing }
  }
  const evidence = appendShadowEvidenceRecord({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    catalogDbPath: input.catalogDbPath,
    reviews: snapshot.reviews,
    setupId: input.setupId,
    sourceRef: snapshot.source_ref,
    now: input.now,
  })
  return { status: "created", source_ref: snapshot.source_ref, evidence }
}

function reviewStrategy(input: {
  strategyPath: string
  ledgerPath: string
  catalogDbPath?: string
  db?: Database
}): StrategyReviewReport {
  const strategy = loadStrategyFile(input.strategyPath)
  const policyHash = policyHashForFile(input.strategyPath)
  const allEvidence = loadEvidenceLedger(input).filter((record) => record.strategy_id === strategy.strategy_id)
  const classified = allEvidence.map((record) => ({ record, reasons: evidenceStaleReasons(record, policyHash) }))
  const fresh = classified.filter((item) => item.reasons.length === 0).map((item) => item.record)
  const stale = classified.filter((item) => item.reasons.length > 0).map((item) => item.record)
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
  const gate = evaluateStrategyGate(latest)

  return {
    strategy_id: strategy.strategy_id,
    strategy_path: strategy.path,
    status: strategy.status,
    policy_hash: policyHash,
    evidence: {
      fresh: combinedFresh,
      stale,
      stale_reasons: classified.filter((item) => item.reasons.length > 0).map((item) => ({
        evidence_id: item.record.evidence_id,
        check_ids: item.reasons,
      })),
    },
    latest,
    db_review_stats: dbReviewStats,
    diagnostics: buildReviewDiagnostics(latest, gate),
    gate,
  }
}

function promoteStrategy(input: PromoteStrategyInput): PromoteStrategyResult {
  const report = reviewStrategy({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    catalogDbPath: input.catalogDbPath,
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
      catalogDbPath: input.catalogDbPath,
      db: input.db,
    }),
    updated_path: input.strategyPath,
  }
}

function runStrategyCycle(input: StrategyCycleInput): StrategyCycleResult {
  const shadowEvidence = syncShadowEvidenceFromReviews({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    catalogDbPath: input.catalogDbPath,
    db: input.db,
    setupId: input.setupId,
    now: input.now,
  })
  const report = reviewStrategy({
    strategyPath: input.strategyPath,
    ledgerPath: input.ledgerPath,
    catalogDbPath: input.catalogDbPath,
    db: input.db,
  })
  if (!input.promoteTo) {
    return { shadow_evidence: shadowEvidence, report }
  }
  return {
    shadow_evidence: shadowEvidence,
    report,
    promotion: promoteStrategy({
      strategyPath: input.strategyPath,
      ledgerPath: input.ledgerPath,
      catalogDbPath: input.catalogDbPath,
      db: input.db,
      toStatus: input.promoteTo,
      yes: input.yes,
    }),
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
    blockedBy.push(...evaluateRobustness(replay))
    blockedBy.push(...evaluateQualification(replay))
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
    if (!hasCompleteExecutionAttribution(shadow.execution_attribution)) {
      blockedBy.push({ check_id: "S-SHADOW-ATTRIBUTION-MISSING", reason: "fresh shadow evidence must include cost, slippage, and funding attribution" })
    }
    if (hasCompleteExecutionAttribution(shadow.execution_attribution) && !hasReviewDerivedShadowAttribution(shadow)) {
      blockedBy.push({ check_id: "S-SHADOW-ATTRIBUTION-SOURCE", reason: "shadow execution attribution must be derived from review events, not manual evidence fields" })
    }
  }
  const decayBlocks = evaluateDecayGate(latest)
  blockedBy.push(...decayBlocks)

  const replayOk = Boolean(replay && isPositiveEvidence(replay.stats) && evaluateAntiOverfit(replay).length === 0 && evaluateRobustness(replay).length === 0 && evaluateQualification(replay).length === 0)
  const shadowOk = Boolean(shadow && shadow.stats.sample_count >= 20 && isPositiveEvidence(shadow.stats) && hasCompleteExecutionAttribution(shadow.execution_attribution) && hasReviewDerivedShadowAttribution(shadow))
  return {
    shadow_candidate: replayOk,
    live_small_candidate: replayOk && shadowOk && decayBlocks.length === 0,
    blocked_by: blockedBy,
  }
}

function blockedForTransition(report: StrategyReviewReport, toStatus: StrategyStatus): Array<{ check_id: string; reason: string }> {
  if (toStatus === "draft" || toStatus === "paused") {
    return []
  }
  if (toStatus === "shadow" && !report.gate.shadow_candidate) {
    return report.gate.blocked_by.filter((item) => isReplayQualificationBlock(item.check_id))
  }
  if (toStatus === "live-small" && !report.gate.live_small_candidate) {
    return report.gate.blocked_by
  }
  return []
}

function isReplayQualificationBlock(checkId: string): boolean {
  return checkId.startsWith("S-REPLAY")
    || checkId.startsWith("S-OOS")
    || checkId === "S-SEARCH-BUDGET"
    || checkId === "S-PARAM-COUNT"
    || checkId === "S-HOLDOUT-MISSING"
    || checkId.startsWith("S-ROBUSTNESS")
    || checkId.startsWith("S-FUNDING")
    || checkId.startsWith("S-PANEL")
}

function evidenceStaleReasons(record: StrategyEvidenceRecord, policyHash: string): string[] {
  const reasons: string[] = []
  if (record.policy_hash !== policyHash) {
    reasons.push("E-POLICY-STALE")
  }
  if (record.kind !== "replay") {
    return reasons
  }
  const fingerprint = record.fingerprint
  if (!fingerprint || !record.replay_context) {
    return [...reasons, "E-FINGERPRINT-MISSING"]
  }
  if (fingerprint.policy_hash !== record.policy_hash) {
    reasons.push("E-FINGERPRINT-POLICY-MISMATCH")
  }
  if (fingerprint.harness_hash !== replayHarnessHash()) {
    reasons.push("E-HARNESS-STALE")
  }
  if (fingerprint.data_schema_version < 2 || !fingerprint.closed_candles_only || !fingerprint.manifest_checksum_verified) {
    reasons.push("E-DATA-CONTRACT-LEGACY")
  }
  if (!hasTemporalContract(fingerprint)) {
    reasons.push("E-TEMPORAL-CONTRACT-MISSING")
  }
  if (fingerprint.assumptions_hash !== hashCanonical(record.replay_context.assumptions)) {
    reasons.push("E-ASSUMPTIONS-CORRUPT")
  }
  try {
    const supplementalRefs = (fingerprint.supplemental_data || []).map((item) => item.ref)
    if (fingerprint.data_hash !== replayDataHash(fingerprint.data_ref, fingerprint.timeframe, supplementalRefs)) {
      reasons.push("E-DATA-STALE")
    }
  } catch {
    reasons.push("E-DATA-UNAVAILABLE")
  }
  return reasons
}

function hasTemporalContract(fingerprint: EvidenceFingerprint): boolean {
  const contract = asRecord(fingerprint.temporal_contract)
  return stringField(contract.method) === "closed_candle_replay_v1"
    && Boolean(stringField(contract.reference_at))
    && Boolean(stringField(contract.availability_at))
    && Boolean(stringField(contract.lookback_start))
    && Boolean(stringField(contract.label_end))
    && Boolean(stringField(contract.universe_selected_at))
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
    .update(policyBodyForHash(body))
    .digest("hex")
}

function policyBodyForHash(body: string): string {
  const setupStart = body.indexOf("\n## Setup Certificate")
  if (setupStart >= 0) {
    return body.slice(setupStart + 1).trim()
  }
  if (body.startsWith("## Setup Certificate")) {
    return body.trim()
  }
  return body.trim()
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

function loadEvidenceLedger(input: string | { ledgerPath?: string; catalogDbPath?: string }): StrategyEvidenceRecord[] {
  const store = typeof input === "string" ? { ledgerPath: input } : input
  return listCatalogStrategyEvidence({
    catalogDbPath: evidenceCatalogDbPath(store),
    limit: 1000,
  }) as unknown as StrategyEvidenceRecord[]
}

function readDbReviewStats(db: Database, strategyId: string): EvidenceStats | null {
  const reviews = readDbReviewSnapshot(db, strategyId).reviews
  return reviews.length > 0 ? evidenceStatsFromReviews(reviews) : null
}

function readDbReviewSnapshot(db: Database, strategyId: string, setupId?: string): { reviews: JSONRecord[]; source_ref: string } {
  const rows = db.query(`
    SELECT event_key, created_at, body_json FROM plan_event
    WHERE kind='review'
      AND json_extract(body_json, '$.strategy_ref') = $strategy_id
    ORDER BY created_at ASC
  `).all({ $strategy_id: strategyId }) as Array<{ event_key: string; created_at: string; body_json: string }>
  const filtered = rows
    .map((row) => ({ ...row, body: JSON.parse(row.body_json) as JSONRecord }))
    .filter((row) => !setupId || reviewSetupId(row.body) === setupId)
  const digest = createHash("sha256")
    .update(JSON.stringify(filtered.map((row) => ({ event_key: row.event_key, created_at: row.created_at, body_json: row.body_json }))))
    .digest("hex")
    .slice(0, 16)
  return {
    reviews: filtered.map((row) => row.body),
    source_ref: `trade.db:plan_event.review:${strategyId}:${setupId || "*"}:${filtered.length}:${digest}`,
  }
}

function reviewSetupId(review: JSONRecord): string {
  return stringField(review.setup_id) || DEFAULT_SETUP_ID
}

function evidenceStatsFromReviews(reviews: JSONRecord[]): EvidenceStats {
  const rValues = reviews.map((review) => Number(review.r ?? review.pnl_r ?? review.pnl_R)).filter(Number.isFinite)
  const pnlPctValues = reviews.map((review) => Number(review.pnl_pct)).filter(Number.isFinite)
  const wins = reviews.filter((review) => stringField(review.outcome) === "win").length
  const losses = reviews.filter((review) => stringField(review.outcome) === "loss").length
  const totalR = rValues.length > 0
    ? sum(rValues)
    : sum(pnlPctValues.map((value) => value / 100))
  const profits = rValues.filter((value) => value > 0)
  const grossProfit = sum(profits)
  const grossLoss = Math.abs(sum(rValues.filter((value) => value < 0)))
  const sampleCount = reviews.length
  return {
    sample_count: sampleCount,
    win_rate: round(wins / sampleCount),
    avg_r: round(totalR / sampleCount),
    total_r: round(totalR),
    max_drawdown_r: rValues.length > 0 ? round(maxDrawdown(rValues)) : undefined,
    profit_factor: rValues.length > 0
      ? grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0
      : losses > 0 ? round(wins / losses) : wins > 0 ? Number.POSITIVE_INFINITY : 0,
  }
}

function executionAttributionFromReviews(reviews: JSONRecord[]): ExecutionAttribution {
  const fee = reviewDragTotal(reviews, "total_fee_drag", ["fee_drag_r", "fee_r", "commission_r"], ["fee_usdt", "commission_usdt"])
  const slippage = reviewDragTotal(reviews, "total_slippage_drag", ["slippage_drag_r", "slippage_r"], ["slippage_usdt_total", "slippage_usdt"])
  const funding = reviewDragTotal(reviews, "total_funding_drag", ["funding_drag_r", "funding_r"], ["funding_usdt"])
  const explicitCost = reviewDragTotal(reviews, "total_cost_drag", ["cost_drag_r", "cost_r"], ["cost_usdt", "total_cost_usdt"])
  const inferredCost = fee.observed && slippage.observed && funding.observed
    ? fee.total + slippage.total + funding.total
    : undefined
  const missing = [
    fee.observed ? "" : "fee",
    slippage.observed ? "" : "slippage",
    funding.observed ? "" : "funding",
  ].filter(Boolean)
  return {
    ...(fee.observed ? { total_fee_drag: round(fee.total) } : {}),
    ...(slippage.observed ? { total_slippage_drag: round(slippage.total) } : {}),
    ...(funding.observed ? { total_funding_drag: round(funding.total) } : {}),
    ...(explicitCost.observed ? { total_cost_drag: round(explicitCost.total) } : inferredCost !== undefined ? { total_cost_drag: round(inferredCost) } : {}),
    notes: missing.length > 0
      ? `aggregated from plan_event.review; missing attribution: ${missing.join(", ")}`
      : "aggregated from plan_event.review",
  }
}

function reviewDragTotal(reviews: JSONRecord[], attributionKey: string, rKeys: string[], usdtKeys: string[]): { total: number; observed: boolean } {
  const values = reviews.map((review) => reviewDragR(review, attributionKey, rKeys, usdtKeys))
  return {
    total: sum(values.map((value) => value.dragR)),
    observed: values.some((value) => value.observed),
  }
}

function reviewDragR(review: JSONRecord, attributionKey: string, rKeys: string[], usdtKeys: string[]): { dragR: number; observed: boolean } {
  const nested = asRecord(review.execution_attribution)
  const direct = optionalNumber(nested[attributionKey]) ?? firstNumber(review, rKeys)
  if (direct !== undefined) {
    return { dragR: Math.abs(direct), observed: true }
  }
  const usdt = firstNumber(review, usdtKeys)
  const risk = firstNumber(review, ["initial_risk_usdt", "max_live_risk_usdt", "risk_budget_usdt"])
  if (usdt !== undefined && risk !== undefined && risk > 0) {
    return { dragR: Math.abs(usdt / risk), observed: true }
  }
  return { dragR: 0, observed: false }
}

function firstNumber(record: JSONRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = optionalNumber(record[key])
    if (value !== undefined) return value
  }
  return undefined
}

function maxDrawdown(values: number[]): number {
  let equity = 0
  let peak = 0
  let drawdown = 0
  for (const value of values) {
    equity += value
    peak = Math.max(peak, equity)
    drawdown = Math.max(drawdown, peak - equity)
  }
  return drawdown
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

function evidenceCatalogDbPath(input: { catalogDbPath?: string; ledgerPath?: string }): string {
  if (input.catalogDbPath) return input.catalogDbPath
  if (input.ledgerPath) return defaultCatalogDbPathForGeneratedPath(input.ledgerPath)
  return "./data/data_catalog.db"
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

function normalizeExecutionAttribution(value: ExecutionAttribution): ExecutionAttribution {
  return {
    total_fee_drag: optionalNumber(value.total_fee_drag),
    total_slippage_drag: optionalNumber(value.total_slippage_drag),
    total_funding_drag: optionalNumber(value.total_funding_drag),
    total_cost_drag: optionalNumber(value.total_cost_drag),
    ...(value.notes ? { notes: String(value.notes) } : {}),
  }
}

function replayQualification(replay: ReplayResult, input?: EvidenceQualification): EvidenceQualification | undefined {
  const qualification = normalizeQualification(input || {})
  const fundingCoverage = asRecord(replay.assumptions.funding_event_coverage)
  if (Object.keys(fundingCoverage).length > 0 && !qualification.funding_event_coverage) {
    qualification.funding_event_coverage = fundingCoverage
  }
  return Object.keys(qualification).length > 0 ? qualification : undefined
}

function normalizeQualification(value: EvidenceQualification): EvidenceQualification {
  const funding = asRecord(value.funding_event_coverage)
  const panel = asRecord(value.panel_null_gate)
  return {
    ...(Object.keys(funding).length > 0 ? { funding_event_coverage: funding } : {}),
    ...(Object.keys(panel).length > 0 ? { panel_null_gate: panel } : {}),
  }
}

function hasCompleteExecutionAttribution(value?: ExecutionAttribution): boolean {
  if (!value) return false
  return [value.total_cost_drag, value.total_slippage_drag, value.total_funding_drag].every((item) => Number.isFinite(item))
}

function hasReviewDerivedShadowAttribution(record: StrategyEvidenceRecord): boolean {
  return record.source_ref.startsWith("trade.db:plan_event.review:")
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
  if (proof.stage !== "locked_holdout") {
    blockedBy.push({ check_id: "S-HOLDOUT-MISSING", reason: "selection validation cannot authorize shadow; locked holdout evidence is required" })
  }
  if (proof.oos_stats.sample_count < 10) {
    blockedBy.push({ check_id: "S-OOS-SAMPLE", reason: `oos sample_count ${proof.oos_stats.sample_count} is below 10` })
  }
  if (!isPositiveEvidence(proof.oos_stats)) {
    blockedBy.push({ check_id: "S-OOS-WEAK", reason: "out-of-sample evidence is not positive after costs" })
  }
  blockedBy.push(...evaluateOosEdgeMargin(proof.oos_stats, proof.trial_count ?? 1))
  if (proof.trial_count !== undefined && proof.trial_count > 10) {
    blockedBy.push({ check_id: "S-SEARCH-BUDGET", reason: `trial_count ${proof.trial_count} exceeds 10` })
  }
  if (proof.parameter_count !== undefined && proof.parameter_count > 8) {
    blockedBy.push({ check_id: "S-PARAM-COUNT", reason: `parameter_count ${proof.parameter_count} exceeds 8` })
  }
  return blockedBy
}

function evaluateOosEdgeMargin(stats: EvidenceStats, trialCount: number): Array<{ check_id: string; reason: string }> {
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  const effective = effectiveSampleCount(stats.sample_count, trialCount)
  if (stats.sample_count < MIN_OOS_RAW_SAMPLE_COUNT || effective < MIN_OOS_EFFECTIVE_SAMPLE_COUNT) {
    blockedBy.push({
      check_id: "S-OOS-EFFECTIVE-SAMPLE",
      reason: `oos raw/effective sample_count ${stats.sample_count}/${effective} is below ${MIN_OOS_RAW_SAMPLE_COUNT}/${MIN_OOS_EFFECTIVE_SAMPLE_COUNT}`,
    })
  }
  if (stats.avg_r < MIN_OOS_AVG_R_MARGIN || stats.total_r < MIN_OOS_TOTAL_R_MARGIN || (stats.profit_factor !== undefined && stats.profit_factor < MIN_OOS_PROFIT_FACTOR)) {
    blockedBy.push({
      check_id: "S-OOS-EDGE-MARGIN",
      reason: `oos edge margin is too thin: avg_r ${stats.avg_r}, total_r ${stats.total_r}, profit_factor ${stats.profit_factor ?? "n/a"}`,
    })
  }
  return blockedBy
}

function effectiveSampleCount(sampleCount: number, trialCount: number): number {
  const trials = Math.max(1, Number.isFinite(trialCount) ? trialCount : 1)
  return Math.floor(sampleCount / Math.sqrt(trials))
}

function readAntiOverfitProof(assumptions: JSONRecord): AntiOverfitProof | undefined {
  const proof = assumptions.anti_overfit
  return proof && typeof proof === "object" ? proof as AntiOverfitProof : undefined
}

function readRobustnessProof(assumptions: JSONRecord): RobustnessProof | undefined {
  const proof = assumptions.robustness
  return proof && typeof proof === "object" ? proof as RobustnessProof : undefined
}

function evaluateRobustness(record: StrategyEvidenceRecord): Array<{ check_id: string; reason: string }> {
  const proof = record.robustness
  if (!proof) {
    return [{ check_id: "S-ROBUSTNESS-MISSING", reason: "replay evidence must include regime and cost robustness" }]
  }
  const eligible = proof.regime_slices.filter((slice) => slice.sample_count >= 5)
  if (eligible.length < 2) {
    return [{ check_id: "S-ROBUSTNESS-REGIME", reason: "at least two regime slices with five samples each are required" }]
  }
  const positive = eligible.filter((slice) => slice.avg_r > 0 && slice.total_r > 0)
  const blocked: Array<{ check_id: string; reason: string }> = []
  if (positive.length < 2) {
    blocked.push({ check_id: "S-ROBUSTNESS-REGIME", reason: "at least two eligible regime slices must be positive" })
  }
  if (proof.cost_stress.extra_bps_per_side < 5 || !isPositiveEvidence(proof.cost_stress.stats)) {
    blocked.push({ check_id: "S-ROBUSTNESS-COST", reason: "edge does not remain positive under the declared cost stress" })
  }
  if (!proof.parameter_stability || proof.parameter_stability.method !== "fixed_plus_minus_10pct" || proof.parameter_stability.evaluation_count < 2) {
    blocked.push({ check_id: "S-ROBUSTNESS-PARAM", reason: "at least two fixed parameter perturbations are required" })
  } else if (proof.parameter_stability.positive_ratio < 0.5 || proof.parameter_stability.worst_avg_r <= 0) {
    blocked.push({ check_id: "S-ROBUSTNESS-PARAM", reason: "parameter perturbation stability is too weak" })
  }
  return blocked
}

function evaluateQualification(record: StrategyEvidenceRecord): Array<{ check_id: string; reason: string }> {
  const blocked: Array<{ check_id: string; reason: string }> = []
  const funding = asRecord(record.qualification?.funding_event_coverage)
  const fundingStatus = stringField(funding.status)
  if (fundingStatus && !["complete", "full", "none", "not_provided"].includes(fundingStatus)) {
    blocked.push({ check_id: "S-FUNDING-COVERAGE", reason: `funding_event_coverage.status=${fundingStatus} cannot authorize shadow` })
  }
  const panel = asRecord(record.qualification?.panel_null_gate)
  const panelStatus = stringField(panel.status)
  if (Object.keys(panel).length > 0 && (panel.blocked === true || panelStatus !== "evaluated")) {
    blocked.push({ check_id: "S-PANEL-NULL", reason: "panel null gate must be evaluated and unblocked before shadow" })
  }
  return blocked
}

function buildReviewDiagnostics(latest: StrategyReviewReport["latest"], gate: StrategyPromotionGate): StrategyReviewDiagnostics {
  const replay = latest.replay
  const funding = asRecord(replay?.qualification?.funding_event_coverage)
  const panel = asRecord(replay?.qualification?.panel_null_gate)
  const blockedBy = gate.blocked_by.map((item) => item.check_id)
  const decay = buildDecayDiagnostics(latest)
  return {
    qualification: {
      funding_event_coverage_status: stringField(funding.status) || null,
      panel_null_status: stringField(panel.status) || null,
      panel_null_blocked: Object.keys(panel).length > 0 ? panel.blocked === true : null,
      blocked_by: blockedBy.filter((checkId) => checkId.startsWith("S-FUNDING") || checkId.startsWith("S-PANEL")),
    },
    decay,
    cost_model_feedback: buildCostModelFeedback(latest),
    failure_attribution: summarizeReviewFailures(blockedBy),
  }
}

function evaluateDecayGate(latest: StrategyReviewReport["latest"]): Array<{ check_id: string; reason: string }> {
  return buildDecayDiagnostics(latest).blocked_by
}

function buildDecayDiagnostics(latest: StrategyReviewReport["latest"]): StrategyDecayDiagnostics {
  const comparisons = [
    latest.replay && latest.shadow ? buildDecayComparison(latest.replay, latest.shadow) : null,
    latest.shadow && latest.live_small ? buildDecayComparison(latest.shadow, latest.live_small) : null,
    latest.replay && latest.live_small ? buildDecayComparison(latest.replay, latest.live_small) : null,
  ].filter((item): item is StrategyDecayDiagnostics["comparisons"][number] => item !== null)
  const blockedBy: StrategyDecayDiagnostics["blocked_by"] = []
  const replayToShadow = comparisons.find((item) => item.from === "replay" && item.to === "shadow")
  if (replayToShadow && replayToShadow.status !== "stable") {
    blockedBy.push({
      check_id: "S-DECAY-SHADOW",
      reason: `shadow avg_r retention ${replayToShadow.avg_r_ratio ?? "n/a"} is below ${MIN_SHADOW_AVG_R_RETENTION}`,
    })
  }
  const shadowToLive = comparisons.find((item) => item.from === "shadow" && item.to === "live_small")
  if (shadowToLive && shadowToLive.status !== "stable") {
    blockedBy.push({
      check_id: "S-DECAY-LIVE",
      reason: `live-small avg_r retention ${shadowToLive.avg_r_ratio ?? "n/a"} is below ${MIN_LIVE_AVG_R_RETENTION}`,
    })
  }
  const statuses = comparisons.map((item) => item.status)
  return {
    status: comparisons.length === 0
      ? "not_evaluated"
      : statuses.includes("failed")
        ? "failed"
        : statuses.includes("degraded")
          ? "degraded"
          : "stable",
    blocked_by: blockedBy,
    comparisons,
  }
}

function buildDecayComparison(from: StrategyEvidenceRecord, to: StrategyEvidenceRecord): StrategyDecayDiagnostics["comparisons"][number] {
  const ratio = from.stats.avg_r > 0 ? round(to.stats.avg_r / from.stats.avg_r) : null
  const threshold = to.kind === "live_small" ? MIN_LIVE_AVG_R_RETENTION : MIN_SHADOW_AVG_R_RETENTION
  const status = !isPositiveEvidence(to.stats)
    ? "failed"
    : ratio !== null && ratio < threshold
      ? "degraded"
      : "stable"
  return {
    from: from.kind,
    to: to.kind,
    from_sample_count: from.stats.sample_count,
    to_sample_count: to.stats.sample_count,
    avg_r_ratio: ratio,
    avg_r_delta: round(to.stats.avg_r - from.stats.avg_r),
    total_r_delta: round(to.stats.total_r - from.stats.total_r),
    from_cost_drag: costDrag(from),
    to_cost_drag: costDrag(to),
    status,
  }
}

function costDrag(record: StrategyEvidenceRecord): number | null {
  const value = optionalNumber(record.execution_attribution?.total_cost_drag)
  return value === undefined ? null : value
}

function buildCostModelFeedback(latest: StrategyReviewReport["latest"]): CostModelFeedback {
  const source = latest.live_small ?? latest.shadow
  if (!source) {
    return {
      status: "not_evaluated",
      source_kind: null,
      sample_count: 0,
      observed_drag_r_per_trade: { fee: null, slippage: null, funding: null, total: null },
      replay_assumed_cost_drag_r_per_trade: null,
      cost_drag_delta_r_per_trade: null,
      recommended_extra_cost_r_per_trade: null,
      capacity_buckets: [],
      recommended_action: "Collect review-derived shadow or live-small attribution before recalibrating replay costs.",
    }
  }
  const attr = source.execution_attribution
  const replayCostPerTrade = latest.replay ? perTrade(costDrag(latest.replay), latest.replay.stats.sample_count) : null
  if (!hasCompleteExecutionAttribution(attr)) {
    return {
      status: "missing_attribution",
      source_kind: source.kind,
      sample_count: source.stats.sample_count,
      observed_drag_r_per_trade: {
        fee: perTrade(attr?.total_fee_drag, source.stats.sample_count),
        slippage: perTrade(attr?.total_slippage_drag, source.stats.sample_count),
        funding: perTrade(attr?.total_funding_drag, source.stats.sample_count),
        total: perTrade(attr?.total_cost_drag, source.stats.sample_count),
      },
      replay_assumed_cost_drag_r_per_trade: replayCostPerTrade,
      cost_drag_delta_r_per_trade: null,
      recommended_extra_cost_r_per_trade: null,
      capacity_buckets: [],
      recommended_action: "Backfill fee, slippage, and funding attribution before changing replay cost stress.",
    }
  }
  const observedTotal = perTrade(attr?.total_cost_drag, source.stats.sample_count)
  const observedSlippage = perTrade(attr?.total_slippage_drag, source.stats.sample_count)
  return {
    status: "ready",
    source_kind: source.kind,
    sample_count: source.stats.sample_count,
    observed_drag_r_per_trade: {
      fee: perTrade(attr?.total_fee_drag, source.stats.sample_count),
      slippage: observedSlippage,
      funding: perTrade(attr?.total_funding_drag, source.stats.sample_count),
      total: observedTotal,
    },
    replay_assumed_cost_drag_r_per_trade: replayCostPerTrade,
    cost_drag_delta_r_per_trade: observedTotal !== null && replayCostPerTrade !== null ? round(observedTotal - replayCostPerTrade) : null,
    recommended_extra_cost_r_per_trade: observedTotal,
    capacity_buckets: [{
      bucket: "unknown_size",
      sample_count: source.stats.sample_count,
      avg_slippage_drag_r: observedSlippage,
      avg_total_cost_drag_r: observedTotal,
    }],
    recommended_action: observedTotal !== null && observedTotal > 0.02
      ? "Raise replay cost stress or reduce turnover before any live-small increase."
      : "Feed observed per-trade cost drag into the next replay cost stress and keep collecting samples.",
  }
}

function perTrade(value: number | undefined | null, sampleCount: number): number | null {
  return value === undefined || value === null || !Number.isFinite(value) || sampleCount <= 0
    ? null
    : round(value / sampleCount)
}

function summarizeReviewFailures(checkIds: string[]): StrategyReviewDiagnostics["failure_attribution"] {
  const groups = new Map<string, Set<string>>()
  for (const checkId of checkIds) {
    const area = reviewFailureArea(checkId)
    if (!groups.has(area)) groups.set(area, new Set())
    groups.get(area)!.add(checkId)
  }
  return Array.from(groups.entries())
    .map(([area, ids]) => ({
      area,
      count: checkIds.filter((checkId) => reviewFailureArea(checkId) === area).length,
      check_ids: Array.from(ids).sort(),
      next_action: reviewFailureNextAction(area),
    }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area))
}

function reviewFailureArea(checkId: string): string {
  if (checkId.startsWith("S-FUNDING")) return "funding_coverage"
  if (checkId.startsWith("S-PANEL")) return "panel_null"
  if (checkId.startsWith("S-OOS") || checkId === "S-HOLDOUT-MISSING" || checkId === "S-SEARCH-BUDGET" || checkId === "S-PARAM-COUNT") return "anti_overfit"
  if (checkId.startsWith("S-ROBUSTNESS")) return "robustness"
  if (checkId.startsWith("S-SHADOW-ATTRIBUTION")) return "shadow_execution_attribution"
  if (checkId.startsWith("S-SHADOW")) return "shadow_quality"
  if (checkId.startsWith("S-DECAY")) return "replay_to_live_decay"
  if (checkId.startsWith("S-REPLAY")) return "replay_quality"
  return "promotion_gate"
}

function reviewFailureNextAction(area: string): string {
  switch (area) {
    case "funding_coverage":
      return "Backfill exact funding coverage before treating replay evidence as shadow-ready."
    case "panel_null":
      return "Re-run or reject the candidate through panel R&D; do not use single-asset evidence alone."
    case "anti_overfit":
      return "Use locked holdout or walk-forward proof within the declared search budget."
    case "robustness":
      return "Fix regime, cost, or parameter fragility before promotion."
    case "shadow_execution_attribution":
      return "Aggregate real shadow fee, slippage, and funding drag before live-small."
    case "shadow_quality":
      return "Collect more positive shadow samples before live-small."
    case "replay_to_live_decay":
      return "Treat missing edge as execution/reality decay; recalibrate costs or reject the setup before increasing risk."
    case "replay_quality":
      return "Produce fresh positive replay evidence before promotion."
    default:
      return "Inspect promotion gate blockers before changing strategy status."
  }
}

function normalizeAntiOverfitProof(proof: AntiOverfitProof): AntiOverfitProof {
  return {
    method: proof.method,
    ...(proof.stage ? { stage: proof.stage } : {}),
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

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
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
  appendShadowEvidenceFromReviews,
  appendStrategyEvidence,
  blockedForTransition,
  evaluateStrategyGate,
  loadEvidenceLedger,
  policyHashForFile,
  promoteStrategy,
  reviewStrategy,
  runStrategyCycle,
  syncShadowEvidenceFromReviews,
  updateStrategyStatus,
  EVIDENCE_KINDS,
  PROMOTE_RESULT_STATUSES,
  SHADOW_EVIDENCE_SYNC_STATUSES,
  STRATEGY_STATUSES,
  type EvidenceKind,
  type EvidenceStats,
  type AntiOverfitProof,
  type EvidenceFingerprint,
  type PromoteResultStatus,
  type PromoteStrategyResult,
  type ShadowEvidenceSyncStatus,
  type ShadowEvidenceSyncResult,
  type RobustnessProof,
  type StrategyCycleResult,
  type EvidenceQualification,
  type StrategyEvidenceRecord,
  type StrategyPromotionGate,
  type StrategyReviewDiagnostics,
  type StrategyReviewReport,
  type StrategyStatus,
}
