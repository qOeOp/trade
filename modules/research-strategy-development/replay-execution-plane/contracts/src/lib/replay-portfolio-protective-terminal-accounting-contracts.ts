import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalOwner,
} from "./replay-portfolio-protective-terminal-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskEntryEvent,
  type ReplayRuntimeSharedWalletRiskResult,
} from "./replay-runtime-shared-wallet-risk-contracts"
import type { ReplayRuntimeSharedWalletFundingEvent } from "./replay-runtime-shared-wallet-funding-contracts"

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-accounting-evidence.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-accounting-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-protective-terminal-accounting-outcome.v1" as const
export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION =
  "protective-terminal-owner-double-entry-v1" as const

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_LIMITATIONS = [
  "single_initial_allocation_cycle_no_reentry",
  "winning_terminal_only_preempted_terminal_and_post_terminal_funding_excluded",
  "initial_full_position_simple_bracket_no_mutation_or_partial",
  "isolated_margin_no_cross_margin_borrow_real_liquidity_or_fast",
] as const

export type ReplayPortfolioProtectiveTerminalAccountingCashflowKind =
  | "entry_fee"
  | "funding"
  | "realized_pnl"
  | "terminal_trading_fee"
  | "liquidation_fee"

export type ReplayPortfolioProtectiveTerminalAccountingJournalAccount =
  | "wallet_cash"
  | "isolated_margin_collateral"
  | "position_valuation"
  | "opening_equity"
  | "realized_pnl_income"
  | "realized_pnl_loss"
  | "funding_income"
  | "funding_expense"
  | "fee_expense"
  | "liquidation_fee_expense"
  | "unrealized_pnl_income"
  | "unrealized_pnl_loss"

