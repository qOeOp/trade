import { canonicalHash } from "./replay-contracts"
import {
  assertReplayIntegratedPortfolioArtifactManifest,
  replayIntegratedPortfolioResultHash,
  type ReplayIntegratedPortfolioArtifactManifest,
  type ReplayIntegratedPortfolioResult,
} from "./replay-integrated-portfolio-contracts"
import {
  replayPortfolioAllocationResultHash,
  type ReplayPortfolioAllocationResult,
} from "./replay-portfolio-allocation-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskResult,
} from "./replay-runtime-shared-wallet-risk-contracts"

export const REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-mark-risk-revaluation-evidence.v1" as const
export const REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-mark-risk-revaluation-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-mark-risk-revaluation-outcome.v1" as const
export const REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_POLICY_VERSION =
  "exact-mark-notional-frozen-stop-budget-observation-only-v1" as const

export const REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_LIMITATIONS = [
  "exact_mark_notional_and_initial_frozen_protective_stop_only",
  "cap_breach_is_observation_only_no_automatic_liquidation_or_reallocation",
  "protective_stop_crossing_is_resolution_limited_no_synthetic_fill",
  "no_stop_mutation_partial_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioMarkRiskCapBreach =
  | "gross_exposure_limit_breached"
  | "absolute_net_exposure_limit_breached"
  | "portfolio_frozen_stop_risk_limit_breached"

export interface ReplayPortfolioMarkRiskPositionSnapshot {
  lane_id: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entry_price: number
  current_mark_price: number
  mark_source_kind: "entry_fill" | "exact_mark"
  mark_source_hash: string
  mark_notional: number
  signed_mark_notional: number
  protective_stop_execution_price: number
  entry_fee: number
  projected_stop_exit_fee: number
  frozen_stop_risk_amount: number
  prospective_mark_to_stop_drawdown: number | null
  stop_relation: "not_crossed" | "crossed_or_equal_without_portfolio_stop_execution"
}

export interface ReplayPortfolioMarkRiskTransition {
  transition_hash: string
  transition_sequence: number
  queue_ordinal: number
  event_time: string
  event_role: "funding" | "risk_observation" | "liquidation" | "exit" | "entry"
  lane_id: string
  source_event_hash: string
  revaluation_kind: "carry" | "entry_mark" | "exact_mark" | "full_close_release"
  positions_after: ReplayPortfolioMarkRiskPositionSnapshot[]
  positions_after_hash: string
  gross_mark_exposure_before: number
  gross_mark_exposure_after: number
  net_mark_exposure_before: number
  net_mark_exposure_after: number
  portfolio_frozen_stop_risk_before: number
  portfolio_frozen_stop_risk_after: number
  portfolio_prospective_stop_drawdown_before: number | null
  portfolio_prospective_stop_drawdown_after: number | null
  resolution_limited_lane_ids_after: string[]
  cap_breaches_after: ReplayPortfolioMarkRiskCapBreach[]
  cap_effect: "observation_only_no_automatic_liquidation_or_reallocation"
}

export interface ReplayPortfolioMarkRiskRevaluationFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  integrated_plan_hash: string
  allocation_plan_hash: string
  allocation_reservation_hash: string
  allocation_result_hash: string
  risk_plan_hash: string
  risk_reservation_hash: string
  risk_result_hash: string
  integrated_result_hash: string
  integrated_artifact_manifest_hash: string
  transitions_hash: string
  limits_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioMarkRiskRevaluationEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  integrated_plan_hash: string
  allocation_plan_hash: string
  allocation_reservation_hash: string
  allocation_result_hash: string
  risk_plan_hash: string
  risk_reservation_hash: string
  risk_result_hash: string
  integrated_result_hash: string
  integrated_artifact_manifest_hash: string
  settlement_asset: string
  limits: {
    max_gross_exposure_amount: number
    max_abs_net_exposure_amount: number
    max_portfolio_risk_amount: number
  }
  transitions: ReplayPortfolioMarkRiskTransition[]
  transitions_hash: string
  exact_mark_revaluation_count: number
  cap_breach_transition_sequences: number[]
  resolution_limited_transition_sequences: number[]
  ending_gross_mark_exposure: number
  ending_net_mark_exposure: number
  ending_portfolio_frozen_stop_risk: number
  ending_portfolio_prospective_stop_drawdown: number | null
  limitations: typeof REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_LIMITATIONS
  fingerprint: ReplayPortfolioMarkRiskRevaluationFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES = [
  "integrated_result", "integrated_artifact_manifest", "allocation_reservation", "allocation_result",
  "risk_result", "revaluation_transitions", "revaluation_fingerprint", "revaluation_evidence",
] as const
export type ReplayPortfolioMarkRiskRevaluationArtifactRole =
  typeof REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES[number]

export interface ReplayPortfolioMarkRiskRevaluationArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  revaluation_evidence_hash: string
  revaluation_fingerprint_hash: string
  integrated_result_hash: string
  files: Array<{
    role: ReplayPortfolioMarkRiskRevaluationArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES
    commit_marker: "portfolio-mark-risk-revaluation-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioMarkRiskRevaluationOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  integrated_plan_hash: string
  status: "completed" | "failed"
  integrated_result: ReplayIntegratedPortfolioResult | null
  evidence: ReplayPortfolioMarkRiskRevaluationEvidence | null
  artifact_manifest: ReplayPortfolioMarkRiskRevaluationArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "integrated-execution-failed" | "integrated-artifact-read-failed"
      | "mark-risk-revaluation-invalid" | "mark-risk-revaluation-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioMarkRiskPositionSnapshotHash(
  value: ReplayPortfolioMarkRiskPositionSnapshot,
): string { return canonicalHash(value) }

export function replayPortfolioMarkRiskTransitionHash(
  value: ReplayPortfolioMarkRiskTransition | Omit<ReplayPortfolioMarkRiskTransition, "transition_hash">,
): string {
  const { transition_hash: _hash, ...body } = value as ReplayPortfolioMarkRiskTransition
  return canonicalHash(body)
}

export function replayPortfolioMarkRiskRevaluationFingerprintHash(
  value: ReplayPortfolioMarkRiskRevaluationFingerprint
    | Omit<ReplayPortfolioMarkRiskRevaluationFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioMarkRiskRevaluationFingerprint
  return canonicalHash(body)
}

export function replayPortfolioMarkRiskRevaluationEvidenceHash(
  value: ReplayPortfolioMarkRiskRevaluationEvidence
    | Omit<ReplayPortfolioMarkRiskRevaluationEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } = value as ReplayPortfolioMarkRiskRevaluationEvidence
  return canonicalHash(body)
}

