import { canonicalHash } from "./replay-contracts"
import {
  assertReplayPortfolioCycleSequencePlan,
  type ReplayPortfolioCycleSequencePlan,
} from "./replay-portfolio-cycle-sequence-contracts"
import {
  assertReplayIntegratedPortfolioArtifactManifest,
  assertReplayIntegratedPortfolioResult,
  type ReplayIntegratedPortfolioArtifactManifest,
  type ReplayIntegratedPortfolioPlan,
  type ReplayIntegratedPortfolioResult,
} from "./replay-integrated-portfolio-contracts"
import {
  assertReplayPortfolioAllocationResult,
  type ReplayPortfolioAllocationAuthorityBinding,
  type ReplayPortfolioAllocationPlan,
  type ReplayPortfolioAllocationResult,
} from "./replay-portfolio-allocation-contracts"
import {
  assertReplayRuntimeSharedWalletRiskResult,
  type ReplayRuntimeSharedWalletRiskPlan,
  type ReplayRuntimeSharedWalletRiskResult,
} from "./replay-runtime-shared-wallet-risk-contracts"
import type { ReplayPortfolioEvidenceAuthorityBinding } from
  "./replay-runtime-shared-wallet-artifact-contracts"
import {
  assertReplayPortfolioMarkRiskRevaluationArtifactManifest,
  assertReplayPortfolioMarkRiskRevaluationEvidence,
  type ReplayPortfolioMarkRiskRevaluationArtifactManifest,
  type ReplayPortfolioMarkRiskRevaluationEvidence,
} from "./replay-portfolio-mark-risk-revaluation-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
} from "./replay-portfolio-protective-terminal-contracts"
import {
  assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  assertReplayPortfolioProtectiveTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTerminalAccountingEvidence,
} from "./replay-portfolio-protective-terminal-accounting-contracts"

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-result.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION =
  "predeclared-cycle-p9-p14-p15-p16-commit-chain-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_LIMITATIONS = [
  "one_to_eight_predeclared_cycles_only",
  "each_cycle_requires_protective_terminal_full_flat_before_successor",
  "successor_opening_cash_from_predecessor_committed_protective_terminal_trial_balance",
  "initial_full_position_simple_bracket_no_mutation_partial_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAuthority {
  reservation_hash: string
  issued_at: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
}

export interface ReplayPortfolioProtectiveTerminalCycleExecution {
  cycle_index: number
  integrated_plan: ReplayIntegratedPortfolioPlan
  allocation_plan: ReplayPortfolioAllocationPlan
  allocation_authority: ReplayPortfolioAllocationAuthorityBinding & ReplayPortfolioEvidenceAuthorityBinding
  allocation_result: ReplayPortfolioAllocationResult
  risk_plan: ReplayRuntimeSharedWalletRiskPlan
  risk_authority: ReplayPortfolioEvidenceAuthorityBinding
  risk_result: ReplayRuntimeSharedWalletRiskResult
  integrated_result: ReplayIntegratedPortfolioResult
  integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
  revaluation_evidence: ReplayPortfolioMarkRiskRevaluationEvidence
  revaluation_manifest: ReplayPortfolioMarkRiskRevaluationArtifactManifest
  protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
  protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  accounting_evidence: ReplayPortfolioProtectiveTerminalAccountingEvidence
  accounting_manifest: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest
}

