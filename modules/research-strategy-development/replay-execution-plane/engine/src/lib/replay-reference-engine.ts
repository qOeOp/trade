import {
  REPLAY_NUMERIC_POLICY_VERSION,
  REPLAY_JOURNAL_POLICY_VERSION,
  REPLAY_RESULT_SCHEMA_VERSION,
  assertReplayExecutionRequest,
  canonicalHash,
  type ReplayBoundaryPhase,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFill,
  type ReplayFundingEvent,
  type ReplayMarketBar,
  type ReplayOrder,
  type ReplayOrderEvent,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  applyAdverseSlippageV3,
  buildSinglePositionLedger,
  calculateFundingCashflowV3,
  calculateNotionalChargeV3,
} from "../../../accounting/src/lib/replay-accounting"
import { buildCertifiedSinglePositionProjection } from "../../../accounting/src/lib/replay-position-accounting"
import { buildReplayJournal } from "../../../accounting/src/lib/replay-journal"
import { isReplayIncrementAligned, quantizeReplayQuantity } from "../../../contracts/src/lib/replay-decimal"
import { prepareReplayInputData } from "../../../data-adapter/src/lib/replay-data-adapter"
import { deriveReplayMetrics } from "../../../metrics/src/lib/replay-metrics"
import {
  submitReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"
import { createReplayEventKey } from "./replay-event-key"
import { completeReplayEntryOrderLane } from "./replay-entry-order-lane"
import { completeReplayExitOrderLane } from "./replay-exit-order-lane"
import { reduceReplaySourceEvents } from "./replay-source-reducer"

export interface ReplayKernelInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
}

