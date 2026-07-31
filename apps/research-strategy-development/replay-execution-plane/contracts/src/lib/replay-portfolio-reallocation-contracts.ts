import {
  assertReplayIntegratedPortfolioArtifactManifest,
  replayIntegratedPortfolioArtifactManifestHash,
  replayIntegratedPortfolioResultHash,
  replayIntegratedPortfolioTransitionHash,
  type ReplayIntegratedPortfolioOutcome,
} from "./replay-integrated-portfolio-contracts"
import {
  assertReplayPortfolioAllocationPlan,
  assertReplayPortfolioAllocationResult,
  type ReplayPortfolioAllocationAuthorityBinding,
  type ReplayPortfolioAllocationPlan,
  type ReplayPortfolioAllocationResult,
} from "./replay-portfolio-allocation-contracts"
import { canonicalHash } from "./replay-contracts"
import { replayRuntimeSharedWalletRiskResultHash } from "./replay-runtime-shared-wallet-risk-contracts"

export const REPLAY_PORTFOLIO_REALLOCATION_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-reallocation-plan.v1" as const
export const REPLAY_PORTFOLIO_REALLOCATION_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-reallocation-result.v1" as const
export const REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-reallocation-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_REALLOCATION_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-reallocation-outcome.v1" as const

export const REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS = [
  "exactly_one_second_allocation_cycle_after_authoritative_full_flat_release",
  "opening_cash_is_predecessor_ending_available_cash_not_control_plane_estimate",
  "no_third_cycle_partial_close_cross_margin_borrow_or_fast",
] as const

export interface ReplayPortfolioReallocationAuthorityBinding {
  reservation_hash: string
  predecessor_integrated_result_hash: string
  predecessor_artifact_manifest_hash: string
}

export interface ReplayPortfolioReallocationPlan {
  schema_version: typeof REPLAY_PORTFOLIO_REALLOCATION_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "full_flat_release_then_second_allocation_cycle_v1"
  predecessor_integrated_result_hash: string
  predecessor_artifact_manifest_hash: string
  reallocation_reservation_hash: string
  cycle_2_allocation_plan_hash: string
  cycle_2_event_time: string
  opening_cash_policy: "predecessor_ending_available_cash_after_full_flat_release"
  eligibility_policy: "all_predecessor_positions_closed_and_exposure_risk_zero"
  failure_policy: "input_or_allocation_or_artifact_failure_no_reallocation_result"
  limitations: typeof REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS
  plan_hash: string
}

export interface ReplayPortfolioReallocationResult {
  schema_version: typeof REPLAY_PORTFOLIO_REALLOCATION_RESULT_SCHEMA_VERSION
  portfolio_id: string
  reallocation_plan_hash: string
  reallocation_reservation_hash: string
  predecessor_integrated_result_hash: string
  predecessor_artifact_manifest_hash: string
  predecessor_full_flat_transition_hash: string
  predecessor_full_flat_time: string
  reallocation_cycle: 2
  opening_available_cash: number
  cycle_2_allocation_result_hash: string
  cycle_2_event_time: string
  ending_available_cash: number
  ending_gross_exposure: number
  ending_net_exposure: number
  ending_portfolio_risk: number
  limitations: typeof REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS
  result_hash: string
}

export const REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES = [
  "reallocation_plan", "reallocation_reservation", "predecessor_integrated_result",
  "predecessor_artifact_manifest", "cycle_2_allocation_plan", "cycle_2_allocation_result",
  "reallocation_result",
] as const
export type ReplayPortfolioReallocationArtifactRole = typeof REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES[number]

export interface ReplayPortfolioReallocationArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  reallocation_result_hash: string
  files: Array<{ role: ReplayPortfolioReallocationArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES
    commit_marker: "portfolio-reallocation-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioReallocationOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_REALLOCATION_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  reallocation_plan_hash: string
  status: "completed" | "failed"
  result: ReplayPortfolioReallocationResult | null
  allocation_result: ReplayPortfolioAllocationResult | null
  artifact_manifest: ReplayPortfolioReallocationArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "reallocation-input-invalid" | "reallocation-allocation-failed" | "reallocation-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioReallocationPlanHash(value: ReplayPortfolioReallocationPlan | Omit<ReplayPortfolioReallocationPlan, "plan_hash">): string {
  const { plan_hash: _hash, ...body } = value as ReplayPortfolioReallocationPlan
  return canonicalHash(body)
}
export function replayPortfolioReallocationResultHash(value: ReplayPortfolioReallocationResult | Omit<ReplayPortfolioReallocationResult, "result_hash">): string {
  const { result_hash: _hash, ...body } = value as ReplayPortfolioReallocationResult
  return canonicalHash(body)
}
export function replayPortfolioReallocationArtifactManifestHash(value: ReplayPortfolioReallocationArtifactManifest | Omit<ReplayPortfolioReallocationArtifactManifest, "manifest_hash">): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioReallocationArtifactManifest
  return canonicalHash(body)
}
export function replayPortfolioReallocationOutcomeHash(value: ReplayPortfolioReallocationOutcome | Omit<ReplayPortfolioReallocationOutcome, "outcome_hash">): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioReallocationOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioReallocationPlan(
  value: ReplayPortfolioReallocationPlan,
  allocationPlan?: ReplayPortfolioAllocationPlan,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_REALLOCATION_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "full_flat_release_then_second_allocation_cycle_v1"
      || value.opening_cash_policy !== "predecessor_ending_available_cash_after_full_flat_release"
      || value.eligibility_policy !== "all_predecessor_positions_closed_and_exposure_risk_zero"
      || value.failure_policy !== "input_or_allocation_or_artifact_failure_no_reallocation_result"
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS)
      || !utc(value.cycle_2_event_time) || value.plan_hash !== replayPortfolioReallocationPlanHash(value)) fail("Plan policy/hash")
  hashes([value.predecessor_integrated_result_hash, value.predecessor_artifact_manifest_hash,
    value.reallocation_reservation_hash, value.cycle_2_allocation_plan_hash, value.plan_hash])
  if (allocationPlan) {
    assertReplayPortfolioAllocationPlan(allocationPlan)
    if (value.portfolio_id !== allocationPlan.portfolio_id || value.cycle_2_allocation_plan_hash !== allocationPlan.plan_hash
        || new Set(allocationPlan.lanes.map((lane) => lane.earliest_executable_time)).size !== 1
        || allocationPlan.lanes[0]?.earliest_executable_time !== value.cycle_2_event_time) fail("Plan Allocation closure")
  }
}

export function assertReplayPortfolioReallocationPredecessor(
  predecessor: ReplayIntegratedPortfolioOutcome,
  reservation: ReplayPortfolioReallocationAuthorityBinding,
): { transition_hash: string; event_time: string; opening_cash: number } {
  if (predecessor.status !== "completed" || !predecessor.result || !predecessor.risk_result
      || !predecessor.artifact?.artifact_manifest || predecessor.artifact.status !== "committed") fail("predecessor is not committed")
  const result = predecessor.result
  const risk = predecessor.risk_result
  const manifest = predecessor.artifact.artifact_manifest
  assertReplayIntegratedPortfolioArtifactManifest(manifest)
  if (result.result_hash !== replayIntegratedPortfolioResultHash(result)
      || risk.result_hash !== replayRuntimeSharedWalletRiskResultHash(risk)
      || manifest.manifest_hash !== replayIntegratedPortfolioArtifactManifestHash(manifest)
      || manifest.integrated_result_hash !== result.result_hash
      || reservation.predecessor_integrated_result_hash !== result.result_hash
      || reservation.predecessor_artifact_manifest_hash !== manifest.manifest_hash
      || result.ending_gross_exposure !== 0 || result.ending_net_exposure !== 0 || result.ending_portfolio_risk !== 0
      || risk.open_positions.length !== 0 || !Number.isFinite(result.ending_available_cash)
      || result.ending_available_cash <= 0) fail("predecessor full-flat evidence")
  let transitionIndex = -1
  for (let index = result.state_chain.length - 1; index >= 0; index -= 1) {
    const candidate = result.state_chain[index]!
    if ((candidate.event_role === "exit" || candidate.event_role === "liquidation")
        && candidate.gross_exposure_before > 0 && candidate.gross_exposure_after === 0
        && candidate.net_exposure_after === 0 && candidate.portfolio_risk_after === 0) {
      transitionIndex = index
      break
    }
  }
  const transition = result.state_chain[transitionIndex]
  if (!transition
      || transition.transition_hash !== replayIntegratedPortfolioTransitionHash(transition)
      || transition.gross_exposure_after !== 0 || transition.net_exposure_after !== 0
      || transition.portfolio_risk_after !== 0
      || result.state_chain.slice(transitionIndex + 1).some((candidate) =>
        candidate.gross_exposure_after !== 0 || candidate.net_exposure_after !== 0
          || candidate.portfolio_risk_after !== 0
          || candidate.transition_hash !== replayIntegratedPortfolioTransitionHash(candidate))) {
    fail("predecessor lacks authoritative full-flat release transition")
  }
  return { transition_hash: transition.transition_hash, event_time: transition.event_time,
    opening_cash: result.ending_available_cash }
}

