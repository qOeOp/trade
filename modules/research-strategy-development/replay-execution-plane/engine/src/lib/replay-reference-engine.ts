import {
  REPLAY_NUMERIC_POLICY_VERSION,
  REPLAY_JOURNAL_POLICY_VERSION,
  REPLAY_EQUITY_POLICY_VERSION,
  REPLAY_MARGIN_POLICY_VERSION,
  REPLAY_LIQUIDATION_EXECUTION_SCHEMA_VERSION,
  REPLAY_RESULT_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDecisionEvidenceTimeline,
  assertReplayDecisionInputSnapshot,
  assertReplayExecutionRequest,
  canonicalHash,
  compareReplayEventKeys,
  createReplayDecisionEvidenceTimeline,
  createReplayDecisionStateSnapshot,
  replayDecisionPhaseFor,
  replayAuthorizedInitialDecisionEvidenceEntry,
  type ReplayBoundaryPhase,
  type ReplayDatasetManifest,
  type ReplayDecisionEvidenceTimeline,
  type ReplayDecisionEvidenceInput,
  type ReplayDecisionHarnessBuildAttestation,
  type ReplayDecisionHarnessReceipt,
  type ReplayDecisionHarnessSourceBundle,
  type ReplayDecisionInputSnapshot,
  type ReplayDecisionMarketInputSnapshot,
  type ReplayDecisionScheduleEntry,
  type ReplayDecisionStateSnapshot,
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
import { buildAverageCostPositionProjection } from "../../../accounting/src/lib/replay-position-accounting"
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
import { completeReplayExitOrderLane, completeReplayStrategyExitOrderLane } from "./replay-exit-order-lane"
import { completeReplayLiquidationOrderLane } from "./replay-liquidation-order-lane"
import { replaceReplayProtectiveStop } from "./replay-protective-stop-lane"
import { completeReplayPartialReduceLane } from "./replay-partial-reduce-lane"
import { ReplayLiquidationDeficitError, assertReplayPostEntryMargin, buildReplayMaintenanceBreachObservation, buildReplayPathMarginSnapshots } from "./replay-margin-path"
import { reduceReplaySourceEvents } from "./replay-source-reducer"

export const REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION = "trade.rd-replay-engine-checkpoint.v15" as const

export interface ReplayEngineCheckpoint {
  schema_version: typeof REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION
  run_id: string
  request_hash: string
  dataset_hash: string
  decision_evidence_timeline_hash: string
  decision_evidence_timeline: ReplayDecisionEvidenceTimeline
  decision_boundary_hash: string
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
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
  partial_reduce_order: ReplayOrder | null
  partial_reduce_fills: ReplayFill[]
  strategy_exit_order: ReplayOrder | null
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
  runtime_decision_evaluator?: (input: {
    schedule_entry: ReplayDecisionScheduleEntry
    decision_input_snapshot: ReplayDecisionInputSnapshot
    decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
    decision_state_snapshot: ReplayDecisionStateSnapshot
  }) => {
    source_bundle: ReplayDecisionHarnessSourceBundle | null
    build_attestation: ReplayDecisionHarnessBuildAttestation | null
    receipt: ReplayDecisionHarnessReceipt | null
  }
  execution_control?: ReplayExecutionControl
}

export function prepareReplayDecisionEvidenceInputs(
  input: Pick<ReplayKernelInput, "request" | "dataset_manifest" | "bars" | "funding_events" | "mark_events" | "supplemental_facts">,
): {
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decisions: Array<{
    schedule_entry: ReplayDecisionScheduleEntry
    decision_input_snapshot: ReplayDecisionInputSnapshot
    decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  }>
} {
  assertReplayExecutionRequest(input.request)
  const prepared = prepareReplayInputData({
    request: input.request,
    dataset_manifest: input.dataset_manifest,
    bars: input.bars,
    funding_events: input.funding_events,
    mark_events: input.mark_events,
    supplemental_facts: input.supplemental_facts,
  })
  return {
    decision_input_snapshot: prepared.decision_input_snapshot,
    decision_market_input_snapshot: prepared.decision_market_input_snapshot,
    decisions: prepared.decision_evidence_inputs,
  }
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
  const resumeCheckpoint = input.execution_control?.resume_checkpoint
  const initialDecisionEvidenceTimeline = resumeCheckpoint?.decision_evidence_timeline ?? input.decision_evidence_timeline ?? (
    request.supplemental_requirement_set.mode === "none"
      ? createReplayDecisionEvidenceTimeline({
        request,
        decisions: prepared.decision_evidence_inputs,
      })
      : undefined
  )
  if (!initialDecisionEvidenceTimeline) {
    throw new Error("Replay supplemental lane requires a Decision Evidence Timeline")
  }
  let decisionEvidenceTimeline: ReplayDecisionEvidenceTimeline = initialDecisionEvidenceTimeline
  assertReplayDecisionEvidenceTimeline(decisionEvidenceTimeline, request, { allow_pending_runtime: true })
  if (!resumeCheckpoint && decisionEvidenceTimeline.entries.some((entry) => entry.decision_state_snapshot !== null)) {
    throw new Error("Replay position-open decision evidence must be produced by the runtime source boundary")
  }
  for (const [index, decisionEvidence] of decisionEvidenceTimeline.entries.entries()) {
    const preparedDecision = prepared.decision_evidence_inputs[index]
    if (!preparedDecision
        || canonicalHash(decisionEvidence.decision_input_snapshot) !== canonicalHash(preparedDecision.decision_input_snapshot)
        || canonicalHash(decisionEvidence.decision_market_input_snapshot) !== canonicalHash(preparedDecision.decision_market_input_snapshot)) {
      throw new Error("Replay scheduled decision evidence does not match prepared point-in-time inputs")
    }
  }
  let decisionEvidenceEntry = replayAuthorizedInitialDecisionEvidenceEntry(decisionEvidenceTimeline)
  const decisionInputSnapshot = decisionEvidenceEntry.decision_input_snapshot
  assertReplayDecisionInputSnapshot(decisionInputSnapshot, request)
  if (canonicalHash(decisionInputSnapshot) !== canonicalHash(prepared.decision_input_snapshot)) {
    throw new Error("Replay decision input snapshot does not match prepared signal-time inputs")
  }
  const decisionMarketInputSnapshot = decisionEvidenceEntry.decision_market_input_snapshot
  if (canonicalHash(decisionMarketInputSnapshot) !== canonicalHash(prepared.decision_market_input_snapshot)) {
    throw new Error("Replay decision market input snapshot does not match prepared closed-bar inputs")
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
  assertInstrumentAlignedInputs(
    request, bars, accountingSpec.price_increment, accountingSpec.quantity_increment, accountingSpec.settlement_increment,
  )
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
  if (resumeCheckpoint) {
    assertReplayEngineCheckpoint(
      resumeCheckpoint, request, input.dataset_manifest,
      undefined, decisionEvidenceEntry.decision_boundary.boundary_hash,
      decisionInputSnapshot.snapshot_hash, decisionMarketInputSnapshot.snapshot_hash,
      decisionHarnessReceipt?.receipt_hash ?? null,
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
  if (!resumeCheckpoint && request.decision_market_input_requirement.mode === "none") limitations.push({
    code: "decision-market-input-recomputation-uncertified",
    severity: "info",
    detail: "The Decision Boundary binds the frozen signal time, closed-candle declaration, and next-open delay, but this lane does not materialize or recompute a market-input snapshot; the authorized Order remains Control Plane-frozen evidence.",
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
  let partialReduceOrder: ReplayOrder | null = structuredClone(resumeCheckpoint?.partial_reduce_order ?? null)
  const partialReduceFills: ReplayFill[] = structuredClone(resumeCheckpoint?.partial_reduce_fills ?? [])
  let strategyExitOrder: ReplayOrder | null = structuredClone(resumeCheckpoint?.strategy_exit_order ?? null)
  const evidenceFills = (entry: ReplayEntryOrderExecution): ReplayFill[] => [entryFillFor(entry), ...partialReduceFills]
  const positionAt = (entry: ReplayEntryOrderExecution, eventKey: ReplayEventKey) => {
    const projections = buildAverageCostPositionProjection({
      run_id: request.run_id,
      symbol: request.symbol,
      accounting_spec: accountingSpec,
      fills: evidenceFills(entry),
    })
    const position = [...projections].reverse().find(
      (candidate) => compareReplayEventKeys(candidate.event_key, eventKey) <= 0,
    )
    if (!position || position.state !== "open") throw new Error("Replay source requires an open evidence Position")
    return position
  }
  let timelineInputs: ReplayDecisionEvidenceInput[] = decisionEvidenceTimeline.entries.map((entry, index) => ({
    schedule_entry: structuredClone(request.decision_schedule.entries[index]!),
    decision_input_snapshot: structuredClone(entry.decision_input_snapshot),
    decision_market_input_snapshot: structuredClone(entry.decision_market_input_snapshot),
    evaluation_status: entry.evaluation_status,
    decision_state_snapshot: structuredClone(entry.decision_state_snapshot),
    decision_harness_bundle: structuredClone(entry.decision_harness_bundle),
    decision_harness_build: structuredClone(entry.decision_harness_build),
    decision_harness_receipt: structuredClone(entry.decision_harness_receipt),
    terminal_event_key: structuredClone(entry.terminal_event_key),
  }))
  const rebuildDecisionTimeline = (): void => {
    decisionEvidenceTimeline = createReplayDecisionEvidenceTimeline({ request, decisions: timelineInputs })
    decisionEvidenceEntry = replayAuthorizedInitialDecisionEvidenceEntry(decisionEvidenceTimeline)
  }
  const buildRuntimeStateSnapshot = (boundary: {
    source_events: ReplaySourceEvent[]
    applied_funding_sources: ReplaySourceEvent[]
    entry_transition: ReplayEntryOrderExecution | null
  }, scheduleEntry: ReplayDecisionScheduleEntry): ReplayDecisionStateSnapshot => {
    const source = boundary.source_events.at(-1)
    const entry = boundary.entry_transition
    if (!source || source.kind !== "bar_range" || !entry || source.event_key.event_time !== scheduleEntry.decision_time) {
      throw new Error("Replay runtime decision requires an open-position closed-bar boundary")
    }
    const bar = bars[source.source_index]
    if (!bar) throw new Error("Replay runtime decision references a missing bar")
    const fills = evidenceFills(entry)
    const positions = buildAverageCostPositionProjection({
      run_id: request.run_id,
      symbol: request.symbol,
      accounting_spec: accountingSpec,
      fills,
    })
    const position = positions.at(-1)!
    const fundingFacts = boundary.applied_funding_sources.map((fundingSource) => {
      const event = fundingEvents[fundingSource.source_index]
      if (!event) throw new Error("Replay runtime decision references missing funding")
      return {
        event_key: fundingSource.event_key,
        amount: calculateFundingCashflowV3(
          event.mark_price, Math.abs(positionAt(entry, fundingSource.event_key).signed_quantity), event.rate, request.order.side,
          accountingSpec.settlement_increment,
        ),
        ref: fundingSource.source_event_id,
      }
    })
    const ledger = buildReplayCashLedger({
      run_id: `${request.run_id}:decision:${scheduleEntry.decision_sequence}`,
      initial_cash: request.initial_cash,
      initial_event_key: initialLedgerEventKey,
      ending_event_key: createReplayEventKey({
        event_time: scheduleEntry.decision_time,
        boundary_phase: 100,
        source_sequence: source.event_key.source_sequence,
        event_subphase: scheduleEntry.decision_sequence,
        stable_event_id: `${request.run_id}:decision:${scheduleEntry.decision_sequence}:state`,
      }),
      fills,
      positions,
      funding_facts: fundingFacts,
      settlement_increment: accountingSpec.settlement_increment,
    })
    const cashBalance = ledger.at(-1)!.balance_after
    const totalFees = ledger.filter((entry) => entry.kind === "fee")
      .reduce((total, entry) => addReplayDecimalValues(total, -entry.amount), 0)
    const totalFunding = ledger.filter((entry) => entry.kind === "funding")
      .reduce((total, entry) => addReplayDecimalValues(total, entry.amount), 0)
    const unrealizedPnl = quantizeReplayDifferenceProduct(
      bar.close, position.average_entry_price!, Math.abs(position.signed_quantity),
      Math.sign(position.signed_quantity) as -1 | 1, accountingSpec.settlement_increment, "floor",
    )
    return createReplayDecisionStateSnapshot({
      schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
      run_id: request.run_id,
      decision_sequence: scheduleEntry.decision_sequence,
      decision_time: scheduleEntry.decision_time,
      observation_event_key: structuredClone(source.event_key),
      source_prefix_hash: canonicalHash(boundary.source_events),
      position: {
        state: "open",
        side: position.side!,
        signed_quantity: position.signed_quantity,
        average_entry_price: position.average_entry_price!,
      },
      active_protection: {
        stop: {
          order_id: entry.stop_order.order_id,
          status: "active",
          trigger_price: entry.stop_order.trigger_price!,
          remaining_quantity: entry.stop_order.remaining_quantity,
        },
        target: {
          order_id: entry.target_order.order_id,
          status: "active",
          trigger_price: entry.target_order.trigger_price!,
          remaining_quantity: entry.target_order.remaining_quantity,
        },
      },
      mark_price: bar.close,
      cash_balance: cashBalance,
      total_fees: totalFees,
      total_funding: totalFunding,
      unrealized_pnl: unrealizedPnl,
      equity: addReplayDecimalValues(cashBalance, unrealizedPnl),
    })
  }

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
      const source = boundary.source_events.at(-1)
      const runtimeDecisionIndex = source?.kind === "bar_range"
        ? timelineInputs.findIndex((decision) => decision.evaluation_status === "pending_runtime"
          && decision.schedule_entry.decision_time === source.event_key.event_time)
        : -1
      if (runtimeDecisionIndex >= 0) {
        const runtimeDecision = timelineInputs[runtimeDecisionIndex]!
        if (replayDecisionPhaseFor(request, runtimeDecision.schedule_entry) !== "position_open"
            || !input.runtime_decision_evaluator) {
          throw new Error("Replay position-open schedule requires a runtime decision evaluator")
        }
        const decisionStateSnapshot = buildRuntimeStateSnapshot(boundary, runtimeDecision.schedule_entry)
        const admission = input.runtime_decision_evaluator({
          schedule_entry: runtimeDecision.schedule_entry,
          decision_input_snapshot: runtimeDecision.decision_input_snapshot,
          decision_market_input_snapshot: runtimeDecision.decision_market_input_snapshot,
          decision_state_snapshot: decisionStateSnapshot,
        })
        timelineInputs[runtimeDecisionIndex] = {
          ...runtimeDecision,
          evaluation_status: "evaluated",
          decision_state_snapshot: decisionStateSnapshot,
          decision_harness_bundle: admission.source_bundle,
          decision_harness_build: admission.build_attestation,
          decision_harness_receipt: admission.receipt,
        }
        rebuildDecisionTimeline()
        if (runtimeDecision.schedule_entry.expected_effect === "authorized_protective_stop_replace") {
          const replaceIntent = runtimeDecision.schedule_entry.authorized_protective_stop_replace
          const entry = boundary.entry_transition
          if (!replaceIntent || !entry || entry.stop_order.trigger_price !== replaceIntent.previous_stop_price) {
            throw new Error("Replay protective stop replacement does not match the active stop")
          }
          const wouldAlreadyTrigger = request.order.side === "long"
            ? replaceIntent.new_stop_price >= decisionStateSnapshot.mark_price
            : replaceIntent.new_stop_price <= decisionStateSnapshot.mark_price
          if (wouldAlreadyTrigger) throw new Error("Replay protective stop replacement is already triggered at decision time")
          entry.stop_order = replaceReplayProtectiveStop({
            run_id: request.run_id,
            decision_sequence: runtimeDecision.schedule_entry.decision_sequence,
            decision_time: replaceIntent.signal_time,
            source_sequence: source!.event_key.source_sequence,
            signed_position: entry.signed_position_after,
            side: replaceIntent.side,
            new_stop_price: replaceIntent.new_stop_price,
            current_stop_order: entry.stop_order,
            next_stamp: nextStamp,
            capture,
          })
        }
        if (runtimeDecision.schedule_entry.expected_effect === "authorized_partial_reduce") {
          const partialIntent = runtimeDecision.schedule_entry.authorized_partial_reduce
          const entry = boundary.entry_transition
          if (!partialIntent || !entry || partialReduceOrder) {
            throw new Error("Replay authorized partial reduce cannot create a unique pending Order")
          }
          partialReduceOrder = capture(submitReplayOrder({
            order_id: `${request.run_id}:order:partial-reduce`,
            order_role: "strategy_partial_reduce",
            order_type: "market",
            side: partialIntent.side,
            quantity: partialIntent.quantity,
            reduce_only: true,
            submitted_at: partialIntent.signal_time,
          }, nextStamp(
            partialIntent.signal_time,
            90,
            source!.event_key.source_sequence,
            runtimeDecision.schedule_entry.decision_sequence,
          ), entry.signed_position_after)).order
        }
        if (runtimeDecision.schedule_entry.expected_effect === "authorized_reduce_only_exit") {
          const exitIntent = runtimeDecision.schedule_entry.authorized_reduce_only_exit
          const entry = boundary.entry_transition
          if (!exitIntent || !entry || strategyExitOrder) {
            throw new Error("Replay authorized strategy exit cannot create a unique pending Order")
          }
          strategyExitOrder = capture(submitReplayOrder({
            order_id: `${request.run_id}:order:strategy-exit`,
            order_role: "strategy_exit",
            order_type: "market",
            side: exitIntent.side,
            quantity: Math.abs(entry.signed_position_after),
            reduce_only: true,
            submitted_at: exitIntent.signal_time,
          }, nextStamp(
            exitIntent.signal_time,
            90,
            source!.event_key.source_sequence,
            runtimeDecision.schedule_entry.decision_sequence,
          ), entry.signed_position_after)).order
        }
      }
      if (!input.execution_control?.on_checkpoint) return
      const checkpoint = buildReplayEngineCheckpoint({
        request,
        dataset_manifest: input.dataset_manifest,
        boundary,
        entry_order: boundary.entry_transition?.entry_order ?? entryOrder,
        partial_reduce_order: partialReduceOrder,
        partial_reduce_fills: partialReduceFills,
        strategy_exit_order: strategyExitOrder,
        order_events: orderEvents,
        event_sequence: eventSequence,
        exact_risk_snapshots: exactRiskSnapshots,
        limitations,
        decision_evidence_timeline: decisionEvidenceTimeline,
        decision_boundary_hash: decisionEvidenceEntry.decision_boundary.boundary_hash,
        decision_input_snapshot_hash: decisionInputSnapshot.snapshot_hash,
        decision_market_input_snapshot_hash: decisionMarketInputSnapshot.snapshot_hash,
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
    get_active_stop_price: (entry) => {
      if (entry.stop_order.status !== "active" || entry.stop_order.trigger_price === null) {
        throw new Error("Replay source boundary requires one active protective stop")
      }
      return entry.stop_order.trigger_price
    },
    get_active_target_price: (entry) => {
      if (entry.target_order.status !== "active" || entry.target_order.trigger_price === null) {
        throw new Error("Replay source boundary requires one active take-profit target")
      }
      return entry.target_order.trigger_price
    },
    observe_exact_risk: (source, entry, appliedFundingSources) => {
      const mark = source.kind === "mark"
        ? markEvents[source.source_index]?.mark_price
        : source.kind === "funding"
          ? fundingEvents[source.source_index]?.mark_price
          : undefined
      if (mark === undefined) throw new Error("Replay exact risk source is missing its mark price")
      const preliminaryFills = evidenceFills(entry)
      const preliminaryPositions = buildAverageCostPositionProjection({
        run_id: request.run_id,
        symbol: request.symbol,
        accounting_spec: accountingSpec,
        fills: preliminaryFills,
      })
      const preliminaryPosition = preliminaryPositions.at(-1)!
      const preliminaryFundingFacts = appliedFundingSources.map((fundingSource) => {
        const event = fundingEvents[fundingSource.source_index]
        if (!event) throw new Error("Replay exact risk evaluation references missing funding")
        return {
          event_key: fundingSource.event_key,
          amount: calculateFundingCashflowV3(
            event.mark_price,
            Math.abs(positionAt(entry, fundingSource.event_key).signed_quantity),
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
        fills: preliminaryFills,
        positions: preliminaryPositions,
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
    apply_partial_reduce: (source, entry) => {
      if (!partialReduceOrder || partialReduceOrder.status === "filled" || source.kind !== "bar_open") return
      const scheduleEntry = request.decision_schedule.entries.find(
        (candidate) => candidate.expected_effect === "authorized_partial_reduce",
      )
      const intent = scheduleEntry?.authorized_partial_reduce
      if (!intent || !scheduleEntry) throw new Error("Replay pending partial reduce lacks frozen schedule authority")
      const sourceTime = Date.parse(source.event_key.event_time)
      const executableTime = Date.parse(intent.earliest_executable_time)
      if (sourceTime < executableTime) return
      if (sourceTime > executableTime) throw new Error("Replay skipped the authorized partial-reduce executable boundary")
      const executableBar = bars[source.source_index]
      if (!executableBar) throw new Error("Replay partial reduce references a missing executable bar")
      const execution = completeReplayPartialReduceLane({
        run_id: request.run_id,
        decision_sequence: scheduleEntry.decision_sequence,
        event_time: executableBar.open_time,
        source_sequence: source.source_index + 1,
        signed_position: entry.signed_position_after,
        partial_order: partialReduceOrder,
        stop_order: entry.stop_order,
        target_order: entry.target_order,
        exit_side: exitSide,
        next_stamp: nextStamp,
        capture,
      })
      partialReduceOrder = execution.partial_order
      entry.signed_position_after = execution.signed_position_after
      entry.stop_order = execution.stop_order
      entry.target_order = execution.target_order
      const price = applyAdverseSlippageV3(
        executableBar.open,
        exitSide,
        request.cost_policy.slippage_bps,
        accountingSpec.price_increment,
      )
      partialReduceFills.push({
        fill_id: `${request.run_id}:fill:${partialReduceFills.length + 2}`,
        order_id: execution.partial_order_id,
        order_role: "strategy_partial_reduce",
        event_key: execution.partial_fill_event_key,
        timestamp: executableBar.open_time,
        side: exitSide,
        quantity: execution.executed_quantity,
        price,
        fee: calculateNotionalChargeV3(
          price,
          execution.executed_quantity,
          request.cost_policy.fee_bps,
          accountingSpec.settlement_increment,
        ),
        reduce_only: true,
      })
    },
    observe_strategy_exit: (source) => {
      if (!strategyExitOrder || source.kind !== "bar_open") return null
      const scheduleEntry = request.decision_schedule.entries.find(
        (entry) => entry.expected_effect === "authorized_reduce_only_exit",
      )
      const intent = scheduleEntry?.authorized_reduce_only_exit
      if (!intent) throw new Error("Replay pending strategy exit lacks frozen schedule authority")
      const sourceTime = Date.parse(source.event_key.event_time)
      const executableTime = Date.parse(intent.earliest_executable_time)
      if (sourceTime < executableTime) return null
      if (sourceTime > executableTime) throw new Error("Replay skipped the authorized strategy exit executable boundary")
      const bar = bars[source.source_index]
      if (!bar) throw new Error("Replay strategy exit references a missing executable bar")
      return {
        role: "strategy_exit" as const,
        timestamp: bar.open_time,
        rawPrice: bar.open,
        triggerSource: "bar_open" as const,
        sourceSequence: source.source_index + 1,
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
        partial_reduce_order: partialReduceOrder,
        strategy_exit_order: strategyExitOrder,
        next_stamp: nextStamp,
        capture,
      })
      : exit.role === "strategy_exit"
        ? completeReplayStrategyExitOrderLane({
          run_id: request.run_id,
          event_time: exit.timestamp,
          source_sequence: exit.sourceSequence,
          signed_position: entry.signed_position_after,
          strategy_exit_order: strategyExitOrder!,
          partial_reduce_order: partialReduceOrder,
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
        partial_reduce_order: partialReduceOrder,
        strategy_exit_order: strategyExitOrder,
        next_stamp: nextStamp,
        capture,
      }),
  })
  const { exit, entry_transition: entryExecution, terminal_transition: exitExecution } = sourceReduction
  const terminalSourceEvent = sourceReduction.source_events.at(-1)
  if (!terminalSourceEvent) throw new Error("Replay terminal reduction requires a source event")
  let finalizedTerminalDecision = false
  timelineInputs = timelineInputs.map((decision) => {
    if (decision.evaluation_status !== "pending_runtime") return decision
    if (Date.parse(decision.schedule_entry.decision_time) < Date.parse(terminalSourceEvent.event_key.event_time)) {
      throw new Error("Replay runtime decision boundary was skipped before terminal execution")
    }
    finalizedTerminalDecision = true
    return {
      ...decision,
      evaluation_status: "not_reached_terminal",
      decision_state_snapshot: null,
      decision_harness_bundle: null,
      decision_harness_build: null,
      decision_harness_receipt: null,
      terminal_event_key: structuredClone(terminalSourceEvent.event_key),
    }
  })
  if (finalizedTerminalDecision) rebuildDecisionTimeline()
  assertReplayDecisionEvidenceTimeline(decisionEvidenceTimeline, request, { source_events: sourceReduction.source_events })
  const exitRiskPolicy = riskPolicyAt(exit.timestamp)
  const entryFill = entryFillFor(entryExecution)
  const fills: ReplayFill[] = [entryFill, ...partialReduceFills]
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
      fill_id: `${request.run_id}:fill:${fills.length + 1}`,
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

  const positions = buildAverageCostPositionProjection({
    run_id: request.run_id,
    symbol: request.symbol,
    accounting_spec: accountingSpec,
    fills,
  })
  if (exitFill && positions.at(-1)?.state !== "flat") {
    throw new Error("certified terminal exit must produce a flat Position Projection")
  }
  const sourceEvents = sourceReduction.source_events
  const appliedFundingSources = sourceReduction.applied_funding_sources
  const appliedFunding = appliedFundingSources.map((source) => fundingEvents[source.source_index])
  const fundingAmounts = appliedFunding.map((event, index) => calculateFundingCashflowV3(
    event.mark_price,
    Math.abs(positionAt(entryExecution, appliedFundingSources[index]!.event_key).signed_quantity),
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
      positions,
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
    ohlcv_resolution_evidence: exit.role === "stop" || exit.role === "target"
      ? [exit.resolution_evidence]
      : [],
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
      decision_market_input_requirement_hash: request.decision_market_input_requirement_hash,
      decision_schedule_hash: request.decision_schedule_hash,
      decision_market_input_snapshot_hash: decisionMarketInputSnapshot.snapshot_hash,
      decision_evidence_timeline_hash: decisionEvidenceTimeline.timeline_hash,
      decision_state_snapshot_hashes: decisionEvidenceTimeline.entries.map(
        (entry) => entry.decision_state_snapshot?.snapshot_hash ?? null,
      ),
      decision_boundary_hash: decisionEvidenceEntry.decision_boundary.boundary_hash,
      decision_input_snapshot_hash: decisionInputSnapshot.snapshot_hash,
      decision_harness_receipt_hash: decisionHarnessReceipt?.receipt_hash ?? null,
      decision_harness_bundle_hash: decisionHarnessBundle?.bundle_hash ?? null,
      decision_harness_build_attestation_hash: decisionHarnessBuild?.attestation_hash ?? null,
      decision_harness_build_artifact_hash: decisionHarnessBuild?.artifact.sha256 ?? null,
      decision_harness_runtime_executable_hash: decisionHarnessBuild?.runtime.executable_sha256 ?? null,
      decision_harness_registry_policy_version: decisionHarnessReceipt?.registry_policy_version ?? null,
      decision_harness_loader_policy_version: decisionHarnessReceipt?.loader_policy_version ?? null,
      decision_harness_worker_protocol_version: decisionHarnessReceipt?.worker_protocol_version ?? null,
      ohlcv_resolution_evidence_hash: canonicalHash(
        exit.role === "stop" || exit.role === "target" ? [exit.resolution_evidence] : [],
      ),
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
  partial_reduce_order: ReplayOrder | null
  partial_reduce_fills: ReplayFill[]
  strategy_exit_order: ReplayOrder | null
  order_events: ReplayOrderEvent[]
  event_sequence: number
  exact_risk_snapshots: ReplayMarginSnapshot[]
  limitations: ReplayResult["limitations"]
  decision_evidence_timeline: ReplayDecisionEvidenceTimeline
  decision_boundary_hash: string
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
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
    decision_evidence_timeline_hash: input.decision_evidence_timeline.timeline_hash,
    decision_evidence_timeline: structuredClone(input.decision_evidence_timeline),
    decision_boundary_hash: input.decision_boundary_hash,
    decision_input_snapshot_hash: input.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: input.decision_market_input_snapshot_hash,
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
    partial_reduce_order: structuredClone(input.partial_reduce_order),
    partial_reduce_fills: structuredClone(input.partial_reduce_fills),
    strategy_exit_order: structuredClone(input.strategy_exit_order),
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
  decisionBoundaryHash?: string,
  decisionInputSnapshotHash?: string,
  decisionMarketInputSnapshotHash?: string,
  decisionHarnessReceiptHash?: string | null,
  decisionHarnessBundleHash?: string | null,
  decisionHarnessLoaderPolicyVersion?: string | null,
  decisionHarnessBuildAttestationHash?: string | null,
  decisionHarnessWorkerProtocolVersion?: string | null,
): void {
  if (checkpoint.schema_version !== REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION) throw new Error("unsupported Replay engine checkpoint schema")
  assertReplayDecisionEvidenceTimeline(checkpoint.decision_evidence_timeline, request, {
    allow_pending_runtime: true,
    source_events: checkpoint.source_events,
  })
  if (checkpoint.run_id !== request.run_id
      || checkpoint.request_hash !== canonicalHash(request)
      || checkpoint.dataset_hash !== datasetManifest.data_hash
      || (decisionEvidenceTimelineHash !== undefined
        && checkpoint.decision_evidence_timeline_hash !== decisionEvidenceTimelineHash)
      || (decisionBoundaryHash !== undefined && checkpoint.decision_boundary_hash !== decisionBoundaryHash)
      || (decisionInputSnapshotHash !== undefined && checkpoint.decision_input_snapshot_hash !== decisionInputSnapshotHash)
      || (decisionMarketInputSnapshotHash !== undefined
        && checkpoint.decision_market_input_snapshot_hash !== decisionMarketInputSnapshotHash)
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
  if (checkpoint.decision_evidence_timeline_hash !== checkpoint.decision_evidence_timeline.timeline_hash) {
    throw new Error("Replay engine checkpoint authority binding Decision Evidence Timeline hash is invalid")
  }
  if (!/^[a-f0-9]{64}$/.test(checkpoint.decision_evidence_timeline_hash)
      || !/^[a-f0-9]{64}$/.test(checkpoint.decision_boundary_hash)
      || !/^[a-f0-9]{64}$/.test(checkpoint.decision_input_snapshot_hash)
      || !/^[a-f0-9]{64}$/.test(checkpoint.decision_market_input_snapshot_hash)
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
  const maximumOrderEventSequence = checkpoint.order_events.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    0,
  )
  if (!Number.isSafeInteger(checkpoint.event_sequence)
      || checkpoint.event_sequence !== maximumOrderEventSequence) {
    throw new Error("Replay engine checkpoint OrderEvent sequence is invalid")
  }
  const assertOrderMatchesLastEvent = (order: ReplayOrder): void => {
    const lastEvent = checkpoint.order_events
      .filter((event) => event.order_id === order.order_id)
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1)
    if (!lastEvent
        || lastEvent.sequence !== order.last_event_sequence
        || canonicalHash(lastEvent.event_key) !== canonicalHash(order.last_event_key)
        || lastEvent.status !== order.status
        || lastEvent.remaining_quantity !== order.remaining_quantity) {
      throw new Error("Replay engine checkpoint Order state does not match its last OrderEvent")
    }
  }
  assertOrderMatchesLastEvent(checkpoint.entry_order)
  if (checkpoint.entry_transition) {
    assertOrderMatchesLastEvent(checkpoint.entry_transition.entry_order)
    assertOrderMatchesLastEvent(checkpoint.entry_transition.stop_order)
    assertOrderMatchesLastEvent(checkpoint.entry_transition.target_order)
  }
  if (checkpoint.partial_reduce_order) assertOrderMatchesLastEvent(checkpoint.partial_reduce_order)
  if (checkpoint.strategy_exit_order) assertOrderMatchesLastEvent(checkpoint.strategy_exit_order)
  if (checkpoint.partial_reduce_order) {
    const scheduleEntry = request.decision_schedule.entries.find(
      (entry) => entry.expected_effect === "authorized_partial_reduce",
    )
    const intent = scheduleEntry?.authorized_partial_reduce
    const evidence = checkpoint.decision_evidence_timeline.entries.find(
      (entry) => entry.decision_sequence === scheduleEntry?.decision_sequence,
    )
    const order = checkpoint.partial_reduce_order
    const fill = checkpoint.partial_reduce_fills[0]
    if (!intent || evidence?.evaluation_status !== "evaluated"
        || evidence.execution_effect !== "authorized_partial_reduce"
        || order.order_id !== `${request.run_id}:order:partial-reduce`
        || order.order_role !== "strategy_partial_reduce"
        || order.order_type !== "market"
        || order.side !== intent.side
        || order.quantity !== intent.quantity
        || order.reduce_only !== true
        || order.trigger_price !== null
        || !["submitted", "filled"].includes(order.status)
        || order.submitted_at !== intent.signal_time
        || (order.status === "submitted" && (order.filled_quantity !== 0 || checkpoint.partial_reduce_fills.length !== 0))
        || (order.status === "filled" && (
          checkpoint.partial_reduce_fills.length !== 1
          || !fill
          || fill.order_id !== order.order_id
          || fill.order_role !== "strategy_partial_reduce"
          || fill.side !== intent.side
          || fill.quantity !== intent.quantity
          || !Number.isFinite(fill.price) || fill.price <= 0
          || !Number.isFinite(fill.fee) || fill.fee < 0
          || fill.reduce_only !== true
          || fill.timestamp !== intent.earliest_executable_time
          || order.filled_quantity !== intent.quantity
        ))) {
      throw new Error("Replay engine checkpoint partial reduce is invalid")
    }
    if (order.status === "filled") {
      const entry = checkpoint.entry_transition
      const expectedSignedPosition = !entry ? 0 : request.order.side === "long"
        ? entry.executed_quantity - intent.quantity
        : -entry.executed_quantity + intent.quantity
      if (!entry || entry.signed_position_after !== expectedSignedPosition
          || entry.stop_order.order_id !== `${request.run_id}:order:stop-after-partial:${scheduleEntry.decision_sequence}`
          || entry.target_order.order_id !== `${request.run_id}:order:target-after-partial:${scheduleEntry.decision_sequence}`
          || entry.stop_order.order_role !== "stop" || entry.target_order.order_role !== "target"
          || entry.stop_order.order_type !== "stop_market"
          || entry.target_order.order_type !== "take_profit_market"
          || entry.stop_order.side !== intent.side || entry.target_order.side !== intent.side
          || entry.stop_order.reduce_only !== true || entry.target_order.reduce_only !== true
          || entry.stop_order.status !== "active" || entry.target_order.status !== "active"
          || entry.stop_order.trigger_price !== request.order.stop_price
          || entry.target_order.trigger_price !== request.order.target_price
          || entry.stop_order.quantity !== Math.abs(expectedSignedPosition)
          || entry.target_order.quantity !== Math.abs(expectedSignedPosition)
          || entry.stop_order.filled_quantity !== 0 || entry.target_order.filled_quantity !== 0
          || entry.stop_order.remaining_quantity !== Math.abs(expectedSignedPosition)
          || entry.target_order.remaining_quantity !== Math.abs(expectedSignedPosition)) {
        throw new Error("Replay engine checkpoint partial-reduce protection state is invalid")
      }
    }
  } else if (checkpoint.partial_reduce_fills.length !== 0) {
    throw new Error("Replay engine checkpoint partial Fill lacks its Order")
  }
  if (checkpoint.strategy_exit_order) {
    const scheduleEntry = request.decision_schedule.entries.find(
      (entry) => entry.expected_effect === "authorized_reduce_only_exit",
    )
    const intent = scheduleEntry?.authorized_reduce_only_exit
    const evidence = checkpoint.decision_evidence_timeline.entries.find(
      (entry) => entry.decision_sequence === scheduleEntry?.decision_sequence,
    )
    if (!intent || evidence?.evaluation_status !== "evaluated"
        || evidence.execution_effect !== "authorized_reduce_only_exit"
        || checkpoint.strategy_exit_order.order_role !== "strategy_exit"
        || checkpoint.strategy_exit_order.order_type !== "market"
        || checkpoint.strategy_exit_order.side !== intent.side
        || checkpoint.strategy_exit_order.reduce_only !== true
        || checkpoint.strategy_exit_order.status !== "submitted"
        || checkpoint.strategy_exit_order.submitted_at !== intent.signal_time
        || checkpoint.strategy_exit_order.filled_quantity !== 0) {
      throw new Error("Replay engine checkpoint pending strategy exit is invalid")
    }
  }
  const { checkpoint_hash: checkpointHash, ...body } = checkpoint
  if (checkpointHash !== canonicalHash(body)) throw new Error("Replay engine checkpoint hash is invalid")
}

function assertInstrumentAlignedInputs(
  request: ReplayExecutionRequest,
  bars: ReplayMarketBar[],
  priceIncrement: string,
  quantityIncrement: string,
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
  for (const entry of request.decision_schedule.entries) {
    const replace = entry.authorized_protective_stop_replace
    if (replace && !isReplayIncrementAligned(replace.new_stop_price, priceIncrement)) {
      throw new Error("Replay replacement stop_price must align to price increment")
    }
    const partial = entry.authorized_partial_reduce
    if (partial && (!isReplayIncrementAligned(partial.quantity, quantityIncrement)
        || partial.quantity >= quantizeReplayQuantity(request.order.quantity, quantityIncrement))) {
      throw new Error("Replay partial-reduce quantity must align and leave the executable position open")
    }
  }
  for (const [index, bar] of bars.entries()) {
    for (const [field, value] of Object.entries({ open: bar.open, high: bar.high, low: bar.low, close: bar.close })) {
      if (!isReplayIncrementAligned(value, priceIncrement)) {
        throw new Error(`Replay bars[${index}].${field} must align to price increment`)
      }
    }
  }
}
