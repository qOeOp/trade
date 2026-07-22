import { canonicalHash, type ReplayEventKey } from "./replay-contracts"
import type { ReplayPortfolioTwoFixedPartialTerminalOwner } from
  "./replay-portfolio-two-fixed-partial-terminal-contracts"

export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-two-fixed-partial-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-two-fixed-partial-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION =
  "owner-keyed-certified-result-double-entry-original-collateral-until-flat-v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_LIMITATIONS = [
  "cashflows_are_consumed_from_bound_certified_lane_result_ledgers",
  "every_cashflow_is_keyed_by_committed_terminal_record_and_final_terminal_owner",
  "partial_realized_pnl_and_fee_settle_at_their_source_event_key",
  "original_isolated_collateral_is_released_only_after_committed_full_flat",
] as const

export type ReplayPortfolioTwoFixedPartialJournalAccount = "wallet_cash" | "isolated_margin_collateral"
  | "position_valuation" | "opening_equity" | "realized_pnl_income" | "realized_pnl_loss"
  | "funding_income" | "funding_expense" | "fee_expense" | "liquidation_fee_expense"
  | "unrealized_pnl_income" | "unrealized_pnl_loss"
export type ReplayPortfolioTwoFixedPartialPostingKind = "opening_cash" | "collateral_reserve"
  | "fee" | "funding" | "realized_pnl" | "liquidation_fee" | "collateral_release"
  | "terminal_mark_to_market"
export type ReplayPortfolioTwoFixedPartialCashflowKind = "fee" | "funding" | "realized_pnl"
  | "liquidation_fee"

