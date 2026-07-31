import { canonicalHash } from "./replay-contracts"
import type {
  ReplayPortfolioTwoFixedPartialAccountingJournalEntry,
  ReplayPortfolioTwoFixedPartialAccountingLedgerEntry,
  ReplayPortfolioTwoFixedPartialAccountingTrialBalance,
} from "./replay-portfolio-two-fixed-partial-accounting-contracts"

export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-two-fixed-partial-cycle-sequence-evidence.v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-two-fixed-partial-cycle-sequence-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_POLICY_VERSION =
  "predeclared-p27-full-flat-committed-trial-balance-roll-forward-v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS = [
  "one_to_eight_control_plane_predeclared_child_reservations_only",
  "successor_requires_predecessor_committed_full_flat_collateral_exposure_and_risk_zero",
  "successor_opening_cash_must_equal_predecessor_committed_trial_balance",
  "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
] as const

export interface ReplayPortfolioTwoFixedPartialCycleCommit {
  cycle_index: number
  opening_available_cash: number
  child_reservation_hash: string
  terminal_evidence_hash: string
  accounting_evidence_hash: string
  accounting_artifact_manifest_hash: string
  lane_result_hashes_hash: string
  terminal_owner_set_hash: string
  full_flat_close_time: string
  ending_available_cash: number
  trial_balance_hash: string
  cycle_commit_hash: string
}
export interface ReplayPortfolioTwoFixedPartialCycleLedgerEntry {
  global_ledger_sequence: number
  cycle_index: number
  cycle_ledger_entry_hash: string
  cycle_entry: ReplayPortfolioTwoFixedPartialAccountingLedgerEntry
  sequence_entry_hash: string
}
export interface ReplayPortfolioTwoFixedPartialCycleJournalEntry {
  global_journal_sequence: number
  cycle_index: number
  cycle_journal_entry_hash: string
  cycle_entry: ReplayPortfolioTwoFixedPartialAccountingJournalEntry
  sequence_entry_hash: string
}
export interface ReplayPortfolioTwoFixedPartialCycleSequenceEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
  policy_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_reservation_hash: string
  settlement_asset: string
  cycle_count: number
  cycle_commits: ReplayPortfolioTwoFixedPartialCycleCommit[]
  cycle_commits_hash: string
  consolidated_ledger: ReplayPortfolioTwoFixedPartialCycleLedgerEntry[]
  consolidated_journal: ReplayPortfolioTwoFixedPartialCycleJournalEntry[]
  consolidated_trial_balance: ReplayPortfolioTwoFixedPartialAccountingTrialBalance
    & { opening_equity_posting_count: 1 }
  initial_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: 0
  ending_unrealized_pnl: 0
  ending_portfolio_nav: number
  limitations: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS
  fingerprint_hash: string
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES = [
  "sequence_reservation", "cycle_child_reservations", "cycle_accounting_artifact_manifests",
  "cycle_terminal_evidence", "cycle_accounting_evidence", "consolidated_ledger", "consolidated_journal",
  "consolidated_trial_balance", "cycle_sequence_fingerprint", "cycle_sequence_evidence",
] as const
export type ReplayPortfolioTwoFixedPartialCycleSequenceArtifactRole =
  typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES[number]
