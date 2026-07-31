import { canonicalHash } from "./replay-contracts"
import { addReplayDecimalValues } from "./replay-decimal"
import {
  assertReplayPortfolioAllocationPlan,
  type ReplayPortfolioAllocationPlan,
  type ReplayPortfolioAllocationResult,
} from "./replay-portfolio-allocation-contracts"
import {
  assertReplayRuntimeSharedWalletRiskPlan,
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskPlan,
  type ReplayRuntimeSharedWalletRiskResult,
} from "./replay-runtime-shared-wallet-risk-contracts"
import type { ReplayRuntimeSharedWalletSnapshot } from "./replay-runtime-shared-wallet-contracts"

export const REPLAY_INTEGRATED_PORTFOLIO_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-integrated-portfolio-plan.v1" as const
export const REPLAY_INTEGRATED_PORTFOLIO_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-integrated-portfolio-result.v1" as const
export const REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-integrated-portfolio-artifact-manifest.v1" as const
export const REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-integrated-portfolio-artifact-outcome.v1" as const
export const REPLAY_INTEGRATED_PORTFOLIO_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-integrated-portfolio-outcome.v1" as const

export const REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS = [
  "one_simultaneous_initial_entry_allocation_cycle_then_lifecycle_no_reentry",
  "fixed_entry_notional_and_frozen_stop_risk_release_on_full_close_only",
  "isolated_margin_no_cross_margin_partial_fill_liquidation_borrow_or_fast",
] as const

export interface ReplayIntegratedPortfolioPlan {
  schema_version: typeof REPLAY_INTEGRATED_PORTFOLIO_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "initial_allocation_then_exact_risk_lifecycle_artifact_v1"
  allocation_plan_hash: string
  allocation_reservation_hash: string
  risk_plan_hash: string
  risk_reservation_hash: string
  initial_allocation_time: string
  lane_set_hash: string
  event_ordering_policy:
    "pre_entry_funding_risk_then_allocation_phase_19_then_entry_phase_20_then_lifecycle"
  exposure_risk_state_policy: "fixed_entry_notional_and_frozen_stop_risk_released_on_full_close"
  artifact_policy: "integrated_evidence_payloads_then_manifest_last"
  failure_policy: "any_stage_failure_no_integrated_result_or_artifact"
  limitations: typeof REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS
  plan_hash: string
}

export interface ReplayIntegratedPortfolioStateTransition {
  transition_hash: string
  transition_sequence: number
  queue_ordinal: number
  event_time: string
  event_role: "funding" | "risk_observation" | "liquidation" | "exit" | "entry"
  lane_id: string
  source_event_hash: string
  allocation_event_hash: string | null
  wallet_before: ReplayRuntimeSharedWalletSnapshot
  wallet_after: ReplayRuntimeSharedWalletSnapshot
  gross_exposure_before: number
  gross_exposure_after: number
  net_exposure_before: number
  net_exposure_after: number
  portfolio_risk_before: number
  portfolio_risk_after: number
}

export interface ReplayIntegratedPortfolioResult {
  schema_version: typeof REPLAY_INTEGRATED_PORTFOLIO_RESULT_SCHEMA_VERSION
  portfolio_id: string
  integrated_plan_hash: string
  allocation_reservation_hash: string
  allocation_result_hash: string
  risk_reservation_hash: string
  risk_result_hash: string
  state_chain: ReplayIntegratedPortfolioStateTransition[]
  state_chain_hash: string
  ending_available_cash: number
  ending_gross_exposure: number
  ending_net_exposure: number
  ending_portfolio_risk: number
  limitations: typeof REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS
  result_hash: string
}

export interface ReplayIntegratedPortfolioFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  integrated_plan_hash: string
  allocation_plan_hash: string
  allocation_reservation_hash: string
  allocation_result_hash: string
  risk_plan_hash: string
  risk_reservation_hash: string
  risk_result_hash: string
  portfolio_evidence_hash: string
  portfolio_evidence_fingerprint_hash: string
  integrated_result_hash: string
  state_chain_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export const REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES = [
  "integrated_plan", "allocation_reservation", "allocation_result", "risk_reservation", "risk_result",
  "portfolio_evidence", "integrated_state_chain", "integrated_fingerprint", "integrated_result",
] as const
export type ReplayIntegratedPortfolioArtifactRole = typeof REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES[number]

