import {
  canonicalHash,
  type ReplayEventKey,
  type ReplayJournalAccount,
  type ReplayJournalLeg,
} from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"

export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-post-partial-stop-replacement-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-post-partial-stop-replacement-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION =
  "owner-keyed-certified-result-journal-composition-v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_LIMITATIONS = [
  "certified_lane_result_ledgers_and_journal_legs_are_the_only_accounting_authority",
  "one_portfolio_opening_equity_replaces_lane_local_opening_balance_entries",
  "every_nonopening_posting_is_keyed_by_final_terminal_owner_and_risk_record",
  "live_isolated_collateral_preserves_attributed_source_result_cashflows",
  "no_cycle_roll_forward_cross_margin_borrow_or_reentry",
] as const

export type ReplayPortfolioPostPartialStopReplacementOwner =
  | "replacement_protective_stop"
  | "preserved_take_profit"
  | "strategy_exit"
  | "exact_liquidation"
  | "open_at_data_end"

export type ReplayPortfolioPostPartialStopReplacementCashflowKind =
  | "fee" | "funding" | "realized_pnl" | "liquidation_fee"

export interface ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry {
  ledger_sequence: number
  event_key: ReplayEventKey
  lane_id: string
  symbol: string
  terminal_owner: ReplayPortfolioPostPartialStopReplacementOwner
  risk_record_hash: string
  source_lane_ledger_entry_hash: string
  source_ref: string
  cashflow_kind: ReplayPortfolioPostPartialStopReplacementCashflowKind
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry {
  journal_sequence: number
  event_key: ReplayEventKey | null
  lane_id: string | null
  terminal_owner: ReplayPortfolioPostPartialStopReplacementOwner | null
  risk_record_hash: string | null
  source_lane_journal_entry_hash: string | null
  source_ref: string
  posting_kind: "portfolio_opening_equity" | "certified_lane_result_posting"
  source_posting_kind: string
  legs: ReplayJournalLeg[]
  journal_entry_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance {
  settlement_asset: string
  accounting_policy_version: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  historical_admission_frozen_stop_risk: number
  ending_reserved_admission_risk: number
  total_risk_budget_released: number
  ending_current_active_stop_bounded_risk: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementOwnerBinding {
  lane_id: string
  risk_record_hash: string
  terminal_owner: ReplayPortfolioPostPartialStopReplacementOwner
  binding_hash: string
}

export interface ReplayPortfolioPostPartialStopReplacementAccountingEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION
  portfolio_id: string
  settlement_asset: string
  source_risk_evidence_hash: string
  source_lane_bindings_hash: string
  lane_result_hashes: string[]
  lane_artifact_manifest_hashes: string[]
  lane_owner_bindings: ReplayPortfolioPostPartialStopReplacementOwnerBinding[]
  lane_owner_bindings_hash: string
  ledger: ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry[]
  journal: ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry[]
  trial_balance: ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance
  terminal_owner_counts: Record<ReplayPortfolioPostPartialStopReplacementOwner, number>
  owner_journal_posting_counts: Record<ReplayPortfolioPostPartialStopReplacementOwner, number>
  limitations: typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_LIMITATIONS
  fingerprint_hash: string
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_ROLES = [
  "lane_result_artifact_manifests",
  "lane_results",
  "risk_evidence",
  "lane_owner_bindings",
  "ledger",
  "journal",
  "trial_balance",
  "accounting_evidence",
] as const
export type ReplayPortfolioPostPartialStopReplacementAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_ROLES[number]
export interface ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest {
  schema_version:
    typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  source_risk_evidence_hash: string
  source_lane_bindings_hash: string
  accounting_evidence_hash: string
  lane_owner_bindings_hash: string
  files: Array<{
    role: ReplayPortfolioPostPartialStopReplacementAccountingArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: readonly ReplayPortfolioPostPartialStopReplacementAccountingArtifactRole[]
    commit_marker: "portfolio-post-partial-stop-replacement-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  manifest_hash: string
}

export const replayPortfolioPostPartialStopReplacementAccountingLedgerEntryHash = (
  value: ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry
    | Omit<ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry, "ledger_entry_hash">,
): string => strip(value, "ledger_entry_hash")
export const replayPortfolioPostPartialStopReplacementAccountingJournalEntryHash = (
  value: ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry
    | Omit<ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry, "journal_entry_hash">,
): string => strip(value, "journal_entry_hash")
export const replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash = (
  value: ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance
    | Omit<ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance, "trial_balance_hash">,
): string => strip(value, "trial_balance_hash")
export const replayPortfolioPostPartialStopReplacementAccountingEvidenceHash = (
  value: ReplayPortfolioPostPartialStopReplacementAccountingEvidence
    | Omit<ReplayPortfolioPostPartialStopReplacementAccountingEvidence, "evidence_hash">,
): string => strip(value, "evidence_hash")
export const replayPortfolioPostPartialStopReplacementOwnerBindingHash = (
  value: ReplayPortfolioPostPartialStopReplacementOwnerBinding
    | Omit<ReplayPortfolioPostPartialStopReplacementOwnerBinding, "binding_hash">,
): string => strip(value, "binding_hash")
export const replayPortfolioPostPartialStopReplacementAccountingArtifactManifestHash = (
  value: ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest
    | Omit<ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest, "manifest_hash">,
): string => strip(value, "manifest_hash")

export function assertReplayPortfolioPostPartialStopReplacementAccountingEvidence(
  value: ReplayPortfolioPostPartialStopReplacementAccountingEvidence,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version
        !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION
      || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_LIMITATIONS)
      || value.lane_owner_bindings.length === 0
      || value.lane_owner_bindings_hash !== canonicalHash(value.lane_owner_bindings)
      || value.lane_owner_bindings.some((binding) => binding.binding_hash
        !== replayPortfolioPostPartialStopReplacementOwnerBindingHash(binding))
      || new Set(value.lane_owner_bindings.map((binding) => binding.lane_id)).size
        !== value.lane_owner_bindings.length
      || JSON.stringify(value.lane_owner_bindings.map((binding) => binding.lane_id))
        !== JSON.stringify([...value.lane_owner_bindings.map((binding) => binding.lane_id)].sort())
      || value.ledger.some((entry, index) => entry.ledger_sequence !== index + 1
        || entry.amount === 0
        || entry.ledger_entry_hash
          !== replayPortfolioPostPartialStopReplacementAccountingLedgerEntryHash(entry))
      || value.journal.length === 0
      || value.journal.some((entry, index) => entry.journal_sequence !== index + 1
        || entry.legs.length !== 2
        || addReplayDecimalValues(...entry.legs.filter((leg) => leg.side === "debit")
          .map((leg) => leg.amount))
          !== addReplayDecimalValues(...entry.legs.filter((leg) => leg.side === "credit")
            .map((leg) => leg.amount))
        || entry.journal_entry_hash
          !== replayPortfolioPostPartialStopReplacementAccountingJournalEntryHash(entry))) fail("collection")
  const opening = value.journal.filter((entry) => entry.posting_kind === "portfolio_opening_equity")
  const ownerByLane = new Map(value.lane_owner_bindings.map((binding) => [binding.lane_id, binding]))
  if (opening.length !== 1 || opening[0]!.journal_sequence !== 1
      || opening[0]!.event_key !== null || opening[0]!.lane_id !== null
      || opening[0]!.terminal_owner !== null || opening[0]!.risk_record_hash !== null
      || opening[0]!.source_lane_journal_entry_hash !== null
      || value.journal.slice(1).some((entry) => entry.posting_kind !== "certified_lane_result_posting"
        || entry.event_key === null || entry.lane_id === null || entry.terminal_owner === null
        || entry.risk_record_hash === null || entry.source_lane_journal_entry_hash === null
        || ownerByLane.get(entry.lane_id)?.terminal_owner !== entry.terminal_owner
        || ownerByLane.get(entry.lane_id)?.risk_record_hash !== entry.risk_record_hash)
      || value.ledger.some((entry) => ownerByLane.get(entry.lane_id)?.terminal_owner !== entry.terminal_owner
        || ownerByLane.get(entry.lane_id)?.risk_record_hash !== entry.risk_record_hash)) fail("opening")
  const recomputed = summarizeReplayPortfolioPostPartialStopReplacementJournal(value.journal)
  const trial = value.trial_balance
  if (trial.accounting_policy_version
      !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION
      || trial.balanced !== true || trial.total_debits !== trial.total_credits
      || trial.total_debits !== recomputed.total_debits || trial.total_credits !== recomputed.total_credits
      || canonicalHash(trial.balances) !== canonicalHash(recomputed.balances)
      || trial.ending_available_cash !== recomputed.balances.wallet_cash
      || trial.ending_reserved_isolated_collateral !== recomputed.balances.isolated_margin_collateral
      || trial.ending_settled_cash !== addReplayDecimalValues(
        trial.ending_available_cash, trial.ending_reserved_isolated_collateral,
      )
      || trial.ending_unrealized_pnl !== recomputed.balances.position_valuation
      || trial.ending_portfolio_nav !== addReplayDecimalValues(
        trial.ending_settled_cash, trial.ending_unrealized_pnl,
      )
      || trial.historical_admission_frozen_stop_risk !== addReplayDecimalValues(
        trial.ending_reserved_admission_risk, trial.total_risk_budget_released,
      )
      || trial.trial_balance_hash
        !== replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash(trial)) fail("trial balance")
  if (canonicalHash(value.owner_journal_posting_counts)
        !== canonicalHash(ownerPostingCounts(value.journal))
      || canonicalHash(value.terminal_owner_counts)
        !== canonicalHash(ownerCounts(value.lane_owner_bindings))
      || value.fingerprint_hash !== canonicalHash({
        source_risk_evidence_hash: value.source_risk_evidence_hash,
        source_lane_bindings_hash: value.source_lane_bindings_hash,
        lane_result_hashes: value.lane_result_hashes,
        lane_artifact_manifest_hashes: value.lane_artifact_manifest_hashes,
        lane_owner_bindings_hash: value.lane_owner_bindings_hash,
        ledger_hash: canonicalHash(value.ledger),
        journal_hash: canonicalHash(value.journal),
        trial_balance_hash: trial.trial_balance_hash,
        terminal_owner_counts: value.terminal_owner_counts,
        owner_journal_posting_counts: value.owner_journal_posting_counts,
        limitations: value.limitations,
      })
      || value.evidence_hash
        !== replayPortfolioPostPartialStopReplacementAccountingEvidenceHash(value)) fail("aggregate")
}

export function assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest(
  value: ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest,
): void {
  if (value.schema_version
      !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || !hash(value.source_risk_evidence_hash) || !hash(value.source_lane_bindings_hash)
      || !hash(value.accounting_evidence_hash) || !hash(value.lane_owner_bindings_hash)
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_ROLES)
      || value.files.some((file) => !file.name || !file.ref || !hash(file.sha256))
      || new Set(value.files.map((file) => file.name)).size !== value.files.length
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_ROLES)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker
        !== "portfolio-post-partial-stop-replacement-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || value.manifest_hash
        !== replayPortfolioPostPartialStopReplacementAccountingArtifactManifestHash(value)) {
    fail("Artifact Manifest")
  }
}

