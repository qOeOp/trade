import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import { assertReplayPortfolioCycleSequencePlan, type ReplayPortfolioCycleSequencePlan } from
  "./replay-portfolio-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest,
  assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalAccount,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalEntry,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntry,
} from "./replay-portfolio-protective-stop-cancel-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopCancelTerminalEvidence,
} from "./replay-portfolio-protective-stop-cancel-terminal-contracts"

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-cycle-sequence-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-cycle-sequence-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-cancel-cycle-sequence-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_POLICY_VERSION =
  "predeclared-cycle-protective-stop-cancel-risk-degraded-roll-forward-v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION =
  "protective-stop-cancel-cycle-opening-equity-once-roll-forward-v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_LIMITATIONS = [
  "one_to_eight_predeclared_full_flat_cycles_only",
  "each_cycle_zero_or_one_predeclared_full_position_protective_stop_cancel_target_preserved",
  "successor_cash_from_predecessor_committed_cancel_trial_balance",
  "full_flat_required_before_successor_cycle_and_no_cancel_time_risk_release",
  "no_runtime_cycle_expansion_repeat_mutation_partial_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export interface ReplayPortfolioProtectiveStopCancelCycleSequenceAuthority {
  reservation_hash: string
  issued_at: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
}
export interface ReplayPortfolioProtectiveStopCancelCycleCommit {
  cycle_commit_hash: string
  cycle_index: number
  opening_available_cash: number
  cancel_terminal_evidence_hash: string
  cancel_terminal_artifact_manifest_hash: string
  cancel_terminal_accounting_evidence_hash: string
  cancel_terminal_accounting_artifact_manifest_hash: string
  risk_result_hash: string
  terminal_owner_set_hash: string
  full_flat_close_time: string
  ending_available_cash: number
  trial_balance_hash: string
}
export interface ReplayPortfolioProtectiveStopCancelCycleSequenceLedgerEntry {
  sequence_entry_hash: string
  global_ledger_sequence: number
  cycle_index: number
  cycle_ledger_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntry
}
export interface ReplayPortfolioProtectiveStopCancelCycleSequenceJournalEntry {
  sequence_entry_hash: string
  global_journal_sequence: number
  cycle_index: number
  cycle_journal_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalEntry
}
export interface ReplayPortfolioProtectiveStopCancelCycleSequenceTrialBalance {
  settlement_asset: string
  journal_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
  source_cycle_accounting_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveStopCancelTerminalAccountingJournalAccount, number>
  opening_equity_posting_count: 1
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_settled_cash: number
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}
export interface ReplayPortfolioProtectiveStopCancelCycleSequenceFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_POLICY_VERSION
  cycle_commits_hash: string
  consolidated_ledger_hash: string
  consolidated_journal_hash: string
  consolidated_trial_balance_hash: string
  limitations_hash: string
  fingerprint_hash: string
}
export interface ReplayPortfolioProtectiveStopCancelCycleSequenceEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  settlement_asset: string
  cycle_count: number
  cycle_commits: ReplayPortfolioProtectiveStopCancelCycleCommit[]
  cycle_commits_hash: string
  consolidated_ledger: ReplayPortfolioProtectiveStopCancelCycleSequenceLedgerEntry[]
  consolidated_journal: ReplayPortfolioProtectiveStopCancelCycleSequenceJournalEntry[]
  consolidated_trial_balance: ReplayPortfolioProtectiveStopCancelCycleSequenceTrialBalance
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveStopCancelCycleSequenceFingerprint
  evidence_hash: string
}
export interface ReplayPortfolioProtectiveStopCancelCycleSource {
  cycle_index: number
  cancel_terminal_evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence
  cancel_terminal_manifest: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest
  accounting_evidence: ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence
  accounting_manifest: ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest
}

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_ROLES = [
  "cycle_sequence_plan", "cycle_sequence_reservation", "cycle_cancel_terminal_artifact_manifests",
  "cycle_cancel_terminal_evidence", "cycle_cancel_terminal_accounting_artifact_manifests",
  "cycle_cancel_terminal_accounting_evidence", "consolidated_ledger", "consolidated_journal",
  "consolidated_trial_balance", "consolidated_fingerprint", "cancel_cycle_sequence_evidence",
] as const
export type ReplayPortfolioProtectiveStopCancelCycleSequenceArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_ROLES[number]
export interface ReplayPortfolioProtectiveStopCancelCycleSequenceArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  sequence_evidence_hash: string
  sequence_fingerprint_hash: string
  cycle_commits_hash: string
  files: Array<{ role: ReplayPortfolioProtectiveStopCancelCycleSequenceArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-stop-cancel-cycle-sequence-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}