export function replayPortfolioMarkRiskRevaluationArtifactManifestHash(
  value: ReplayPortfolioMarkRiskRevaluationArtifactManifest
    | Omit<ReplayPortfolioMarkRiskRevaluationArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioMarkRiskRevaluationArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioMarkRiskRevaluationOutcomeHash(
  value: ReplayPortfolioMarkRiskRevaluationOutcome
    | Omit<ReplayPortfolioMarkRiskRevaluationOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioMarkRiskRevaluationOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioMarkRiskRevaluationEvidence(
  value: ReplayPortfolioMarkRiskRevaluationEvidence,
  input?: {
    allocation_result: ReplayPortfolioAllocationResult
    risk_result: ReplayRuntimeSharedWalletRiskResult
    integrated_result: ReplayIntegratedPortfolioResult
    integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
  },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_POLICY_VERSION
      || value.experiment_id.trim() === "" || value.trial_group_id.trim() === ""
      || value.portfolio_id.trim() === "" || value.settlement_asset.trim() === ""
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_LIMITATIONS)) {
    fail("Evidence identity/policy")
  }
  hashes([
    value.trial_group_hash, value.integrated_plan_hash, value.allocation_plan_hash,
    value.allocation_reservation_hash, value.allocation_result_hash, value.risk_plan_hash,
    value.risk_reservation_hash, value.risk_result_hash, value.integrated_result_hash,
    value.integrated_artifact_manifest_hash, value.transitions_hash, value.evidence_hash,
  ])
  let gross = 0
  let net = 0
  let risk = 0
  let prospective: number | null = 0
  value.transitions.forEach((transition, index) => {
    if (transition.transition_sequence !== index + 1 || transition.queue_ordinal !== index + 1
        || transition.transition_hash !== replayPortfolioMarkRiskTransitionHash(transition)
        || transition.positions_after_hash !== canonicalHash(transition.positions_after)
        || transition.gross_mark_exposure_before !== gross || transition.net_mark_exposure_before !== net
        || transition.portfolio_frozen_stop_risk_before !== risk
        || transition.portfolio_prospective_stop_drawdown_before !== prospective
        || transition.cap_effect !== "observation_only_no_automatic_liquidation_or_reallocation") {
      fail("transition chain")
    }
    assertPositions(transition.positions_after)
    const sums = aggregate(transition.positions_after)
    const breaches = capBreaches(sums.gross, sums.net, sums.risk, value.limits)
    if (transition.gross_mark_exposure_after !== sums.gross
        || transition.net_mark_exposure_after !== sums.net
        || transition.portfolio_frozen_stop_risk_after !== sums.risk
        || transition.portfolio_prospective_stop_drawdown_after !== sums.prospective
        || JSON.stringify(transition.resolution_limited_lane_ids_after) !== JSON.stringify(sums.limited)
        || JSON.stringify(transition.cap_breaches_after) !== JSON.stringify(breaches)) fail("transition aggregate")
    gross = sums.gross
    net = sums.net
    risk = sums.risk
    prospective = sums.prospective
  })
  const exactCount = value.transitions.filter((item) => item.revaluation_kind === "exact_mark").length
  const breachSequences = value.transitions.filter((item) => item.cap_breaches_after.length > 0)
    .map((item) => item.transition_sequence)
  const limitedSequences = value.transitions.filter((item) => item.resolution_limited_lane_ids_after.length > 0)
    .map((item) => item.transition_sequence)
  if (value.transitions_hash !== canonicalHash(value.transitions)
      || value.exact_mark_revaluation_count !== exactCount
      || JSON.stringify(value.cap_breach_transition_sequences) !== JSON.stringify(breachSequences)
      || JSON.stringify(value.resolution_limited_transition_sequences) !== JSON.stringify(limitedSequences)
      || value.ending_gross_mark_exposure !== gross || value.ending_net_mark_exposure !== net
      || value.ending_portfolio_frozen_stop_risk !== risk
      || value.ending_portfolio_prospective_stop_drawdown !== prospective) fail("Evidence summary")
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id
      || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash
      || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.integrated_plan_hash !== value.integrated_plan_hash
      || fingerprint.allocation_plan_hash !== value.allocation_plan_hash
      || fingerprint.allocation_reservation_hash !== value.allocation_reservation_hash
      || fingerprint.allocation_result_hash !== value.allocation_result_hash
      || fingerprint.risk_plan_hash !== value.risk_plan_hash
      || fingerprint.risk_reservation_hash !== value.risk_reservation_hash
      || fingerprint.risk_result_hash !== value.risk_result_hash
      || fingerprint.integrated_result_hash !== value.integrated_result_hash
      || fingerprint.integrated_artifact_manifest_hash !== value.integrated_artifact_manifest_hash
      || fingerprint.transitions_hash !== value.transitions_hash
      || fingerprint.limits_hash !== canonicalHash(value.limits)
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash !== replayPortfolioMarkRiskRevaluationFingerprintHash(fingerprint)) {
    fail("Fingerprint")
  }
  if (value.evidence_hash !== replayPortfolioMarkRiskRevaluationEvidenceHash(value)) fail("Evidence hash")
  if (input) assertSourceBindings(value, input)
}