export interface ReplayIntegratedPortfolioArtifactManifest {
  schema_version: typeof REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  integrated_result_hash: string
  integrated_fingerprint_hash: string
  files: Array<{ role: ReplayIntegratedPortfolioArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES
    commit_marker: "integrated-portfolio-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayIntegratedPortfolioArtifactOutcome {
  schema_version: typeof REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  status: "committed" | "failed"
  idempotent_replay: boolean
  artifact_manifest: ReplayIntegratedPortfolioArtifactManifest | null
  failure: { code: "integrated-evidence-invalid" | "integrated-artifact-store-failed"; message: string; partial_result_published: false } | null
  outcome_hash: string
}

export interface ReplayIntegratedPortfolioOutcome {
  schema_version: typeof REPLAY_INTEGRATED_PORTFOLIO_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  integrated_plan_hash: string
  status: "completed" | "failed"
  result: ReplayIntegratedPortfolioResult | null
  risk_result: ReplayRuntimeSharedWalletRiskResult | null
  artifact: ReplayIntegratedPortfolioArtifactOutcome | null
  failure: {
    code: "integrated-input-invalid" | "allocation-failed" | "integrated-risk-failed" | "integrated-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayIntegratedPortfolioPlanHash(value: ReplayIntegratedPortfolioPlan | Omit<ReplayIntegratedPortfolioPlan, "plan_hash">): string {
  const { plan_hash: _hash, ...body } = value as ReplayIntegratedPortfolioPlan
  return canonicalHash(body)
}
export function replayIntegratedPortfolioTransitionHash(value: ReplayIntegratedPortfolioStateTransition | Omit<ReplayIntegratedPortfolioStateTransition, "transition_hash">): string {
  const { transition_hash: _hash, ...body } = value as ReplayIntegratedPortfolioStateTransition
  return canonicalHash(body)
}
export function replayIntegratedPortfolioResultHash(value: ReplayIntegratedPortfolioResult | Omit<ReplayIntegratedPortfolioResult, "result_hash">): string {
  const { result_hash: _hash, ...body } = value as ReplayIntegratedPortfolioResult
  return canonicalHash(body)
}
export function replayIntegratedPortfolioFingerprintHash(value: ReplayIntegratedPortfolioFingerprint | Omit<ReplayIntegratedPortfolioFingerprint, "fingerprint_hash">): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayIntegratedPortfolioFingerprint
  return canonicalHash(body)
}
export function replayIntegratedPortfolioArtifactManifestHash(value: ReplayIntegratedPortfolioArtifactManifest | Omit<ReplayIntegratedPortfolioArtifactManifest, "manifest_hash">): string {
  const { manifest_hash: _hash, ...body } = value as ReplayIntegratedPortfolioArtifactManifest
  return canonicalHash(body)
}
export function replayIntegratedPortfolioArtifactOutcomeHash(value: ReplayIntegratedPortfolioArtifactOutcome | Omit<ReplayIntegratedPortfolioArtifactOutcome, "outcome_hash">): string {
  const { outcome_hash: _hash, ...body } = value as ReplayIntegratedPortfolioArtifactOutcome
  return canonicalHash(body)
}
export function replayIntegratedPortfolioOutcomeHash(value: ReplayIntegratedPortfolioOutcome | Omit<ReplayIntegratedPortfolioOutcome, "outcome_hash">): string {
  const { outcome_hash: _hash, ...body } = value as ReplayIntegratedPortfolioOutcome
  return canonicalHash(body)
}

export function assertReplayIntegratedPortfolioPlan(
  value: ReplayIntegratedPortfolioPlan,
  allocationPlan?: ReplayPortfolioAllocationPlan,
  riskPlan?: ReplayRuntimeSharedWalletRiskPlan,
): void {
  if (value.schema_version !== REPLAY_INTEGRATED_PORTFOLIO_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "initial_allocation_then_exact_risk_lifecycle_artifact_v1"
      || value.event_ordering_policy !== "pre_entry_funding_risk_then_allocation_phase_19_then_entry_phase_20_then_lifecycle"
      || value.exposure_risk_state_policy !== "fixed_entry_notional_and_frozen_stop_risk_released_on_full_close"
      || value.artifact_policy !== "integrated_evidence_payloads_then_manifest_last"
      || value.failure_policy !== "any_stage_failure_no_integrated_result_or_artifact"
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS)
      || !utc(value.initial_allocation_time) || value.plan_hash !== replayIntegratedPortfolioPlanHash(value)) fail("Plan policy/hash")
  for (const hash of [value.allocation_plan_hash, value.allocation_reservation_hash, value.risk_plan_hash,
    value.risk_reservation_hash, value.lane_set_hash, value.plan_hash]) digest(hash, "Plan hash")
  if (!allocationPlan || !riskPlan) return
  assertReplayPortfolioAllocationPlan(allocationPlan)
  assertReplayRuntimeSharedWalletRiskPlan(riskPlan)
  const allocationLanes = allocationPlan.lanes.map((lane) => ({
    lane_id: lane.lane_id, symbol: lane.symbol, run_id: lane.run_id, request_hash: lane.request_hash,
    trial_reservation_hash: lane.trial_reservation_hash, attempt_lease_hash: lane.attempt_lease_hash,
  }))
  const riskLanes = riskPlan.lanes.map((lane) => ({
    lane_id: lane.lane_id, symbol: lane.symbol, run_id: lane.run_id, request_hash: lane.request_hash,
    trial_reservation_hash: lane.trial_reservation_hash, attempt_lease_hash: lane.attempt_lease_hash,
  }))
  if (value.portfolio_id !== allocationPlan.portfolio_id || value.portfolio_id !== riskPlan.portfolio_id
      || value.allocation_plan_hash !== allocationPlan.plan_hash || value.risk_plan_hash !== riskPlan.plan_hash
      || new Set(allocationPlan.lanes.map((lane) => lane.earliest_executable_time)).size !== 1
      || allocationPlan.lanes[0]?.earliest_executable_time !== value.initial_allocation_time
      || canonicalHash(allocationLanes) !== value.lane_set_hash
      || canonicalHash(allocationLanes) !== canonicalHash(riskLanes)) fail("Plan child closure")
}

