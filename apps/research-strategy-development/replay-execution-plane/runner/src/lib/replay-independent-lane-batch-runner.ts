import {
  assertReplaySharedInitialCapitalReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplaySharedInitialCapitalReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_INDEPENDENT_LANE_BATCH_OUTCOME_SCHEMA_VERSION,
  REPLAY_INDEPENDENT_LANE_BATCH_RESULT_SCHEMA_VERSION,
  assertReplayIndependentLaneBatchPlan,
  assertReplayIndependentLaneBatchOutcome,
  assertReplayIndependentLaneBatchResult,
  replayIndependentLaneBatchOutcomeHash,
  replayIndependentLaneBatchResultHash,
  type ReplayIndependentLaneBatchOutcome,
  type ReplayIndependentLaneBatchPlan,
  type ReplayIndependentLaneBatchResult,
} from "../../../contracts/src/lib/replay-independent-lane-batch-contracts"
import {
  REPLAY_SHARED_INITIAL_CAPITAL_BATCH_OUTCOME_SCHEMA_VERSION,
  REPLAY_SHARED_INITIAL_CAPITAL_BATCH_RESULT_SCHEMA_VERSION,
  assertReplaySharedInitialCapitalBatchOutcome,
  replaySharedInitialCapitalBatchOutcomeHash,
  replaySharedInitialCapitalBatchResultHash,
  type ReplaySharedInitialCapitalBatchOutcome,
  type ReplaySharedInitialCapitalBatchResult,
} from "../../../contracts/src/lib/replay-shared-initial-capital-batch-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
import { runReplayTrial, type ReplayTrialRunInput, type ReplayTrialRunOutcome } from "./replay-trial-runner"

export interface ReplayIndependentLaneBatchRunInput {
  plan: ReplayIndependentLaneBatchPlan
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  execute_lane?: (input: ReplayTrialRunInput) => ReplayTrialRunOutcome
}

export function runReplayIndependentLaneBatch(
  input: ReplayIndependentLaneBatchRunInput,
): ReplayIndependentLaneBatchOutcome {
  return runReplayIndependentLaneBatchInOrder(input, input.plan.lanes.map((lane) => lane.lane_id))
}

export interface ReplaySharedInitialCapitalBatchRunInput extends ReplayIndependentLaneBatchRunInput {
  shared_capital_reservation: ReplaySharedInitialCapitalReservationSnapshot
}

export function runReplaySharedInitialCapitalBatch(
  input: ReplaySharedInitialCapitalBatchRunInput,
): ReplaySharedInitialCapitalBatchOutcome {
  assertReplayIndependentLaneBatchPlan(input.plan)
  const reservation = input.shared_capital_reservation
  assertReplaySharedInitialCapitalReservationSnapshot(reservation)
  if (reservation.batch_id !== input.plan.batch_id || reservation.batch_plan_hash !== input.plan.plan_hash
      || reservation.lanes.length !== input.plan.lanes.length) {
    throw new Error("shared initial capital Reservation does not bind the frozen Batch Plan")
  }
  const planByLane = new Map(input.plan.lanes.map((lane) => [lane.lane_id, lane]))
  const trialByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  for (const authority of reservation.lanes) {
    const plan = planByLane.get(authority.lane_id)
    const trial = trialByLane.get(authority.lane_id)
    if (!plan || !trial || plan.run_id !== authority.run_id
        || plan.trial_reservation_hash !== authority.trial_reservation_hash
        || plan.allocated_initial_cash !== authority.allocated_initial_cash
        || trial.request.trial_id !== authority.trial_id
        || trial.trial_reservation.reservation_ref !== authority.trial_reservation_ref
        || Date.parse(trial.observed_at) < Date.parse(reservation.issued_at)
        || Date.parse(trial.observed_at) >= Date.parse(reservation.expires_at)) {
      throw new Error(`shared initial capital lane ${authority.lane_id} authority or allocation drift`)
    }
  }
  const childOutcome = runReplayIndependentLaneBatchInOrder(
    input,
    reservation.lanes.map((lane) => lane.lane_id),
  )
  const result = childOutcome.result ? sharedResult(reservation, childOutcome) : null
  const body: Omit<ReplaySharedInitialCapitalBatchOutcome, "outcome_hash"> = {
    schema_version: REPLAY_SHARED_INITIAL_CAPITAL_BATCH_OUTCOME_SCHEMA_VERSION,
    batch_id: input.plan.batch_id,
    batch_plan_hash: input.plan.plan_hash,
    shared_capital_reservation_hash: reservation.reservation_hash,
    status: childOutcome.status,
    result,
    independent_lane_outcome: childOutcome,
  }
  const outcome = { ...body, outcome_hash: replaySharedInitialCapitalBatchOutcomeHash(body) }
  assertReplaySharedInitialCapitalBatchOutcome(outcome, reservation)
  return outcome
}

