import {
  REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_LIMITATIONS,
  REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_POLICY_VERSION,
  assertReplayPortfolioMarkRiskRevaluationEvidence,
  replayPortfolioMarkRiskRevaluationEvidenceHash,
  replayPortfolioMarkRiskRevaluationFingerprintHash,
  replayPortfolioMarkRiskTransitionHash,
  type ReplayPortfolioMarkRiskCapBreach,
  type ReplayPortfolioMarkRiskPositionSnapshot,
  type ReplayPortfolioMarkRiskRevaluationEvidence,
  type ReplayPortfolioMarkRiskRevaluationFingerprint,
  type ReplayPortfolioMarkRiskTransition,
} from "../../../contracts/src/lib/replay-portfolio-mark-risk-revaluation-contracts"
import {
  assertReplayIntegratedPortfolioArtifactManifest,
  assertReplayIntegratedPortfolioPlan,
  assertReplayIntegratedPortfolioResult,
  type ReplayIntegratedPortfolioArtifactManifest,
  type ReplayIntegratedPortfolioPlan,
  type ReplayIntegratedPortfolioResult,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import {
  assertReplayPortfolioAllocationResult,
  type ReplayPortfolioAllocationAuthorityBinding,
  type ReplayPortfolioAllocationDecision,
  type ReplayPortfolioAllocationPlan,
  type ReplayPortfolioAllocationResult,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  assertReplayRuntimeSharedWalletRiskResult,
  type ReplayRuntimeSharedWalletRiskPlan,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayRuntimeSharedWalletAuthorityBinding } from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDifferenceProduct,
} from "../../../contracts/src/lib/replay-decimal"

export interface ReplayPortfolioMarkRiskRevaluationInput {
  integrated_plan: ReplayIntegratedPortfolioPlan
  allocation_plan: ReplayPortfolioAllocationPlan
  allocation_reservation: ReplayPortfolioAllocationAuthorityBinding & ReplayPortfolioMarkRiskAuthorityIdentity
  allocation_result: ReplayPortfolioAllocationResult
  risk_plan: ReplayRuntimeSharedWalletRiskPlan
  risk_reservation: ReplayRuntimeSharedWalletAuthorityBinding & ReplayPortfolioMarkRiskAuthorityIdentity
  risk_result: ReplayRuntimeSharedWalletRiskResult
  integrated_result: ReplayIntegratedPortfolioResult
  integrated_manifest: ReplayIntegratedPortfolioArtifactManifest
}

export interface ReplayPortfolioMarkRiskAuthorityIdentity {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
}