function assertSourceBindings(
  value: ReplayPortfolioMarkRiskRevaluationEvidence,
  input: {
    allocation_result: ReplayPortfolioAllocationResult
    risk_result: ReplayRuntimeSharedWalletRiskResult
    integrated_result: ReplayIntegratedPortfolioResult
    integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
  },
): void {
  assertReplayIntegratedPortfolioArtifactManifest(input.integrated_manifest)
  if (input.allocation_result.result_hash !== replayPortfolioAllocationResultHash(input.allocation_result)
      || input.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(input.risk_result)
      || input.integrated_result.result_hash !== replayIntegratedPortfolioResultHash(input.integrated_result)
      || value.portfolio_id !== input.integrated_result.portfolio_id
      || value.allocation_result_hash !== input.allocation_result.result_hash
      || value.risk_result_hash !== input.risk_result.result_hash
      || value.integrated_result_hash !== input.integrated_result.result_hash
      || value.integrated_artifact_manifest_hash !== input.integrated_manifest.manifest_hash
      || input.integrated_manifest.integrated_result_hash !== input.integrated_result.result_hash
      || value.transitions.length !== input.risk_result.global_source_event_queue.length) fail("source binding")
  value.transitions.forEach((transition, index) => {
    const source = input.risk_result.global_source_event_queue[index]
    if (!source || transition.queue_ordinal !== source.queue_ordinal
        || transition.event_time !== source.event_time || transition.event_role !== source.event_role
        || transition.lane_id !== source.lane_id || transition.source_event_hash !== source.event_hash) {
      fail("source transition binding")
    }
  })
}