export interface ReplayPortfolioProtectiveTerminalCycleCommit {
  cycle_commit_hash: string
  cycle_index: number
  opening_available_cash: number
  allocation_result_hash: string
  risk_result_hash: string
  integrated_result_hash: string
  integrated_artifact_manifest_hash: string
  mark_risk_revaluation_evidence_hash: string
  mark_risk_revaluation_artifact_manifest_hash: string
  protective_terminal_evidence_hash: string
  protective_terminal_artifact_manifest_hash: string
  protective_terminal_accounting_evidence_hash: string
  protective_terminal_accounting_artifact_manifest_hash: string
  terminal_owner_set_hash: string
  full_flat_close_time: string
  ending_available_cash: number
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION
  cycle_commits_hash: string
  result_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceResult {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  settlement_asset: string
  cycle_count: number
  cycle_commits: ReplayPortfolioProtectiveTerminalCycleCommit[]
  cycle_commits_hash: string
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveTerminalCycleSequenceFingerprint
  result_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES = [
  "cycle_sequence_plan",
  "cycle_sequence_reservation",
  "cycle_commits",
  "protective_terminal_cycle_sequence_fingerprint",
  "protective_terminal_cycle_sequence_result",
] as const
export type ReplayPortfolioProtectiveTerminalCycleSequenceArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  sequence_result_hash: string
  sequence_fingerprint_hash: string
  cycle_commits_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-terminal-cycle-sequence-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTerminalCycleSequenceOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  status: "completed" | "failed"
  result: ReplayPortfolioProtectiveTerminalCycleSequenceResult | null
  artifact_manifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "protective-cycle-sequence-input-invalid" | "protective-cycle-allocation-failed"
      | "protective-cycle-risk-failed" | "protective-cycle-integrated-artifact-failed"
      | "protective-cycle-revaluation-failed" | "protective-cycle-terminal-failed"
      | "protective-cycle-accounting-failed" | "protective-cycle-not-full-flat"
      | "protective-cycle-sequence-artifact-failed"
    cycle_index: number | null
    message: string
    partial_sequence_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveTerminalCycleCommitHash(
  value: ReplayPortfolioProtectiveTerminalCycleCommit
    | Omit<ReplayPortfolioProtectiveTerminalCycleCommit, "cycle_commit_hash">,
): string {
  const { cycle_commit_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleCommit
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceFingerprintHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceFingerprint
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleSequenceFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceResultHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceResult
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceResult, "result_hash">,
): string {
  const { result_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleSequenceResult
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceArtifactManifestHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalCycleSequenceOutcomeHash(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceOutcome
    | Omit<ReplayPortfolioProtectiveTerminalCycleSequenceOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalCycleSequenceOutcome
  return canonicalHash(body)
}

export function createReplayPortfolioProtectiveTerminalCycleSequenceResult(input: {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioProtectiveTerminalCycleSequenceAuthority
  executions: ReplayPortfolioProtectiveTerminalCycleExecution[]
}): ReplayPortfolioProtectiveTerminalCycleSequenceResult {
  const result = createWithoutAssertion(input)
  assertReplayPortfolioProtectiveTerminalCycleSequenceResult(result, input)
  return result
}

export function assertReplayPortfolioProtectiveTerminalCycleSequenceResult(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceResult,
  source?: Parameters<typeof createReplayPortfolioProtectiveTerminalCycleSequenceResult>[0],
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || !Number.isSafeInteger(value.cycle_count) || value.cycle_count < 1 || value.cycle_count > 8
      || value.cycle_commits.length !== value.cycle_count
      || value.cycle_commits_hash !== canonicalHash(value.cycle_commits)
      || value.initial_cash <= 0 || value.ending_available_cash < 0
      || value.ending_reserved_isolated_collateral !== 0 || value.ending_unrealized_pnl !== 0
      || value.ending_portfolio_nav !== value.ending_available_cash
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_LIMITATIONS)
      || value.result_hash !== replayPortfolioProtectiveTerminalCycleSequenceResultHash(value)) fail("result")
  hashes([value.trial_group_hash, value.sequence_plan_hash, value.sequence_reservation_hash,
    value.cycle_commits_hash, value.fingerprint.fingerprint_hash, value.result_hash])
  let priorCash = value.initial_cash
  let priorClose = Number.NEGATIVE_INFINITY
  value.cycle_commits.forEach((commit, index) => {
    hashes(Object.entries(commit).filter(([name]) => name.endsWith("_hash")).map(([, hash]) => hash as string))
    if (commit.cycle_index !== index + 1 || commit.opening_available_cash !== priorCash
        || commit.ending_available_cash < 0 || !utc(commit.full_flat_close_time)
        || Date.parse(commit.full_flat_close_time) <= priorClose
        || commit.cycle_commit_hash !== replayPortfolioProtectiveTerminalCycleCommitHash(commit)) fail("cycle commit")
    priorCash = commit.ending_available_cash
    priorClose = Date.parse(commit.full_flat_close_time)
  })
  if (priorCash !== value.ending_available_cash) fail("cash bridge")
  const fingerprint = value.fingerprint
  const { fingerprint: _fingerprint, ...bodyWithoutFingerprintAndHash } = value
  const { result_hash: _resultHash, ...bodyWithoutFingerprint } = bodyWithoutFingerprintAndHash
  const provisionalResultHash = canonicalHash(bodyWithoutFingerprint)
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.sequence_plan_hash !== value.sequence_plan_hash
      || fingerprint.sequence_reservation_hash !== value.sequence_reservation_hash
      || fingerprint.policy_version !== value.policy_version
      || fingerprint.cycle_commits_hash !== value.cycle_commits_hash
      || fingerprint.result_hash !== provisionalResultHash
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash
        !== replayPortfolioProtectiveTerminalCycleSequenceFingerprintHash(fingerprint)) fail("fingerprint")
  if (source) {
    const expected = createWithoutAssertion(source)
    if (canonicalHash(value) !== canonicalHash(expected)) fail("source binding")
  }
}

function createWithoutAssertion(
  input: Parameters<typeof createReplayPortfolioProtectiveTerminalCycleSequenceResult>[0],
): ReplayPortfolioProtectiveTerminalCycleSequenceResult {
  const commits = validateExecutions(input)
  const bodyWithoutFingerprint = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION,
    experiment_id: input.reservation.experiment_id,
    trial_group_id: input.reservation.trial_group_id,
    trial_group_hash: input.reservation.trial_group_hash,
    portfolio_id: input.plan.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash,
    sequence_reservation_hash: input.reservation.reservation_hash,
    settlement_asset: input.reservation.settlement_asset,
    cycle_count: commits.length,
    cycle_commits: commits,
    cycle_commits_hash: canonicalHash(commits),
    initial_cash: input.reservation.initial_cash,
    ending_available_cash: commits.at(-1)!.ending_available_cash,
    ending_reserved_isolated_collateral: 0 as const,
    ending_unrealized_pnl: 0 as const,
    ending_portfolio_nav: commits.at(-1)!.ending_available_cash,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_LIMITATIONS,
  }
  const fingerprintBody = {
    experiment_id: input.reservation.experiment_id, trial_group_id: input.reservation.trial_group_id,
    trial_group_hash: input.reservation.trial_group_hash, portfolio_id: input.plan.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash, sequence_reservation_hash: input.reservation.reservation_hash,
    policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION,
    cycle_commits_hash: canonicalHash(commits), result_hash: canonicalHash(bodyWithoutFingerprint),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_LIMITATIONS),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioProtectiveTerminalCycleSequenceFingerprintHash(fingerprintBody) }
  const body = { ...bodyWithoutFingerprint, fingerprint }
  return { ...body, result_hash: replayPortfolioProtectiveTerminalCycleSequenceResultHash(body) }
}

