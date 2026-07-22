import {
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioTwoFixedPartialAccountingEvidence,
  replayPortfolioTwoFixedPartialAccountingEvidenceHash,
  replayPortfolioTwoFixedPartialAccountingJournalEntryHash,
  replayPortfolioTwoFixedPartialAccountingLedgerEntryHash,
  replayPortfolioTwoFixedPartialAccountingTrialBalanceHash,
  type ReplayPortfolioTwoFixedPartialAccountingEvidence,
  type ReplayPortfolioTwoFixedPartialAccountingJournalEntry,
  type ReplayPortfolioTwoFixedPartialAccountingLedgerEntry,
  type ReplayPortfolioTwoFixedPartialAccountingTrialBalance,
  type ReplayPortfolioTwoFixedPartialJournalAccount,
  type ReplayPortfolioTwoFixedPartialPostingKind,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-accounting-contracts"
import {
  assertReplayPortfolioTwoFixedPartialTerminalEvidence,
  type ReplayPortfolioTwoFixedPartialTerminalEvidence,
  type ReplayPortfolioTwoFixedPartialTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-terminal-contracts"
import {
  canonicalHash,
  compareReplayEventKeys,
  type ReplayArtifactManifest,
  type ReplayEventKey,
  type ReplayLedgerEntry,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
const ACCOUNTS: ReplayPortfolioTwoFixedPartialJournalAccount[] = [
  "wallet_cash", "isolated_margin_collateral", "position_valuation", "opening_equity",
  "realized_pnl_income", "realized_pnl_loss", "funding_income", "funding_expense", "fee_expense",
  "liquidation_fee_expense", "unrealized_pnl_income", "unrealized_pnl_loss",
]
const CREDIT_NORMAL = new Set<ReplayPortfolioTwoFixedPartialJournalAccount>([
  "opening_equity", "realized_pnl_income", "funding_income", "unrealized_pnl_income",
])
type SourceLane = { lane_id: string; result: ReplayResult; artifact_manifest: ReplayArtifactManifest }
export interface ReplayPortfolioTwoFixedPartialAccountingAuthorityBinding {
  reservation_hash: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  source_terminal_evidence_hash: string
  source_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lanes: Array<{ lane_id: string; priority_rank: number; run_id: string; request_hash: string
    source_terminal_record_hash: string }>
}
interface Event {
  key: ReplayEventKey
  rank: number
  lane_rank: number
  record: ReplayPortfolioTwoFixedPartialTerminalRecord
  kind: "entry" | "cashflow" | "release" | "mark"
  source_hash: string
  cashflow?: ReplayLedgerEntry
}

export function createReplayPortfolioTwoFixedPartialAccountingEvidence(input: {
  authority: ReplayPortfolioTwoFixedPartialAccountingAuthorityBinding
  terminal_evidence: ReplayPortfolioTwoFixedPartialTerminalEvidence
  lane_results: SourceLane[]
}): ReplayPortfolioTwoFixedPartialAccountingEvidence {
  assertReplayPortfolioTwoFixedPartialTerminalEvidence(input.terminal_evidence)
  assertSourceClosure(input.authority, input.terminal_evidence, input.lane_results)
  const materialized = materializeEvents(input.authority, input.terminal_evidence, input.lane_results)
  const ledger = createLedger(materialized.initialCash, materialized.events)
  const journal = createJournal(materialized.initialCash, materialized.events)
  const trialBalance = createTrialBalance(input.terminal_evidence, journal)
  if ((ledger.at(-1)?.settled_cash_after ?? materialized.initialCash)
      !== input.terminal_evidence.ending_settled_cash) {
    throw new Error("Portfolio two-fixed-partial accounting settled cash does not reconcile")
  }
  const laneResultHashes = input.lane_results.map((lane) => lane.result.fingerprint.result_hash)
  const laneArtifactManifestHashes = input.lane_results.map((lane) => canonicalHash(lane.artifact_manifest))
  const ownerPostingCounts = ownerCounts(ledger)
  const fingerprintHash = canonicalHash({
    reservation_hash: input.authority.reservation_hash,
    terminal_evidence_hash: input.terminal_evidence.evidence_hash,
    lane_result_hashes: laneResultHashes,
    lane_artifact_manifest_hashes: laneArtifactManifestHashes,
    ledger_hash: canonicalHash(ledger), journal_hash: canonicalHash(journal),
    trial_balance_hash: trialBalance.trial_balance_hash, owner_posting_counts: ownerPostingCounts,
    limitations: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_LIMITATIONS,
  })
  const body: Omit<ReplayPortfolioTwoFixedPartialAccountingEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION,
    experiment_id: input.authority.experiment_id, trial_group_id: input.authority.trial_group_id,
    trial_group_hash: input.authority.trial_group_hash, portfolio_id: input.authority.portfolio_id,
    settlement_asset: input.authority.settlement_asset, shared_initial_cash: materialized.initialCash,
    reservation_hash: input.authority.reservation_hash,
    terminal_evidence_hash: input.terminal_evidence.evidence_hash,
    lane_result_hashes: laneResultHashes, lane_artifact_manifest_hashes: laneArtifactManifestHashes,
    ledger, journal, trial_balance: trialBalance, owner_posting_counts: ownerPostingCounts,
    limitations: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_LIMITATIONS, fingerprint_hash: fingerprintHash,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioTwoFixedPartialAccountingEvidenceHash(body) }
  assertReplayPortfolioTwoFixedPartialAccountingEvidence(evidence)
  return evidence
}

function assertSourceClosure(authority: ReplayPortfolioTwoFixedPartialAccountingAuthorityBinding,
  evidence: ReplayPortfolioTwoFixedPartialTerminalEvidence, lanes: SourceLane[]): void {
  if (evidence.portfolio_id !== authority.portfolio_id || evidence.settlement_asset !== authority.settlement_asset
      || evidence.source_terminal_evidence_hash !== authority.source_terminal_evidence_hash
      || evidence.source_terminal_artifact_manifest_hash !== authority.source_terminal_artifact_manifest_hash
      || evidence.risk_result_hash !== authority.risk_result_hash
      || lanes.length !== authority.lanes.length || lanes.length !== evidence.lane_records.length) {
    throw new Error("Portfolio two-fixed-partial accounting authority closure drift")
  }
  const laneById = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  if (laneById.size !== lanes.length) throw new Error("Portfolio two-fixed-partial accounting Lane duplicate")
  for (const [index, reserved] of authority.lanes.entries()) {
    const source = laneById.get(reserved.lane_id)
    const record = evidence.lane_records.find((candidate) => candidate.lane_id === reserved.lane_id)
    if (!source || !record || reserved.priority_rank !== index + 1
        || source.result.run_id !== reserved.run_id
        || source.result.fingerprint.request_hash !== reserved.request_hash
        || source.result.fingerprint.result_hash !== record.lane_result_hash
        || source.artifact_manifest.result_hash !== record.lane_result_hash
        || canonicalHash(source.artifact_manifest) !== record.lane_artifact_manifest_hash
        || record.source_terminal_record_hash !== reserved.source_terminal_record_hash) {
      throw new Error(`Portfolio two-fixed-partial accounting Lane ${reserved.lane_id} source drift`)
    }
  }
}

function materializeEvents(authority: ReplayPortfolioTwoFixedPartialAccountingAuthorityBinding,
  evidence: ReplayPortfolioTwoFixedPartialTerminalEvidence, lanes: SourceLane[]) {
  const events: Event[] = []; let initialCash = 0
  const laneById = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  for (const [laneRank, reserved] of authority.lanes.entries()) {
    const source = laneById.get(reserved.lane_id)!
    const record = evidence.lane_records.find((candidate) => candidate.lane_id === reserved.lane_id)!
    const initialEntries = source.result.ledger.filter((entry) => entry.kind === "initial_cash")
    const endingEntries = source.result.ledger.filter((entry) => entry.kind === "ending_cash")
    if (initialEntries.length !== 1 || endingEntries.length !== 1
        || initialEntries[0]!.amount <= 0 || endingEntries[0]!.balance_after !== record.ending_settled_cash) {
      throw new Error(`Portfolio two-fixed-partial accounting Lane ${reserved.lane_id} cash boundary drift`)
    }
    initialCash = addReplayDecimalValues(initialCash, initialEntries[0]!.amount)
    const entry = source.result.fills.find((fill) => fill.order_role === "entry")
    if (!entry) throw new Error(`Portfolio two-fixed-partial accounting Lane ${reserved.lane_id} entry missing`)
    events.push({ key: structuredClone(entry.event_key), rank: 0, lane_rank: laneRank,
      record, kind: "entry", source_hash: canonicalHash(entry) })
    source.result.ledger.forEach((cashflow, index) => {
      if (!["fee", "funding", "realized_pnl", "liquidation_fee"].includes(cashflow.kind)
          || cashflow.amount === 0) return
      events.push({ key: structuredClone(cashflow.event_key), rank: 10 + index, lane_rank: laneRank,
        record, kind: "cashflow", source_hash: canonicalHash(cashflow), cashflow })
    })
    if (!record.ending_open) {
      const terminal = source.result.fills.find((fill) =>
        ["stop", "target", "strategy_exit", "liquidation"].includes(fill.order_role))
      if (!terminal || canonicalHash(terminal) !== record.terminal_fill_hash) {
        throw new Error(`Portfolio two-fixed-partial accounting Lane ${reserved.lane_id} terminal closure drift`)
      }
      events.push({ key: structuredClone(terminal.event_key), rank: 1_000, lane_rank: laneRank,
        record, kind: "release", source_hash: canonicalHash(terminal) })
    } else {
      const key = [...source.result.source_events].sort((left, right) =>
        compareReplayEventKeys(left.event_key, right.event_key)).at(-1)?.event_key
      if (!key) throw new Error(`Portfolio two-fixed-partial accounting Lane ${reserved.lane_id} mark missing`)
      events.push({ key: structuredClone(key), rank: 2_000, lane_rank: laneRank,
        record, kind: "mark", source_hash: record.record_hash })
    }
  }
  events.sort((left, right) => compareReplayEventKeys(left.key, right.key) || left.rank - right.rank
    || left.lane_rank - right.lane_rank || left.record.lane_id.localeCompare(right.record.lane_id))
  return { initialCash, events }
}

function createLedger(initialCash: number, events: Event[]): ReplayPortfolioTwoFixedPartialAccountingLedgerEntry[] {
  let settledCash = initialCash; const ledger: ReplayPortfolioTwoFixedPartialAccountingLedgerEntry[] = []
  for (const event of events) {
    if (event.kind !== "cashflow" || !event.cashflow) continue
    settledCash = addReplayDecimalValues(settledCash, event.cashflow.amount)
    const body: Omit<ReplayPortfolioTwoFixedPartialAccountingLedgerEntry, "ledger_entry_hash"> = {
      ledger_sequence: ledger.length + 1, event_key: structuredClone(event.key),
      source_lane_ledger_entry_hash: event.source_hash, source_ref: event.cashflow.ref,
      terminal_record_hash: event.record.record_hash, lane_id: event.record.lane_id,
      symbol: event.record.symbol, terminal_owner: event.record.owner,
      cashflow_kind: event.cashflow.kind as ReplayPortfolioTwoFixedPartialAccountingLedgerEntry["cashflow_kind"],
      amount: event.cashflow.amount, settled_cash_after: settledCash,
    }
    ledger.push({ ...body, ledger_entry_hash: replayPortfolioTwoFixedPartialAccountingLedgerEntryHash(body) })
  }
  return ledger
}

function createJournal(initialCash: number, events: Event[]): ReplayPortfolioTwoFixedPartialAccountingJournalEntry[] {
  const journal: ReplayPortfolioTwoFixedPartialAccountingJournalEntry[] = []
  const post = (event: Event | null, kind: ReplayPortfolioTwoFixedPartialPostingKind,
    debit: ReplayPortfolioTwoFixedPartialJournalAccount, credit: ReplayPortfolioTwoFixedPartialJournalAccount,
    amount: number) => {
    if (amount === 0) return
    const body: Omit<ReplayPortfolioTwoFixedPartialAccountingJournalEntry, "journal_entry_hash"> = {
      journal_sequence: journal.length + 1, event_key: event ? structuredClone(event.key) : null,
      source_hash: event?.source_hash ?? null, terminal_record_hash: event?.record.record_hash ?? null,
      lane_id: event?.record.lane_id ?? null, terminal_owner: event?.record.owner ?? null,
      posting_kind: kind,
      legs: [{ account: debit, debit: amount, credit: 0 }, { account: credit, debit: 0, credit: amount }],
    }
    journal.push({ ...body, journal_entry_hash: replayPortfolioTwoFixedPartialAccountingJournalEntryHash(body) })
  }
  post(null, "opening_cash", "wallet_cash", "opening_equity", initialCash)
  for (const event of events) {
    if (event.kind === "entry") post(event, "collateral_reserve", "isolated_margin_collateral",
      "wallet_cash", event.record.isolated_collateral)
    if (event.kind === "release") post(event, "collateral_release", "wallet_cash",
      "isolated_margin_collateral", event.record.isolated_collateral)
    if (event.kind === "mark") signed(event, "terminal_mark_to_market", event.record.ending_unrealized_pnl,
      "position_valuation", "unrealized_pnl_income", "unrealized_pnl_loss", "position_valuation", post)
    if (event.kind !== "cashflow" || !event.cashflow) continue
    const { kind, amount } = event.cashflow
    if (kind === "fee") post(event, "fee", "fee_expense", "wallet_cash", -amount)
    else if (kind === "liquidation_fee") post(event, "liquidation_fee",
      "liquidation_fee_expense", "wallet_cash", -amount)
    else if (kind === "funding") signed(event, "funding", amount, "wallet_cash", "funding_income",
      "funding_expense", "wallet_cash", post)
    else if (kind === "realized_pnl") signed(event, "realized_pnl", amount,
      "wallet_cash", "realized_pnl_income", "realized_pnl_loss", "wallet_cash", post)
  }
  return journal
}
type Post = (event: Event | null, kind: ReplayPortfolioTwoFixedPartialPostingKind,
  debit: ReplayPortfolioTwoFixedPartialJournalAccount, credit: ReplayPortfolioTwoFixedPartialJournalAccount,
  amount: number) => void
function signed(event: Event, kind: ReplayPortfolioTwoFixedPartialPostingKind, amount: number,
  positiveDebit: ReplayPortfolioTwoFixedPartialJournalAccount,
  positiveCredit: ReplayPortfolioTwoFixedPartialJournalAccount,
  negativeDebit: ReplayPortfolioTwoFixedPartialJournalAccount,
  negativeCredit: ReplayPortfolioTwoFixedPartialJournalAccount, post: Post) {
  if (amount > 0) post(event, kind, positiveDebit, positiveCredit, amount)
  if (amount < 0) post(event, kind, negativeDebit, negativeCredit, -amount)
}

function createTrialBalance(source: ReplayPortfolioTwoFixedPartialTerminalEvidence,
  journal: ReplayPortfolioTwoFixedPartialAccountingJournalEntry[]): ReplayPortfolioTwoFixedPartialAccountingTrialBalance {
  const raw = Object.fromEntries(ACCOUNTS.map((account) => [account, 0])) as
    Record<ReplayPortfolioTwoFixedPartialJournalAccount, number>
  let totalDebits = 0; let totalCredits = 0
  for (const entry of journal) for (const leg of entry.legs) {
    totalDebits = addReplayDecimalValues(totalDebits, leg.debit)
    totalCredits = addReplayDecimalValues(totalCredits, leg.credit)
    raw[leg.account] = addReplayDecimalValues(raw[leg.account], leg.debit, -leg.credit)
  }
  const balances = Object.fromEntries(ACCOUNTS.map((account) => [account,
    CREDIT_NORMAL.has(account) ? -raw[account] : raw[account]])) as
    Record<ReplayPortfolioTwoFixedPartialJournalAccount, number>
  const body = { settlement_asset: source.settlement_asset,
    accounting_policy_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_ACCOUNTING_POLICY_VERSION,
    total_debits: totalDebits, total_credits: totalCredits, balances,
    ending_available_cash: source.ending_available_cash,
    ending_reserved_isolated_collateral: source.ending_reserved_isolated_collateral,
    ending_settled_cash: source.ending_settled_cash, ending_unrealized_pnl: source.ending_unrealized_pnl,
    ending_portfolio_nav: source.ending_portfolio_nav, balanced: true as const }
  const trialBalance = { ...body,
    trial_balance_hash: replayPortfolioTwoFixedPartialAccountingTrialBalanceHash(body) }
  if (totalDebits !== totalCredits || balances.wallet_cash !== source.ending_available_cash
      || balances.isolated_margin_collateral !== source.ending_reserved_isolated_collateral
      || balances.position_valuation !== source.ending_unrealized_pnl) {
    throw new Error("Portfolio two-fixed-partial Trial Balance does not reconcile")
  }
  return trialBalance
}

function ownerCounts(entries: ReplayPortfolioTwoFixedPartialAccountingLedgerEntry[]) {
  const owners = ["initial_protective_stop", "initial_take_profit", "generation_two_protective_stop",
    "generation_two_take_profit", "generation_three_protective_stop", "generation_three_take_profit",
    "exact_liquidation", "strategy_exit", "generation_three_open_at_data_end"] as const
  return Object.fromEntries(owners.map((owner) => [owner,
    entries.filter((entry) => entry.terminal_owner === owner).length])) as
    ReplayPortfolioTwoFixedPartialAccountingEvidence["owner_posting_counts"]
}
