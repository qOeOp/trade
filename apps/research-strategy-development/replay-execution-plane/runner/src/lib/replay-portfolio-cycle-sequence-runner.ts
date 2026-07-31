import {
  assertReplayPortfolioCycleSequenceReservationSnapshot,
  type ReplayPortfolioCycleSequenceReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { createReplayRuntimeSharedWalletPortfolioEvidence } from "../../../accounting/src/lib/replay-runtime-shared-wallet-portfolio-accounting"
import {
  createReplayIntegratedPortfolioResult,
  type ReplayIntegratedPortfolioPlan,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioCycleSequenceOutcome,
  assertReplayPortfolioCycleSequencePlan,
  createReplayPortfolioCycleSequenceResult,
  replayPortfolioCycleSequenceOutcomeHash,
  type ReplayPortfolioCycleSequenceExecutionInput,
  type ReplayPortfolioCycleSequenceOutcome,
  type ReplayPortfolioCycleSequencePlan,
} from "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import {
  type ReplayPortfolioAllocationAuthorityBinding,
  type ReplayPortfolioAllocationPlan,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayPortfolioEvidenceAuthorityBinding } from "../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import type { ReplayRuntimeSharedWalletRiskPlan } from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  executeReplayPortfolioAllocationSlice,
} from "../../../engine/src/lib/replay-portfolio-allocation-engine"
import {
  executeReplayRuntimeSharedWalletRiskSlice,
} from "../../../engine/src/lib/replay-runtime-shared-wallet-risk-engine"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  materializeReplayPortfolioAllocationLanes,
  type ReplayPortfolioAllocationMaterializationAuthority,
} from "./replay-portfolio-allocation-runner"
import {
  publishReplayPortfolioCycleSequenceArtifact,
} from "./replay-portfolio-cycle-sequence-artifact-publisher"
import {
  materializeReplayRuntimeSharedWalletRiskLanes,
  type ReplayRuntimeSharedWalletRiskMaterializationAuthority,
} from "./replay-runtime-shared-wallet-risk-runner"
import type { ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayPortfolioCycleSequenceRunCycleInput {
  cycle_index: number
  integrated_plan: ReplayIntegratedPortfolioPlan
  allocation_plan: ReplayPortfolioAllocationPlan
  risk_plan: ReplayRuntimeSharedWalletRiskPlan
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
}

export interface ReplayPortfolioCycleSequenceRunInput {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioCycleSequenceReservationSnapshot
  cycles: ReplayPortfolioCycleSequenceRunCycleInput[]
  artifact_store: ReplayArtifactStore
  execute_allocation_slice?: typeof executeReplayPortfolioAllocationSlice
  execute_risk_slice?: typeof executeReplayRuntimeSharedWalletRiskSlice
  publish_artifact?: typeof publishReplayPortfolioCycleSequenceArtifact
}

export function runReplayPortfolioCycleSequence(
  input: ReplayPortfolioCycleSequenceRunInput,
): ReplayPortfolioCycleSequenceOutcome {
  try {
    validateReplayPortfolioCycleSequenceRunInput(input)
  } catch (error) {
    return failed(input, "cycle-sequence-input-invalid", null, error)
  }
  const executions: ReplayPortfolioCycleSequenceExecutionInput[] = []
  let openingCash = input.reservation.initial_cash
  let priorReleaseTime = Number.NEGATIVE_INFINITY
  for (const cycle of input.cycles) {
    const authority = materializeReplayPortfolioCycleSequenceAuthority(input.reservation, cycle, openingCash)
    let allocationResult
    try {
      const lanes = materializeReplayPortfolioAllocationLanes({
        plan: cycle.allocation_plan,
        authority: authority.allocation,
        lanes: cycle.lanes,
      })
      allocationResult = (input.execute_allocation_slice ?? executeReplayPortfolioAllocationSlice)({
        plan: cycle.allocation_plan,
        authority: authority.allocation,
        lanes,
      })
    } catch (error) {
      return failed(input, "cycle-allocation-failed", cycle.cycle_index, error)
    }
    let riskResult
    try {
      const lanes = materializeReplayRuntimeSharedWalletRiskLanes({
        plan: cycle.risk_plan,
        risk_reservation: authority.risk_materialization,
        lanes: cycle.lanes,
      })
      if (lanes.some((lane) => lane.entry_time !== cycle.integrated_plan.initial_allocation_time
          || (lane.exit !== null && Date.parse(lane.exit.time) <= Date.parse(lane.entry_time)))) {
        throw new Error("cycle requires one entry boundary and only later full exits")
      }
      riskResult = (input.execute_risk_slice ?? executeReplayRuntimeSharedWalletRiskSlice)({
        plan: cycle.risk_plan,
        authority: authority.risk,
        lanes,
        allocation_result: allocationResult,
      })
    } catch (error) {
      return failed(input, "cycle-risk-failed", cycle.cycle_index, error)
    }
    try {
      const evidence = createReplayRuntimeSharedWalletPortfolioEvidence({
        plan: cycle.risk_plan,
        risk_reservation: authority.risk,
        risk_result: riskResult,
        allocation_result: allocationResult,
      })
      const integratedResult = createReplayIntegratedPortfolioResult({
        plan: cycle.integrated_plan,
        allocation_result: allocationResult,
        risk_result: riskResult,
      })
      const firstTime = Date.parse(integratedResult.state_chain[0]?.event_time ?? "")
      const releaseTime = Date.parse(integratedResult.state_chain.at(-1)?.event_time ?? "")
      if (!Number.isFinite(firstTime) || firstTime <= priorReleaseTime || !Number.isFinite(releaseTime)
          || integratedResult.ending_gross_exposure !== 0 || integratedResult.ending_net_exposure !== 0
          || integratedResult.ending_portfolio_risk !== 0 || riskResult.open_positions.length !== 0) {
        throw new Error("cycle did not commit a strictly later full-flat release")
      }
      executions.push({
        cycle_index: cycle.cycle_index,
        integrated_plan: cycle.integrated_plan,
        allocation_plan: cycle.allocation_plan,
        allocation_authority: authority.allocation,
        allocation_result: allocationResult,
        risk_plan: cycle.risk_plan,
        risk_authority: authority.risk,
        risk_result: riskResult,
        portfolio_evidence: evidence,
        integrated_result: integratedResult,
      })
      openingCash = integratedResult.ending_available_cash
      priorReleaseTime = releaseTime
    } catch (error) {
      return failed(input, "cycle-risk-failed", cycle.cycle_index, error)
    }
  }
  try {
    const result = createReplayPortfolioCycleSequenceResult({ plan: input.plan, executions })
    const published = (input.publish_artifact ?? publishReplayPortfolioCycleSequenceArtifact)({
      plan: input.plan,
      reservation: input.reservation,
      executions,
      result,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioCycleSequenceOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      sequence_plan_hash: input.plan.plan_hash,
      status: "completed",
      result,
      artifact_manifest: published.manifest,
      idempotent_replay: published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body,
      outcome_hash: replayPortfolioCycleSequenceOutcomeHash(body as ReplayPortfolioCycleSequenceOutcome) }
    assertReplayPortfolioCycleSequenceOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "cycle-sequence-artifact-failed", null, error)
  }
}

export function validateReplayPortfolioCycleSequenceRunInput(input: ReplayPortfolioCycleSequenceRunInput): void {
  assertReplayPortfolioCycleSequenceReservationSnapshot(input.reservation)
  assertReplayPortfolioCycleSequencePlan(input.plan)
  if (input.plan.sequence_reservation_hash !== input.reservation.reservation_hash
      || input.plan.portfolio_id !== input.reservation.portfolio_id
      || input.plan.initial_cash !== input.reservation.initial_cash
      || input.plan.cycle_count !== input.reservation.cycle_count
      || input.cycles.length !== input.plan.cycle_count) throw new Error("sequence authority coverage drift")
  for (const [offset, cycle] of input.cycles.entries()) {
    const index = offset + 1
    const declared = input.plan.cycles[offset]!
    const authority = input.reservation.cycles[offset]!
    const laneSet = cycle.allocation_plan.lanes.map((lane) => ({
      lane_id: lane.lane_id,
      symbol: lane.symbol,
      run_id: lane.run_id,
      request_hash: lane.request_hash,
      trial_reservation_hash: lane.trial_reservation_hash,
      attempt_lease_hash: lane.attempt_lease_hash,
    }))
    if (cycle.cycle_index !== index || declared.cycle_index !== index || authority.cycle_index !== index
        || cycle.integrated_plan.portfolio_id !== input.plan.portfolio_id
        || cycle.integrated_plan.plan_hash !== declared.integrated_plan_hash
        || cycle.allocation_plan.plan_hash !== declared.allocation_plan_hash
        || cycle.risk_plan.plan_hash !== declared.risk_plan_hash
        || authority.allocation_plan_hash !== declared.allocation_plan_hash
        || authority.risk_plan_hash !== declared.risk_plan_hash
        || authority.earliest_cycle_time !== declared.earliest_cycle_time
        || cycle.integrated_plan.initial_allocation_time !== declared.earliest_cycle_time
        || cycle.integrated_plan.allocation_reservation_hash !== input.reservation.reservation_hash
        || cycle.integrated_plan.risk_reservation_hash !== input.reservation.reservation_hash
        || declared.lane_set_hash !== canonicalHash(laneSet)
        || authority.lanes.length !== cycle.allocation_plan.lanes.length
        || authority.lanes.some((lane, laneOffset) => {
          const allocationLane = cycle.allocation_plan.lanes.find((candidate) => candidate.lane_id === lane.lane_id)
          const riskLane = cycle.risk_plan.lanes.find((candidate) => candidate.lane_id === lane.lane_id)
          return lane.priority_rank !== laneOffset + 1 || !allocationLane || !riskLane
            || lane.run_id !== allocationLane.run_id || lane.run_id !== riskLane.run_id
            || lane.trial_reservation_hash !== allocationLane.trial_reservation_hash
            || lane.trial_reservation_hash !== riskLane.trial_reservation_hash
        })) throw new Error(`cycle ${index} Plan or authority closure drift`)
  }
}

export function materializeReplayPortfolioCycleSequenceAuthority(
  reservation: ReplayPortfolioCycleSequenceReservationSnapshot,
  cycle: ReplayPortfolioCycleSequenceRunCycleInput,
  openingCash: number,
): {
  allocation: ReplayPortfolioAllocationMaterializationAuthority & ReplayPortfolioAllocationAuthorityBinding
    & ReplayPortfolioEvidenceAuthorityBinding
  risk: ReplayPortfolioEvidenceAuthorityBinding
  risk_materialization: ReplayRuntimeSharedWalletRiskMaterializationAuthority
} {
  const slot = reservation.cycles[cycle.cycle_index - 1]!
  const common = {
    reservation_hash: reservation.reservation_hash,
    issued_at: reservation.issued_at,
    expires_at: reservation.expires_at,
    portfolio_id: reservation.portfolio_id,
    settlement_asset: reservation.settlement_asset,
    shared_initial_cash: openingCash,
    experiment_id: reservation.experiment_id,
    trial_group_id: reservation.trial_group_id,
    trial_group_hash: reservation.trial_group_hash,
  }
  const riskLanes = slot.lanes.map(({ max_lane_risk_amount: _risk, ...lane }) => lane)
  const allocation = {
    ...common,
    portfolio_plan_hash: cycle.allocation_plan.plan_hash,
    max_gross_exposure_amount: slot.max_gross_exposure_amount,
    max_abs_net_exposure_amount: slot.max_abs_net_exposure_amount,
    max_portfolio_risk_amount: slot.max_portfolio_risk_amount,
    lanes: structuredClone(slot.lanes),
  }
  const risk = {
    ...common,
    portfolio_plan_hash: cycle.risk_plan.plan_hash,
    experiment_id: reservation.experiment_id,
    trial_group_id: reservation.trial_group_id,
    trial_group_hash: reservation.trial_group_hash,
    lanes: riskLanes.map(({ trial_id: _trial, run_id: _run, trial_reservation_ref: _ref,
      trial_reservation_hash: _hash, ...lane }) => lane),
  }
  const riskMaterialization = {
    ...common,
    portfolio_plan_hash: cycle.risk_plan.plan_hash,
    lanes: riskLanes,
  }
  return { allocation, risk, risk_materialization: riskMaterialization }
}

function failed(
  input: ReplayPortfolioCycleSequenceRunInput,
  code: NonNullable<ReplayPortfolioCycleSequenceOutcome["failure"]>["code"],
  cycleIndex: number | null,
  error: unknown,
): ReplayPortfolioCycleSequenceOutcome {
  const body: Omit<ReplayPortfolioCycleSequenceOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash,
    status: "failed",
    result: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: {
      code,
      cycle_index: cycleIndex,
      message: error instanceof Error ? error.message : String(error),
      partial_result_published: false,
    },
  }
  const outcome = { ...body,
    outcome_hash: replayPortfolioCycleSequenceOutcomeHash(body as ReplayPortfolioCycleSequenceOutcome) }
  assertReplayPortfolioCycleSequenceOutcome(outcome)
  return outcome
}