export function executeReplayPortfolioMarkRiskRevaluation(
  input: ReplayPortfolioMarkRiskRevaluationInput,
): ReplayPortfolioMarkRiskRevaluationEvidence {
  validateInput(input)
  const decisions = new Map<string, ReplayPortfolioAllocationDecision>()
  for (const decision of input.allocation_result.allocation_cycles.flatMap((cycle) => cycle.decisions)) {
    if (decisions.has(decision.lane_id)) throw new Error("Portfolio Mark Risk duplicate Allocation decision")
    decisions.set(decision.lane_id, decision)
  }
  const planLanes = new Map(input.allocation_plan.lanes.map((lane) => [lane.lane_id, lane]))
  const active = new Map<string, ReplayPortfolioMarkRiskPositionSnapshot>()
  const transitions: ReplayPortfolioMarkRiskTransition[] = []
  let prior = aggregate([])
  for (const event of input.risk_result.global_source_event_queue) {
    const hadActivePosition = active.has(event.lane_id)
    let kind: ReplayPortfolioMarkRiskTransition["revaluation_kind"] = "carry"
    if (event.event_role === "entry" && event.outcome === "filled") {
      const decision = decisions.get(event.lane_id)
      const lane = planLanes.get(event.lane_id)
      if (!decision || !lane || decision.allocation !== "admitted"
          || decision.execution_price !== event.execution_price
          || decision.quantity !== event.quantity || decision.position_side !== event.position_side
          || active.has(event.lane_id)) {
        throw new Error(`Portfolio Mark Risk entry ${event.lane_id} lacks one admitted Allocation decision`)
      }
      active.set(event.lane_id, positionAtMark(decision, lane.settlement_increment, event.execution_price, {
        kind: "entry_fill", hash: event.event_hash,
      }))
      kind = "entry_mark"
    } else if (event.event_role === "risk_observation" && hadActivePosition) {
      const current = active.get(event.lane_id)!
      const lane = planLanes.get(event.lane_id)
      if (!lane || event.position_side !== current.side || event.quantity !== current.quantity
          || event.entry_price !== current.entry_price) {
        throw new Error(`Portfolio Mark Risk exact Mark ${event.lane_id} Position binding drift`)
      }
      active.set(event.lane_id, positionAtMark({
        lane_id: current.lane_id,
        symbol: current.symbol,
        position_side: current.side,
        quantity: current.quantity,
        execution_price: current.entry_price,
        protective_stop_execution_price: current.protective_stop_execution_price,
        entry_fee: current.entry_fee,
        protective_stop_exit_fee: current.projected_stop_exit_fee,
        requested_risk_amount: current.frozen_stop_risk_amount,
      }, lane.settlement_increment, event.mark_price, {
        kind: "exact_mark", hash: event.event_hash,
      }))
      kind = "exact_mark"
    } else if (event.event_role === "liquidation"
        || (event.event_role === "exit" && event.outcome === "filled")) {
      if (!active.delete(event.lane_id)) {
        throw new Error(`Portfolio Mark Risk ${event.event_role} ${event.lane_id} lacks an active Position`)
      }
      kind = "full_close_release"
    }
    const positions = [...active.values()].sort((left, right) => left.lane_id.localeCompare(right.lane_id))
      .map((position) => structuredClone(position))
    const next = aggregate(positions)
    const body: Omit<ReplayPortfolioMarkRiskTransition, "transition_hash"> = {
      transition_sequence: transitions.length + 1,
      queue_ordinal: event.queue_ordinal,
      event_time: event.event_time,
      event_role: event.event_role,
      lane_id: event.lane_id,
      source_event_hash: event.event_hash,
      revaluation_kind: kind,
      positions_after: positions,
      positions_after_hash: canonicalHash(positions),
      gross_mark_exposure_before: prior.gross,
      gross_mark_exposure_after: next.gross,
      net_mark_exposure_before: prior.net,
      net_mark_exposure_after: next.net,
      portfolio_frozen_stop_risk_before: prior.risk,
      portfolio_frozen_stop_risk_after: next.risk,
      portfolio_prospective_stop_drawdown_before: prior.prospective,
      portfolio_prospective_stop_drawdown_after: next.prospective,
      resolution_limited_lane_ids_after: next.limited,
      cap_breaches_after: capBreaches(next, input.allocation_result.limits),
      cap_effect: "observation_only_no_automatic_liquidation_or_reallocation",
    }
    transitions.push({
      ...body,
      transition_hash: replayPortfolioMarkRiskTransitionHash(body as ReplayPortfolioMarkRiskTransition),
    })
    prior = next
  }
  const limits = structuredClone(input.allocation_result.limits)
  const fingerprintBody: Omit<ReplayPortfolioMarkRiskRevaluationFingerprint, "fingerprint_hash"> = {
    experiment_id: input.allocation_reservation.experiment_id,
    trial_group_id: input.allocation_reservation.trial_group_id,
    trial_group_hash: input.allocation_reservation.trial_group_hash,
    portfolio_id: input.integrated_plan.portfolio_id,
    integrated_plan_hash: input.integrated_plan.plan_hash,
    allocation_plan_hash: input.allocation_plan.plan_hash,
    allocation_reservation_hash: input.allocation_reservation.reservation_hash,
    allocation_result_hash: input.allocation_result.result_hash,
    risk_plan_hash: input.risk_plan.plan_hash,
    risk_reservation_hash: input.risk_reservation.reservation_hash,
    risk_result_hash: input.risk_result.result_hash,
    integrated_result_hash: input.integrated_result.result_hash,
    integrated_artifact_manifest_hash: input.integrated_manifest.manifest_hash,
    transitions_hash: canonicalHash(transitions),
    limits_hash: canonicalHash(limits),
    limitations_hash: canonicalHash(REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_LIMITATIONS),
  }
  const fingerprint = {
    ...fingerprintBody,
    fingerprint_hash: replayPortfolioMarkRiskRevaluationFingerprintHash(
      fingerprintBody as ReplayPortfolioMarkRiskRevaluationFingerprint,
    ),
  }
  const body: Omit<ReplayPortfolioMarkRiskRevaluationEvidence, "evidence_hash"> = {
    schema_version: REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_EVIDENCE_SCHEMA_VERSION,
    policy_version: REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_POLICY_VERSION,
    experiment_id: input.allocation_reservation.experiment_id,
    trial_group_id: input.allocation_reservation.trial_group_id,
    trial_group_hash: input.allocation_reservation.trial_group_hash,
    portfolio_id: input.integrated_plan.portfolio_id,
    integrated_plan_hash: input.integrated_plan.plan_hash,
    allocation_plan_hash: input.allocation_plan.plan_hash,
    allocation_reservation_hash: input.allocation_reservation.reservation_hash,
    allocation_result_hash: input.allocation_result.result_hash,
    risk_plan_hash: input.risk_plan.plan_hash,
    risk_reservation_hash: input.risk_reservation.reservation_hash,
    risk_result_hash: input.risk_result.result_hash,
    integrated_result_hash: input.integrated_result.result_hash,
    integrated_artifact_manifest_hash: input.integrated_manifest.manifest_hash,
    settlement_asset: input.allocation_reservation.settlement_asset,
    limits,
    transitions,
    transitions_hash: canonicalHash(transitions),
    exact_mark_revaluation_count: transitions.filter((item) => item.revaluation_kind === "exact_mark").length,
    cap_breach_transition_sequences: transitions.filter((item) => item.cap_breaches_after.length > 0)
      .map((item) => item.transition_sequence),
    resolution_limited_transition_sequences: transitions
      .filter((item) => item.resolution_limited_lane_ids_after.length > 0)
      .map((item) => item.transition_sequence),
    ending_gross_mark_exposure: prior.gross,
    ending_net_mark_exposure: prior.net,
    ending_portfolio_frozen_stop_risk: prior.risk,
    ending_portfolio_prospective_stop_drawdown: prior.prospective,
    limitations: REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_LIMITATIONS,
    fingerprint,
  }
  const evidence = {
    ...body,
    evidence_hash: replayPortfolioMarkRiskRevaluationEvidenceHash(
      body as ReplayPortfolioMarkRiskRevaluationEvidence,
    ),
  }
  assertReplayPortfolioMarkRiskRevaluationEvidence(evidence, {
    allocation_result: input.allocation_result,
    risk_result: input.risk_result,
    integrated_result: input.integrated_result,
    integrated_manifest: input.integrated_manifest,
  })
  return evidence
}

