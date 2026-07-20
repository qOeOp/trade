import {
  assertReplayIntegratedPortfolioArtifactManifest,
  buildReplayIntegratedPortfolioStateChain,
  replayIntegratedPortfolioResultHash,
  replayIntegratedPortfolioTransitionHash,
  type ReplayIntegratedPortfolioOutcome,
  type ReplayIntegratedPortfolioStateTransition,
} from "./replay-integrated-portfolio-contracts"
import {
  assertReplayPortfolioAllocationResult,
  type ReplayPortfolioAllocationAuthorityBinding,
  type ReplayPortfolioAllocationPlan,
} from "./replay-portfolio-allocation-contracts"
import {
  assertReplayPortfolioReallocationArtifactManifest,
  assertReplayPortfolioReallocationOutcome,
  replayPortfolioReallocationResultHash,
  type ReplayPortfolioReallocationOutcome,
} from "./replay-portfolio-reallocation-contracts"
import { canonicalHash } from "./replay-contracts"
import {
  assertReplayRuntimeSharedWalletRiskPlan,
  assertReplayRuntimeSharedWalletRiskResult,
  type ReplayRuntimeSharedWalletRiskPlan,
  type ReplayRuntimeSharedWalletRiskResult,
} from "./replay-runtime-shared-wallet-risk-contracts"
import type { ReplayRuntimeSharedWalletAuthorityBinding } from "./replay-runtime-shared-wallet-contracts"

export const REPLAY_TWO_CYCLE_PORTFOLIO_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-two-cycle-portfolio-plan.v1" as const
export const REPLAY_TWO_CYCLE_PORTFOLIO_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-two-cycle-portfolio-result.v1" as const
export const REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-two-cycle-portfolio-artifact-manifest.v1" as const
export const REPLAY_TWO_CYCLE_PORTFOLIO_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-two-cycle-portfolio-outcome.v1" as const

export const REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS = [
  "exactly_two_allocation_cycles_with_cycle_two_exact_risk_lifecycle",
  "cycle_one_full_flat_release_strictly_precedes_cycle_two_allocation",
  "no_cycle_three_partial_cross_margin_borrow_real_liquidity_or_fast",
] as const

export interface ReplayTwoCyclePortfolioPlan {
  schema_version: typeof REPLAY_TWO_CYCLE_PORTFOLIO_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "cycle_one_integrated_then_cycle_two_allocation_exact_risk_v1"
  cycle_1_integrated_result_hash: string
  cycle_1_artifact_manifest_hash: string
  cycle_2_reallocation_result_hash: string
  cycle_2_reallocation_manifest_hash: string
  cycle_2_allocation_plan_hash: string
  cycle_2_allocation_result_hash: string
  cycle_2_risk_plan_hash: string
  cycle_2_risk_reservation_hash: string
  cash_bridge_policy: "cycle_1_ending_available_equals_cycle_2_shared_initial_cash"
  state_chain_policy: "cycle_1_chain_then_cycle_2_chain_with_strict_time_and_wallet_bridge"
  artifact_policy: "two_cycle_payloads_then_manifest_last"
  failure_policy: "any_stage_failure_no_two_cycle_result_or_artifact"
  limitations: typeof REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS
  plan_hash: string
}

export interface ReplayTwoCyclePortfolioStateTransition {
  transition_hash: string
  global_transition_sequence: number
  cycle: 1 | 2
  cycle_transition: ReplayIntegratedPortfolioStateTransition
}

export interface ReplayTwoCyclePortfolioResult {
  schema_version: typeof REPLAY_TWO_CYCLE_PORTFOLIO_RESULT_SCHEMA_VERSION
  portfolio_id: string
  two_cycle_plan_hash: string
  cycle_1_integrated_result_hash: string
  cycle_2_reallocation_result_hash: string
  cycle_2_risk_result_hash: string
  cycle_1_ending_available_cash: number
  cycle_2_opening_available_cash: number
  state_chain: ReplayTwoCyclePortfolioStateTransition[]
  state_chain_hash: string
  ending_available_cash: number
  ending_gross_exposure: number
  ending_net_exposure: number
  ending_portfolio_risk: number
  limitations: typeof REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS
  result_hash: string
}

export interface ReplayTwoCyclePortfolioFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  two_cycle_plan_hash: string
  cycle_1_integrated_result_hash: string
  cycle_1_artifact_manifest_hash: string
  cycle_2_reallocation_result_hash: string
  cycle_2_reallocation_manifest_hash: string
  cycle_2_allocation_plan_hash: string
  cycle_2_allocation_result_hash: string
  cycle_2_risk_plan_hash: string
  cycle_2_risk_reservation_hash: string
  cycle_2_risk_result_hash: string
  cycle_2_portfolio_evidence_hash: string
  state_chain_hash: string
  two_cycle_result_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export const REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES = [
  "two_cycle_plan", "cycle_1_integrated_result", "cycle_1_artifact_manifest",
  "cycle_2_reallocation_result", "cycle_2_reallocation_manifest", "cycle_2_allocation_plan",
  "cycle_2_allocation_result", "cycle_2_risk_plan", "cycle_2_risk_reservation",
  "cycle_2_risk_result", "cycle_2_portfolio_evidence", "two_cycle_state_chain",
  "two_cycle_fingerprint", "two_cycle_result",
] as const
export type ReplayTwoCyclePortfolioArtifactRole = typeof REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES[number]

export interface ReplayTwoCyclePortfolioArtifactManifest {
  schema_version: typeof REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  two_cycle_result_hash: string
  fingerprint_hash: string
  files: Array<{ role: ReplayTwoCyclePortfolioArtifactRole; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES
    commit_marker: "two-cycle-portfolio-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayTwoCyclePortfolioOutcome {
  schema_version: typeof REPLAY_TWO_CYCLE_PORTFOLIO_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  two_cycle_plan_hash: string
  status: "completed" | "failed"
  result: ReplayTwoCyclePortfolioResult | null
  cycle_2_risk_result: ReplayRuntimeSharedWalletRiskResult | null
  artifact_manifest: ReplayTwoCyclePortfolioArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "two-cycle-input-invalid" | "cycle-2-risk-failed" | "two-cycle-artifact-failed"
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayTwoCyclePortfolioPlanHash(value: ReplayTwoCyclePortfolioPlan | Omit<ReplayTwoCyclePortfolioPlan, "plan_hash">): string {
  const { plan_hash: _hash, ...body } = value as ReplayTwoCyclePortfolioPlan
  return canonicalHash(body)
}
export function replayTwoCyclePortfolioTransitionHash(value: ReplayTwoCyclePortfolioStateTransition | Omit<ReplayTwoCyclePortfolioStateTransition, "transition_hash">): string {
  const { transition_hash: _hash, ...body } = value as ReplayTwoCyclePortfolioStateTransition
  return canonicalHash(body)
}
export function replayTwoCyclePortfolioResultHash(value: ReplayTwoCyclePortfolioResult | Omit<ReplayTwoCyclePortfolioResult, "result_hash">): string {
  const { result_hash: _hash, ...body } = value as ReplayTwoCyclePortfolioResult
  return canonicalHash(body)
}
export function replayTwoCyclePortfolioFingerprintHash(value: ReplayTwoCyclePortfolioFingerprint | Omit<ReplayTwoCyclePortfolioFingerprint, "fingerprint_hash">): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayTwoCyclePortfolioFingerprint
  return canonicalHash(body)
}
export function replayTwoCyclePortfolioArtifactManifestHash(value: ReplayTwoCyclePortfolioArtifactManifest | Omit<ReplayTwoCyclePortfolioArtifactManifest, "manifest_hash">): string {
  const { manifest_hash: _hash, ...body } = value as ReplayTwoCyclePortfolioArtifactManifest
  return canonicalHash(body)
}
export function replayTwoCyclePortfolioOutcomeHash(value: ReplayTwoCyclePortfolioOutcome | Omit<ReplayTwoCyclePortfolioOutcome, "outcome_hash">): string {
  const { outcome_hash: _hash, ...body } = value as ReplayTwoCyclePortfolioOutcome
  return canonicalHash(body)
}

export function assertReplayTwoCyclePortfolioPlan(value: ReplayTwoCyclePortfolioPlan): void {
  if (value.schema_version !== REPLAY_TWO_CYCLE_PORTFOLIO_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "cycle_one_integrated_then_cycle_two_allocation_exact_risk_v1"
      || value.cash_bridge_policy !== "cycle_1_ending_available_equals_cycle_2_shared_initial_cash"
      || value.state_chain_policy !== "cycle_1_chain_then_cycle_2_chain_with_strict_time_and_wallet_bridge"
      || value.artifact_policy !== "two_cycle_payloads_then_manifest_last"
      || value.failure_policy !== "any_stage_failure_no_two_cycle_result_or_artifact"
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS)
      || value.plan_hash !== replayTwoCyclePortfolioPlanHash(value)) fail("Plan policy/hash")
  hashes([value.cycle_1_integrated_result_hash, value.cycle_1_artifact_manifest_hash,
    value.cycle_2_reallocation_result_hash, value.cycle_2_reallocation_manifest_hash,
    value.cycle_2_allocation_plan_hash, value.cycle_2_allocation_result_hash, value.cycle_2_risk_plan_hash,
    value.cycle_2_risk_reservation_hash, value.plan_hash])
}

