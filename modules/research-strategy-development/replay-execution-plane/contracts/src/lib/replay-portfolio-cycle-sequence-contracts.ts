import { canonicalHash } from "./replay-contracts"
import {
  assertReplayIntegratedPortfolioPlan,
  assertReplayIntegratedPortfolioResult,
  replayIntegratedPortfolioTransitionHash,
  type ReplayIntegratedPortfolioPlan,
  type ReplayIntegratedPortfolioResult,
  type ReplayIntegratedPortfolioStateTransition,
} from "./replay-integrated-portfolio-contracts"
import {
  assertReplayPortfolioAllocationResult,
  type ReplayPortfolioAllocationAuthorityBinding,
  type ReplayPortfolioAllocationPlan,
  type ReplayPortfolioAllocationResult,
} from "./replay-portfolio-allocation-contracts"
import {
  assertReplayRuntimeSharedWalletPortfolioEvidence,
  type ReplayRuntimeSharedWalletPortfolioEvidence,
} from "./replay-runtime-shared-wallet-artifact-contracts"
import {
  assertReplayRuntimeSharedWalletRiskResult,
  type ReplayRuntimeSharedWalletRiskPlan,
  type ReplayRuntimeSharedWalletRiskResult,
} from "./replay-runtime-shared-wallet-risk-contracts"
import type { ReplayRuntimeSharedWalletAuthorityBinding } from "./replay-runtime-shared-wallet-contracts"

export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_PLAN_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-plan.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-result.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-artifact-manifest.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-outcome.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES = 8 as const

export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS = [
  "one_to_eight_predeclared_full_flat_exact_risk_cycles_only",
  "fixed_entry_notional_and_frozen_stop_risk_release_on_full_close_only",
  "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
] as const

export interface ReplayPortfolioCycleSequencePlan {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_PLAN_SCHEMA_VERSION
  portfolio_id: string
  execution_mode: "predeclared_bounded_full_flat_exact_risk_cycle_sequence_v1"
  sequence_reservation_hash: string
  initial_cash: number
  cycle_count: number
  max_cycle_count: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
  cycles: Array<{
    cycle_index: number
    integrated_plan_hash: string
    allocation_plan_hash: string
    risk_plan_hash: string
    earliest_cycle_time: string
    lane_set_hash: string
  }>
  cash_roll_forward_policy: "cycle_one_initial_then_predecessor_ending_available"
  successor_policy: "strictly_later_after_predecessor_full_flat_release"
  artifact_policy: "fixed_role_dynamic_cycle_payload_then_manifest_last"
  failure_policy: "any_cycle_or_artifact_failure_no_sequence_result_or_artifact"
  limitations: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS
  plan_hash: string
}

export interface ReplayPortfolioCycleSequenceExecutionInput {
  cycle_index: number
  integrated_plan: ReplayIntegratedPortfolioPlan
  allocation_plan: ReplayPortfolioAllocationPlan
  allocation_authority: ReplayPortfolioAllocationAuthorityBinding
  allocation_result: ReplayPortfolioAllocationResult
  risk_plan: ReplayRuntimeSharedWalletRiskPlan
  risk_authority: ReplayRuntimeSharedWalletAuthorityBinding
  risk_result: ReplayRuntimeSharedWalletRiskResult
  portfolio_evidence: ReplayRuntimeSharedWalletPortfolioEvidence
  integrated_result: ReplayIntegratedPortfolioResult
}

export interface ReplayPortfolioCycleSequenceRecord {
  record_hash: string
  cycle_index: number
  opening_available_cash: number
  integrated_plan_hash: string
  allocation_plan_hash: string
  allocation_result_hash: string
  risk_plan_hash: string
  risk_result_hash: string
  portfolio_evidence_hash: string
  integrated_result_hash: string
  state_chain_hash: string
  first_event_time: string
  full_flat_release_time: string
  ending_available_cash: number
}

export interface ReplayPortfolioCycleSequenceTransition {
  transition_hash: string
  global_transition_sequence: number
  cycle_index: number
  cycle_transition: ReplayIntegratedPortfolioStateTransition
}

