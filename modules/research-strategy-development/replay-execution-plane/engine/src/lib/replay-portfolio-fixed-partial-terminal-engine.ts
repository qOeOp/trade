import {
  REPLAY_PORTFOLIO_FIXED_PARTIAL_COLLATERAL_POLICY_VERSION,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_LIMITATIONS,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION,
  assertReplayPortfolioFixedPartialTerminalEvidence,
  replayPortfolioFixedPartialCashflowHash,
  replayPortfolioFixedPartialTerminalEvidenceHash,
  replayPortfolioFixedPartialTerminalRecordHash,
  type ReplayPortfolioFixedPartialCashflowEvent,
  type ReplayPortfolioFixedPartialTerminalEvidence,
  type ReplayPortfolioFixedPartialTerminalOwner,
  type ReplayPortfolioFixedPartialTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-terminal-contracts"
import type { ReplayPortfolioAllocationResult } from
  "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
  ReplayPortfolioProtectiveTerminalRecord,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  canonicalHash,
  compareReplayEventKeys,
  type ReplayArtifactManifest,
  type ReplayPartialReduceIntent,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDifferenceProduct,
  quantizeReplayProduct,
} from "../../../contracts/src/lib/replay-decimal"
import { applyAdverseSlippageV3, calculateNotionalChargeV3 } from
  "../../../accounting/src/lib/replay-accounting"

export interface ReplayPortfolioFixedPartialTerminalLane {
  lane_id: string
  priority_rank: number
  request_hash: string
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  partial_intent: ReplayPartialReduceIntent | null
  partial_intent_hash: string | null
  replay: { result: ReplayResult; artifact_manifest: ReplayArtifactManifest } | null
}
export interface ReplayPortfolioFixedPartialTerminalEngineInput {
  source_evidence: ReplayPortfolioProtectiveTerminalEvidence
  source_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  allocation_result: ReplayPortfolioAllocationResult
  risk_result: ReplayRuntimeSharedWalletRiskResult
  lanes: ReplayPortfolioFixedPartialTerminalLane[]
}

export function executeReplayPortfolioFixedPartialTerminal(
  input: ReplayPortfolioFixedPartialTerminalEngineInput,
): ReplayPortfolioFixedPartialTerminalEvidence {
  validateInput(input)
  const sourceByLane = new Map(input.source_evidence.lane_records.map((record) => [record.lane_id, record]))
  const decisions = input.allocation_result.allocation_cycles.flatMap((cycle) => cycle.decisions)
  const decisionByLane = new Map(decisions.map((decision) => [decision.lane_id, decision]))
  const records = input.lanes.map((lane) => {
    const source = sourceByLane.get(lane.lane_id)!
    const decision = decisionByLane.get(lane.lane_id)!
    if (decision.allocation === "rejected") return notOpened(source, decision, lane)
    return fromReplay(source, decision, lane)
  }).sort((a, b) => a.lane_id.localeCompare(b.lane_id))
  const laneResultHashes = records.flatMap((record) => record.lane_result_hash ? [record.lane_result_hash] : [])
  const economics = economicSummary(records, input.source_evidence.shared_initial_cash)
  const risk = riskSummary(records)
  const ownerCounts = Object.fromEntries([
    "not_opened", "initial_protective_stop", "initial_take_profit", "generation_two_protective_stop",
    "generation_two_take_profit", "exact_liquidation", "strategy_exit", "open_at_data_end",
  ].map((owner) => [owner, records.filter((record) => record.owner === owner).length])) as
    Record<ReplayPortfolioFixedPartialTerminalOwner, number>
  const sourceHash = canonicalHash({ evidence: input.source_evidence.evidence_hash,
    manifest: input.source_manifest.manifest_hash, risk: input.risk_result.result_hash })
  const laneRecordsHash = canonicalHash(records)
  const fingerprintBody = { source_hash: sourceHash, lane_records_hash: laneRecordsHash,
    lane_result_hashes_hash: canonicalHash(laneResultHashes), economic_summary_hash: canonicalHash(economics),
    risk_summary_hash: canonicalHash(risk),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_LIMITATIONS) }
  const fingerprint = { ...fingerprintBody, fingerprint_hash: canonicalHash(fingerprintBody) }
  const body: Omit<ReplayPortfolioFixedPartialTerminalEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_POLICY_VERSION,
    collateral_policy_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_COLLATERAL_POLICY_VERSION,
    experiment_id: input.source_evidence.experiment_id, trial_group_id: input.source_evidence.trial_group_id,
    trial_group_hash: input.source_evidence.trial_group_hash, portfolio_id: input.source_evidence.portfolio_id,
    settlement_asset: input.source_evidence.settlement_asset,
    shared_initial_cash: input.source_evidence.shared_initial_cash,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash,
    source_protective_terminal_artifact_manifest_hash: input.source_manifest.manifest_hash,
    risk_result_hash: input.risk_result.result_hash, lane_records: records, lane_records_hash: laneRecordsHash,
    lane_result_hashes: laneResultHashes, ...economics, ...risk, terminal_owner_counts: ownerCounts,
    limitations: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_LIMITATIONS, fingerprint,
  }
  const evidence = { ...body, evidence_hash: replayPortfolioFixedPartialTerminalEvidenceHash(body) }
  assertReplayPortfolioFixedPartialTerminalEvidence(evidence)
  return evidence
}

