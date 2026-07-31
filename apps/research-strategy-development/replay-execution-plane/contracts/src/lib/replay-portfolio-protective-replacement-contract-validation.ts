import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalEvidence,
} from "./replay-portfolio-protective-terminal-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskResult,
} from "./replay-runtime-shared-wallet-risk-contracts"

interface ReplacementTerminalCommonEvidence {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  source_protective_terminal_evidence_hash: string
  source_protective_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  lane_records_hash: string
  ohlcv_resolutions_hash: string
  limitations: readonly string[]
  terminal_owner_counts: unknown
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  fingerprint: {
    experiment_id: string
    trial_group_id: string
    trial_group_hash: string
    portfolio_id: string
    source_protective_terminal_evidence_hash: string
    source_protective_terminal_artifact_manifest_hash: string
    risk_result_hash: string
    lane_records_hash: string
    ohlcv_resolutions_hash: string
    economic_summary_hash: string
    limitations_hash: string
    fingerprint_hash: string
  }
  evidence_hash: string
}

interface ReplacementEconomicSummary {
  ending_settled_cash: number
  ending_reserved_isolated_collateral: number
  ending_available_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
}

export function assertReplayPortfolioProtectiveReplacementTerminalCommon(input: {
  value: ReplacementTerminalCommonEvidence
  owner_counts: unknown
  economics: ReplacementEconomicSummary
  fingerprint_hash: string
  evidence_hash: string
  source?: {
    evidence: ReplayPortfolioProtectiveTerminalEvidence
    manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
    risk_result_hash: string
  }
  fail: (scope: string) => never
}): void {
  const { value, economics, fail } = input
  if (canonicalHash(input.owner_counts) !== canonicalHash(value.terminal_owner_counts)) fail("owner counts")
  if (canonicalHash(economics) !== value.fingerprint.economic_summary_hash
      || economics.ending_settled_cash !== value.ending_settled_cash
      || economics.ending_reserved_isolated_collateral !== value.ending_reserved_isolated_collateral
      || economics.ending_available_cash !== value.ending_available_cash
      || economics.ending_unrealized_pnl !== value.ending_unrealized_pnl
      || economics.ending_portfolio_nav !== value.ending_portfolio_nav) fail("economics")
  const fingerprint = value.fingerprint
  if (fingerprint.experiment_id !== value.experiment_id || fingerprint.trial_group_id !== value.trial_group_id
      || fingerprint.trial_group_hash !== value.trial_group_hash || fingerprint.portfolio_id !== value.portfolio_id
      || fingerprint.source_protective_terminal_evidence_hash !== value.source_protective_terminal_evidence_hash
      || fingerprint.source_protective_terminal_artifact_manifest_hash
        !== value.source_protective_terminal_artifact_manifest_hash
      || fingerprint.risk_result_hash !== value.risk_result_hash
      || fingerprint.lane_records_hash !== value.lane_records_hash
      || fingerprint.ohlcv_resolutions_hash !== value.ohlcv_resolutions_hash
      || fingerprint.limitations_hash !== canonicalHash(value.limitations)
      || fingerprint.fingerprint_hash !== input.fingerprint_hash) fail("fingerprint")
  if (value.evidence_hash !== input.evidence_hash) fail("evidence hash")
  if (input.source) {
    assertReplayPortfolioProtectiveTerminalEvidence(input.source.evidence)
    assertReplayPortfolioProtectiveTerminalArtifactManifest(input.source.manifest)
    if (value.source_protective_terminal_evidence_hash !== input.source.evidence.evidence_hash
        || value.source_protective_terminal_artifact_manifest_hash !== input.source.manifest.manifest_hash
        || value.risk_result_hash !== input.source.risk_result_hash
        || input.source.manifest.protective_terminal_evidence_hash !== input.source.evidence.evidence_hash) {
      fail("source binding")
    }
  }
}