function runReplayIndependentLaneBatchInOrder(
  input: ReplayIndependentLaneBatchRunInput,
  executionOrder: string[],
): ReplayIndependentLaneBatchOutcome {
  assertReplayIndependentLaneBatchPlan(input.plan)
  const inputByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  if (inputByLane.size !== input.plan.lanes.length || input.lanes.length !== input.plan.lanes.length) {
    throw new Error("independent-lane batch inputs do not exactly cover the frozen Plan")
  }
  for (const lane of input.plan.lanes) {
    const trial = inputByLane.get(lane.lane_id)
    if (!trial || trial.request.run_id !== lane.run_id || trial.request.symbol !== lane.symbol
        || trial.request.initial_cash !== lane.allocated_initial_cash
        || canonicalHash(trial.request) !== lane.request_hash
        || hashTrialReservationSnapshot(trial.trial_reservation) !== lane.trial_reservation_hash
        || hashReplayAttemptLeaseSnapshot(trial.attempt_lease) !== lane.attempt_lease_hash
        || trial.request.trial_reservation_ref !== trial.trial_reservation.reservation_ref
        || trial.request.trial_reservation_hash !== lane.trial_reservation_hash
        || trial.trial_reservation.run_id !== lane.run_id
        || trial.trial_reservation.identity.trial_id !== trial.request.trial_id
        || trial.trial_reservation.identity.candidate_id !== trial.request.candidate_id
        || trial.attempt_lease.trial_id !== trial.request.trial_id
        || trial.attempt_lease.run_id !== lane.run_id
        || trial.attempt_lease.reservation_ref !== trial.trial_reservation.reservation_ref
        || trial.attempt_lease.reservation_hash !== lane.trial_reservation_hash
        || trial.attempt_lease.request_hash !== lane.request_hash) {
      throw new Error(`independent-lane ${lane.lane_id} authority or allocation drift`)
    }
  }

  if (executionOrder.length !== input.plan.lanes.length || new Set(executionOrder).size !== executionOrder.length
      || executionOrder.some((laneId) => !inputByLane.has(laneId))) {
    throw new Error("independent-lane execution order does not exactly cover the frozen Plan")
  }

  const executeLane = input.execute_lane ?? runReplayTrial
  const planByLane = new Map(input.plan.lanes.map((lane) => [lane.lane_id, lane]))
  const executedOutcomes = executionOrder.map((laneId) => {
    const lane = planByLane.get(laneId)!
    return { lane, outcome: executeLane(inputByLane.get(laneId)!) }
  })
  for (const { lane, outcome } of executedOutcomes) {
    const trial = inputByLane.get(lane.lane_id)!
    if (outcome.run_id !== lane.run_id
        || outcome.attempt_id !== trial.attempt_lease.attempt_id
        || outcome.lease_generation !== trial.attempt_lease.lease_generation
        || (outcome.result && outcome.result.run_id !== lane.run_id)
        || (outcome.artifact_manifest && outcome.artifact_manifest.run_id !== lane.run_id)) {
      throw new Error(`independent-lane ${lane.lane_id} child Outcome identity drift`)
    }
  }
  const outcomeByLane = new Map(executedOutcomes.map((entry) => [entry.lane.lane_id, entry.outcome]))
  const outcomes = input.plan.lanes.map((lane) => ({ lane, outcome: outcomeByLane.get(lane.lane_id)! }))
  const childStatuses: ReplayIndependentLaneBatchOutcome["child_statuses"] = outcomes.map(({ lane, outcome }) => ({
    lane_id: lane.lane_id,
    run_id: lane.run_id,
    status: outcome.status,
    result_hash: outcome.result ? canonicalHash(outcome.result) : null,
    artifact_manifest_hash: outcome.artifact_manifest ? canonicalHash(outcome.artifact_manifest) : null,
    failure_code: outcome.failure?.code ?? null,
  }))
  const notComplete = outcomes.find(({ outcome }) => outcome.status !== "completed")
  if (notComplete) return failedOutcome(input.plan, childStatuses, "independent-lane-child-not-complete", notComplete.lane.lane_id)
  const incomplete = outcomes.find(({ outcome }) => !outcome.result || !outcome.artifact_manifest)
  if (incomplete) return failedOutcome(input.plan, childStatuses, "independent-lane-child-evidence-incomplete", incomplete.lane.lane_id)

  const childResults: ReplayIndependentLaneBatchResult["child_results"] = outcomes.map(({ lane, outcome }) => {
    const result = outcome.result!
    const artifact = outcome.artifact_manifest!
    const resultHash = canonicalHash(result)
    if (result.run_id !== lane.run_id
        || result.metrics.initial_cash !== lane.allocated_initial_cash
        || addReplayDecimalValues(result.metrics.initial_cash, result.metrics.net_pnl) !== result.metrics.ending_equity) {
      throw new Error(`independent-lane ${lane.lane_id} child Result violates capital conservation`)
    }
    if (artifact.run_id !== lane.run_id || artifact.result_hash !== resultHash) {
      throw new Error(`independent-lane ${lane.lane_id} Artifact does not bind its child Result`)
    }
    return {
      lane_id: lane.lane_id,
      symbol: lane.symbol,
      run_id: lane.run_id,
      result_hash: resultHash,
      artifact_manifest_hash: canonicalHash(artifact),
      initial_cash: lane.allocated_initial_cash,
      ending_equity: result.metrics.ending_equity,
      net_pnl: result.metrics.net_pnl,
    }
  })
  const resultBody: Omit<ReplayIndependentLaneBatchResult, "result_hash"> = {
    schema_version: REPLAY_INDEPENDENT_LANE_BATCH_RESULT_SCHEMA_VERSION,
    batch_id: input.plan.batch_id,
    plan_hash: input.plan.plan_hash,
    execution_mode: "independent_capital_lanes",
    capital_semantics: "isolated_child_cash_not_spendable_portfolio_nav",
    child_results: childResults,
    aggregate_initial_cash: sum(childResults.map((child) => child.initial_cash)),
    aggregate_ending_equity: sum(childResults.map((child) => child.ending_equity)),
    aggregate_net_pnl: sum(childResults.map((child) => child.net_pnl)),
    limitations: [
      "no_shared_cash_or_rebalancing",
      "no_cross_margin_or_cross_lane_liquidation",
      "no_global_order_priority_or_concurrent_matching",
    ],
  }
  const result = { ...resultBody, result_hash: replayIndependentLaneBatchResultHash(resultBody) }
  assertReplayIndependentLaneBatchResult(result)
  return completeOutcome(input.plan, childStatuses, result)
}