export interface ReplayPortfolioTwoFixedPartialAccountingLedgerEntry {
  ledger_sequence: number
  event_key: ReplayEventKey
  source_lane_ledger_entry_hash: string
  source_ref: string
  terminal_record_hash: string
  lane_id: string
  symbol: string
  terminal_owner: ReplayPortfolioTwoFixedPartialTerminalOwner
  cashflow_kind: ReplayPortfolioTwoFixedPartialCashflowKind
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

export interface ReplayPortfolioTwoFixedPartialAccountingJournalEntry {
  journal_sequence: number
  event_key: ReplayEventKey | null
  source_hash: string | null
  terminal_record_hash: string | null
  lane_id: string | null
  terminal_owner: ReplayPortfolioTwoFixedPartialTerminalOwner | null
  posting_kind: ReplayPortfolioTwoFixedPartialPostingKind
  legs: Array<{ account: ReplayPortfolioTwoFixedPartialJournalAccount; debit: number; credit: number }>
  journal_entry_hash: string
}

export interface ReplayPortfolioTwoFixedPartialAccountingTrialBalance {
  settlement_asset: string
  accounting_policy_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioTwoFixedPartialJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioTwoFixedPartialAccountingEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  reservation_hash: string
  terminal_evidence_hash: string
  lane_result_hashes: string[]
  lane_artifact_manifest_hashes: string[]
  ledger: ReplayPortfolioTwoFixedPartialAccountingLedgerEntry[]
  journal: ReplayPortfolioTwoFixedPartialAccountingJournalEntry[]
  trial_balance: ReplayPortfolioTwoFixedPartialAccountingTrialBalance
  owner_posting_counts: Record<ReplayPortfolioTwoFixedPartialTerminalOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_LIMITATIONS
  fingerprint_hash: string
  evidence_hash: string
}

export type ReplayPortfolioTwoFixedPartialAccountingArtifactRole = "reservation"
  | "lane_result_artifact_manifests" | "lane_results" | "terminal_evidence" | "ledger" | "journal"
  | "trial_balance" | "accounting_evidence"
export interface ReplayPortfolioTwoFixedPartialAccountingArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  reservation_hash: string
  terminal_evidence_hash: string
  accounting_evidence_hash: string
  files: Array<{ role: ReplayPortfolioTwoFixedPartialAccountingArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: readonly ReplayPortfolioTwoFixedPartialAccountingArtifactRole[]
    commit_marker: "portfolio-two-fixed-partial-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export const replayPortfolioTwoFixedPartialAccountingLedgerEntryHash = (
  value: ReplayPortfolioTwoFixedPartialAccountingLedgerEntry
    | Omit<ReplayPortfolioTwoFixedPartialAccountingLedgerEntry, "ledger_entry_hash">,
): string => strip(value, "ledger_entry_hash")
export const replayPortfolioTwoFixedPartialAccountingJournalEntryHash = (
  value: ReplayPortfolioTwoFixedPartialAccountingJournalEntry
    | Omit<ReplayPortfolioTwoFixedPartialAccountingJournalEntry, "journal_entry_hash">,
): string => strip(value, "journal_entry_hash")
export const replayPortfolioTwoFixedPartialAccountingTrialBalanceHash = (
  value: ReplayPortfolioTwoFixedPartialAccountingTrialBalance
    | Omit<ReplayPortfolioTwoFixedPartialAccountingTrialBalance, "trial_balance_hash">,
): string => strip(value, "trial_balance_hash")
export const replayPortfolioTwoFixedPartialAccountingEvidenceHash = (
  value: ReplayPortfolioTwoFixedPartialAccountingEvidence
    | Omit<ReplayPortfolioTwoFixedPartialAccountingEvidence, "evidence_hash">,
): string => strip(value, "evidence_hash")
export const replayPortfolioTwoFixedPartialAccountingArtifactManifestHash = (
  value: ReplayPortfolioTwoFixedPartialAccountingArtifactManifest
    | Omit<ReplayPortfolioTwoFixedPartialAccountingArtifactManifest, "manifest_hash">,
): string => strip(value, "manifest_hash")

export function assertReplayPortfolioTwoFixedPartialAccountingEvidence(
  value: ReplayPortfolioTwoFixedPartialAccountingEvidence,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_LIMITATIONS)
      || value.ledger.some((entry, index) => entry.ledger_sequence !== index + 1
        || entry.ledger_entry_hash !== replayPortfolioTwoFixedPartialAccountingLedgerEntryHash(entry))
      || value.journal.some((entry, index) => entry.journal_sequence !== index + 1
        || entry.legs.length !== 2
        || entry.legs.reduce((sum, leg) => sum + leg.debit, 0)
          !== entry.legs.reduce((sum, leg) => sum + leg.credit, 0)
        || entry.journal_entry_hash !== replayPortfolioTwoFixedPartialAccountingJournalEntryHash(entry))
      || value.trial_balance.balanced !== true
      || value.trial_balance.total_debits !== value.trial_balance.total_credits
      || value.trial_balance.trial_balance_hash
        !== replayPortfolioTwoFixedPartialAccountingTrialBalanceHash(value.trial_balance)
      || canonicalHash(value.owner_posting_counts) !== canonicalHash(ownerCounts(value.ledger))
      || value.fingerprint_hash !== canonicalHash({
        reservation_hash: value.reservation_hash,
        terminal_evidence_hash: value.terminal_evidence_hash,
        lane_result_hashes: value.lane_result_hashes,
        lane_artifact_manifest_hashes: value.lane_artifact_manifest_hashes,
        ledger_hash: canonicalHash(value.ledger),
        journal_hash: canonicalHash(value.journal),
        trial_balance_hash: value.trial_balance.trial_balance_hash,
        owner_posting_counts: value.owner_posting_counts,
        limitations: value.limitations,
      })
      || value.evidence_hash !== replayPortfolioTwoFixedPartialAccountingEvidenceHash(value)) fail()
}

export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_ROLES = [
  "reservation", "lane_result_artifact_manifests", "lane_results", "terminal_evidence", "ledger", "journal",
  "trial_balance", "accounting_evidence",
] as const satisfies readonly ReplayPortfolioTwoFixedPartialAccountingArtifactRole[]

export function assertReplayPortfolioTwoFixedPartialAccountingArtifactManifest(
  value: ReplayPortfolioTwoFixedPartialAccountingArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_ROLES)
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash !== replayPortfolioTwoFixedPartialAccountingArtifactManifestHash(value)) fail()
}

function ownerCounts(entries: ReplayPortfolioTwoFixedPartialAccountingLedgerEntry[]) {
  const owners: ReplayPortfolioTwoFixedPartialTerminalOwner[] = [
    "initial_protective_stop", "initial_take_profit", "generation_two_protective_stop",
    "generation_two_take_profit", "generation_three_protective_stop", "generation_three_take_profit",
    "exact_liquidation", "strategy_exit", "generation_three_open_at_data_end",
  ]
  return Object.fromEntries(owners.map((owner) => [owner,
    entries.filter((entry) => entry.terminal_owner === owner).length])) as
    Record<ReplayPortfolioTwoFixedPartialTerminalOwner, number>
}
function strip(value: unknown, key: string): string {
  const body = { ...(value as Record<string, unknown>) }; delete body[key]; return canonicalHash(body)
}
function fail(): never { throw new Error("Portfolio two-fixed-partial accounting drift") }
