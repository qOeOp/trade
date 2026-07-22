import {
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioPostPartialStopReplacementAccountingEvidence,
  replayPortfolioPostPartialStopReplacementAccountingEvidenceHash,
  replayPortfolioPostPartialStopReplacementAccountingJournalEntryHash,
  replayPortfolioPostPartialStopReplacementAccountingLedgerEntryHash,
  replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash,
  replayPortfolioPostPartialStopReplacementOwnerBindingHash,
  replayPortfolioPostPartialStopReplacementOwners,
  summarizeReplayPortfolioPostPartialStopReplacementJournal,
  type ReplayPortfolioPostPartialStopReplacementAccountingEvidence,
  type ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry,
  type ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry,
  type ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance,
  type ReplayPortfolioPostPartialStopReplacementOwner,
  type ReplayPortfolioPostPartialStopReplacementOwnerBinding,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-accounting-contracts"
import {
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence,
  type ReplayPortfolioPostPartialStopReplacementRiskEvidence,
  type ReplayPortfolioPostPartialStopReplacementRiskRecord,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-risk-contracts"
import {
  canonicalHash,
  compareReplayEventKeys,
  type ReplayArtifactManifest,
  type ReplayJournalEntry,
  type ReplayLedgerEntry,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

export interface ReplayPortfolioPostPartialStopReplacementAccountingLane {
  lane_id: string
  result: ReplayResult
  artifact_manifest: ReplayArtifactManifest
}

interface BoundLane {
  lane_id: string
  record: ReplayPortfolioPostPartialStopReplacementRiskRecord
  result: ReplayResult
  artifact_manifest: ReplayArtifactManifest
  owner: ReplayPortfolioPostPartialStopReplacementOwner
}
interface LedgerSource { lane: BoundLane; entry: ReplayLedgerEntry; source_index: number }
interface JournalSource { lane: BoundLane; entry: ReplayJournalEntry; source_index: number }

export function createReplayPortfolioPostPartialStopReplacementAccountingEvidence(input: {
  risk_evidence: ReplayPortfolioPostPartialStopReplacementRiskEvidence
  lanes: ReplayPortfolioPostPartialStopReplacementAccountingLane[]
}): ReplayPortfolioPostPartialStopReplacementAccountingEvidence {
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence(input.risk_evidence)
  const lanes = bindLanes(input.risk_evidence, input.lanes)
  const ledger = createLedger(input.risk_evidence.initial_cash, lanes)
  const journal = createJournal(
    input.risk_evidence.initial_cash, input.risk_evidence.settlement_asset, lanes,
  )
  const trialBalance = createTrialBalance(input.risk_evidence, journal)
  if ((ledger.at(-1)?.settled_cash_after ?? input.risk_evidence.initial_cash)
      !== input.risk_evidence.ending_settled_cash) {
    throw new Error("Portfolio post-partial stop-replacement accounting Ledger does not reconcile")
  }
  const laneResultHashes = lanes.map((lane) => lane.record.lane_result_hash)
  const laneArtifactManifestHashes = lanes.map((lane) => lane.record.lane_artifact_manifest_hash)
  const laneOwnerBindings = lanes.map((lane) => {
    const bindingBody: Omit<ReplayPortfolioPostPartialStopReplacementOwnerBinding, "binding_hash"> = {
      lane_id: lane.lane_id, risk_record_hash: lane.record.record_hash, terminal_owner: lane.owner,
    }
    return { ...bindingBody,
      binding_hash: replayPortfolioPostPartialStopReplacementOwnerBindingHash(bindingBody) }
  })
  const laneOwnerBindingsHash = canonicalHash(laneOwnerBindings)
  const terminalOwnerCounts = counts(lanes.map((lane) => lane.owner))
  const ownerJournalPostingCounts = counts(journal.flatMap((entry) =>
    entry.terminal_owner === null ? [] : [entry.terminal_owner]))
  const fingerprintHash = canonicalHash({
    source_risk_evidence_hash: input.risk_evidence.evidence_hash,
    source_lane_bindings_hash: input.risk_evidence.source_lane_bindings_hash,
    lane_result_hashes: laneResultHashes,
    lane_artifact_manifest_hashes: laneArtifactManifestHashes,
    lane_owner_bindings_hash: laneOwnerBindingsHash,
    ledger_hash: canonicalHash(ledger), journal_hash: canonicalHash(journal),
    trial_balance_hash: trialBalance.trial_balance_hash,
    terminal_owner_counts: terminalOwnerCounts,
    owner_journal_posting_counts: ownerJournalPostingCounts,
    limitations: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_LIMITATIONS,
  })
  const body: Omit<ReplayPortfolioPostPartialStopReplacementAccountingEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION,
    portfolio_id: input.risk_evidence.portfolio_id,
    settlement_asset: input.risk_evidence.settlement_asset,
    source_risk_evidence_hash: input.risk_evidence.evidence_hash,
    source_lane_bindings_hash: input.risk_evidence.source_lane_bindings_hash,
    lane_result_hashes: laneResultHashes,
    lane_artifact_manifest_hashes: laneArtifactManifestHashes,
    lane_owner_bindings: laneOwnerBindings, lane_owner_bindings_hash: laneOwnerBindingsHash,
    ledger, journal, trial_balance: trialBalance,
    terminal_owner_counts: terminalOwnerCounts,
    owner_journal_posting_counts: ownerJournalPostingCounts,
    limitations: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_LIMITATIONS,
    fingerprint_hash: fingerprintHash,
  }
  const evidence = {
    ...body,
    evidence_hash: replayPortfolioPostPartialStopReplacementAccountingEvidenceHash(body),
  }
  assertReplayPortfolioPostPartialStopReplacementAccountingEvidence(evidence)
  return evidence
}

function bindLanes(
  evidence: ReplayPortfolioPostPartialStopReplacementRiskEvidence,
  inputLanes: ReplayPortfolioPostPartialStopReplacementAccountingLane[],
): BoundLane[] {
  if (inputLanes.length !== evidence.lane_records.length
      || new Set(inputLanes.map((lane) => lane.lane_id)).size !== inputLanes.length) {
    throw new Error("Portfolio post-partial stop-replacement accounting Lane coverage drift")
  }
  const byId = new Map(inputLanes.map((lane) => [lane.lane_id, lane]))
  return evidence.lane_records.map((record) => {
    const lane = byId.get(record.lane_id)
    if (!lane || lane.result.fingerprint.request_hash !== record.request_hash
        || lane.result.fingerprint.result_hash !== record.lane_result_hash
        || lane.artifact_manifest.result_hash !== record.lane_result_hash
        || canonicalHash(lane.artifact_manifest) !== record.lane_artifact_manifest_hash) {
      throw new Error(`Portfolio post-partial stop-replacement accounting Lane ${record.lane_id} source drift`)
    }
    const opening = lane.result.ledger.filter((entry) => entry.kind === "initial_cash")
    const ending = lane.result.ledger.filter((entry) => entry.kind === "ending_cash")
    if (opening.length !== 1 || opening[0]!.amount !== record.initial_cash
        || ending.length !== 1 || ending[0]!.balance_after !== record.ending_settled_cash
        || lane.result.trial_balance.settled_cash_balance !== record.ending_settled_cash
        || lane.result.trial_balance.wallet_cash_balance !== record.ending_available_cash
        || lane.result.trial_balance.isolated_margin_collateral_balance
          !== record.ending_reserved_isolated_collateral
        || lane.result.valuation_snapshot.unrealized_pnl !== record.ending_unrealized_pnl
        || lane.result.equity_bridge.ending_equity !== record.ending_portfolio_nav) {
      throw new Error(`Portfolio post-partial stop-replacement accounting Lane ${record.lane_id} balance drift`)
    }
    return { ...lane, record, owner: owner(record, lane.result) }
  })
}

function owner(record: ReplayPortfolioPostPartialStopReplacementRiskRecord,
  result: ReplayResult): ReplayPortfolioPostPartialStopReplacementOwner {
  const terminals = result.fills.filter((fill) => ["stop", "target", "strategy_exit", "liquidation"]
    .includes(fill.order_role))
  if (record.terminal_state === "open_at_data_end") {
    if (terminals.length !== 0 || record.terminal_fill_hash !== null) {
      throw new Error(`Portfolio post-partial stop-replacement accounting Lane ${record.lane_id} owner drift`)
    }
    return "open_at_data_end"
  }
  if (terminals.length !== 1 || canonicalHash(terminals[0]!) !== record.terminal_fill_hash) {
    throw new Error(`Portfolio post-partial stop-replacement accounting Lane ${record.lane_id} owner drift`)
  }
  const role = terminals[0]!.order_role
  if (role === "stop") return "replacement_protective_stop"
  if (role === "target") return "preserved_take_profit"
  if (role === "strategy_exit") return "strategy_exit"
  if (role === "liquidation") return "exact_liquidation"
  throw new Error(`Portfolio post-partial stop-replacement accounting Lane ${record.lane_id} owner drift`)
}

function createLedger(initialCash: number, lanes: BoundLane[]):
ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry[] {
  const sources: LedgerSource[] = []
  for (const lane of lanes) lane.result.ledger.forEach((entry, sourceIndex) => {
    if (!["fee", "funding", "realized_pnl", "liquidation_fee"].includes(entry.kind)
        || entry.amount === 0) return
    sources.push({ lane, entry, source_index: sourceIndex })
  })
  sources.sort((left, right) => compareReplayEventKeys(left.entry.event_key, right.entry.event_key)
    || left.lane.lane_id.localeCompare(right.lane.lane_id) || left.source_index - right.source_index)
  let settledCash = initialCash
  return sources.map((source, index) => {
    settledCash = addReplayDecimalValues(settledCash, source.entry.amount)
    const body: Omit<ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry, "ledger_entry_hash"> = {
      ledger_sequence: index + 1, event_key: structuredClone(source.entry.event_key),
      lane_id: source.lane.lane_id, symbol: source.lane.record.symbol,
      terminal_owner: source.lane.owner, risk_record_hash: source.lane.record.record_hash,
      source_lane_ledger_entry_hash: canonicalHash(source.entry), source_ref: source.entry.ref,
      cashflow_kind: source.entry.kind as ReplayPortfolioPostPartialStopReplacementAccountingLedgerEntry["cashflow_kind"],
      amount: source.entry.amount, settled_cash_after: settledCash,
    }
    return { ...body, ledger_entry_hash: replayPortfolioPostPartialStopReplacementAccountingLedgerEntryHash(body) }
  })
}

function createJournal(initialCash: number, settlementAsset: string, lanes: BoundLane[]):
ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry[] {
  const openingBody: Omit<ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry,
  "journal_entry_hash"> = {
    journal_sequence: 1, event_key: null, lane_id: null, terminal_owner: null,
    risk_record_hash: null, source_lane_journal_entry_hash: null, source_ref: "portfolio:opening-equity",
    posting_kind: "portfolio_opening_equity", source_posting_kind: "opening_balance",
    legs: [
      { leg_id: "portfolio:opening-equity:debit", account: "wallet_cash", side: "debit",
        asset: settlementAsset, amount: initialCash },
      { leg_id: "portfolio:opening-equity:credit", account: "opening_equity", side: "credit",
        asset: settlementAsset, amount: initialCash },
    ],
  }
  const journal = [{ ...openingBody,
    journal_entry_hash: replayPortfolioPostPartialStopReplacementAccountingJournalEntryHash(openingBody) }]
  const sources: JournalSource[] = []
  for (const lane of lanes) lane.result.journal.forEach((entry, sourceIndex) => {
    if (entry.kind !== "opening_balance") sources.push({ lane, entry, source_index: sourceIndex })
  })
  sources.sort((left, right) => compareReplayEventKeys(left.entry.event_key, right.entry.event_key)
    || left.lane.lane_id.localeCompare(right.lane.lane_id) || left.source_index - right.source_index)
  for (const source of sources) {
    const body: Omit<ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry,
    "journal_entry_hash"> = {
      journal_sequence: journal.length + 1, event_key: structuredClone(source.entry.event_key),
      lane_id: source.lane.lane_id, terminal_owner: source.lane.owner,
      risk_record_hash: source.lane.record.record_hash,
      source_lane_journal_entry_hash: canonicalHash(source.entry), source_ref: source.entry.ref,
      posting_kind: "certified_lane_result_posting", source_posting_kind: source.entry.kind,
      legs: structuredClone(source.entry.legs),
    }
    journal.push({ ...body,
      journal_entry_hash: replayPortfolioPostPartialStopReplacementAccountingJournalEntryHash(body) })
  }
  return journal
}

function createTrialBalance(risk: ReplayPortfolioPostPartialStopReplacementRiskEvidence,
  journal: ReplayPortfolioPostPartialStopReplacementAccountingJournalEntry[]):
ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance {
  const summary = summarizeReplayPortfolioPostPartialStopReplacementJournal(journal)
  const body: Omit<ReplayPortfolioPostPartialStopReplacementAccountingTrialBalance,
  "trial_balance_hash"> = {
    settlement_asset: risk.settlement_asset,
    accounting_policy_version: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_POLICY_VERSION,
    total_debits: summary.total_debits, total_credits: summary.total_credits, balances: summary.balances,
    ending_available_cash: risk.ending_available_cash,
    ending_reserved_isolated_collateral: risk.ending_reserved_isolated_collateral,
    ending_settled_cash: risk.ending_settled_cash,
    ending_unrealized_pnl: risk.ending_unrealized_pnl,
    ending_portfolio_nav: risk.ending_portfolio_nav,
    historical_admission_frozen_stop_risk: risk.historical_admission_frozen_stop_risk,
    ending_reserved_admission_risk: risk.ending_reserved_admission_risk,
    total_risk_budget_released: risk.total_risk_budget_released,
    ending_current_active_stop_bounded_risk: risk.ending_current_active_stop_bounded_risk,
    balanced: true,
  }
  const trialBalance = { ...body,
    trial_balance_hash: replayPortfolioPostPartialStopReplacementAccountingTrialBalanceHash(body) }
  if (summary.total_debits !== summary.total_credits
      || summary.balances.wallet_cash !== risk.ending_available_cash
      || summary.balances.isolated_margin_collateral !== risk.ending_reserved_isolated_collateral
      || summary.balances.position_valuation !== risk.ending_unrealized_pnl) {
    throw new Error("Portfolio post-partial stop-replacement Trial Balance does not reconcile")
  }
  return trialBalance
}

function counts(items: ReplayPortfolioPostPartialStopReplacementOwner[]) {
  return Object.fromEntries(replayPortfolioPostPartialStopReplacementOwners().map((owner) => [
    owner, items.filter((item) => item === owner).length,
  ])) as Record<ReplayPortfolioPostPartialStopReplacementOwner, number>
}
