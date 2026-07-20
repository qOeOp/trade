import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import {
  assertReplayPortfolioCycleSequencePlan,
  type ReplayPortfolioCycleSequencePlan,
} from "./replay-portfolio-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry,
} from "./replay-portfolio-protective-take-profit-replacement-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
} from "./replay-portfolio-protective-take-profit-replacement-terminal-contracts"

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-cycle-sequence-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-cycle-sequence-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-take-profit-replacement-cycle-sequence-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION =
  "predeclared-cycle-take-profit-replacement-roll-forward-v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION =
  "take-profit-replacement-cycle-opening-equity-once-roll-forward-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS = [
  "one_to_eight_predeclared_full_flat_cycles_only",
  "each_cycle_zero_or_one_predeclared_full_position_take_profit_replacement",
  "successor_cash_from_predecessor_committed_p20_trial_balance",
  "no_runtime_cycle_expansion_free_amend_target_mutation_partial_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceAuthority {
  reservation_hash: string
  issued_at: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit {
  cycle_commit_hash: string
  cycle_index: number
  opening_available_cash: number
  replacement_terminal_evidence_hash: string
  replacement_terminal_artifact_manifest_hash: string
  replacement_terminal_accounting_evidence_hash: string
  replacement_terminal_accounting_artifact_manifest_hash: string
  risk_result_hash: string
  terminal_owner_set_hash: string
  full_flat_close_time: string
  ending_available_cash: number
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry {
  sequence_entry_hash: string
  global_ledger_sequence: number
  cycle_index: number
  cycle_ledger_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingLedgerEntry
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry {
  sequence_entry_hash: string
  global_journal_sequence: number
  cycle_index: number
  cycle_journal_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalEntry
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance {
  settlement_asset: string
  journal_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
  source_cycle_accounting_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingJournalAccount, number>
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

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
  cycle_commits_hash: string
  consolidated_ledger_hash: string
  consolidated_journal_hash: string
  consolidated_trial_balance_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  settlement_asset: string
  cycle_count: number
  cycle_commits: ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit[]
  cycle_commits_hash: string
  consolidated_ledger: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry[]
  consolidated_journal: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry[]
  consolidated_trial_balance: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprint
  evidence_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSource {
  cycle_index: number
  replacement_terminal_evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence
  replacement_terminal_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
  accounting_evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence
  accounting_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES = [
  "cycle_sequence_plan",
  "cycle_sequence_reservation",
  "cycle_replacement_terminal_artifact_manifests",
  "cycle_replacement_terminal_evidence",
  "cycle_replacement_terminal_accounting_artifact_manifests",
  "cycle_replacement_terminal_accounting_evidence",
  "consolidated_ledger",
  "consolidated_journal",
  "consolidated_trial_balance",
  "consolidated_fingerprint",
  "replacement_cycle_sequence_evidence",
] as const
export type ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  sequence_evidence_hash: string
  sequence_fingerprint_hash: string
  cycle_commits_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-take-profit-replacement-cycle-sequence-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  status: "completed" | "failed"
  evidence: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "replacement-cycle-sequence-input-invalid" | "replacement-cycle-allocation-failed"
      | "replacement-cycle-risk-failed" | "replacement-cycle-integrated-artifact-failed"
      | "replacement-cycle-revaluation-failed" | "replacement-cycle-terminal-failed"
      | "replacement-cycle-accounting-failed" | "replacement-cycle-not-full-flat"
      | "replacement-cycle-sequence-invalid" | "replacement-cycle-sequence-artifact-failed"
    cycle_index: number | null
    message: string
    partial_sequence_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleCommitHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit, "cycle_commit_hash">,
): string {
  const { cycle_commit_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTakeProfitReplacementCycleCommit
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntryHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntryHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalanceHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance, "trial_balance_hash">,
): string {
  const { trial_balance_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprintHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprint
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidenceHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifestHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcomeHash(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome
    | Omit<ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence,
  source?: { plan: ReplayPortfolioCycleSequencePlan; cycles: ReplayPortfolioProtectiveTakeProfitReplacementCycleSource[] },
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || !Number.isSafeInteger(value.cycle_count) || value.cycle_count < 1 || value.cycle_count > 8
      || value.cycle_commits.length !== value.cycle_count
      || value.cycle_commits_hash !== canonicalHash(value.cycle_commits)
      || value.initial_cash <= 0 || value.ending_available_cash < 0
      || value.ending_reserved_isolated_collateral !== 0 || value.ending_unrealized_pnl !== 0
      || value.ending_portfolio_nav !== value.ending_available_cash
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS)
      || value.evidence_hash
        !== replayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidenceHash(value)) fail("identity/result")
  hashes([value.trial_group_hash, value.sequence_plan_hash, value.sequence_reservation_hash,
    value.cycle_commits_hash, value.fingerprint.fingerprint_hash, value.evidence_hash])
  let priorCash = value.initial_cash
  let priorClose = Number.NEGATIVE_INFINITY
  value.cycle_commits.forEach((commit, index) => {
    hashes(Object.entries(commit).filter(([name]) => name.endsWith("_hash")).map(([, hash]) => hash as string))
    if (commit.cycle_index !== index + 1 || commit.opening_available_cash !== priorCash
        || commit.ending_available_cash < 0 || !utc(commit.full_flat_close_time)
        || Date.parse(commit.full_flat_close_time) <= priorClose
        || commit.cycle_commit_hash !== replayPortfolioProtectiveTakeProfitReplacementCycleCommitHash(commit)) {
      fail("cycle commit")
    }
    priorCash = commit.ending_available_cash
    priorClose = Date.parse(commit.full_flat_close_time)
  })
  if (priorCash !== value.ending_available_cash) fail("cash bridge")
  value.consolidated_ledger.forEach((entry, index) => {
    if (entry.global_ledger_sequence !== index + 1 || entry.cycle_index < 1
        || entry.cycle_index > value.cycle_count
        || index > 0 && entry.cycle_index < value.consolidated_ledger[index - 1]!.cycle_index
        || entry.cycle_ledger_entry_hash !== entry.cycle_entry.ledger_entry_hash
        || entry.sequence_entry_hash
          !== replayPortfolioProtectiveTakeProfitReplacementCycleSequenceLedgerEntryHash(entry)) fail("ledger")
  })
  if (value.consolidated_journal.filter((entry) => entry.cycle_entry.posting_kind === "opening_cash").length !== 1) {
    fail("opening equity")
  }
  value.consolidated_journal.forEach((entry, index) => {
    if (entry.global_journal_sequence !== index + 1 || entry.cycle_index < 1
        || entry.cycle_index > value.cycle_count
        || index > 0 && entry.cycle_index < value.consolidated_journal[index - 1]!.cycle_index
        || entry.cycle_journal_entry_hash !== entry.cycle_entry.journal_entry_hash
        || entry.sequence_entry_hash
          !== replayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntryHash(entry)) fail("journal")
  })
  assertTrialBalance(value.consolidated_trial_balance, value.consolidated_journal)
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.sequence_plan_hash !== value.sequence_plan_hash
      || fingerprint.sequence_reservation_hash !== value.sequence_reservation_hash
      || fingerprint.policy_version !== value.policy_version
      || fingerprint.cycle_commits_hash !== value.cycle_commits_hash
      || fingerprint.consolidated_ledger_hash !== canonicalHash(value.consolidated_ledger)
      || fingerprint.consolidated_journal_hash !== canonicalHash(value.consolidated_journal)
      || fingerprint.consolidated_trial_balance_hash !== value.consolidated_trial_balance.trial_balance_hash
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash
        !== replayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprintHash(fingerprint)) fail("fingerprint")
  if (source) assertSource(value, source)
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length
        !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.files.some((file) => !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || !file.ref)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-take-profit-replacement-cycle-sequence-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || !utc(value.authority_frozen_at)
      || value.manifest_hash
        !== replayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifestHash(value)) fail("manifest")
  hashes([value.sequence_evidence_hash, value.sequence_fingerprint_hash, value.cycle_commits_hash,
    ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.evidence !== null && value.artifact_manifest !== null
        && value.failure === null)
      || value.status === "failed" !== (value.evidence === null && value.artifact_manifest === null
        && value.failure !== null)
      || value.failure && value.failure.partial_sequence_result_published !== false
      || value.outcome_hash
        !== replayPortfolioProtectiveTakeProfitReplacementCycleSequenceOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence(value.evidence)
  if (value.artifact_manifest) {
    assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceArtifactManifest(value.artifact_manifest)
  }
}

function assertSource(
  value: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence,
  source: { plan: ReplayPortfolioCycleSequencePlan; cycles: ReplayPortfolioProtectiveTakeProfitReplacementCycleSource[] },
): void {
  assertReplayPortfolioCycleSequencePlan(source.plan)
  if (source.plan.plan_hash !== value.sequence_plan_hash || source.cycles.length !== value.cycle_count) {
    fail("source coverage")
  }
  source.cycles.forEach((cycle, index) => {
    assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence(cycle.replacement_terminal_evidence)
    assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest(cycle.replacement_terminal_manifest)
    assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence(cycle.accounting_evidence)
    assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest(cycle.accounting_manifest)
    const commit = value.cycle_commits[index]
    if (!commit || cycle.cycle_index !== index + 1
        || commit.replacement_terminal_evidence_hash !== cycle.replacement_terminal_evidence.evidence_hash
        || commit.replacement_terminal_artifact_manifest_hash !== cycle.replacement_terminal_manifest.manifest_hash
        || commit.replacement_terminal_accounting_evidence_hash !== cycle.accounting_evidence.evidence_hash
        || commit.replacement_terminal_accounting_artifact_manifest_hash !== cycle.accounting_manifest.manifest_hash
        || commit.risk_result_hash !== cycle.accounting_evidence.risk_result_hash
        || commit.trial_balance_hash !== cycle.accounting_evidence.trial_balance.trial_balance_hash
        || commit.opening_available_cash !== cycle.accounting_evidence.shared_initial_cash
        || commit.ending_available_cash !== cycle.accounting_evidence.trial_balance.ending_available_cash) {
      fail("source binding")
    }
  })
}

function assertTrialBalance(
  balance: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalance,
  journal: ReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntry[],
): void {
  const debits = addReplayDecimalValues(...journal.flatMap((entry) => entry.cycle_entry.legs
    .map((leg) => leg.debit)))
  const credits = addReplayDecimalValues(...journal.flatMap((entry) => entry.cycle_entry.legs
    .map((leg) => leg.credit)))
  if (balance.journal_policy_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
      || balance.source_cycle_accounting_policy_version
        !== REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
      || balance.balanced !== true || balance.total_debits !== balance.total_credits
      || balance.total_debits !== debits || balance.total_credits !== credits
      || balance.opening_equity_posting_count !== 1
      || balance.ending_reserved_isolated_collateral !== 0 || balance.ending_unrealized_pnl !== 0
      || balance.ending_settled_cash !== balance.ending_available_cash
      || balance.ending_portfolio_nav !== balance.ending_available_cash
      || balance.trial_balance_hash
        !== replayPortfolioProtectiveTakeProfitReplacementCycleSequenceTrialBalanceHash(balance)) fail("trial balance")
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}
function utc(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.endsWith("Z")
}
function fail(scope: string): never {
  throw new Error(`Portfolio Protective Take Profit Replacement Cycle Sequence ${scope} invalid`)
}