function fromReplay(source: ReplayPortfolioProtectiveTerminalRecord,
  decision: AllocationDecision, lane: ReplayPortfolioFixedPartialTerminalLane) {
  if (!lane.replay) throw new Error(`Fixed-partial Lane ${lane.lane_id} admitted without certified Replay Result`)
  const { result, artifact_manifest: manifest } = lane.replay
  const entry = result.fills.find((fill) => fill.order_role === "entry")
  const partial = result.fills.find((fill) => fill.order_role === "strategy_partial_reduce")
  const terminal = result.fills.find((fill) => ["stop", "target", "strategy_exit", "liquidation"].includes(fill.order_role))
  const entryPosition = entry && result.positions.find((position) => position.cause_fill_id === entry.fill_id)
  const partialPosition = partial && result.positions.find((position) => position.cause_fill_id === partial.fill_id)
  const terminalPosition = terminal && result.positions.find((position) => position.cause_fill_id === terminal.fill_id)
  if (!entry || !entryPosition || entry.quantity !== decision.quantity || entry.price !== decision.execution_price
      || entry.fee !== decision.entry_fee
      || manifest.result_hash !== result.fingerprint.result_hash
      || result.fingerprint.request_hash !== lane.request_hash) {
    throw new Error(`Fixed-partial Lane ${lane.lane_id} Allocation/Replay entry closure drift`)
  }
  if (lane.partial_intent && partial && (partial.quantity !== lane.partial_intent.quantity
      || partial.quantity >= entry.quantity || !partialPosition || partialPosition.state !== "open"
      || Math.abs(partialPosition.signed_quantity) !== addReplayDecimalValues(entry.quantity, -partial.quantity))) {
    throw new Error(`Fixed-partial Lane ${lane.lane_id} partial Fill/Position drift`)
  }
  if (!lane.partial_intent && partial || partial && !lane.partial_intent) {
    throw new Error(`Fixed-partial Lane ${lane.lane_id} undeclared partial Fill`)
  }
  const endingOpen = result.equity_bridge.terminal_position_state === "open"
  const endingQuantity = endingOpen ? Math.abs(result.valuation_snapshot.signed_quantity) : 0
  if (endingOpen && result.valuation_snapshot.mark_source !== "mark_event") {
    throw new Error(`Fixed-partial Lane ${lane.lane_id} open terminal lacks exact Mark`)
  }
  const partialFilled = Boolean(partial)
  const owner = terminalOwner(terminal?.order_role, partialFilled, endingOpen)
  const cashflows = cashflowEvents(result)
  const realized = result.positions.reduce((sum, position) => addReplayDecimalValues(sum,
    position.realized_pnl_delta), 0)
  const tradingFees = result.fills.reduce((sum, fill) => addReplayDecimalValues(sum, fill.fee), 0)
  const liquidationFee = result.fills.reduce((sum, fill) => addReplayDecimalValues(sum,
    fill.liquidation_fee ?? 0), 0)
  const funding = result.ledger.filter((entry) => entry.kind === "funding")
    .reduce((sum, entry) => addReplayDecimalValues(sum, entry.amount), 0)
  const admissionRisk = stopRisk(source.entry_price, source.stop_price, source.quantity,
    source.side, source.entry_fee, lane, true)
  const currentRisk = endingOpen ? stopRisk(source.entry_price, source.stop_price, endingQuantity,
    source.side, 0, lane, false) : 0
  const body: Omit<ReplayPortfolioFixedPartialTerminalRecord, "record_hash"> = {
    lane_id: lane.lane_id, symbol: source.symbol, priority_rank: lane.priority_rank,
    request_hash: lane.request_hash, allocation_decision_hash: decision.decision_hash,
    source_protective_terminal_record_hash: source.record_hash, lane_result_hash: manifest.result_hash,
    lane_artifact_manifest_hash: canonicalHash(manifest), entry_fill_hash: canonicalHash(entry), side: source.side,
    entry_time: entry.timestamp,
    entry_price: entry.price, initial_quantity: entry.quantity, isolated_collateral: decision.isolated_collateral,
    entry_fee: entry.fee, stop_price: source.stop_price, target_price: source.target_price,
    partial_status: partial ? (endingOpen ? "filled_open_at_data_end" : "filled_then_terminal")
      : lane.partial_intent ? "terminal_before_partial" : "not_configured",
    partial_intent_hash: lane.partial_intent_hash, partial_fill_hash: partial ? canonicalHash(partial) : null,
    partial_time: partial?.timestamp ?? null, partial_quantity: partial?.quantity ?? 0,
    partial_price: partial?.price ?? null, partial_realized_pnl: partialPosition?.realized_pnl_delta ?? 0,
    partial_trading_fee: partial?.fee ?? 0,
    generation_two_quantity: partialPosition ? Math.abs(partialPosition.signed_quantity) : null,
    owner, terminal_time: terminal?.timestamp ?? null,
    terminal_phase: terminal ? (terminal.order_role === "liquidation" ? 15 : 20) : null,
    terminal_source_hash: terminal ? canonicalHash(terminal) : null, realized_pnl_total: realized,
    trading_fee_total: tradingFees, liquidation_fee: liquidationFee, funding_cashflow_total: funding,
    cashflow_events: cashflows, released_collateral: endingOpen ? 0 : decision.isolated_collateral,
    ending_open: endingOpen, ending_quantity: endingQuantity,
    ending_mark_price: endingOpen ? result.valuation_snapshot.mark_price : null,
    ending_mark_time: endingOpen ? result.valuation_snapshot.timestamp : null,
    ending_mark_notional: endingOpen ? quantizeReplayProduct(
      [result.valuation_snapshot.mark_price, endingQuantity], 1, lane.settlement_increment, "ceil") : 0,
    ending_unrealized_pnl: endingOpen ? result.valuation_snapshot.unrealized_pnl : 0,
    admission_frozen_stop_risk_amount: admissionRisk, current_active_stop_risk_amount: currentRisk,
    reserved_admission_risk_amount: endingOpen ? admissionRisk : 0,
    risk_budget_release_amount: endingOpen ? 0 : admissionRisk,
  }
  if (terminal && !terminalPosition) throw new Error(`Fixed-partial Lane ${lane.lane_id} terminal Position missing`)
  return { ...body, record_hash: replayPortfolioFixedPartialTerminalRecordHash(body) }
}

