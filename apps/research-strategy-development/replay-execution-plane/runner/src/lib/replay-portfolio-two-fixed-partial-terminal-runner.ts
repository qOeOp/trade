import {
  assertReplayPortfolioTwoFixedPartialReservationSnapshot,
  type ReplayPortfolioTwoFixedPartialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  canonicalHash,
  type ReplayArtifactManifest,
  type ReplayPartialReduceIntent,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import type { ReplayPortfolioTwoFixedPartialTerminalEvidence } from
  "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-terminal-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"
import {
  executeReplayPortfolioTwoFixedPartialTerminal,
  type ReplayPortfolioTwoFixedPartialTerminalLane,
} from "../../../engine/src/lib/replay-portfolio-two-fixed-partial-terminal-engine"
import { runReplayTrial, type ReplayTrialRunInput } from "./replay-trial-runner"

export interface ReplayPortfolioTwoFixedPartialProjectionInput {
  authority: ReplayPortfolioTwoFixedPartialReservationSnapshot
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
  execute_lane_replay?: typeof runReplayTrial
}
export interface ReplayPortfolioTwoFixedPartialProjectionResult {
  evidence: ReplayPortfolioTwoFixedPartialTerminalEvidence
  lane_results: Array<{ lane_id: string; result: ReplayResult; artifact_manifest: ReplayArtifactManifest }>
  idempotent_replay: boolean
}

export function runReplayPortfolioTwoFixedPartialTerminalProjection(
  input: ReplayPortfolioTwoFixedPartialProjectionInput,
): ReplayPortfolioTwoFixedPartialProjectionResult {
  assertAuthority(input.authority)
  const authorityByLane = new Map(input.authority.lanes.map((lane) => [lane.lane_id, lane]))
  const trialByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  if (authorityByLane.size !== input.authority.lanes.length || trialByLane.size !== input.lanes.length
      || authorityByLane.size !== trialByLane.size
      || [...authorityByLane.keys()].some((laneId) => !trialByLane.has(laneId))) {
    throw new Error("Portfolio two-fixed-partial projection Lane coverage drift")
  }
  const laneResults: ReplayPortfolioTwoFixedPartialProjectionResult["lane_results"] = []
  const engineLanes = [...authorityByLane.values()].map((authority) => {
    const trial = trialByLane.get(authority.lane_id)!
    const requestHash = canonicalHash(trial.request)
    if (authority.request_hash !== requestHash || trial.attempt_lease.request_hash !== requestHash
        || trial.request.experiment_id !== input.authority.experiment_id
        || trial.request.trial_group_id !== input.authority.trial_group_id
        || trial.request.trial_group_hash !== input.authority.trial_group_hash
        || trial.request.trial_id !== authority.trial_id || trial.request.run_id !== authority.run_id
        || trial.request.trial_reservation_ref !== authority.trial_reservation_ref
        || trial.request.trial_reservation_hash !== authority.trial_reservation_hash
        || trial.dataset_manifest.instrument.accounting.settlement_asset !== input.authority.settlement_asset
        || Date.parse(trial.observed_at) < Date.parse(input.authority.issued_at)
        || Date.parse(trial.observed_at) >= Date.parse(input.authority.expires_at)) {
      throw new Error(`Portfolio two-fixed-partial Lane ${authority.lane_id} Request authority drift`)
    }
    const partialEntries = trial.request.decision_schedule.entries.filter((entry) =>
      entry.expected_effect === "authorized_partial_reduce")
    const unsupported = trial.request.decision_schedule.entries.filter((entry) => ![
      "authorized_initial_order", "authorized_partial_reduce", "authorized_reduce_only_exit", "no_action",
    ].includes(entry.expected_effect))
    if (partialEntries.length !== 2 || unsupported.length > 0) {
      throw new Error(`Portfolio two-fixed-partial Lane ${authority.lane_id} requires exactly two bounded partials`)
    }
    const intents = partialEntries.map((entry) => entry.authorized_partial_reduce) as
      [ReplayPartialReduceIntent | null, ReplayPartialReduceIntent | null]
    if (intents.some((intent) => !intent) || partialEntries.some((entry, index) =>
      entry.authorized_order_hash !== canonicalHash(intents[index]))) {
      throw new Error(`Portfolio two-fixed-partial Lane ${authority.lane_id} partial authority drift`)
    }
    const [first, second] = intents as [ReplayPartialReduceIntent, ReplayPartialReduceIntent]
    if (first.schedule_combination_policy
          !== "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation"
        || second.schedule_combination_policy !== first.schedule_combination_policy
        || first.earliest_executable_time >= partialEntries[1]!.decision_time
        || addReplayDecimalValues(first.quantity, second.quantity) >= trial.request.order.quantity) {
      throw new Error(`Portfolio two-fixed-partial Lane ${authority.lane_id} bounded schedule drift`)
    }
    const outcome = (input.execute_lane_replay ?? runReplayTrial)(trial)
    if (outcome.status !== "completed" || !outcome.result || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? `Portfolio two-fixed-partial Lane ${authority.lane_id} Replay failed`)
    }
    laneResults.push({ lane_id: authority.lane_id, result: outcome.result,
      artifact_manifest: outcome.artifact_manifest })
    const accounting = trial.dataset_manifest.instrument.accounting
    const entry = outcome.result.fills.find((fill) => fill.order_role === "entry")
    if (!entry) throw new Error(`Portfolio two-fixed-partial Lane ${authority.lane_id} entry Fill missing`)
    const lane: ReplayPortfolioTwoFixedPartialTerminalLane = {
      lane_id: authority.lane_id, symbol: trial.request.symbol, request_hash: authority.request_hash,
      source_terminal_record_hash: authority.source_terminal_record_hash, side: trial.request.order.side,
      initial_cash: trial.request.initial_cash, entry_price: entry.price,
      initial_quantity: trial.request.order.quantity, isolated_collateral: authority.isolated_collateral,
      stop_price: trial.request.order.stop_price, target_price: trial.request.order.target_price,
      fee_bps: trial.request.cost_policy.fee_bps, slippage_bps: trial.request.cost_policy.slippage_bps,
      price_increment: accounting.price_increment, settlement_increment: accounting.settlement_increment,
      partial_intents: [structuredClone(first), structuredClone(second)],
      replay: { result: outcome.result, artifact_manifest: outcome.artifact_manifest },
    }
    return { lane, idempotent_replay: outcome.idempotent_replay }
  })
  engineLanes.sort((a, b) => a.lane.lane_id.localeCompare(b.lane.lane_id))
  laneResults.sort((a, b) => a.lane_id.localeCompare(b.lane_id))
  const evidence = executeReplayPortfolioTwoFixedPartialTerminal({
    portfolio_id: input.authority.portfolio_id, settlement_asset: input.authority.settlement_asset,
    source_terminal_evidence_hash: input.authority.source_terminal_evidence_hash,
    source_terminal_artifact_manifest_hash: input.authority.source_terminal_artifact_manifest_hash,
    risk_result_hash: input.authority.risk_result_hash, lanes: engineLanes.map((item) => item.lane),
  })
  return { evidence, lane_results: laneResults,
    idempotent_replay: engineLanes.every((item) => item.idempotent_replay) }
}

function assertAuthority(authority: ReplayPortfolioTwoFixedPartialReservationSnapshot): void {
  assertReplayPortfolioTwoFixedPartialReservationSnapshot(authority)
}
