import { canonicalHash } from "./replay-contracts"
import type { ReplayRuntimeSharedWalletAuthorityBinding } from "./replay-runtime-shared-wallet-contracts"

export const REPLAY_PORTFOLIO_EVIDENCE_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-portfolio-evidence.v1" as const
export const REPLAY_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-portfolio-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-portfolio-artifact-outcome.v1" as const
export const REPLAY_PORTFOLIO_JOURNAL_POLICY_VERSION =
  "shared-wallet-available-cash-isolated-collateral-double-entry-v1" as const
export const REPLAY_PORTFOLIO_FINGERPRINT_POLICY_VERSION =
  "runtime-shared-wallet-exact-risk-evidence-fingerprint-v1" as const
export const REPLAY_PORTFOLIO_ARTIFACT_STORAGE_POLICY_VERSION =
  "immutable-payload-manifest-last-commit-marker-v1" as const

export interface ReplayPortfolioEvidenceAuthorityBinding extends ReplayRuntimeSharedWalletAuthorityBinding {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  issued_at: string
}

export type ReplayPortfolioJournalAccount =
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

export interface ReplayPortfolioLedgerEntry {
  ledger_sequence: number
  queue_ordinal: number
  source_event_hash: string
  event_time: string
  lane_id: string
  symbol: string
  cashflow_kind:
    | "entry_fee"
    | "funding"
    | "realized_pnl"
    | "strategy_exit_fee"
    | "liquidation_trading_fee"
    | "liquidation_fee"
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

export interface ReplayPortfolioJournalLeg {
  account: ReplayPortfolioJournalAccount
  debit: number
  credit: number
}

export interface ReplayPortfolioJournalEntry {
  journal_sequence: number
  event_time: string
  queue_ordinal: number | null
  source_event_hash: string | null
  lane_id: string | null
  posting_kind:
    | "opening_cash"
    | "collateral_reserve"
    | "collateral_release"
    | "entry_fee"
    | "funding"
    | "realized_pnl"
    | "strategy_exit_fee"
    | "liquidation_trading_fee"
    | "liquidation_fee"
    | "terminal_mark_to_market"
  legs: [ReplayPortfolioJournalLeg, ReplayPortfolioJournalLeg]
  journal_entry_hash: string
}

export interface ReplayPortfolioTrialBalance {
  settlement_asset: string
  journal_policy_version: typeof REPLAY_PORTFOLIO_JOURNAL_POLICY_VERSION
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioJournalAccount, number>
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  balanced: true
  trial_balance_hash: string
}

export interface ReplayPortfolioEvidenceFingerprint {
  fingerprint_policy_version: typeof REPLAY_PORTFOLIO_FINGERPRINT_POLICY_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  risk_reservation_hash: string
  risk_result_hash: string
  lane_authority_hash: string
  request_set_hash: string
  trial_reservation_set_hash: string
  attempt_lease_set_hash: string
  dataset_source_set_hash: string
  cost_policy_set_hash: string
  simulator_policy_version: "runtime_shared_wallet_exact_risk_full_liquidation_v1"
  event_ordering_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority"
  event_queue_hash: string
  open_positions_hash: string
  closed_positions_hash: string
  portfolio_ledger_hash: string
  portfolio_journal_hash: string
  trial_balance_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export interface ReplayRuntimeSharedWalletPortfolioEvidence {
  schema_version: typeof REPLAY_PORTFOLIO_EVIDENCE_SCHEMA_VERSION
  portfolio_id: string
  portfolio_plan_hash: string
  risk_reservation_hash: string
  risk_result_hash: string
  portfolio_ledger: ReplayPortfolioLedgerEntry[]
  portfolio_journal: ReplayPortfolioJournalEntry[]
  trial_balance: ReplayPortfolioTrialBalance
  fingerprint: ReplayPortfolioEvidenceFingerprint
  evidence_hash: string
}

export const REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES = [
  "portfolio_plan",
  "risk_reservation",
  "risk_result",
  "global_event_queue",
  "open_positions",
  "closed_positions",
  "portfolio_ledger",
  "portfolio_journal",
  "portfolio_trial_balance",
  "portfolio_fingerprint",
  "portfolio_evidence",
] as const

export type ReplayPortfolioArtifactRole = typeof REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES[number]

export interface ReplayPortfolioArtifactFile {
  role: ReplayPortfolioArtifactRole
  name: string
  ref: string
  sha256: string
}

export interface ReplayPortfolioArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  evidence_fingerprint_hash: string
  risk_result_hash: string
  idempotency_key_hash: string
  attempt_id_hash: string
  storage_policy_version: typeof REPLAY_PORTFOLIO_ARTIFACT_STORAGE_POLICY_VERSION
  files: ReplayPortfolioArtifactFile[]
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES
    commit_marker: "portfolio-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioArtifactCommit {
  manifest_ref: string
  manifest_sha256: string
  manifest_hash: string
  evidence_fingerprint_hash: string
}

export interface ReplayPortfolioArtifactOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "committed" | "failed"
  idempotent_replay: boolean
  artifact_manifest: ReplayPortfolioArtifactManifest | null
  artifact_commit: ReplayPortfolioArtifactCommit | null
  failure: {
    code: "portfolio-evidence-invalid" | "portfolio-artifact-store-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioLedgerEntryHash(value: ReplayPortfolioLedgerEntry): string {
  const { ledger_entry_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function replayPortfolioJournalEntryHash(value: ReplayPortfolioJournalEntry): string {
  const { journal_entry_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function replayPortfolioTrialBalanceHash(value: ReplayPortfolioTrialBalance): string {
  const { trial_balance_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function replayPortfolioFingerprintHash(value: ReplayPortfolioEvidenceFingerprint): string {
  const { fingerprint_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function replayPortfolioEvidenceHash(value: ReplayRuntimeSharedWalletPortfolioEvidence): string {
  const { evidence_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function replayPortfolioArtifactManifestHash(value: ReplayPortfolioArtifactManifest): string {
  const { manifest_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function replayPortfolioArtifactOutcomeHash(value: ReplayPortfolioArtifactOutcome): string {
  const { outcome_hash: _hash, ...body } = value
  return canonicalHash(body)
}

export function assertReplayRuntimeSharedWalletPortfolioEvidence(
  value: ReplayRuntimeSharedWalletPortfolioEvidence,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_EVIDENCE_SCHEMA_VERSION) fail("evidence schema")
  required(value.portfolio_id, "portfolio_id")
  for (const [name, hash] of Object.entries({
    portfolio_plan_hash: value.portfolio_plan_hash,
    risk_reservation_hash: value.risk_reservation_hash,
    risk_result_hash: value.risk_result_hash,
    evidence_hash: value.evidence_hash,
  })) digest(hash, name)
  let settled = value.trial_balance.balances.opening_equity
  for (const [index, entry] of value.portfolio_ledger.entries()) {
    if (entry.ledger_sequence !== index + 1 || entry.ledger_entry_hash !== replayPortfolioLedgerEntryHash(entry)) {
      fail("ledger sequence or hash")
    }
    digest(entry.source_event_hash, "ledger source_event_hash")
    timestamp(entry.event_time, "ledger event_time")
    if (!Number.isFinite(entry.amount)) fail("ledger amount")
    settled = add(settled, entry.amount)
    if (entry.settled_cash_after !== settled) fail("ledger cash chain")
  }
  for (const [index, entry] of value.portfolio_journal.entries()) {
    if (entry.journal_sequence !== index + 1 || entry.journal_entry_hash !== replayPortfolioJournalEntryHash(entry)) {
      fail("journal sequence or hash")
    }
    timestamp(entry.event_time, "journal event_time")
    if (entry.legs.length !== 2) fail("journal leg count")
    const debits = add(...entry.legs.map((leg) => leg.debit))
    const credits = add(...entry.legs.map((leg) => leg.credit))
    if (debits <= 0 || debits !== credits
        || entry.legs.some((leg) => !Number.isFinite(leg.debit) || !Number.isFinite(leg.credit)
          || leg.debit < 0 || leg.credit < 0 || (leg.debit > 0) === (leg.credit > 0))) {
      fail("journal double entry")
    }
  }
  const recomputed = recomputeJournal(value.portfolio_journal)
  if (recomputed.total_debits !== value.trial_balance.total_debits
      || recomputed.total_credits !== value.trial_balance.total_credits
      || Object.entries(recomputed.balances).some(
        ([account, balance]) => value.trial_balance.balances[account as ReplayPortfolioJournalAccount] !== balance,
      )) {
    fail("journal and Trial Balance reconciliation")
  }
  assertTrialBalance(value.trial_balance)
  assertFingerprint(value.fingerprint, value)
  if (value.evidence_hash !== replayPortfolioEvidenceHash(value)) fail("evidence hash")
}

export function assertReplayPortfolioArtifactManifest(value: ReplayPortfolioArtifactManifest): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || value.storage_policy_version !== REPLAY_PORTFOLIO_ARTIFACT_STORAGE_POLICY_VERSION) fail("manifest policy")
  required(value.artifact_id, "artifact_id")
  required(value.portfolio_id, "portfolio_id")
  timestamp(value.authority_frozen_at, "authority_frozen_at")
  for (const hash of [value.evidence_fingerprint_hash, value.risk_result_hash, value.idempotency_key_hash,
    value.attempt_id_hash, value.manifest_hash]) digest(hash, "manifest hash")
  if (value.files.length !== REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES.length
      || value.files.some((file, index) => file.role !== REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES[index]
        || !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || file.ref.trim() === "" || !/^[a-f0-9]{64}$/.test(file.sha256))) {
    fail("manifest files")
  }
  if (value.completeness.authoritative_result !== true
      || value.completeness.commit_marker !== "portfolio-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES)) {
    fail("manifest completeness")
  }
  if (value.manifest_hash !== replayPortfolioArtifactManifestHash(value)) fail("manifest hash mismatch")
}

export function assertReplayPortfolioArtifactOutcome(value: ReplayPortfolioArtifactOutcome): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION) fail("artifact outcome schema")
  required(value.portfolio_id, "portfolio_id")
  if (value.status === "committed") {
    if (!value.artifact_manifest || !value.artifact_commit || value.failure !== null) fail("committed outcome")
    assertReplayPortfolioArtifactManifest(value.artifact_manifest)
    if (value.artifact_commit.manifest_hash !== value.artifact_manifest.manifest_hash
        || value.artifact_commit.evidence_fingerprint_hash !== value.artifact_manifest.evidence_fingerprint_hash) {
      fail("artifact commit binding")
    }
    digest(value.artifact_commit.manifest_sha256, "manifest_sha256")
    required(value.artifact_commit.manifest_ref, "manifest_ref")
  } else if (value.artifact_manifest !== null || value.artifact_commit !== null || !value.failure
      || value.failure.partial_result_published !== false || value.idempotent_replay) {
    fail("failed artifact outcome")
  }
  if (value.outcome_hash !== replayPortfolioArtifactOutcomeHash(value)) fail("artifact outcome hash")
}

function assertTrialBalance(value: ReplayPortfolioTrialBalance): void {
  if (value.journal_policy_version !== REPLAY_PORTFOLIO_JOURNAL_POLICY_VERSION || value.balanced !== true
      || value.total_debits !== value.total_credits || value.ending_available_cash !== value.balances.wallet_cash
      || value.ending_reserved_isolated_collateral !== value.balances.isolated_margin_collateral
      || value.ending_settled_cash !== add(value.ending_available_cash, value.ending_reserved_isolated_collateral)
      || value.ending_unrealized_pnl !== add(value.balances.unrealized_pnl_income, -value.balances.unrealized_pnl_loss)
      || value.balances.position_valuation !== value.ending_unrealized_pnl
      || value.ending_portfolio_nav !== add(value.ending_settled_cash, value.ending_unrealized_pnl)
      || value.trial_balance_hash !== replayPortfolioTrialBalanceHash(value)) fail("trial balance")
}

function recomputeJournal(entries: ReplayPortfolioJournalEntry[]): {
  total_debits: number
  total_credits: number
  balances: Record<ReplayPortfolioJournalAccount, number>
} {
  const accounts: ReplayPortfolioJournalAccount[] = [
    "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
    "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
    "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
  ]
  const creditNormal = new Set<ReplayPortfolioJournalAccount>([
    "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
  ])
  const raw = Object.fromEntries(accounts.map((account) => [account, 0])) as Record<ReplayPortfolioJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of entries) {
    for (const leg of entry.legs) {
      totalDebits = add(totalDebits, leg.debit)
      totalCredits = add(totalCredits, leg.credit)
      raw[leg.account] = add(raw[leg.account], leg.debit, -leg.credit)
    }
  }
  return {
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances: Object.fromEntries(accounts.map((account) => [
      account, creditNormal.has(account) ? -raw[account] : raw[account],
    ])) as Record<ReplayPortfolioJournalAccount, number>,
  }
}

function assertFingerprint(
  value: ReplayPortfolioEvidenceFingerprint,
  evidence: ReplayRuntimeSharedWalletPortfolioEvidence,
): void {
  if (value.fingerprint_policy_version !== REPLAY_PORTFOLIO_FINGERPRINT_POLICY_VERSION
      || value.simulator_policy_version !== "runtime_shared_wallet_exact_risk_full_liquidation_v1"
      || value.event_ordering_policy
        !== "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority"
      || value.portfolio_id !== evidence.portfolio_id || value.portfolio_plan_hash !== evidence.portfolio_plan_hash
      || value.risk_reservation_hash !== evidence.risk_reservation_hash || value.risk_result_hash !== evidence.risk_result_hash
      || value.portfolio_ledger_hash !== canonicalHash(evidence.portfolio_ledger)
      || value.portfolio_journal_hash !== canonicalHash(evidence.portfolio_journal)
      || value.trial_balance_hash !== evidence.trial_balance.trial_balance_hash
      || value.fingerprint_hash !== replayPortfolioFingerprintHash(value)) fail("fingerprint")
}

function add(...values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12))
}

function digest(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) fail(name)
}

function timestamp(value: string, name: string): void {
  if (!value.endsWith("Z") || !Number.isFinite(Date.parse(value))) fail(name)
}

function required(value: string, name: string): void {
  if (value.trim() === "") fail(name)
}

function fail(name: string): never {
  throw new Error(`runtime shared wallet Portfolio ${name} is invalid`)
}
