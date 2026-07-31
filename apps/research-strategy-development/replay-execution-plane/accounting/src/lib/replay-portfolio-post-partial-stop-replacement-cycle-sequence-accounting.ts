import {
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION,
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence,
  replayPortfolioPostPartialStopReplacementCycleCommitHash,
  replayPortfolioPostPartialStopReplacementCycleJournalEntryHash,
  replayPortfolioPostPartialStopReplacementCycleLedgerEntryHash,
  replayPortfolioPostPartialStopReplacementCycleSequenceEvidenceHash,
  type ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest,
  assertReplayPortfolioPostPartialStopReplacementAccountingEvidence,
  replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash,
  summarizeReplayPortfolioPostPartialStopReplacementJournal,
  type ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest,
  type ReplayPortfolioPostPartialStopReplacementAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-accounting-contracts"
import {
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence,
  type ReplayPortfolioPostPartialStopReplacementRiskEvidence,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

export interface ReplayPortfolioPostPartialStopReplacementCycleSequenceAuthorityBinding {
  reservation_hash: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
  cycles: Array<{ cycle_index: number }>
}

export interface ReplayPortfolioPostPartialStopReplacementCycleSource {
  cycle_index: number
  full_flat_close_time: string
  risk_evidence: ReplayPortfolioPostPartialStopReplacementRiskEvidence
  accounting_evidence: ReplayPortfolioPostPartialStopReplacementAccountingEvidence
  accounting_manifest: ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest
}

export function createReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence(input: {
  authority: ReplayPortfolioPostPartialStopReplacementCycleSequenceAuthorityBinding
  cycles: ReplayPortfolioPostPartialStopReplacementCycleSource[]
}): ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence {
  if (input.cycles.length !== input.authority.cycles.length || input.cycles.length < 1
      || input.cycles.length > 8) {
    throw new Error("P28 cycle source coverage drift")
  }
  const commits = input.cycles.map((cycle, index) => {
    assertReplayPortfolioPostPartialStopReplacementRiskEvidence(cycle.risk_evidence)
    assertReplayPortfolioPostPartialStopReplacementAccountingEvidence(cycle.accounting_evidence)
    assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest(cycle.accounting_manifest)
    const risk = cycle.risk_evidence
    const accounting = cycle.accounting_evidence
    if (cycle.cycle_index !== index + 1
        || input.authority.cycles[index]!.cycle_index !== cycle.cycle_index
        || risk.portfolio_id !== input.authority.portfolio_id
        || risk.settlement_asset !== input.authority.settlement_asset
        || accounting.portfolio_id !== risk.portfolio_id
        || accounting.source_risk_evidence_hash !== risk.evidence_hash
        || cycle.accounting_manifest.accounting_evidence_hash !== accounting.evidence_hash
        || cycle.accounting_manifest.source_risk_evidence_hash !== risk.evidence_hash
        || risk.open_lane_count !== 0 || risk.flat_lane_count !== risk.lane_records.length
        || risk.ending_reserved_isolated_collateral !== 0 || risk.ending_unrealized_pnl !== 0
        || risk.ending_gross_mark_exposure !== 0 || risk.ending_net_mark_exposure !== 0
        || risk.ending_reserved_admission_risk !== 0
        || risk.ending_current_active_stop_bounded_risk !== 0
        || risk.historical_admission_frozen_stop_risk !== risk.total_risk_budget_released
        || accounting.trial_balance.ending_reserved_isolated_collateral !== 0
        || accounting.trial_balance.ending_unrealized_pnl !== 0
        || accounting.trial_balance.ending_reserved_admission_risk !== 0
        || accounting.trial_balance.ending_current_active_stop_bounded_risk !== 0
        || accounting.trial_balance.historical_admission_frozen_stop_risk
          !== accounting.trial_balance.total_risk_budget_released
        || !Number.isFinite(Date.parse(cycle.full_flat_close_time))) {
      throw new Error(`P28 cycle ${cycle.cycle_index} is not a committed full-flat child`)
    }
    const expectedOpening = index === 0 ? input.authority.initial_cash
      : input.cycles[index - 1]!.accounting_evidence.trial_balance.ending_available_cash
    if (risk.initial_cash !== expectedOpening) {
      throw new Error(`P28 cycle ${cycle.cycle_index} cash bridge drift`)
    }
    const body = {
      cycle_index: cycle.cycle_index,
      opening_available_cash: risk.initial_cash,
      risk_evidence_hash: risk.evidence_hash,
      accounting_evidence_hash: accounting.evidence_hash,
      accounting_artifact_manifest_hash: cycle.accounting_manifest.manifest_hash,
      lane_result_hashes_hash: canonicalHash(accounting.lane_result_hashes),
      lane_owner_bindings_hash: accounting.lane_owner_bindings_hash,
      full_flat_close_time: cycle.full_flat_close_time,
      ending_available_cash: accounting.trial_balance.ending_available_cash,
      trial_balance_hash: accounting.trial_balance.trial_balance_hash,
      historical_admission_frozen_stop_risk: risk.historical_admission_frozen_stop_risk,
      total_risk_budget_released: risk.total_risk_budget_released,
    }
    return { ...body,
      cycle_commit_hash: replayPortfolioPostPartialStopReplacementCycleCommitHash(body) }
  })
  const ledger = input.cycles.flatMap((cycle) => cycle.accounting_evidence.ledger.map((cycleEntry) => ({
    global_ledger_sequence: 0,
    cycle_index: cycle.cycle_index,
    cycle_ledger_entry_hash: cycleEntry.ledger_entry_hash,
    cycle_entry: structuredClone(cycleEntry),
  }))).map((entry, index) => {
    const body = { ...entry, global_ledger_sequence: index + 1 }
    return { ...body,
      sequence_entry_hash: replayPortfolioPostPartialStopReplacementCycleLedgerEntryHash(body) }
  })
  const journal = input.cycles.flatMap((cycle) => cycle.accounting_evidence.journal
    .filter((entry) => cycle.cycle_index === 1 || entry.posting_kind !== "portfolio_opening_equity")
    .map((cycleEntry) => ({
      global_journal_sequence: 0,
      cycle_index: cycle.cycle_index,
      cycle_journal_entry_hash: cycleEntry.journal_entry_hash,
      cycle_entry: structuredClone(cycleEntry),
    }))).map((entry, index) => {
      const body = { ...entry, global_journal_sequence: index + 1 }
      return { ...body,
        sequence_entry_hash: replayPortfolioPostPartialStopReplacementCycleJournalEntryHash(body) }
    })
  const summary = summarizeReplayPortfolioPostPartialStopReplacementJournal(
    journal.map((entry) => entry.cycle_entry),
  )
  const ending = commits.at(-1)!.ending_available_cash
  const historicalRisk = addReplayDecimalValues(...commits.map(
    (commit) => commit.historical_admission_frozen_stop_risk,
  ))
  const releasedRisk = addReplayDecimalValues(...commits.map(
    (commit) => commit.total_risk_budget_released,
  ))
  const trialBalanceBody = {
    settlement_asset: input.authority.settlement_asset,
    accounting_policy_version:
      REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION,
    total_debits: summary.total_debits,
    total_credits: summary.total_credits,
    balances: summary.balances,
    ending_available_cash: ending,
    ending_reserved_isolated_collateral: 0,
    ending_settled_cash: ending,
    ending_unrealized_pnl: 0,
    ending_portfolio_nav: ending,
    historical_admission_frozen_stop_risk: historicalRisk,
    ending_reserved_admission_risk: 0,
    total_risk_budget_released: releasedRisk,
    ending_current_active_stop_bounded_risk: 0,
    balanced: true as const,
    opening_equity_posting_count: 1 as const,
  }
  const trialBalance = { ...trialBalanceBody,
    trial_balance_hash:
      replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash(trialBalanceBody) }
  if (summary.total_debits !== summary.total_credits || summary.balances.wallet_cash !== ending
      || summary.balances.isolated_margin_collateral !== 0
      || summary.balances.position_valuation !== 0 || historicalRisk !== releasedRisk
      || journal.filter((entry) => entry.cycle_entry.posting_kind === "portfolio_opening_equity").length
        !== 1) {
    throw new Error("P28 cycle consolidated Trial Balance does not reconcile")
  }
  const cycleCommitsHash = canonicalHash(commits)
  const fingerprintHash = canonicalHash({
    cycle_commits_hash: cycleCommitsHash,
    consolidated_ledger_hash: canonicalHash(ledger),
    consolidated_journal_hash: canonicalHash(journal),
    consolidated_trial_balance_hash: trialBalance.trial_balance_hash,
    limitations: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS,
  })
  const body: Omit<ReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence, "evidence_hash"> = {
    schema_version:
      REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_POLICY_VERSION,
    experiment_id: input.authority.experiment_id,
    trial_group_id: input.authority.trial_group_id,
    trial_group_hash: input.authority.trial_group_hash,
    portfolio_id: input.authority.portfolio_id,
    sequence_reservation_hash: input.authority.reservation_hash,
    settlement_asset: input.authority.settlement_asset,
    cycle_count: commits.length,
    cycle_commits: commits,
    cycle_commits_hash: cycleCommitsHash,
    consolidated_ledger: ledger,
    consolidated_journal: journal,
    consolidated_trial_balance: trialBalance,
    initial_cash: input.authority.initial_cash,
    ending_available_cash: ending,
    ending_reserved_isolated_collateral: 0,
    ending_unrealized_pnl: 0,
    ending_portfolio_nav: ending,
    historical_admission_frozen_stop_risk: historicalRisk,
    ending_reserved_admission_risk: 0,
    total_risk_budget_released: releasedRisk,
    ending_current_active_stop_bounded_risk: 0,
    limitations: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_LIMITATIONS,
    fingerprint_hash: fingerprintHash,
  }
  const evidence = { ...body,
    evidence_hash: replayPortfolioPostPartialStopReplacementCycleSequenceEvidenceHash(body) }
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence(evidence)
  return evidence
}