function validateExecutions(input: {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioProtectiveTerminalCycleSequenceAuthority
  executions: ReplayPortfolioProtectiveTerminalCycleExecution[]
}): ReplayPortfolioProtectiveTerminalCycleCommit[] {
  assertReplayPortfolioCycleSequencePlan(input.plan)
  if (input.plan.sequence_reservation_hash !== input.reservation.reservation_hash
      || input.executions.length !== input.plan.cycle_count) fail("authority coverage")
  const commits: ReplayPortfolioProtectiveTerminalCycleCommit[] = []
  let priorCash = input.reservation.initial_cash
  let priorClose = Number.NEGATIVE_INFINITY
  input.executions.forEach((execution, index) => {
    const cycleIndex = index + 1
    assertReplayPortfolioAllocationResult(execution.allocation_result, execution.allocation_plan,
      execution.allocation_authority)
    assertReplayRuntimeSharedWalletRiskResult(execution.risk_result, execution.risk_plan,
      execution.risk_authority, execution.allocation_result)
    assertReplayIntegratedPortfolioResult(execution.integrated_result, execution.integrated_plan,
      execution.allocation_result, execution.risk_result)
    assertReplayIntegratedPortfolioArtifactManifest(execution.integrated_manifest)
    assertReplayPortfolioMarkRiskRevaluationEvidence(execution.revaluation_evidence)
    assertReplayPortfolioMarkRiskRevaluationArtifactManifest(execution.revaluation_manifest)
    assertReplayPortfolioProtectiveTerminalEvidence(execution.protective_terminal_evidence)
    assertReplayPortfolioProtectiveTerminalArtifactManifest(execution.protective_terminal_manifest)
    assertReplayPortfolioProtectiveTerminalAccountingEvidence(execution.accounting_evidence, {
      protective_terminal_evidence: execution.protective_terminal_evidence,
      protective_terminal_manifest: execution.protective_terminal_manifest,
      risk_result: execution.risk_result,
    })
    assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest(execution.accounting_manifest)
    const terminal = execution.protective_terminal_evidence
    const accounting = execution.accounting_evidence
    const closeTime = latestCycleCloseTime(execution)
    if (execution.cycle_index !== cycleIndex
        || execution.integrated_plan.plan_hash !== input.plan.cycles[index]!.integrated_plan_hash
        || execution.allocation_authority.shared_initial_cash !== priorCash
        || execution.risk_authority.shared_initial_cash !== priorCash
        || terminal.shared_initial_cash !== priorCash || accounting.shared_initial_cash !== priorCash
        || terminal.lane_records.some((record) => record.ending_open)
        || terminal.ending_reserved_isolated_collateral !== 0 || terminal.ending_unrealized_pnl !== 0
        || terminal.ending_gross_mark_exposure !== 0 || terminal.ending_net_mark_exposure !== 0
        || terminal.ending_portfolio_frozen_stop_risk !== 0
        || accounting.trial_balance.ending_reserved_isolated_collateral !== 0
        || accounting.trial_balance.ending_unrealized_pnl !== 0
        || accounting.trial_balance.ending_available_cash !== terminal.ending_available_cash
        || Date.parse(closeTime) <= priorClose) fail("cycle closure")
    const body: Omit<ReplayPortfolioProtectiveTerminalCycleCommit, "cycle_commit_hash"> = {
      cycle_index: cycleIndex,
      opening_available_cash: priorCash,
      allocation_result_hash: execution.allocation_result.result_hash,
      risk_result_hash: execution.risk_result.result_hash,
      integrated_result_hash: execution.integrated_result.result_hash,
      integrated_artifact_manifest_hash: execution.integrated_manifest.manifest_hash,
      mark_risk_revaluation_evidence_hash: execution.revaluation_evidence.evidence_hash,
      mark_risk_revaluation_artifact_manifest_hash: execution.revaluation_manifest.manifest_hash,
      protective_terminal_evidence_hash: terminal.evidence_hash,
      protective_terminal_artifact_manifest_hash: execution.protective_terminal_manifest.manifest_hash,
      protective_terminal_accounting_evidence_hash: accounting.evidence_hash,
      protective_terminal_accounting_artifact_manifest_hash: execution.accounting_manifest.manifest_hash,
      terminal_owner_set_hash: canonicalHash(terminal.lane_records.map((record) => ({
        lane_id: record.lane_id, owner: record.owner, terminal_source_hash: record.terminal_source_hash,
      }))),
      full_flat_close_time: closeTime,
      ending_available_cash: accounting.trial_balance.ending_available_cash,
      trial_balance_hash: accounting.trial_balance.trial_balance_hash,
    }
    commits.push({ ...body, cycle_commit_hash: replayPortfolioProtectiveTerminalCycleCommitHash(body) })
    priorCash = body.ending_available_cash
    priorClose = Date.parse(closeTime)
  })
  return commits
}