export interface ReplayPortfolioCycleSequenceResult {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  sequence_reservation_hash: string
  cycle_count: number
  cycle_records: ReplayPortfolioCycleSequenceRecord[]
  cycle_records_hash: string
  state_chain: ReplayPortfolioCycleSequenceTransition[]
  state_chain_hash: string
  initial_cash: number
  ending_available_cash: number
  ending_gross_exposure: 0
  ending_net_exposure: 0
  ending_portfolio_risk: 0
  limitations: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS
  result_hash: string
}

export interface ReplayPortfolioCycleSequenceFingerprint {
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  sequence_reservation_hash: string
  sequence_plan_hash: string
  cycle_count: number
  cycle_records_hash: string
  state_chain_hash: string
  sequence_result_hash: string
  limitations_hash: string
  fingerprint_hash: string
}

export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES = [
  "cycle_sequence_plan", "cycle_sequence_reservation", "cycle_evidence",
  "cycle_sequence_state_chain", "cycle_sequence_fingerprint", "cycle_sequence_result",
] as const
export type ReplayPortfolioCycleSequenceArtifactRole =
  typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES[number]

export interface ReplayPortfolioCycleSequenceArtifactManifest {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
  artifact_id: string
  portfolio_id: string
  sequence_result_hash: string
  fingerprint_hash: string
  files: Array<{
    role: ReplayPortfolioCycleSequenceArtifactRole
    name: string
    ref: string
    sha256: string
  }>
  completeness: {
    authoritative_result: true
    required_roles: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES
    commit_marker: "portfolio-cycle-sequence-artifact-manifest.json"
    partial_payload_without_manifest_is_authoritative: false
  }
  authority_frozen_at: string
  manifest_hash: string
}

export interface ReplayPortfolioCycleSequenceOutcome {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION
  portfolio_id: string
  sequence_plan_hash: string
  status: "completed" | "failed"
  result: ReplayPortfolioCycleSequenceResult | null
  artifact_manifest: ReplayPortfolioCycleSequenceArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "cycle-sequence-input-invalid" | "cycle-allocation-failed" | "cycle-risk-failed"
      | "cycle-sequence-artifact-failed"
    cycle_index: number | null
    message: string
    partial_result_published: false
  } | null
  outcome_hash: string
}