function validateInput(input: ReplayPortfolioMarkRiskRevaluationInput): void {
  assertReplayIntegratedPortfolioPlan(input.integrated_plan, input.allocation_plan, input.risk_plan)
  assertReplayPortfolioAllocationResult(
    input.allocation_result, input.allocation_plan, input.allocation_reservation,
  )
  assertReplayRuntimeSharedWalletRiskResult(
    input.risk_result, input.risk_plan, input.risk_reservation, input.allocation_result,
  )
  assertReplayIntegratedPortfolioResult(
    input.integrated_result, input.integrated_plan, input.allocation_result, input.risk_result,
  )
  assertReplayIntegratedPortfolioArtifactManifest(input.integrated_manifest)
  if (input.integrated_manifest.integrated_result_hash !== input.integrated_result.result_hash
      || input.allocation_reservation.experiment_id !== input.risk_reservation.experiment_id
      || input.allocation_reservation.trial_group_id !== input.risk_reservation.trial_group_id
      || input.allocation_reservation.trial_group_hash !== input.risk_reservation.trial_group_hash
      || input.allocation_reservation.portfolio_id !== input.risk_reservation.portfolio_id
      || input.allocation_reservation.settlement_asset !== input.risk_reservation.settlement_asset) {
    throw new Error("Portfolio Mark Risk source authority closure drift")
  }
}