export function executeReplayKernel(input: ReplayKernelInput): ReplayResult {
  const { request } = input
  assertReplayExecutionRequest(request)
  const prepared = prepareReplayInputData({
    request,
    dataset_manifest: input.dataset_manifest,
    bars: input.bars,
    funding_events: input.funding_events,
  })
  const { bars, funding_events: fundingEvents, entry_index: entryIndex } = prepared
  const accountingSpec = input.dataset_manifest.instrument.accounting
  assertInstrumentAlignedInputs(request, bars, accountingSpec.price_increment, accountingSpec.settlement_increment)
  const executionQuantity = quantizeReplayQuantity(request.order.quantity, accountingSpec.quantity_increment)

  const entryBar = bars[entryIndex]
  const entrySide = request.order.side === "long" ? "buy" : "sell"
  const exitSide = request.order.side === "long" ? "sell" : "buy"
  const entryPrice = applyAdverseSlippageV3(
    entryBar.open,
    entrySide,
    request.cost_policy.slippage_bps,
    accountingSpec.price_increment,
  )
  const orderEvents: ReplayOrderEvent[] = []
  let eventSequence = 0
  const nextSequence = (): number => {
    eventSequence += 1
    return eventSequence
  }
  const nextStamp = (
    eventTime: string,
    boundaryPhase: ReplayBoundaryPhase,
    sourceSequence: number,
    eventSubphase: number,
  ): ReplayTransitionStamp => {
    const sequence = nextSequence()
    return {
      sequence,
      event_key: createReplayEventKey({
        event_time: eventTime,
        boundary_phase: boundaryPhase,
        source_sequence: sourceSequence,
        event_subphase: eventSubphase,
        stable_event_id: `${request.run_id}:event:${sequence}`,
      }),
    }
  }
  const capture = <T extends { event: ReplayOrderEvent }>(transition: T): T => {
    orderEvents.push(transition.event)
    return transition
  }

  const entrySourceSequence = entryIndex + 1
  const initialLedgerEventKey = createReplayEventKey({
    event_time: request.order.signal_time,
    boundary_phase: 70,
    source_sequence: 0,
    event_subphase: 0,
    stable_event_id: `${request.run_id}:ledger:initial-cash`,
  })
  const entryOrderId = `${request.run_id}:order:entry`
  const entryOrder: ReplayOrder = capture(submitReplayOrder({
    order_id: entryOrderId,
    order_role: "entry",
    order_type: "market",
    side: entrySide,
    quantity: executionQuantity,
    reduce_only: false,
    submitted_at: request.order.signal_time,
  }, nextStamp(request.order.signal_time, 90, 0, 0), 0)).order
  const limitations: ReplayResult["limitations"] = [...prepared.limitations]
  if (executionQuantity !== request.order.quantity) {
    limitations.push({
      code: "quantity-rounded-down",
      severity: "info",
      detail: `Requested quantity ${request.order.quantity} was rounded down to ${executionQuantity} by Numeric Policy v3.`,
    })
  }

  const sourceReduction = reduceReplaySourceEvents({
    request,
    bars,
    funding_events: fundingEvents,
    entry_index: entryIndex,
    delisted_at: input.dataset_manifest.instrument.delisted_at,
    limitations,
    activate_entry: () => completeReplayEntryOrderLane({
      run_id: request.run_id,
      entry_time: entryBar.open_time,
      entry_source_sequence: entrySourceSequence,
      entry_order: entryOrder,
      exit_side: exitSide,
      stop_price: request.order.stop_price,
      target_price: request.order.target_price,
      next_stamp: nextStamp,
      capture,
    }),
    get_entry_fill_event_key: (entry) => entry.entry_fill_event_key,
    complete_exit: (exit, entry) => completeReplayExitOrderLane({
      run_id: request.run_id,
      exit,
      entry_time: entryBar.open_time,
      entry_source_sequence: entrySourceSequence,
      signed_position: entry.signed_position_after,
      stop_order: entry.stop_order,
      target_order: entry.target_order,
      next_stamp: nextStamp,
      capture,
    }),
  })
  const { exit, entry_transition: entryExecution, terminal_transition: exitExecution } = sourceReduction
  const entryFee = calculateNotionalChargeV3(
    entryPrice,
    entryExecution.executed_quantity,
    request.cost_policy.fee_bps,
    accountingSpec.settlement_increment,
  )
  const entryFill: ReplayFill = {
    fill_id: `${request.run_id}:fill:1`,
    order_id: entryExecution.entry_order_id,
    order_role: "entry",
    event_key: entryExecution.entry_fill_event_key,
    timestamp: entryBar.open_time,
    side: entrySide,
    quantity: entryExecution.executed_quantity,
    price: entryPrice,
    fee: entryFee,
    reduce_only: false,
  }
  const fills: ReplayFill[] = [entryFill]
  const {
    exit_order_id: exitOrderId,
    exit_quantity: exitQuantity,
    signed_position_after: signedPositionAfter,
    exit_fill_event_key: exitFillEventKey,
  } = exitExecution
  if (signedPositionAfter !== 0) throw new Error("certified single-position Replay must close the evidence position")
  const exitPrice = applyAdverseSlippageV3(
    exit.rawPrice,
    exitSide,
    request.cost_policy.slippage_bps,
    accountingSpec.price_increment,
  )
  const exitFee = calculateNotionalChargeV3(
    exitPrice,
    exitQuantity,
    request.cost_policy.fee_bps,
    accountingSpec.settlement_increment,
  )
  const exitFill: ReplayFill = {
    fill_id: `${request.run_id}:fill:2`,
    order_id: exitOrderId,
    order_role: exit.role,
    event_key: exitFillEventKey,
    timestamp: exit.timestamp,
    side: exitSide,
    quantity: exitQuantity,
    price: exitPrice,
    fee: exitFee,
    reduce_only: true,
  }
  fills.push(exitFill)

  const positions = buildCertifiedSinglePositionProjection({
    run_id: request.run_id,
    symbol: request.symbol,
    accounting_spec: accountingSpec,
    fills: [entryFill, exitFill],
  })
  const sourceEvents = sourceReduction.source_events
  const appliedFundingSources = sourceReduction.applied_funding_sources
  const appliedFunding = appliedFundingSources.map((source) => fundingEvents[source.source_index])
  const fundingAmounts = appliedFunding.map((event) => calculateFundingCashflowV3(
    event.mark_price,
    entryExecution.executed_quantity,
    event.rate,
    request.order.side,
    accountingSpec.settlement_increment,
  ))
  const endingLedgerEventKey = createReplayEventKey({
    event_time: exit.timestamp,
    boundary_phase: 100,
    source_sequence: exit.sourceSequence,
    event_subphase: 0,
    stable_event_id: `${request.run_id}:ledger:ending-equity`,
  })
  const ledger = buildSinglePositionLedger({
    run_id: request.run_id,
    initial_cash: request.initial_cash,
    initial_event_key: initialLedgerEventKey,
    ending_event_key: endingLedgerEventKey,
    fills: [entryFill, exitFill],
    positions,
    funding_events: appliedFunding,
    funding_cashflows: fundingAmounts,
    funding_refs: appliedFundingSources.map((source) => source.source_event_id),
    funding_event_keys: appliedFundingSources.map((source) => source.event_key),
    settlement_increment: accountingSpec.settlement_increment,
  })
  const { journal, trial_balance: trialBalance } = buildReplayJournal({
    run_id: request.run_id,
    settlement_asset: input.dataset_manifest.instrument.accounting.settlement_asset,
    settlement_increment: accountingSpec.settlement_increment,
    ledger,
  })
  const metrics = deriveReplayMetrics({ initial_cash: request.initial_cash, fills, ledger })
  const resultBody = {
    schema_version: REPLAY_RESULT_SCHEMA_VERSION,
    run_id: request.run_id,
    status: "completed" as const,
    started_at: request.order.signal_time,
    completed_at: exit.timestamp,
    source_events: sourceEvents,
    order_events: orderEvents,
    fills,
    positions,
    ledger,
    journal,
    trial_balance: trialBalance,
    metrics,
    limitations,
  }
  const resultHash = canonicalHash(resultBody)
  return {
    ...resultBody,
    fingerprint: {
      experiment_contract_hash: request.experiment_contract_hash,
      trial_group_hash: request.trial_group_hash,
      candidate_hash: request.candidate_hash,
      identity_hash_policy_version: request.identity_hash_policy_version,
      dataset_manifest_hash: prepared.dataset_manifest_hash,
      dataset_hash: request.dataset_hash,
      harness_hash: request.harness_hash,
      assumptions_hash: request.assumptions_hash,
      cost_policy_hash: canonicalHash(request.cost_policy),
      simulator_policy_version: request.simulator_policy.version,
      numeric_policy_version: REPLAY_NUMERIC_POLICY_VERSION,
      journal_policy_version: REPLAY_JOURNAL_POLICY_VERSION,
      request_hash: canonicalHash(request),
      result_hash: resultHash,
      random_seed: request.random_seed,
    },
  }
}

function assertInstrumentAlignedInputs(
  request: ReplayExecutionRequest,
  bars: ReplayMarketBar[],
  priceIncrement: string,
  settlementIncrement: string,
): void {
  if (!isReplayIncrementAligned(request.initial_cash, settlementIncrement)) {
    throw new Error("Replay initial_cash must align to settlement increment")
  }
  for (const [field, value] of Object.entries({
    stop_price: request.order.stop_price,
    target_price: request.order.target_price,
  })) {
    if (!isReplayIncrementAligned(value, priceIncrement)) throw new Error(`Replay ${field} must align to price increment`)
  }
  for (const [index, bar] of bars.entries()) {
    for (const [field, value] of Object.entries({ open: bar.open, high: bar.high, low: bar.low, close: bar.close })) {
      if (!isReplayIncrementAligned(value, priceIncrement)) {
        throw new Error(`Replay bars[${index}].${field} must align to price increment`)
      }
    }
  }
}