function latestCycleCloseTime(execution: ReplayPortfolioProtectiveTerminalCycleExecution): string {
  const times = execution.protective_terminal_evidence.lane_records
    .flatMap((record) => record.terminal_time ? [record.terminal_time] : [])
  if (times.length === 0) {
    const fallback = execution.integrated_result.state_chain.at(-1)?.event_time
    if (!fallback) fail("cycle close time")
    return fallback
  }
  return times.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!
}

export function assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
): void {
  if (value.schema_version
        !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.files.some((file) => !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || !file.ref)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-terminal-cycle-sequence-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || !utc(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioProtectiveTerminalCycleSequenceArtifactManifestHash(value)) {
    fail("artifact manifest")
  }
  hashes([value.sequence_result_hash, value.sequence_fingerprint_hash, value.cycle_commits_hash,
    ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveTerminalCycleSequenceOutcome(
  value: ReplayPortfolioProtectiveTerminalCycleSequenceOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.result !== null && value.artifact_manifest !== null
        && value.failure === null)
      || value.status === "failed" !== (value.result === null && value.artifact_manifest === null
        && value.failure !== null)
      || value.failure && value.failure.partial_sequence_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveTerminalCycleSequenceOutcomeHash(value)) fail("outcome")
  if (value.result) assertReplayPortfolioProtectiveTerminalCycleSequenceResult(value.result)
  if (value.artifact_manifest) {
    assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest(value.artifact_manifest)
  }
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}
function utc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
}
function fail(scope: string): never {
  throw new Error(`Portfolio Protective Terminal Cycle Sequence ${scope} invalid`)
}