function assertPositions(value: ReplayPortfolioMarkRiskPositionSnapshot[]): void {
  let prior = ""
  for (const position of value) {
    if (position.lane_id <= prior || position.symbol.trim() === "" || position.quantity <= 0
        || position.entry_price <= 0 || position.current_mark_price <= 0
        || position.mark_notional <= 0
        || position.signed_mark_notional !== (position.side === "long"
          ? position.mark_notional : -position.mark_notional)
        || position.protective_stop_execution_price <= 0 || position.entry_fee < 0
        || position.projected_stop_exit_fee < 0 || position.frozen_stop_risk_amount <= 0
        || (position.stop_relation === "not_crossed"
          && (position.prospective_mark_to_stop_drawdown === null
            || position.prospective_mark_to_stop_drawdown < 0))
        || (position.stop_relation === "crossed_or_equal_without_portfolio_stop_execution"
          && position.prospective_mark_to_stop_drawdown !== null)) fail("Position Snapshot")
    hashes([position.mark_source_hash])
    prior = position.lane_id
  }
}

function aggregate(positions: ReplayPortfolioMarkRiskPositionSnapshot[]): {
  gross: number; net: number; risk: number; prospective: number | null; limited: string[]
} {
  const gross = add(...positions.map((position) => position.mark_notional))
  const net = add(...positions.map((position) => position.signed_mark_notional))
  const risk = add(...positions.map((position) => position.frozen_stop_risk_amount))
  const limited = positions.filter((position) =>
    position.stop_relation === "crossed_or_equal_without_portfolio_stop_execution").map((position) => position.lane_id)
  return {
    gross, net, risk,
    prospective: limited.length > 0 ? null
      : add(...positions.map((position) => position.prospective_mark_to_stop_drawdown ?? 0)),
    limited,
  }
}

function capBreaches(
  gross: number,
  net: number,
  risk: number,
  limits: ReplayPortfolioMarkRiskRevaluationEvidence["limits"],
): ReplayPortfolioMarkRiskCapBreach[] {
  const result: ReplayPortfolioMarkRiskCapBreach[] = []
  if (gross > limits.max_gross_exposure_amount) result.push("gross_exposure_limit_breached")
  if (Math.abs(net) > limits.max_abs_net_exposure_amount) result.push("absolute_net_exposure_limit_breached")
  if (risk > limits.max_portfolio_risk_amount) result.push("portfolio_frozen_stop_risk_limit_breached")
  return result
}

export function assertReplayPortfolioMarkRiskRevaluationArtifactManifest(
  value: ReplayPortfolioMarkRiskRevaluationArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || value.files.length !== REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES.length
      || value.files.some((file, index) =>
        file.role !== REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES[index]
        || !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || file.ref.trim() === ""
        || !/^[a-f0-9]{64}$/.test(file.sha256))
      || value.completeness.authoritative_result !== true
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_ARTIFACT_ROLES)
      || value.completeness.commit_marker !== "portfolio-mark-risk-revaluation-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioMarkRiskRevaluationArtifactManifestHash(value)) {
    fail("Artifact Manifest")
  }
  hashes([
    value.revaluation_evidence_hash, value.revaluation_fingerprint_hash,
    value.integrated_result_hash, value.manifest_hash,
  ])
}

export function assertReplayPortfolioMarkRiskRevaluationOutcome(
  value: ReplayPortfolioMarkRiskRevaluationOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_OUTCOME_SCHEMA_VERSION) fail("Outcome schema")
  if (value.status === "completed") {
    if (!value.integrated_result || !value.evidence || !value.artifact_manifest || value.failure !== null
        || value.integrated_result.result_hash !== value.artifact_manifest.integrated_result_hash
        || value.evidence.evidence_hash !== value.artifact_manifest.revaluation_evidence_hash) {
      fail("completed Outcome")
    }
    assertReplayPortfolioMarkRiskRevaluationEvidence(value.evidence)
    assertReplayPortfolioMarkRiskRevaluationArtifactManifest(value.artifact_manifest)
  } else if (value.integrated_result !== null || value.evidence !== null || value.artifact_manifest !== null
      || !value.failure || value.idempotent_replay || value.failure.partial_result_published !== false) {
    fail("failed Outcome")
  }
  if (value.outcome_hash !== replayPortfolioMarkRiskRevaluationOutcomeHash(value)) fail("Outcome hash")
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function add(...values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12))
}
function fail(message: string): never {
  throw new Error(`Replay Portfolio Mark Risk Revaluation ${message}`)
}
