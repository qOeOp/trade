import { canonicalHash } from "./replay-contracts"
import {
  replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash,
  summarizeReplayPortfolioPostPartialStopReplacementJournal,
  type ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry,
  type ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry,
  type ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance,
} from "./replay-portfolio-post-partial-stop-replacement-accounting-contracts"

export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-post-partial-stop-replacement-cycle-sequence-evidence.v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-post-partial-stop-replacement-cycle-sequence-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION =
  "predeclared-p28-full-flat-committed-trial-balance-roll-forward-v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS = [
  "one_to_eight_control_plane_predeclared_lane_trial_cycles_only",
  "successor_requires_predecessor_committed_full_flat_collateral_exposure_unrealized_and_current_risk_zero",
  "successor_opening_cash_must_equal_predecessor_committed_trial_balance",
  "no_open_successor_dynamic_sizing_between_partial_or_repeated_mutation_third_partial_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
] as const

export interface ReplayPortfolioPostPartialStopReplacementCycleCommit {
  cycle_index: number
  opening_available_cash: number
  risk_evidence_hash: string
  accounting_evidence_hash: string
  accounting_artifact_manifest_hash: string
  lane_result_hashes_hash: string
  lane_owner_bindings_hash: string
  full_flat_close_time: string
  ending_available_cash: number
  trial_balance_hash: string
  historical_admission_frozen_stop_risk: number
  total_risk_budget_released: number
  cycle_commit_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementCycleLedgerEntry {
  global_ledger_sequence: number
  cycle_index: number
  cycle_ledger_entry_hash: string
  cycle_entry: ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry
  sequence_entry_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementCycleJournalEntry {
  global_journal_sequence: number
  cycle_index: number
  cycle_journal_entry_hash: string
  cycle_entry: ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry
  sequence_entry_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence {
  schema_version:
    typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
  policy_version:
    typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_reservation_hash: string
  settlement_asset: string
  cycle_count: number
  cycle_commits: ReplayPortfolioPostPartialStopReplacementCycleCommit[]
  cycle_commits_hash: string
  consolidated_ledger: ReplayPortfolioPostPartialStopReplacementCycleLedgerEntry[]
  consolidated_journal: ReplayPortfolioPostPartialStopReplacementCycleJournalEntry[]
  consolidated_trial_balance: ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance
    & { opening_equity_posting_count: 1 }
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  historical_admission_frozen_stop_risk: number
  ending_reserved_admission_risk: 0
  total_risk_budget_released: number
  ending_current_active_stop_bounded_risk: 0
  limitations: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS
  fingerprint_hash: string
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES = [
  "sequence_reservation",
  "cycle_risk_evidence",
  "cycle_accounting_artifact_manifests",
  "cycle_accounting_evidence",
  "consolidated_ledger",
  "consolidated_journal",
  "consolidated_trial_balance",
  "cycle_sequence_fingerprint",
  "cycle_sequence_evidence",
] as const
export type ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactRole =
  typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES[number]

export interface ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  sequence_reservation_hash: string
  evidence_hash: string
  fingerprint_hash: string
  files: Array<{
    role: ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES
    commit_marker: "portfolio-post-partial-stop-replacement-cycle-sequence-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementCycleSequenceOutcome {
  status: "completed" | "failed"
  evidence: ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence | null
  artifact_manifest: ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "cycle-sequence-input-invalid" | "cycle-child-failed" | "cycle-not-full-flat"
      | "cycle-cash-bridge-drift" | "cycle-sequence-artifact-failed"
    cycle_index: number | null
    message: string
    partial_sequence_result_published: false
  } | null
}

export const replayPortfolioPostPartialStopReplacementCycleCommitHash = (
  value: ReplayPortfolioPostPartialStopReplacementCycleCommit
    | Omit<ReplayPortfolioPostPartialStopReplacementCycleCommit, "cycle_commit_hash">,
): string => strip(value, "cycle_commit_hash")
export const replayPortfolioPostPartialStopReplacementCycleLedgerEntryHash = (
  value: ReplayPortfolioPostPartialStopReplacementCycleLedgerEntry
    | Omit<ReplayPortfolioPostPartialStopReplacementCycleLedgerEntry, "sequence_entry_hash">,
): string => strip(value, "sequence_entry_hash")
export const replayPortfolioPostPartialStopReplacementCycleJournalEntryHash = (
  value: ReplayPortfolioPostPartialStopReplacementCycleJournalEntry
    | Omit<ReplayPortfolioPostPartialStopReplacementCycleJournalEntry, "sequence_entry_hash">,
): string => strip(value, "sequence_entry_hash")
export const replayPortfolioPostPartialStopReplacementCycleSequenceEvidenceHash = (
  value: ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence
    | Omit<ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence, "evidence_hash">,
): string => strip(value, "evidence_hash")
export const replayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifestHash = (
  value: ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest
    | Omit<ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest, "manifest_hash">,
): string => strip(value, "manifest_hash")

export function assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence(
  value: ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence,
): void {
  const summary = summarizeReplayPortfolioPostPartialStopReplacementJournal(
    value.consolidated_journal.map((entry) => entry.cycle_entry),
  )
  const trial = value.consolidated_trial_balance
  if (value.schema_version
        !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
      || value.policy_version
        !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS)
      || value.cycle_count !== value.cycle_commits.length || value.cycle_count < 1
      || value.cycle_count > 8 || value.cycle_commits_hash !== canonicalHash(value.cycle_commits)
      || value.cycle_commits.some((commit, index) => commit.cycle_index !== index + 1
        || commit.cycle_commit_hash !== replayPortfolioPostPartialStopReplacementCycleCommitHash(commit)
        || commit.opening_available_cash !== (index === 0 ? value.initial_cash
          : value.cycle_commits[index - 1]!.ending_available_cash)
        || commit.historical_admission_frozen_stop_risk !== commit.total_risk_budget_released)
      || value.consolidated_ledger.some((entry, index) => entry.global_ledger_sequence !== index + 1
        || entry.cycle_ledger_entry_hash !== entry.cycle_entry.ledger_entry_hash
        || entry.sequence_entry_hash !== replayPortfolioPostPartialStopReplacementCycleLedgerEntryHash(entry))
      || value.consolidated_journal.some((entry, index) => entry.global_journal_sequence !== index + 1
        || entry.cycle_journal_entry_hash !== entry.cycle_entry.journal_entry_hash
        || entry.sequence_entry_hash !== replayPortfolioPostPartialStopReplacementCycleJournalEntryHash(entry))
      || trial.opening_equity_posting_count !== 1 || trial.balanced !== true
      || trial.total_debits !== summary.total_debits || trial.total_credits !== summary.total_credits
      || canonicalHash(trial.balances) !== canonicalHash(summary.balances)
      || trial.ending_available_cash !== value.ending_available_cash
      || trial.ending_reserved_isolated_collateral !== 0 || trial.ending_unrealized_pnl !== 0
      || trial.ending_reserved_admission_risk !== 0
      || trial.ending_current_active_stop_bounded_risk !== 0
      || trial.historical_admission_frozen_stop_risk !== value.historical_admission_frozen_stop_risk
      || trial.total_risk_budget_released !== value.total_risk_budget_released
      || trial.trial_balance_hash
        !== replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash(trial)
      || value.historical_admission_frozen_stop_risk !== value.total_risk_budget_released
      || value.ending_portfolio_nav !== value.ending_available_cash
      || value.fingerprint_hash !== canonicalHash({
        cycle_commits_hash: value.cycle_commits_hash,
        consolidated_ledger_hash: canonicalHash(value.consolidated_ledger),
        consolidated_journal_hash: canonicalHash(value.consolidated_journal),
        consolidated_trial_balance_hash: trial.trial_balance_hash,
        limitations: value.limitations,
      })
      || value.evidence_hash !== replayPortfolioPostPartialStopReplacementCycleSequenceEvidenceHash(value)) {
    fail("evidence")
  }
}

export function assertReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest(
  value: ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest,
): void {
  if (value.schema_version
        !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.files.some((file) => !file.name || !file.ref || !/^[0-9a-f]{64}$/.test(file.sha256))
      || new Set(value.files.map((file) => file.name)).size !== value.files.length
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-post-partial-stop-replacement-cycle-sequence-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash
        !== replayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifestHash(value)) {
    fail("Artifact Manifest")
  }
}

function strip(value: unknown, key: string): string {
  const body = { ...(value as Record<string, unknown>) }
  delete body[key]
  return canonicalHash(body)
}
function fail(area: string): never {
  throw new Error(`Portfolio post-partial stop-replacement cycle sequence ${area} drift`)
}