interface ReplacementAccountingLedgerEntry {
  ledger_sequence: number
  accounting_ordinal: number
  event_time: string
  boundary_phase: number
  source_event_hash: string
  terminal_record_hash: string
  lane_id: string
  symbol: string
  terminal_owner: string
  cashflow_kind: "entry_fee" | "funding" | "realized_pnl" | "terminal_trading_fee" | "liquidation_fee"
  amount: number
  settled_cash_after: number
  ledger_entry_hash: string
}

interface ReplacementAccountingJournalEntry {
  journal_sequence: number
  posting_kind: string
  terminal_record_hash: string | null
  lane_id: string | null
  terminal_owner: string | null
  event_time: string
  legs: Array<{ debit: number; credit: number }>
  journal_entry_hash: string
}

interface ReplacementAccountingTrialBalance {
  accounting_policy_version: string
  balanced: boolean
  total_debits: number
  total_credits: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_settled_cash: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  trial_balance_hash: string
}

interface ReplacementAccountingEvidence {
  shared_initial_cash: number
  settlement_asset: string
  replacement_terminal_evidence_hash: string
  replacement_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  ledger: ReplacementAccountingLedgerEntry[]
  journal: ReplacementAccountingJournalEntry[]
  trial_balance: ReplacementAccountingTrialBalance
  excluded_preempted_source_hashes: string[]
  excluded_post_terminal_funding_source_hashes: string[]
}

interface ReplacementTerminalAccountingRecord {
  record_hash: string
  lane_id: string
  symbol: string
  owner: string
  entry_fee: number
  terminal_time: string | null
  terminal_phase: number | null
  terminal_source_hash: string | null
  realized_pnl: number
  exit_trading_fee: number
  liquidation_fee: number
  preempted_upstream_terminal_hash: string | null
}

interface ReplacementTerminalAccountingEvidence {
  evidence_hash: string
  risk_result_hash: string
  shared_initial_cash: number
  settlement_asset: string
  ending_settled_cash: number
  ending_available_cash: number
  ending_reserved_isolated_collateral: number
  ending_unrealized_pnl: number
  ending_portfolio_nav: number
  lane_records: ReplacementTerminalAccountingRecord[]
}

interface ReplacementTerminalAccountingManifest {
  manifest_hash: string
  replacement_terminal_evidence_hash: string
}

export function assertReplayPortfolioProtectiveReplacementAccountingChains(input: {
  value: ReplacementAccountingEvidence
  ledger_hash: (entry: ReplacementAccountingLedgerEntry) => string
  journal_hash: (entry: ReplacementAccountingJournalEntry) => string
  fail: (scope: string) => never
}): void {
  const { value, fail } = input
  let settled = value.shared_initial_cash
  for (const [index, entry] of value.ledger.entries()) {
    if (entry.ledger_sequence !== index + 1 || entry.accounting_ordinal < 1
        || index > 0 && entry.accounting_ordinal < value.ledger[index - 1]!.accounting_ordinal
        || entry.ledger_entry_hash !== input.ledger_hash(entry)
        || !Number.isFinite(entry.amount) || !timestamp(entry.event_time)) fail("ledger")
    settled = addReplayDecimalValues(settled, entry.amount)
    if (settled !== entry.settled_cash_after) fail("ledger cash chain")
  }
  if (settled !== value.trial_balance.ending_settled_cash) fail("ledger ending cash")
  if (value.journal[0]?.posting_kind !== "opening_cash"
      || value.journal.filter((entry) => entry.posting_kind === "opening_cash").length !== 1) fail("opening equity")
  for (const [index, entry] of value.journal.entries()) {
    if (entry.journal_sequence !== index + 1 || entry.journal_entry_hash !== input.journal_hash(entry)
        || !timestamp(entry.event_time) || entry.legs.length !== 2) fail("journal")
    const debit = addReplayDecimalValues(...entry.legs.map((leg) => leg.debit))
    const credit = addReplayDecimalValues(...entry.legs.map((leg) => leg.credit))
    if (debit <= 0 || debit !== credit || entry.legs.some((leg) => leg.debit < 0 || leg.credit < 0
      || !Number.isFinite(leg.debit) || !Number.isFinite(leg.credit)
      || (leg.debit > 0) === (leg.credit > 0))) fail("journal balance")
  }
}