function sharedResult(
  reservation: ReplaySharedInitialCapitalReservationSnapshot,
  childOutcome: ReplayIndependentLaneBatchOutcome,
): ReplaySharedInitialCapitalBatchResult {
  const child = childOutcome.result!
  const body: Omit<ReplaySharedInitialCapitalBatchResult, "result_hash"> = {
    schema_version: REPLAY_SHARED_INITIAL_CAPITAL_BATCH_RESULT_SCHEMA_VERSION,
    batch_id: reservation.batch_id,
    batch_plan_hash: reservation.batch_plan_hash,
    shared_capital_reservation_hash: reservation.reservation_hash,
    execution_mode: "shared_initial_capital_static_preallocation",
    capital_semantics: "single_pool_fully_reserved_before_execution",
    settlement_asset: reservation.settlement_asset,
    shared_initial_cash: reservation.shared_initial_cash,
    aggregate_ending_equity: child.aggregate_ending_equity,
    aggregate_net_pnl: child.aggregate_net_pnl,
    execution_priority: reservation.lanes.map((lane) => ({
      lane_id: lane.lane_id,
      priority_rank: lane.priority_rank,
    })),
    independent_lane_result_hash: child.result_hash,
    limitations: [
      "static_preallocation_not_runtime_shared_wallet",
      "no_cash_release_reuse_or_rebalancing",
      "no_cross_lane_margin_liquidation_or_concurrent_matching",
    ],
  }
  return { ...body, result_hash: replaySharedInitialCapitalBatchResultHash(body) }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => addReplayDecimalValues(total, value), 0)
}

function completeOutcome(
  plan: ReplayIndependentLaneBatchPlan,
  childStatuses: ReplayIndependentLaneBatchOutcome["child_statuses"],
  result: ReplayIndependentLaneBatchResult,
): ReplayIndependentLaneBatchOutcome {
  const body: Omit<ReplayIndependentLaneBatchOutcome, "outcome_hash"> = {
    schema_version: REPLAY_INDEPENDENT_LANE_BATCH_OUTCOME_SCHEMA_VERSION,
    batch_id: plan.batch_id,
    plan_hash: plan.plan_hash,
    status: "completed",
    result,
    child_statuses: childStatuses,
    failure: null,
  }
  const outcome = { ...body, outcome_hash: replayIndependentLaneBatchOutcomeHash(body) }
  assertReplayIndependentLaneBatchOutcome(outcome)
  return outcome
}

function failedOutcome(
  plan: ReplayIndependentLaneBatchPlan,
  childStatuses: ReplayIndependentLaneBatchOutcome["child_statuses"],
  code: NonNullable<ReplayIndependentLaneBatchOutcome["failure"]>["code"],
  failedLaneId: string,
): ReplayIndependentLaneBatchOutcome {
  const body: Omit<ReplayIndependentLaneBatchOutcome, "outcome_hash"> = {
    schema_version: REPLAY_INDEPENDENT_LANE_BATCH_OUTCOME_SCHEMA_VERSION,
    batch_id: plan.batch_id,
    plan_hash: plan.plan_hash,
    status: "failed",
    result: null,
    child_statuses: childStatuses,
    failure: { code, failed_lane_id: failedLaneId, partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayIndependentLaneBatchOutcomeHash(body) }
  assertReplayIndependentLaneBatchOutcome(outcome)
  return outcome
}