export function createReplayTwoCyclePortfolioResult(input: {
  plan: ReplayTwoCyclePortfolioPlan
  cycle_1: ReplayIntegratedPortfolioOutcome
  cycle_2_reallocation: ReplayPortfolioReallocationOutcome
  cycle_2_allocation_plan: ReplayPortfolioAllocationPlan
  cycle_2_risk_plan: ReplayRuntimeSharedWalletRiskPlan
  cycle_2_risk_authority: ReplayRuntimeSharedWalletAuthorityBinding
  cycle_2_allocation_authority: ReplayPortfolioAllocationAuthorityBinding
  cycle_2_risk_result: ReplayRuntimeSharedWalletRiskResult
}): ReplayTwoCyclePortfolioResult {
  const { cycle1, cycle2 } = validateChildren(input)
  const stateChain = [...cycle1.state_chain.map((transition, index) => wrapTransition(1, index + 1, transition)),
    ...cycle2.map((transition, index) => wrapTransition(2, cycle1.state_chain.length + index + 1, transition))]
  const last = cycle2.at(-1)
  const body: Omit<ReplayTwoCyclePortfolioResult, "result_hash"> = {
    schema_version: REPLAY_TWO_CYCLE_PORTFOLIO_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    two_cycle_plan_hash: input.plan.plan_hash,
    cycle_1_integrated_result_hash: cycle1.result_hash,
    cycle_2_reallocation_result_hash: input.cycle_2_reallocation.result!.result_hash,
    cycle_2_risk_result_hash: input.cycle_2_risk_result.result_hash,
    cycle_1_ending_available_cash: cycle1.ending_available_cash,
    cycle_2_opening_available_cash: input.cycle_2_risk_result.shared_initial_cash,
    state_chain: stateChain,
    state_chain_hash: canonicalHash(stateChain),
    ending_available_cash: input.cycle_2_risk_result.ending_available_cash,
    ending_gross_exposure: last?.gross_exposure_after ?? 0,
    ending_net_exposure: last?.net_exposure_after ?? 0,
    ending_portfolio_risk: last?.portfolio_risk_after ?? 0,
    limitations: REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS,
  }
  const result = { ...body, result_hash: replayTwoCyclePortfolioResultHash(body as ReplayTwoCyclePortfolioResult) }
  assertReplayTwoCyclePortfolioResult(result, input)
  return result
}