export interface ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  status: "completed" | "failed"
  evidence: ReplayPortfolioProtectiveStopCancelCycleSequenceEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveStopCancelCycleSequenceArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "cancel-cycle-sequence-input-invalid" | "cancel-cycle-allocation-failed"
      | "cancel-cycle-risk-failed" | "cancel-cycle-integrated-artifact-failed"
      | "cancel-cycle-revaluation-failed" | "cancel-cycle-terminal-failed"
      | "cancel-cycle-accounting-failed" | "cancel-cycle-not-full-flat"
      | "cancel-cycle-sequence-invalid" | "cancel-cycle-sequence-artifact-failed"
    cycle_index: number | null
    message: string
    partial_sequence_result_published: false
  } | null
  outcome_hash: string
}

function hashWithout(value: object, key: string): string {
  const body = { ...value } as Record<string, unknown>; delete body[key]; return canonicalHash(body)
}
export const replayPortfolioProtectiveStopCancelCycleCommitHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleCommit | Omit<ReplayPortfolioProtectiveStopCancelCycleCommit, "cycle_commit_hash">) => hashWithout(value, "cycle_commit_hash")
export const replayPortfolioProtectiveStopCancelCycleSequenceLedgerEntryHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleSequenceLedgerEntry | Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceLedgerEntry, "sequence_entry_hash">) => hashWithout(value, "sequence_entry_hash")
export const replayPortfolioProtectiveStopCancelCycleSequenceJournalEntryHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleSequenceJournalEntry | Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceJournalEntry, "sequence_entry_hash">) => hashWithout(value, "sequence_entry_hash")
export const replayPortfolioProtectiveStopCancelCycleSequenceTrialBalanceHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleSequenceTrialBalance | Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceTrialBalance, "trial_balance_hash">) => hashWithout(value, "trial_balance_hash")
export const replayPortfolioProtectiveStopCancelCycleSequenceFingerprintHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleSequenceFingerprint | Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceFingerprint, "fingerprint_hash">) => hashWithout(value, "fingerprint_hash")
export const replayPortfolioProtectiveStopCancelCycleSequenceEvidenceHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleSequenceEvidence | Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceEvidence, "evidence_hash">) => hashWithout(value, "evidence_hash")
export const replayPortfolioProtectiveStopCancelCycleSequenceArtifactManifestHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleSequenceArtifactManifest | Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceArtifactManifest, "manifest_hash">) => hashWithout(value, "manifest_hash")
export const replayPortfolioProtectiveStopCancelCycleSequenceOutcomeHash =
  (value: ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome | Omit<ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome, "outcome_hash">) => hashWithout(value, "outcome_hash")