function notOpened(source: ReplayPortfolioProtectiveTerminalRecord,
  decision: AllocationDecision, lane: ReplayPortfolioFixedPartialTerminalLane) {
  if (lane.replay) throw new Error(`Fixed-partial Lane ${lane.lane_id} rejected but Replay Result was supplied`)
  const body: Omit<ReplayPortfolioFixedPartialTerminalRecord, "record_hash"> = {
    lane_id: lane.lane_id, symbol: source.symbol, priority_rank: lane.priority_rank,
    request_hash: lane.request_hash, allocation_decision_hash: decision.decision_hash,
    source_protective_terminal_record_hash: source.record_hash, lane_result_hash: null,
    lane_artifact_manifest_hash: null, entry_fill_hash: null, entry_time: null, side: source.side,
    entry_price: decision.execution_price, initial_quantity: decision.quantity, isolated_collateral: 0,
    entry_fee: 0, stop_price: source.stop_price, target_price: source.target_price,
    partial_status: "not_opened", partial_intent_hash: lane.partial_intent_hash, partial_fill_hash: null,
    partial_time: null, partial_quantity: 0, partial_price: null, partial_realized_pnl: 0,
    partial_trading_fee: 0, generation_two_quantity: null, owner: "not_opened", terminal_time: null,
    terminal_phase: null, terminal_source_hash: null, realized_pnl_total: 0, trading_fee_total: 0,
    liquidation_fee: 0, funding_cashflow_total: 0, cashflow_events: [], released_collateral: 0,
    ending_open: false, ending_quantity: 0, ending_mark_price: null, ending_mark_time: null,
    ending_mark_notional: 0,
    ending_unrealized_pnl: 0, admission_frozen_stop_risk_amount: 0,
    current_active_stop_risk_amount: 0, reserved_admission_risk_amount: 0, risk_budget_release_amount: 0,
  }
  return { ...body, record_hash: replayPortfolioFixedPartialTerminalRecordHash(body) }
}

