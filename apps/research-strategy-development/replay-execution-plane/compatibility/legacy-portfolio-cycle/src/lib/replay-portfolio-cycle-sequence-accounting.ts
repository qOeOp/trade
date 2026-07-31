import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
  assertReplayPortfolioCycleSequenceAccountingEvidence,
  replayPortfolioCycleSequenceAccountingEvidenceHash,
  replayPortfolioCycleSequenceAccountingFingerprintHash,
  replayPortfolioCycleSequenceJournalEntryHash,
  replayPortfolioCycleSequenceLedgerEntryHash,
  replayPortfolioCycleSequenceTrialBalanceHash,
  type ReplayPortfolioCycleSequenceAccountingEvidence,
  type ReplayPortfolioCycleSequenceAccountingFingerprint,
  type ReplayPortfolioCycleSequenceJournalEntry,
  type ReplayPortfolioCycleSequenceLedgerEntry,
  type ReplayPortfolioCycleSequenceTrialBalance,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-accounting-contracts"
import type {
  ReplayPortfolioCycleSequenceArtifactManifest,
  ReplayPortfolioCycleSequenceResult,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import {
  assertReplayRuntimeSharedWalletPortfolioEvidence,
  type ReplayPortfolioJournalAccount,
  type ReplayRuntimeSharedWalletPortfolioEvidence,
} from "../../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import { canonicalHash } from "../../../../contracts/src/lib/replay-contracts"

const ACCOUNTS: ReplayPortfolioJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense",
  "fee_expense", "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<ReplayPortfolioJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])

export interface ReplayPortfolioCycleSequenceAccountingInput {
  authority: {
    experiment_id: string
    trial_group_id: string
    trial_group_hash: string
    portfolio_id: string
    sequence_reservation_hash: string
    issued_at: string
    settlement_asset: string
  }
  sequence_result: ReplayPortfolioCycleSequenceResult
  sequence_manifest: ReplayPortfolioCycleSequenceArtifactManifest
  cycle_evidence: ReplayRuntimeSharedWalletPortfolioEvidence[]
}

export function createReplayPortfolioCycleSequenceAccountingEvidence(
  input: ReplayPortfolioCycleSequenceAccountingInput,
): ReplayPortfolioCycleSequenceAccountingEvidence {
  const result = input.sequence_result
  if (input.authority.portfolio_id !== result.portfolio_id
      || input.authority.sequence_reservation_hash !== result.sequence_reservation_hash
      || input.cycle_evidence.length !== result.cycle_count) {
    throw new Error("Cycle Sequence Accounting authority or coverage drift")
  }
  input.cycle_evidence.forEach((evidence, index) => {
    assertReplayRuntimeSharedWalletPortfolioEvidence(evidence)
    const record = result.cycle_records[index]
    if (!record || record.cycle_index !== index + 1 || evidence.portfolio_id !== result.portfolio_id
        || evidence.risk_reservation_hash !== result.sequence_reservation_hash
        || evidence.evidence_hash !== record.portfolio_evidence_hash
        || evidence.trial_balance.balances.opening_equity !== record.opening_available_cash
        || evidence.trial_balance.ending_available_cash !== record.ending_available_cash
        || evidence.trial_balance.ending_reserved_isolated_collateral !== 0
        || evidence.trial_balance.ending_unrealized_pnl !== 0
        || (index > 0 && record.opening_available_cash !== result.cycle_records[index - 1]!.ending_available_cash)) {
      throw new Error(`Cycle Sequence Accounting cycle ${index + 1} does not roll forward`)
    }
  })
  const ledger: ReplayPortfolioCycleSequenceLedgerEntry[] = []
  const journal: ReplayPortfolioCycleSequenceJournalEntry[] = []
  input.cycle_evidence.forEach((evidence, index) => {
    const cycleIndex = index + 1
    for (const cycleEntry of evidence.portfolio_ledger) {
      const body: Omit<ReplayPortfolioCycleSequenceLedgerEntry, "sequence_entry_hash"> = {
        global_ledger_sequence: ledger.length + 1,
        cycle_index: cycleIndex,
        cycle_ledger_entry_hash: cycleEntry.ledger_entry_hash,
        cycle_entry: cycleEntry,
      }
      ledger.push({ ...body,
        sequence_entry_hash: replayPortfolioCycleSequenceLedgerEntryHash(
          body as ReplayPortfolioCycleSequenceLedgerEntry,
        ) })
    }
    const openingEntries = evidence.portfolio_journal.filter((entry) => entry.posting_kind === "opening_cash")
    if (openingEntries.length !== 1 || evidence.portfolio_journal[0]?.posting_kind !== "opening_cash") {
      throw new Error(`Cycle Sequence Accounting cycle ${cycleIndex} opening Journal is invalid`)
    }
    for (const cycleEntry of evidence.portfolio_journal) {
      if (cycleIndex > 1 && cycleEntry.posting_kind === "opening_cash") continue
      const body: Omit<ReplayPortfolioCycleSequenceJournalEntry, "sequence_entry_hash"> = {
        global_journal_sequence: journal.length + 1,
        cycle_index: cycleIndex,
        cycle_journal_entry_hash: cycleEntry.journal_entry_hash,
        cycle_entry: cycleEntry,
      }
      journal.push({ ...body,
        sequence_entry_hash: replayPortfolioCycleSequenceJournalEntryHash(
          body as ReplayPortfolioCycleSequenceJournalEntry,
        ) })
    }
  })
  const trialBalance = createTrialBalance(input.authority.settlement_asset, result, journal)
  const cycleHashes = input.cycle_evidence.map((evidence) => evidence.evidence_hash)
  const fingerprintBody: Omit<ReplayPortfolioCycleSequenceAccountingFingerprint, "fingerprint_hash"> = {
    experiment_id: input.authority.experiment_id,
    trial_group_id: input.authority.trial_group_id,
    trial_group_hash: input.authority.trial_group_hash,
    portfolio_id: result.portfolio_id,
    sequence_reservation_hash: result.sequence_reservation_hash,
    sequence_plan_hash: result.sequence_plan_hash,
    sequence_result_hash: result.result_hash,
    sequence_artifact_manifest_hash: input.sequence_manifest.manifest_hash,
    cycle_records_hash: result.cycle_records_hash,
    cycle_accounting_evidence_hashes: cycleHashes,
    consolidated_ledger_hash: canonicalHash(ledger),
    consolidated_journal_hash: canonicalHash(journal),
    consolidated_trial_balance_hash: trialBalance.trial_balance_hash,
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS),
  }
  const fingerprint = { ...fingerprintBody,
    fingerprint_hash: replayPortfolioCycleSequenceAccountingFingerprintHash(
      fingerprintBody as ReplayPortfolioCycleSequenceAccountingFingerprint,
    ) }
  const body: Omit<ReplayPortfolioCycleSequenceAccountingEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    experiment_id: input.authority.experiment_id,
    trial_group_id: input.authority.trial_group_id,
    trial_group_hash: input.authority.trial_group_hash,
    portfolio_id: result.portfolio_id,
    sequence_plan_hash: result.sequence_plan_hash,
    sequence_reservation_hash: result.sequence_reservation_hash,
    sequence_result_hash: result.result_hash,
    sequence_artifact_manifest_hash: input.sequence_manifest.manifest_hash,
    cycle_count: result.cycle_count,
    cycle_records: structuredClone(result.cycle_records),
    cycle_accounting_evidence_hashes: cycleHashes,
    consolidated_ledger: ledger,
    consolidated_journal: journal,
    consolidated_trial_balance: trialBalance,
    fingerprint,
    limitations: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_LIMITATIONS,
  }
  const evidence = { ...body,
    evidence_hash: replayPortfolioCycleSequenceAccountingEvidenceHash(
      body as ReplayPortfolioCycleSequenceAccountingEvidence,
    ) }
  assertReplayPortfolioCycleSequenceAccountingEvidence(evidence, {
    sequence_result: result,
    sequence_manifest: input.sequence_manifest,
    cycle_evidence: input.cycle_evidence,
  })
  return evidence
}