export function createReplayPortfolioReallocationResult(input: {
  plan: ReplayPortfolioReallocationPlan
  reservation: ReplayPortfolioReallocationAuthorityBinding
  predecessor: ReplayIntegratedPortfolioOutcome
  allocation_plan: ReplayPortfolioAllocationPlan
  allocation_result: ReplayPortfolioAllocationResult
  authority_binding: ReplayPortfolioAllocationAuthorityBinding
}): ReplayPortfolioReallocationResult {
  const release = assertReplayPortfolioReallocationPredecessor(input.predecessor, input.reservation)
  assertReplayPortfolioAllocationResult(input.allocation_result, input.allocation_plan,
    input.authority_binding)
  const body: Omit<ReplayPortfolioReallocationResult, "result_hash"> = {
    schema_version: REPLAY_PORTFOLIO_REALLOCATION_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    reallocation_plan_hash: input.plan.plan_hash,
    reallocation_reservation_hash: input.reservation.reservation_hash,
    predecessor_integrated_result_hash: input.reservation.predecessor_integrated_result_hash,
    predecessor_artifact_manifest_hash: input.reservation.predecessor_artifact_manifest_hash,
    predecessor_full_flat_transition_hash: release.transition_hash,
    predecessor_full_flat_time: release.event_time,
    reallocation_cycle: 2,
    opening_available_cash: release.opening_cash,
    cycle_2_allocation_result_hash: input.allocation_result.result_hash,
    cycle_2_event_time: input.plan.cycle_2_event_time,
    ending_available_cash: input.allocation_result.ending_available_cash,
    ending_gross_exposure: input.allocation_result.ending_gross_exposure,
    ending_net_exposure: input.allocation_result.ending_net_exposure,
    ending_portfolio_risk: input.allocation_result.ending_portfolio_risk,
    limitations: REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS,
  }
  const result = { ...body, result_hash: replayPortfolioReallocationResultHash(body as ReplayPortfolioReallocationResult) }
  assertReplayPortfolioReallocationResult(result, input.plan, input.reservation, input.predecessor, input.allocation_result)
  return result
}

export function assertReplayPortfolioReallocationResult(
  value: ReplayPortfolioReallocationResult,
  plan: ReplayPortfolioReallocationPlan,
  reservation: ReplayPortfolioReallocationAuthorityBinding,
  predecessor: ReplayIntegratedPortfolioOutcome,
  allocationResult: ReplayPortfolioAllocationResult,
): void {
  const release = assertReplayPortfolioReallocationPredecessor(predecessor, reservation)
  if (value.schema_version !== REPLAY_PORTFOLIO_REALLOCATION_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.reallocation_plan_hash !== plan.plan_hash
      || value.reallocation_reservation_hash !== reservation.reservation_hash
      || value.predecessor_integrated_result_hash !== reservation.predecessor_integrated_result_hash
      || value.predecessor_artifact_manifest_hash !== reservation.predecessor_artifact_manifest_hash
      || value.predecessor_full_flat_transition_hash !== release.transition_hash
      || value.predecessor_full_flat_time !== release.event_time || value.reallocation_cycle !== 2
      || value.opening_available_cash !== release.opening_cash
      || value.cycle_2_allocation_result_hash !== allocationResult.result_hash
      || value.cycle_2_event_time !== plan.cycle_2_event_time
      || value.ending_available_cash !== allocationResult.ending_available_cash
      || value.ending_gross_exposure !== allocationResult.ending_gross_exposure
      || value.ending_net_exposure !== allocationResult.ending_net_exposure
      || value.ending_portfolio_risk !== allocationResult.ending_portfolio_risk
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS)
      || value.result_hash !== replayPortfolioReallocationResultHash(value)) fail("Result binding")
}

export function assertReplayPortfolioReallocationArtifactManifest(value: ReplayPortfolioReallocationArtifactManifest): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || value.files.length !== REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES.length
      || value.files.some((file, index) => file.role !== REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES[index]
        || !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || file.ref.trim() === "" || !/^[a-f0-9]{64}$/.test(file.sha256))
      || value.completeness.authoritative_result !== true
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES)
      || value.completeness.commit_marker !== "portfolio-reallocation-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at) || value.manifest_hash !== replayPortfolioReallocationArtifactManifestHash(value)) fail("Artifact Manifest")
  hashes([value.reallocation_result_hash, value.manifest_hash])
}

export function assertReplayPortfolioReallocationOutcome(value: ReplayPortfolioReallocationOutcome): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_REALLOCATION_OUTCOME_SCHEMA_VERSION) fail("Outcome schema")
  if (value.status === "completed") {
    if (!value.result || !value.allocation_result || !value.artifact_manifest || value.failure !== null
        || value.result.result_hash !== value.artifact_manifest.reallocation_result_hash) fail("completed Outcome")
    assertReplayPortfolioReallocationArtifactManifest(value.artifact_manifest)
  } else if (value.result !== null || value.allocation_result !== null || value.artifact_manifest !== null
      || !value.failure || value.idempotent_replay || value.failure.partial_result_published !== false) fail("failed Outcome")
  if (value.outcome_hash !== replayPortfolioReallocationOutcomeHash(value)) fail("Outcome hash")
}

function hashes(values: string[]): void { if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash") }
function utc(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) }
function fail(message: string): never { throw new Error(`Replay Portfolio Reallocation ${message}`) }