function cashflowEvents(result: ReplayResult): ReplayPortfolioFixedPartialCashflowEvent[] {
  return result.ledger.filter((entry) => ["fee", "funding", "realized_pnl", "liquidation_fee"].includes(entry.kind))
    .map((entry) => {
      const kind: ReplayPortfolioFixedPartialCashflowEvent["kind"] = entry.kind === "fee"
        ? (entry.ref.includes(":fill:entry") ? "entry_fee" : "trading_fee")
        : entry.kind as "funding" | "realized_pnl" | "liquidation_fee"
      const body = { event_key: structuredClone(entry.event_key), source_ref: entry.ref, kind, amount: entry.amount }
      return { ...body, cashflow_hash: replayPortfolioFixedPartialCashflowHash(body) }
    }).sort((a, b) => compareReplayEventKeys(a.event_key, b.event_key) || a.source_ref.localeCompare(b.source_ref))
}
function terminalOwner(role: string | undefined, partial: boolean, open: boolean): ReplayPortfolioFixedPartialTerminalOwner {
  if (open) return "open_at_data_end"
  if (role === "stop") return partial ? "generation_two_protective_stop" : "initial_protective_stop"
  if (role === "target") return partial ? "generation_two_take_profit" : "initial_take_profit"
  if (role === "liquidation") return "exact_liquidation"
  if (role === "strategy_exit") return "strategy_exit"
  throw new Error("Fixed-partial flat Position lacks terminal owner")
}
function stopRisk(entry: number, stop: number, quantity: number, side: "long" | "short", entryFee: number,
  lane: ReplayPortfolioFixedPartialTerminalLane, includeEntryFee: boolean): number {
  const execution = applyAdverseSlippageV3(stop, side === "long" ? "sell" : "buy",
    lane.slippage_bps, lane.price_increment)
  const loss = quantizeReplayDifferenceProduct(entry, execution, quantity, side === "long" ? 1 : -1,
    lane.settlement_increment, "ceil")
  return addReplayDecimalValues(loss, includeEntryFee ? entryFee : 0,
    calculateNotionalChargeV3(execution, quantity, lane.fee_bps, lane.settlement_increment))
}
function economicSummary(records: ReplayPortfolioFixedPartialTerminalRecord[], initial: number) {
  const settled = addReplayDecimalValues(initial, ...records.flatMap((record) => record.cashflow_events.map((event) => event.amount)))
  const reserved = addReplayDecimalValues(...records.map((record) => record.ending_open ? record.isolated_collateral : 0))
  const unrealized = addReplayDecimalValues(...records.map((record) => record.ending_unrealized_pnl))
  return { ending_settled_cash: settled, ending_reserved_isolated_collateral: reserved,
    ending_available_cash: addReplayDecimalValues(settled, -reserved), ending_unrealized_pnl: unrealized,
    ending_portfolio_nav: addReplayDecimalValues(settled, unrealized),
    ending_gross_mark_exposure: addReplayDecimalValues(...records.map((record) => record.ending_mark_notional)),
    ending_net_mark_exposure: addReplayDecimalValues(...records.map((record) => record.side === "long"
      ? record.ending_mark_notional : -record.ending_mark_notional)) }
}
function riskSummary(records: ReplayPortfolioFixedPartialTerminalRecord[]) {
  return { historical_admission_frozen_stop_risk: addReplayDecimalValues(...records.map((r) => r.admission_frozen_stop_risk_amount)),
    ending_portfolio_frozen_stop_risk: addReplayDecimalValues(...records.map((r) => r.reserved_admission_risk_amount)),
    ending_portfolio_active_stop_bounded_risk: addReplayDecimalValues(...records.map((r) => r.current_active_stop_risk_amount)),
    total_risk_budget_released: addReplayDecimalValues(...records.map((r) => r.risk_budget_release_amount)) }
}
function validateInput(input: ReplayPortfolioFixedPartialTerminalEngineInput): void {
  if (input.source_manifest.protective_terminal_evidence_hash !== input.source_evidence.evidence_hash
      || input.source_evidence.risk_result_hash !== input.risk_result.result_hash
      || input.allocation_result.result_hash !== input.source_evidence.allocation_result_hash
      || input.lanes.length !== input.source_evidence.lane_records.length
      || input.lanes.length !== input.allocation_result.allocation_cycles
        .reduce((count, cycle) => count + cycle.decisions.length, 0)) throw new Error("Fixed-partial source closure drift")
  const ids = input.lanes.map((lane) => lane.lane_id)
  if (new Set(ids).size !== ids.length) throw new Error("Fixed-partial duplicate Lane")
  for (const lane of input.lanes) {
    if (lane.partial_intent_hash !== (lane.partial_intent ? canonicalHash(lane.partial_intent) : null)) {
      throw new Error(`Fixed-partial Lane ${lane.lane_id} intent hash drift`)
    }
  }
}
type AllocationDecision = ReplayPortfolioAllocationResult["allocation_cycles"][number]["decisions"][number]
