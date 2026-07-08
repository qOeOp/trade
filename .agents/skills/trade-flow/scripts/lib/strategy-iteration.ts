import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Database } from "bun:sqlite"
import { loadStrategyFile, parseFrontmatter } from "./loaders"
import { hashCanonical, replayDataHash, replayHarnessHash, type ReplayProvenance, type ReplayResult } from "./replay-core"

type JSONRecord = Record<string, unknown>
type StrategyStatus = "draft" | "shadow" | "live-small" | "paused"
const EVIDENCE_KINDS = ["replay", "shadow", "live_small", "review_batch"] as const
type EvidenceKind = typeof EVIDENCE_KINDS[number]

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
  failure_attribution: Array<{ area: string; count: number; check_ids: string[]; next_action: string }>
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

function reviewStrategy(input: {
  strategyPath: string
  ledgerPath: string
  db?: Database
}): StrategyReviewReport {
  const strategy = loadStrategyFile(input.strategyPath)
  const policyHash = policyHashForFile(input.strategyPath)
  const allEvidence = loadEvidenceLedger(input.ledgerPath).filter((record) => record.strategy_id === strategy.strategy_id)
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
  }

  const replayOk = Boolean(replay && isPositiveEvidence(replay.stats) && evaluateAntiOverfit(replay).length === 0 && evaluateRobustness(replay).length === 0 && evaluateQualification(replay).length === 0)
  const shadowOk = Boolean(shadow && shadow.stats.sample_count >= 20 && isPositiveEvidence(shadow.stats) && hasCompleteExecutionAttribution(shadow.execution_attribution))
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
  return {
    qualification: {
      funding_event_coverage_status: stringField(funding.status) || null,
      panel_null_status: stringField(panel.status) || null,
      panel_null_blocked: Object.keys(panel).length > 0 ? panel.blocked === true : null,
      blocked_by: blockedBy.filter((checkId) => checkId.startsWith("S-FUNDING") || checkId.startsWith("S-PANEL")),
    },
    failure_attribution: summarizeReviewFailures(blockedBy),
  }
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
  appendStrategyEvidence,
  blockedForTransition,
  evaluateStrategyGate,
  loadEvidenceLedger,
  policyHashForFile,
  promoteStrategy,
  reviewStrategy,
  updateStrategyStatus,
  EVIDENCE_KINDS,
  type EvidenceKind,
  type EvidenceStats,
  type AntiOverfitProof,
  type EvidenceFingerprint,
  type RobustnessProof,
  type EvidenceQualification,
  type StrategyEvidenceRecord,
  type StrategyPromotionGate,
  type StrategyReviewDiagnostics,
  type StrategyReviewReport,
  type StrategyStatus,
}