export interface ReplayPortfolioProtectiveTerminalAccountingLedgerEntry {
  ledger_sequence: number
  accounting_ordinal: number
  event_time: string
  boundary_phase: 10 | 15 | 20
  source_event_hash: string
  terminal_record_hash: string
  lane_id: string
  symbol: string
  terminal_owner: ReplayPortfolioProtectiveTerminalOwner
  cashflow_kind: ReplayPortfolioProtectiveTerminalAccountingCashflowKind
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

export interface ReplayPortfolioProtectiveTerminalAccountingJournalLeg {
  account: ReplayPortfolioProtectiveTerminalAccountingJournalAccount
  debit: number
  credit: number
}

export interface ReplayPortfolioProtectiveTerminalAccountingJournalEntry {
  journal_sequence: number
  accounting_ordinal: number | null
  event_time: string
  boundary_phase: 10 | 15 | 20 | null
  source_event_hash: string | null
  terminal_record_hash: string | null
  lane_id: string | null
  terminal_owner: ReplayPortfolioProtectiveTerminalOwner | null
  posting_kind:
    | "opening_cash"
    | "collateral_reserve"
    | "collateral_release"
    | ReplayPortfolioProtectiveTerminalAccountingCashflowKind
    | "terminal_mark_to_market"
  legs: [ReplayPortfolioProtectiveTerminalAccountingJournalLeg,
    ReplayPortfolioProtectiveTerminalAccountingJournalLeg]
  journal_entry_hash: string
}

export interface ReplayPortfolioProtectiveTerminalAccountingTrialBalance {
  settlement_asset: string
  accounting_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioProtectiveTerminalAccountingFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  protective_terminal_evidence_hash: string
  protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger_hash: string
  journal_hash: string
  trial_balance_hash: string
  excluded_preempted_source_hashes_hash: string
  excluded_post_terminal_funding_source_hashes_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayPortfolioProtectiveTerminalAccountingEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
  accounting_policy_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  shared_initial_cash: number
  protective_terminal_evidence_hash: string
  protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger: ReplayPortfolioProtectiveTerminalAccountingLedgerEntry[]
  journal: ReplayPortfolioProtectiveTerminalAccountingJournalEntry[]
  trial_balance: ReplayPortfolioProtectiveTerminalAccountingTrialBalance
  excluded_preempted_source_hashes: string[]
  excluded_post_terminal_funding_source_hashes: string[]
  limitations: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_LIMITATIONS
  fingerprint: ReplayPortfolioProtectiveTerminalAccountingFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES = [
  "protective_terminal_artifact_manifest",
  "risk_result",
  "protective_terminal_evidence",
  "protective_terminal_ledger",
  "protective_terminal_journal",
  "protective_terminal_trial_balance",
  "protective_terminal_accounting_fingerprint",
  "protective_terminal_accounting_evidence",
] as const
export type ReplayPortfolioProtectiveTerminalAccountingArtifactRole =
  typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES[number]

export interface ReplayPortfolioProtectiveTerminalAccountingArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  protective_terminal_accounting_evidence_hash: string
  protective_terminal_accounting_fingerprint_hash: string
  protective_terminal_evidence_hash: string
  files: Array<{
    role: ReplayPortfolioProtectiveTerminalAccountingArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES
    commit_marker: "portfolio-protective-terminal-accounting-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioProtectiveTerminalAccountingOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "completed" | "failed"
  protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence | null
  evidence: ReplayPortfolioProtectiveTerminalAccountingEvidence | null
  artifact_manifest: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "protective-terminal-execution-failed" | "protective-terminal-artifact-read-failed"
      | "protective-terminal-accounting-invalid" | "protective-terminal-accounting-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioProtectiveTerminalAccountingLedgerEntryHash(
  value: ReplayPortfolioProtectiveTerminalAccountingLedgerEntry
    | Omit<ReplayPortfolioProtectiveTerminalAccountingLedgerEntry, "ledger_entry_hash">,
): string {
  const { ledger_entry_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalAccountingLedgerEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalAccountingJournalEntryHash(
  value: ReplayPortfolioProtectiveTerminalAccountingJournalEntry
    | Omit<ReplayPortfolioProtectiveTerminalAccountingJournalEntry, "journal_entry_hash">,
): string {
  const { journal_entry_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalAccountingJournalEntry
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalAccountingTrialBalanceHash(
  value: ReplayPortfolioProtectiveTerminalAccountingTrialBalance
    | Omit<ReplayPortfolioProtectiveTerminalAccountingTrialBalance, "trial_balance_hash">,
): string {
  const { trial_balance_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalAccountingTrialBalance
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalAccountingFingerprintHash(
  value: ReplayPortfolioProtectiveTerminalAccountingFingerprint
    | Omit<ReplayPortfolioProtectiveTerminalAccountingFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalAccountingFingerprint
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalAccountingEvidenceHash(
  value: ReplayPortfolioProtectiveTerminalAccountingEvidence
    | Omit<ReplayPortfolioProtectiveTerminalAccountingEvidence, "evidence_hash">,
): string {
  const { evidence_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalAccountingEvidence
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalAccountingArtifactManifestHash(
  value: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest
    | Omit<ReplayPortfolioProtectiveTerminalAccountingArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalAccountingArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioProtectiveTerminalAccountingOutcomeHash(
  value: ReplayPortfolioProtectiveTerminalAccountingOutcome
    | Omit<ReplayPortfolioProtectiveTerminalAccountingOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioProtectiveTerminalAccountingOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioProtectiveTerminalAccountingEvidence(
  value: ReplayPortfolioProtectiveTerminalAccountingEvidence,
  source?: {
    protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
    protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
    risk_result: ReplayRuntimeSharedWalletRiskResult
  },
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION
      || value.accounting_policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION
      || !value.experiment_id || !value.trial_group_id || !value.portfolio_id || !value.settlement_asset
      || JSON.stringify(value.limitations)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_LIMITATIONS)) fail("identity/policy")
  hashes([value.trial_group_hash, value.protective_terminal_evidence_hash,
    value.protective_terminal_artifact_manifest_hash, value.risk_result_hash,
    value.trial_balance.trial_balance_hash, value.fingerprint.fingerprint_hash, value.evidence_hash,
    ...value.excluded_preempted_source_hashes, ...value.excluded_post_terminal_funding_source_hashes])
  if (!isSortedUnique(value.excluded_preempted_source_hashes)
      || !isSortedUnique(value.excluded_post_terminal_funding_source_hashes)) fail("exclusion set")
  let settled = value.shared_initial_cash
  for (const [index, entry] of value.ledger.entries()) {
    if (entry.ledger_sequence !== index + 1 || entry.accounting_ordinal < 1
        || index > 0 && entry.accounting_ordinal < value.ledger[index - 1]!.accounting_ordinal
        || entry.ledger_entry_hash !== replayPortfolioProtectiveTerminalAccountingLedgerEntryHash(entry)
        || !Number.isFinite(entry.amount) || !validTimestamp(entry.event_time)) fail("ledger")
    settled = addReplayDecimalValues(settled, entry.amount)
    if (settled !== entry.settled_cash_after) fail("ledger cash chain")
  }
  if (settled !== value.trial_balance.ending_settled_cash) fail("ledger ending cash")
  if (value.journal[0]?.posting_kind !== "opening_cash"
      || value.journal.filter((entry) => entry.posting_kind === "opening_cash").length !== 1) fail("opening equity")
  for (const [index, entry] of value.journal.entries()) {
    if (entry.journal_sequence !== index + 1
        || index > 1 && entry.accounting_ordinal !== null
          && value.journal[index - 1]!.accounting_ordinal !== null
          && entry.accounting_ordinal < value.journal[index - 1]!.accounting_ordinal!
        || entry.journal_entry_hash !== replayPortfolioProtectiveTerminalAccountingJournalEntryHash(entry)
        || !validTimestamp(entry.event_time) || entry.legs.length !== 2) fail("journal")
    const debit = addReplayDecimalValues(...entry.legs.map((item) => item.debit))
    const credit = addReplayDecimalValues(...entry.legs.map((item) => item.credit))
    if (debit <= 0 || debit !== credit || entry.legs.some((item) => item.debit < 0 || item.credit < 0
      || !Number.isFinite(item.debit) || !Number.isFinite(item.credit)
      || (item.debit > 0) === (item.credit > 0))) fail("journal balance")
  }
  assertTrialBalance(value.trial_balance, value.journal)
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.protective_terminal_evidence_hash !== value.protective_terminal_evidence_hash
      || fingerprint.protective_terminal_artifact_manifest_hash !== value.protective_terminal_artifact_manifest_hash
      || fingerprint.risk_result_hash !== value.risk_result_hash || fingerprint.ledger_hash !== canonicalHash(value.ledger)
      || fingerprint.journal_hash !== canonicalHash(value.journal)
      || fingerprint.trial_balance_hash !== value.trial_balance.trial_balance_hash
      || fingerprint.excluded_preempted_source_hashes_hash !== canonicalHash(value.excluded_preempted_source_hashes)
      || fingerprint.excluded_post_terminal_funding_source_hashes_hash
        !== canonicalHash(value.excluded_post_terminal_funding_source_hashes)
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash !== replayPortfolioProtectiveTerminalAccountingFingerprintHash(fingerprint)) {
    fail("fingerprint")
  }
  if (value.evidence_hash !== replayPortfolioProtectiveTerminalAccountingEvidenceHash(value)) fail("evidence hash")
  if (source) assertSourceSemantics(value, source)
}

export function assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest(
  value: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || !value.artifact_id || !value.portfolio_id
      || value.files.length !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES.length
      || JSON.stringify(value.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || value.files.some((file) => !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || !file.ref)
      || value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-protective-terminal-accounting-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_ARTIFACT_ROLES)
      || !validTimestamp(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioProtectiveTerminalAccountingArtifactManifestHash(value)) {
    fail("artifact manifest")
  }
  hashes([value.protective_terminal_accounting_evidence_hash,
    value.protective_terminal_accounting_fingerprint_hash, value.protective_terminal_evidence_hash,
    ...value.files.map((file) => file.sha256)])
}

export function assertReplayPortfolioProtectiveTerminalAccountingOutcome(
  value: ReplayPortfolioProtectiveTerminalAccountingOutcome,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION
      || !value.portfolio_id
      || value.status === "completed" !== (value.protective_terminal_evidence !== null && value.evidence !== null
        && value.artifact_manifest !== null && value.failure === null)
      || value.status === "failed" !== (value.protective_terminal_evidence === null && value.evidence === null
        && value.artifact_manifest === null && value.failure !== null)
      || value.failure && value.failure.partial_result_published !== false
      || value.outcome_hash !== replayPortfolioProtectiveTerminalAccountingOutcomeHash(value)) fail("outcome")
  if (value.evidence) assertReplayPortfolioProtectiveTerminalAccountingEvidence(value.evidence)
  if (value.artifact_manifest) assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest(value.artifact_manifest)
}

function assertSourceSemantics(
  value: ReplayPortfolioProtectiveTerminalAccountingEvidence,
  source: {
    protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
    protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
    risk_result: ReplayRuntimeSharedWalletRiskResult
  },
): void {
  assertReplayPortfolioProtectiveTerminalEvidence(source.protective_terminal_evidence)
  assertReplayPortfolioProtectiveTerminalArtifactManifest(source.protective_terminal_manifest)
  if (source.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(source.risk_result)
      || value.protective_terminal_evidence_hash !== source.protective_terminal_evidence.evidence_hash
      || value.protective_terminal_artifact_manifest_hash !== source.protective_terminal_manifest.manifest_hash
      || value.risk_result_hash !== source.risk_result.result_hash
      || value.shared_initial_cash !== source.protective_terminal_evidence.shared_initial_cash
      || value.settlement_asset !== source.protective_terminal_evidence.settlement_asset
      || value.trial_balance.ending_settled_cash !== source.protective_terminal_evidence.ending_settled_cash
      || value.trial_balance.ending_available_cash !== source.protective_terminal_evidence.ending_available_cash
      || value.trial_balance.ending_reserved_isolated_collateral
        !== source.protective_terminal_evidence.ending_reserved_isolated_collateral
      || value.trial_balance.ending_unrealized_pnl !== source.protective_terminal_evidence.ending_unrealized_pnl
      || value.trial_balance.ending_portfolio_nav !== source.protective_terminal_evidence.ending_portfolio_nav) {
    fail("source/economic binding")
  }
  const recordByHash = new Map(source.protective_terminal_evidence.lane_records
    .map((record) => [record.record_hash, record]))
  const riskEventByHash = new Map(source.risk_result.global_source_event_queue.map((event) => [event.event_hash, event]))
  for (const entry of value.ledger) {
    const record = recordByHash.get(entry.terminal_record_hash)
    if (!record || entry.lane_id !== record.lane_id || entry.symbol !== record.symbol
        || entry.terminal_owner !== record.owner || entry.event_time < record.entry_time
        || record.terminal_time && entry.event_time > record.terminal_time) fail("ledger record binding")
  }
  for (const record of source.protective_terminal_evidence.lane_records) {
    const entries = value.ledger.filter((entry) => entry.terminal_record_hash === record.record_hash)
    const postings = value.journal.filter((entry) => entry.terminal_record_hash === record.record_hash)
    if (record.owner === "not_opened") {
      if (entries.length !== 0 || postings.length !== 0) fail("rejected Lane accounting")
      continue
    }
    const amount = (kind: ReplayPortfolioProtectiveTerminalAccountingCashflowKind) =>
      addReplayDecimalValues(...entries.filter((entry) => entry.cashflow_kind === kind).map((entry) => entry.amount))
    if (amount("entry_fee") !== -record.entry_fee
        || amount("funding") !== record.funding_cashflow_before_terminal
        || amount("realized_pnl") !== record.realized_pnl
        || amount("terminal_trading_fee") !== -record.exit_trading_fee
        || amount("liquidation_fee") !== -record.liquidation_fee) fail("Lane economics")
    const terminalEntries = entries.filter((entry) => ["realized_pnl", "terminal_trading_fee", "liquidation_fee"]
      .includes(entry.cashflow_kind))
    if (terminalEntries.some((entry) => entry.source_event_hash !== record.terminal_source_hash
      || entry.boundary_phase !== record.terminal_phase)) fail("terminal owner posting")
    const entrySource = source.risk_result.global_source_event_queue.find(
      (event): event is ReplayRuntimeSharedWalletRiskEntryEvent => event.event_role === "entry"
        && event.lane_id === record.lane_id && event.outcome === "filled",
    )
    if (!entrySource || entrySource.fill_hash !== record.entry_fill_hash
        || entries.filter((entry) => entry.cashflow_kind === "entry_fee")
          .some((entry) => entry.source_event_hash !== entrySource.event_hash)
        || postings.filter((entry) => ["collateral_reserve", "entry_fee"].includes(entry.posting_kind))
          .some((entry) => entry.source_event_hash !== entrySource.event_hash)) fail("entry source binding")
    const expectedFunding = source.risk_result.global_source_event_queue.filter(
      (event): event is ReplayRuntimeSharedWalletFundingEvent => event.event_role === "funding"
        && event.lane_id === record.lane_id && event.outcome === "applied"
        && (!record.terminal_time || event.event_time < record.terminal_time
          || event.event_time === record.terminal_time && event.boundary_phase < (record.terminal_phase ?? 20)),
    )
      .filter((event) => event.funding_cashflow !== 0)
    const fundingEntries = entries.filter((entry) => entry.cashflow_kind === "funding")
    if (canonicalHash(fundingEntries.map((entry) => entry.source_event_hash).sort())
        !== canonicalHash(expectedFunding.map((event) => event.event_hash).sort())
        || fundingEntries.some((entry) => {
          const event = riskEventByHash.get(entry.source_event_hash)
          return event?.event_role !== "funding" || entry.amount !== event.funding_cashflow
        })
        || postings.filter((entry) => entry.posting_kind === "funding").some((entry) =>
          !fundingEntries.some((ledgerEntry) => ledgerEntry.source_event_hash === entry.source_event_hash))) {
      fail("Funding source binding")
    }
    if (postings.filter((entry) => ["realized_pnl", "terminal_trading_fee", "liquidation_fee",
      "collateral_release"].includes(entry.posting_kind)).some((entry) =>
      entry.source_event_hash !== record.terminal_source_hash || entry.boundary_phase !== record.terminal_phase)) {
      fail("terminal Journal source binding")
    }
    const markPostings = postings.filter((entry) => entry.posting_kind === "terminal_mark_to_market")
    if (markPostings.some((entry) => {
      const event = entry.source_event_hash ? riskEventByHash.get(entry.source_event_hash) : undefined
      return event?.lane_id !== record.lane_id
        || event.event_role !== "risk_observation" && event.event_role !== "entry"
    })) fail("terminal Mark source binding")
    if (postingAmount(postings, "collateral_reserve") !== record.isolated_collateral
        || postingAmount(postings, "entry_fee") !== record.entry_fee
        || postingAmount(postings, "funding") !== Math.abs(record.funding_cashflow_before_terminal)
        || postingAmount(postings, "realized_pnl") !== Math.abs(record.realized_pnl)
        || postingAmount(postings, "terminal_trading_fee") !== record.exit_trading_fee
        || postingAmount(postings, "liquidation_fee") !== record.liquidation_fee
        || postingAmount(postings, "collateral_release") !== record.released_collateral
        || postingAmount(postings, "terminal_mark_to_market") !== Math.abs(record.ending_unrealized_pnl)
        || postings.some((entry) => entry.terminal_owner !== record.owner)) fail("Lane Journal economics")
  }
  const expectedPreempted = source.protective_terminal_evidence.lane_records
    .flatMap((record) => record.preempted_upstream_terminal_hash ? [record.preempted_upstream_terminal_hash] : []).sort()
  if (canonicalHash(expectedPreempted) !== canonicalHash(value.excluded_preempted_source_hashes)) fail("preempted exclusion")
  const expectedPostFunding = source.risk_result.global_source_event_queue.filter((event) => {
    if (event.event_role !== "funding" || event.outcome !== "applied") return false
    const record = source.protective_terminal_evidence.lane_records.find((item) => item.lane_id === event.lane_id)
    return Boolean(record?.terminal_time && (event.event_time > record.terminal_time
      || event.event_time === record.terminal_time && event.boundary_phase >= (record.terminal_phase ?? 20)))
  }).map((event) => event.event_hash).sort()
  if (canonicalHash(expectedPostFunding) !== canonicalHash(value.excluded_post_terminal_funding_source_hashes)) {
    fail("post-terminal funding exclusion")
  }
}

function postingAmount(
  entries: ReplayPortfolioProtectiveTerminalAccountingJournalEntry[],
  kind: ReplayPortfolioProtectiveTerminalAccountingJournalEntry["posting_kind"],
): number {
  return addReplayDecimalValues(...entries.filter((entry) => entry.posting_kind === kind)
    .map((entry) => addReplayDecimalValues(...entry.legs.map((leg) => leg.debit))))
}

function assertTrialBalance(
  value: ReplayPortfolioProtectiveTerminalAccountingTrialBalance,
  journal: ReplayPortfolioProtectiveTerminalAccountingJournalEntry[],
): void {
  const recomputed = recomputeJournal(journal)
  if (value.accounting_policy_version !== REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION
      || value.balanced !== true || value.total_debits !== value.total_credits
      || value.total_debits !== recomputed.total_debits || value.total_credits !== recomputed.total_credits
      || canonicalHash(value.balances) !== canonicalHash(recomputed.balances)
      || value.ending_available_cash !== value.balances.wallet_cash
      || value.ending_reserved_isolated_collateral !== value.balances.isolated_margin_collateral
      || value.ending_settled_cash !== addReplayDecimalValues(
        value.ending_available_cash, value.ending_reserved_isolated_collateral,
      )
      || value.ending_unrealized_pnl !== addReplayDecimalValues(
        value.balances.unrealized_pnl_income, -value.balances.unrealized_pnl_loss,
      )
      || value.balances.position_valuation !== value.ending_unrealized_pnl
      || value.ending_portfolio_nav !== addReplayDecimalValues(value.ending_settled_cash, value.ending_unrealized_pnl)
      || value.trial_balance_hash !== replayPortfolioProtectiveTerminalAccountingTrialBalanceHash(value)) {
    fail("Trial Balance")
  }
}

function recomputeJournal(entries: ReplayPortfolioProtectiveTerminalAccountingJournalEntry[]) {
  const accounts: ReplayPortfolioProtectiveTerminalAccountingJournalAccount[] = [
    "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
    "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
    "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
  ]
  const creditNormal = new Set<ReplayPortfolioProtectiveTerminalAccountingJournalAccount>([
    "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
  ])
  const raw = Object.fromEntries(accounts.map((account) => [account, 0])) as
    Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of entries) for (const leg of entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit)
    totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  const balances = Object.fromEntries(accounts.map((account) => [
    account, creditNormal.has(account) ? -raw[account] : raw[account],
  ])) as Record<ReplayPortfolioProtectiveTerminalAccountingJournalAccount, number>
  return { total_debits: totalDebits, total_credits: totalCredits, balances }
}

function isSortedUnique(values: string[]): boolean {
  return new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify([...values].sort())
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}

function validTimestamp(value: string): boolean {
  return value.endsWith("Z") && Number.isFinite(Date.parse(value))
}

function fail(scope: string): never {
  throw new Error(`Portfolio Protective Terminal Accounting ${scope} invalid`)
}