export function createReplayIntegratedPortfolioResult(input: {
  plan: ReplayIntegratedPortfolioPlan
  allocation_result: ReplayPortfolioAllocationResult
  risk_result: ReplayRuntimeSharedWalletRiskResult
}): ReplayIntegratedPortfolioResult {
  const stateChain = buildReplayIntegratedPortfolioStateChain(input.allocation_result, input.risk_result)
  const last = stateChain.at(-1)
  const body: Omit<ReplayIntegratedPortfolioResult, "result_hash"> = {
    schema_version: REPLAY_INTEGRATED_PORTFOLIO_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    integrated_plan_hash: input.plan.plan_hash,
    allocation_reservation_hash: input.allocation_result.portfolio_allocation_reservation_hash,
    allocation_result_hash: input.allocation_result.result_hash,
    risk_reservation_hash: input.risk_result.risk_reservation_hash,
    risk_result_hash: input.risk_result.result_hash,
    state_chain: stateChain,
    state_chain_hash: canonicalHash(stateChain),
    ending_available_cash: input.risk_result.ending_available_cash,
    ending_gross_exposure: last?.gross_exposure_after ?? 0,
    ending_net_exposure: last?.net_exposure_after ?? 0,
    ending_portfolio_risk: last?.portfolio_risk_after ?? 0,
    limitations: REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS,
  }
  const result = { ...body, result_hash: replayIntegratedPortfolioResultHash(body as ReplayIntegratedPortfolioResult) }
  assertReplayIntegratedPortfolioResult(result, input.plan, input.allocation_result, input.risk_result)
  return result
}

export function assertReplayIntegratedPortfolioResult(
  value: ReplayIntegratedPortfolioResult,
  plan: ReplayIntegratedPortfolioPlan,
  allocationResult: ReplayPortfolioAllocationResult,
  riskResult: ReplayRuntimeSharedWalletRiskResult,
): void {
  const expected = buildReplayIntegratedPortfolioStateChain(allocationResult, riskResult)
  const last = expected.at(-1)
  if (value.schema_version !== REPLAY_INTEGRATED_PORTFOLIO_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== plan.portfolio_id || value.integrated_plan_hash !== plan.plan_hash
      || value.allocation_reservation_hash !== plan.allocation_reservation_hash
      || value.allocation_result_hash !== allocationResult.result_hash
      || value.risk_reservation_hash !== plan.risk_reservation_hash
      || value.risk_result_hash !== riskResult.result_hash
      || riskResult.result_hash !== replayRuntimeSharedWalletRiskResultHash(riskResult)
      || canonicalHash(value.state_chain) !== canonicalHash(expected)
      || value.state_chain_hash !== canonicalHash(expected)
      || value.ending_available_cash !== riskResult.ending_available_cash
      || value.ending_gross_exposure !== (last?.gross_exposure_after ?? 0)
      || value.ending_net_exposure !== (last?.net_exposure_after ?? 0)
      || value.ending_portfolio_risk !== (last?.portfolio_risk_after ?? 0)
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS)
      || value.result_hash !== replayIntegratedPortfolioResultHash(value)) fail("Result binding/conservation")
}

export function assertReplayIntegratedPortfolioArtifactManifest(
  value: ReplayIntegratedPortfolioArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || value.files.length !== REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES.length
      || value.files.some((file, index) => file.role !== REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES[index]
        || !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || file.ref.trim() === "" || !/^[a-f0-9]{64}$/.test(file.sha256))
      || value.completeness.authoritative_result !== true
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_ROLES)
      || value.completeness.commit_marker !== "integrated-portfolio-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at) || value.manifest_hash !== replayIntegratedPortfolioArtifactManifestHash(value)) {
    fail("Artifact Manifest")
  }
  for (const hash of [value.integrated_result_hash, value.integrated_fingerprint_hash, value.manifest_hash]) {
    digest(hash, "Artifact Manifest hash")
  }
}