export function summarizeReplayPortfolioPostPartialStopReplacementJournal(
  journal: ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry[],
) {
  const accounts: ReplayJournalAccount[] = [
    "wallet_cash", "isolated_margin_collateral", "opening_equity", "realized_pnl_income",
    "realized_pnl_loss", "fee_expense", "liquidation_fee_expense", "funding_income",
    "funding_expense", "position_valuation", "unrealized_pnl_income", "unrealized_pnl_loss",
  ]
  const creditNormal = new Set<ReplayJournalAccount>([
    "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
  ])
  const raw = Object.fromEntries(accounts.map((account) => [account, 0])) as
    Record<ReplayJournalAccount, number>
  let totalDebits = 0; let totalCredits = 0
  for (const entry of journal) for (const leg of entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.side === "debit" ? leg.amount : 0)
    totalCredits = addReplayDecimalValues(totalCredits, leg.side === "credit" ? leg.amount : 0)
    raw[leg.account] = addReplayDecimalValues(
      raw[leg.account], leg.side === "debit" ? leg.amount : -leg.amount,
    )
  }
  const balances = Object.fromEntries(accounts.map((account) => [
    account, creditNormal.has(account) ? -raw[account] : raw[account],
  ])) as Record<ReplayJournalAccount, number>
  return { total_debits: totalDebits, total_credits: totalCredits, balances }
}

function ownerPostingCounts(entries: ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry[]) {
  return Object.fromEntries(owners().map((owner) => [owner,
    entries.filter((entry) => entry.terminal_owner === owner).length])) as
    Record<ReplayPortfolioPostPartialStopReplacementOwner, number>
}
function ownerCounts(bindings: ReplayPortfolioPostPartialStopReplacementOwnerBinding[]) {
  return Object.fromEntries(owners().map((owner) => [owner,
    bindings.filter((binding) => binding.terminal_owner === owner).length])) as
    Record<ReplayPortfolioPostPartialStopReplacementOwner, number>
}
export function replayPortfolioPostPartialStopReplacementOwners() { return owners() }
function owners(): ReplayPortfolioPostPartialStopReplacementOwner[] {
  return ["replacement_protective_stop", "preserved_take_profit", "strategy_exit",
    "exact_liquidation", "open_at_data_end"]
}
function strip(value: unknown, key: string): string {
  const body = { ...(value as Record<string, unknown>) }; delete body[key]; return canonicalHash(body)
}
function hash(value: string): boolean { return /^[0-9a-f]{64}$/.test(value) }
function fail(area: string): never {
  throw new Error(`Portfolio post-partial stop-replacement accounting ${area} drift`)
}
