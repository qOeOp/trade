import {
  REPLAY_NUMERIC_POLICY_VERSION,
  REPLAY_JOURNAL_POLICY_VERSION,
  REPLAY_EQUITY_POLICY_VERSION,
  REPLAY_MARGIN_POLICY_VERSION,
  REPLAY_LIQUIDATION_EXECUTION_SCHEMA_VERSION,
  REPLAY_RESULT_SCHEMA_VERSION,
  assertReplayDecisionEvidenceTimeline,
  assertReplayDecisionInputSnapshot,
  assertReplayExecutionRequest,
  canonicalHash,
  createReplayDecisionEvidenceTimeline,
  type ReplayBoundaryPhase,
  type ReplayDatasetManifest,
  type ReplayDecisionEvidenceTimeline,
  type ReplayDecisionInputSnapshot,
  type ReplayExecutionRequest,
  type ReplayEventKey,
  type ReplayFill,
  type ReplayFundingEvent,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplayMarginSnapshot,
  type ReplayOrder,
  type ReplayOrderEvent,
  type ReplayResult,
  type ReplaySourceEvent,
  type ReplaySupplementalFact,
  type ReplayVenueRiskPolicySnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import {
  applyAdverseSlippageV3,
  buildReplayCashLedger,
  calculateFundingCashflowV3,
  calculateNotionalChargeV3,
} from "../../../accounting/src/lib/replay-accounting"
import { buildAverageCostPositionProjection, buildCertifiedSinglePositionProjection } from "../../../accounting/src/lib/replay-position-accounting"
import { buildReplayEquityProjection } from "../../../accounting/src/lib/replay-equity"
import { buildReplayJournal } from "../../../accounting/src/lib/replay-journal"
import { buildReplayMarginSnapshot } from "../../../accounting/src/lib/replay-margin"
import { addReplayDecimalValues, isReplayIncrementAligned, quantizeReplayDifferenceProduct, quantizeReplayQuantity } from "../../../contracts/src/lib/replay-decimal"
import { prepareReplayInputData, resolveReplayVenueRiskPolicyAt } from "../../../data-adapter/src/lib/replay-data-adapter"
import { deriveReplayMetrics } from "../../../metrics/src/lib/replay-metrics"
import {
  submitReplayOrder,
  type ReplayTransitionStamp,
} from "./replay-order-state"
import { createReplayEventKey } from "./replay-event-key"
import { completeReplayEntryOrderLane, type ReplayEntryOrderExecution } from "./replay-entry-order-lane"
import { completeReplayExitOrderLane } from "./replay-exit-order-lane"
import { completeReplayLiquidationOrderLane } from "./replay-liquidation-order-lane"
import { ReplayLiquidationDeficitError, assertReplayPostEntryMargin, buildReplayMaintenanceBreachObservation, buildReplayPathMarginSnapshots } from "./replay-margin-path"
import { reduceReplaySourceEvents } from "./replay-source-reducer"

export const REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION = "trade.rd-replay-engine-checkpoint.v8" as const

export interface ReplayEngineCheckpoint {
  schema_version: typeof REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION
  run_id: string
  request_hash: string
  dataset_hash: string
  decision_evidence_timeline_hash: string
  decision_input_snapshot_hash: string
  decision_harness_receipt_hash: string | null
  decision_harness_bundle_hash: string | null
  decision_harness_build_attestation_hash: string | null
  decision_harness_loader_policy_version: string | null
  decision_harness_worker_protocol_version: string | null
  simulator_policy_version: string
  numeric_policy_version: typeof REPLAY_NUMERIC_POLICY_VERSION
  next_source_offset: number
  source_prefix_hash: string
  source_events: ReplaySourceEvent[]
  applied_funding_sources: ReplaySourceEvent[]
  entry_order: ReplayOrder
  entry_transition: ReplayEntryOrderExecution | null
  order_events: ReplayOrderEvent[]
  event_sequence: number
  exact_risk_snapshots: ReplayMarginSnapshot[]
  limitations: ReplayResult["limitations"]
  last_committed_event_key: ReplayEventKey
  checkpoint_hash: string
}

export interface ReplayExecutionControl {
  resume_checkpoint?: ReplayEngineCheckpoint
  on_checkpoint?: (checkpoint: ReplayEngineCheckpoint) => "continue" | "cancel"
}

export class ReplayExecutionInterruptedError extends Error {
  readonly code = "execution-cancelled-at-checkpoint" as const

  constructor(readonly checkpoint: ReplayEngineCheckpoint) {
    super(`Replay execution was cancelled after source offset ${checkpoint.next_source_offset}`)
    this.name = "ReplayExecutionInterruptedError"
  }
}

export interface ReplayKernelInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
  mark_events?: ReplayMarkEvent[]
  supplemental_facts?: ReplaySupplementalFact[]
  decision_evidence_timeline?: ReplayDecisionEvidenceTimeline
  execution_control?: ReplayExecutionControl
}