export function assertReplayIntegratedPortfolioArtifactOutcome(
  value: ReplayIntegratedPortfolioArtifactOutcome,
): void {
  if (value.schema_version !== REPLAY_INTEGRATED_PORTFOLIO_ARTIFACT_OUTCOME_SCHEMA_VERSION) fail("Artifact Outcome schema")
  if (value.status === "committed") {
    if (!value.artifact_manifest || value.failure !== null) fail("committed Artifact Outcome")
    assertReplayIntegratedPortfolioArtifactManifest(value.artifact_manifest)
  } else if (value.artifact_manifest !== null || !value.failure || value.idempotent_replay
      || value.failure.partial_result_published !== false) fail("failed Artifact Outcome")
  if (value.outcome_hash !== replayIntegratedPortfolioArtifactOutcomeHash(value)) fail("Artifact Outcome hash")
}

export function assertReplayIntegratedPortfolioOutcome(value: ReplayIntegratedPortfolioOutcome): void {
  if (value.schema_version !== REPLAY_INTEGRATED_PORTFOLIO_OUTCOME_SCHEMA_VERSION) fail("Outcome schema")
  if (value.status === "completed") {
    if (!value.result || !value.risk_result || !value.artifact || value.artifact.status !== "committed"
        || value.failure !== null || value.result.result_hash !== value.artifact.artifact_manifest?.integrated_result_hash) {
      fail("completed Outcome")
    }
    assertReplayIntegratedPortfolioArtifactOutcome(value.artifact)
  } else if (value.result !== null || value.risk_result !== null || value.artifact !== null || !value.failure
      || value.failure.partial_result_published !== false) fail("failed Outcome")
  if (value.outcome_hash !== replayIntegratedPortfolioOutcomeHash(value)) fail("Outcome hash")
}

export function buildReplayIntegratedPortfolioStateChain(
  allocation: ReplayPortfolioAllocationResult,
  risk: ReplayRuntimeSharedWalletRiskResult,
): ReplayIntegratedPortfolioStateTransition[] {
  const allocationEvent = new Map(allocation.global_source_event_queue.map((event) => [`${event.lane_id}\u0000${event.event_time}`, event]))
  const decisions = new Map(allocation.allocation_cycles.flatMap((cycle) => cycle.decisions.map((decision) => [decision.decision_hash, decision] as const)))
  const positions = new Map(allocation.open_positions.map((position) => [position.lane_id, position]))
  let gross = 0
  let net = 0
  let portfolioRisk = 0
  const closed = new Set<string>()
  return risk.global_source_event_queue.map((event, index) => {
    const beforeGross = gross
    const beforeNet = net
    const beforeRisk = portfolioRisk
    let sourceAllocationHash: string | null = null
    if (event.event_role === "entry") {
      const source = allocationEvent.get(`${event.lane_id}\u0000${event.event_time}`)
      if (!source) fail("state chain entry Allocation source")
      const decision = decisions.get(source.allocation_decision_hash)
      if (!decision) fail("state chain decision source")
      gross = decision.allocated_gross_exposure_after
      net = decision.allocated_net_exposure_after
      portfolioRisk = decision.allocated_portfolio_risk_after
      sourceAllocationHash = source.event_hash
    } else if ((event.event_role === "exit" && event.outcome === "filled") || event.event_role === "liquidation") {
      const position = positions.get(event.lane_id)
      if (!position || closed.has(event.lane_id)) fail("state chain close source")
      gross = addReplayDecimalValues(gross, -position.entry_notional)
      net = addReplayDecimalValues(net, position.side === "long" ? -position.entry_notional : position.entry_notional)
      portfolioRisk = addReplayDecimalValues(portfolioRisk, -position.requested_risk_amount)
      closed.add(event.lane_id)
    }
    const body: Omit<ReplayIntegratedPortfolioStateTransition, "transition_hash"> = {
      transition_sequence: index + 1,
      queue_ordinal: event.queue_ordinal,
      event_time: event.event_time,
      event_role: event.event_role,
      lane_id: event.lane_id,
      source_event_hash: event.event_hash,
      allocation_event_hash: sourceAllocationHash,
      wallet_before: event.wallet_before,
      wallet_after: event.wallet_after,
      gross_exposure_before: beforeGross,
      gross_exposure_after: gross,
      net_exposure_before: beforeNet,
      net_exposure_after: net,
      portfolio_risk_before: beforeRisk,
      portfolio_risk_after: portfolioRisk,
    }
    return { ...body, transition_hash: replayIntegratedPortfolioTransitionHash(body as ReplayIntegratedPortfolioStateTransition) }
  })
}

function digest(value: string, name: string): void { if (!/^[a-f0-9]{64}$/.test(value)) fail(name) }
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function fail(name: string): never { throw new Error(`integrated Portfolio ${name} is invalid`) }