export function assertReplayPortfolioProtectiveStopCancelCycleSequenceEvidence(
  value: ReplayPortfolioProtectiveStopCancelCycleSequenceEvidence,
  source?: { plan: ReplayPortfolioCycleSequencePlan; cycles: ReplayPortfolioProtectiveStopCancelCycleSource[] },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || !Number.isSafeInteger(value.cycle_count) || value.cycle_count < 1 || value.cycle_count > 8
      || value.cycle_commits.length !== value.cycle_count || value.cycle_commits_hash !== canonicalHash(value.cycle_commits)
      || value.initial_cash <= 0 || value.ending_available_cash < 0
      || value.ending_reserved_isolated_collateral !== 0 || value.ending_unrealized_pnl !== 0
      || value.ending_portfolio_nav !== value.ending_available_cash
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_LIMITATIONS)
      || value.evidence_hash !== replayPortfolioProtectiveStopCancelCycleSequenceEvidenceHash(value)) fail("identity/result")
  hashes([value.trial_group_hash, value.sequence_plan_hash, value.sequence_reservation_hash,
    value.cycle_commits_hash, value.fingerprint.fingerprint_hash, value.evidence_hash])
  let cash = value.initial_cash; let close = Number.NEGATIVE_INFINITY
  value.cycle_commits.forEach((commit, index) => {
    hashes(Object.entries(commit).filter(([name]) => name.endsWith("_hash")).map(([, hash]) => hash as string))
    if (commit.cycle_index !== index + 1 || commit.opening_available_cash !== cash
        || commit.ending_available_cash < 0 || !utc(commit.full_flat_close_time)
        || Date.parse(commit.full_flat_close_time) <= close
        || commit.cycle_commit_hash !== replayPortfolioProtectiveStopCancelCycleCommitHash(commit)) fail("cycle commit")
    cash = commit.ending_available_cash; close = Date.parse(commit.full_flat_close_time)
  })
  if (cash !== value.ending_available_cash) fail("cash bridge")
  value.consolidated_ledger.forEach((entry, index) => {
    if (entry.global_ledger_sequence !== index + 1 || entry.cycle_index < 1 || entry.cycle_index > value.cycle_count
        || index > 0 && entry.cycle_index < value.consolidated_ledger[index - 1]!.cycle_index
        || entry.cycle_ledger_entry_hash !== entry.cycle_entry.ledger_entry_hash
        || entry.sequence_entry_hash !== replayPortfolioProtectiveStopCancelCycleSequenceLedgerEntryHash(entry)) fail("ledger")
  })
  if (value.consolidated_journal.filter((entry) => entry.cycle_entry.posting_kind === "opening_cash").length !== 1) fail("opening equity")
  value.consolidated_journal.forEach((entry, index) => {
    if (entry.global_journal_sequence !== index + 1 || entry.cycle_index < 1 || entry.cycle_index > value.cycle_count
        || index > 0 && entry.cycle_index < value.consolidated_journal[index - 1]!.cycle_index
        || entry.cycle_journal_entry_hash !== entry.cycle_entry.journal_entry_hash
        || entry.sequence_entry_hash !== replayPortfolioProtectiveStopCancelCycleSequenceJournalEntryHash(entry)) fail("journal")
  })
  assertTrialBalance(value.consolidated_trial_balance, value.consolidated_journal)
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.sequence_plan_hash !== value.sequence_plan_hash
      || fingerprint.sequence_reservation_hash !== value.sequence_reservation_hash
      || fingerprint.policy_version !== value.policy_version || fingerprint.cycle_commits_hash !== value.cycle_commits_hash
      || fingerprint.consolidated_ledger_hash !== canonicalHash(value.consolidated_ledger)
      || fingerprint.consolidated_journal_hash !== canonicalHash(value.consolidated_journal)
      || fingerprint.consolidated_trial_balance_hash !== value.consolidated_trial_balance.trial_balance_hash
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash !== replayPortfolioProtectiveStopCancelCycleSequenceFingerprintHash(fingerprint)) fail("fingerprint")
  if (source) assertSource(value, source)
}

