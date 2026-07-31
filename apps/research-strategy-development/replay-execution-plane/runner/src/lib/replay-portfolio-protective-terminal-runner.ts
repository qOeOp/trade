import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTerminalOutcome,
  replayPortfolioProtectiveTerminalOutcomeHash,
  type ReplayPortfolioProtectiveTerminalOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { canonicalHash, replayDatasetHash } from "../../../contracts/src/lib/replay-contracts"
import {
  executeReplayPortfolioProtectiveTerminal,
  type ReplayPortfolioProtectiveTerminalLane,
} from "../../../engine/src/lib/replay-portfolio-protective-terminal-engine"
import {
  runReplayIntegratedPortfolio,
  type ReplayIntegratedPortfolioRunInput,
} from "./replay-integrated-portfolio-runner"
import {
  readReplayIntegratedPortfolioArtifactEvidence,
  runReplayPortfolioMarkRiskRevaluation,
} from "./replay-portfolio-mark-risk-revaluation-runner"
import { publishReplayPortfolioProtectiveTerminalArtifact } from "./replay-portfolio-protective-terminal-artifact-publisher"

export interface ReplayPortfolioProtectiveTerminalRunInput extends ReplayIntegratedPortfolioRunInput {
  execute_protective_terminal?: typeof executeReplayPortfolioProtectiveTerminal
  publish_protective_terminal_artifact?: typeof publishReplayPortfolioProtectiveTerminalArtifact
}

export function runReplayPortfolioProtectiveTerminal(
  input: ReplayPortfolioProtectiveTerminalRunInput,
): ReplayPortfolioProtectiveTerminalOutcome {
  const revaluation = runReplayPortfolioMarkRiskRevaluation(input)
  if (revaluation.status !== "completed" || !revaluation.evidence || !revaluation.artifact_manifest
      || !revaluation.integrated_result) {
    return failed(input, "mark-risk-revaluation-failed", revaluation.failure?.message ?? "Mark/Risk revaluation failed")
  }
  const integrated = runReplayIntegratedPortfolio(input)
  if (integrated.status !== "completed" || !integrated.result || !integrated.risk_result
      || !integrated.artifact?.artifact_manifest) {
    return failed(input, "integrated-artifact-read-failed", integrated.failure?.message ?? "Integrated Portfolio failed")
  }
  let source: ReturnType<typeof readReplayIntegratedPortfolioArtifactEvidence>
  let lanes: ReplayPortfolioProtectiveTerminalLane[]
  try {
    source = readReplayIntegratedPortfolioArtifactEvidence(
      input, integrated.result, integrated.artifact.artifact_manifest,
    )
    lanes = materializeReplayPortfolioProtectiveTerminalLanes({
      risk_plan: input.risk_plan,
      risk_authority: input.risk_reservation,
      lanes: input.lanes,
    })
  } catch (error) {
    return failed(input, "protective-terminal-input-invalid", error)
  }
  let evidence
  try {
    evidence = (input.execute_protective_terminal ?? executeReplayPortfolioProtectiveTerminal)({
      identity: {
        experiment_id: input.allocation_reservation.experiment_id,
        trial_group_id: input.allocation_reservation.trial_group_id,
        trial_group_hash: input.allocation_reservation.trial_group_hash,
      },
      allocation_result: source.allocation_result,
      risk_result: source.risk_result,
      integrated_result: source.integrated_result,
      integrated_manifest: integrated.artifact.artifact_manifest,
      revaluation_evidence: revaluation.evidence,
      revaluation_manifest: revaluation.artifact_manifest,
      lanes,
    })
  } catch (error) {
    return failed(input, "protective-terminal-engine-failed", error)
  }
  try {
    const published = (input.publish_protective_terminal_artifact
      ?? publishReplayPortfolioProtectiveTerminalArtifact)({
      integrated_manifest: integrated.artifact.artifact_manifest,
      revaluation_manifest: revaluation.artifact_manifest,
      allocation_result: source.allocation_result,
      risk_result: source.risk_result,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveTerminalOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id,
      status: "completed",
      integrated_result: source.integrated_result,
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: revaluation.idempotent_replay && integrated.artifact.idempotent_replay
        && published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body, outcome_hash: replayPortfolioProtectiveTerminalOutcomeHash(body) }
    assertReplayPortfolioProtectiveTerminalOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "protective-terminal-artifact-failed", error)
  }
}

