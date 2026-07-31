import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import {
  assertReplayPortfolioCycleSequencePlan,
  type ReplayPortfolioCycleSequencePlan,
} from "./replay-portfolio-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest,
  assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalAccount,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry,
} from "./replay-portfolio-protective-stop-replacement-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
} from "./replay-portfolio-protective-stop-replacement-terminal-contracts"

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-cycle-sequence-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-cycle-sequence-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-stop-replacement-cycle-sequence-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION =
  "predeclared-cycle-p19-p20-roll-forward-v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION =
  "replacement-cycle-opening-equity-once-roll-forward-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS = [
  "one_to_eight_predeclared_full_flat_cycles_only",
  "each_cycle_zero_or_one_predeclared_tighten_only_full_position_stop_replacement",
  "successor_cash_from_predecessor_committed_p20_trial_balance",
  "no_runtime_cycle_expansion_free_amend_target_mutation_partial_reentry_cross_margin_borrow_real_liquidity_or_fast",
] as const

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceAuthority {
  reservation_hash: string
  issued_at: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
}

export interface ReplayPortfolioProtectiveStopReplacementCycleCommit {
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

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceLedgerEntry {
  sequence_entry_hash: string
  global_ledger_sequence: number
  cycle_index: number
  cycle_ledger_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntry
}

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceJournalEntry {
  sequence_entry_hash: string
  global_journal_sequence: number
  cycle_index: number
  cycle_journal_entry_hash: string
  cycle_entry: ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalEntry
}

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceTrialBalance {
  settlement_asset: string
  journal_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
  source_cycle_accounting_policy_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveStopReplacementTerminalAccountingJournalAccount, number>
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

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
  cycle_commits_hash: string
  consolidated_ledger_hash: string
  consolidated_journal_hash: string
  consolidated_trial_balance_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  settlement_asset: string
  cycle_count: number
  cycle_commits: ReplayPortfolioProtectiveStopReplacementCycleCommit[]
  cycle_commits_hash: string
  consolidated_ledger: ReplayPortfolioProtectiveStopReplacementCycleSequenceLedgerEntry[]
  consolidated_journal: ReplayPortfolioProtectiveStopReplacementCycleSequenceJournalEntry[]
  consolidated_trial_balance: ReplayPortfolioProtectiveStopReplacementCycleSequenceTrialBalance
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveStopReplacementCycleSequenceFingerprint
  evidence_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementCycleSource {
  cycle_index: number
  replacement_terminal_evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence
  replacement_terminal_manifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
  accounting_evidence: ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence
  accounting_manifest: ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest
}

export const REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES = [
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
export type ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  sequence_evidence_hash: string
  sequence_fingerprint_hash: string
  cycle_commits_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-stop-replacement-cycle-sequence-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceOutcome {
  schema_version:
    typeof REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  status: "completed" | "failed"
  evidence: ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest | null
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

export function replayPortfolioProtectiveStopReplacementCycleCommitHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleCommit
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleCommit, "cycle_commit_hash">,
): string {
  const { cycle_commit_hash: _hash, ...body } = value as ReplayPortfolioProtectiveStopReplacementCycleCommit
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementCycleSequenceLedgerEntryHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceLedgerEntry
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleSequenceLedgerEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementCycleSequenceLedgerEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementCycleSequenceJournalEntryHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceJournalEntry
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleSequenceJournalEntry, "sequence_entry_hash">,
): string {
  const { sequence_entry_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementCycleSequenceJournalEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementCycleSequenceTrialBalanceHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceTrialBalance
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleSequenceTrialBalance, "trial_balance_hash">,
): string {
  const { trial_balance_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementCycleSequenceTrialBalance
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementCycleSequenceFingerprintHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceFingerprint
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleSequenceFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementCycleSequenceFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementCycleSequenceEvidenceHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifestHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveStopReplacementCycleSequenceOutcomeHash(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceOutcome
    | Omit<ReplayPortfolioProtectiveStopReplacementCycleSequenceOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } =
    value as ReplayPortfolioProtectiveStopReplacementCycleSequenceOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence,
  source?: { plan: ReplayPortfolioCycleSequencePlan; cycles: ReplayPortfolioProtectiveStopReplacementCycleSource[] },
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || !Number.isSafeInteger(value.cycle_count) || value.cycle_count < 1 || value.cycle_count > 8
      || value.cycle_commits.length !== value.cycle_count
      || value.cycle_commits_hash !== canonicalHash(value.cycle_commits)
      || value.initial_cash <= 0 || value.ending_available_cash < 0
      || value.ending_reserved_isolated_collateral !== 0 || value.ending_unrealized_pnl !== 0
      || value.ending_portfolio_nav !== value.ending_available_cash
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS)
      || value.evidence_hash
        !== replayPortfolioProtectiveStopReplacementCycleSequenceEvidenceHash(value)) fail("identity/result")
  hashes([value.trial_group_hash, value.sequence_plan_hash, value.sequence_reservation_hash,
    value.cycle_commits_hash, value.fingerprint.fingerprint_hash, value.evidence_hash])
  let priorCash = value.initial_cash
  let priorClose = Number.NEGATIVE_INFINITY
  value.cycle_commits.forEach((commit, index) => {
    hashes(Object.entries(commit).filter(([name]) => name.endsWith("_hash")).map(([, hash]) => hash as string))
    if (commit.cycle_index !== index + 1 || commit.opening_available_cash !== priorCash
        || commit.ending_available_cash < 0 || !utc(commit.full_flat_close_time)
        || Date.parse(commit.full_flat_close_time) <= priorClose
        || commit.cycle_commit_hash !== replayPortfolioProtectiveStopReplacementCycleCommitHash(commit)) {
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
          !== replayPortfolioProtectiveStopReplacementCycleSequenceLedgerEntryHash(entry)) fail("ledger")
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
          !== replayPortfolioProtectiveStopReplacementCycleSequenceJournalEntryHash(entry)) fail("journal")
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
        !== replayPortfolioProtectiveStopReplacementCycleSequenceFingerprintHash(fingerprint)) fail("fingerprint")
  if (source) assertSource(value, source)
}

export function assertReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length
        !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.files.some((file) => !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || !file.ref)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-protective-stop-replacement-cycle-sequence-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || !utc(value.authority_frozen_at)
      || value.manifest_hash
        !== replayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifestHash(value)) fail("manifest")
  hashes([value.sequence_evidence_hash, value.sequence_fingerprint_hash, value.cycle_commits_hash,
    ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveStopReplacementCycleSequenceOutcome(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.evidence !== null && value.artifact_manifest !== null
        && value.failure === null)
      || value.status === "failed" !== (value.evidence === null && value.artifact_manifest === null
        && value.failure !== null)
      || value.failure && value.failure.partial_sequence_result_published !== false
      || value.outcome_hash
        !== replayPortfolioProtectiveStopReplacementCycleSequenceOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence(value.evidence)
  if (value.artifact_manifest) {
    assertReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest(value.artifact_manifest)
  }
}

function assertSource(
  value: ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence,
  source: { plan: ReplayPortfolioCycleSequencePlan; cycles: ReplayPortfolioProtectiveStopReplacementCycleSource[] },
): void {
  assertReplayPortfolioCycleSequencePlan(source.plan)
  if (source.plan.plan_hash !== value.sequence_plan_hash || source.cycles.length !== value.cycle_count) {
    fail("source coverage")
  }
  source.cycles.forEach((cycle, index) => {
    assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(cycle.replacement_terminal_evidence)
    assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(cycle.replacement_terminal_manifest)
    assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence(cycle.accounting_evidence)
    assertReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest(cycle.accounting_manifest)
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
  balance: ReplayPortfolioProtectiveStopReplacementCycleSequenceTrialBalance,
  journal: ReplayPortfolioProtectiveStopReplacementCycleSequenceJournalEntry[],
): void {
  const debits = addReplayDecimalValues(...journal.flatMap((entry) => entry.cycle_entry.legs
    .map((leg) => leg.debit)))
  const credits = addReplayDecimalValues(...journal.flatMap((entry) => entry.cycle_entry.legs
    .map((leg) => leg.credit)))
  if (balance.journal_policy_version
      !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION
      || balance.source_cycle_accounting_policy_version
        !== REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION
      || balance.balanced !== true || balance.total_debits !== balance.total_credits
      || balance.total_debits !== debits || balance.total_credits !== credits
      || balance.opening_equity_posting_count !== 1
      || balance.ending_reserved_isolated_collateral !== 0 || balance.ending_unrealized_pnl !== 0
      || balance.ending_settled_cash !== balance.ending_available_cash
      || balance.ending_portfolio_nav !== balance.ending_available_cash
      || balance.trial_balance_hash
        !== replayPortfolioProtectiveStopReplacementCycleSequenceTrialBalanceHash(balance)) fail("trial balance")
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}
function utc(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.endsWith("Z")
}
function fail(scope: string): never {
  throw new Error(`Portfolio Protective Stop Replacement Cycle Sequence ${scope} invalid`)
}