export function assertReplayPortfolioProtectiveReplacementAccountingSource(input: {
  value: ReplacementAccountingEvidence
  source: {
    replacement_terminal_evidence: ReplacementTerminalAccountingEvidence
    replacement_terminal_manifest: ReplacementTerminalAccountingManifest
    risk_result: ReplayRuntimeSharedWalletRiskResult
  }
  assert_terminal_evidence: (value: ReplacementTerminalAccountingEvidence) => void
  assert_terminal_manifest: (value: ReplacementTerminalAccountingManifest) => void
  fail: (scope: string) => never
}): void {
  const { value, source, fail } = input
  input.assert_terminal_evidence(source.replacement_terminal_evidence)
  input.assert_terminal_manifest(source.replacement_terminal_manifest)
  const evidence = source.replacement_terminal_evidence
  if (source.risk_result.result_hash !== replayRuntimeSharedWalletRiskResultHash(source.risk_result)
      || value.replacement_terminal_evidence_hash !== evidence.evidence_hash
      || value.replacement_terminal_artifact_manifest_hash !== source.replacement_terminal_manifest.manifest_hash
      || source.replacement_terminal_manifest.replacement_terminal_evidence_hash !== evidence.evidence_hash
      || value.risk_result_hash !== source.risk_result.result_hash || evidence.risk_result_hash !== value.risk_result_hash
      || value.shared_initial_cash !== evidence.shared_initial_cash || value.settlement_asset !== evidence.settlement_asset
      || value.trial_balance.ending_settled_cash !== evidence.ending_settled_cash
      || value.trial_balance.ending_available_cash !== evidence.ending_available_cash
      || value.trial_balance.ending_reserved_isolated_collateral !== evidence.ending_reserved_isolated_collateral
      || value.trial_balance.ending_unrealized_pnl !== evidence.ending_unrealized_pnl
      || value.trial_balance.ending_portfolio_nav !== evidence.ending_portfolio_nav) fail("source/economic binding")
  const recordByHash = new Map(evidence.lane_records.map((record) => [record.record_hash, record]))
  const riskEventByHash = new Map(source.risk_result.global_source_event_queue.map((event) => [event.event_hash, event]))
  for (const entry of value.ledger) {
    const record = recordByHash.get(entry.terminal_record_hash)
    if (!record) {
      fail("ledger record binding")
      continue
    }
    if (entry.lane_id !== record.lane_id || entry.symbol !== record.symbol
        || entry.terminal_owner !== record.owner) fail("ledger record binding")
    const riskEvent = riskEventByHash.get(entry.source_event_hash)
    if (entry.cashflow_kind === "entry_fee") {
      if (!riskEvent || riskEvent.event_role !== "entry" || riskEvent.outcome !== "filled"
          || riskEvent.lane_id !== record.lane_id || entry.amount !== -record.entry_fee) fail("entry fee source")
    } else if (entry.cashflow_kind === "funding") {
      if (!riskEvent || riskEvent.event_role !== "funding" || riskEvent.outcome !== "applied"
          || riskEvent.lane_id !== record.lane_id || entry.amount !== riskEvent.funding_cashflow) fail("funding source")
    } else {
      const expected = entry.cashflow_kind === "realized_pnl" ? record.realized_pnl
        : entry.cashflow_kind === "terminal_trading_fee" ? -record.exit_trading_fee : -record.liquidation_fee
      if (entry.source_event_hash !== record.terminal_source_hash
          || entry.event_time !== record.terminal_time || entry.boundary_phase !== record.terminal_phase
          || entry.amount !== expected) fail("terminal cashflow source")
    }
  }
  for (const record of evidence.lane_records.filter((candidate) => candidate.owner !== "not_opened")) {
    const expectedKinds = [
      ...(record.entry_fee === 0 ? [] : ["entry_fee"]),
      ...source.risk_result.global_source_event_queue.filter((event) =>
        event.event_role === "funding" && event.outcome === "applied" && event.lane_id === record.lane_id
        && (!record.terminal_time || event.event_time < record.terminal_time
          || event.event_time === record.terminal_time
            && event.boundary_phase < (record.terminal_phase ?? 20)) && event.funding_cashflow !== 0)
        .map(() => "funding"),
      ...(record.terminal_time && record.realized_pnl !== 0 ? ["realized_pnl"] : []),
      ...(record.terminal_time && record.exit_trading_fee !== 0 ? ["terminal_trading_fee"] : []),
      ...(record.terminal_time && record.liquidation_fee !== 0 ? ["liquidation_fee"] : []),
    ].sort()
    const actualKinds = value.ledger.filter((entry) => entry.terminal_record_hash === record.record_hash)
      .map((entry) => entry.cashflow_kind).sort()
    if (canonicalHash(expectedKinds) !== canonicalHash(actualKinds)) fail("ledger completeness")
  }
  for (const entry of value.journal) {
    if (!entry.terminal_record_hash) continue
    const record = recordByHash.get(entry.terminal_record_hash)
    if (!record || entry.lane_id !== record.lane_id || entry.terminal_owner !== record.owner) {
      fail("journal record binding")
    }
  }
  const expectedPreempted = evidence.lane_records.flatMap((record) =>
    record.preempted_upstream_terminal_hash ? [record.preempted_upstream_terminal_hash] : []).sort()
  if (canonicalHash(expectedPreempted) !== canonicalHash(value.excluded_preempted_source_hashes)) fail("preemptions")
  const recordByLane = new Map(evidence.lane_records.map((record) => [record.lane_id, record]))
  const expectedPostFunding = source.risk_result.global_source_event_queue.filter((event) => {
    if (event.event_role !== "funding" || event.outcome !== "applied") return false
    const record = recordByLane.get(event.lane_id)
    return Boolean(record?.terminal_time && (event.event_time > record.terminal_time
      || event.event_time === record.terminal_time && event.boundary_phase >= (record.terminal_phase ?? 20)))
  }).map((event) => event.event_hash).sort()
  if (canonicalHash(expectedPostFunding)
      !== canonicalHash(value.excluded_post_terminal_funding_source_hashes)) fail("post-terminal funding")
}

export function assertReplayPortfolioProtectiveReplacementAccountingTrialBalance(input: {
  balance: ReplacementAccountingTrialBalance
  journal: ReplacementAccountingJournalEntry[]
  policy_version: string
  balance_hash: string
  fail: (scope: string) => never
}): void {
  const { balance, journal, fail } = input
  if (balance.accounting_policy_version !== input.policy_version
      || balance.balanced !== true || balance.total_debits !== balance.total_credits
      || addReplayDecimalValues(balance.ending_available_cash, balance.ending_reserved_isolated_collateral)
        !== balance.ending_settled_cash
      || addReplayDecimalValues(balance.ending_settled_cash, balance.ending_unrealized_pnl)
        !== balance.ending_portfolio_nav
      || balance.trial_balance_hash !== input.balance_hash) fail("trial balance")
  const debits = addReplayDecimalValues(...journal.flatMap((entry) => entry.legs.map((leg) => leg.debit)))
  const credits = addReplayDecimalValues(...journal.flatMap((entry) => entry.legs.map((leg) => leg.credit)))
  if (debits !== balance.total_debits || credits !== balance.total_credits) fail("trial balance totals")
}

function timestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.endsWith("Z")
}