export function materializeReplayPortfolioProtectiveTerminalLanes(input: {
  risk_plan: ReplayIntegratedPortfolioRunInput["risk_plan"]
  risk_authority: { settlement_asset: string; lanes: Array<{ lane_id: string; priority_rank: number }> }
  lanes: ReplayIntegratedPortfolioRunInput["lanes"]
}): ReplayPortfolioProtectiveTerminalLane[] {
  const trialByLane = new Map(input.lanes.map((lane) => [lane.lane_id, lane.trial]))
  const priorityByLane = new Map(input.risk_authority.lanes.map((lane) => [lane.lane_id, lane.priority_rank]))
  if (trialByLane.size !== input.risk_plan.lanes.length || priorityByLane.size !== input.risk_plan.lanes.length) {
    throw new Error("Portfolio protective terminal Lane coverage drift")
  }
  return input.risk_plan.lanes.map((planned) => {
    const trial = trialByLane.get(planned.lane_id)
    const priority = priorityByLane.get(planned.lane_id)
    if (!trial || !priority) throw new Error(`Portfolio protective terminal Lane ${planned.lane_id} missing`)
    const request = trial.request
    const manifest = trial.dataset_manifest
    const funding = trial.funding_events ?? []
    const marks = trial.mark_events ?? []
    const supplemental = trial.supplemental_facts ?? []
    if (canonicalHash(request) !== planned.request_hash || request.symbol !== planned.symbol
        || request.order.entry_execution.order_type !== "market"
        || request.order.earliest_executable_time !== trial.bars.find(
          (bar) => bar.open_time === request.order.earliest_executable_time,
        )?.open_time
        || replayDatasetHash(trial.bars, funding, marks, supplemental) !== manifest.data_hash
        || manifest.data_hash !== request.dataset_hash
        || manifest.instrument.accounting.settlement_asset !== input.risk_authority.settlement_asset
        || manifest.instrument.accounting.price_increment !== planned.price_increment
        || manifest.instrument.accounting.settlement_increment !== planned.settlement_increment
        || planned.contract_multiplier !== "1" || request.order.quantity <= 0
        || !validBars(trial.bars)) {
      throw new Error(`Portfolio protective terminal Lane ${planned.lane_id} frozen input drift`)
    }
    return {
      lane_id: planned.lane_id,
      run_id: planned.run_id,
      request_hash: planned.request_hash,
      symbol: planned.symbol,
      priority_rank: priority,
      side: request.order.side,
      quantity: request.order.quantity,
      entry_time: request.order.earliest_executable_time,
      stop_price: request.order.stop_price,
      target_price: request.order.target_price,
      bars: structuredClone(trial.bars),
      bars_hash: canonicalHash(trial.bars),
      cost_policy_id: request.cost_policy.policy_id,
      cost_policy_version: request.cost_policy.version,
      fee_bps: request.cost_policy.fee_bps,
      slippage_bps: request.cost_policy.slippage_bps,
      price_increment: planned.price_increment,
      settlement_increment: planned.settlement_increment,
      settlement_asset: input.risk_authority.settlement_asset,
    }
  })
}

function validBars(bars: ReplayIntegratedPortfolioRunInput["lanes"][number]["trial"]["bars"]): boolean {
  let priorClose = Number.NEGATIVE_INFINITY
  return bars.length > 0 && bars.every((bar) => {
    const open = Date.parse(bar.open_time)
    const close = Date.parse(bar.close_time)
    const valid = bar.closed && Number.isFinite(open) && Number.isFinite(close) && open > priorClose && close > open
      && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      && bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close)
      && bar.high >= bar.low && bar.volume >= 0
    priorClose = close
    return valid
  })
}

function failed(
  input: ReplayPortfolioProtectiveTerminalRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTerminalOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveTerminalOutcome {
  const body: Omit<ReplayPortfolioProtectiveTerminalOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id,
    status: "failed",
    integrated_result: null,
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayPortfolioProtectiveTerminalOutcomeHash(body) }
  assertReplayPortfolioProtectiveTerminalOutcome(outcome)
  return outcome
}
