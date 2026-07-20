import { canonicalHash } from "./replay-contracts"
import type { ReplayPortfolioFixedPartialTerminalOwner } from
  "./replay-portfolio-fixed-partial-terminal-contracts"

export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-fixed-partial-terminal-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-fixed-partial-terminal-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION =
  "double-entry-partial-realization-original-collateral-until-flat-v1" as const
export const REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_LIMITATIONS = [
  "cashflows_consumed_from_certified_lane_result_ledgers",
  "partial_realized_pnl_and_fee_settle_at_partial_fill_boundary",
  "original_isolated_collateral_released_only_on_committed_full_flat",
] as const

export type ReplayPortfolioFixedPartialJournalAccount = "wallet_cash" | "isolated_margin_collateral"
  | "position_valuation" | "opening_equity" | "realized_pnl_income" | "realized_pnl_loss"
  | "funding_income" | "funding_expense" | "fee_expense" | "liquidation_fee_expense"
  | "unrealized_pnl_income" | "unrealized_pnl_loss"
export type ReplayPortfolioFixedPartialPostingKind = "opening_cash" | "collateral_reserve"
  | "entry_fee" | "funding" | "realized_pnl" | "trading_fee" | "liquidation_fee"
  | "collateral_release" | "terminal_mark_to_market"

export interface ReplayPortfolioFixedPartialAccountingLedgerEntry {
  ledger_sequence: number; event_time: string; boundary_phase: 10 | 15 | 20
  source_event_hash: string; terminal_record_hash: string; lane_id: string; symbol: string
  terminal_owner: ReplayPortfolioFixedPartialTerminalOwner
  cashflow_kind: "entry_fee" | "funding" | "realized_pnl" | "trading_fee" | "liquidation_fee"
  amount: number; settled_cash_after: number; ledger_entry_hash: string
}
export interface ReplayPortfolioFixedPartialAccountingJournalEntry {
  journal_sequence: number; event_time: string; boundary_phase: 10 | 15 | 20 | null
  source_event_hash: string | null; terminal_record_hash: string | null; lane_id: string | null
  terminal_owner: ReplayPortfolioFixedPartialTerminalOwner | null; posting_kind: ReplayPortfolioFixedPartialPostingKind
  legs: Array<{ account: ReplayPortfolioFixedPartialJournalAccount; debit: number; credit: number }>
  journal_entry_hash: string
}
export interface ReplayPortfolioFixedPartialAccountingTrialBalance {
  settlement_asset: string; accounting_policy_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number; total_credits: number
  balances: Record<ReplayPortfolioFixedPartialJournalAccount, number>
  ending_available_cash: number; ending_reserved_isolated_collateral: number; ending_settled_cash: number
  ending_unrealized_pnl: number; ending_portfolio_nav: number; balanced: true; trial_balance_hash: string
}
export interface ReplayPortfolioFixedPartialTerminalAccountingEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION
  experiment_id: string; trial_group_id: string; trial_group_hash: string; portfolio_id: string
  settlement_asset: string; shared_initial_cash: number; terminal_evidence_hash: string
  terminal_artifact_manifest_hash: string; ledger: ReplayPortfolioFixedPartialAccountingLedgerEntry[]
  journal: ReplayPortfolioFixedPartialAccountingJournalEntry[]
  trial_balance: ReplayPortfolioFixedPartialAccountingTrialBalance
  limitations: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_LIMITATIONS
  fingerprint: { terminal_evidence_hash: string; terminal_artifact_manifest_hash: string
    ledger_hash: string; journal_hash: string; trial_balance_hash: string; limitations_hash: string
    fingerprint_hash: string }
  evidence_hash: string
}
export interface ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string; portfolio_id: string; evidence_hash: string; terminal_evidence_hash: string
  files: Array<{ role: "terminal_artifact_manifest" | "terminal_evidence" | "ledger" | "journal"
    | "trial_balance" | "accounting_evidence"; name: string; ref: string; sha256: string }>
  completeness: { authoritative_result: true; required_roles: readonly string[]
    commit_marker: "portfolio-fixed-partial-terminal-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false }
  authority_frozen_at: string; manifest_hash: string
}
export const replayPortfolioFixedPartialAccountingLedgerEntryHash = (value: ReplayPortfolioFixedPartialAccountingLedgerEntry
  | Omit<ReplayPortfolioFixedPartialAccountingLedgerEntry, "ledger_entry_hash">) => strip(value, "ledger_entry_hash")
export const replayPortfolioFixedPartialAccountingJournalEntryHash = (value: ReplayPortfolioFixedPartialAccountingJournalEntry
  | Omit<ReplayPortfolioFixedPartialAccountingJournalEntry, "journal_entry_hash">) => strip(value, "journal_entry_hash")
export const replayPortfolioFixedPartialAccountingTrialBalanceHash = (value: ReplayPortfolioFixedPartialAccountingTrialBalance
  | Omit<ReplayPortfolioFixedPartialAccountingTrialBalance, "trial_balance_hash">) => strip(value, "trial_balance_hash")
export const replayPortfolioFixedPartialTerminalAccountingEvidenceHash = (value: ReplayPortfolioFixedPartialTerminalAccountingEvidence
  | Omit<ReplayPortfolioFixedPartialTerminalAccountingEvidence, "evidence_hash">) => strip(value, "evidence_hash")
export const replayPortfolioFixedPartialTerminalAccountingArtifactManifestHash =
  (value: ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest
    | Omit<ReplayPortfolioFixedPartialTerminalAccountingArtifactManifest, "manifest_hash">) => strip(value, "manifest_hash")
export function assertReplayPortfolioFixedPartialTerminalAccountingEvidence(
  value: ReplayPortfolioFixedPartialTerminalAccountingEvidence,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version !== REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ACCOUNTING_POLICY_VERSION
      || value.ledger.some((entry, index) => entry.ledger_sequence !== index + 1
        || entry.ledger_entry_hash !== replayPortfolioFixedPartialAccountingLedgerEntryHash(entry))
      || value.journal.some((entry, index) => entry.journal_sequence !== index + 1
        || entry.journal_entry_hash !== replayPortfolioFixedPartialAccountingJournalEntryHash(entry))
      || value.trial_balance.trial_balance_hash !== replayPortfolioFixedPartialAccountingTrialBalanceHash(value.trial_balance)
      || value.fingerprint.ledger_hash !== canonicalHash(value.ledger)
      || value.fingerprint.journal_hash !== canonicalHash(value.journal)
      || value.fingerprint.trial_balance_hash !== value.trial_balance.trial_balance_hash
      || value.fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || value.fingerprint.fingerprint_hash !== strip(value.fingerprint, "fingerprint_hash")
      || value.evidence_hash !== replayPortfolioFixedPartialTerminalAccountingEvidenceHash(value)) fail()
}
function strip(value: unknown, key: string): string { const body = { ...(value as Record<string, unknown>) };
  delete body[key]; return canonicalHash(body) }
function fail(): never { throw new Error("Portfolio fixed-partial terminal accounting drift") }