export interface ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  sequence_reservation_hash: string
  evidence_hash: string
  fingerprint_hash: string
  files: Array<{ role: ReplayPortfolioTwoFixedPartialCycleSequenceArtifactRole
    name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES
    commit_marker: "portfolio-two-fixed-partial-cycle-sequence-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}
export interface ReplayPortfolioTwoFixedPartialCycleSequenceOutcome {
  status: "completed" | "failed"
  evidence: ReplayPortfolioTwoFixedPartialCycleSequenceEvidence | null
  artifact_manifest: ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest | null
  idempotent_replay: boolean
  failure: { code: "cycle-sequence-input-invalid" | "cycle-child-failed" | "cycle-not-full-flat"
    | "cycle-cash-bridge-drift" | "cycle-sequence-artifact-failed"; cycle_index: number | null
    message: string; partial_sequence_result_published: false } | null
}

export const replayPortfolioTwoFixedPartialCycleCommitHash = (value: ReplayPortfolioTwoFixedPartialCycleCommit
  | Omit<ReplayPortfolioTwoFixedPartialCycleCommit, "cycle_commit_hash">) => strip(value, "cycle_commit_hash")
export const replayPortfolioTwoFixedPartialCycleLedgerEntryHash = (
  value: ReplayPortfolioTwoFixedPartialCycleLedgerEntry
    | Omit<ReplayPortfolioTwoFixedPartialCycleLedgerEntry, "sequence_entry_hash">,
) => strip(value, "sequence_entry_hash")
export const replayPortfolioTwoFixedPartialCycleJournalEntryHash = (
  value: ReplayPortfolioTwoFixedPartialCycleJournalEntry
    | Omit<ReplayPortfolioTwoFixedPartialCycleJournalEntry, "sequence_entry_hash">,
) => strip(value, "sequence_entry_hash")
export const replayPortfolioTwoFixedPartialCycleSequenceEvidenceHash = (
  value: ReplayPortfolioTwoFixedPartialCycleSequenceEvidence
    | Omit<ReplayPortfolioTwoFixedPartialCycleSequenceEvidence, "evidence_hash">,
) => strip(value, "evidence_hash")
export const replayPortfolioTwoFixedPartialCycleSequenceArtifactManifestHash = (
  value: ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest
    | Omit<ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest, "manifest_hash">,
) => strip(value, "manifest_hash")

export function assertReplayPortfolioTwoFixedPartialCycleSequenceEvidence(
  value: ReplayPortfolioTwoFixedPartialCycleSequenceEvidence,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION
      || value.policy_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_POLICY_VERSION
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_LIMITATIONS)
      || value.cycle_count !== value.cycle_commits.length || value.cycle_count < 1 || value.cycle_count > 8
      || value.cycle_commits_hash !== canonicalHash(value.cycle_commits)
      || value.cycle_commits.some((commit, index) => commit.cycle_index !== index + 1
        || commit.cycle_commit_hash !== replayPortfolioTwoFixedPartialCycleCommitHash(commit)
        || commit.opening_available_cash !== (index === 0 ? value.initial_cash
          : value.cycle_commits[index - 1]!.ending_available_cash))
      || value.consolidated_ledger.some((entry, index) => entry.global_ledger_sequence !== index + 1
        || entry.cycle_ledger_entry_hash !== entry.cycle_entry.ledger_entry_hash
        || entry.sequence_entry_hash !== replayPortfolioTwoFixedPartialCycleLedgerEntryHash(entry))
      || value.consolidated_journal.some((entry, index) => entry.global_journal_sequence !== index + 1
        || entry.cycle_journal_entry_hash !== entry.cycle_entry.journal_entry_hash
        || entry.sequence_entry_hash !== replayPortfolioTwoFixedPartialCycleJournalEntryHash(entry))
      || value.consolidated_trial_balance.opening_equity_posting_count !== 1
      || value.consolidated_trial_balance.ending_available_cash !== value.ending_available_cash
      || value.ending_portfolio_nav !== value.ending_available_cash
      || value.fingerprint_hash !== canonicalHash({ cycle_commits_hash: value.cycle_commits_hash,
        consolidated_ledger_hash: canonicalHash(value.consolidated_ledger),
        consolidated_journal_hash: canonicalHash(value.consolidated_journal),
        consolidated_trial_balance_hash: value.consolidated_trial_balance.trial_balance_hash,
        limitations: value.limitations })
      || value.evidence_hash !== replayPortfolioTwoFixedPartialCycleSequenceEvidenceHash(value)) fail()
}
export function assertReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest(
  value: ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest,
): void {
  if (value.schema_version
        !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash !== replayPortfolioTwoFixedPartialCycleSequenceArtifactManifestHash(value)) fail()
}
function strip(value: unknown, key: string): string {
  const body = { ...(value as Record<string, unknown>) }; delete body[key]; return canonicalHash(body)
}
function fail(): never { throw new Error("Portfolio two-fixed-partial cycle sequence drift") }