export function assertReplayTwoCyclePortfolioResult(
  value: ReplayTwoCyclePortfolioResult,
  input: Parameters<typeof createReplayTwoCyclePortfolioResult>[0],
): void {
  const { cycle1, cycle2 } = validateChildren(input)
  const expected = [...cycle1.state_chain.map((transition, index) => wrapTransition(1, index + 1, transition)),
    ...cycle2.map((transition, index) => wrapTransition(2, cycle1.state_chain.length + index + 1, transition))]
  const last = cycle2.at(-1)
  if (value.schema_version !== REPLAY_TWO_CYCLE_PORTFOLIO_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== input.plan.portfolio_id || value.two_cycle_plan_hash !== input.plan.plan_hash
      || value.cycle_1_integrated_result_hash !== cycle1.result_hash
      || value.cycle_2_reallocation_result_hash !== input.cycle_2_reallocation.result!.result_hash
      || value.cycle_2_risk_result_hash !== input.cycle_2_risk_result.result_hash
      || value.cycle_1_ending_available_cash !== cycle1.ending_available_cash
      || value.cycle_2_opening_available_cash !== input.cycle_2_risk_result.shared_initial_cash
      || JSON.stringify(value.state_chain) !== JSON.stringify(expected)
      || value.state_chain_hash !== canonicalHash(expected)
      || value.ending_available_cash !== input.cycle_2_risk_result.ending_available_cash
      || value.ending_gross_exposure !== (last?.gross_exposure_after ?? 0)
      || value.ending_net_exposure !== (last?.net_exposure_after ?? 0)
      || value.ending_portfolio_risk !== (last?.portfolio_risk_after ?? 0)
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS)
      || value.result_hash !== replayTwoCyclePortfolioResultHash(value)) fail("Result binding/conservation")
}

function validateChildren(input: Parameters<typeof createReplayTwoCyclePortfolioResult>[0]): {
  cycle1: NonNullable<ReplayIntegratedPortfolioOutcome["result"]>
  cycle2: ReplayIntegratedPortfolioStateTransition[]
} {
  assertReplayTwoCyclePortfolioPlan(input.plan)
  const cycle1 = input.cycle_1.result
  const cycle1Manifest = input.cycle_1.artifact?.artifact_manifest
  const reallocation = input.cycle_2_reallocation.result
  const reallocationManifest = input.cycle_2_reallocation.artifact_manifest
  const allocation = input.cycle_2_reallocation.allocation_result
  if (input.cycle_1.status !== "completed" || !cycle1 || !cycle1Manifest
      || input.cycle_2_reallocation.status !== "completed" || !reallocation || !reallocationManifest || !allocation) {
    fail("child evidence completeness")
  }
  assertReplayIntegratedPortfolioArtifactManifest(cycle1Manifest)
  assertReplayPortfolioReallocationOutcome(input.cycle_2_reallocation)
  assertReplayPortfolioReallocationArtifactManifest(reallocationManifest)
  assertReplayRuntimeSharedWalletRiskPlan(input.cycle_2_risk_plan)
  assertReplayPortfolioAllocationResult(allocation, input.cycle_2_allocation_plan,
    input.cycle_2_allocation_authority)
  assertReplayRuntimeSharedWalletRiskResult(input.cycle_2_risk_result, input.cycle_2_risk_plan,
    input.cycle_2_risk_authority, allocation)
  if (cycle1.result_hash !== replayIntegratedPortfolioResultHash(cycle1)
      || reallocation.result_hash !== replayPortfolioReallocationResultHash(reallocation)
      || input.plan.portfolio_id !== cycle1.portfolio_id || input.plan.portfolio_id !== reallocation.portfolio_id
      || input.plan.cycle_1_integrated_result_hash !== cycle1.result_hash
      || input.plan.cycle_1_artifact_manifest_hash !== cycle1Manifest.manifest_hash
      || input.plan.cycle_2_reallocation_result_hash !== reallocation.result_hash
      || input.plan.cycle_2_reallocation_manifest_hash !== reallocationManifest.manifest_hash
      || input.plan.cycle_2_allocation_plan_hash !== input.cycle_2_allocation_plan.plan_hash
      || input.plan.cycle_2_allocation_result_hash !== allocation.result_hash
      || input.plan.cycle_2_risk_plan_hash !== input.cycle_2_risk_plan.plan_hash
      || input.plan.cycle_2_risk_reservation_hash !== input.cycle_2_risk_authority.reservation_hash
      || cycle1.ending_gross_exposure !== 0 || cycle1.ending_net_exposure !== 0
      || cycle1.ending_portfolio_risk !== 0 || cycle1.ending_available_cash !== reallocation.opening_available_cash
      || cycle1.ending_available_cash !== allocation.shared_initial_cash
      || cycle1.ending_available_cash !== input.cycle_2_risk_authority.shared_initial_cash
      || allocation.result_hash !== reallocation.cycle_2_allocation_result_hash) fail("child authority/cash closure")
  const cycle2 = buildReplayIntegratedPortfolioStateChain(allocation, input.cycle_2_risk_result)
  const releaseTime = reallocation.predecessor_full_flat_time
  if (cycle2.length === 0 || cycle2.some((transition) =>
    transition.transition_hash !== replayIntegratedPortfolioTransitionHash(transition))
      || Date.parse(cycle2[0]!.event_time) <= Date.parse(releaseTime)
      || cycle2[0]!.wallet_before.available_cash !== cycle1.ending_available_cash
      || cycle2[0]!.wallet_before.reserved_isolated_collateral !== 0
      || cycle2[0]!.wallet_before.settled_cash !== cycle1.ending_available_cash) fail("cycle boundary")
  return { cycle1, cycle2 }
}