export function prepareReplayDecisionInputSnapshot(
  input: Pick<ReplayKernelInput, "request" | "dataset_manifest" | "bars" | "funding_events" | "mark_events" | "supplemental_facts">,
): ReplayDecisionInputSnapshot {
  assertReplayExecutionRequest(input.request)
  return prepareReplayInputData({
    request: input.request,
    dataset_manifest: input.dataset_manifest,
    bars: input.bars,
    funding_events: input.funding_events,
    mark_events: input.mark_events,
    supplemental_facts: input.supplemental_facts,
  }).decision_input_snapshot
}

export function executeReplayKernel(input: ReplayKernelInput): ReplayResult {
  const { request } = input
  assertReplayExecutionRequest(request)
  const prepared = prepareReplayInputData({
    request,
    dataset_manifest: input.dataset_manifest,
    bars: input.bars,
    funding_events: input.funding_events,
    mark_events: input.mark_events,
    supplemental_facts: input.supplemental_facts,
  })
  const decisionEvidenceTimeline = input.decision_evidence_timeline ?? (
    request.supplemental_requirement_set.mode === "none"
      ? createReplayDecisionEvidenceTimeline({ request, decision_input_snapshot: prepared.decision_input_snapshot })
      : undefined
  )
  if (!decisionEvidenceTimeline) {
    throw new Error("Replay supplemental lane requires a Decision Evidence Timeline")
  }
  assertReplayDecisionEvidenceTimeline(decisionEvidenceTimeline, request)
  const decisionEvidenceEntry = decisionEvidenceTimeline.entries[0]!
  const decisionInputSnapshot = decisionEvidenceEntry.decision_input_snapshot
  assertReplayDecisionInputSnapshot(decisionInputSnapshot, request)
  if (canonicalHash(decisionInputSnapshot) !== canonicalHash(prepared.decision_input_snapshot)) {
    throw new Error("Replay decision input snapshot does not match prepared signal-time inputs")
  }
  const decisionHarnessReceipt = decisionEvidenceEntry.decision_harness_receipt
  const decisionHarnessBundle = decisionEvidenceEntry.decision_harness_bundle
  const decisionHarnessBuild = decisionEvidenceEntry.decision_harness_build
  const { bars, funding_events: fundingEvents, mark_events: markEvents, entry_index: entryIndex } = prepared
  const exactMarkCoverage = input.dataset_manifest.mark_coverage === "complete_grid"
  const accountingSpec = input.dataset_manifest.instrument.accounting
  const riskPolicyAt = (timestamp: string): ReplayVenueRiskPolicySnapshot => (
    resolveReplayVenueRiskPolicyAt(input.dataset_manifest, timestamp)
  )
  const marginPolicyFor = (risk: ReplayVenueRiskPolicySnapshot) => ({
    ...request.margin_policy,
    initial_margin_rate: risk.initial_margin_rate,
    maintenance_tier: structuredClone(risk.maintenance_tier),
  })
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
  const resumeCheckpoint = input.execution_control?.resume_checkpoint
  if (resumeCheckpoint) {
    assertReplayEngineCheckpoint(
      resumeCheckpoint, request, input.dataset_manifest,
      decisionEvidenceTimeline.timeline_hash, decisionInputSnapshot.snapshot_hash, decisionHarnessReceipt?.receipt_hash ?? null,
      decisionHarnessBundle?.bundle_hash ?? null, decisionHarnessReceipt?.loader_policy_version ?? null,
      decisionHarnessBuild?.attestation_hash ?? null, decisionHarnessReceipt?.worker_protocol_version ?? null,
    )
  }
  const orderEvents: ReplayOrderEvent[] = structuredClone(resumeCheckpoint?.order_events ?? [])
  let eventSequence = resumeCheckpoint?.event_sequence ?? 0
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
  const entryOrder: ReplayOrder = resumeCheckpoint?.entry_order ?? capture(submitReplayOrder({
    order_id: entryOrderId,
    order_role: "entry",
    order_type: "market",
    side: entrySide,
    quantity: executionQuantity,
    reduce_only: false,
    submitted_at: request.order.signal_time,
  }, nextStamp(request.order.signal_time, 90, 0, 0), 0)).order
  const limitations: ReplayResult["limitations"] = structuredClone(resumeCheckpoint?.limitations ?? prepared.limitations)
  if (!resumeCheckpoint && decisionHarnessReceipt) limitations.push({
    code: "decision-harness-os-sandbox-uncertified",
    severity: "info",
    detail: "The receipt binds the frozen source set, exact Bun build artifact/runtime, and a matching fresh-subprocess reproducibility pair; this process boundary is not an OS sandbox and does not prove filesystem or network denial.",
  })
  if (!resumeCheckpoint && executionQuantity !== request.order.quantity) {
    limitations.push({
      code: "quantity-rounded-down",
      severity: "info",
      detail: `Requested quantity ${request.order.quantity} was rounded down to ${executionQuantity} by Numeric Policy v3.`,
    })
  }

  const entryFillFor = (entryExecution: { entry_order_id: string; entry_fill_event_key: ReplayFill["event_key"]; executed_quantity: number }): ReplayFill => ({
    fill_id: `${request.run_id}:fill:1`,
    order_id: entryExecution.entry_order_id,
    order_role: "entry",
    event_key: entryExecution.entry_fill_event_key,
    timestamp: entryBar.open_time,
    side: entrySide,
    quantity: entryExecution.executed_quantity,
    price: entryPrice,
    fee: calculateNotionalChargeV3(entryPrice, entryExecution.executed_quantity, request.cost_policy.fee_bps, accountingSpec.settlement_increment),
    reduce_only: false,
  })
  const exactRiskSnapshots: ReplayMarginSnapshot[] = structuredClone(resumeCheckpoint?.exact_risk_snapshots ?? [])

  const sourceReduction = reduceReplaySourceEvents({
    request,
    bars,
    funding_events: fundingEvents,
    mark_events: markEvents,
    exact_mark_coverage: exactMarkCoverage,
    entry_index: entryIndex,
    delisted_at: input.dataset_manifest.instrument.delisted_at,
    limitations,
    resume: resumeCheckpoint ? {
      next_source_offset: resumeCheckpoint.next_source_offset,
      source_events: resumeCheckpoint.source_events,
      applied_funding_sources: resumeCheckpoint.applied_funding_sources,
      entry_transition: resumeCheckpoint.entry_transition,
    } : undefined,
    on_source_boundary: (boundary) => {
      if (!input.execution_control?.on_checkpoint) return
      const checkpoint = buildReplayEngineCheckpoint({
        request,
        dataset_manifest: input.dataset_manifest,
        boundary,
        entry_order: boundary.entry_transition?.entry_order ?? entryOrder,
        order_events: orderEvents,
        event_sequence: eventSequence,
        exact_risk_snapshots: exactRiskSnapshots,
        limitations,
        decision_evidence_timeline_hash: decisionEvidenceTimeline.timeline_hash,
        decision_input_snapshot_hash: decisionInputSnapshot.snapshot_hash,
        decision_harness_receipt_hash: decisionHarnessReceipt?.receipt_hash ?? null,
        decision_harness_bundle_hash: decisionHarnessBundle?.bundle_hash ?? null,
        decision_harness_build_attestation_hash: decisionHarnessBuild?.attestation_hash ?? null,
        decision_harness_loader_policy_version: decisionHarnessReceipt?.loader_policy_version ?? null,
        decision_harness_worker_protocol_version: decisionHarnessReceipt?.worker_protocol_version ?? null,
      })
      if (input.execution_control.on_checkpoint(checkpoint) === "cancel") {
        throw new ReplayExecutionInterruptedError(checkpoint)
      }
    },
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
    observe_exact_risk: (source, entry, appliedFundingSources) => {
      const mark = source.kind === "mark"
        ? markEvents[source.source_index]?.mark_price
        : source.kind === "funding"
          ? fundingEvents[source.source_index]?.mark_price
          : undefined
      if (mark === undefined) throw new Error("Replay exact risk source is missing its mark price")
      const preliminaryEntryFill = entryFillFor(entry)
      const preliminaryPosition = buildAverageCostPositionProjection({
        run_id: request.run_id,
        symbol: request.symbol,
        accounting_spec: accountingSpec,
        fills: [preliminaryEntryFill],
      })[0]
      const preliminaryFundingFacts = appliedFundingSources.map((fundingSource) => {
        const event = fundingEvents[fundingSource.source_index]
        if (!event) throw new Error("Replay exact risk evaluation references missing funding")
        return {
          event_key: fundingSource.event_key,
          amount: calculateFundingCashflowV3(
            event.mark_price,
            entry.executed_quantity,
            event.rate,
            request.order.side,
            accountingSpec.settlement_increment,
          ),
          ref: fundingSource.source_event_id,
        }
      })
      const preliminaryLedger = buildReplayCashLedger({
        run_id: `${request.run_id}:risk:${exactRiskSnapshots.length + 1}`,
        initial_cash: request.initial_cash,
        initial_event_key: initialLedgerEventKey,
        ending_event_key: createReplayEventKey({
          event_time: source.event_key.event_time,
          boundary_phase: 100,
          source_sequence: source.event_key.source_sequence,
          event_subphase: 0,
          stable_event_id: `${request.run_id}:risk:${exactRiskSnapshots.length + 1}:checkpoint`,
        }),
        fills: [preliminaryEntryFill],
        positions: [preliminaryPosition],
        funding_facts: preliminaryFundingFacts,
        settlement_increment: accountingSpec.settlement_increment,
      })
      const unrealizedPnl = quantizeReplayDifferenceProduct(
        mark,
        preliminaryPosition.average_entry_price!,
        Math.abs(preliminaryPosition.signed_quantity),
        Math.sign(preliminaryPosition.signed_quantity) as -1 | 1,
        accountingSpec.settlement_increment,
        "floor",
      )
      const snapshot = buildReplayMarginSnapshot({
        run_id: request.run_id,
        stage: "path",
        snapshot_sequence: exactRiskSnapshots.length + 2,
        accounting_spec: accountingSpec,
        margin_policy: marginPolicyFor(riskPolicyAt(source.event_key.event_time)),
        venue_risk_policy_snapshot: riskPolicyAt(source.event_key.event_time),
        position: preliminaryPosition,
        event_key: source.event_key,
        mark_source_ref: source.source_event_id,
        mark_source: source.kind === "mark" ? "mark_event" : "funding_mark",
        resolution: "exact",
        mark_price: mark,
        unrealized_pnl: unrealizedPnl,
        ledger: preliminaryLedger,
      })
      exactRiskSnapshots.push(snapshot)
      if (snapshot.maintenance_margin_sufficient) return null
      return {
        role: "liquidation" as const,
        timestamp: source.event_key.event_time,
        rawPrice: mark,
        triggerSource: source.kind === "mark" ? "mark" as const : "funding_mark" as const,
        triggerSourceRef: source.source_event_id,
        sourceSequence: source.event_key.source_sequence,
      }
    },
    complete_exit: (exit, entry) => exit.role === "liquidation"
      ? completeReplayLiquidationOrderLane({
        run_id: request.run_id,
        event_time: exit.timestamp,
        source_sequence: exit.sourceSequence,
        signed_position: entry.signed_position_after,
        stop_order: entry.stop_order,
        target_order: entry.target_order,
        next_stamp: nextStamp,
        capture,
      })
      : completeReplayExitOrderLane({
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
  const exitRiskPolicy = riskPolicyAt(exit.timestamp)
  const entryFill = entryFillFor(entryExecution)
  const fills: ReplayFill[] = [entryFill]
  const {
    exit_order_id: exitOrderId,
    exit_quantity: exitQuantity,
    signed_position_after: signedPositionAfter,
    exit_fill_event_key: exitFillEventKey,
  } = exitExecution
  let exitFill: ReplayFill | undefined
  if (exitExecution.terminal_state === "flat") {
    if (signedPositionAfter !== 0 || exitOrderId === null || exitFillEventKey === null || exit.role === "end_of_data") {
      throw new Error("certified terminal exit evidence is inconsistent")
    }
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
    const liquidationFee = exit.role === "liquidation"
      ? calculateNotionalChargeV3(
        exitPrice,
        exitQuantity,
        exitRiskPolicy.liquidation_fee_bps,
        accountingSpec.settlement_increment,
      )
      : undefined
    exitFill = {
      fill_id: `${request.run_id}:fill:2`,
      order_id: exitOrderId,
      order_role: exit.role,
      event_key: exitFillEventKey,
      timestamp: exit.timestamp,
      side: exitSide,
      quantity: exitQuantity,
      price: exitPrice,
      fee: exitFee,
      ...(liquidationFee === undefined ? {} : { liquidation_fee: liquidationFee }),
      reduce_only: true,
    }
    fills.push(exitFill)
  } else if (signedPositionAfter === 0 || exitOrderId !== null || exitFillEventKey !== null || exit.role !== "end_of_data") {
    throw new Error("certified open terminal evidence is inconsistent")
  }

  const positions = exitFill
    ? buildCertifiedSinglePositionProjection({
      run_id: request.run_id,
      symbol: request.symbol,
      accounting_spec: accountingSpec,
      fills: [entryFill, exitFill],
    })
    : buildAverageCostPositionProjection({
      run_id: request.run_id,
      symbol: request.symbol,
      accounting_spec: accountingSpec,
      fills: [entryFill],
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
    stable_event_id: `${request.run_id}:ledger:ending-cash`,
  })
  const ledger = buildReplayCashLedger({
    run_id: request.run_id,
    initial_cash: request.initial_cash,
    initial_event_key: initialLedgerEventKey,
    ending_event_key: endingLedgerEventKey,
    fills,
    positions,
    funding_facts: appliedFundingSources.map((source, index) => ({
      event_key: source.event_key,
      amount: fundingAmounts[index],
      ref: source.source_event_id,
    })),
    settlement_increment: accountingSpec.settlement_increment,
  })
  if (exit.role === "liquidation") {
    const attributedSettledCashflow = ledger
      .filter((entry) => entry.kind === "fee" || entry.kind === "liquidation_fee" || entry.kind === "funding" || entry.kind === "realized_pnl")
      .reduce((total, entry) => addReplayDecimalValues(total, entry.amount), 0)
    const remainingCollateral = addReplayDecimalValues(request.margin_policy.isolated_collateral, attributedSettledCashflow)
    if (remainingCollateral < 0) {
      throw new ReplayLiquidationDeficitError(exactRiskSnapshots.at(-1)!, remainingCollateral)
    }
    limitations.push({
      code: "simulated-liquidation-execution",
      severity: "resolution_limited",
      detail: "Maintenance was triggered by an exact risk observation; the full-close Fill uses frozen adverse slippage from the trigger mark and is simulated execution evidence, not an exchange trade reconstruction.",
    })
  }
  const terminalPosition = positions.at(-1)!
  const markSource = exitFill ? "fill_price" as const : exactMarkCoverage ? "mark_event" as const : "bar_close" as const
  const markSourceRef = exitFill
    ? exitFill.fill_id
    : [...sourceEvents].reverse().find((source) => source.kind === (exactMarkCoverage ? "mark" : "bar_range")
      && source.event_key.event_time === exit.timestamp)?.source_event_id
  if (!markSourceRef) throw new Error("Replay terminal mark source is missing")
  const { valuation_snapshot: valuationSnapshot, equity_bridge: equityBridge } = buildReplayEquityProjection({
    run_id: request.run_id,
    accounting_spec: accountingSpec,
    terminal_position: terminalPosition,
    mark_event_key: endingLedgerEventKey,
    mark_source_ref: markSourceRef,
    mark_source: markSource,
    mark_price: exitFill?.price ?? exit.rawPrice,
    ledger,
  })
  const postEntryMargin = buildReplayMarginSnapshot({
    run_id: request.run_id,
    stage: "post_entry",
    snapshot_sequence: 1,
    accounting_spec: accountingSpec,
    margin_policy: marginPolicyFor(riskPolicyAt(entryFill.timestamp)),
    venue_risk_policy_snapshot: riskPolicyAt(entryFill.timestamp),
    position: positions[0],
    event_key: entryFill.event_key,
    mark_source_ref: entryFill.fill_id,
    mark_source: "fill_price",
    resolution: "exact",
    mark_price: entryFill.price,
    unrealized_pnl: 0,
    ledger,
  })
  assertReplayPostEntryMargin(postEntryMargin)
  const pathMarginSnapshots = exit.role === "liquidation"
    ? exactRiskSnapshots
    : buildReplayPathMarginSnapshots({
      request,
      dataset_manifest: input.dataset_manifest,
      accounting_spec: accountingSpec,
      entry_position: positions[0],
      source_events: sourceEvents,
      bars,
      funding_events: fundingEvents,
      mark_events: markEvents,
      exact_mark_coverage: exactMarkCoverage,
      ledger,
      first_sequence: 2,
    })
  const terminalMarginBase = buildReplayMarginSnapshot({
    run_id: request.run_id,
    stage: "terminal",
    snapshot_sequence: pathMarginSnapshots.length + 2,
    accounting_spec: accountingSpec,
    margin_policy: marginPolicyFor(exitRiskPolicy),
    venue_risk_policy_snapshot: exitRiskPolicy,
    position: terminalPosition,
    event_key: endingLedgerEventKey,
    mark_source_ref: markSourceRef,
    mark_source: markSource,
    resolution: terminalPosition.state === "flat" ? "not_applicable_flat" : "exact",
    mark_price: valuationSnapshot.mark_price,
    unrealized_pnl: valuationSnapshot.unrealized_pnl,
    ledger,
  })
  const terminalMargin = exit.role === "liquidation"
    ? { ...terminalMarginBase, liquidation_evaluated: true }
    : terminalMarginBase
  const marginSnapshots = [postEntryMargin, ...pathMarginSnapshots, terminalMargin]
  if (pathMarginSnapshots.some((snapshot) => snapshot.resolution === "ohlcv_adverse_extreme")) {
    limitations.push({
      code: "ohlcv-margin-path-adverse-extreme",
      severity: "resolution_limited",
      detail: "OHLCV cannot prove intrabar mark order; Margin Policy v6 checks the position-side adverse bar extreme before strategy-order resolution but cannot execute liquidation from it.",
    })
  }
  const { journal, trial_balance: trialBalance } = buildReplayJournal({
    run_id: request.run_id,
    settlement_asset: input.dataset_manifest.instrument.accounting.settlement_asset,
    settlement_increment: accountingSpec.settlement_increment,
    ledger,
    valuation_snapshot: valuationSnapshot,
    equity_bridge: equityBridge,
    margin_snapshots: marginSnapshots,
  })
  const metrics = deriveReplayMetrics({ initial_cash: request.initial_cash, fills, ledger, equity_bridge: equityBridge, margin_snapshots: marginSnapshots })
  const liquidation = exit.role === "liquidation" && exitFill
    ? {
      schema_version: REPLAY_LIQUIDATION_EXECUTION_SCHEMA_VERSION,
      liquidation_id: `${request.run_id}:liquidation:1`,
      simulator_policy_version: request.simulator_policy.version,
      margin_policy_version: request.margin_policy.version,
      venue_risk_policy_snapshot_id: exitRiskPolicy.snapshot_id,
      venue_risk_policy_snapshot_hash: canonicalHash(exitRiskPolicy),
      cost_policy_id: request.cost_policy.policy_id,
      cost_policy_version: request.cost_policy.version,
      trigger_observation: buildReplayMaintenanceBreachObservation(pathMarginSnapshots.at(-1)!, "simulated_full_close"),
      execution_model: "trigger_mark_adverse_slippage_full_close" as const,
      evidence_grade: "simulated_from_exact_risk_observation" as const,
      strategy_order_action: "cancel_before_forced_order" as const,
      liquidation_order_id: exitFill.order_id,
      liquidation_fill_id: exitFill.fill_id,
      quantity: exitFill.quantity,
      trigger_mark_price: exit.rawPrice,
      slippage_bps: request.cost_policy.slippage_bps,
      execution_price: exitFill.price,
      trading_fee: exitFill.fee,
      liquidation_fee_bps: exitRiskPolicy.liquidation_fee_bps,
      liquidation_fee: exitFill.liquidation_fee!,
      settlement_state: "flat_without_deficit" as const,
    }
    : null
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
    valuation_snapshot: valuationSnapshot,
    equity_bridge: equityBridge,
    margin_snapshots: marginSnapshots,
    liquidation,
    journal,
    trial_balance: trialBalance,
    supplemental_evidence: prepared.supplemental_evidence,
    decision_evidence_timeline: decisionEvidenceTimeline,
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
      trial_reservation_hash: request.trial_reservation_hash,
      dataset_manifest_hash: prepared.dataset_manifest_hash,
      dataset_hash: request.dataset_hash,
      supplemental_facts_hash: request.supplemental_facts_hash,
      supplemental_requirement_set_hash: request.supplemental_requirement_set_hash,
      decision_evidence_timeline_hash: decisionEvidenceTimeline.timeline_hash,
      decision_input_snapshot_hash: decisionInputSnapshot.snapshot_hash,
      decision_harness_receipt_hash: decisionHarnessReceipt?.receipt_hash ?? null,
      decision_harness_bundle_hash: decisionHarnessBundle?.bundle_hash ?? null,
      decision_harness_build_attestation_hash: decisionHarnessBuild?.attestation_hash ?? null,
      decision_harness_build_artifact_hash: decisionHarnessBuild?.artifact.sha256 ?? null,
      decision_harness_runtime_executable_hash: decisionHarnessBuild?.runtime.executable_sha256 ?? null,
      decision_harness_registry_policy_version: decisionHarnessReceipt?.registry_policy_version ?? null,
      decision_harness_loader_policy_version: decisionHarnessReceipt?.loader_policy_version ?? null,
      decision_harness_worker_protocol_version: decisionHarnessReceipt?.worker_protocol_version ?? null,
      venue_risk_policy_schedule_hash: request.venue_risk_policy_schedule_hash,
      instrument_spec_schedule_hash: request.instrument_spec_schedule_hash,
      harness_hash: request.harness_hash,
      assumptions_hash: request.assumptions_hash,
      cost_policy_hash: canonicalHash(request.cost_policy),
      simulator_policy_version: request.simulator_policy.version,
      numeric_policy_version: REPLAY_NUMERIC_POLICY_VERSION,
      journal_policy_version: REPLAY_JOURNAL_POLICY_VERSION,
      equity_policy_version: REPLAY_EQUITY_POLICY_VERSION,
      margin_policy_version: REPLAY_MARGIN_POLICY_VERSION,
      margin_policy_hash: canonicalHash(request.margin_policy),
      request_hash: canonicalHash(request),
      result_hash: resultHash,
      random_seed: request.random_seed,
    },
  }
}

function buildReplayEngineCheckpoint(input: {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  boundary: {
    next_source_offset: number
    source_events: ReplaySourceEvent[]
    applied_funding_sources: ReplaySourceEvent[]
    entry_transition: ReplayEntryOrderExecution | null
  }
  entry_order: ReplayOrder
  order_events: ReplayOrderEvent[]
  event_sequence: number
  exact_risk_snapshots: ReplayMarginSnapshot[]
  limitations: ReplayResult["limitations"]
  decision_evidence_timeline_hash: string
  decision_input_snapshot_hash: string
  decision_harness_receipt_hash: string | null
  decision_harness_bundle_hash: string | null
  decision_harness_build_attestation_hash: string | null
  decision_harness_loader_policy_version: string | null
  decision_harness_worker_protocol_version: string | null
}): ReplayEngineCheckpoint {
  const lastCommittedEventKey = input.boundary.source_events.at(-1)?.event_key
  if (!lastCommittedEventKey) throw new Error("Replay checkpoint requires a committed source event")
  const body = {
    schema_version: REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION,
    run_id: input.request.run_id,
    request_hash: canonicalHash(input.request),
    dataset_hash: input.dataset_manifest.data_hash,
    decision_evidence_timeline_hash: input.decision_evidence_timeline_hash,
    decision_input_snapshot_hash: input.decision_input_snapshot_hash,
    decision_harness_receipt_hash: input.decision_harness_receipt_hash,
    decision_harness_bundle_hash: input.decision_harness_bundle_hash,
    decision_harness_build_attestation_hash: input.decision_harness_build_attestation_hash,
    decision_harness_loader_policy_version: input.decision_harness_loader_policy_version,
    decision_harness_worker_protocol_version: input.decision_harness_worker_protocol_version,
    simulator_policy_version: input.request.simulator_policy.version,
    numeric_policy_version: REPLAY_NUMERIC_POLICY_VERSION,
    next_source_offset: input.boundary.next_source_offset,
    source_prefix_hash: canonicalHash(input.boundary.source_events),
    source_events: structuredClone(input.boundary.source_events),
    applied_funding_sources: structuredClone(input.boundary.applied_funding_sources),
    entry_order: structuredClone(input.entry_order),
    entry_transition: structuredClone(input.boundary.entry_transition),
    order_events: structuredClone(input.order_events),
    event_sequence: input.event_sequence,
    exact_risk_snapshots: structuredClone(input.exact_risk_snapshots),
    limitations: structuredClone(input.limitations),
    last_committed_event_key: structuredClone(lastCommittedEventKey),
  }
  return { ...body, checkpoint_hash: canonicalHash(body) }
}

export function assertReplayEngineCheckpoint(
  checkpoint: ReplayEngineCheckpoint,
  request: ReplayExecutionRequest,
  datasetManifest: ReplayDatasetManifest,
  decisionEvidenceTimelineHash?: string,
  decisionInputSnapshotHash?: string,
  decisionHarnessReceiptHash?: string | null,
  decisionHarnessBundleHash?: string | null,
  decisionHarnessLoaderPolicyVersion?: string | null,
  decisionHarnessBuildAttestationHash?: string | null,
  decisionHarnessWorkerProtocolVersion?: string | null,
): void {
  if (checkpoint.schema_version !== REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION) throw new Error("unsupported Replay engine checkpoint schema")
  if (checkpoint.run_id !== request.run_id
      || checkpoint.request_hash !== canonicalHash(request)
      || checkpoint.dataset_hash !== datasetManifest.data_hash
      || (decisionEvidenceTimelineHash !== undefined
        && checkpoint.decision_evidence_timeline_hash !== decisionEvidenceTimelineHash)
      || (decisionInputSnapshotHash !== undefined && checkpoint.decision_input_snapshot_hash !== decisionInputSnapshotHash)
      || (decisionHarnessReceiptHash !== undefined && checkpoint.decision_harness_receipt_hash !== decisionHarnessReceiptHash)
      || (decisionHarnessBundleHash !== undefined && checkpoint.decision_harness_bundle_hash !== decisionHarnessBundleHash)
      || (decisionHarnessLoaderPolicyVersion !== undefined
        && checkpoint.decision_harness_loader_policy_version !== decisionHarnessLoaderPolicyVersion)
      || (decisionHarnessBuildAttestationHash !== undefined
        && checkpoint.decision_harness_build_attestation_hash !== decisionHarnessBuildAttestationHash)
      || (decisionHarnessWorkerProtocolVersion !== undefined
        && checkpoint.decision_harness_worker_protocol_version !== decisionHarnessWorkerProtocolVersion)
      || checkpoint.simulator_policy_version !== request.simulator_policy.version
      || checkpoint.numeric_policy_version !== REPLAY_NUMERIC_POLICY_VERSION) {
    throw new Error("Replay engine checkpoint authority binding does not match execution input")
  }
  if (!/^[a-f0-9]{64}$/.test(checkpoint.decision_evidence_timeline_hash)
      || !/^[a-f0-9]{64}$/.test(checkpoint.decision_input_snapshot_hash)
      || (checkpoint.decision_harness_receipt_hash !== null
        && !/^[a-f0-9]{64}$/.test(checkpoint.decision_harness_receipt_hash))
      || (checkpoint.decision_harness_bundle_hash !== null
        && !/^[a-f0-9]{64}$/.test(checkpoint.decision_harness_bundle_hash))
      || (checkpoint.decision_harness_build_attestation_hash !== null
        && !/^[a-f0-9]{64}$/.test(checkpoint.decision_harness_build_attestation_hash))) {
    throw new Error("Replay engine checkpoint decision evidence hash is invalid")
  }
  if (!Number.isSafeInteger(checkpoint.next_source_offset) || checkpoint.next_source_offset <= 0
      || checkpoint.next_source_offset !== checkpoint.source_events.length) {
    throw new Error("Replay engine checkpoint source offset is invalid")
  }
  if (checkpoint.source_prefix_hash !== canonicalHash(checkpoint.source_events)) {
    throw new Error("Replay engine checkpoint source prefix hash is invalid")
  }
  if (canonicalHash(checkpoint.source_events.at(-1)?.event_key) !== canonicalHash(checkpoint.last_committed_event_key)) {
    throw new Error("Replay engine checkpoint last committed event key is invalid")
  }
  const { checkpoint_hash: checkpointHash, ...body } = checkpoint
  if (checkpointHash !== canonicalHash(body)) throw new Error("Replay engine checkpoint hash is invalid")
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