function createTrialBalance(
  settlementAsset: string,
  result: ReplayPortfolioCycleSequenceResult,
  journal: ReplayPortfolioCycleSequenceJournalEntry[],
): ReplayPortfolioCycleSequenceTrialBalance {
  const raw = Object.fromEntries(
    ACCOUNTS.map((account) => [account, 0]),
  ) as Record<ReplayPortfolioJournalAccount, number>
  let totalDebits = 0
  let totalCredits = 0
  for (const entry of journal) {
    for (const leg of entry.cycle_entry.legs) {
      totalDebits = add(totalDebits, leg.debit)
      totalCredits = add(totalCredits, leg.credit)
      raw[leg.account] = add(raw[leg.account], leg.debit, -leg.credit)
    }
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [
    account, CREDIT_NORMAL.has(account) ? -raw[account] : raw[account],
  ])) as Record<ReplayPortfolioJournalAccount, number>
  const body: Omit<ReplayPortfolioCycleSequenceTrialBalance, "trial_balance_hash"> = {
    settlement_asset: settlementAsset,
    journal_policy_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_JOURNAL_POLICY_VERSION,
    total_debits: totalDebits,
    total_credits: totalCredits,
    balances,
    opening_equity_posting_count: 1,
    initial_cash: result.initial_cash,
    ending_available_cash: result.ending_available_cash,
    ending_reserved_isolated_collateral: 0,
    ending_settled_cash: result.ending_available_cash,
    ending_unrealized_pnl: 0,
    ending_portfolio_nav: result.ending_available_cash,
    balanced: true,
  }
  return { ...body,
    trial_balance_hash: replayPortfolioCycleSequenceTrialBalanceHash(
      body as ReplayPortfolioCycleSequenceTrialBalance,
    ) }
}

function add(...values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12))
}