function wrapTransition(cycle: 1 | 2, sequence: number, transition: ReplayIntegratedPortfolioStateTransition): ReplayTwoCyclePortfolioStateTransition {
  const body: Omit<ReplayTwoCyclePortfolioStateTransition, "transition_hash"> = {
    global_transition_sequence: sequence, cycle, cycle_transition: transition,
  }
  return { ...body, transition_hash: replayTwoCyclePortfolioTransitionHash(body as ReplayTwoCyclePortfolioStateTransition) }
}

export function assertReplayTwoCyclePortfolioArtifactManifest(value: ReplayTwoCyclePortfolioArtifactManifest): void {
  if (value.schema_version !== REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || value.files.length !== REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES.length
      || value.files.some((file, index) => file.role !== REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES[index]
        || !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || file.ref.trim() === "" || !/^[a-f0-9]{64}$/.test(file.sha256))
      || value.completeness.authoritative_result !== true
      || JSON.stringify(value.completeness.required_roles) !== JSON.stringify(REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES)
      || value.completeness.commit_marker !== "two-cycle-portfolio-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at) || value.manifest_hash !== replayTwoCyclePortfolioArtifactManifestHash(value)) fail("Artifact Manifest")
  hashes([value.two_cycle_result_hash, value.fingerprint_hash, value.manifest_hash])
}

export function assertReplayTwoCyclePortfolioOutcome(value: ReplayTwoCyclePortfolioOutcome): void {
  if (value.schema_version !== REPLAY_TWO_CYCLE_PORTFOLIO_OUTCOME_SCHEMA_VERSION) fail("Outcome schema")
  if (value.status === "completed") {
    if (!value.result || !value.cycle_2_risk_result || !value.artifact_manifest || value.failure !== null
        || value.result.result_hash !== value.artifact_manifest.two_cycle_result_hash) fail("completed Outcome")
    assertReplayTwoCyclePortfolioArtifactManifest(value.artifact_manifest)
  } else if (value.result !== null || value.cycle_2_risk_result !== null || value.artifact_manifest !== null
      || !value.failure || value.idempotent_replay || value.failure.partial_result_published !== false) fail("failed Outcome")
  if (value.outcome_hash !== replayTwoCyclePortfolioOutcomeHash(value)) fail("Outcome hash")
}

function hashes(values: string[]): void { if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash") }
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function fail(message: string): never { throw new Error(`Replay Two-Cycle Portfolio ${message}`) }