export function assertReplayPortfolioProtectiveStopCancelCycleSequenceArtifactManifest(
  value: ReplayPortfolioProtectiveStopCancelCycleSequenceArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || JSON.stringify(value.files.map((file) => file.role)) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.files.some((file) => !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || !file.ref)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-protective-stop-cancel-cycle-sequence-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || !utc(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioProtectiveStopCancelCycleSequenceArtifactManifestHash(value)) fail("manifest")
  hashes([value.sequence_evidence_hash, value.sequence_fingerprint_hash, value.cycle_commits_hash,
    ...value.files.map((file) => file.sha256)])
}
export function assertReplayPortfolioProtectiveStopCancelCycleSequenceOutcome(
  value: ReplayPortfolioProtectiveStopCancelCycleSequenceOutcome,
): void {
  const completed = value.evidence !== null && value.artifact_manifest !== null && value.failure === null
  const failed = value.evidence === null && value.artifact_manifest === null && value.failure !== null
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id || (value.status === "completed") !== completed || (value.status === "failed") !== failed
      || value.failure !== null && value.failure.partial_sequence_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveStopCancelCycleSequenceOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveStopCancelCycleSequenceEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveStopCancelCycleSequenceArtifactManifest(value.artifact_manifest)
}

function assertSource(value: ReplayPortfolioProtectiveStopCancelCycleSequenceEvidence,
  source: { plan: ReplayPortfolioCycleSequencePlan; cycles: ReplayPortfolioProtectiveStopCancelCycleSource[] }) {
  assertReplayPortfolioCycleSequencePlan(source.plan)
  if (source.plan.plan_hash !== value.sequence_plan_hash || source.cycles.length !== value.cycle_count) fail("source coverage")
  source.cycles.forEach((cycle, index) => {
    assertReplayPortfolioProtectiveStopCancelTerminalEvidence(cycle.cancel_terminal_evidence)
    assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(cycle.cancel_terminal_manifest)
    assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence(cycle.accounting_evidence)
    assertReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest(cycle.accounting_manifest)
    const commit = value.cycle_commits[index]
    if (!commit || cycle.cycle_index !== index + 1
        || commit.cancel_terminal_evidence_hash !== cycle.cancel_terminal_evidence.evidence_hash
        || commit.cancel_terminal_artifact_manifest_hash !== cycle.cancel_terminal_manifest.manifest_hash
        || commit.cancel_terminal_accounting_evidence_hash !== cycle.accounting_evidence.evidence_hash
        || commit.cancel_terminal_accounting_artifact_manifest_hash !== cycle.accounting_manifest.manifest_hash
        || commit.risk_result_hash !== cycle.accounting_evidence.risk_result_hash
        || commit.trial_balance_hash !== cycle.accounting_evidence.trial_balance.trial_balance_hash
        || commit.opening_available_cash !== cycle.accounting_evidence.shared_initial_cash
        || commit.ending_available_cash !== cycle.accounting_evidence.trial_balance.ending_available_cash) fail("source binding")
  })
}
function assertTrialBalance(balance: ReplayPortfolioProtectiveStopCancelCycleSequenceTrialBalance,
  journal: ReplayPortfolioProtectiveStopCancelCycleSequenceJournalEntry[]) {
  const debits = addReplayDecimalValues(...journal.flatMap((entry) => entry.cycle_entry.legs.map((leg) => leg.debit)))
  const credits = addReplayDecimalValues(...journal.flatMap((entry) => entry.cycle_entry.legs.map((leg) => leg.credit)))
  if (balance.journal_policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
      || balance.source_cycle_accounting_policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION
      || balance.balanced !== true || balance.total_debits !== balance.total_credits
      || balance.total_debits !== debits || balance.total_credits !== credits
      || balance.opening_equity_posting_count !== 1 || balance.ending_reserved_isolated_collateral !== 0
      || balance.ending_unrealized_pnl !== 0 || balance.ending_settled_cash !== balance.ending_available_cash
      || balance.ending_portfolio_nav !== balance.ending_available_cash
      || balance.trial_balance_hash !== replayPortfolioProtectiveStopCancelCycleSequenceTrialBalanceHash(balance)) fail("trial balance")
}
function hashes(values: string[]): void { if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash") }
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function fail(scope: string): never { throw new Error(`Portfolio Protective Stop Cancel Cycle Sequence ${scope} invalid`) }