function positionAtMark(
  decision: Pick<ReplayPortfolioAllocationDecision,
    "lane_id" | "symbol" | "position_side" | "quantity" | "execution_price"
    | "protective_stop_execution_price" | "entry_fee" | "protective_stop_exit_fee"
    | "requested_risk_amount">,
  settlementIncrement: string,
  markPrice: number,
  source: { kind: ReplayPortfolioMarkRiskPositionSnapshot["mark_source_kind"]; hash: string },
): ReplayPortfolioMarkRiskPositionSnapshot {
  const crossed = decision.position_side === "long"
    ? markPrice <= decision.protective_stop_execution_price
    : markPrice >= decision.protective_stop_execution_price
  const priceDrawdown = crossed ? null : quantizeReplayDifferenceProduct(
    markPrice,
    decision.protective_stop_execution_price,
    decision.quantity,
    decision.position_side === "long" ? 1 : -1,
    settlementIncrement,
    "ceil",
  )
  const markNotional = quantizeProduct(markPrice, decision.quantity, settlementIncrement)
  return {
    lane_id: decision.lane_id,
    symbol: decision.symbol,
    side: decision.position_side,
    quantity: decision.quantity,
    entry_price: decision.execution_price,
    current_mark_price: markPrice,
    mark_source_kind: source.kind,
    mark_source_hash: source.hash,
    mark_notional: markNotional,
    signed_mark_notional: decision.position_side === "long" ? markNotional : -markNotional,
    protective_stop_execution_price: decision.protective_stop_execution_price,
    entry_fee: decision.entry_fee,
    projected_stop_exit_fee: decision.protective_stop_exit_fee,
    frozen_stop_risk_amount: decision.requested_risk_amount,
    prospective_mark_to_stop_drawdown: priceDrawdown === null ? null
      : addReplayDecimalValues(priceDrawdown, decision.protective_stop_exit_fee),
    stop_relation: crossed ? "crossed_or_equal_without_portfolio_stop_execution" : "not_crossed",
  }
}

function quantizeProduct(price: number, quantity: number, increment: string): number {
  return quantizeReplayDifferenceProduct(price, 0, quantity, 1, increment, "ceil")
}

function aggregate(positions: ReplayPortfolioMarkRiskPositionSnapshot[]): {
  gross: number; net: number; risk: number; prospective: number | null; limited: string[]
} {
  const limited = positions.filter((position) =>
    position.stop_relation === "crossed_or_equal_without_portfolio_stop_execution").map((position) => position.lane_id)
  return {
    gross: addReplayDecimalValues(...positions.map((position) => position.mark_notional)),
    net: addReplayDecimalValues(...positions.map((position) => position.signed_mark_notional)),
    risk: addReplayDecimalValues(...positions.map((position) => position.frozen_stop_risk_amount)),
    prospective: limited.length > 0 ? null
      : addReplayDecimalValues(...positions.map((position) => position.prospective_mark_to_stop_drawdown ?? 0)),
    limited,
  }
}

function capBreaches(
  values: ReturnType<typeof aggregate>,
  limits: ReplayPortfolioAllocationResult["limits"],
): ReplayPortfolioMarkRiskCapBreach[] {
  const result: ReplayPortfolioMarkRiskCapBreach[] = []
  if (values.gross > limits.max_gross_exposure_amount) result.push("gross_exposure_limit_breached")
  if (Math.abs(values.net) > limits.max_abs_net_exposure_amount) {
    result.push("absolute_net_exposure_limit_breached")
  }
  if (values.risk > limits.max_portfolio_risk_amount) {
    result.push("portfolio_frozen_stop_risk_limit_breached")
  }
  return result
}