export function replayPortfolioCycleSequencePlanHash(
  value: ReplayPortfolioCycleSequencePlan | Omit<ReplayPortfolioCycleSequencePlan, "plan_hash">,
): string {
  const { plan_hash: _hash, ...body } = value as ReplayPortfolioCycleSequencePlan
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceRecordHash(
  value: ReplayPortfolioCycleSequenceRecord | Omit<ReplayPortfolioCycleSequenceRecord, "record_hash">,
): string {
  const { record_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceRecord
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceTransitionHash(
  value: ReplayPortfolioCycleSequenceTransition | Omit<ReplayPortfolioCycleSequenceTransition, "transition_hash">,
): string {
  const { transition_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceTransition
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceResultHash(
  value: ReplayPortfolioCycleSequenceResult | Omit<ReplayPortfolioCycleSequenceResult, "result_hash">,
): string {
  const { result_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceResult
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceFingerprintHash(
  value: ReplayPortfolioCycleSequenceFingerprint | Omit<ReplayPortfolioCycleSequenceFingerprint, "fingerprint_hash">,
): string {
  const { fingerprint_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceFingerprint
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceArtifactManifestHash(
  value: ReplayPortfolioCycleSequenceArtifactManifest
    | Omit<ReplayPortfolioCycleSequenceArtifactManifest, "manifest_hash">,
): string {
  const { manifest_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceArtifactManifest
  return canonicalHash(body)
}

export function replayPortfolioCycleSequenceOutcomeHash(
  value: ReplayPortfolioCycleSequenceOutcome | Omit<ReplayPortfolioCycleSequenceOutcome, "outcome_hash">,
): string {
  const { outcome_hash: _hash, ...body } = value as ReplayPortfolioCycleSequenceOutcome
  return canonicalHash(body)
}

export function assertReplayPortfolioCycleSequencePlan(value: ReplayPortfolioCycleSequencePlan): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_PLAN_SCHEMA_VERSION
      || value.execution_mode !== "predeclared_bounded_full_flat_exact_risk_cycle_sequence_v1"
      || !Number.isFinite(value.initial_cash) || value.initial_cash <= 0
      || value.max_cycle_count !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.cash_roll_forward_policy !== "cycle_one_initial_then_predecessor_ending_available"
      || value.successor_policy !== "strictly_later_after_predecessor_full_flat_release"
      || value.artifact_policy !== "fixed_role_dynamic_cycle_payload_then_manifest_last"
      || value.failure_policy !== "any_cycle_or_artifact_failure_no_sequence_result_or_artifact"
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS)
      || !Number.isSafeInteger(value.cycle_count) || value.cycle_count < 1
      || value.cycle_count > REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.cycles.length !== value.cycle_count || value.plan_hash !== replayPortfolioCycleSequencePlanHash(value)) {
    fail("Plan policy/hash")
  }
  hashes([value.sequence_reservation_hash, value.plan_hash])
  let priorTime = Number.NEGATIVE_INFINITY
  value.cycles.forEach((cycle, index) => {
    hashes([cycle.integrated_plan_hash, cycle.allocation_plan_hash, cycle.risk_plan_hash, cycle.lane_set_hash])
    if (cycle.cycle_index !== index + 1 || !utc(cycle.earliest_cycle_time)
        || Date.parse(cycle.earliest_cycle_time) <= priorTime) fail("Plan cycle order")
    priorTime = Date.parse(cycle.earliest_cycle_time)
  })
}

export function createReplayPortfolioCycleSequenceResult(input: {
  plan: ReplayPortfolioCycleSequencePlan
  executions: ReplayPortfolioCycleSequenceExecutionInput[]
}): ReplayPortfolioCycleSequenceResult {
  const { records, chain } = validateExecutions(input)
  const last = records.at(-1)!
  const body: Omit<ReplayPortfolioCycleSequenceResult, "result_hash"> = {
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash,
    sequence_reservation_hash: input.plan.sequence_reservation_hash,
    cycle_count: records.length,
    cycle_records: records,
    cycle_records_hash: canonicalHash(records),
    state_chain: chain,
    state_chain_hash: canonicalHash(chain),
    initial_cash: records[0]!.opening_available_cash,
    ending_available_cash: last.ending_available_cash,
    ending_gross_exposure: 0,
    ending_net_exposure: 0,
    ending_portfolio_risk: 0,
    limitations: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS,
  }
  const result = { ...body,
    result_hash: replayPortfolioCycleSequenceResultHash(body as ReplayPortfolioCycleSequenceResult) }
  assertReplayPortfolioCycleSequenceResult(result, input)
  return result
}

export function assertReplayPortfolioCycleSequenceResult(
  value: ReplayPortfolioCycleSequenceResult,
  input: Parameters<typeof createReplayPortfolioCycleSequenceResult>[0],
): void {
  const { records, chain } = validateExecutions(input)
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESULT_SCHEMA_VERSION
      || value.portfolio_id !== input.plan.portfolio_id || value.sequence_plan_hash !== input.plan.plan_hash
      || value.sequence_reservation_hash !== input.plan.sequence_reservation_hash
      || value.cycle_count !== records.length || JSON.stringify(value.cycle_records) !== JSON.stringify(records)
      || value.cycle_records_hash !== canonicalHash(records) || JSON.stringify(value.state_chain) !== JSON.stringify(chain)
      || value.state_chain_hash !== canonicalHash(chain)
      || value.initial_cash !== records[0]!.opening_available_cash
      || value.ending_available_cash !== records.at(-1)!.ending_available_cash
      || value.ending_gross_exposure !== 0 || value.ending_net_exposure !== 0
      || value.ending_portfolio_risk !== 0
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS)
      || value.result_hash !== replayPortfolioCycleSequenceResultHash(value)) fail("Result binding/conservation")
}

function validateExecutions(input: Parameters<typeof createReplayPortfolioCycleSequenceResult>[0]): {
  records: ReplayPortfolioCycleSequenceRecord[]
  chain: ReplayPortfolioCycleSequenceTransition[]
} {
  assertReplayPortfolioCycleSequencePlan(input.plan)
  if (input.executions.length !== input.plan.cycle_count) fail("execution coverage")
  const records: ReplayPortfolioCycleSequenceRecord[] = []
  const chain: ReplayPortfolioCycleSequenceTransition[] = []
  let priorEndingCash: number | null = null
  let priorReleaseTime = Number.NEGATIVE_INFINITY
  for (const [offset, execution] of input.executions.entries()) {
    const cycleIndex = offset + 1
    const declared = input.plan.cycles[offset]!
    if (execution.cycle_index !== cycleIndex) fail("execution cycle index")
    assertReplayIntegratedPortfolioPlan(execution.integrated_plan, execution.allocation_plan, execution.risk_plan)
    assertReplayPortfolioAllocationResult(
      execution.allocation_result, execution.allocation_plan, execution.allocation_authority,
    )
    assertReplayRuntimeSharedWalletRiskResult(
      execution.risk_result, execution.risk_plan, execution.risk_authority, execution.allocation_result,
    )
    assertReplayIntegratedPortfolioResult(
      execution.integrated_result, execution.integrated_plan, execution.allocation_result, execution.risk_result,
    )
    assertReplayRuntimeSharedWalletPortfolioEvidence(execution.portfolio_evidence)
    const state = execution.integrated_result.state_chain
    const last = state.at(-1)
    if (execution.integrated_plan.portfolio_id !== input.plan.portfolio_id
        || declared.integrated_plan_hash !== execution.integrated_plan.plan_hash
        || declared.allocation_plan_hash !== execution.allocation_plan.plan_hash
        || declared.risk_plan_hash !== execution.risk_plan.plan_hash
        || declared.earliest_cycle_time !== execution.integrated_plan.initial_allocation_time
        || declared.lane_set_hash !== execution.integrated_plan.lane_set_hash
        || execution.integrated_plan.allocation_reservation_hash !== input.plan.sequence_reservation_hash
        || execution.integrated_plan.risk_reservation_hash !== input.plan.sequence_reservation_hash
        || execution.allocation_authority.reservation_hash !== input.plan.sequence_reservation_hash
        || execution.risk_authority.reservation_hash !== input.plan.sequence_reservation_hash
        || execution.allocation_authority.shared_initial_cash !== execution.risk_authority.shared_initial_cash
        || state.length === 0 || !last || state.some((transition) =>
          transition.transition_hash !== replayIntegratedPortfolioTransitionHash(transition))
        || execution.integrated_result.ending_gross_exposure !== 0
        || execution.integrated_result.ending_net_exposure !== 0
        || execution.integrated_result.ending_portfolio_risk !== 0
        || execution.risk_result.open_positions.length !== 0
        || execution.portfolio_evidence.portfolio_id !== input.plan.portfolio_id
        || execution.portfolio_evidence.portfolio_plan_hash !== execution.risk_plan.plan_hash
        || execution.portfolio_evidence.risk_reservation_hash !== input.plan.sequence_reservation_hash
        || execution.portfolio_evidence.risk_result_hash !== execution.risk_result.result_hash
        || last.gross_exposure_after !== 0 || last.net_exposure_after !== 0 || last.portfolio_risk_after !== 0) {
      fail("cycle child closure")
    }
    const firstTime = Date.parse(state[0]!.event_time)
    const releaseTime = Date.parse(last.event_time)
    if (firstTime <= priorReleaseTime || releaseTime < firstTime
        || (cycleIndex === 1 && execution.allocation_authority.shared_initial_cash !== input.plan.initial_cash)
        || (priorEndingCash !== null && (execution.allocation_authority.shared_initial_cash !== priorEndingCash
          || state[0]!.wallet_before.available_cash !== priorEndingCash
          || state[0]!.wallet_before.settled_cash !== priorEndingCash
          || state[0]!.wallet_before.reserved_isolated_collateral !== 0))) fail("cycle cash/time bridge")
    const recordBody: Omit<ReplayPortfolioCycleSequenceRecord, "record_hash"> = {
      cycle_index: cycleIndex,
      opening_available_cash: execution.risk_result.shared_initial_cash,
      integrated_plan_hash: execution.integrated_plan.plan_hash,
      allocation_plan_hash: execution.allocation_plan.plan_hash,
      allocation_result_hash: execution.allocation_result.result_hash,
      risk_plan_hash: execution.risk_plan.plan_hash,
      risk_result_hash: execution.risk_result.result_hash,
      portfolio_evidence_hash: execution.portfolio_evidence.evidence_hash,
      integrated_result_hash: execution.integrated_result.result_hash,
      state_chain_hash: execution.integrated_result.state_chain_hash,
      first_event_time: state[0]!.event_time,
      full_flat_release_time: last.event_time,
      ending_available_cash: execution.integrated_result.ending_available_cash,
    }
    records.push({ ...recordBody,
      record_hash: replayPortfolioCycleSequenceRecordHash(recordBody as ReplayPortfolioCycleSequenceRecord) })
    for (const transition of state) {
      const transitionBody: Omit<ReplayPortfolioCycleSequenceTransition, "transition_hash"> = {
        global_transition_sequence: chain.length + 1,
        cycle_index: cycleIndex,
        cycle_transition: transition,
      }
      chain.push({ ...transitionBody,
        transition_hash: replayPortfolioCycleSequenceTransitionHash(
          transitionBody as ReplayPortfolioCycleSequenceTransition,
        ) })
    }
    priorEndingCash = execution.integrated_result.ending_available_cash
    priorReleaseTime = releaseTime
  }
  return { records, chain }
}

export function assertReplayPortfolioCycleSequenceArtifactManifest(
  value: ReplayPortfolioCycleSequenceArtifactManifest,
): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION
      || value.files.length !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES.length
      || value.files.some((file, index) => file.role !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES[index]
        || !/^[a-z0-9][a-z0-9.-]*$/.test(file.name) || file.ref.trim() === ""
        || !/^[a-f0-9]{64}$/.test(file.sha256))
      || value.completeness.authoritative_result !== true
      || JSON.stringify(value.completeness.required_roles)
        !== JSON.stringify(REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ARTIFACT_ROLES)
      || value.completeness.commit_marker !== "portfolio-cycle-sequence-artifact-manifest.json"
      || value.completeness.partial_payload_without_manifest_is_authoritative !== false
      || !utc(value.authority_frozen_at)
      || value.manifest_hash !== replayPortfolioCycleSequenceArtifactManifestHash(value)) fail("Artifact Manifest")
  hashes([value.sequence_result_hash, value.fingerprint_hash, value.manifest_hash])
}

export function assertReplayPortfolioCycleSequenceOutcome(value: ReplayPortfolioCycleSequenceOutcome): void {
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_OUTCOME_SCHEMA_VERSION) fail("Outcome schema")
  if (value.status === "completed") {
    if (!value.result || !value.artifact_manifest || value.failure !== null
        || value.result.result_hash !== value.artifact_manifest.sequence_result_hash) fail("completed Outcome")
    assertReplayPortfolioCycleSequenceArtifactManifest(value.artifact_manifest)
  } else if (value.result !== null || value.artifact_manifest !== null || !value.failure
      || value.idempotent_replay || value.failure.partial_result_published !== false) fail("failed Outcome")
  if (value.outcome_hash !== replayPortfolioCycleSequenceOutcomeHash(value)) fail("Outcome hash")
}

function hashes(values: string[]): void {
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) fail("hash")
}
function utc(value: string): boolean { return value.endsWith("Z") && Number.isFinite(Date.parse(value)) }
function fail(message: string): never { throw new Error(`Replay Portfolio Cycle Sequence ${message}`) }
