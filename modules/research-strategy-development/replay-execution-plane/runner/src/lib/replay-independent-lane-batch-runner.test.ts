import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  createReplaySharedInitialCapitalReservationSnapshot,
  createReplayRuntimeSharedWalletReservationSnapshot,
  createReplayRuntimeSharedWalletLifecycleReservationSnapshot,
  createReplayRuntimeSharedWalletFundingReservationSnapshot,
  createReplayRuntimeSharedWalletRiskReservationSnapshot,
  createReplayPortfolioAllocationReservationSnapshot,
  createReplayPortfolioReallocationReservationSnapshot,
  createReplayPortfolioCycleSequenceReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type TrialReservationSnapshot,
  type ReplaySharedInitialCapitalReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_INDEPENDENT_LANE_BATCH_PLAN_SCHEMA_VERSION,
  assertReplayIndependentLaneBatchPlan,
  assertReplayIndependentLaneBatchOutcome,
  assertReplayIndependentLaneBatchResult,
  replayIndependentLaneBatchOutcomeHash,
  replayIndependentLaneBatchPlanHash,
  replayIndependentLaneBatchResultHash,
  type ReplayIndependentLaneBatchPlan,
} from "../../../contracts/src/lib/replay-independent-lane-batch-contracts"
import {
  assertReplaySharedInitialCapitalBatchOutcome,
  replaySharedInitialCapitalBatchOutcomeHash,
  replaySharedInitialCapitalBatchResultHash,
} from "../../../contracts/src/lib/replay-shared-initial-capital-batch-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_PLAN_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletOutcome,
  replayRuntimeSharedWalletOutcomeHash,
  replayRuntimeSharedWalletPlanHash,
  replayRuntimeSharedWalletResultHash,
  type ReplayRuntimeSharedWalletPlan,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_FUNDING_PLAN_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletFundingOutcome,
  replayRuntimeSharedWalletFundingEventHash,
  replayRuntimeSharedWalletFundingOutcomeHash,
  replayRuntimeSharedWalletFundingPlanHash,
  replayRuntimeSharedWalletFundingResultHash,
  type ReplayRuntimeSharedWalletFundingPlan,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-funding-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_RISK_PLAN_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletRiskOutcome,
  replayRuntimeSharedWalletRiskEventHash,
  replayRuntimeSharedWalletRiskOutcomeHash,
  replayRuntimeSharedWalletRiskPlanHash,
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskPlan,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  REPLAY_PORTFOLIO_ALLOCATION_PLAN_SCHEMA_VERSION,
  assertReplayPortfolioAllocationOutcome,
  replayPortfolioAllocationDecisionHash,
  replayPortfolioAllocationCycleHash,
  replayPortfolioAllocationOutcomeHash,
  replayPortfolioAllocationPlanHash,
  replayPortfolioAllocationResultHash,
  type ReplayPortfolioAllocationPlan,
} from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES,
  assertReplayPortfolioArtifactOutcome,
  assertReplayRuntimeSharedWalletPortfolioEvidence,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import {
  REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS,
  REPLAY_INTEGRATED_PORTFOLIO_PLAN_SCHEMA_VERSION,
  assertReplayIntegratedPortfolioResult,
  replayIntegratedPortfolioPlanHash,
  replayIntegratedPortfolioResultHash,
  replayIntegratedPortfolioTransitionHash,
  type ReplayIntegratedPortfolioPlan,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import {
  REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS,
  REPLAY_PORTFOLIO_REALLOCATION_PLAN_SCHEMA_VERSION,
  replayPortfolioReallocationPlanHash,
  type ReplayPortfolioReallocationPlan,
} from "../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import {
  REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS,
  REPLAY_TWO_CYCLE_PORTFOLIO_PLAN_SCHEMA_VERSION,
  replayTwoCyclePortfolioPlanHash,
  replayTwoCyclePortfolioResultHash,
  type ReplayTwoCyclePortfolioPlan,
} from "../../../contracts/src/lib/replay-two-cycle-portfolio-contracts"
import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_PLAN_SCHEMA_VERSION,
  replayPortfolioCycleSequencePlanHash,
  replayPortfolioCycleSequenceResultHash,
  type ReplayPortfolioCycleSequencePlan,
} from "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import {
  assertReplayPortfolioCycleSequenceAccountingEvidence,
  replayPortfolioCycleSequenceAccountingEvidenceHash,
} from "../../../contracts/src/lib/replay-portfolio-cycle-sequence-accounting-contracts"
import {
  assertReplayPortfolioMarkRiskRevaluationEvidence,
  replayPortfolioMarkRiskTransitionHash,
} from "../../../contracts/src/lib/replay-portfolio-mark-risk-revaluation-contracts"
import {
  assertReplayPortfolioProtectiveTerminalEvidence,
  replayPortfolioProtectiveTerminalEvidenceHash,
  replayPortfolioProtectiveTerminalFingerprintHash,
  replayPortfolioProtectiveTerminalRecordHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import {
  assertReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  replayPortfolioProtectiveStopReplacementTerminalEvidenceHash,
  replayPortfolioProtectiveStopReplacementTerminalFingerprintHash,
  replayPortfolioProtectiveStopReplacementTerminalRecordHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-contracts"
import {
  assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
  replayPortfolioProtectiveStopReplacementTerminalAccountingEvidenceHash,
  replayPortfolioProtectiveStopReplacementTerminalAccountingFingerprintHash,
  replayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence,
  replayPortfolioProtectiveStopReplacementCycleSequenceEvidenceHash,
  replayPortfolioProtectiveStopReplacementCycleSequenceFingerprintHash,
  replayPortfolioProtectiveStopReplacementCycleSequenceJournalEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-cycle-sequence-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidenceHash,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprintHash,
  replayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-cycle-sequence-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence,
  replayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidenceHash,
  replayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprintHash,
  replayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitCancelCycleSequenceEvidence,
  replayPortfolioProtectiveTakeProfitCancelCycleSequenceEvidenceHash,
  replayPortfolioProtectiveTakeProfitCancelCycleSequenceFingerprintHash,
  replayPortfolioProtectiveTakeProfitCancelCycleSequenceJournalEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-cycle-sequence-contracts"
import {
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence,
  replayPortfolioProtectiveStopCancelTerminalEvidenceHash,
  replayPortfolioProtectiveStopCancelTerminalFingerprintHash,
  replayPortfolioProtectiveStopCancelTerminalRecordHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-contracts"
import {
  assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
  replayPortfolioProtectiveStopCancelTerminalAccountingEvidenceHash,
  replayPortfolioProtectiveStopCancelTerminalAccountingFingerprintHash,
  replayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopCancelCycleSequenceEvidence,
  replayPortfolioProtectiveStopCancelCycleSequenceEvidenceHash,
  replayPortfolioProtectiveStopCancelCycleSequenceFingerprintHash,
  replayPortfolioProtectiveStopCancelCycleSequenceJournalEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-cycle-sequence-contracts"
import {
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence,
  replayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidenceHash,
  replayPortfolioProtectiveStrategyExitCancelTerminalAccountingFingerprintHash,
  replayPortfolioProtectiveStrategyExitCancelTerminalAccountingLedgerEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidenceHash,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceFingerprintHash,
  replayPortfolioProtectiveStrategyExitCancelCycleSequenceJournalEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-cycle-sequence-contracts"
import {
  assertReplayPortfolioProtectiveTerminalAccountingEvidence,
  replayPortfolioProtectiveTerminalAccountingEvidenceHash,
  replayPortfolioProtectiveTerminalAccountingFingerprintHash,
  replayPortfolioProtectiveTerminalAccountingLedgerEntryHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTerminalCycleSequenceResult,
  replayPortfolioProtectiveTerminalCycleCommitHash,
  replayPortfolioProtectiveTerminalCycleSequenceResultHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-contracts"
import {
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence,
  replayPortfolioProtectiveTerminalCycleSequenceAccountingEvidenceHash,
  replayPortfolioProtectiveTerminalCycleSequenceTrialBalanceHash,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-accounting-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_PLAN_SCHEMA_VERSION,
  assertReplayRuntimeSharedWalletLifecycleOutcome,
  replayRuntimeSharedWalletLifecycleEventHash,
  replayRuntimeSharedWalletLifecycleOutcomeHash,
  replayRuntimeSharedWalletLifecyclePlanHash,
  replayRuntimeSharedWalletLifecycleResultHash,
  type ReplayRuntimeSharedWalletLifecyclePlan,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-lifecycle-contracts"
import {
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
  REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION,
  REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION,
  REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
  REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION,
  REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  type ReplayArtifactManifest,
  type ReplayExecutionRequest,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  runReplayIndependentLaneBatch,
  runReplaySharedInitialCapitalBatch,
} from "./replay-independent-lane-batch-runner"
import { runReplayRuntimeSharedWalletEntrySlice } from "./replay-runtime-shared-wallet-runner"
import { runReplayRuntimeSharedWalletLifecycleSlice } from "./replay-runtime-shared-wallet-lifecycle-runner"
import { runReplayRuntimeSharedWalletFundingSlice } from "./replay-runtime-shared-wallet-funding-runner"
import { runReplayRuntimeSharedWalletRiskSlice } from "./replay-runtime-shared-wallet-risk-runner"
import { runReplayPortfolioAllocationSlice } from "./replay-portfolio-allocation-runner"
import { createReplayRuntimeSharedWalletPortfolioEvidence } from "../../../accounting/src/lib/replay-runtime-shared-wallet-portfolio-accounting"
import { createReplayLocalArtifactStore } from "./replay-local-artifact-store"
import { publishReplayRuntimeSharedWalletPortfolioArtifact } from "./replay-runtime-shared-wallet-artifact-publisher"
import { runReplayIntegratedPortfolio } from "./replay-integrated-portfolio-runner"
import { runReplayPortfolioReallocation } from "./replay-portfolio-reallocation-runner"
import { runReplayTwoCyclePortfolio } from "./replay-two-cycle-portfolio-runner"
import { runReplayPortfolioCycleSequence } from "./replay-portfolio-cycle-sequence-runner"
import { runReplayPortfolioCycleSequenceAccounting } from "./replay-portfolio-cycle-sequence-accounting-runner"
import { runReplayPortfolioMarkRiskRevaluation } from "./replay-portfolio-mark-risk-revaluation-runner"
import { runReplayPortfolioProtectiveTerminal } from "./replay-portfolio-protective-terminal-runner"
import { runReplayPortfolioFixedPartialTerminal } from "./replay-portfolio-fixed-partial-terminal-runner"
import { runReplayPortfolioFixedPartialTerminalAccounting } from
  "./replay-portfolio-fixed-partial-terminal-accounting-runner"
import { runReplayPortfolioProtectiveStopReplacementTerminal } from
  "./replay-portfolio-protective-stop-replacement-terminal-runner"
import { runReplayPortfolioProtectiveStopReplacementTerminalAccounting } from
  "./replay-portfolio-protective-stop-replacement-terminal-accounting-runner"
import { runReplayPortfolioProtectiveStopReplacementCycleSequence } from
  "./replay-portfolio-protective-stop-replacement-cycle-sequence-runner"
import { runReplayPortfolioProtectiveTakeProfitReplacementCycleSequence } from
  "./replay-portfolio-protective-take-profit-replacement-cycle-sequence-runner"
import { runReplayPortfolioProtectiveTakeProfitCancelTerminal } from
  "./replay-portfolio-protective-take-profit-cancel-terminal-runner"
import { runReplayPortfolioProtectiveTakeProfitCancelTerminalAccounting } from
  "./replay-portfolio-protective-take-profit-cancel-terminal-accounting-runner"
import { runReplayPortfolioProtectiveTakeProfitCancelCycleSequence } from
  "./replay-portfolio-protective-take-profit-cancel-cycle-sequence-runner"
import { runReplayPortfolioProtectiveStopCancelTerminal } from
  "./replay-portfolio-protective-stop-cancel-terminal-runner"
import { runReplayPortfolioProtectiveStopCancelTerminalAccounting } from
  "./replay-portfolio-protective-stop-cancel-terminal-accounting-runner"
import { runReplayPortfolioProtectiveStopCancelCycleSequence } from
  "./replay-portfolio-protective-stop-cancel-cycle-sequence-runner"
import { assertReplayPortfolioProtectiveReplacementCycleFullFlat } from
  "./replay-portfolio-protective-replacement-cycle-source-runner"
import { runReplayPortfolioProtectiveStrategyExitCancelTerminal } from
  "./replay-portfolio-protective-strategy-exit-cancel-terminal-runner"
import { runReplayPortfolioProtectiveStrategyExitCancelTerminalAccounting } from
  "./replay-portfolio-protective-strategy-exit-cancel-terminal-accounting-runner"
import { runReplayPortfolioProtectiveStrategyExitCancelCycleSequence } from
  "./replay-portfolio-protective-strategy-exit-cancel-cycle-sequence-runner"
import { runReplayPortfolioProtectiveTerminalAccounting } from
  "./replay-portfolio-protective-terminal-accounting-runner"
import { runReplayPortfolioProtectiveTerminalCycleSequence } from
  "./replay-portfolio-protective-terminal-cycle-sequence-runner"
import { runReplayPortfolioProtectiveTerminalCycleSequenceAccounting } from
  "./replay-portfolio-protective-terminal-cycle-sequence-accounting-runner"
import { executeReplayRuntimeSharedWalletRiskSlice } from "../../../engine/src/lib/replay-runtime-shared-wallet-risk-engine"
import type { ReplayArtifactNamespace, ReplayArtifactStore } from "./replay-artifact-store"
import type { ReplayTrialRunInput, ReplayTrialRunOutcome } from "./replay-trial-runner"

const HASH = "b".repeat(64)
const CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-1",
  certification_ref: "certification://status-provider/1",
  status: "certified",
  certified_at: "2026-07-01T00:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "status-provider-certification-v1",
  provider_capability_hash: HASH,
  producer_domain: "market-data-products",
  producer_id: "status-provider",
  producer_version: "v1",
  producer_build_hash: HASH,
  normalization_policy_version: "status-normalization-v1",
  normalization_policy_hash: HASH,
  allowed_source_kind: "venue_status_event_archive",
  allowed_completeness: "complete_history",
})

function laneInput(input: {
  laneId: string
  symbol: string
  initialCash: number
  endingEquity: number
}): {
  lane_id: string
  trial: ReplayTrialRunInput
  outcome: ReplayTrialRunOutcome
} {
  const runId = `run-${input.laneId}`
  const trialId = `trial-${input.laneId}`
  const candidateId = `candidate-${input.laneId}`
  const request = {
    run_id: runId,
    symbol: input.symbol,
    initial_cash: input.initialCash,
    trial_id: trialId,
    candidate_id: candidateId,
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    candidate_hash: HASH,
    identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH,
    trial_reservation_ref: `reservation://${trialId}`,
    trial_reservation_hash: HASH,
  } as ReplayExecutionRequest
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: `reservation-${trialId}`,
    reservation_ref: request.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z",
    expires_at: "2026-07-15T00:00:00Z",
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: request.experiment_id,
      trial_group_id: request.trial_group_id,
      trial_group_hash: request.trial_group_hash,
      trial_id: request.trial_id,
      candidate_id: request.candidate_id,
      candidate_hash: request.candidate_hash,
      identity_hash_policy_version: request.identity_hash_policy_version,
      experiment_contract_hash: request.experiment_contract_hash,
    },
    trial_ordinal: 1,
    run_id: runId,
    counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1",
    candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: `idempotency-${input.laneId}`,
      execution_spec_hash: HASH,
      dataset_manifest_ref: "dataset://fixture",
      dataset_hash: HASH,
      liquidity_capacity_attestation_hash: null,
      supplemental_facts_hash: HASH,
      supplemental_requirement_set_hash: HASH,
      venue_risk_policy_schedule_hash: HASH,
      instrument_spec_schedule_hash: HASH,
      instrument_status_schedule_hash: HASH,
      instrument_status_provenance_hash: HASH,
      instrument_status_provider_capability_hash: HASH,
      instrument_status_provider_certification_hash: CERTIFICATION.certification_hash,
      harness_hash: HASH,
      assumptions_hash: HASH,
      cost_policy_hash: HASH,
      margin_policy_hash: HASH,
      simulator_policy_version: "simulator-v1",
      execution_mode: "step",
    },
    instrument_status_provider_certification: CERTIFICATION,
    required_capabilities: ["step"],
  }
  request.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  const requestHash = canonicalHash(request)
  const lease: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: `attempt-${input.laneId}`,
    attempt_ordinal: 1,
    worker_id: `worker-${input.laneId}`,
    trial_id: trialId,
    run_id: runId,
    reservation_ref: reservation.reservation_ref,
    reservation_hash: request.trial_reservation_hash,
    request_hash: requestHash,
    status: "running",
    lease_generation: 1,
    claimed_at: "2026-07-14T00:00:00Z",
    heartbeat_at: "2026-07-14T00:00:30Z",
    lease_expires_at: "2026-07-14T00:05:00Z",
  }
  const result = {
    run_id: runId,
    metrics: {
      initial_cash: input.initialCash,
      ending_equity: input.endingEquity,
      net_pnl: input.endingEquity - input.initialCash,
    },
  } as ReplayResult
  const artifact = {
    run_id: runId,
    result_hash: canonicalHash(result),
  } as ReplayArtifactManifest
  return {
    lane_id: input.laneId,
    trial: {
      request,
      trial_reservation: reservation,
      attempt_lease: lease,
      observed_at: "2026-07-14T00:01:00Z",
      dataset_manifest: {} as ReplayTrialRunInput["dataset_manifest"],
      bars: [],
    },
    outcome: {
      schema_version: "trade.rd-replay-run-outcome.v35",
      run_id: runId,
      attempt_id: lease.attempt_id,
      lease_generation: lease.lease_generation,
      status: "completed",
      idempotent_replay: false,
      result,
      artifact_manifest: artifact,
    },
  }
}

function planFor(lanes: ReturnType<typeof laneInput>[]): ReplayIndependentLaneBatchPlan {
  const body: Omit<ReplayIndependentLaneBatchPlan, "plan_hash"> = {
    schema_version: REPLAY_INDEPENDENT_LANE_BATCH_PLAN_SCHEMA_VERSION,
    batch_id: "batch-1",
    execution_mode: "independent_capital_lanes",
    allocation_policy: "strict_preallocated_no_rebalancing",
    aggregation_policy: "evidence_only_sum_no_cross_lane_netting",
    failure_policy: "all_children_complete_or_no_batch_result",
    lanes: [...lanes]
      .sort((left, right) => left.lane_id.localeCompare(right.lane_id))
      .map(({ lane_id: laneId, trial }) => ({
        lane_id: laneId,
        symbol: trial.request.symbol,
        run_id: trial.request.run_id,
        request_hash: canonicalHash(trial.request),
        trial_reservation_hash: hashTrialReservationSnapshot(trial.trial_reservation),
        attempt_lease_hash: hashReplayAttemptLeaseSnapshot(trial.attempt_lease),
        allocated_initial_cash: trial.request.initial_cash,
      })),
  }
  return { ...body, plan_hash: replayIndependentLaneBatchPlanHash(body) }
}

function executor(lanes: ReturnType<typeof laneInput>[], calls: string[] = []) {
  const outcomes = new Map(lanes.map((lane) => [lane.trial.request.run_id, lane.outcome]))
  return (trial: ReplayTrialRunInput): ReplayTrialRunOutcome => {
    calls.push(trial.request.run_id)
    return structuredClone(outcomes.get(trial.request.run_id)!)
  }
}

function sharedCapitalReservation(
  plan: ReplayIndependentLaneBatchPlan,
  lanes: ReturnType<typeof laneInput>[],
  priority: string[],
  allocations = new Map(lanes.map((lane) => [lane.lane_id, lane.trial.request.initial_cash])),
): ReplaySharedInitialCapitalReservationSnapshot {
  const laneById = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  const entries = priority.map((laneId, index) => {
    const lane = laneById.get(laneId)!
    return {
      lane_id: laneId,
      priority_rank: index + 1,
      trial_id: lane.trial.request.trial_id,
      run_id: lane.trial.request.run_id,
      trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
      trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
      allocated_initial_cash: allocations.get(laneId)!,
    }
  })
  const sharedCash = entries.reduce((total, lane) => total + lane.allocated_initial_cash, 0)
  return createReplaySharedInitialCapitalReservationSnapshot({
    schema_version: REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION,
    reservation_id: "shared-capital-1",
    reservation_ref: "reservation://shared-capital/1",
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:02:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    batch_id: plan.batch_id,
    batch_plan_hash: plan.plan_hash,
    settlement_asset: "USDT",
    capital_policy_version: "rd-shared-initial-capital-static-preallocation-v1",
    execution_priority_policy: "control_plane_explicit_rank_no_ties",
    shared_initial_cash: sharedCash,
    total_allocated_initial_cash: sharedCash,
    lanes: entries,
    limitations: [
      "no_runtime_cash_reuse_or_rebalancing",
      "no_cross_lane_margin_or_liquidation",
      "no_concurrent_matching_claim",
    ],
  })
}

function runtimeLaneInput(input: {
  laneId: string
  symbol: string
  collateral: number
  feeBps: number
  executableTime?: string
}) {
  const lane = laneInput({ laneId: input.laneId, symbol: input.symbol, initialCash: 100, endingEquity: 100 })
  const executableTime = input.executableTime ?? "2026-07-14T00:02:00Z"
  Object.assign(lane.trial.request, {
    dataset_hash: HASH,
    order: {
      side: "long",
      quantity: 1,
      signal_time: "2026-07-14T00:00:00Z",
      earliest_executable_time: executableTime,
      stop_price: 90,
      target_price: 120,
      entry_execution: { order_type: "market" },
    },
    cost_policy: { policy_id: "cost-v1", version: "v1", fee_bps: input.feeBps, slippage_bps: 0, liquidation_fee_bps: 0 },
    simulator_policy: { earliest_execution: "next_open" },
    margin_policy: { mode: "isolated", collateral_asset: "USDT", isolated_collateral: input.collateral },
  })
  lane.trial.dataset_manifest = {
    ...lane.trial.dataset_manifest,
    symbol: input.symbol,
    data_hash: HASH,
    instrument: {
      ...(lane.trial.dataset_manifest.instrument ?? {}),
      accounting: {
        ...(lane.trial.dataset_manifest.instrument?.accounting ?? {}),
        settlement_asset: "USDT",
        price_increment: "0.01",
        settlement_increment: "0.01",
      },
    },
  } as ReplayTrialRunInput["dataset_manifest"]
  lane.trial.bars = [{
    open_time: executableTime,
    close_time: new Date(Date.parse(executableTime) + 59_999).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    closed: true,
  }]
  lane.trial.observed_at = "2026-07-14T00:01:00Z"
  lane.trial.attempt_lease.request_hash = canonicalHash(lane.trial.request)
  return lane
}

function runtimePlan(lanes: ReturnType<typeof runtimeLaneInput>[]): ReplayRuntimeSharedWalletPlan {
  const body: Omit<ReplayRuntimeSharedWalletPlan, "plan_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_PLAN_SCHEMA_VERSION,
    portfolio_id: "portfolio-1",
    execution_mode: "runtime_shared_wallet_entry_v1",
    capital_semantics: "single_runtime_wallet_no_static_lane_allocation",
    matching_scope: "market_next_open_full_fill",
    margin_scope: "isolated_positions_shared_admission_cash",
    failure_policy: "engine_failure_no_partial_portfolio_result",
    lanes: [...lanes].sort((left, right) => left.lane_id.localeCompare(right.lane_id)).map((lane) => ({
      lane_id: lane.lane_id,
      symbol: lane.trial.request.symbol,
      run_id: lane.trial.request.run_id,
      request_hash: canonicalHash(lane.trial.request),
      trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
      attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lane.trial.attempt_lease),
    })),
  }
  return { ...body, plan_hash: replayRuntimeSharedWalletPlanHash(body) }
}

function runtimeReservation(
  plan: ReplayRuntimeSharedWalletPlan,
  lanes: ReturnType<typeof runtimeLaneInput>[],
  priority: string[],
) {
  const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  return createReplayRuntimeSharedWalletReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-1",
    reservation_ref: "reservation://runtime-wallet/1",
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:02:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-isolated-entry-v1",
    simultaneous_order_policy: "event_time_then_control_plane_priority",
    lanes: priority.map((laneId, index) => {
      const lane = byId.get(laneId)!
      return {
        lane_id: laneId,
        priority_rank: index + 1,
        trial_id: lane.trial.request.trial_id,
        run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
      }
    }),
    limitations: [
      "market_next_open_entry_only",
      "isolated_margin_no_cross_margin",
      "no_exit_funding_liquidation_or_cash_release",
    ],
  })
}

function withRuntimeLifecycleExit(
  lane: ReturnType<typeof runtimeLaneInput>,
  input: { executableTime?: string; open?: number } = {},
): ReturnType<typeof runtimeLaneInput> {
  const executableTime = input.executableTime ?? "2026-07-14T00:03:00Z"
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: lane.trial.request.order.side === "long" ? "sell" as const : "buy" as const,
    order_type: "market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: new Date(Date.parse(executableTime) - 30_000).toISOString(),
    earliest_executable_time: executableTime,
  }
  lane.trial.request.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [{
      decision_sequence: 1,
      decision_time: exitIntent.signal_time,
      expected_effect: "authorized_reduce_only_exit",
      authorized_reduce_only_exit: exitIntent,
      authorized_protective_stop_replace: null,
      authorized_partial_reduce: null,
      authorized_order_hash: canonicalHash(exitIntent),
    }],
  }
  lane.trial.bars.push({
    open_time: executableTime,
    close_time: new Date(Date.parse(executableTime) + 59_999).toISOString(),
    open: input.open ?? 110,
    high: (input.open ?? 110) + 1,
    low: (input.open ?? 110) - 1,
    close: input.open ?? 110,
    volume: 10,
    closed: true,
  })
  lane.trial.attempt_lease.request_hash = canonicalHash(lane.trial.request)
  return lane
}

function withRuntimeFixedPartial(
  lane: ReturnType<typeof runtimeLaneInput>,
  input: { terminal?: "strategy_exit" | "open"; sameBoundaryStop?: boolean } = {},
): ReturnType<typeof runtimeLaneInput> {
  const request = lane.trial.request
  const first = lane.trial.bars[0]!
  const partialTime = new Date(Date.parse(first.close_time) + 1).toISOString().replace(".000Z", "Z")
  const partialIntent = {
    schema_version: REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
    side: request.order.side === "long" ? "sell" as const : "buy" as const,
    order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "fixed_quantity" as const, quantity: 0.4,
    signal_time: first.close_time, earliest_executable_time: partialTime,
    post_fill_position_policy: "must_remain_open" as const,
    protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary" as const,
    protection_policy_version: REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
    replacement_trigger_policy: "preserve_current_stop_and_target_prices" as const,
    remaining_quantity_authority: "absolute_post_fill_position" as const,
    schedule_combination_policy: "one_partial_reduce_then_optional_final_full_exit_no_stop_replace" as const,
  }
  const partialOpen = request.order.side === "long" ? 105 : 95
  const second = { open_time: partialTime,
    close_time: new Date(Date.parse(partialTime) + 59_999).toISOString(),
    open: partialOpen, high: partialOpen + 1, low: partialOpen - 1, close: partialOpen,
    volume: 10, closed: true as const }
  lane.trial.bars.push(second)
  const entries: ReplayExecutionRequest["decision_schedule"]["entries"] = [{
    decision_sequence: 1, decision_time: partialIntent.signal_time,
    expected_effect: "authorized_partial_reduce", authorized_reduce_only_exit: null,
    authorized_protective_stop_replace: null, authorized_partial_reduce: partialIntent,
    authorized_order_hash: canonicalHash(partialIntent),
  }]
  if ((input.terminal ?? "strategy_exit") === "strategy_exit") {
    const exitTime = new Date(Date.parse(second.close_time) + 1).toISOString().replace(".000Z", "Z")
    const exitIntent = { schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
      side: partialIntent.side, order_type: "market" as const, reduce_only: true as const,
      quantity_policy: "full_open_position" as const, signal_time: second.close_time,
      earliest_executable_time: exitTime }
    entries.push({ decision_sequence: 2, decision_time: exitIntent.signal_time,
      expected_effect: "authorized_reduce_only_exit", authorized_reduce_only_exit: exitIntent,
      authorized_protective_stop_replace: null, authorized_partial_reduce: null,
      authorized_order_hash: canonicalHash(exitIntent) })
    const exitOpen = request.order.side === "long" ? 110 : 90
    lane.trial.bars.push({ open_time: exitTime,
      close_time: new Date(Date.parse(exitTime) + 59_999).toISOString(), open: exitOpen,
      high: exitOpen + 1, low: exitOpen - 1, close: exitOpen, volume: 10, closed: true })
  } else {
    const markTime = new Date(Date.parse(second.close_time) + 1).toISOString().replace(".000Z", "Z")
    const markOpen = request.order.side === "long" ? 106 : 94
    lane.trial.bars.push({ open_time: markTime,
      close_time: new Date(Date.parse(markTime) + 59_999).toISOString(), open: markOpen,
      high: markOpen + 1, low: markOpen - 1, close: markOpen, volume: 10, closed: true })
  }
  if (input.sameBoundaryStop) {
    if (request.order.side === "long") first.low = request.order.stop_price
    else first.high = request.order.stop_price
  }
  request.decision_schedule = { schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule", entries }
  request.decision_schedule_hash = canonicalHash(request.decision_schedule)
  lane.trial.attempt_lease.request_hash = canonicalHash(request)
  return lane
}

function withRuntimeProtectiveStopReplacement(
  lane: ReturnType<typeof runtimeLaneInput>,
  input: { decisionTime?: string; newStopPrice?: number; nextOpen?: number; sameBoundaryLow?: number } = {},
): ReturnType<typeof runtimeLaneInput> {
  const decisionTime = input.decisionTime ?? lane.trial.bars[0]!.close_time
  const request = lane.trial.request
  const exitSide = request.order.side === "long" ? "sell" as const : "buy" as const
  const newStopPrice = input.newStopPrice ?? (request.order.side === "long" ? 95 : 105)
  const intent = {
    schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
    side: exitSide,
    order_type: "stop_market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    replace_policy: "tighten_only_cancel_then_submit" as const,
    signal_time: decisionTime,
    previous_stop_price: request.order.stop_price,
    new_stop_price: newStopPrice,
  }
  const exitExecutableTime = new Date(Date.parse(decisionTime) + 60_001).toISOString().replace(".000Z", "Z")
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: exitSide,
    order_type: "market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: new Date(Date.parse(exitExecutableTime) - 1).toISOString(),
    earliest_executable_time: exitExecutableTime,
  }
  request.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [
      {
        decision_sequence: 1,
        decision_time: decisionTime,
        expected_effect: "authorized_protective_stop_replace",
        authorized_reduce_only_exit: null,
        authorized_protective_stop_replace: intent,
        authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(intent),
      },
      {
        decision_sequence: 2,
        decision_time: exitIntent.signal_time,
        expected_effect: "authorized_reduce_only_exit",
        authorized_reduce_only_exit: exitIntent,
        authorized_protective_stop_replace: null,
        authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(exitIntent),
      },
    ],
  }
  if (input.sameBoundaryLow !== undefined) lane.trial.bars[0]!.low = input.sameBoundaryLow
  const nextOpen = input.nextOpen ?? (request.order.side === "long" ? 94 : 106)
  const nextTime = new Date(Date.parse(decisionTime) + 1).toISOString().replace(".000Z", "Z")
  lane.trial.bars.push({
    open_time: nextTime,
    close_time: new Date(Date.parse(nextTime) + 59_999).toISOString(),
    open: nextOpen,
    high: nextOpen + 2,
    low: nextOpen - 1,
    close: nextOpen,
    volume: 10,
    closed: true,
  })
  lane.trial.bars.push({
    open_time: exitExecutableTime,
    close_time: new Date(Date.parse(exitExecutableTime) + 59_999).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    closed: true,
  })
  lane.trial.attempt_lease.request_hash = canonicalHash(request)
  return lane
}

function withRuntimeTakeProfitReplacement(
  lane: ReturnType<typeof runtimeLaneInput>,
  input: {
    decisionTime?: string
    newTargetPrice?: number
    nextOpen?: number
    sameBoundaryTarget?: boolean
    nextHigh?: number
    nextLow?: number
  } = {},
): ReturnType<typeof runtimeLaneInput> {
  const decisionTime = input.decisionTime ?? lane.trial.bars[0]!.close_time
  const request = lane.trial.request
  const exitSide = request.order.side === "long" ? "sell" as const : "buy" as const
  const newTargetPrice = input.newTargetPrice ?? (request.order.side === "long" ? 120 : 80)
  const intent = {
    schema_version: REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION,
    side: exitSide,
    order_type: "take_profit_market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    target_order_id: `${request.run_id}:order:target`,
    replace_policy: "cancel_then_submit_not_already_triggered" as const,
    stop_preservation_policy: "require_active_full_position_stop" as const,
    schedule_combination_policy: "initial_bracket_only_no_other_position_mutation" as const,
    signal_time: decisionTime,
    previous_target_price: request.order.target_price,
    new_target_price: newTargetPrice,
    reason_code: "take_profit_repriced" as const,
  }
  const exitExecutableTime = new Date(Date.parse(decisionTime) + 60_001).toISOString().replace(".000Z", "Z")
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: exitSide,
    order_type: "market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: new Date(Date.parse(exitExecutableTime) - 1).toISOString(),
    earliest_executable_time: exitExecutableTime,
  }
  request.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [
      {
        decision_sequence: 1,
        decision_time: decisionTime,
        expected_effect: "authorized_take_profit_replace",
        authorized_reduce_only_exit: null,
        authorized_protective_stop_replace: null,
        authorized_take_profit_replace: intent,
        authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(intent),
      },
      {
        decision_sequence: 2,
        decision_time: exitIntent.signal_time,
        expected_effect: "authorized_reduce_only_exit",
        authorized_reduce_only_exit: exitIntent,
        authorized_protective_stop_replace: null,
        authorized_take_profit_replace: null,
        authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(exitIntent),
      },
    ],
  }
  if (input.sameBoundaryTarget) {
    if (request.order.side === "long") lane.trial.bars[0]!.high = request.order.target_price
    else lane.trial.bars[0]!.low = request.order.target_price
  }
  const nextOpen = input.nextOpen ?? (request.order.side === "long" ? newTargetPrice + 1 : newTargetPrice - 1)
  const nextTime = new Date(Date.parse(decisionTime) + 1).toISOString().replace(".000Z", "Z")
  lane.trial.bars.push({
    open_time: nextTime,
    close_time: new Date(Date.parse(nextTime) + 59_999).toISOString(),
    open: nextOpen,
    high: input.nextHigh ?? nextOpen + 2,
    low: input.nextLow ?? nextOpen - 2,
    close: nextOpen,
    volume: 10,
    closed: true,
  })
  lane.trial.bars.push({
    open_time: exitExecutableTime,
    close_time: new Date(Date.parse(exitExecutableTime) + 59_999).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    closed: true,
  })
  lane.trial.attempt_lease.request_hash = canonicalHash(request)
  return lane
}

function withRuntimeTakeProfitCancel(
  lane: ReturnType<typeof runtimeLaneInput>,
  input: { sameBoundaryTarget?: boolean } = {},
): ReturnType<typeof runtimeLaneInput> {
  const request = lane.trial.request
  const decisionTime = lane.trial.bars[0]!.close_time
  const intent = {
    schema_version: REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION,
    target_order_role: "target" as const,
    target_order_type: "take_profit_market" as const,
    target_order_id: `${request.run_id}:order:target`,
    cancel_policy: "cancel_active_target_preserve_stop" as const,
    stop_preservation_policy: "require_active_full_position_stop" as const,
    schedule_combination_policy: "initial_bracket_only_no_other_position_mutation" as const,
    effective_at: decisionTime,
    reason_code: "take_profit_condition_revoked" as const,
  }
  const stopTime = new Date(Date.parse(decisionTime) + 60_001).toISOString().replace(".000Z", "Z")
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: request.order.side === "long" ? "sell" as const : "buy" as const,
    order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: new Date(Date.parse(stopTime) - 1).toISOString(), earliest_executable_time: stopTime,
  }
  request.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [
      {
        decision_sequence: 1, decision_time: decisionTime,
        expected_effect: "authorized_take_profit_cancel",
        authorized_take_profit_cancel: intent,
        authorized_reduce_only_exit: null, authorized_protective_stop_replace: null,
        authorized_take_profit_replace: null, authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(intent),
      },
      {
        decision_sequence: 2, decision_time: exitIntent.signal_time,
        expected_effect: "authorized_reduce_only_exit", authorized_take_profit_cancel: null,
        authorized_reduce_only_exit: exitIntent, authorized_protective_stop_replace: null,
        authorized_take_profit_replace: null, authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(exitIntent),
      },
    ],
  }
  if (input.sameBoundaryTarget) {
    if (request.order.side === "long") lane.trial.bars[0]!.high = request.order.target_price
    else lane.trial.bars[0]!.low = request.order.target_price
  }
  const formerTargetOpen = request.order.side === "long"
    ? request.order.target_price + 1 : request.order.target_price - 1
  const afterCancel = new Date(Date.parse(decisionTime) + 1).toISOString().replace(".000Z", "Z")
  lane.trial.bars.push({
    open_time: afterCancel, close_time: new Date(Date.parse(afterCancel) + 59_999).toISOString(),
    open: formerTargetOpen, high: formerTargetOpen + 1, low: formerTargetOpen - 1,
    close: formerTargetOpen, volume: 10, closed: true,
  })
  const stopOpen = request.order.side === "long" ? request.order.stop_price - 1 : request.order.stop_price + 1
  lane.trial.bars.push({
    open_time: stopTime, close_time: new Date(Date.parse(stopTime) + 59_999).toISOString(),
    open: stopOpen, high: stopOpen + 1, low: stopOpen - 1, close: stopOpen, volume: 10, closed: true,
  })
  lane.trial.attempt_lease.request_hash = canonicalHash(request)
  return lane
}

function withRuntimeProtectiveStopCancel(
  lane: ReturnType<typeof runtimeLaneInput>,
  input: { sameBoundaryStop?: boolean; terminal?: "target" | "open" } = {},
): ReturnType<typeof runtimeLaneInput> {
  const request = lane.trial.request
  const decisionTime = lane.trial.bars[0]!.close_time
  const intent = {
    schema_version: REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION,
    target_order_role: "stop" as const,
    target_order_type: "stop_market" as const,
    target_order_id: `${request.run_id}:order:stop`,
    cancel_policy: "cancel_active_stop_preserve_target" as const,
    target_preservation_policy: "require_active_full_position_target" as const,
    schedule_combination_policy: "initial_bracket_only_no_other_position_mutation" as const,
    effective_at: decisionTime,
    reason_code: "protective_stop_condition_revoked" as const,
  }
  request.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [{
      decision_sequence: 1, decision_time: decisionTime,
      expected_effect: "authorized_protective_stop_cancel",
      authorized_protective_stop_cancel: intent,
      authorized_reduce_only_exit: null, authorized_protective_stop_replace: null,
      authorized_take_profit_replace: null, authorized_partial_reduce: null,
      authorized_order_hash: canonicalHash(intent),
    }],
  }
  if (input.sameBoundaryStop) {
    if (request.order.side === "long") lane.trial.bars[0]!.low = request.order.stop_price
    else lane.trial.bars[0]!.high = request.order.stop_price
  }
  const afterCancel = new Date(Date.parse(decisionTime) + 1).toISOString().replace(".000Z", "Z")
  const formerStopOpen = request.order.side === "long"
    ? request.order.stop_price - 1 : request.order.stop_price + 1
  lane.trial.bars.push({
    open_time: afterCancel, close_time: new Date(Date.parse(afterCancel) + 59_999).toISOString(),
    open: formerStopOpen, high: formerStopOpen + 1, low: formerStopOpen - 1,
    close: formerStopOpen, volume: 10, closed: true,
  })
  if ((input.terminal ?? "target") === "target") {
    const targetTime = new Date(Date.parse(afterCancel) + 60_000).toISOString().replace(".000Z", "Z")
    const targetOpen = request.order.side === "long"
      ? request.order.target_price + 1 : request.order.target_price - 1
    lane.trial.bars.push({
      open_time: targetTime, close_time: new Date(Date.parse(targetTime) + 59_999).toISOString(),
      open: targetOpen, high: targetOpen + 1, low: targetOpen - 1,
      close: targetOpen, volume: 10, closed: true,
    })
  }
  lane.trial.attempt_lease.request_hash = canonicalHash(request)
  return lane
}

function protectiveStopCancelPortfolioInput(
  lanes: ReturnType<typeof runtimeLaneInput>[], portfolioId: string, root: string,
) {
  const effectiveLanes = lanes.length === 1
    ? [...lanes, withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
      laneId: `${lanes[0]!.lane_id}-rejected`, symbol: "BNBUSDT", collateral: 20, feeBps: 0,
      executableTime: lanes[0]!.trial.request.order.earliest_executable_time,
    })), [100, 100, 100])]
    : lanes
  const allocationDraft = portfolioAllocationPlan(effectiveLanes)
  const allocationBody = { ...allocationDraft, portfolio_id: portfolioId }
  const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
  const riskDraft = runtimeRiskPlan(effectiveLanes)
  const riskBody = { ...riskDraft, portfolio_id: portfolioId }
  const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
  const priority = effectiveLanes.map((lane) => lane.lane_id)
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, effectiveLanes, priority, { gross: 100, net: 100, risk: 100 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, effectiveLanes, priority)
  const integratedPlan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  return {
    integrated_plan: integratedPlan, allocation_plan: allocationPlan,
    allocation_reservation: allocationAuthority, risk_plan: riskPlan, risk_reservation: riskAuthority,
    lanes: [...effectiveLanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
    artifact_store: createReplayLocalArtifactStore(root),
  }
}

function withRuntimeStrategyExitCancel(
  lane: ReturnType<typeof runtimeLaneInput>,
  input: { terminal?: "stop" | "target"; terminalAtCancelBoundary?: boolean } = {},
): ReturnType<typeof runtimeLaneInput> {
  const request = lane.trial.request
  const exitSignalTime = lane.trial.bars[0]!.close_time
  const cancelOpenTime = new Date(Date.parse(exitSignalTime) + 1).toISOString().replace(".000Z", "Z")
  const cancelTime = new Date(Date.parse(cancelOpenTime) + 59_999).toISOString()
  const exitExecutableTime = new Date(Date.parse(cancelTime) + 1).toISOString().replace(".000Z", "Z")
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: request.order.side === "long" ? "sell" as const : "buy" as const,
    order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: exitSignalTime, earliest_executable_time: exitExecutableTime,
  }
  const cancelIntent = {
    schema_version: REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION,
    target_order_role: "strategy_exit" as const,
    target_exit_decision_sequence: 1,
    cancel_policy: "cancel_submitted_before_earliest_executable_time" as const,
    effective_at: cancelTime,
    reason_code: "strategy_exit_condition_revoked" as const,
  }
  request.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [
      { decision_sequence: 1, decision_time: exitSignalTime,
        expected_effect: "authorized_reduce_only_exit", authorized_reduce_only_exit: exitIntent,
        authorized_strategy_exit_cancel: null, authorized_protective_stop_replace: null,
        authorized_partial_reduce: null, authorized_order_hash: canonicalHash(exitIntent) },
      { decision_sequence: 2, decision_time: cancelTime,
        expected_effect: "authorized_strategy_exit_cancel", authorized_reduce_only_exit: null,
        authorized_strategy_exit_cancel: cancelIntent, authorized_protective_stop_replace: null,
        authorized_partial_reduce: null, authorized_order_hash: canonicalHash(cancelIntent) },
    ],
  }
  const terminal = input.terminal ?? "target"
  const cancelBar = {
    open_time: cancelOpenTime, close_time: cancelTime, open: 100, high: 101, low: 99,
    close: 100, volume: 10, closed: true as const,
  }
  if (input.terminalAtCancelBoundary) {
    if (terminal === "target") {
      if (request.order.side === "long") cancelBar.high = request.order.target_price
      else cancelBar.low = request.order.target_price
    } else if (request.order.side === "long") cancelBar.low = request.order.stop_price
    else cancelBar.high = request.order.stop_price
  }
  lane.trial.bars.push(cancelBar)
  const trigger = terminal === "target" ? request.order.target_price : request.order.stop_price
  const terminalOpen = request.order.side === "long"
    ? trigger + (terminal === "target" ? 1 : -1)
    : trigger + (terminal === "target" ? -1 : 1)
  lane.trial.bars.push({
    open_time: exitExecutableTime,
    close_time: new Date(Date.parse(exitExecutableTime) + 59_999).toISOString(),
    open: terminalOpen, high: terminalOpen + 1, low: terminalOpen - 1,
    close: terminalOpen, volume: 10, closed: true,
  })
  lane.trial.attempt_lease.request_hash = canonicalHash(request)
  return lane
}

function runtimeLifecyclePlan(
  lanes: ReturnType<typeof runtimeLaneInput>[],
): ReplayRuntimeSharedWalletLifecyclePlan {
  const body: Omit<ReplayRuntimeSharedWalletLifecyclePlan, "plan_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_PLAN_SCHEMA_VERSION,
    portfolio_id: "portfolio-lifecycle-1",
    execution_mode: "runtime_shared_wallet_entry_exit_release_v1",
    capital_semantics: "single_runtime_wallet_event_committed_cash_reuse",
    matching_scope: "market_next_open_full_fill",
    margin_scope: "isolated_positions_shared_admission_cash",
    same_time_cash_policy: "exit_release_before_entry_admission_then_control_plane_priority",
    failure_policy: "engine_failure_no_partial_portfolio_result",
    lanes: [...lanes].sort((left, right) => left.lane_id.localeCompare(right.lane_id)).map((lane) => {
      const exitIntent = lane.trial.request.decision_schedule?.entries.find(
        (entry) => entry.expected_effect === "authorized_reduce_only_exit",
      )?.authorized_reduce_only_exit ?? null
      return {
        lane_id: lane.lane_id,
        symbol: lane.trial.request.symbol,
        run_id: lane.trial.request.run_id,
        request_hash: canonicalHash(lane.trial.request),
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lane.trial.attempt_lease),
        scheduled_exit_time: exitIntent?.earliest_executable_time ?? null,
        exit_intent_hash: exitIntent ? canonicalHash(exitIntent) : null,
      }
    }),
  }
  return { ...body, plan_hash: replayRuntimeSharedWalletLifecyclePlanHash(body) }
}

function runtimeLifecycleReservation(
  plan: ReplayRuntimeSharedWalletLifecyclePlan,
  lanes: ReturnType<typeof runtimeLaneInput>[],
  priority: string[],
) {
  const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  return createReplayRuntimeSharedWalletLifecycleReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-lifecycle-1",
    reservation_ref: "reservation://runtime-wallet-lifecycle/1",
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:04:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-entry-exit-release-v1",
    same_time_cash_policy: "exit_release_before_entry_admission_then_control_plane_priority",
    lanes: priority.map((laneId, index) => {
      const lane = byId.get(laneId)!
      return {
        lane_id: laneId,
        priority_rank: index + 1,
        trial_id: lane.trial.request.trial_id,
        run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
      }
    }),
    limitations: [
      "market_next_open_entry_and_full_exit_only",
      "isolated_margin_no_cross_margin",
      "no_funding_liquidation_or_partial_position",
    ],
  })
}

function withRuntimeFunding(
  lane: ReturnType<typeof runtimeLaneInput>,
  events: Array<{ timestamp: string; rate: number; mark_price: number }>,
): ReturnType<typeof runtimeLaneInput> {
  lane.trial.funding_events = structuredClone(events)
  Object.assign(lane.trial.dataset_manifest, { funding_availability: "event_time" })
  return lane
}

function runtimeFundingPlan(
  lanes: ReturnType<typeof runtimeLaneInput>[],
): ReplayRuntimeSharedWalletFundingPlan {
  const body: Omit<ReplayRuntimeSharedWalletFundingPlan, "plan_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_FUNDING_PLAN_SCHEMA_VERSION,
    portfolio_id: "portfolio-funding-1",
    execution_mode: "runtime_shared_wallet_entry_exit_exact_funding_v1",
    capital_semantics: "single_runtime_wallet_event_committed_funding_cash_reuse",
    matching_scope: "market_next_open_full_fill",
    margin_scope: "isolated_positions_shared_admission_cash",
    funding_scope: "frozen_exact_events_t_minus_position",
    same_time_cash_policy: "funding_before_exit_before_entry_then_control_plane_priority",
    failure_policy: "engine_failure_no_partial_portfolio_result",
    lanes: [...lanes].sort((left, right) => left.lane_id.localeCompare(right.lane_id)).map((lane) => {
      const exitIntent = lane.trial.request.decision_schedule?.entries.find(
        (entry) => entry.expected_effect === "authorized_reduce_only_exit",
      )?.authorized_reduce_only_exit ?? null
      const fundingEvents = lane.trial.funding_events ?? []
      return {
        lane_id: lane.lane_id,
        symbol: lane.trial.request.symbol,
        run_id: lane.trial.request.run_id,
        request_hash: canonicalHash(lane.trial.request),
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lane.trial.attempt_lease),
        scheduled_exit_time: exitIntent?.earliest_executable_time ?? null,
        exit_intent_hash: exitIntent ? canonicalHash(exitIntent) : null,
        settlement_increment: lane.trial.dataset_manifest.instrument.accounting.settlement_increment,
        funding_event_count: fundingEvents.length,
        funding_events_hash: canonicalHash(fundingEvents),
      }
    }),
  }
  return { ...body, plan_hash: replayRuntimeSharedWalletFundingPlanHash(body) }
}

function runtimeFundingReservation(
  plan: ReplayRuntimeSharedWalletFundingPlan,
  lanes: ReturnType<typeof runtimeLaneInput>[],
  priority: string[],
) {
  const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  return createReplayRuntimeSharedWalletFundingReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-funding-1",
    reservation_ref: "reservation://runtime-wallet-funding/1",
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:04:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-exact-funding-v1",
    funding_policy_version: "exact-event-time-t-minus-position-v1",
    same_time_cash_policy: "funding_before_exit_before_entry_then_control_plane_priority",
    lanes: priority.map((laneId, index) => {
      const lane = byId.get(laneId)!
      return {
        lane_id: laneId,
        priority_rank: index + 1,
        trial_id: lane.trial.request.trial_id,
        run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
      }
    }),
    limitations: [
      "market_next_open_entry_full_exit_and_exact_funding_only",
      "isolated_margin_no_cross_margin",
      "no_liquidation_partial_position_or_borrow",
    ],
  })
}

function withRuntimeRisk(
  lane: ReturnType<typeof runtimeLaneInput>,
  markPrices: [number, number, number],
  input: {
    fundingRate?: number
    liquidationFeeBps?: number
    maintenanceRate?: number
    markTimes?: [string, string, string]
  } = {},
): ReturnType<typeof runtimeLaneInput> {
  const markTimes = input.markTimes
    ?? ["2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z", "2026-07-14T00:04:00Z"]
  const marks = markTimes
    .map((timestamp, index) => ({
      timestamp,
      available_at: timestamp,
      source_sequence: index,
      mark_price: markPrices[index]!,
    }))
  lane.trial.mark_events = marks
  lane.trial.funding_events = [{
    timestamp: markTimes[1],
    rate: input.fundingRate ?? 0,
    mark_price: markPrices[1],
  }]
  const risk = {
    schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
    snapshot_id: `risk-${lane.lane_id}`,
    venue_id: "binance-usdm",
    symbol: lane.trial.request.symbol,
    effective_at: "2026-07-01T00:00:00Z",
    valid_until: null,
    observed_at: "2026-07-14T00:00:00Z",
    source_ref: `fixture:risk:${lane.lane_id}`,
    source_hash: HASH,
    initial_margin_rate: 0.1,
    maintenance_tier: {
      tier_id: "tier-1",
      snapshot_ref: "fixture:tier-1",
      snapshot_hash: HASH,
      notional_floor: 0,
      notional_cap: 50_000,
      maintenance_margin_rate: input.maintenanceRate ?? 0.05,
      maintenance_amount: 0,
    },
    liquidation_fee_bps: input.liquidationFeeBps ?? 0,
  }
  const status = {
    schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: `status-${lane.lane_id}`,
    venue_id: "binance-usdm",
    symbol: lane.trial.request.symbol,
    status: "trading" as const,
    effective_at: "2026-07-01T00:00:00Z",
    valid_until: null,
    observed_at: "2026-07-14T00:00:00Z",
    source_ref: `fixture:status:${lane.lane_id}`,
    source_hash: HASH,
  }
  lane.trial.request.cost_policy.liquidation_fee_bps = risk.liquidation_fee_bps
  Object.assign(lane.trial.request.margin_policy, {
    initial_margin_rate: risk.initial_margin_rate,
    maintenance_tier: structuredClone(risk.maintenance_tier),
  })
  Object.assign(lane.trial.dataset_manifest, {
    first_open_time: markTimes[0],
    last_close_time: markTimes[2],
    observed_through: markTimes[2],
    funding_availability: "event_time",
    mark_availability: "event_time",
    mark_coverage: "complete_grid",
    mark_interval_ms: 60_000,
    mark_event_count: marks.length,
    venue_risk_policy_epochs: [risk],
  })
  Object.assign(lane.trial.dataset_manifest.instrument, {
    status_history: "complete",
    status_epochs: [status],
  })
  Object.assign(lane.trial.dataset_manifest.instrument.accounting, { contract_multiplier: "1" })
  const dataHash = canonicalHash({
    bars: lane.trial.bars,
    funding_events: lane.trial.funding_events,
    mark_events: lane.trial.mark_events,
    supplemental_facts: [],
  })
  lane.trial.dataset_manifest.data_hash = dataHash
  lane.trial.request.dataset_hash = dataHash
  lane.trial.request.venue_risk_policy_schedule_hash = canonicalHash([risk])
  lane.trial.attempt_lease.request_hash = canonicalHash(lane.trial.request)
  return lane
}

function runtimeRiskPlan(
  lanes: ReturnType<typeof runtimeLaneInput>[],
): ReplayRuntimeSharedWalletRiskPlan {
  const body: Omit<ReplayRuntimeSharedWalletRiskPlan, "plan_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_PLAN_SCHEMA_VERSION,
    portfolio_id: "portfolio-risk-1",
    execution_mode: "runtime_shared_wallet_exact_risk_full_liquidation_v1",
    capital_semantics: "single_runtime_wallet_event_committed_risk_cash_reuse",
    matching_scope: "market_next_open_and_trigger_mark_full_fill",
    margin_scope: "isolated_positions_shared_admission_cash",
    funding_scope: "frozen_exact_events_t_minus_position",
    risk_scope: "complete_exact_mark_grid_isolated_maintenance_full_liquidation",
    same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority",
    failure_policy: "engine_failure_or_liquidation_deficit_no_partial_portfolio_result",
    lanes: [...lanes].sort((left, right) => left.lane_id.localeCompare(right.lane_id)).map((lane) => {
      const exitIntent = lane.trial.request.decision_schedule?.entries.find(
        (entry) => entry.expected_effect === "authorized_reduce_only_exit",
      )?.authorized_reduce_only_exit ?? null
      const manifest = lane.trial.dataset_manifest
      const fundingEvents = lane.trial.funding_events ?? []
      const markEvents = lane.trial.mark_events ?? []
      return {
        lane_id: lane.lane_id,
        symbol: lane.trial.request.symbol,
        run_id: lane.trial.request.run_id,
        request_hash: canonicalHash(lane.trial.request),
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lane.trial.attempt_lease),
        scheduled_exit_time: exitIntent?.earliest_executable_time ?? null,
        exit_intent_hash: exitIntent ? canonicalHash(exitIntent) : null,
        price_increment: manifest.instrument.accounting.price_increment,
        settlement_increment: manifest.instrument.accounting.settlement_increment,
        contract_multiplier: "1",
        fee_bps: lane.trial.request.cost_policy.fee_bps,
        slippage_bps: lane.trial.request.cost_policy.slippage_bps,
        funding_event_count: fundingEvents.length,
        funding_events_hash: canonicalHash(fundingEvents),
        mark_event_count: markEvents.length,
        mark_events_hash: canonicalHash(markEvents),
        venue_risk_policy_epochs: structuredClone(manifest.venue_risk_policy_epochs),
        venue_risk_policy_epochs_hash: canonicalHash(manifest.venue_risk_policy_epochs),
        instrument_status_epochs: structuredClone(manifest.instrument.status_epochs),
        instrument_status_epochs_hash: canonicalHash(manifest.instrument.status_epochs),
      }
    }),
  }
  return { ...body, plan_hash: replayRuntimeSharedWalletRiskPlanHash(body) }
}

function runtimeRiskReservation(
  plan: ReplayRuntimeSharedWalletRiskPlan,
  lanes: ReturnType<typeof runtimeLaneInput>[],
  priority: string[],
  options: { issuedAt?: string; expiresAt?: string; sharedInitialCash?: number } = {},
) {
  const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  return createReplayRuntimeSharedWalletRiskReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-risk-1",
    reservation_ref: "reservation://runtime-wallet-risk/1",
    issued_at: options.issuedAt ?? "2026-07-14T00:00:30Z",
    expires_at: options.expiresAt ?? "2026-07-14T00:05:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    settlement_asset: "USDT",
    shared_initial_cash: options.sharedInitialCash ?? 100,
    capital_policy_version: "rd-runtime-shared-wallet-exact-risk-v1",
    funding_policy_version: "exact-event-time-t-minus-position-v1",
    risk_policy_version: "complete-exact-mark-isolated-maintenance-full-liquidation-v1",
    same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority",
    lanes: priority.map((laneId, index) => {
      const lane = byId.get(laneId)!
      return {
        lane_id: laneId,
        priority_rank: index + 1,
        trial_id: lane.trial.request.trial_id,
        run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
      }
    }),
    limitations: [
      "market_next_open_entry_full_exit_exact_funding_and_mark_risk_only",
      "isolated_margin_full_liquidation_no_cross_margin",
      "no_partial_liquidation_borrow_insurance_or_adl",
    ],
  })
}

function portfolioAllocationPlan(
  lanes: ReturnType<typeof runtimeLaneInput>[],
): ReplayPortfolioAllocationPlan {
  for (const lane of lanes) {
    Object.assign(lane.trial.dataset_manifest.instrument.accounting, { contract_multiplier: "1" })
    lane.trial.attempt_lease.request_hash = canonicalHash(lane.trial.request)
  }
  const body: Omit<ReplayPortfolioAllocationPlan, "plan_hash"> = {
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_PLAN_SCHEMA_VERSION,
    portfolio_id: "portfolio-allocation-1",
    execution_mode: "simultaneous_entry_exposure_risk_budget_allocation_v1",
    allocation_scope: "entry_slice_collect_same_time_then_allocate_before_fill",
    matching_scope: "market_next_open_full_fill_or_reject_no_resize",
    exposure_scope: "fixed_entry_execution_notional_until_slice_end",
    risk_budget_scope: "fixed_entry_to_frozen_stop_adverse_execution_plus_round_trip_fees",
    failure_policy: "input_or_engine_failure_no_partial_allocation_result",
    lanes: [...lanes].sort((left, right) => left.lane_id.localeCompare(right.lane_id)).map((lane) => {
      const request = lane.trial.request
      const accounting = lane.trial.dataset_manifest.instrument.accounting
      return {
        lane_id: lane.lane_id,
        symbol: request.symbol,
        run_id: request.run_id,
        request_hash: canonicalHash(request),
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lane.trial.attempt_lease),
        side: request.order.side,
        quantity: request.order.quantity,
        earliest_executable_time: request.order.earliest_executable_time,
        stop_price: request.order.stop_price,
        isolated_collateral: request.margin_policy.isolated_collateral,
        fee_bps: request.cost_policy.fee_bps,
        slippage_bps: request.cost_policy.slippage_bps,
        price_increment: accounting.price_increment,
        settlement_increment: accounting.settlement_increment,
        contract_multiplier: "1" as const,
      }
    }),
  }
  return { ...body, plan_hash: replayPortfolioAllocationPlanHash(body) }
}

function portfolioAllocationReservation(
  plan: ReplayPortfolioAllocationPlan,
  lanes: ReturnType<typeof runtimeLaneInput>[],
  priority: string[],
  limits: { gross?: number; net?: number; risk?: number; laneRisk?: Record<string, number> } = {},
) {
  const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]))
  return createReplayPortfolioAllocationReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
    reservation_id: "portfolio-allocation-1",
    reservation_ref: "reservation://portfolio-allocation/1",
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:02:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1",
    exposure_policy_version: "entry-execution-notional-gross-and-absolute-net-v1",
    risk_budget_policy_version: "entry-to-frozen-stop-adverse-execution-plus-round-trip-fees-v1",
    rejection_precedence: "lane_risk_then_cash_then_gross_then_absolute_net_then_portfolio_risk",
    max_gross_exposure_amount: limits.gross ?? 200,
    max_abs_net_exposure_amount: limits.net ?? 100,
    max_portfolio_risk_amount: limits.risk ?? 25,
    lanes: priority.map((laneId, index) => {
      const lane = byId.get(laneId)!
      return {
        lane_id: laneId,
        priority_rank: index + 1,
        trial_id: lane.trial.request.trial_id,
        run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        max_lane_risk_amount: limits.laneRisk?.[laneId] ?? 15,
      }
    }),
    limitations: [
      "market_next_open_full_fill_or_reject_no_resize_entry_slice_only",
      "entry_notional_exposure_and_frozen_stop_loss_budget_not_dynamic_var",
      "no_exit_funding_liquidation_cross_margin_partial_fill_or_borrow",
    ],
  })
}

function integratedPortfolioPlan(
  allocationPlan: ReplayPortfolioAllocationPlan,
  allocationReservationHash: string,
  riskPlan: ReplayRuntimeSharedWalletRiskPlan,
  riskReservationHash: string,
): ReplayIntegratedPortfolioPlan {
  const laneSet = allocationPlan.lanes.map((lane) => ({
    lane_id: lane.lane_id,
    symbol: lane.symbol,
    run_id: lane.run_id,
    request_hash: lane.request_hash,
    trial_reservation_hash: lane.trial_reservation_hash,
    attempt_lease_hash: lane.attempt_lease_hash,
  }))
  const body: Omit<ReplayIntegratedPortfolioPlan, "plan_hash"> = {
    schema_version: REPLAY_INTEGRATED_PORTFOLIO_PLAN_SCHEMA_VERSION,
    portfolio_id: allocationPlan.portfolio_id,
    execution_mode: "initial_allocation_then_exact_risk_lifecycle_artifact_v1",
    allocation_plan_hash: allocationPlan.plan_hash,
    allocation_reservation_hash: allocationReservationHash,
    risk_plan_hash: riskPlan.plan_hash,
    risk_reservation_hash: riskReservationHash,
    initial_allocation_time: allocationPlan.lanes[0]!.earliest_executable_time,
    lane_set_hash: canonicalHash(laneSet),
    event_ordering_policy: "pre_entry_funding_risk_then_allocation_phase_19_then_entry_phase_20_then_lifecycle",
    exposure_risk_state_policy: "fixed_entry_notional_and_frozen_stop_risk_released_on_full_close",
    artifact_policy: "integrated_evidence_payloads_then_manifest_last",
    failure_policy: "any_stage_failure_no_integrated_result_or_artifact",
    limitations: REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS,
  }
  return { ...body, plan_hash: replayIntegratedPortfolioPlanHash(body) }
}

function portfolioReallocationPlan(input: {
  portfolioId: string
  predecessorResultHash: string
  predecessorManifestHash: string
  reservationHash: string
  allocationPlan: ReplayPortfolioAllocationPlan
}): ReplayPortfolioReallocationPlan {
  const body: Omit<ReplayPortfolioReallocationPlan, "plan_hash"> = {
    schema_version: REPLAY_PORTFOLIO_REALLOCATION_PLAN_SCHEMA_VERSION,
    portfolio_id: input.portfolioId,
    execution_mode: "full_flat_release_then_second_allocation_cycle_v1",
    predecessor_integrated_result_hash: input.predecessorResultHash,
    predecessor_artifact_manifest_hash: input.predecessorManifestHash,
    reallocation_reservation_hash: input.reservationHash,
    cycle_2_allocation_plan_hash: input.allocationPlan.plan_hash,
    cycle_2_event_time: input.allocationPlan.lanes[0]!.earliest_executable_time,
    opening_cash_policy: "predecessor_ending_available_cash_after_full_flat_release",
    eligibility_policy: "all_predecessor_positions_closed_and_exposure_risk_zero",
    failure_policy: "input_or_allocation_or_artifact_failure_no_reallocation_result",
    limitations: REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS,
  }
  return { ...body, plan_hash: replayPortfolioReallocationPlanHash(body) }
}

function twoCyclePortfolioPlan(input: {
  portfolioId: string
  cycle1ResultHash: string
  cycle1ManifestHash: string
  reallocationResultHash: string
  reallocationManifestHash: string
  allocationPlanHash: string
  allocationResultHash: string
  riskPlanHash: string
  riskReservationHash: string
}): ReplayTwoCyclePortfolioPlan {
  const body: Omit<ReplayTwoCyclePortfolioPlan, "plan_hash"> = {
    schema_version: REPLAY_TWO_CYCLE_PORTFOLIO_PLAN_SCHEMA_VERSION,
    portfolio_id: input.portfolioId,
    execution_mode: "cycle_one_integrated_then_cycle_two_allocation_exact_risk_v1",
    cycle_1_integrated_result_hash: input.cycle1ResultHash,
    cycle_1_artifact_manifest_hash: input.cycle1ManifestHash,
    cycle_2_reallocation_result_hash: input.reallocationResultHash,
    cycle_2_reallocation_manifest_hash: input.reallocationManifestHash,
    cycle_2_allocation_plan_hash: input.allocationPlanHash,
    cycle_2_allocation_result_hash: input.allocationResultHash,
    cycle_2_risk_plan_hash: input.riskPlanHash,
    cycle_2_risk_reservation_hash: input.riskReservationHash,
    cash_bridge_policy: "cycle_1_ending_available_equals_cycle_2_shared_initial_cash",
    state_chain_policy: "cycle_1_chain_then_cycle_2_chain_with_strict_time_and_wallet_bridge",
    artifact_policy: "two_cycle_payloads_then_manifest_last",
    failure_policy: "any_stage_failure_no_two_cycle_result_or_artifact",
    limitations: REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS,
  }
  return { ...body, plan_hash: replayTwoCyclePortfolioPlanHash(body) }
}

function cycleSequencePlan(
  portfolioId: string,
  reservationHash: string,
  cycles: Array<{
    integratedPlan: ReplayIntegratedPortfolioPlan
    allocationPlan: ReplayPortfolioAllocationPlan
    riskPlan: ReplayRuntimeSharedWalletRiskPlan
  }>,
): ReplayPortfolioCycleSequencePlan {
  const body: Omit<ReplayPortfolioCycleSequencePlan, "plan_hash"> = {
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_PLAN_SCHEMA_VERSION,
    portfolio_id: portfolioId,
    execution_mode: "predeclared_bounded_full_flat_exact_risk_cycle_sequence_v1",
    sequence_reservation_hash: reservationHash,
    initial_cash: 100,
    cycle_count: cycles.length,
    max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    cycles: cycles.map((cycle, index) => ({
      cycle_index: index + 1,
      integrated_plan_hash: cycle.integratedPlan.plan_hash,
      allocation_plan_hash: cycle.allocationPlan.plan_hash,
      risk_plan_hash: cycle.riskPlan.plan_hash,
      earliest_cycle_time: cycle.integratedPlan.initial_allocation_time,
      lane_set_hash: cycle.integratedPlan.lane_set_hash,
    })),
    cash_roll_forward_policy: "cycle_one_initial_then_predecessor_ending_available",
    successor_policy: "strictly_later_after_predecessor_full_flat_release",
    artifact_policy: "fixed_role_dynamic_cycle_payload_then_manifest_last",
    failure_policy: "any_cycle_or_artifact_failure_no_sequence_result_or_artifact",
    limitations: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS,
  }
  return { ...body, plan_hash: replayPortfolioCycleSequencePlanHash(body) }
}

test("independent capital lanes execute in canonical Plan order and aggregate evidence without shared NAV semantics", () => {
  const laneA = laneInput({ laneId: "lane-a", symbol: "BTCUSDT", initialCash: 1000, endingEquity: 1100 })
  const laneB = laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })
  const plan = planFor([laneB, laneA])
  const calls: string[] = []
  const outcome = runReplayIndependentLaneBatch({
    plan,
    lanes: [laneB, laneA],
    execute_lane: executor([laneA, laneB], calls),
  })

  expect(calls).toEqual(["run-lane-a", "run-lane-b"])
  expect(outcome.status).toBe("completed")
  expect(outcome.result?.aggregate_initial_cash).toBe(3000)
  expect(outcome.result?.aggregate_ending_equity).toBe(3000)
  expect(outcome.result?.aggregate_net_pnl).toBe(0)
  expect(outcome.result?.capital_semantics).toBe("isolated_child_cash_not_spendable_portfolio_nav")
  expect(outcome.result?.limitations).toEqual([
    "no_shared_cash_or_rebalancing",
    "no_cross_margin_or_cross_lane_liquidation",
    "no_global_order_priority_or_concurrent_matching",
  ])
  expect(outcome.result?.result_hash).toBe(replayIndependentLaneBatchResultHash(outcome.result!))
  expect(outcome.outcome_hash).toBe(replayIndependentLaneBatchOutcomeHash(outcome))
  expect(() => assertReplayIndependentLaneBatchResult(outcome.result!)).not.toThrow()
  expect(() => assertReplayIndependentLaneBatchOutcome(outcome)).not.toThrow()

  const permuted = runReplayIndependentLaneBatch({
    plan,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB]),
  })
  expect(permuted).toEqual(outcome)
})

test("independent lane failure is all-or-nothing and never publishes a partial batch Result", () => {
  const laneA = laneInput({ laneId: "lane-a", symbol: "BTCUSDT", initialCash: 1000, endingEquity: 1100 })
  const laneB = laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })
  laneB.outcome = {
    ...laneB.outcome,
    status: "failed",
    result: undefined,
    artifact_manifest: undefined,
    failure: {
      code: "replay-execution-failed",
      failure_class: "deterministic_engine",
      message: "fixture failure",
      retryable: false,
      partial_result_published: false,
    },
  }
  const outcome = runReplayIndependentLaneBatch({
    plan: planFor([laneA, laneB]),
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB]),
  })
  expect(outcome.status).toBe("failed")
  expect(outcome.result).toBeNull()
  expect(outcome.failure).toEqual({
    code: "independent-lane-child-not-complete",
    failed_lane_id: "lane-b",
    partial_result_published: false,
  })
  expect(outcome.child_statuses.map((child) => child.status)).toEqual(["completed", "failed"])

  const completedLaneB = laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })
  laneB.outcome = { ...completedLaneB.outcome, artifact_manifest: undefined }
  const incomplete = runReplayIndependentLaneBatch({
    plan: planFor([laneA, laneB]),
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB]),
  })
  expect(incomplete.status).toBe("failed")
  expect(incomplete.failure?.code).toBe("independent-lane-child-evidence-incomplete")
  expect(incomplete.result).toBeNull()
})

test("independent lane Batch rejects Plan, allocation, authority and child evidence tampering", () => {
  const laneA = laneInput({ laneId: "lane-a", symbol: "BTCUSDT", initialCash: 1000, endingEquity: 1100 })
  const laneB = laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })
  const plan = planFor([laneA, laneB])
  expect(() => assertReplayIndependentLaneBatchPlan({ ...plan, batch_id: "forged" })).toThrow("Plan hash mismatch")
  expect(() => assertReplayIndependentLaneBatchPlan({ ...plan, injected: true } as ReplayIndependentLaneBatchPlan)).toThrow("fields are not exact")

  const allocationDrift = structuredClone(plan)
  allocationDrift.lanes[0]!.allocated_initial_cash = 999
  allocationDrift.plan_hash = replayIndependentLaneBatchPlanHash(allocationDrift)
  expect(() => runReplayIndependentLaneBatch({
    plan: allocationDrift,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB]),
  })).toThrow("authority or allocation drift")

  const leaseDrift = structuredClone(laneA)
  leaseDrift.trial.attempt_lease.request_hash = "c".repeat(64)
  const leaseDriftPlan = planFor([leaseDrift, laneB])
  expect(() => runReplayIndependentLaneBatch({
    plan: leaseDriftPlan,
    lanes: [leaseDrift, laneB],
    execute_lane: executor([leaseDrift, laneB]),
  })).toThrow("authority or allocation drift")

  const capitalDrift = structuredClone(laneB)
  capitalDrift.outcome.result!.metrics.ending_equity = 1901
  capitalDrift.outcome.artifact_manifest!.result_hash = canonicalHash(capitalDrift.outcome.result!)
  expect(() => runReplayIndependentLaneBatch({
    plan,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, capitalDrift]),
  })).toThrow("capital conservation")

  laneB.outcome.artifact_manifest = {
    ...laneB.outcome.artifact_manifest!,
    result_hash: "d".repeat(64),
  }
  expect(() => runReplayIndependentLaneBatch({
    plan,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB]),
  })).toThrow("Artifact does not bind its child Result")

  const completed = runReplayIndependentLaneBatch({
    plan,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })]),
  })
  const weakened = structuredClone(completed.result!)
  weakened.limitations = [] as unknown as typeof weakened.limitations
  weakened.result_hash = replayIndependentLaneBatchResultHash(weakened)
  expect(() => assertReplayIndependentLaneBatchResult(weakened)).toThrow("limitations were weakened")
})

test("independent lane Batch requires exact lane coverage and unique symbols", () => {
  const laneA = laneInput({ laneId: "lane-a", symbol: "BTCUSDT", initialCash: 1000, endingEquity: 1100 })
  const laneB = laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })
  const plan = planFor([laneA, laneB])
  expect(() => runReplayIndependentLaneBatch({
    plan,
    lanes: [laneA],
    execute_lane: executor([laneA, laneB]),
  })).toThrow("exactly cover")

  const duplicateSymbol = structuredClone(plan)
  duplicateSymbol.lanes[1]!.symbol = duplicateSymbol.lanes[0]!.symbol
  duplicateSymbol.plan_hash = replayIndependentLaneBatchPlanHash(duplicateSymbol)
  expect(() => assertReplayIndependentLaneBatchPlan(duplicateSymbol)).toThrow("unique run and symbol")
})

test("shared initial capital Batch consumes Control Plane priority without double-counting the cash pool", () => {
  const laneA = laneInput({ laneId: "lane-a", symbol: "BTCUSDT", initialCash: 1000, endingEquity: 1100 })
  const laneB = laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })
  const plan = planFor([laneA, laneB])
  const reservation = sharedCapitalReservation(plan, [laneA, laneB], ["lane-b", "lane-a"])
  const calls: string[] = []
  const outcome = runReplaySharedInitialCapitalBatch({
    plan,
    shared_capital_reservation: reservation,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB], calls),
  })

  expect(calls).toEqual(["run-lane-b", "run-lane-a"])
  expect(outcome.status).toBe("completed")
  expect(outcome.result?.shared_initial_cash).toBe(3000)
  expect(outcome.result?.aggregate_ending_equity).toBe(3000)
  expect(outcome.result?.aggregate_net_pnl).toBe(0)
  expect(outcome.result?.execution_priority).toEqual([
    { lane_id: "lane-b", priority_rank: 1 },
    { lane_id: "lane-a", priority_rank: 2 },
  ])
  expect(outcome.independent_lane_outcome.result?.child_results.map((child) => child.lane_id))
    .toEqual(["lane-a", "lane-b"])
  expect(outcome.result?.result_hash).toBe(replaySharedInitialCapitalBatchResultHash(outcome.result!))
  expect(outcome.outcome_hash).toBe(replaySharedInitialCapitalBatchOutcomeHash(outcome))
  expect(() => assertReplaySharedInitialCapitalBatchOutcome(outcome, reservation)).not.toThrow()

  const reversedAuthority = sharedCapitalReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const reversedCalls: string[] = []
  const reversed = runReplaySharedInitialCapitalBatch({
    plan,
    shared_capital_reservation: reversedAuthority,
    lanes: [laneB, laneA],
    execute_lane: executor([laneA, laneB], reversedCalls),
  })
  expect(reversedCalls).toEqual(["run-lane-a", "run-lane-b"])
  expect(reversed.independent_lane_outcome.result).toEqual(outcome.independent_lane_outcome.result)
  expect(reversed.outcome_hash).not.toBe(outcome.outcome_hash)
})

test("shared initial capital Batch rejects allocation, authority-window and failure overclaims", () => {
  const laneA = laneInput({ laneId: "lane-a", symbol: "BTCUSDT", initialCash: 1000, endingEquity: 1100 })
  const laneB = laneInput({ laneId: "lane-b", symbol: "ETHUSDT", initialCash: 2000, endingEquity: 1900 })
  const plan = planFor([laneA, laneB])
  const allocationDrift = sharedCapitalReservation(
    plan,
    [laneA, laneB],
    ["lane-a", "lane-b"],
    new Map([["lane-a", 999], ["lane-b", 2001]]),
  )
  expect(() => runReplaySharedInitialCapitalBatch({
    plan,
    shared_capital_reservation: allocationDrift,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB]),
  })).toThrow("authority or allocation drift")

  const reservation = sharedCapitalReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const lateLane = structuredClone(laneB)
  lateLane.trial.observed_at = reservation.expires_at
  expect(() => runReplaySharedInitialCapitalBatch({
    plan,
    shared_capital_reservation: reservation,
    lanes: [laneA, lateLane],
    execute_lane: executor([laneA, lateLane]),
  })).toThrow("authority or allocation drift")

  laneB.outcome = {
    ...laneB.outcome,
    status: "failed",
    result: undefined,
    artifact_manifest: undefined,
    failure: {
      code: "replay-execution-failed",
      failure_class: "deterministic_engine",
      message: "fixture failure",
      retryable: false,
      partial_result_published: false,
    },
  }
  const failed = runReplaySharedInitialCapitalBatch({
    plan,
    shared_capital_reservation: reservation,
    lanes: [laneA, laneB],
    execute_lane: executor([laneA, laneB]),
  })
  expect(failed.status).toBe("failed")
  expect(failed.result).toBeNull()
  expect(failed.independent_lane_outcome.result).toBeNull()
  expect(() => assertReplaySharedInitialCapitalBatchOutcome(failed, reservation)).not.toThrow()
})

test("runtime shared wallet commits first Fill and fee before admitting the next same-time Order", () => {
  const laneA = runtimeLaneInput({ laneId: "lane-a", symbol: "BTCUSDT", collateral: 60, feeBps: 100 })
  const laneB = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 40, feeBps: 0 })
  const plan = runtimePlan([laneB, laneA])
  const authority = runtimeReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const outcome = runReplayRuntimeSharedWalletEntrySlice({
    plan,
    runtime_shared_wallet_reservation: authority,
    lanes: [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })

  expect(outcome.status).toBe("completed")
  expect(outcome.result?.global_source_event_queue.map((event) => [event.lane_id, event.admission])).toEqual([
    ["lane-a", "filled"],
    ["lane-b", "rejected"],
  ])
  expect(outcome.result?.global_source_event_queue[0]?.wallet_after).toEqual({
    settled_cash: 99,
    reserved_isolated_collateral: 60,
    available_cash: 39,
  })
  expect(outcome.result?.global_source_event_queue[1]?.required_available_cash).toBe(40)
  expect(outcome.result?.ending_settled_cash).toBe(99)
  expect(outcome.result?.ending_reserved_isolated_collateral).toBe(60)
  expect(outcome.result?.ending_available_cash).toBe(39)
  expect(outcome.result?.portfolio_nav_at_entry_marks).toBe(99)
  expect(outcome.result?.result_hash).toBe(replayRuntimeSharedWalletResultHash(outcome.result!))
  expect(outcome.outcome_hash).toBe(replayRuntimeSharedWalletOutcomeHash(outcome))
  expect(() => assertReplayRuntimeSharedWalletOutcome(outcome, plan, authority)).not.toThrow()
  const tampered = structuredClone(outcome)
  tampered.result!.open_positions[0]!.side = "short"
  tampered.result!.result_hash = replayRuntimeSharedWalletResultHash(tampered.result!)
  tampered.outcome_hash = replayRuntimeSharedWalletOutcomeHash(tampered)
  expect(() => assertReplayRuntimeSharedWalletOutcome(tampered, plan, authority)).toThrow("does not bind its admitted Fill")

  const permuted = runReplayRuntimeSharedWalletEntrySlice({
    plan,
    runtime_shared_wallet_reservation: authority,
    lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(permuted).toEqual(outcome)

  const reversedAuthority = runtimeReservation(plan, [laneA, laneB], ["lane-b", "lane-a"])
  const reversed = runReplayRuntimeSharedWalletEntrySlice({
    plan,
    runtime_shared_wallet_reservation: reversedAuthority,
    lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(reversed.result?.global_source_event_queue.map((event) => [event.lane_id, event.admission])).toEqual([
    ["lane-b", "filled"],
    ["lane-a", "rejected"],
  ])
  expect(reversed.outcome_hash).not.toBe(outcome.outcome_hash)
})

test("runtime shared wallet uses event time before priority and never publishes partial Result on failure", () => {
  const early = runtimeLaneInput({
    laneId: "lane-a",
    symbol: "BTCUSDT",
    collateral: 20,
    feeBps: 0,
    executableTime: "2026-07-14T00:01:30Z",
  })
  const late = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0 })
  const plan = runtimePlan([early, late])
  const authority = runtimeReservation(plan, [early, late], ["lane-b", "lane-a"])
  const lanes = [early, late].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const outcome = runReplayRuntimeSharedWalletEntrySlice({
    plan,
    runtime_shared_wallet_reservation: authority,
    lanes,
  })
  expect(outcome.result?.global_source_event_queue.map((event) => event.lane_id)).toEqual(["lane-a", "lane-b"])

  const failed = runReplayRuntimeSharedWalletEntrySlice({
    plan,
    runtime_shared_wallet_reservation: authority,
    lanes,
    execute_entry_slice: () => { throw new Error("fixture engine failure") },
  })
  expect(failed.status).toBe("failed")
  expect(failed.result).toBeNull()
  expect(failed.failure).toEqual({
    code: "runtime-shared-wallet-engine-failed",
    message: "fixture engine failure",
    partial_result_published: false,
  })

  const unsupported = structuredClone(late)
  unsupported.trial.request.order.entry_execution = {
    order_type: "limit",
    limit_price: 100,
    time_in_force: "gtc",
    liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1",
    full_fill_capacity: 1,
    liquidity_capacity_attestation_hash: HASH,
  }
  unsupported.trial.attempt_lease.request_hash = canonicalHash(unsupported.trial.request)
  const unsupportedPlan = runtimePlan([early, unsupported])
  const unsupportedAuthority = runtimeReservation(unsupportedPlan, [early, unsupported], ["lane-a", "lane-b"])
  const rejected = runReplayRuntimeSharedWalletEntrySlice({
    plan: unsupportedPlan,
    runtime_shared_wallet_reservation: unsupportedAuthority,
    lanes: [early, unsupported].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(rejected.status).toBe("failed")
  expect(rejected.result).toBeNull()
  expect(rejected.failure?.code).toBe("runtime-shared-wallet-input-invalid")
  expect(rejected.failure?.partial_result_published).toBe(false)
})

test("runtime lifecycle commits same-time exit release before a higher-priority new entry", () => {
  const laneA = withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 60, feeBps: 100,
  }))
  const laneB = runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 100, feeBps: 100,
    executableTime: "2026-07-14T00:03:00Z",
  })
  const plan = runtimeLifecyclePlan([laneB, laneA])
  const authority = runtimeLifecycleReservation(plan, [laneA, laneB], ["lane-b", "lane-a"])
  const outcome = runReplayRuntimeSharedWalletLifecycleSlice({
    plan,
    lifecycle_reservation: authority,
    lanes: [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })

  if (!outcome.result) throw new Error(outcome.failure?.message ?? "lifecycle Result missing")
  expect(outcome.status).toBe("completed")
  expect(outcome.result?.global_source_event_queue.map((event) => [event.lane_id, event.event_role, event.outcome]))
    .toEqual([
      ["lane-a", "entry", "filled"],
      ["lane-a", "exit", "filled"],
      ["lane-b", "entry", "filled"],
    ])
  expect(outcome.result?.global_source_event_queue[1]?.wallet_after).toEqual({
    settled_cash: 107.9,
    reserved_isolated_collateral: 0,
    available_cash: 107.9,
  })
  expect(outcome.result?.global_source_event_queue[2]?.required_available_cash).toBe(101)
  expect(outcome.result?.closed_positions.map((position) => position.lane_id)).toEqual(["lane-a"])
  expect(outcome.result?.open_positions.map((position) => position.lane_id)).toEqual(["lane-b"])
  expect(outcome.result?.total_entry_fees).toBe(2)
  expect(outcome.result?.total_exit_fees).toBe(1.1)
  expect(outcome.result?.total_realized_pnl).toBe(10)
  expect(outcome.result?.ending_settled_cash).toBe(106.9)
  expect(outcome.result?.ending_reserved_isolated_collateral).toBe(100)
  expect(outcome.result?.ending_available_cash).toBe(6.9)
  expect(outcome.result?.result_hash).toBe(replayRuntimeSharedWalletLifecycleResultHash(outcome.result!))
  expect(outcome.outcome_hash).toBe(replayRuntimeSharedWalletLifecycleOutcomeHash(outcome))
  expect(() => assertReplayRuntimeSharedWalletLifecycleOutcome(outcome, plan, authority)).not.toThrow()

  const permuted = runReplayRuntimeSharedWalletLifecycleSlice({
    plan,
    lifecycle_reservation: authority,
    lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(permuted).toEqual(outcome)

  const tampered = structuredClone(outcome)
  tampered.result!.closed_positions[0]!.realized_pnl = 9
  tampered.result!.result_hash = replayRuntimeSharedWalletLifecycleResultHash(tampered.result!)
  tampered.outcome_hash = replayRuntimeSharedWalletLifecycleOutcomeHash(tampered)
  expect(() => assertReplayRuntimeSharedWalletLifecycleOutcome(tampered, plan, authority))
    .toThrow("Result capital conservation failed")

  const fillTampered = structuredClone(outcome)
  fillTampered.result!.global_source_event_queue[0]!.fill_hash = HASH
  fillTampered.result!.global_source_event_queue[0]!.event_hash = replayRuntimeSharedWalletLifecycleEventHash(
    fillTampered.result!.global_source_event_queue[0]!,
  )
  fillTampered.result!.result_hash = replayRuntimeSharedWalletLifecycleResultHash(fillTampered.result!)
  fillTampered.outcome_hash = replayRuntimeSharedWalletLifecycleOutcomeHash(fillTampered)
  expect(() => assertReplayRuntimeSharedWalletLifecycleOutcome(fillTampered, plan, authority))
    .toThrow("entry commit is invalid")
})

test("runtime lifecycle keeps an unfunded exit non-economic and publishes no partial Result on failure", () => {
  const laneA = withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 100, feeBps: 100,
  }))
  const laneB = runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
    executableTime: "2026-07-14T00:03:00Z",
  })
  const plan = runtimeLifecyclePlan([laneA, laneB])
  const authority = runtimeLifecycleReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const lanes = [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const outcome = runReplayRuntimeSharedWalletLifecycleSlice({
    plan,
    lifecycle_reservation: authority,
    lanes,
  })
  expect(outcome.result?.global_source_event_queue.map((event) => [event.event_role, event.outcome])).toEqual([
    ["entry", "rejected"],
    ["exit", "not_reached"],
    ["entry", "filled"],
  ])
  expect(outcome.result?.global_source_event_queue[1]?.wallet_before)
    .toEqual(outcome.result?.global_source_event_queue[1]?.wallet_after)
  expect(() => assertReplayRuntimeSharedWalletLifecycleOutcome(outcome, plan, authority)).not.toThrow()

  const failed = runReplayRuntimeSharedWalletLifecycleSlice({
    plan,
    lifecycle_reservation: authority,
    lanes,
    execute_lifecycle_slice: () => { throw new Error("fixture lifecycle engine failure") },
  })
  expect(failed.status).toBe("failed")
  expect(failed.result).toBeNull()
  expect(failed.failure).toEqual({
    code: "runtime-shared-wallet-lifecycle-engine-failed",
    message: "fixture lifecycle engine failure",
    partial_result_published: false,
  })

  const unsupported = structuredClone(laneB)
  unsupported.trial.funding_events = [{}] as ReplayTrialRunInput["funding_events"]
  const unsupportedPlan = runtimeLifecyclePlan([laneA, unsupported])
  const unsupportedAuthority = runtimeLifecycleReservation(
    unsupportedPlan, [laneA, unsupported], ["lane-a", "lane-b"],
  )
  const rejected = runReplayRuntimeSharedWalletLifecycleSlice({
    plan: unsupportedPlan,
    lifecycle_reservation: unsupportedAuthority,
    lanes: [laneA, unsupported].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(rejected.status).toBe("failed")
  expect(rejected.result).toBeNull()
  expect(rejected.failure?.code).toBe("runtime-shared-wallet-lifecycle-input-invalid")
  expect(rejected.failure?.partial_result_published).toBe(false)
})

test("runtime funding settles t-minus cash before same-time exit and later entry admission", () => {
  const laneA = withRuntimeFunding(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 60, feeBps: 100,
  })), [{ timestamp: "2026-07-14T00:03:00Z", rate: 0.01, mark_price: 110 }])
  const laneB = withRuntimeFunding(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 106, feeBps: 100,
    executableTime: "2026-07-14T00:03:00Z",
  }), [{ timestamp: "2026-07-14T00:03:00Z", rate: 0.5, mark_price: 100 }])
  const plan = runtimeFundingPlan([laneB, laneA])
  const authority = runtimeFundingReservation(plan, [laneA, laneB], ["lane-b", "lane-a"])
  const outcome = runReplayRuntimeSharedWalletFundingSlice({
    plan,
    funding_reservation: authority,
    lanes: [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })

  if (!outcome.result) throw new Error(outcome.failure?.message ?? "funding Result missing")
  expect(outcome.result.global_source_event_queue.map((event) => [event.lane_id, event.event_role, event.outcome]))
    .toEqual([
      ["lane-a", "entry", "filled"],
      ["lane-b", "funding", "not_reached"],
      ["lane-a", "funding", "applied"],
      ["lane-a", "exit", "filled"],
      ["lane-b", "entry", "rejected"],
    ])
  expect(outcome.result.global_source_event_queue[2]?.wallet_after).toEqual({
    settled_cash: 97.9,
    reserved_isolated_collateral: 60,
    available_cash: 37.9,
  })
  expect(outcome.result.global_source_event_queue[3]?.wallet_after).toEqual({
    settled_cash: 106.8,
    reserved_isolated_collateral: 0,
    available_cash: 106.8,
  })
  expect(outcome.result.global_source_event_queue[4]).toMatchObject({
    event_role: "entry",
    required_available_cash: 107,
  })
  expect(outcome.result.total_funding_cashflow).toBe(-1.1)
  expect(outcome.result.ending_settled_cash).toBe(106.8)
  expect(outcome.result.ending_reserved_isolated_collateral).toBe(0)
  expect(outcome.result.ending_available_cash).toBe(106.8)
  expect(outcome.result.result_hash).toBe(replayRuntimeSharedWalletFundingResultHash(outcome.result))
  expect(outcome.outcome_hash).toBe(replayRuntimeSharedWalletFundingOutcomeHash(outcome))
  expect(() => assertReplayRuntimeSharedWalletFundingOutcome(outcome, plan, authority)).not.toThrow()
  const tampered = structuredClone(outcome)
  const fundingEvent = tampered.result!.global_source_event_queue[2]!
  if (fundingEvent.event_role !== "funding") throw new Error("fixture funding event missing")
  fundingEvent.funding_cashflow = -1
  fundingEvent.event_hash = replayRuntimeSharedWalletFundingEventHash(fundingEvent)
  tampered.result!.result_hash = replayRuntimeSharedWalletFundingResultHash(tampered.result!)
  tampered.outcome_hash = replayRuntimeSharedWalletFundingOutcomeHash(tampered)
  expect(() => assertReplayRuntimeSharedWalletFundingOutcome(tampered, plan, authority))
    .toThrow("applied event economics are invalid")

  const permuted = runReplayRuntimeSharedWalletFundingSlice({
    plan,
    funding_reservation: authority,
    lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(permuted).toEqual(outcome)

  const zeroA = withRuntimeFunding(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 60, feeBps: 100,
  })), [{ timestamp: "2026-07-14T00:03:00Z", rate: 0, mark_price: 110 }])
  const zeroB = withRuntimeFunding(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 106, feeBps: 100,
    executableTime: "2026-07-14T00:03:00Z",
  }), [{ timestamp: "2026-07-14T00:03:00Z", rate: 0, mark_price: 100 }])
  const zeroPlan = runtimeFundingPlan([zeroA, zeroB])
  const zeroAuthority = runtimeFundingReservation(zeroPlan, [zeroA, zeroB], ["lane-b", "lane-a"])
  const zeroOutcome = runReplayRuntimeSharedWalletFundingSlice({
    plan: zeroPlan,
    funding_reservation: zeroAuthority,
    lanes: [zeroA, zeroB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(zeroOutcome.result?.global_source_event_queue.at(-1)?.outcome).toBe("filled")
  expect(zeroOutcome.result?.ending_available_cash).toBe(0.9)
})

test("runtime funding cashflow is long-short symmetric and bound to frozen exact events", () => {
  const laneA = withRuntimeFunding(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { open: 100 }), [{ timestamp: "2026-07-14T00:02:30Z", rate: 0.01, mark_price: 100 }])
  const laneB = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0 })
  laneB.trial.request.order.side = "short"
  withRuntimeFunding(withRuntimeLifecycleExit(laneB, { open: 100 }), [
    { timestamp: "2026-07-14T00:02:30Z", rate: 0.01, mark_price: 100 },
  ])
  const plan = runtimeFundingPlan([laneA, laneB])
  const authority = runtimeFundingReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const lanes = [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const outcome = runReplayRuntimeSharedWalletFundingSlice({ plan, funding_reservation: authority, lanes })
  expect(outcome.result?.global_source_event_queue.filter((event) => event.event_role === "funding")
    .map((event) => event.funding_cashflow)).toEqual([-1, 1])
  expect(outcome.result?.total_funding_cashflow).toBe(0)
  expect(outcome.result?.ending_settled_cash).toBe(100)
  expect(outcome.result?.ending_available_cash).toBe(100)

  const missing = structuredClone(laneA)
  missing.trial.funding_events = []
  const missingOutcome = runReplayRuntimeSharedWalletFundingSlice({
    plan,
    funding_reservation: authority,
    lanes: [missing, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(missingOutcome.status).toBe("failed")
  expect(missingOutcome.result).toBeNull()
  expect(missingOutcome.failure?.code).toBe("runtime-shared-wallet-funding-input-invalid")

  const duplicateA = structuredClone(laneA)
  duplicateA.trial.funding_events!.push(structuredClone(duplicateA.trial.funding_events![0]!))
  const duplicatePlan = runtimeFundingPlan([duplicateA, laneB])
  const duplicateAuthority = runtimeFundingReservation(
    duplicatePlan, [duplicateA, laneB], ["lane-a", "lane-b"],
  )
  const duplicateOutcome = runReplayRuntimeSharedWalletFundingSlice({
    plan: duplicatePlan,
    funding_reservation: duplicateAuthority,
    lanes: [duplicateA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(duplicateOutcome.status).toBe("failed")
  expect(duplicateOutcome.result).toBeNull()
  expect(duplicateOutcome.failure?.code).toBe("runtime-shared-wallet-funding-input-invalid")

  const failed = runReplayRuntimeSharedWalletFundingSlice({
    plan,
    funding_reservation: authority,
    lanes,
    execute_funding_slice: () => { throw new Error("fixture funding engine failure") },
  })
  expect(failed.status).toBe("failed")
  expect(failed.result).toBeNull()
  expect(failed.failure).toEqual({
    code: "runtime-shared-wallet-funding-engine-failed",
    message: "fixture funding engine failure",
    partial_result_published: false,
  })
})

test("runtime exact risk liquidates before same-time strategy exit and commits cash before later entry", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 80 }), [100, 80, 80])
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 80, feeBps: 0,
    executableTime: "2026-07-14T00:03:00Z",
  }), [100, 100, 100])
  const plan = runtimeRiskPlan([laneB, laneA])
  const authority = runtimeRiskReservation(plan, [laneA, laneB], ["lane-b", "lane-a"])
  const lanes = [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const outcome = runReplayRuntimeSharedWalletRiskSlice({ plan, risk_reservation: authority, lanes })

  if (!outcome.result) throw new Error(outcome.failure?.message ?? "risk Result missing")
  const sameTime = outcome.result.global_source_event_queue
    .filter((event) => event.event_time === "2026-07-14T00:03:00Z")
    .map((event) => [event.lane_id, event.event_role, event.outcome])
  expect(sameTime).toEqual([
    ["lane-b", "funding", "not_reached"],
    ["lane-a", "funding", "applied"],
    ["lane-b", "risk_observation", "not_reached"],
    ["lane-a", "risk_observation", "maintenance_breached"],
    ["lane-a", "liquidation", "filled"],
    ["lane-a", "exit", "not_reached"],
    ["lane-b", "entry", "filled"],
  ])
  const liquidation = outcome.result.global_source_event_queue.find(
    (event) => event.event_role === "liquidation",
  )
  expect(liquidation?.wallet_after).toEqual({
    settled_cash: 80,
    reserved_isolated_collateral: 0,
    available_cash: 80,
  })
  expect(outcome.result.closed_positions).toMatchObject([{
    lane_id: "lane-a", exit_role: "liquidation", exit_price: 80,
    realized_pnl: -20, liquidation_fee: 0,
  }])
  expect(outcome.result.open_positions.map((position) => position.lane_id)).toEqual(["lane-b"])
  expect(outcome.result.liquidation_count).toBe(1)
  expect(outcome.result.total_realized_pnl).toBe(-20)
  expect(outcome.result.ending_settled_cash).toBe(80)
  expect(outcome.result.ending_reserved_isolated_collateral).toBe(80)
  expect(outcome.result.ending_available_cash).toBe(0)
  expect(outcome.result.ending_portfolio_nav).toBe(80)
  expect(outcome.result.result_hash).toBe(replayRuntimeSharedWalletRiskResultHash(outcome.result))
  expect(outcome.outcome_hash).toBe(replayRuntimeSharedWalletRiskOutcomeHash(outcome))
  expect(() => assertReplayRuntimeSharedWalletRiskOutcome(outcome, plan, authority)).not.toThrow()

  const permuted = runReplayRuntimeSharedWalletRiskSlice({
    plan,
    risk_reservation: authority,
    lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(permuted).toEqual(outcome)

  const tampered = structuredClone(outcome)
  const riskEvent = tampered.result!.global_source_event_queue.find(
    (event) => event.event_role === "risk_observation" && event.outcome === "maintenance_breached",
  )
  if (!riskEvent || riskEvent.event_role !== "risk_observation") throw new Error("fixture risk event missing")
  riskEvent.margin_balance = 1
  riskEvent.event_hash = replayRuntimeSharedWalletRiskEventHash(riskEvent)
  const forced = tampered.result!.global_source_event_queue.find((event) => event.event_role === "liquidation")
  if (!forced || forced.event_role !== "liquidation") throw new Error("fixture liquidation event missing")
  forced.trigger_risk_event_hash = riskEvent.event_hash
  forced.event_hash = replayRuntimeSharedWalletRiskEventHash(forced)
  tampered.result!.result_hash = replayRuntimeSharedWalletRiskResultHash(tampered.result!)
  tampered.outcome_hash = replayRuntimeSharedWalletRiskOutcomeHash(tampered)
  expect(() => assertReplayRuntimeSharedWalletRiskOutcome(tampered, plan, authority))
    .toThrow("observation economics are invalid")

  const haltedA = structuredClone(laneA)
  haltedA.trial.dataset_manifest.instrument.status_epochs[0]!.status = "halted"
  const haltedDataHash = canonicalHash({
    bars: haltedA.trial.bars,
    funding_events: haltedA.trial.funding_events,
    mark_events: haltedA.trial.mark_events,
    supplemental_facts: [],
  })
  haltedA.trial.dataset_manifest.data_hash = haltedDataHash
  haltedA.trial.request.dataset_hash = haltedDataHash
  haltedA.trial.attempt_lease.request_hash = canonicalHash(haltedA.trial.request)
  const haltedPlan = runtimeRiskPlan([haltedA, laneB])
  const haltedAuthority = runtimeRiskReservation(haltedPlan, [haltedA, laneB], ["lane-b", "lane-a"])
  const halted = runReplayRuntimeSharedWalletRiskSlice({
    plan: haltedPlan,
    risk_reservation: haltedAuthority,
    lanes: [haltedA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(halted.status).toBe("failed")
  expect(halted.result).toBeNull()
  expect(halted.failure?.code).toBe("runtime-shared-wallet-risk-engine-failed")
  expect(halted.failure?.message).toContain("while instrument is halted")
})

test("runtime exact-risk liquidation is direction symmetric and fails closed on source or deficit drift", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 23, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 100 }), [100, 80, 80])
  const laneB = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 23, feeBps: 0 })
  laneB.trial.request.order.side = "short"
  withRuntimeRisk(withRuntimeLifecycleExit(laneB, {
    executableTime: "2026-07-14T00:03:00Z", open: 100,
  }), [100, 120, 120])
  const plan = runtimeRiskPlan([laneA, laneB])
  const authority = runtimeRiskReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const lanes = [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const outcome = runReplayRuntimeSharedWalletRiskSlice({ plan, risk_reservation: authority, lanes })
  expect(outcome.status).toBe("completed")
  expect(outcome.result?.closed_positions.map((position) => [
    position.side, position.exit_role, position.realized_pnl,
  ])).toEqual([
    ["long", "liquidation", -20],
    ["short", "liquidation", -20],
  ])
  expect(outcome.result?.liquidation_count).toBe(2)
  expect(outcome.result?.ending_settled_cash).toBe(60)
  expect(outcome.result?.ending_available_cash).toBe(60)

  const missing = structuredClone(laneA)
  missing.trial.mark_events!.pop()
  const missingOutcome = runReplayRuntimeSharedWalletRiskSlice({
    plan,
    risk_reservation: authority,
    lanes: [missing, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(missingOutcome.status).toBe("failed")
  expect(missingOutcome.result).toBeNull()
  expect(missingOutcome.failure?.code).toBe("runtime-shared-wallet-risk-input-invalid")

  const deficitA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 15, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 100 }), [100, 80, 80])
  const deficitPlan = runtimeRiskPlan([deficitA, laneB])
  const deficitAuthority = runtimeRiskReservation(deficitPlan, [deficitA, laneB], ["lane-a", "lane-b"])
  const deficit = runReplayRuntimeSharedWalletRiskSlice({
    plan: deficitPlan,
    risk_reservation: deficitAuthority,
    lanes: [deficitA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(deficit.status).toBe("failed")
  expect(deficit.result).toBeNull()
  expect(deficit.failure?.code).toBe("runtime-shared-wallet-risk-engine-failed")
  expect(deficit.failure?.message).toContain("unsupported isolated deficit")

  const failed = runReplayRuntimeSharedWalletRiskSlice({
    plan,
    risk_reservation: authority,
    lanes,
    execute_risk_slice: () => { throw new Error("fixture exact-risk engine failure") },
  })
  expect(failed.status).toBe("failed")
  expect(failed.result).toBeNull()
  expect(failed.failure).toEqual({
    code: "runtime-shared-wallet-risk-engine-failed",
    message: "fixture exact-risk engine failure",
    partial_result_published: false,
  })
})

test("Portfolio Allocation collects same-time entries before Fill and enforces gross, absolute-net, and risk caps", () => {
  const laneA = runtimeLaneInput({ laneId: "lane-a", symbol: "BTCUSDT", collateral: 10, feeBps: 0 })
  const laneB = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 10, feeBps: 0 })
  const plan = portfolioAllocationPlan([laneB, laneA])
  const authority = portfolioAllocationReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const lanes = [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const outcome = runReplayPortfolioAllocationSlice({ plan, allocation_reservation: authority, lanes })

  if (!outcome.result) throw new Error(outcome.failure?.message ?? "Portfolio Allocation Result missing")
  expect(outcome.result.allocation_cycles).toHaveLength(1)
  expect(outcome.result.allocation_cycles[0]?.opening_wallet).toEqual({
    settled_cash: 100, reserved_isolated_collateral: 0, available_cash: 100,
  })
  expect(outcome.result.allocation_cycles[0]?.decisions.map((decision) => [
    decision.lane_id, decision.entry_notional, decision.requested_risk_amount,
    decision.candidate_gross_exposure, decision.candidate_net_exposure,
    decision.allocation, decision.allocation_reason,
  ])).toEqual([
    ["lane-a", 100, 10, 100, 100, "admitted", "all_limits_satisfied"],
    ["lane-b", 100, 10, 200, 200, "rejected", "absolute_net_exposure_limit_exceeded"],
  ])
  expect(outcome.result.global_source_event_queue.map((event) => [
    event.lane_id, event.admission, event.admission_reason,
  ])).toEqual([
    ["lane-a", "filled", "allocation_admitted_and_fill_committed"],
    ["lane-b", "rejected", "absolute_net_exposure_limit_exceeded"],
  ])
  expect(outcome.result).toMatchObject({
    rejected_lane_ids: ["lane-b"],
    ending_available_cash: 90,
    ending_gross_exposure: 100,
    ending_net_exposure: 100,
    ending_portfolio_risk: 10,
  })
  expect(outcome.result.result_hash).toBe(replayPortfolioAllocationResultHash(outcome.result))
  expect(outcome.outcome_hash).toBe(replayPortfolioAllocationOutcomeHash(outcome))
  expect(() => assertReplayPortfolioAllocationOutcome(outcome, plan, authority)).not.toThrow()

  const permuted = runReplayPortfolioAllocationSlice({
    plan,
    allocation_reservation: authority,
    lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(permuted).toEqual(outcome)
  const swappedAuthority = portfolioAllocationReservation(plan, [laneA, laneB], ["lane-b", "lane-a"])
  const swapped = runReplayPortfolioAllocationSlice({
    plan, allocation_reservation: swappedAuthority, lanes,
  })
  expect(swapped.result?.open_positions.map((position) => position.lane_id)).toEqual(["lane-b"])

  const shortB = structuredClone(laneB)
  shortB.trial.request.order.side = "short"
  shortB.trial.request.order.stop_price = 110
  const hedgedPlan = portfolioAllocationPlan([laneA, shortB])
  const hedgedAuthority = portfolioAllocationReservation(hedgedPlan, [laneA, shortB], ["lane-a", "lane-b"])
  const hedged = runReplayPortfolioAllocationSlice({
    plan: hedgedPlan,
    allocation_reservation: hedgedAuthority,
    lanes: [shortB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(hedged.result).toMatchObject({
    rejected_lane_ids: [], ending_gross_exposure: 200, ending_net_exposure: 0, ending_portfolio_risk: 20,
  })
})

test("Portfolio Allocation rejection precedence and rehashed semantic tamper fail closed without partial Result", () => {
  const laneA = runtimeLaneInput({ laneId: "lane-a", symbol: "BTCUSDT", collateral: 60, feeBps: 0 })
  const laneB = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 60, feeBps: 0 })
  laneB.trial.request.order.side = "short"
  laneB.trial.request.order.stop_price = 110
  const plan = portfolioAllocationPlan([laneA, laneB])
  const lanes = [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))

  const cashAuthority = portfolioAllocationReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const cash = runReplayPortfolioAllocationSlice({ plan, allocation_reservation: cashAuthority, lanes })
  expect(cash.result?.allocation_cycles[0]?.decisions[1]?.allocation_reason)
    .toBe("insufficient_available_cash")

  const grossAuthority = portfolioAllocationReservation(
    plan, [laneA, laneB], ["lane-a", "lane-b"], { gross: 150, net: 100 },
  )
  const gross = runReplayPortfolioAllocationSlice({ plan, allocation_reservation: grossAuthority, lanes })
  expect(gross.result?.allocation_cycles[0]?.decisions[1]?.allocation_reason)
    .toBe("insufficient_available_cash")

  const lowCollateralA = runtimeLaneInput({ laneId: "lane-a", symbol: "BTCUSDT", collateral: 10, feeBps: 0 })
  const lowCollateralB = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 10, feeBps: 0 })
  lowCollateralB.trial.request.order.side = "short"
  lowCollateralB.trial.request.order.stop_price = 110
  const boundedPlan = portfolioAllocationPlan([lowCollateralA, lowCollateralB])
  const boundedLanes = [lowCollateralA, lowCollateralB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const grossOnlyAuthority = portfolioAllocationReservation(
    boundedPlan, [lowCollateralA, lowCollateralB], ["lane-a", "lane-b"], { gross: 150, net: 100 },
  )
  const grossOnly = runReplayPortfolioAllocationSlice({
    plan: boundedPlan, allocation_reservation: grossOnlyAuthority, lanes: boundedLanes,
  })
  expect(grossOnly.result?.allocation_cycles[0]?.decisions[1]?.allocation_reason)
    .toBe("gross_exposure_limit_exceeded")
  const portfolioRiskAuthority = portfolioAllocationReservation(
    boundedPlan, [lowCollateralA, lowCollateralB], ["lane-a", "lane-b"], { risk: 15 },
  )
  const portfolioRisk = runReplayPortfolioAllocationSlice({
    plan: boundedPlan, allocation_reservation: portfolioRiskAuthority, lanes: boundedLanes,
  })
  expect(portfolioRisk.result?.allocation_cycles[0]?.decisions[1]?.allocation_reason)
    .toBe("portfolio_risk_limit_exceeded")
  const laneRiskAuthority = portfolioAllocationReservation(
    boundedPlan, [lowCollateralA, lowCollateralB], ["lane-a", "lane-b"], {
      laneRisk: { "lane-a": 9, "lane-b": 15 },
    },
  )
  const laneRisk = runReplayPortfolioAllocationSlice({
    plan: boundedPlan, allocation_reservation: laneRiskAuthority, lanes: boundedLanes,
  })
  expect(laneRisk.result?.allocation_cycles[0]?.decisions[0]?.allocation_reason)
    .toBe("lane_risk_limit_exceeded")

  const costLaneA = runtimeLaneInput({ laneId: "lane-a", symbol: "BTCUSDT", collateral: 10, feeBps: 100 })
  const costLaneB = runtimeLaneInput({ laneId: "lane-b", symbol: "ETHUSDT", collateral: 10, feeBps: 0 })
  costLaneA.trial.request.cost_policy.slippage_bps = 100
  const costPlan = portfolioAllocationPlan([costLaneA, costLaneB])
  const costAuthority = portfolioAllocationReservation(
    costPlan, [costLaneA, costLaneB], ["lane-a", "lane-b"], {
      gross: 500, net: 500, risk: 50, laneRisk: { "lane-a": 20, "lane-b": 20 },
    },
  )
  const costOutcome = runReplayPortfolioAllocationSlice({
    plan: costPlan,
    allocation_reservation: costAuthority,
    lanes: [costLaneB, costLaneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  expect(costOutcome.result?.allocation_cycles[0]?.decisions[0]).toMatchObject({
    execution_price: 101,
    protective_stop_execution_price: 89.1,
    entry_fee: 1.01,
    protective_stop_exit_fee: 0.9,
    price_loss_at_protective_stop: 11.9,
    requested_risk_amount: 13.81,
  })

  const tampered = structuredClone(portfolioRisk)
  const decision = tampered.result!.allocation_cycles[0]!.decisions[1]!
  decision.allocation_reason = "all_limits_satisfied"
  decision.decision_hash = replayPortfolioAllocationDecisionHash(decision)
  tampered.result!.allocation_cycles[0]!.cycle_hash = replayPortfolioAllocationCycleHash(
    tampered.result!.allocation_cycles[0]!,
  )
  tampered.result!.result_hash = replayPortfolioAllocationResultHash(tampered.result!)
  tampered.outcome_hash = replayPortfolioAllocationOutcomeHash(tampered)
  expect(() => assertReplayPortfolioAllocationOutcome(tampered, boundedPlan, portfolioRiskAuthority))
    .toThrow("Decision gate")

  const failed = runReplayPortfolioAllocationSlice({
    plan: boundedPlan,
    allocation_reservation: portfolioRiskAuthority,
    lanes: boundedLanes,
    execute_allocation_slice: () => { throw new Error("fixture Portfolio Allocation Engine failure") },
  })
  expect(failed).toMatchObject({
    status: "failed",
    result: null,
    failure: { code: "portfolio-allocation-engine-failed", partial_result_published: false },
  })
})

test("integrated Portfolio makes Allocation the only entry authority and releases exposure/risk through lifecycle Artifact", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 100 }), [100, 120, 120])
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
  }), [100, 100, 100])
  const allocationBase = portfolioAllocationPlan([laneA, laneB])
  const allocationPlanBody = { ...allocationBase, portfolio_id: "portfolio-integrated-1" }
  const allocationPlan = {
    ...allocationPlanBody,
    plan_hash: replayPortfolioAllocationPlanHash(allocationPlanBody),
  }
  const riskBase = runtimeRiskPlan([laneA, laneB])
  const riskPlanBody = { ...riskBase, portfolio_id: "portfolio-integrated-1" }
  const riskPlan = { ...riskPlanBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskPlanBody) }
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, [laneA, laneB], ["lane-a", "lane-b"], { gross: 200, net: 100, risk: 25 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, [laneA, laneB], ["lane-a", "lane-b"])
  const plan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  const lanes = [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const root = mkdtempSync(join(tmpdir(), "replay-integrated-portfolio-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    const outcome = runReplayIntegratedPortfolio({
      integrated_plan: plan,
      allocation_plan: allocationPlan,
      allocation_reservation: allocationAuthority,
      risk_plan: riskPlan,
      risk_reservation: riskAuthority,
      lanes,
      artifact_store: store,
    })
    if (!outcome.result || !outcome.risk_result || !outcome.artifact?.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "integrated Portfolio Result missing")
    }
    const entries = outcome.risk_result.global_source_event_queue.filter((event) => event.event_role === "entry")
    expect(entries.map((event) => [event.lane_id, event.outcome, event.outcome_reason])).toEqual([
      ["lane-a", "filled", "allocation_admitted_and_fill_committed"],
      ["lane-b", "rejected", "absolute_net_exposure_limit_exceeded"],
    ])
    expect(outcome.risk_result.open_positions).toEqual([])
    expect(outcome.risk_result.closed_positions.map((position) => position.lane_id)).toEqual(["lane-a"])
    const rejectedTransition = outcome.result.state_chain.find(
      (transition) => transition.event_role === "entry" && transition.lane_id === "lane-b",
    )!
    expect(rejectedTransition).toMatchObject({
      gross_exposure_before: 100, gross_exposure_after: 100,
      net_exposure_before: 100, net_exposure_after: 100,
      portfolio_risk_before: 10, portfolio_risk_after: 10,
    })
    const exitTransition = outcome.result.state_chain.find(
      (transition) => transition.event_role === "exit" && transition.lane_id === "lane-a",
    )!
    expect(exitTransition).toMatchObject({
      gross_exposure_before: 100, gross_exposure_after: 0,
      net_exposure_before: 100, net_exposure_after: 0,
      portfolio_risk_before: 10, portfolio_risk_after: 0,
    })
    expect(outcome.result).toMatchObject({
      ending_available_cash: 100,
      ending_gross_exposure: 0,
      ending_net_exposure: 0,
      ending_portfolio_risk: 0,
    })
    expect(outcome.result.result_hash).toBe(replayIntegratedPortfolioResultHash(outcome.result))
    const recordedAllocation = JSON.parse(new TextDecoder().decode(store.openAttempt({
      idempotency_key_hash: canonicalHash({ integrated_plan_hash: plan.plan_hash }),
      attempt_id_hash: outcome.result.result_hash,
    }).read("allocation-result.json").bytes))
    expect(() => assertReplayIntegratedPortfolioResult(
      outcome.result!, plan, recordedAllocation, outcome.risk_result!,
    )).not.toThrow()
    const tampered = structuredClone(outcome.result)
    tampered.state_chain.at(-1)!.gross_exposure_after = 1
    tampered.state_chain.at(-1)!.transition_hash = replayIntegratedPortfolioTransitionHash(
      tampered.state_chain.at(-1)!,
    )
    tampered.state_chain_hash = canonicalHash(tampered.state_chain)
    tampered.ending_gross_exposure = 1
    tampered.result_hash = replayIntegratedPortfolioResultHash(tampered)
    expect(() => assertReplayIntegratedPortfolioResult(tampered, plan, recordedAllocation, outcome.risk_result!))
      .toThrow("Result binding/conservation")
    expect(outcome.artifact.artifact_manifest.files.map((file) => file.role)).toEqual([
      "integrated_plan", "allocation_reservation", "allocation_result", "risk_reservation", "risk_result",
      "portfolio_evidence", "integrated_state_chain", "integrated_fingerprint", "integrated_result",
    ])

    const retry = runReplayIntegratedPortfolio({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority, lanes, artifact_store: store,
    })
    expect(retry.result).toEqual(outcome.result)
    expect(retry.artifact?.idempotent_replay).toBe(true)

    const revaluationInput = {
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority, lanes, artifact_store: store,
    }
    const revaluation = runReplayPortfolioMarkRiskRevaluation(revaluationInput)
    if (!revaluation.evidence || !revaluation.artifact_manifest) {
      throw new Error(revaluation.failure?.message ?? "Portfolio Mark Risk Revaluation missing")
    }
    const exactMark = revaluation.evidence.transitions.find((transition) =>
      transition.event_time === "2026-07-14T00:03:00Z"
      && transition.event_role === "risk_observation" && transition.lane_id === "lane-a")!
    expect(exactMark).toMatchObject({
      revaluation_kind: "exact_mark",
      gross_mark_exposure_before: 100,
      gross_mark_exposure_after: 120,
      net_mark_exposure_before: 100,
      net_mark_exposure_after: 120,
      portfolio_frozen_stop_risk_before: 10,
      portfolio_frozen_stop_risk_after: 10,
      portfolio_prospective_stop_drawdown_before: 10,
      portfolio_prospective_stop_drawdown_after: 30,
      cap_breaches_after: ["absolute_net_exposure_limit_breached"],
      cap_effect: "observation_only_no_automatic_liquidation_or_reallocation",
    })
    expect(revaluation.evidence).toMatchObject({
      ending_gross_mark_exposure: 0,
      ending_net_mark_exposure: 0,
      ending_portfolio_frozen_stop_risk: 0,
      ending_portfolio_prospective_stop_drawdown: 0,
    })
    expect(revaluation.artifact_manifest.files.map((file) => file.role)).toEqual([
      "integrated_result", "integrated_artifact_manifest", "allocation_reservation", "allocation_result",
      "risk_result", "revaluation_transitions", "revaluation_fingerprint", "revaluation_evidence",
    ])
    const revaluationRetry = runReplayPortfolioMarkRiskRevaluation(revaluationInput)
    expect(revaluationRetry.evidence).toEqual(revaluation.evidence)
    expect(revaluationRetry.idempotent_replay).toBe(true)
    const revaluationPublishFailure = runReplayPortfolioMarkRiskRevaluation({
      ...revaluationInput,
      publish_revaluation_artifact: () => { throw new Error("fixture revaluation Artifact failure") },
    })
    expect(revaluationPublishFailure).toMatchObject({
      status: "failed", integrated_result: null, evidence: null, artifact_manifest: null,
      failure: { code: "mark-risk-revaluation-artifact-failed", partial_result_published: false },
    })
    const tamperedRevaluation = structuredClone(revaluation.evidence)
    tamperedRevaluation.transitions[0]!.cap_effect = "changed" as never
    tamperedRevaluation.transitions[0]!.transition_hash = replayPortfolioMarkRiskTransitionHash(
      tamperedRevaluation.transitions[0]!,
    )
    expect(() => assertReplayPortfolioMarkRiskRevaluationEvidence(tamperedRevaluation))
      .toThrow("transition chain")

    const failed = runReplayIntegratedPortfolio({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority, lanes, artifact_store: store,
      execute_risk_slice: () => { throw new Error("fixture integrated risk failure") },
    })
    expect(failed).toMatchObject({
      status: "failed", result: null, risk_result: null, artifact: null,
      failure: { code: "integrated-risk-failed", partial_result_published: false },
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Portfolio initial protective stop owns a same-open gap before strategy exit", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 85 }), [100, 100, 100])
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
  }), [100, 100, 100])
  const allocationDraft = portfolioAllocationPlan([laneA, laneB])
  const allocationBody = { ...allocationDraft, portfolio_id: "portfolio-protective-terminal-1" }
  const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
  const riskDraft = runtimeRiskPlan([laneA, laneB])
  const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
  const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, [laneA, laneB], ["lane-a", "lane-b"], { gross: 200, net: 100, risk: 25 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, [laneA, laneB], ["lane-a", "lane-b"])
  const plan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  const lanes = [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial }))
  const root = mkdtempSync(join(tmpdir(), "replay-portfolio-protective-terminal-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    const input = {
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority, lanes, artifact_store: store,
    }
    const outcome = runReplayPortfolioProtectiveTerminal(input)
    if (!outcome.evidence || !outcome.artifact_manifest || !outcome.integrated_result) {
      throw new Error(outcome.failure?.message ?? "Portfolio Protective Terminal missing")
    }
    const laneRecord = outcome.evidence.lane_records.find((record) => record.lane_id === "lane-a")!
    const upstreamExit = runReplayIntegratedPortfolio(input).risk_result?.global_source_event_queue.find(
      (event) => event.lane_id === "lane-a" && event.event_role === "exit" && event.outcome === "filled",
    )
    expect(laneRecord).toMatchObject({
      owner: "initial_protective_stop",
      terminal_time: "2026-07-14T00:03:00Z",
      terminal_phase: 20,
      resolution_status: "exact_under_ohlc",
      realized_pnl: -15,
      exit_trading_fee: 0,
      liquidation_fee: 0,
      released_collateral: 20,
      ending_open: false,
      preempted_upstream_terminal_hash: upstreamExit?.event_hash,
    })
    expect(outcome.evidence.ohlcv_resolutions[0]).toMatchObject({
      observation_kind: "bar_open_gap",
      canonical: { terminal_role: "stop" },
    })
    expect(outcome.evidence).toMatchObject({
      shared_initial_cash: 100,
      ending_settled_cash: 85,
      ending_reserved_isolated_collateral: 0,
      ending_available_cash: 85,
      ending_portfolio_nav: 85,
      ending_gross_mark_exposure: 0,
      ending_net_mark_exposure: 0,
      ending_portfolio_frozen_stop_risk: 0,
      terminal_owner_counts: {
        not_opened: 1, initial_protective_stop: 1, initial_take_profit: 0,
        exact_liquidation: 0, strategy_exit: 0, open_at_data_end: 0,
      },
    })
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "integrated_artifact_manifest", "mark_risk_revaluation_artifact_manifest", "allocation_result",
      "risk_result", "protective_terminal_records", "ohlcv_resolutions",
      "protective_terminal_fingerprint", "protective_terminal_evidence",
    ])
    const retry = runReplayPortfolioProtectiveTerminal(input)
    expect(retry.evidence).toEqual(outcome.evidence)
    expect(retry.idempotent_replay).toBe(true)
    const failed = runReplayPortfolioProtectiveTerminal({
      ...input,
      publish_protective_terminal_artifact: () => { throw new Error("fixture protective terminal publish failure") },
    })
    expect(failed).toMatchObject({
      status: "failed", integrated_result: null, evidence: null, artifact_manifest: null,
      failure: { code: "protective-terminal-artifact-failed", partial_result_published: false },
    })
    const tampered = structuredClone(outcome.evidence)
    tampered.lane_records.find((record) => record.lane_id === "lane-a")!.owner = "strategy_exit"
    tampered.lane_records.find((record) => record.lane_id === "lane-a")!.record_hash =
      replayPortfolioProtectiveTerminalRecordHash(
        tampered.lane_records.find((record) => record.lane_id === "lane-a")!,
      )
    tampered.lane_records_hash = canonicalHash(tampered.lane_records)
    tampered.fingerprint.lane_records_hash = tampered.lane_records_hash
    tampered.fingerprint.fingerprint_hash = replayPortfolioProtectiveTerminalFingerprintHash(tampered.fingerprint)
    tampered.evidence_hash = replayPortfolioProtectiveTerminalEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveTerminalEvidence(tampered)).toThrow("record semantics")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Portfolio bracket resolves target-only exactly and same-bar collision stop-first", () => {
  const cases = [
    { id: "target", side: "long", stop: 90, target: 120, high: 121, low: 99,
      owner: "initial_take_profit", status: "exact_under_ohlc", cash: 120 },
    { id: "collision", side: "long", stop: 90, target: 120, high: 121, low: 89,
      owner: "initial_protective_stop", status: "resolution_limited", cash: 90 },
    { id: "short-collision", side: "short", stop: 110, target: 80, high: 111, low: 79,
      owner: "initial_protective_stop", status: "resolution_limited", cash: 90 },
  ] as const
  for (const item of cases) {
    const baseA = runtimeLaneInput({ laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0 })
    Object.assign(baseA.trial.request.order, {
      side: item.side,
      stop_price: item.stop,
      target_price: item.target,
    })
    baseA.trial.bars[0]!.high = item.high
    baseA.trial.bars[0]!.low = item.low
    const laneA = withRuntimeRisk(withRuntimeLifecycleExit(baseA, {
      executableTime: "2026-07-14T00:03:00Z", open: 100,
    }), [100, 100, 100])
    const laneB = withRuntimeRisk(runtimeLaneInput({
      laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
    }), [100, 100, 100])
    const allocationDraft = portfolioAllocationPlan([laneA, laneB])
    const allocationBody = { ...allocationDraft, portfolio_id: `portfolio-protective-${item.id}-1` }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan([laneA, laneB])
    const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    const allocationAuthority = portfolioAllocationReservation(
      allocationPlan, [laneA, laneB], ["lane-a", "lane-b"], { gross: 100, net: 100, risk: 25 },
    )
    const riskAuthority = runtimeRiskReservation(riskPlan, [laneA, laneB], ["lane-a", "lane-b"])
    const plan = integratedPortfolioPlan(
      allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
    )
    const root = mkdtempSync(join(tmpdir(), `replay-portfolio-protective-${item.id}-`))
    try {
      const outcome = runReplayPortfolioProtectiveTerminal({
        integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
        risk_plan: riskPlan, risk_reservation: riskAuthority,
        lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
        artifact_store: createReplayLocalArtifactStore(root),
      })
      if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "protective terminal missing")
      expect(outcome.evidence.lane_records.find((record) => record.lane_id === "lane-a")).toMatchObject({
        owner: item.owner,
        terminal_time: "2026-07-14T00:02:59.999Z",
        terminal_phase: 20,
        resolution_status: item.status,
        ending_open: false,
      })
      expect(outcome.evidence.ohlcv_resolutions[0]).toMatchObject({
        observation_kind: "bar_range_touch",
        status: item.status,
        canonical: { terminal_role: item.owner === "initial_take_profit" ? "target" : "stop" },
      })
      expect(outcome.evidence.ending_settled_cash).toBe(item.cash)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("Portfolio terminal integrates one predeclared tighten-only protective stop replacement", () => {
  const cases = [
    { id: "long", side: "long" as const, stop: 90, target: 120, replacement: 95, nextOpen: 94, cash: 94 },
    { id: "short", side: "short" as const, stop: 110, target: 80, replacement: 105, nextOpen: 106, cash: 94 },
  ] as const
  for (const item of cases) {
    const baseA = runtimeLaneInput({ laneId: `lane-${item.id}`, symbol: "BTCUSDT", collateral: 20, feeBps: 0 })
    Object.assign(baseA.trial.request.order, {
      side: item.side,
      stop_price: item.stop,
      target_price: item.target,
    })
    const laneA = withRuntimeRisk(withRuntimeProtectiveStopReplacement(baseA, {
      newStopPrice: item.replacement,
      nextOpen: item.nextOpen,
    }), [100, 100, 100])
    const laneB = withRuntimeRisk(runtimeLaneInput({
      laneId: `lane-${item.id}-rejected`, symbol: "ETHUSDT", collateral: 20, feeBps: 0,
    }), [100, 100, 100])
    const allocationDraft = portfolioAllocationPlan([laneA, laneB])
    const allocationBody = { ...allocationDraft, portfolio_id: `portfolio-stop-replacement-${item.id}` }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan([laneA, laneB])
    const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    const allocationAuthority = portfolioAllocationReservation(
      allocationPlan, [laneA, laneB], [laneA.lane_id, laneB.lane_id],
      { gross: 100, net: 100, risk: 25 },
    )
    const riskAuthority = runtimeRiskReservation(riskPlan, [laneA, laneB], [laneA.lane_id, laneB.lane_id])
    const plan = integratedPortfolioPlan(
      allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
    )
    const root = mkdtempSync(join(tmpdir(), `replay-portfolio-stop-replacement-${item.id}-`))
    try {
      const input = {
        integrated_plan: plan,
        allocation_plan: allocationPlan,
        allocation_reservation: allocationAuthority,
        risk_plan: riskPlan,
        risk_reservation: riskAuthority,
        lanes: [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
        artifact_store: createReplayLocalArtifactStore(root),
      }
      expect(runReplayIntegratedPortfolio(input)).toMatchObject({
        status: "failed",
        failure: { code: "integrated-risk-failed", partial_result_published: false },
      })
      const outcome = runReplayPortfolioProtectiveStopReplacementTerminal(input)
      if (!outcome.evidence || !outcome.artifact_manifest || !outcome.source_protective_terminal_evidence) {
        throw new Error(outcome.failure?.message ?? "replacement terminal missing")
      }
      const record = outcome.evidence.lane_records.find((candidate) => candidate.lane_id === laneA.lane_id)!
      expect(record).toMatchObject({
        owner: "replacement_protective_stop",
        replacement_status: "activated_then_terminal",
        previous_stop_price: item.stop,
        active_stop_price: item.replacement,
        active_protection_generation: 2,
        terminal_phase: 20,
        realized_pnl: -6,
        ending_open: false,
      })
      expect(outcome.evidence.ohlcv_resolutions[0]).toMatchObject({
        observation_kind: "bar_open_gap",
        active_protection: {
          protection_generation: 2,
          stop_trigger_price: item.replacement,
        },
        canonical: { terminal_role: "stop" },
      })
      expect(outcome.evidence).toMatchObject({
        ending_settled_cash: item.cash,
        ending_available_cash: item.cash,
        terminal_owner_counts: { replacement_protective_stop: 1, not_opened: 1 },
      })
      expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
        "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
        "replacement_terminal_records", "ohlcv_resolutions", "replacement_terminal_fingerprint",
        "replacement_terminal_evidence",
      ])
      const accounting = runReplayPortfolioProtectiveStopReplacementTerminalAccounting(input)
      if (!accounting.evidence || !accounting.artifact_manifest || !accounting.replacement_terminal_evidence) {
        throw new Error(accounting.failure?.message ?? "replacement terminal accounting missing")
      }
      expect(accounting.evidence.ledger.map((entry) => [
        entry.cashflow_kind, entry.amount, entry.settled_cash_after, entry.terminal_owner,
      ])).toEqual([["realized_pnl", -6, 94, "replacement_protective_stop"]])
      expect(accounting.evidence.journal.map((entry) => entry.posting_kind)).toEqual([
        "opening_cash", "collateral_reserve", "realized_pnl", "collateral_release",
      ])
      expect(accounting.evidence.trial_balance).toMatchObject({
        total_debits: 146,
        total_credits: 146,
        ending_available_cash: 94,
        ending_reserved_isolated_collateral: 0,
        ending_settled_cash: 94,
        ending_unrealized_pnl: 0,
        ending_portfolio_nav: 94,
        balanced: true,
        balances: {
          wallet_cash: 94,
          isolated_margin_collateral: 0,
          opening_equity: 100,
          realized_pnl_loss: 6,
        },
      })
      expect(accounting.evidence.excluded_preempted_source_hashes).toHaveLength(1)
      expect(accounting.artifact_manifest.files.map((file) => file.role)).toEqual([
        "replacement_terminal_artifact_manifest", "risk_result", "replacement_terminal_evidence",
        "replacement_terminal_ledger", "replacement_terminal_journal",
        "replacement_terminal_trial_balance", "replacement_terminal_accounting_fingerprint",
        "replacement_terminal_accounting_evidence",
      ])
      const accountingRetry = runReplayPortfolioProtectiveStopReplacementTerminalAccounting(input)
      expect(accountingRetry.evidence).toEqual(accounting.evidence)
      expect(accountingRetry.idempotent_replay).toBe(true)
      const risk = runReplayIntegratedPortfolio({
        ...input,
        allow_predeclared_protective_stop_replacement_projection: true,
      }).risk_result!
      expect(() => assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence(
        accounting.evidence!, {
          replacement_terminal_evidence: accounting.replacement_terminal_evidence!,
          replacement_terminal_manifest: outcome.artifact_manifest!,
          risk_result: risk,
        },
      )).not.toThrow()
      const accountingPublishFailure = runReplayPortfolioProtectiveStopReplacementTerminalAccounting({
        ...input,
        publish_replacement_terminal_accounting_artifact: () => {
          throw new Error("fixture replacement terminal accounting Artifact failure")
        },
      })
      expect(accountingPublishFailure).toMatchObject({
        status: "failed", replacement_terminal_evidence: null, evidence: null, artifact_manifest: null,
        failure: { code: "replacement-terminal-accounting-artifact-failed", partial_result_published: false },
      })
      if (item.id === "long") {
        const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-replacement-accounting-interrupted-"))
        try {
          const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
          const interrupted = runReplayPortfolioProtectiveStopReplacementTerminalAccounting({
            ...input,
            artifact_store: failWriteOnce(interruptedBase, "replacement-terminal-journal.json"),
          })
          expect(interrupted).toMatchObject({
            status: "failed", replacement_terminal_evidence: null, evidence: null, artifact_manifest: null,
            failure: {
              code: "replacement-terminal-accounting-artifact-failed",
              partial_result_published: false,
            },
          })
          const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
            namespace.listNames().includes("replacement-terminal-ledger.json"))
          expect(orphan?.exists(
            "portfolio-protective-stop-replacement-terminal-accounting-artifact-manifest.json",
          )).toBe(false)
        } finally {
          rmSync(interruptedRoot, { recursive: true, force: true })
        }
      }
      const tamperedAccounting = structuredClone(accounting.evidence)
      tamperedAccounting.ledger[0]!.terminal_owner = "strategy_exit"
      tamperedAccounting.ledger[0]!.ledger_entry_hash =
        replayPortfolioProtectiveStopReplacementTerminalAccountingLedgerEntryHash(
          tamperedAccounting.ledger[0]!,
        )
      tamperedAccounting.fingerprint.ledger_hash = canonicalHash(tamperedAccounting.ledger)
      tamperedAccounting.fingerprint.fingerprint_hash =
        replayPortfolioProtectiveStopReplacementTerminalAccountingFingerprintHash(
          tamperedAccounting.fingerprint,
        )
      tamperedAccounting.evidence_hash =
        replayPortfolioProtectiveStopReplacementTerminalAccountingEvidenceHash(tamperedAccounting)
      expect(() => assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence(
        tamperedAccounting, {
          replacement_terminal_evidence: accounting.replacement_terminal_evidence!,
          replacement_terminal_manifest: outcome.artifact_manifest!,
          risk_result: risk,
        },
      )).toThrow("ledger record binding")
      const retry = runReplayPortfolioProtectiveStopReplacementTerminal(input)
      expect(retry.evidence).toEqual(outcome.evidence)
      expect(retry.idempotent_replay).toBe(true)
      expect(() => assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(outcome.evidence!, {
        evidence: outcome.source_protective_terminal_evidence!,
        manifest: runReplayPortfolioProtectiveTerminal({
          ...input,
          allow_predeclared_protective_stop_replacement_projection: true,
        }).artifact_manifest!,
        risk_result_hash: outcome.evidence!.risk_result_hash,
      })).not.toThrow()
      const failed = runReplayPortfolioProtectiveStopReplacementTerminal({
        ...input,
        publish_replacement_terminal_artifact: () => {
          throw new Error("fixture replacement terminal Artifact failure")
        },
      })
      expect(failed).toMatchObject({
        status: "failed", source_protective_terminal_evidence: null, evidence: null, artifact_manifest: null,
        failure: { code: "replacement-terminal-artifact-failed", partial_result_published: false },
      })
      const tampered = structuredClone(outcome.evidence)
      const tamperedRecord = tampered.lane_records.find((candidate) => candidate.lane_id === laneA.lane_id)!
      tamperedRecord.active_stop_price = item.stop
      tamperedRecord.record_hash = replayPortfolioProtectiveStopReplacementTerminalRecordHash(tamperedRecord)
      tampered.lane_records_hash = canonicalHash(tampered.lane_records)
      tampered.fingerprint.lane_records_hash = tampered.lane_records_hash
      tampered.fingerprint.fingerprint_hash =
        replayPortfolioProtectiveStopReplacementTerminalFingerprintHash(tampered.fingerprint)
      tampered.evidence_hash = replayPortfolioProtectiveStopReplacementTerminalEvidenceHash(tampered)
      expect(() => assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(tampered))
        .toThrow("record semantics")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("Portfolio close-time replacement cannot outrun the same boundary market terminal", () => {
  const laneA = withRuntimeRisk(withRuntimeProtectiveStopReplacement(runtimeLaneInput({
    laneId: "lane-replacement-race", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { newStopPrice: 95, sameBoundaryLow: 89 }), [100, 100, 100])
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-replacement-race-rejected", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
  }), [100, 100, 100])
  const allocationDraft = portfolioAllocationPlan([laneA, laneB])
  const allocationBody = { ...allocationDraft, portfolio_id: "portfolio-stop-replacement-race" }
  const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
  const riskDraft = runtimeRiskPlan([laneA, laneB])
  const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
  const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, [laneA, laneB], [laneA.lane_id, laneB.lane_id], { gross: 100, net: 100, risk: 25 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, [laneA, laneB], [laneA.lane_id, laneB.lane_id])
  const plan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  const root = mkdtempSync(join(tmpdir(), "replay-portfolio-stop-replacement-race-"))
  try {
    const outcome = runReplayPortfolioProtectiveStopReplacementTerminal({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: createReplayLocalArtifactStore(root),
    })
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "replacement race missing")
    expect(outcome.evidence.lane_records.find((record) => record.lane_id === laneA.lane_id)).toMatchObject({
      owner: "initial_protective_stop",
      replacement_status: "terminal_before_or_at_decision",
      active_protection_generation: 1,
      active_stop_price: 90,
      terminal_time: laneA.trial.request.decision_schedule.entries[0]!.decision_time,
    })
    expect(outcome.evidence.terminal_owner_counts.replacement_protective_stop).toBe(0)
    const accounting = runReplayPortfolioProtectiveStopReplacementTerminalAccounting({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: createReplayLocalArtifactStore(root),
    })
    expect(accounting.evidence?.ledger).toEqual([
      expect.objectContaining({
        cashflow_kind: "realized_pnl",
        amount: -10,
        settled_cash_after: 90,
        terminal_owner: "initial_protective_stop",
      }),
    ])
    expect(accounting.evidence?.trial_balance).toMatchObject({
      ending_available_cash: 90,
      ending_settled_cash: 90,
      ending_portfolio_nav: 90,
      balanced: true,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Portfolio protective terminal accounting posts only the winning owner and excludes later funding", () => {
  const baseA = runtimeLaneInput({ laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 100 })
  baseA.trial.bars[0]!.low = 89
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(baseA, {
    executableTime: "2026-07-14T00:03:00Z", open: 100,
  }), [100, 100, 100], { fundingRate: 0.01 })
  const baseB = runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
  })
  Object.assign(baseB.trial.request.order, { side: "short", stop_price: 110, target_price: 80 })
  const laneB = withRuntimeRisk(baseB, [100, 105, 105])
  const allocationDraft = portfolioAllocationPlan([laneA, laneB])
  const allocationBody = { ...allocationDraft, portfolio_id: "portfolio-protective-accounting-1" }
  const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
  const riskDraft = runtimeRiskPlan([laneA, laneB])
  const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
  const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, [laneA, laneB], ["lane-a", "lane-b"], { gross: 200, net: 100, risk: 25 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, [laneA, laneB], ["lane-a", "lane-b"])
  const plan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  const root = mkdtempSync(join(tmpdir(), "replay-portfolio-protective-accounting-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-portfolio-protective-accounting-interrupted-"))
  try {
    const input = {
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: createReplayLocalArtifactStore(root),
    }
    const outcome = runReplayPortfolioProtectiveTerminalAccounting(input)
    if (!outcome.evidence || !outcome.protective_terminal_evidence || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "Protective Terminal Accounting missing")
    }
    expect(outcome.protective_terminal_evidence.lane_records.find((record) => record.lane_id === "lane-a"))
      .toMatchObject({
        owner: "initial_protective_stop", terminal_time: "2026-07-14T00:02:59.999Z",
        funding_cashflow_before_terminal: 0, entry_fee: 1, realized_pnl: -10,
        exit_trading_fee: 0.9, released_collateral: 20,
      })
    expect(outcome.evidence.ledger.map((entry) => [
      entry.cashflow_kind, entry.amount, entry.settled_cash_after, entry.terminal_owner,
    ])).toEqual([
      ["entry_fee", -1, 99, "initial_protective_stop"],
      ["realized_pnl", -10, 89, "initial_protective_stop"],
      ["terminal_trading_fee", -0.9, 88.1, "initial_protective_stop"],
    ])
    expect(outcome.evidence.journal.map((entry) => entry.posting_kind)).toEqual([
      "opening_cash", "collateral_reserve", "entry_fee", "collateral_reserve", "realized_pnl",
      "terminal_trading_fee", "collateral_release", "terminal_mark_to_market",
    ])
    expect(outcome.evidence.trial_balance).toMatchObject({
      total_debits: 176.9,
      total_credits: 176.9,
      ending_available_cash: 68.1,
      ending_reserved_isolated_collateral: 20,
      ending_settled_cash: 88.1,
      ending_unrealized_pnl: -5,
      ending_portfolio_nav: 83.1,
      balanced: true,
    })
    expect(outcome.evidence.excluded_preempted_source_hashes).toHaveLength(1)
    expect(outcome.evidence.excluded_post_terminal_funding_source_hashes).toHaveLength(1)
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "protective_terminal_artifact_manifest", "risk_result", "protective_terminal_evidence",
      "protective_terminal_ledger", "protective_terminal_journal", "protective_terminal_trial_balance",
      "protective_terminal_accounting_fingerprint", "protective_terminal_accounting_evidence",
    ])

    const retry = runReplayPortfolioProtectiveTerminalAccounting(input)
    expect(retry.evidence).toEqual(outcome.evidence)
    expect(retry.idempotent_replay).toBe(true)
    const failed = runReplayPortfolioProtectiveTerminalAccounting({
      ...input,
      publish_protective_terminal_accounting_artifact: () => {
        throw new Error("fixture protective terminal accounting publish failure")
      },
    })
    expect(failed).toMatchObject({
      status: "failed", protective_terminal_evidence: null, evidence: null, artifact_manifest: null,
      failure: { code: "protective-terminal-accounting-artifact-failed", partial_result_published: false },
    })
    const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
    const interrupted = runReplayPortfolioProtectiveTerminalAccounting({
      ...input,
      artifact_store: failWriteOnce(interruptedBase, "protective-terminal-journal.json"),
    })
    expect(interrupted).toMatchObject({
      status: "failed", protective_terminal_evidence: null, evidence: null, artifact_manifest: null,
      failure: { code: "protective-terminal-accounting-artifact-failed", partial_result_published: false },
    })
    const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
      namespace.listNames().includes("protective-terminal-ledger.json"))
    expect(orphan?.exists("portfolio-protective-terminal-accounting-artifact-manifest.json")).toBe(false)

    const risk = runReplayIntegratedPortfolio(input).risk_result
    if (!risk) throw new Error("Integrated risk source missing")
    const tampered = structuredClone(outcome.evidence)
    tampered.ledger[0]!.terminal_owner = "strategy_exit"
    tampered.ledger[0]!.ledger_entry_hash = replayPortfolioProtectiveTerminalAccountingLedgerEntryHash(
      tampered.ledger[0]!,
    )
    tampered.fingerprint.ledger_hash = canonicalHash(tampered.ledger)
    tampered.fingerprint.fingerprint_hash = replayPortfolioProtectiveTerminalAccountingFingerprintHash(
      tampered.fingerprint,
    )
    tampered.evidence_hash = replayPortfolioProtectiveTerminalAccountingEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveTerminalAccountingEvidence(tampered, {
      protective_terminal_evidence: outcome.protective_terminal_evidence!,
      protective_terminal_manifest: runReplayPortfolioProtectiveTerminal(input).artifact_manifest!,
      risk_result: risk,
    })).toThrow("ledger record binding")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(interruptedRoot, { recursive: true, force: true })
  }
})

test("integrated Portfolio liquidation releases the frozen Allocation exposure/risk without reviving rejected entries", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 110 }), [100, 80, 80])
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
  }), [100, 100, 100])
  const allocationDraft = portfolioAllocationPlan([laneA, laneB])
  const allocationBody = { ...allocationDraft, portfolio_id: "portfolio-integrated-liquidation-1" }
  const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
  const riskDraft = runtimeRiskPlan([laneA, laneB])
  const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
  const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, [laneA, laneB], ["lane-a", "lane-b"], { net: 100 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, [laneA, laneB], ["lane-a", "lane-b"])
  const plan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  const root = mkdtempSync(join(tmpdir(), "replay-integrated-liquidation-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    const outcome = runReplayIntegratedPortfolio({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: store,
    })
    if (!outcome.result || !outcome.risk_result) throw new Error(outcome.failure?.message ?? "missing Result")
    expect(outcome.risk_result.global_source_event_queue
      .filter((event) => event.event_time === "2026-07-14T00:03:00Z")
      .map((event) => [event.lane_id, event.event_role, event.outcome])).toEqual([
      ["lane-a", "funding", "applied"], ["lane-b", "funding", "not_reached"],
      ["lane-a", "risk_observation", "maintenance_breached"],
      ["lane-b", "risk_observation", "not_reached"],
      ["lane-a", "liquidation", "filled"], ["lane-a", "exit", "not_reached"],
    ])
    const liquidation = outcome.result.state_chain.find((transition) => transition.event_role === "liquidation")!
    expect(liquidation).toMatchObject({
      gross_exposure_before: 100, gross_exposure_after: 0,
      net_exposure_before: 100, net_exposure_after: 0,
      portfolio_risk_before: 10, portfolio_risk_after: 0,
    })
    expect(outcome.result).toMatchObject({
      ending_available_cash: 80, ending_gross_exposure: 0, ending_net_exposure: 0, ending_portfolio_risk: 0,
    })
    expect(outcome.risk_result.rejected_lane_ids).toEqual(["lane-b"])
    expect(outcome.risk_result.open_positions).toEqual([])
    const revaluation = runReplayPortfolioMarkRiskRevaluation({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: store,
    })
    if (!revaluation.evidence) throw new Error(revaluation.failure?.message ?? "revaluation Evidence missing")
    const crossed = revaluation.evidence.transitions.find((transition) =>
      transition.event_role === "risk_observation" && transition.lane_id === "lane-a"
      && transition.positions_after[0]?.stop_relation
        === "crossed_or_equal_without_portfolio_stop_execution")!
    expect(crossed).toMatchObject({
      revaluation_kind: "exact_mark",
      portfolio_prospective_stop_drawdown_after: null,
      resolution_limited_lane_ids_after: ["lane-a"],
      cap_effect: "observation_only_no_automatic_liquidation_or_reallocation",
    })
    expect(revaluation.evidence.transitions.find((transition) =>
      transition.transition_sequence > crossed.transition_sequence
      && transition.event_role === "liquidation" && transition.lane_id === "lane-a")).toMatchObject({
      event_role: "liquidation",
      revaluation_kind: "full_close_release",
      positions_after: [],
    })
    expect(revaluation.evidence.transitions.map((transition) => transition.source_event_hash))
      .toEqual(outcome.risk_result.global_source_event_queue.map((event) => event.event_hash))
    const protective = runReplayPortfolioProtectiveTerminal({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: store,
    })
    if (!protective.evidence) throw new Error(protective.failure?.message ?? "protective terminal missing")
    expect(protective.evidence.lane_records.find((record) => record.lane_id === "lane-a")).toMatchObject({
      owner: "exact_liquidation",
      terminal_time: "2026-07-14T00:03:00Z",
      terminal_phase: 15,
      ohlcv_resolution_evidence_hash: null,
      resolution_status: "not_applicable",
      realized_pnl: -20,
      ending_open: false,
    })
    expect(protective.evidence.terminal_owner_counts.exact_liquidation).toBe(1)
    const accounting = runReplayPortfolioProtectiveTerminalAccounting({
      integrated_plan: plan, allocation_plan: allocationPlan, allocation_reservation: allocationAuthority,
      risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: store,
    })
    if (!accounting.evidence) throw new Error(accounting.failure?.message ?? "liquidation accounting missing")
    expect(accounting.evidence.ledger.map((entry) => [
      entry.cashflow_kind, entry.amount, entry.terminal_owner, entry.boundary_phase,
    ])).toEqual([["realized_pnl", -20, "exact_liquidation", 15]])
    expect(accounting.evidence.journal.map((entry) => entry.posting_kind)).toEqual([
      "opening_cash", "collateral_reserve", "realized_pnl", "collateral_release",
    ])
    expect(accounting.evidence.trial_balance).toMatchObject({
      ending_available_cash: 80, ending_reserved_isolated_collateral: 0,
      ending_settled_cash: 80, ending_portfolio_nav: 80, balanced: true,
    })
    expect(accounting.evidence.excluded_preempted_source_hashes).toEqual([])
    expect(accounting.evidence.excluded_post_terminal_funding_source_hashes).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Portfolio Reallocation admits exactly one second Allocation cycle after committed full-flat release", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 100 }), [100, 100, 100])
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 0,
  }), [100, 100, 100])
  const firstAllocationDraft = portfolioAllocationPlan([laneA, laneB])
  const firstAllocationBody = { ...firstAllocationDraft, portfolio_id: "portfolio-reallocation-1" }
  const firstAllocationPlan = {
    ...firstAllocationBody, plan_hash: replayPortfolioAllocationPlanHash(firstAllocationBody),
  }
  const firstRiskDraft = runtimeRiskPlan([laneA, laneB])
  const firstRiskBody = { ...firstRiskDraft, portfolio_id: firstAllocationPlan.portfolio_id }
  const firstRiskPlan = { ...firstRiskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(firstRiskBody) }
  const firstAllocationAuthority = portfolioAllocationReservation(
    firstAllocationPlan, [laneA, laneB], ["lane-a", "lane-b"], { net: 100 },
  )
  const firstRiskAuthority = runtimeRiskReservation(firstRiskPlan, [laneA, laneB], ["lane-a", "lane-b"])
  const integratedPlan = integratedPortfolioPlan(
    firstAllocationPlan, firstAllocationAuthority.reservation_hash,
    firstRiskPlan, firstRiskAuthority.reservation_hash,
  )
  const root = mkdtempSync(join(tmpdir(), "replay-portfolio-reallocation-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    const predecessor = runReplayIntegratedPortfolio({
      integrated_plan: integratedPlan,
      allocation_plan: firstAllocationPlan,
      allocation_reservation: firstAllocationAuthority,
      risk_plan: firstRiskPlan,
      risk_reservation: firstRiskAuthority,
      lanes: [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: store,
    })
    if (!predecessor.result || !predecessor.artifact?.artifact_manifest) {
      throw new Error(predecessor.failure?.message ?? "predecessor Result missing")
    }

    const cycle2MarkTimes: [string, string, string] = [
      "2026-07-14T00:04:00Z", "2026-07-14T00:05:00Z", "2026-07-14T00:06:00Z",
    ]
    const laneC = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
      laneId: "lane-c", symbol: "SOLUSDT", collateral: 20, feeBps: 0,
      executableTime: "2026-07-14T00:04:00Z",
    }), { executableTime: "2026-07-14T00:05:00Z", open: 100 }), [100, 100, 100], {
      markTimes: cycle2MarkTimes,
    })
    const laneD = withRuntimeRisk(runtimeLaneInput({
      laneId: "lane-d", symbol: "BNBUSDT", collateral: 20, feeBps: 0,
      executableTime: "2026-07-14T00:04:00Z",
    }), [100, 100, 100], { markTimes: cycle2MarkTimes })
    for (const lane of [laneC, laneD]) lane.trial.observed_at = "2026-07-14T00:03:50Z"
    const secondDraft = portfolioAllocationPlan([laneC, laneD])
    const secondBody = { ...secondDraft, portfolio_id: integratedPlan.portfolio_id }
    const secondPlan = { ...secondBody, plan_hash: replayPortfolioAllocationPlanHash(secondBody) }
    const byId = new Map([laneC, laneD].map((lane) => [lane.lane_id, lane]))
    const reservation = createReplayPortfolioReallocationReservationSnapshot({
      schema_version: REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
      reservation_id: "portfolio-reallocation-1",
      reservation_ref: "reservation://portfolio-reallocation/1",
      issued_at: "2026-07-14T00:03:10Z",
      expires_at: "2026-07-14T00:04:30Z",
      status: "reserved",
      authority_id: "research-control-plane",
      experiment_id: "experiment-1",
      trial_group_id: "trial-group-1",
      trial_group_hash: HASH,
      portfolio_id: integratedPlan.portfolio_id,
      portfolio_plan_hash: secondPlan.plan_hash,
      settlement_asset: "USDT",
      portfolio_initial_cash: 100,
      predecessor_integrated_result_hash: predecessor.result.result_hash,
      predecessor_artifact_manifest_hash: predecessor.artifact.artifact_manifest.manifest_hash,
      reallocation_cycle: 2,
      earliest_reallocation_time: "2026-07-14T00:04:00Z",
      opening_cash_policy: "predecessor_ending_available_cash_after_full_flat_release",
      eligibility_policy: "all_predecessor_positions_closed_and_exposure_risk_zero",
      allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1",
      max_gross_exposure_amount: 200,
      max_abs_net_exposure_amount: 100,
      max_portfolio_risk_amount: 25,
      lanes: ["lane-c", "lane-d"].map((laneId, index) => {
        const lane = byId.get(laneId)!
        return {
          lane_id: laneId,
          priority_rank: index + 1,
          trial_id: lane.trial.request.trial_id,
          run_id: lane.trial.request.run_id,
          trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
          trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
          max_lane_risk_amount: 15,
        }
      }),
      limitations: [
        "second_cycle_only_after_authoritative_full_flat_release",
        "opening_cash_derived_from_predecessor_result_not_control_plane_estimate",
        "no_third_cycle_partial_cross_margin_borrow_or_fast",
      ],
    })
    const plan = portfolioReallocationPlan({
      portfolioId: integratedPlan.portfolio_id,
      predecessorResultHash: predecessor.result.result_hash,
      predecessorManifestHash: predecessor.artifact.artifact_manifest.manifest_hash,
      reservationHash: reservation.reservation_hash,
      allocationPlan: secondPlan,
    })
    const input = {
      plan, reservation, predecessor, allocation_plan: secondPlan,
      lanes: [laneD, laneC].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: store,
    }
    const outcome = runReplayPortfolioReallocation(input)
    if (!outcome.result || !outcome.allocation_result || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "Reallocation Result missing")
    }
    expect(outcome.result).toMatchObject({
      reallocation_cycle: 2,
      predecessor_full_flat_time: "2026-07-14T00:03:00Z",
      opening_available_cash: 100,
      cycle_2_event_time: "2026-07-14T00:04:00Z",
      ending_gross_exposure: 100,
      ending_net_exposure: 100,
      ending_portfolio_risk: 10,
    })
    expect(outcome.allocation_result.global_source_event_queue.map((event) => [event.lane_id, event.admission])).toEqual([
      ["lane-c", "filled"], ["lane-d", "rejected"],
    ])
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "reallocation_plan", "reallocation_reservation", "predecessor_integrated_result",
      "predecessor_artifact_manifest", "cycle_2_allocation_plan", "cycle_2_allocation_result",
      "reallocation_result",
    ])
    const retry = runReplayPortfolioReallocation(input)
    expect(retry.result).toEqual(outcome.result)
    expect(retry.idempotent_replay).toBe(true)

    const secondRiskDraft = runtimeRiskPlan([laneC, laneD])
    const secondRiskBody = { ...secondRiskDraft, portfolio_id: integratedPlan.portfolio_id }
    const secondRiskPlan = {
      ...secondRiskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(secondRiskBody),
    }
    const secondRiskAuthority = runtimeRiskReservation(
      secondRiskPlan, [laneC, laneD], ["lane-c", "lane-d"], {
        issuedAt: "2026-07-14T00:03:40Z",
        expiresAt: "2026-07-14T00:04:30Z",
        sharedInitialCash: predecessor.result.ending_available_cash,
      },
    )
    const twoCyclePlan = twoCyclePortfolioPlan({
      portfolioId: integratedPlan.portfolio_id,
      cycle1ResultHash: predecessor.result.result_hash,
      cycle1ManifestHash: predecessor.artifact.artifact_manifest.manifest_hash,
      reallocationResultHash: outcome.result.result_hash,
      reallocationManifestHash: outcome.artifact_manifest.manifest_hash,
      allocationPlanHash: secondPlan.plan_hash,
      allocationResultHash: outcome.allocation_result.result_hash,
      riskPlanHash: secondRiskPlan.plan_hash,
      riskReservationHash: secondRiskAuthority.reservation_hash,
    })
    const twoCycleInput = {
      plan: twoCyclePlan,
      cycle_1: predecessor,
      cycle_2_reallocation_plan: plan,
      cycle_2_reallocation_reservation: reservation,
      cycle_2_reallocation: outcome,
      cycle_2_allocation_plan: secondPlan,
      cycle_2_risk_plan: secondRiskPlan,
      cycle_2_risk_reservation: secondRiskAuthority,
      cycle_2_lanes: [laneD, laneC].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: store,
    }
    const twoCycle = runReplayTwoCyclePortfolio(twoCycleInput)
    if (!twoCycle.result || !twoCycle.cycle_2_risk_result || !twoCycle.artifact_manifest) {
      throw new Error(twoCycle.failure?.message ?? "Two-Cycle Result missing")
    }
    expect(twoCycle.cycle_2_risk_result.global_source_event_queue
      .filter((event) => event.event_role === "entry" || event.event_role === "exit")
      .map((event) => [event.lane_id, event.event_role, event.outcome])).toEqual([
      ["lane-c", "entry", "filled"], ["lane-d", "entry", "rejected"],
      ["lane-c", "exit", "filled"],
    ])
    expect(twoCycle.result).toMatchObject({
      cycle_1_ending_available_cash: 100,
      cycle_2_opening_available_cash: 100,
      ending_available_cash: 100,
      ending_gross_exposure: 0,
      ending_net_exposure: 0,
      ending_portfolio_risk: 0,
    })
    expect(twoCycle.result.result_hash).toBe(replayTwoCyclePortfolioResultHash(twoCycle.result))
    expect(twoCycle.result.state_chain.map((transition) => transition.cycle)).toContain(1)
    expect(twoCycle.result.state_chain.map((transition) => transition.cycle)).toContain(2)
    expect(twoCycle.artifact_manifest.files.map((file) => file.role)).toEqual([
      "two_cycle_plan", "cycle_1_integrated_result", "cycle_1_artifact_manifest",
      "cycle_2_reallocation_result", "cycle_2_reallocation_manifest", "cycle_2_allocation_plan",
      "cycle_2_allocation_result", "cycle_2_risk_plan", "cycle_2_risk_reservation",
      "cycle_2_risk_result", "cycle_2_portfolio_evidence", "two_cycle_state_chain",
      "two_cycle_fingerprint", "two_cycle_result",
    ])
    const twoCycleRetry = runReplayTwoCyclePortfolio(twoCycleInput)
    expect(twoCycleRetry.result).toEqual(twoCycle.result)
    expect(twoCycleRetry.idempotent_replay).toBe(true)
    const twoCycleFailure = runReplayTwoCyclePortfolio({
      ...twoCycleInput,
      execute_risk_slice: () => { throw new Error("fixture cycle-2 Risk Engine failure") },
    })
    expect(twoCycleFailure).toMatchObject({
      status: "failed", result: null, cycle_2_risk_result: null, artifact_manifest: null,
      failure: { code: "cycle-2-risk-failed", partial_result_published: false },
    })
    const authorityDriftPlan = structuredClone(twoCyclePlan)
    authorityDriftPlan.cycle_2_risk_reservation_hash = "1".repeat(64)
    authorityDriftPlan.plan_hash = replayTwoCyclePortfolioPlanHash(authorityDriftPlan)
    const authorityDrift = runReplayTwoCyclePortfolio({ ...twoCycleInput, plan: authorityDriftPlan })
    expect(authorityDrift).toMatchObject({
      status: "failed", result: null, cycle_2_risk_result: null, artifact_manifest: null,
      failure: { code: "two-cycle-input-invalid", partial_result_published: false },
    })

    const notFlat = structuredClone(predecessor)
    notFlat.result!.ending_gross_exposure = 1
    notFlat.result!.result_hash = replayIntegratedPortfolioResultHash(notFlat.result!)
    const rejected = runReplayPortfolioReallocation({ ...input, predecessor: notFlat })
    expect(rejected).toMatchObject({
      status: "failed", result: null, allocation_result: null, artifact_manifest: null,
      failure: { code: "reallocation-input-invalid", partial_result_published: false },
    })
    const engineFailure = runReplayPortfolioReallocation({
      ...input,
      execute_allocation_slice: () => { throw new Error("fixture second Allocation Engine failure") },
    })
    expect(engineFailure).toMatchObject({
      status: "failed", result: null, allocation_result: null, artifact_manifest: null,
      failure: { code: "reallocation-allocation-failed", partial_result_published: false },
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("bounded Cycle Sequence executes one, two, and three predeclared full-flat cycles without cycle-number schemas", () => {
  const definitions = [
    {
      ids: ["lane-seq-a", "lane-seq-b"], symbols: ["BTCUSDT", "ETHUSDT"],
      entry: "2026-07-14T00:01:00Z", exit: "2026-07-14T00:03:00Z",
      exitOpen: 110,
      marks: ["2026-07-14T00:01:00Z", "2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"],
    },
    {
      ids: ["lane-seq-c", "lane-seq-d"], symbols: ["SOLUSDT", "BNBUSDT"],
      entry: "2026-07-14T00:04:00Z", exit: "2026-07-14T00:05:00Z",
      exitOpen: 100,
      marks: ["2026-07-14T00:04:00Z", "2026-07-14T00:05:00Z", "2026-07-14T00:06:00Z"],
    },
    {
      ids: ["lane-seq-e", "lane-seq-f"], symbols: ["XRPUSDT", "ADAUSDT"],
      entry: "2026-07-14T00:07:00Z", exit: "2026-07-14T00:08:00Z",
      exitOpen: 100,
      marks: ["2026-07-14T00:07:00Z", "2026-07-14T00:08:00Z", "2026-07-14T00:09:00Z"],
    },
  ] as const
  const portfolioId = "portfolio-cycle-sequence-1"
  const fixtures = definitions.map((definition) => {
    const primary = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
      laneId: definition.ids[0], symbol: definition.symbols[0], collateral: 20, feeBps: 0,
      executableTime: definition.entry,
    }), { executableTime: definition.exit, open: definition.exitOpen }), [100, 100, 100], {
      markTimes: [...definition.marks] as [string, string, string],
    })
    const rejected = withRuntimeRisk(runtimeLaneInput({
      laneId: definition.ids[1], symbol: definition.symbols[1], collateral: 20, feeBps: 0,
      executableTime: definition.entry,
    }), [100, 100, 100], { markTimes: [...definition.marks] as [string, string, string] })
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: portfolioId }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: portfolioId }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    return { lanes, allocationPlan, riskPlan, entry: definition.entry }
  })
  const buildInput = (count: number, store: ReplayArtifactStore) => {
    const selected = fixtures.slice(0, count)
    const reservation = createReplayPortfolioCycleSequenceReservationSnapshot({
      schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
      reservation_id: `cycle-sequence-${count}`,
      reservation_ref: `reservation://cycle-sequence/${count}`,
      issued_at: "2026-07-14T00:00:30Z",
      expires_at: "2026-07-14T00:10:00Z",
      status: "reserved",
      authority_id: "research-control-plane",
      experiment_id: "experiment-1",
      trial_group_id: "trial-group-1",
      trial_group_hash: HASH,
      portfolio_id: portfolioId,
      settlement_asset: "USDT",
      initial_cash: 100,
      cycle_count: count,
      max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
      opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
      successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
      expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
      cycles: selected.map((fixture, index) => ({
        cycle_index: index + 1,
        allocation_plan_hash: fixture.allocationPlan.plan_hash,
        risk_plan_hash: fixture.riskPlan.plan_hash,
        earliest_cycle_time: fixture.entry,
        max_gross_exposure_amount: 200,
        max_abs_net_exposure_amount: 100,
        max_portfolio_risk_amount: 25,
        lanes: fixture.lanes.map((lane, laneIndex) => ({
          lane_id: lane.lane_id,
          priority_rank: laneIndex + 1,
          trial_id: lane.trial.request.trial_id,
          run_id: lane.trial.request.run_id,
          trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
          trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
          max_lane_risk_amount: 15,
        })),
      })),
      limitations: [
        "one_to_eight_predeclared_full_flat_cycles_only",
        "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
        "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
      ],
    })
    const planned = selected.map((fixture) => ({
      ...fixture,
      integratedPlan: integratedPortfolioPlan(
        fixture.allocationPlan, reservation.reservation_hash,
        fixture.riskPlan, reservation.reservation_hash,
      ),
    }))
    const plan = cycleSequencePlan(portfolioId, reservation.reservation_hash, planned)
    return {
      plan,
      reservation,
      cycles: planned.map((fixture, index) => ({
        cycle_index: index + 1,
        integrated_plan: fixture.integratedPlan,
        allocation_plan: fixture.allocationPlan,
        risk_plan: fixture.riskPlan,
        lanes: [...fixture.lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      })),
      artifact_store: store,
    }
  }
  const root = mkdtempSync(join(tmpdir(), "replay-cycle-sequence-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    for (const count of [1, 2, 3]) {
      const input = buildInput(count, store)
      const outcome = runReplayPortfolioCycleSequence(input)
      if (!outcome.result || !outcome.artifact_manifest) {
        throw new Error(outcome.failure?.message ?? `cycle sequence ${count} Result missing`)
      }
      expect(outcome.result.cycle_count).toBe(count)
      expect(outcome.result.cycle_records.map((record) => record.cycle_index))
        .toEqual(Array.from({ length: count }, (_, index) => index + 1))
      expect(outcome.result.cycle_records.map((record) => [
        record.opening_available_cash, record.ending_available_cash,
      ])).toEqual(Array.from({ length: count }, (_, index) => index === 0 ? [100, 110] : [110, 110]))
      expect(outcome.result.state_chain.map((transition) => transition.cycle_index))
        .toContain(count)
      expect(outcome.result).toMatchObject({
        initial_cash: 100, ending_available_cash: 110,
        ending_gross_exposure: 0, ending_net_exposure: 0, ending_portfolio_risk: 0,
      })
      expect(outcome.result.result_hash).toBe(replayPortfolioCycleSequenceResultHash(outcome.result))
      expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
        "cycle_sequence_plan", "cycle_sequence_reservation", "cycle_evidence",
        "cycle_sequence_state_chain", "cycle_sequence_fingerprint", "cycle_sequence_result",
      ])
      const retry = runReplayPortfolioCycleSequence(input)
      expect(retry.result).toEqual(outcome.result)
      expect(retry.idempotent_replay).toBe(true)
    }
    const three = buildInput(3, store)
    let riskCalls = 0
    const failed = runReplayPortfolioCycleSequence({
      ...three,
      execute_risk_slice: (engineInput) => {
        riskCalls += 1
        if (riskCalls === 2) throw new Error("fixture second cycle risk failure")
        return executeReplayRuntimeSharedWalletRiskSlice(engineInput)
      },
    })
    expect(failed).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: { code: "cycle-risk-failed", cycle_index: 2, partial_result_published: false },
    })
    const expanded = structuredClone(three.plan)
    expanded.cycle_count = 4
    expanded.plan_hash = replayPortfolioCycleSequencePlanHash(expanded)
    const rejectedExpansion = runReplayPortfolioCycleSequence({ ...three, plan: expanded })
    expect(rejectedExpansion).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: { code: "cycle-sequence-input-invalid", cycle_index: null, partial_result_published: false },
    })

    const accounting = runReplayPortfolioCycleSequenceAccounting(three)
    if (!accounting.evidence || !accounting.artifact_manifest || !accounting.sequence_result) {
      throw new Error(accounting.failure?.message ?? "Cycle Sequence Accounting Evidence missing")
    }
    expect(accounting.evidence.consolidated_journal
      .filter((entry) => entry.cycle_entry.posting_kind === "opening_cash")
      .map((entry) => entry.cycle_index)).toEqual([1])
    expect(accounting.evidence.consolidated_trial_balance).toMatchObject({
      opening_equity_posting_count: 1,
      initial_cash: 100,
      ending_available_cash: 110,
      ending_reserved_isolated_collateral: 0,
      ending_settled_cash: 110,
      ending_unrealized_pnl: 0,
      ending_portfolio_nav: 110,
      balanced: true,
    })
    expect(accounting.evidence.consolidated_trial_balance.balances.opening_equity).toBe(100)
    expect(accounting.evidence.consolidated_trial_balance.balances.realized_pnl_income).toBe(10)
    expect(accounting.evidence.consolidated_ledger.at(-1)?.cycle_entry.settled_cash_after).toBe(110)
    expect([...new Set(accounting.evidence.consolidated_journal.map((entry) => entry.cycle_index))])
      .toEqual([1, 2, 3])
    expect(accounting.evidence.consolidated_journal.map((entry) => entry.global_journal_sequence))
      .toEqual(Array.from(
        { length: accounting.evidence.consolidated_journal.length }, (_, index) => index + 1,
      ))
    expect(accounting.evidence.evidence_hash)
      .toBe(replayPortfolioCycleSequenceAccountingEvidenceHash(accounting.evidence))
    expect(accounting.artifact_manifest.files.map((file) => file.role)).toEqual([
      "sequence_result", "sequence_artifact_manifest", "cycle_accounting_evidence",
      "consolidated_ledger", "consolidated_journal", "consolidated_trial_balance",
      "consolidated_fingerprint", "consolidated_accounting_evidence",
    ])
    const accountingRetry = runReplayPortfolioCycleSequenceAccounting(three)
    expect(accountingRetry.evidence).toEqual(accounting.evidence)
    expect(accountingRetry.idempotent_replay).toBe(true)
    const accountingArtifactFailure = runReplayPortfolioCycleSequenceAccounting({
      ...three,
      publish_accounting_artifact: () => { throw new Error("fixture consolidated Artifact failure") },
    })
    expect(accountingArtifactFailure).toMatchObject({
      status: "failed", sequence_result: null, evidence: null, artifact_manifest: null,
      failure: { code: "sequence-accounting-artifact-failed", partial_result_published: false },
    })
    let cycleEvidenceReads = 0
    const tamperingStore: ReplayArtifactStore = {
      capability: store.capability,
      openAttempt: (identity) => {
        const namespace = store.openAttempt(identity)
        return {
          namespace_ref: namespace.namespace_ref,
          fileRef: (name) => namespace.fileRef(name),
          exists: (name) => namespace.exists(name),
          listNames: () => namespace.listNames(),
          read: (name) => {
            const read = namespace.read(name)
            if (name === "cycle-evidence.json" && ++cycleEvidenceReads === 2) {
              return { ...read, bytes: new TextEncoder().encode("[]\n") }
            }
            return read
          },
          readRef: (ref) => namespace.readRef(ref),
          writeImmutable: (name, content) => namespace.writeImmutable(name, content),
          remove: (name) => namespace.remove(name),
        }
      },
    }
    const accountingArtifactTamper = runReplayPortfolioCycleSequenceAccounting({
      ...three, artifact_store: tamperingStore,
    })
    expect(accountingArtifactTamper).toMatchObject({
      status: "failed", sequence_result: null, evidence: null, artifact_manifest: null,
      failure: { code: "sequence-artifact-read-failed", partial_result_published: false },
    })
    const tamperedEvidence = structuredClone(accounting.evidence)
    tamperedEvidence.consolidated_trial_balance.opening_equity_posting_count = 2 as 1
    expect(() => assertReplayPortfolioCycleSequenceAccountingEvidence(tamperedEvidence))
      .toThrow("Trial Balance")

    const protectiveSequence = runReplayPortfolioProtectiveTerminalCycleSequence(three)
    if (!protectiveSequence.result || !protectiveSequence.artifact_manifest) {
      throw new Error(protectiveSequence.failure?.message ?? "Protective Terminal Cycle Sequence missing")
    }
    expect(protectiveSequence.result.cycle_commits.map((commit) => [
      commit.cycle_index, commit.opening_available_cash, commit.ending_available_cash,
    ])).toEqual([[1, 100, 110], [2, 110, 110], [3, 110, 110]])
    expect(protectiveSequence.result.cycle_commits.every((commit) =>
      commit.integrated_artifact_manifest_hash.length === 64
      && commit.mark_risk_revaluation_artifact_manifest_hash.length === 64
      && commit.protective_terminal_artifact_manifest_hash.length === 64
      && commit.protective_terminal_accounting_artifact_manifest_hash.length === 64)).toBe(true)
    expect(protectiveSequence.result).toMatchObject({
      initial_cash: 100,
      ending_available_cash: 110,
      ending_reserved_isolated_collateral: 0,
      ending_unrealized_pnl: 0,
      ending_portfolio_nav: 110,
    })
    expect(protectiveSequence.result.result_hash)
      .toBe(replayPortfolioProtectiveTerminalCycleSequenceResultHash(protectiveSequence.result))
    expect(protectiveSequence.artifact_manifest.files.map((file) => file.role)).toEqual([
      "cycle_sequence_plan", "cycle_sequence_reservation", "cycle_commits",
      "protective_terminal_cycle_sequence_fingerprint", "protective_terminal_cycle_sequence_result",
    ])
    const protectiveSequenceRetry = runReplayPortfolioProtectiveTerminalCycleSequence(three)
    expect(protectiveSequenceRetry.result).toEqual(protectiveSequence.result)
    expect(protectiveSequenceRetry.idempotent_replay).toBe(true)
    let protectiveRiskCalls = 0
    const protectiveSequenceFailure = runReplayPortfolioProtectiveTerminalCycleSequence({
      ...three,
      execute_risk_slice: (engineInput) => {
        protectiveRiskCalls += 1
        if (protectiveRiskCalls === 2) throw new Error("fixture P17 second cycle risk failure")
        return executeReplayRuntimeSharedWalletRiskSlice(engineInput)
      },
    })
    expect(protectiveSequenceFailure).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: {
        code: "protective-cycle-risk-failed", cycle_index: 2,
        partial_sequence_result_published: false,
      },
    })
    const protectiveSequenceArtifactFailure = runReplayPortfolioProtectiveTerminalCycleSequence({
      ...three,
      publish_protective_cycle_sequence_artifact: () => {
        throw new Error("fixture P17 sequence Artifact failure")
      },
    })
    expect(protectiveSequenceArtifactFailure).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: {
        code: "protective-cycle-sequence-artifact-failed", cycle_index: null,
        partial_sequence_result_published: false,
      },
    })
    const tamperedProtectiveSequence = structuredClone(protectiveSequence.result)
    tamperedProtectiveSequence.cycle_commits[1]!.opening_available_cash = 100
    tamperedProtectiveSequence.cycle_commits[1]!.cycle_commit_hash =
      replayPortfolioProtectiveTerminalCycleCommitHash(tamperedProtectiveSequence.cycle_commits[1]!)
    tamperedProtectiveSequence.cycle_commits_hash = canonicalHash(tamperedProtectiveSequence.cycle_commits)
    tamperedProtectiveSequence.result_hash =
      replayPortfolioProtectiveTerminalCycleSequenceResultHash(tamperedProtectiveSequence)
    expect(() => assertReplayPortfolioProtectiveTerminalCycleSequenceResult(tamperedProtectiveSequence))
      .toThrow("cycle commit")

    const protectiveSequenceAccounting =
      runReplayPortfolioProtectiveTerminalCycleSequenceAccounting(three)
    if (!protectiveSequenceAccounting.evidence || !protectiveSequenceAccounting.artifact_manifest
        || !protectiveSequenceAccounting.sequence_result) {
      throw new Error(protectiveSequenceAccounting.failure?.message
        ?? "Protective Terminal Cycle Sequence Accounting missing")
    }
    expect(protectiveSequenceAccounting.evidence.consolidated_journal
      .filter((entry) => entry.cycle_entry.posting_kind === "opening_cash")
      .map((entry) => entry.cycle_index)).toEqual([1])
    expect(protectiveSequenceAccounting.evidence.consolidated_trial_balance).toMatchObject({
      opening_equity_posting_count: 1,
      initial_cash: 100,
      ending_available_cash: 110,
      ending_reserved_isolated_collateral: 0,
      ending_settled_cash: 110,
      ending_unrealized_pnl: 0,
      ending_portfolio_nav: 110,
      balanced: true,
    })
    expect(protectiveSequenceAccounting.evidence.consolidated_trial_balance.balances.opening_equity)
      .toBe(100)
    expect(protectiveSequenceAccounting.evidence.consolidated_trial_balance.balances.realized_pnl_income)
      .toBe(10)
    expect(protectiveSequenceAccounting.evidence.consolidated_ledger.at(-1)?.cycle_entry.settled_cash_after)
      .toBe(110)
    expect(protectiveSequenceAccounting.evidence.cycle_accounting_evidence_hashes)
      .toEqual(protectiveSequenceAccounting.sequence_result.cycle_commits
        .map((commit) => commit.protective_terminal_accounting_evidence_hash))
    expect(protectiveSequenceAccounting.evidence.evidence_hash)
      .toBe(replayPortfolioProtectiveTerminalCycleSequenceAccountingEvidenceHash(
        protectiveSequenceAccounting.evidence,
      ))
    expect(protectiveSequenceAccounting.artifact_manifest.files.map((file) => file.role)).toEqual([
      "protective_terminal_cycle_sequence_result",
      "protective_terminal_cycle_sequence_artifact_manifest",
      "cycle_protective_terminal_accounting_artifact_manifests",
      "cycle_protective_terminal_accounting_evidence",
      "consolidated_ledger", "consolidated_journal", "consolidated_trial_balance",
      "consolidated_accounting_fingerprint", "consolidated_accounting_evidence",
    ])
    const protectiveSequenceAccountingRetry =
      runReplayPortfolioProtectiveTerminalCycleSequenceAccounting(three)
    expect(protectiveSequenceAccountingRetry.evidence).toEqual(protectiveSequenceAccounting.evidence)
    expect(protectiveSequenceAccountingRetry.idempotent_replay).toBe(true)
    const protectiveSequenceAccountingArtifactFailure =
      runReplayPortfolioProtectiveTerminalCycleSequenceAccounting({
        ...three,
        publish_protective_cycle_sequence_accounting_artifact: () => {
          throw new Error("fixture P18 accounting Artifact failure")
        },
      })
    expect(protectiveSequenceAccountingArtifactFailure).toMatchObject({
      status: "failed", sequence_result: null, evidence: null, artifact_manifest: null,
      failure: {
        code: "protective-cycle-sequence-accounting-artifact-failed",
        partial_accounting_result_published: false,
      },
    })
    const tamperedProtectiveAccounting = structuredClone(protectiveSequenceAccounting.evidence)
    tamperedProtectiveAccounting.consolidated_trial_balance.opening_equity_posting_count = 2 as 1
    tamperedProtectiveAccounting.consolidated_trial_balance.trial_balance_hash =
      replayPortfolioProtectiveTerminalCycleSequenceTrialBalanceHash(
        tamperedProtectiveAccounting.consolidated_trial_balance,
      )
    tamperedProtectiveAccounting.evidence_hash =
      replayPortfolioProtectiveTerminalCycleSequenceAccountingEvidenceHash(tamperedProtectiveAccounting)
    expect(() => assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence(
      tamperedProtectiveAccounting,
    )).toThrow("trial balance")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("replacement-aware terminal accounting rolls through a bounded Cycle Sequence", () => {
  const definitions = [
    {
      id: "replacement-cycle-long", symbol: "BTCUSDT", rejectedSymbol: "ETHUSDT",
      entry: "2026-07-14T00:01:00Z", side: "long" as const, stop: 90, target: 120,
      replacement: 95, nextOpen: 94,
      marks: ["2026-07-14T00:01:00Z", "2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"],
    },
    {
      id: "replacement-cycle-short", symbol: "SOLUSDT", rejectedSymbol: "BNBUSDT",
      entry: "2026-07-14T00:04:00Z", side: "short" as const, stop: 110, target: 80,
      replacement: 105, nextOpen: 106,
      marks: ["2026-07-14T00:04:00Z", "2026-07-14T00:05:00Z", "2026-07-14T00:06:00Z"],
    },
  ] as const
  const portfolioId = "portfolio-replacement-cycle-sequence-1"
  const fixtures = definitions.map((definition) => {
    const base = runtimeLaneInput({
      laneId: definition.id,
      symbol: definition.symbol,
      collateral: 20,
      feeBps: 0,
      executableTime: definition.entry,
    })
    Object.assign(base.trial.request.order, {
      side: definition.side,
      stop_price: definition.stop,
      target_price: definition.target,
    })
    const primary = withRuntimeRisk(withRuntimeProtectiveStopReplacement(base, {
      newStopPrice: definition.replacement,
      nextOpen: definition.nextOpen,
    }), [100, 100, 100], {
      markTimes: [...definition.marks] as [string, string, string],
    })
    const rejectedBase = runtimeLaneInput({
      laneId: `${definition.id}-rejected`,
      symbol: definition.rejectedSymbol,
      collateral: 20,
      feeBps: 0,
      executableTime: definition.entry,
    })
    Object.assign(rejectedBase.trial.request.order, {
      side: definition.side,
      stop_price: definition.stop,
      target_price: definition.target,
    })
    const rejected = withRuntimeRisk(rejectedBase, [100, 100, 100], {
      markTimes: [...definition.marks] as [string, string, string],
    })
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: portfolioId }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: portfolioId }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    return { lanes, allocationPlan, riskPlan, entry: definition.entry }
  })
  const reservation = createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "replacement-cycle-sequence-2",
    reservation_ref: "reservation://replacement-cycle-sequence/2",
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:10:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: portfolioId,
    settlement_asset: "USDT",
    initial_cash: 100,
    cycle_count: 2,
    max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles: fixtures.map((fixture, index) => ({
      cycle_index: index + 1,
      allocation_plan_hash: fixture.allocationPlan.plan_hash,
      risk_plan_hash: fixture.riskPlan.plan_hash,
      earliest_cycle_time: fixture.entry,
      max_gross_exposure_amount: 200,
      max_abs_net_exposure_amount: 100,
      max_portfolio_risk_amount: 25,
      lanes: fixture.lanes.map((lane, laneIndex) => ({
        lane_id: lane.lane_id,
        priority_rank: laneIndex + 1,
        trial_id: lane.trial.request.trial_id,
        run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        max_lane_risk_amount: 15,
      })),
    })),
    limitations: [
      "one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
    ],
  })
  const planned = fixtures.map((fixture) => ({
    ...fixture,
    integratedPlan: integratedPortfolioPlan(
      fixture.allocationPlan, reservation.reservation_hash,
      fixture.riskPlan, reservation.reservation_hash,
    ),
  }))
  const plan = cycleSequencePlan(portfolioId, reservation.reservation_hash, planned)
  const root = mkdtempSync(join(tmpdir(), "replay-replacement-cycle-sequence-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-replacement-cycle-sequence-interrupted-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    const input = {
      plan,
      reservation,
      cycles: planned.map((fixture, index) => ({
        cycle_index: index + 1,
        integrated_plan: fixture.integratedPlan,
        allocation_plan: fixture.allocationPlan,
        risk_plan: fixture.riskPlan,
        lanes: [...fixture.lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      })),
      artifact_store: store,
    }
    const outcome = runReplayPortfolioProtectiveStopReplacementCycleSequence(input)
    if (!outcome.evidence || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "Replacement Cycle Sequence missing")
    }
    expect(outcome.evidence.cycle_commits.map((commit) => [
      commit.cycle_index, commit.opening_available_cash, commit.ending_available_cash,
    ])).toEqual([[1, 100, 94], [2, 94, 88]])
    expect(outcome.evidence.consolidated_ledger.map((entry) => [
      entry.cycle_index, entry.cycle_entry.amount, entry.cycle_entry.terminal_owner,
    ])).toEqual([
      [1, -6, "replacement_protective_stop"],
      [2, -6, "replacement_protective_stop"],
    ])
    expect(outcome.evidence.consolidated_journal
      .filter((entry) => entry.cycle_entry.posting_kind === "opening_cash")
      .map((entry) => entry.cycle_index)).toEqual([1])
    expect(outcome.evidence.consolidated_trial_balance).toMatchObject({
      opening_equity_posting_count: 1,
      initial_cash: 100,
      ending_available_cash: 88,
      ending_reserved_isolated_collateral: 0,
      ending_settled_cash: 88,
      ending_unrealized_pnl: 0,
      ending_portfolio_nav: 88,
      balanced: true,
      balances: { opening_equity: 100, realized_pnl_loss: 12 },
    })
    expect(outcome.evidence.evidence_hash)
      .toBe(replayPortfolioProtectiveStopReplacementCycleSequenceEvidenceHash(outcome.evidence))
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "cycle_sequence_plan", "cycle_sequence_reservation",
      "cycle_replacement_terminal_artifact_manifests", "cycle_replacement_terminal_evidence",
      "cycle_replacement_terminal_accounting_artifact_manifests",
      "cycle_replacement_terminal_accounting_evidence", "consolidated_ledger",
      "consolidated_journal", "consolidated_trial_balance", "consolidated_fingerprint",
      "replacement_cycle_sequence_evidence",
    ])
    const retry = runReplayPortfolioProtectiveStopReplacementCycleSequence(input)
    expect(retry.evidence).toEqual(outcome.evidence)
    expect(retry.idempotent_replay).toBe(true)
    let riskCalls = 0
    const childFailure = runReplayPortfolioProtectiveStopReplacementCycleSequence({
      ...input,
      execute_risk_slice: (engineInput) => {
        riskCalls += 1
        if (riskCalls === 2) throw new Error("fixture replacement cycle 2 Risk failure")
        return executeReplayRuntimeSharedWalletRiskSlice(engineInput)
      },
    })
    expect(childFailure).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: {
        code: "replacement-cycle-risk-failed",
        cycle_index: 2,
        partial_sequence_result_published: false,
      },
    })
    const failed = runReplayPortfolioProtectiveStopReplacementCycleSequence({
      ...input,
      publish_replacement_cycle_sequence_artifact: () => {
        throw new Error("fixture replacement cycle sequence Artifact failure")
      },
    })
    expect(failed).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: {
        code: "replacement-cycle-sequence-artifact-failed",
        cycle_index: null,
        partial_sequence_result_published: false,
      },
    })
    const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
    const interrupted = runReplayPortfolioProtectiveStopReplacementCycleSequence({
      ...input,
      artifact_store: failWriteOnce(interruptedBase, "consolidated-journal.json"),
    })
    expect(interrupted).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: {
        code: "replacement-cycle-sequence-artifact-failed",
        partial_sequence_result_published: false,
      },
    })
    const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
      namespace.listNames().includes("consolidated-ledger.json"))
    expect(orphan?.exists(
      "portfolio-protective-stop-replacement-cycle-sequence-artifact-manifest.json",
    )).toBe(false)
    const tampered = structuredClone(outcome.evidence)
    tampered.consolidated_journal[1]!.cycle_index = 2
    tampered.consolidated_journal[1]!.sequence_entry_hash =
      replayPortfolioProtectiveStopReplacementCycleSequenceJournalEntryHash(
        tampered.consolidated_journal[1]!,
      )
    tampered.fingerprint.consolidated_journal_hash = canonicalHash(tampered.consolidated_journal)
    tampered.fingerprint.fingerprint_hash =
      replayPortfolioProtectiveStopReplacementCycleSequenceFingerprintHash(tampered.fingerprint)
    tampered.evidence_hash = replayPortfolioProtectiveStopReplacementCycleSequenceEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence(tampered))
      .toThrow("journal")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(interruptedRoot, { recursive: true, force: true })
  }
})

test("take-profit replacement closes terminal accounting and bounded Cycle Sequence in one successor", () => {
  const definitions = [
    { id: "target-cycle-long", symbol: "BTCUSDT", rejected: "ETHUSDT", entry: "2026-07-14T00:01:00Z",
      side: "long" as const, stop: 90, target: 110, replacement: 120, nextOpen: 121,
      marks: ["2026-07-14T00:01:00Z", "2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"] },
    { id: "target-cycle-short", symbol: "SOLUSDT", rejected: "BNBUSDT", entry: "2026-07-14T00:04:00Z",
      side: "short" as const, stop: 110, target: 90, replacement: 80, nextOpen: 79,
      marks: ["2026-07-14T00:04:00Z", "2026-07-14T00:05:00Z", "2026-07-14T00:06:00Z"] },
    { id: "target-cycle-race", symbol: "XRPUSDT", rejected: "ADAUSDT", entry: "2026-07-14T00:07:00Z",
      side: "long" as const, stop: 90, target: 110, replacement: 120, nextOpen: 121,
      sameBoundaryTarget: true,
      marks: ["2026-07-14T00:07:00Z", "2026-07-14T00:08:00Z", "2026-07-14T00:09:00Z"] },
    { id: "target-cycle-collision", symbol: "DOGEUSDT", rejected: "LTCUSDT", entry: "2026-07-14T00:10:00Z",
      side: "long" as const, stop: 90, target: 110, replacement: 120, nextOpen: 100,
      nextHigh: 121, nextLow: 89,
      marks: ["2026-07-14T00:10:00Z", "2026-07-14T00:11:00Z", "2026-07-14T00:12:00Z"] },
  ] as const
  const portfolioId = "portfolio-target-replacement-cycle-sequence-1"
  const fixtures = definitions.map((definition) => {
    const primaryBase = runtimeLaneInput({
      laneId: definition.id, symbol: definition.symbol, collateral: 20, feeBps: 0,
      executableTime: definition.entry,
    })
    Object.assign(primaryBase.trial.request.order, {
      side: definition.side, stop_price: definition.stop, target_price: definition.target,
    })
    const primary = withRuntimeRisk(withRuntimeTakeProfitReplacement(primaryBase, {
      newTargetPrice: definition.replacement,
      nextOpen: definition.nextOpen,
      sameBoundaryTarget: "sameBoundaryTarget" in definition && definition.sameBoundaryTarget,
      nextHigh: "nextHigh" in definition ? definition.nextHigh : undefined,
      nextLow: "nextLow" in definition ? definition.nextLow : undefined,
    }), [100, 100, 100], { markTimes: [...definition.marks] as [string, string, string] })
    const rejectedBase = runtimeLaneInput({
      laneId: `${definition.id}-rejected`, symbol: definition.rejected, collateral: 20, feeBps: 0,
      executableTime: definition.entry,
    })
    Object.assign(rejectedBase.trial.request.order, {
      side: definition.side, stop_price: definition.stop, target_price: definition.target,
    })
    const rejected = withRuntimeRisk(rejectedBase, [100, 100, 100], {
      markTimes: [...definition.marks] as [string, string, string],
    })
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: portfolioId }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: portfolioId }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    return { lanes, allocationPlan, riskPlan, entry: definition.entry }
  })
  const reservation = createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "target-replacement-cycle-sequence-4",
    reservation_ref: "reservation://target-replacement-cycle-sequence/4",
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:14:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: portfolioId,
    settlement_asset: "USDT",
    initial_cash: 100,
    cycle_count: fixtures.length,
    max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles: fixtures.map((fixture, index) => ({
      cycle_index: index + 1,
      allocation_plan_hash: fixture.allocationPlan.plan_hash,
      risk_plan_hash: fixture.riskPlan.plan_hash,
      earliest_cycle_time: fixture.entry,
      max_gross_exposure_amount: 200,
      max_abs_net_exposure_amount: 100,
      max_portfolio_risk_amount: 25,
      lanes: fixture.lanes.map((lane, laneIndex) => ({
        lane_id: lane.lane_id,
        priority_rank: laneIndex + 1,
        trial_id: lane.trial.request.trial_id,
        run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        max_lane_risk_amount: 15,
      })),
    })),
    limitations: [
      "one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
    ],
  })
  const planned = fixtures.map((fixture) => ({
    ...fixture,
    integratedPlan: integratedPortfolioPlan(
      fixture.allocationPlan, reservation.reservation_hash,
      fixture.riskPlan, reservation.reservation_hash,
    ),
  }))
  const plan = cycleSequencePlan(portfolioId, reservation.reservation_hash, planned)
  const root = mkdtempSync(join(tmpdir(), "replay-target-replacement-cycle-sequence-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-target-replacement-cycle-interrupted-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    const input = {
      plan,
      reservation,
      cycles: planned.map((fixture, index) => ({
        cycle_index: index + 1,
        integrated_plan: fixture.integratedPlan,
        allocation_plan: fixture.allocationPlan,
        risk_plan: fixture.riskPlan,
        lanes: [...fixture.lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      })),
      artifact_store: store,
    }
    expect(runReplayPortfolioCycleSequence(input)).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: { code: "cycle-risk-failed", cycle_index: 1 },
    })
    const outcome = runReplayPortfolioProtectiveTakeProfitReplacementCycleSequence(input)
    if (!outcome.evidence || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "Take-profit Replacement Cycle Sequence missing")
    }
    expect(outcome.evidence.cycle_commits.map((commit) => [
      commit.cycle_index, commit.opening_available_cash, commit.ending_available_cash,
    ])).toEqual([[1, 100, 121], [2, 121, 142], [3, 142, 152], [4, 152, 142]])
    expect(outcome.evidence.consolidated_ledger.map((entry) => [
      entry.cycle_index, entry.cycle_entry.amount, entry.cycle_entry.terminal_owner,
    ])).toEqual([
      [1, 21, "replacement_take_profit"],
      [2, 21, "replacement_take_profit"],
      [3, 10, "initial_take_profit"],
      [4, -10, "initial_protective_stop"],
    ])
    expect(outcome.evidence.consolidated_journal
      .filter((entry) => entry.cycle_entry.posting_kind === "opening_cash")
      .map((entry) => entry.cycle_index)).toEqual([1])
    expect(outcome.evidence.consolidated_trial_balance).toMatchObject({
      opening_equity_posting_count: 1,
      initial_cash: 100,
      ending_available_cash: 142,
      ending_reserved_isolated_collateral: 0,
      ending_settled_cash: 142,
      ending_unrealized_pnl: 0,
      ending_portfolio_nav: 142,
      balanced: true,
      balances: { opening_equity: 100, realized_pnl_income: 52, realized_pnl_loss: 10 },
    })
    expect(outcome.evidence.evidence_hash)
      .toBe(replayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidenceHash(outcome.evidence))
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "cycle_sequence_plan", "cycle_sequence_reservation",
      "cycle_replacement_terminal_artifact_manifests", "cycle_replacement_terminal_evidence",
      "cycle_replacement_terminal_accounting_artifact_manifests",
      "cycle_replacement_terminal_accounting_evidence", "consolidated_ledger",
      "consolidated_journal", "consolidated_trial_balance", "consolidated_fingerprint",
      "replacement_cycle_sequence_evidence",
    ])
    const retry = runReplayPortfolioProtectiveTakeProfitReplacementCycleSequence(input)
    expect(retry.evidence).toEqual(outcome.evidence)
    expect(retry.idempotent_replay).toBe(true)
    let riskCalls = 0
    const childFailure = runReplayPortfolioProtectiveTakeProfitReplacementCycleSequence({
      ...input,
      execute_risk_slice: (engineInput) => {
        riskCalls += 1
        if (riskCalls === 3) throw new Error("fixture target replacement cycle 3 Risk failure")
        return executeReplayRuntimeSharedWalletRiskSlice(engineInput)
      },
    })
    expect(childFailure).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: {
        code: "replacement-cycle-risk-failed", cycle_index: 3,
        partial_sequence_result_published: false,
      },
    })
    const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
    const interrupted = runReplayPortfolioProtectiveTakeProfitReplacementCycleSequence({
      ...input, artifact_store: failWriteOnce(interruptedBase, "consolidated-journal.json"),
    })
    expect(interrupted).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: {
        code: "replacement-cycle-sequence-artifact-failed",
        partial_sequence_result_published: false,
      },
    })
    const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
      namespace.listNames().includes("consolidated-ledger.json"))
    expect(orphan?.exists(
      "portfolio-protective-take-profit-replacement-cycle-sequence-artifact-manifest.json",
    )).toBe(false)
    const tampered = structuredClone(outcome.evidence)
    tampered.consolidated_journal[1]!.cycle_index = 2
    tampered.consolidated_journal[1]!.sequence_entry_hash =
      replayPortfolioProtectiveTakeProfitReplacementCycleSequenceJournalEntryHash(
        tampered.consolidated_journal[1]!,
      )
    tampered.fingerprint.consolidated_journal_hash = canonicalHash(tampered.consolidated_journal)
    tampered.fingerprint.fingerprint_hash =
      replayPortfolioProtectiveTakeProfitReplacementCycleSequenceFingerprintHash(tampered.fingerprint)
    tampered.evidence_hash = replayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveTakeProfitReplacementCycleSequenceEvidence(tampered))
      .toThrow("journal")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(interruptedRoot, { recursive: true, force: true })
  }
})

test("Portfolio take-profit cancel preserves the stop and makes the former target unreachable", () => {
  const cases = [
    { id: "long", side: "long" as const, stop: 90, target: 110, stopOpen: 89 },
    { id: "short", side: "short" as const, stop: 110, target: 90, stopOpen: 111 },
  ] as const
  for (const item of cases) {
    const primaryBase = runtimeLaneInput({
      laneId: `target-cancel-${item.id}`, symbol: "BTCUSDT", collateral: 20, feeBps: 0,
    })
    Object.assign(primaryBase.trial.request.order, {
      side: item.side, stop_price: item.stop, target_price: item.target,
    })
    const primary = withRuntimeRisk(withRuntimeTakeProfitCancel(primaryBase), [100, 100, 100])
    const rejected = withRuntimeRisk(runtimeLaneInput({
      laneId: `target-cancel-${item.id}-rejected`, symbol: "ETHUSDT", collateral: 20, feeBps: 0,
    }), [100, 100, 100])
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: `portfolio-target-cancel-${item.id}` }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    const allocationAuthority = portfolioAllocationReservation(
      allocationPlan, lanes, [primary.lane_id, rejected.lane_id], { gross: 100, net: 100, risk: 25 },
    )
    const riskAuthority = runtimeRiskReservation(riskPlan, lanes, [primary.lane_id, rejected.lane_id])
    const integratedPlan = integratedPortfolioPlan(
      allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
    )
    const root = mkdtempSync(join(tmpdir(), `replay-portfolio-target-cancel-${item.id}-`))
    try {
      const input = {
        integrated_plan: integratedPlan, allocation_plan: allocationPlan,
        allocation_reservation: allocationAuthority, risk_plan: riskPlan, risk_reservation: riskAuthority,
        lanes: [...lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
        artifact_store: createReplayLocalArtifactStore(root),
      }
      expect(runReplayIntegratedPortfolio(input)).toMatchObject({
        status: "failed", failure: { code: "integrated-risk-failed", partial_result_published: false },
      })
      const outcome = runReplayPortfolioProtectiveTakeProfitCancelTerminal(input)
      if (!outcome.evidence || !outcome.artifact_manifest || !outcome.source_protective_terminal_evidence) {
        throw new Error(outcome.failure?.message ?? "take-profit cancel terminal missing")
      }
      const record = outcome.evidence.lane_records.find((candidate) => candidate.lane_id === primary.lane_id)!
      expect(record).toMatchObject({
        owner: "initial_protective_stop", cancel_status: "cancelled_then_terminal",
        cancelled_target_price: item.target, active_protection_mode: "stop_only",
        terminal_phase: 20, realized_pnl: -11, ending_open: false,
      })
      expect(record.terminal_time).toBe(primary.trial.bars[2]!.open_time)
      expect(outcome.source_protective_terminal_evidence.lane_records
        .find((candidate) => candidate.lane_id === primary.lane_id)?.owner).toBe("initial_take_profit")
      expect(outcome.evidence.ohlcv_resolutions[0]).toMatchObject({
        observation_kind: "bar_open_gap",
        active_protection: {
          protection_mode: "stop_only", stop_order_status: "active", target_order_status: "cancelled",
          stop_trigger_price: item.stop, target_trigger_price: item.target,
        },
        canonical: { terminal_role: "stop" },
      })
      expect(outcome.evidence.ohlcv_resolutions[0]!.paths
        .every((path) => path.simulated_execution_price === item.stopOpen)).toBe(true)
      expect(outcome.evidence).toMatchObject({
        ending_settled_cash: 89, ending_available_cash: 89,
        terminal_owner_counts: { initial_protective_stop: 1, not_opened: 1 },
      })
      expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
        "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
        "cancel_terminal_records", "ohlcv_resolutions", "cancel_terminal_fingerprint",
        "cancel_terminal_evidence",
      ])
      const accounting = runReplayPortfolioProtectiveTakeProfitCancelTerminalAccounting(input)
      if (!accounting.evidence || !accounting.artifact_manifest || !accounting.cancel_terminal_evidence) {
        throw new Error(accounting.failure?.message ?? "take-profit cancel terminal accounting missing")
      }
      expect(accounting.evidence.ledger.map((entry) => [
        entry.cashflow_kind, entry.amount, entry.settled_cash_after, entry.terminal_owner,
      ])).toEqual([["realized_pnl", -11, 89, "initial_protective_stop"]])
      expect(accounting.evidence.journal.map((entry) => entry.posting_kind)).toEqual([
        "opening_cash", "collateral_reserve", "realized_pnl", "collateral_release",
      ])
      expect(accounting.evidence.trial_balance).toMatchObject({
        ending_available_cash: 89, ending_reserved_isolated_collateral: 0,
        ending_settled_cash: 89, ending_unrealized_pnl: 0, ending_portfolio_nav: 89, balanced: true,
      })
      expect(accounting.evidence.excluded_preempted_source_hashes).toEqual([record.preempted_upstream_terminal_hash!])
      expect(accounting.artifact_manifest.files.map((file) => file.role)).toEqual([
        "cancel_terminal_artifact_manifest", "risk_result", "cancel_terminal_evidence",
        "cancel_terminal_ledger", "cancel_terminal_journal", "cancel_terminal_trial_balance",
        "cancel_terminal_accounting_fingerprint", "cancel_terminal_accounting_evidence",
      ])
      const accountingRetry = runReplayPortfolioProtectiveTakeProfitCancelTerminalAccounting(input)
      expect(accountingRetry.evidence).toEqual(accounting.evidence)
      expect(accountingRetry.idempotent_replay).toBe(true)
      const risk = runReplayIntegratedPortfolio({
        ...input, allow_predeclared_take_profit_cancel_projection: true,
      }).risk_result!
      expect(() => assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence(
        accounting.evidence!, {
          cancel_terminal_evidence: accounting.cancel_terminal_evidence!,
          cancel_terminal_manifest: outcome.artifact_manifest!, risk_result: risk,
        },
      )).not.toThrow()
      expect(runReplayPortfolioProtectiveTakeProfitCancelTerminalAccounting({
        ...input, publish_cancel_terminal_accounting_artifact: () => {
          throw new Error("fixture cancel terminal accounting publish failure")
        },
      })).toMatchObject({
        status: "failed", cancel_terminal_evidence: null, evidence: null, artifact_manifest: null,
        failure: { code: "cancel-terminal-accounting-artifact-failed", partial_result_published: false },
      })
      if (item.id === "long") {
        const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-cancel-accounting-interrupted-"))
        try {
          const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
          const interrupted = runReplayPortfolioProtectiveTakeProfitCancelTerminalAccounting({
            ...input, artifact_store: failWriteOnce(interruptedBase, "cancel-terminal-journal.json"),
          })
          expect(interrupted).toMatchObject({
            status: "failed", cancel_terminal_evidence: null, evidence: null, artifact_manifest: null,
            failure: { code: "cancel-terminal-accounting-artifact-failed", partial_result_published: false },
          })
          const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
            namespace.listNames().includes("cancel-terminal-ledger.json"))
          expect(orphan?.exists(
            "portfolio-protective-take-profit-cancel-terminal-accounting-artifact-manifest.json",
          )).toBe(false)
        } finally {
          rmSync(interruptedRoot, { recursive: true, force: true })
        }
      }
      const tamperedAccounting = structuredClone(accounting.evidence)
      tamperedAccounting.ledger[0]!.terminal_owner = "strategy_exit"
      tamperedAccounting.ledger[0]!.ledger_entry_hash =
        replayPortfolioProtectiveTakeProfitCancelTerminalAccountingLedgerEntryHash(
          tamperedAccounting.ledger[0]!,
        )
      tamperedAccounting.fingerprint.ledger_hash = canonicalHash(tamperedAccounting.ledger)
      tamperedAccounting.fingerprint.fingerprint_hash =
        replayPortfolioProtectiveTakeProfitCancelTerminalAccountingFingerprintHash(
          tamperedAccounting.fingerprint,
        )
      tamperedAccounting.evidence_hash =
        replayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidenceHash(tamperedAccounting)
      expect(() => assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence(
        tamperedAccounting, {
          cancel_terminal_evidence: accounting.cancel_terminal_evidence!,
          cancel_terminal_manifest: outcome.artifact_manifest!, risk_result: risk,
        },
      )).toThrow("ledger record binding")
      const retry = runReplayPortfolioProtectiveTakeProfitCancelTerminal(input)
      expect(retry.evidence).toEqual(outcome.evidence)
      expect(retry.idempotent_replay).toBe(true)
      const failed = runReplayPortfolioProtectiveTakeProfitCancelTerminal({
        ...input, execute_cancel_terminal: () => { throw new Error("fixture cancel terminal Engine failure") },
      })
      expect(failed).toMatchObject({
        status: "failed", source_protective_terminal_evidence: null, evidence: null, artifact_manifest: null,
        failure: { code: "cancel-terminal-engine-failed", partial_result_published: false },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  const raceBase = runtimeLaneInput({ laneId: "target-cancel-race", symbol: "SOLUSDT", collateral: 20, feeBps: 0 })
  Object.assign(raceBase.trial.request.order, { side: "long", stop_price: 90, target_price: 110 })
  const race = withRuntimeRisk(withRuntimeTakeProfitCancel(raceBase, { sameBoundaryTarget: true }), [100, 100, 100])
  const raceRejected = withRuntimeRisk(runtimeLaneInput({
    laneId: "target-cancel-race-rejected", symbol: "BNBUSDT", collateral: 20, feeBps: 0,
  }), [100, 100, 100])
  const raceLanes = [race, raceRejected]
  const racePortfolioId = "portfolio-target-cancel-race"
  const allocationDraft = portfolioAllocationPlan(raceLanes)
  const allocationBody = { ...allocationDraft, portfolio_id: racePortfolioId }
  const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
  const riskDraft = runtimeRiskPlan(raceLanes)
  const riskBody = { ...riskDraft, portfolio_id: racePortfolioId }
  const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, raceLanes, [race.lane_id, raceRejected.lane_id], { gross: 100, net: 100, risk: 25 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, raceLanes, [race.lane_id, raceRejected.lane_id])
  const integratedPlan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  const root = mkdtempSync(join(tmpdir(), "replay-portfolio-target-cancel-race-"))
  try {
    const outcome = runReplayPortfolioProtectiveTakeProfitCancelTerminal({
      integrated_plan: integratedPlan, allocation_plan: allocationPlan,
      allocation_reservation: allocationAuthority, risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [...raceLanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: createReplayLocalArtifactStore(root),
    })
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "take-profit cancel race missing")
    expect(outcome.evidence?.lane_records.find((record) => record.lane_id === race.lane_id)).toMatchObject({
      owner: "initial_take_profit", cancel_status: "terminal_before_or_at_decision",
      active_protection_mode: "bracket", realized_pnl: 10,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("take-profit cancel rolls committed stop-preserved accounting through four bounded cycles", () => {
  const definitions = [
    { id: "cancel-cycle-long", symbol: "BTCUSDT", rejected: "ETHUSDT", entry: "2026-07-14T00:01:00Z",
      side: "long" as const, stop: 90, target: 110, marks: ["2026-07-14T00:01:00Z",
        "2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"] },
    { id: "cancel-cycle-short", symbol: "SOLUSDT", rejected: "BNBUSDT", entry: "2026-07-14T00:04:00Z",
      side: "short" as const, stop: 110, target: 90, marks: ["2026-07-14T00:04:00Z",
        "2026-07-14T00:05:00Z", "2026-07-14T00:06:00Z"] },
    { id: "cancel-cycle-race", symbol: "XRPUSDT", rejected: "ADAUSDT", entry: "2026-07-14T00:07:00Z",
      side: "long" as const, stop: 90, target: 110, sameBoundaryTarget: true,
      marks: ["2026-07-14T00:07:00Z", "2026-07-14T00:08:00Z", "2026-07-14T00:09:00Z"] },
    { id: "cancel-cycle-final", symbol: "DOGEUSDT", rejected: "LTCUSDT", entry: "2026-07-14T00:10:00Z",
      side: "long" as const, stop: 90, target: 110, marks: ["2026-07-14T00:10:00Z",
        "2026-07-14T00:11:00Z", "2026-07-14T00:12:00Z"] },
  ] as const
  const portfolioId = "portfolio-target-cancel-cycle-sequence-1"
  const fixtures = definitions.map((definition) => {
    const primaryBase = runtimeLaneInput({ laneId: definition.id, symbol: definition.symbol,
      collateral: 20, feeBps: 0, executableTime: definition.entry })
    Object.assign(primaryBase.trial.request.order, {
      side: definition.side, stop_price: definition.stop, target_price: definition.target,
    })
    const primary = withRuntimeRisk(withRuntimeTakeProfitCancel(primaryBase, {
      sameBoundaryTarget: "sameBoundaryTarget" in definition && definition.sameBoundaryTarget,
    }), [100, 100, 100], { markTimes: [...definition.marks] as [string, string, string] })
    const rejectedBase = runtimeLaneInput({ laneId: `${definition.id}-rejected`, symbol: definition.rejected,
      collateral: 20, feeBps: 0, executableTime: definition.entry })
    Object.assign(rejectedBase.trial.request.order, {
      side: definition.side, stop_price: definition.stop, target_price: definition.target,
    })
    const rejected = withRuntimeRisk(rejectedBase, [100, 100, 100], {
      markTimes: [...definition.marks] as [string, string, string],
    })
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: portfolioId }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: portfolioId }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    return { lanes, allocationPlan, riskPlan, entry: definition.entry }
  })
  const reservation = createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "target-cancel-cycle-sequence-4",
    reservation_ref: "reservation://target-cancel-cycle-sequence/4",
    issued_at: "2026-07-14T00:00:30Z", expires_at: "2026-07-14T00:14:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "trial-group-1",
    trial_group_hash: HASH, portfolio_id: portfolioId, settlement_asset: "USDT", initial_cash: 100,
    cycle_count: fixtures.length, max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles: fixtures.map((fixture, index) => ({
      cycle_index: index + 1, allocation_plan_hash: fixture.allocationPlan.plan_hash,
      risk_plan_hash: fixture.riskPlan.plan_hash, earliest_cycle_time: fixture.entry,
      max_gross_exposure_amount: 200, max_abs_net_exposure_amount: 100, max_portfolio_risk_amount: 25,
      lanes: fixture.lanes.map((lane, laneIndex) => ({ lane_id: lane.lane_id, priority_rank: laneIndex + 1,
        trial_id: lane.trial.request.trial_id, run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        max_lane_risk_amount: 15 })),
    })),
    limitations: ["one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion"],
  })
  const planned = fixtures.map((fixture) => ({ ...fixture, integratedPlan: integratedPortfolioPlan(
    fixture.allocationPlan, reservation.reservation_hash, fixture.riskPlan, reservation.reservation_hash,
  ) }))
  const plan = cycleSequencePlan(portfolioId, reservation.reservation_hash, planned)
  const root = mkdtempSync(join(tmpdir(), "replay-target-cancel-cycle-sequence-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-target-cancel-cycle-interrupted-"))
  try {
    const input = { plan, reservation,
      cycles: planned.map((fixture, index) => ({ cycle_index: index + 1,
        integrated_plan: fixture.integratedPlan, allocation_plan: fixture.allocationPlan,
        risk_plan: fixture.riskPlan,
        lanes: [...fixture.lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })) })),
      artifact_store: createReplayLocalArtifactStore(root) }
    expect(runReplayPortfolioCycleSequence(input)).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: { code: "cycle-risk-failed", cycle_index: 1 },
    })
    const outcome = runReplayPortfolioProtectiveTakeProfitCancelCycleSequence(input)
    if (!outcome.evidence || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "Take-profit Cancel Cycle Sequence missing")
    }
    expect(outcome.evidence.cycle_commits.map((commit) => [commit.cycle_index,
      commit.opening_available_cash, commit.ending_available_cash])).toEqual([
      [1, 100, 89], [2, 89, 78], [3, 78, 88], [4, 88, 77],
    ])
    expect(outcome.evidence.consolidated_ledger.map((entry) => [entry.cycle_index,
      entry.cycle_entry.amount, entry.cycle_entry.terminal_owner])).toEqual([
      [1, -11, "initial_protective_stop"], [2, -11, "initial_protective_stop"],
      [3, 10, "initial_take_profit"], [4, -11, "initial_protective_stop"],
    ])
    expect(outcome.evidence.consolidated_ledger.every((entry) =>
      entry.cycle_ledger_entry_hash === entry.cycle_entry.ledger_entry_hash)).toBe(true)
    expect(outcome.evidence.consolidated_journal.filter((entry) =>
      entry.cycle_entry.posting_kind === "opening_cash").map((entry) => entry.cycle_index)).toEqual([1])
    expect(outcome.evidence.consolidated_trial_balance).toMatchObject({
      opening_equity_posting_count: 1, initial_cash: 100, ending_available_cash: 77,
      ending_reserved_isolated_collateral: 0, ending_settled_cash: 77,
      ending_unrealized_pnl: 0, ending_portfolio_nav: 77, balanced: true,
      balances: { opening_equity: 100, realized_pnl_income: 10, realized_pnl_loss: 33 },
    })
    expect(outcome.evidence.evidence_hash)
      .toBe(replayPortfolioProtectiveTakeProfitCancelCycleSequenceEvidenceHash(outcome.evidence))
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "cycle_sequence_plan", "cycle_sequence_reservation", "cycle_cancel_terminal_artifact_manifests",
      "cycle_cancel_terminal_evidence", "cycle_cancel_terminal_accounting_artifact_manifests",
      "cycle_cancel_terminal_accounting_evidence", "consolidated_ledger", "consolidated_journal",
      "consolidated_trial_balance", "consolidated_fingerprint", "cancel_cycle_sequence_evidence",
    ])
    const retry = runReplayPortfolioProtectiveTakeProfitCancelCycleSequence(input)
    expect(retry.evidence).toEqual(outcome.evidence); expect(retry.idempotent_replay).toBe(true)
    let riskCalls = 0
    expect(runReplayPortfolioProtectiveTakeProfitCancelCycleSequence({ ...input,
      execute_risk_slice: (engineInput) => {
        riskCalls += 1
        if (riskCalls === 3) throw new Error("fixture target cancel cycle 3 Risk failure")
        return executeReplayRuntimeSharedWalletRiskSlice(engineInput)
      },
    })).toMatchObject({ status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cancel-cycle-risk-failed", cycle_index: 3,
        partial_sequence_result_published: false } })
    const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
    expect(runReplayPortfolioProtectiveTakeProfitCancelCycleSequence({ ...input,
      artifact_store: failWriteOnce(interruptedBase, "consolidated-journal.json") })).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cancel-cycle-sequence-artifact-failed", partial_sequence_result_published: false },
    })
    const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
      namespace.listNames().includes("consolidated-ledger.json"))
    expect(orphan?.exists("portfolio-protective-take-profit-cancel-cycle-sequence-artifact-manifest.json"))
      .toBe(false)
    const tampered = structuredClone(outcome.evidence)
    tampered.consolidated_journal[1]!.cycle_index = 2
    tampered.consolidated_journal[1]!.sequence_entry_hash =
      replayPortfolioProtectiveTakeProfitCancelCycleSequenceJournalEntryHash(tampered.consolidated_journal[1]!)
    tampered.fingerprint.consolidated_journal_hash = canonicalHash(tampered.consolidated_journal)
    tampered.fingerprint.fingerprint_hash =
      replayPortfolioProtectiveTakeProfitCancelCycleSequenceFingerprintHash(tampered.fingerprint)
    tampered.evidence_hash = replayPortfolioProtectiveTakeProfitCancelCycleSequenceEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveTakeProfitCancelCycleSequenceEvidence(tampered)).toThrow("journal")
  } finally {
    rmSync(root, { recursive: true, force: true }); rmSync(interruptedRoot, { recursive: true, force: true })
  }
})

test("Portfolio strategy-exit cancel preserves the bracket and makes the former exit unreachable", () => {
  const cases = [
    { id: "long-target", side: "long" as const, terminal: "target" as const,
      stop: 90, target: 110, owner: "initial_take_profit", cash: 111 },
    { id: "short-stop", side: "short" as const, terminal: "stop" as const,
      stop: 110, target: 90, owner: "initial_protective_stop", cash: 89 },
  ] as const
  for (const item of cases) {
    const primaryBase = runtimeLaneInput({
      laneId: `strategy-exit-cancel-${item.id}`, symbol: "BTCUSDT", collateral: 20, feeBps: 0,
    })
    Object.assign(primaryBase.trial.request.order, {
      side: item.side, stop_price: item.stop, target_price: item.target,
    })
    const primary = withRuntimeRisk(withRuntimeStrategyExitCancel(primaryBase, {
      terminal: item.terminal,
    }), [100, 100, 100])
    const rejected = withRuntimeRisk(runtimeLaneInput({
      laneId: `strategy-exit-cancel-${item.id}-rejected`, symbol: "ETHUSDT", collateral: 20, feeBps: 0,
    }), [100, 100, 100])
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: `portfolio-strategy-exit-cancel-${item.id}` }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    const allocationAuthority = portfolioAllocationReservation(
      allocationPlan, lanes, [primary.lane_id, rejected.lane_id], { gross: 100, net: 100, risk: 25 },
    )
    const riskAuthority = runtimeRiskReservation(riskPlan, lanes, [primary.lane_id, rejected.lane_id])
    const integratedPlan = integratedPortfolioPlan(
      allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
    )
    const root = mkdtempSync(join(tmpdir(), `replay-portfolio-strategy-exit-cancel-${item.id}-`))
    try {
      const input = {
        integrated_plan: integratedPlan, allocation_plan: allocationPlan,
        allocation_reservation: allocationAuthority, risk_plan: riskPlan, risk_reservation: riskAuthority,
        lanes: [...lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
        artifact_store: createReplayLocalArtifactStore(root),
      }
      expect(runReplayIntegratedPortfolio(input)).toMatchObject({
        status: "failed", failure: { code: "integrated-risk-failed", partial_result_published: false },
      })
      const outcome = runReplayPortfolioProtectiveStrategyExitCancelTerminal(input)
      if (!outcome.evidence || !outcome.artifact_manifest || !outcome.source_protective_terminal_evidence) {
        throw new Error(outcome.failure?.message ?? "strategy-exit cancel terminal missing")
      }
      const record = outcome.evidence.lane_records.find((candidate) => candidate.lane_id === primary.lane_id)!
      expect(record).toMatchObject({
        owner: item.owner, cancel_status: "cancelled_then_terminal",
        cancelled_strategy_exit_time: primary.trial.bars[2]!.open_time,
        active_protection_mode: "bracket", ending_open: false,
      })
      expect(record.terminal_time).toBe(primary.trial.bars[2]!.open_time)
      expect(record.owner).not.toBe("strategy_exit")
      expect(outcome.source_protective_terminal_evidence.lane_records
        .find((candidate) => candidate.lane_id === primary.lane_id)?.owner).toBe(item.owner)
      expect(outcome.evidence.ohlcv_resolutions[0]).toMatchObject({
        observation_kind: "bar_open_gap",
        active_protection: {
          protection_mode: "bracket", stop_order_status: "active", target_order_status: "active",
          stop_trigger_price: item.stop, target_trigger_price: item.target,
        },
        canonical: { terminal_role: item.terminal },
      })
      expect(outcome.evidence).toMatchObject({
        ending_settled_cash: item.cash, ending_available_cash: item.cash,
        terminal_owner_counts: { [item.owner]: 1, not_opened: 1 },
      })
      expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
        "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
        "cancel_terminal_records", "ohlcv_resolutions", "cancel_terminal_fingerprint",
        "cancel_terminal_evidence",
      ])
      const accounting = runReplayPortfolioProtectiveStrategyExitCancelTerminalAccounting(input)
      if (!accounting.evidence || !accounting.artifact_manifest || !accounting.cancel_terminal_evidence) {
        throw new Error(accounting.failure?.message ?? "strategy-exit cancel accounting missing")
      }
      expect(accounting.evidence.ledger.map((entry) => [entry.amount, entry.terminal_owner]))
        .toEqual([[item.cash - 100, item.owner]])
      expect(accounting.evidence.trial_balance).toMatchObject({
        ending_available_cash: item.cash, ending_settled_cash: item.cash,
        ending_reserved_isolated_collateral: 0, ending_unrealized_pnl: 0,
        ending_portfolio_nav: item.cash, balanced: true,
      })
      expect(accounting.artifact_manifest.files.map((file) => file.role)).toEqual([
        "cancel_terminal_artifact_manifest", "risk_result", "cancel_terminal_evidence",
        "cancel_terminal_ledger", "cancel_terminal_journal", "cancel_terminal_trial_balance",
        "cancel_terminal_accounting_fingerprint", "cancel_terminal_accounting_evidence",
      ])
      const risk = runReplayIntegratedPortfolio({
        ...input, allow_predeclared_strategy_exit_cancel_projection: true,
      }).risk_result!
      expect(() => assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence(
        accounting.evidence!, {
          cancel_terminal_evidence: accounting.cancel_terminal_evidence!,
          cancel_terminal_manifest: outcome.artifact_manifest!, risk_result: risk,
        },
      )).not.toThrow()
      const retry = runReplayPortfolioProtectiveStrategyExitCancelTerminal(input)
      expect(retry.evidence).toEqual(outcome.evidence)
      expect(retry.idempotent_replay).toBe(true)
      const failed = runReplayPortfolioProtectiveStrategyExitCancelTerminal({
        ...input, execute_cancel_terminal: () => { throw new Error("fixture strategy-exit cancel Engine failure") },
      })
      expect(failed).toMatchObject({
        status: "failed", source_protective_terminal_evidence: null, evidence: null,
        artifact_manifest: null,
        failure: { code: "cancel-terminal-engine-failed", partial_result_published: false },
      })
      const tampered = structuredClone(accounting.evidence)
      tampered.ledger[0]!.terminal_owner = "strategy_exit"
      tampered.ledger[0]!.ledger_entry_hash =
        replayPortfolioProtectiveStrategyExitCancelTerminalAccountingLedgerEntryHash(tampered.ledger[0]!)
      tampered.fingerprint.ledger_hash = canonicalHash(tampered.ledger)
      tampered.fingerprint.fingerprint_hash =
        replayPortfolioProtectiveStrategyExitCancelTerminalAccountingFingerprintHash(tampered.fingerprint)
      tampered.evidence_hash = replayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidenceHash(tampered)
      expect(() => assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence(
        tampered, {
          cancel_terminal_evidence: accounting.cancel_terminal_evidence!,
          cancel_terminal_manifest: outcome.artifact_manifest!, risk_result: risk,
        },
      )).toThrow("ledger record binding")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  const raceBase = runtimeLaneInput({
    laneId: "strategy-exit-cancel-race", symbol: "SOLUSDT", collateral: 20, feeBps: 0,
  })
  Object.assign(raceBase.trial.request.order, { side: "long", stop_price: 90, target_price: 110 })
  const race = withRuntimeRisk(withRuntimeStrategyExitCancel(raceBase, {
    terminal: "stop", terminalAtCancelBoundary: true,
  }), [100, 100, 100])
  const raceRejected = withRuntimeRisk(runtimeLaneInput({
    laneId: "strategy-exit-cancel-race-rejected", symbol: "BNBUSDT", collateral: 20, feeBps: 0,
  }), [100, 100, 100])
  const raceLanes = [race, raceRejected]
  const allocationDraft = portfolioAllocationPlan(raceLanes)
  const allocationBody = { ...allocationDraft, portfolio_id: "portfolio-strategy-exit-cancel-race" }
  const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
  const riskDraft = runtimeRiskPlan(raceLanes)
  const riskBody = { ...riskDraft, portfolio_id: allocationPlan.portfolio_id }
  const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
  const allocationAuthority = portfolioAllocationReservation(
    allocationPlan, raceLanes, [race.lane_id, raceRejected.lane_id], { gross: 100, net: 100, risk: 25 },
  )
  const riskAuthority = runtimeRiskReservation(riskPlan, raceLanes, [race.lane_id, raceRejected.lane_id])
  const integratedPlan = integratedPortfolioPlan(
    allocationPlan, allocationAuthority.reservation_hash, riskPlan, riskAuthority.reservation_hash,
  )
  const root = mkdtempSync(join(tmpdir(), "replay-portfolio-strategy-exit-cancel-race-"))
  try {
    const outcome = runReplayPortfolioProtectiveStrategyExitCancelTerminal({
      integrated_plan: integratedPlan, allocation_plan: allocationPlan,
      allocation_reservation: allocationAuthority, risk_plan: riskPlan, risk_reservation: riskAuthority,
      lanes: [...raceLanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: createReplayLocalArtifactStore(root),
    })
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "strategy-exit cancel race missing")
    expect(outcome.evidence.lane_records.find((record) => record.lane_id === race.lane_id)).toMatchObject({
      owner: "initial_protective_stop", cancel_status: "terminal_before_or_at_decision",
      active_protection_mode: "bracket", realized_pnl: -10,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("strategy-exit cancel rolls committed bracket-preserved accounting through four bounded cycles", () => {
  const definitions = [
    { id: "exit-cancel-cycle-long-target", symbol: "BTCUSDT", rejected: "ETHUSDT",
      entry: "2026-07-14T00:01:00Z", side: "long" as const, terminal: "target" as const },
    { id: "exit-cancel-cycle-short-target", symbol: "SOLUSDT", rejected: "BNBUSDT",
      entry: "2026-07-14T00:04:00Z", side: "short" as const, terminal: "target" as const },
    { id: "exit-cancel-cycle-race", symbol: "XRPUSDT", rejected: "ADAUSDT",
      entry: "2026-07-14T00:07:00Z", side: "long" as const, terminal: "stop" as const,
      terminalAtCancelBoundary: true },
    { id: "exit-cancel-cycle-long-stop", symbol: "DOGEUSDT", rejected: "LTCUSDT",
      entry: "2026-07-14T00:10:00Z", side: "long" as const, terminal: "stop" as const },
  ] as const
  const portfolioId = "portfolio-strategy-exit-cancel-cycle-sequence-1"
  const fixtures = definitions.map((definition) => {
    const primaryBase = runtimeLaneInput({ laneId: definition.id, symbol: definition.symbol,
      collateral: 20, feeBps: 0, executableTime: definition.entry })
    Object.assign(primaryBase.trial.request.order, {
      side: definition.side, stop_price: definition.side === "long" ? 90 : 110,
      target_price: definition.side === "long" ? 110 : 90,
    })
    const marks = [definition.entry,
      new Date(Date.parse(definition.entry) + 60_000).toISOString(),
      new Date(Date.parse(definition.entry) + 120_000).toISOString()] as [string, string, string]
    const primary = withRuntimeRisk(withRuntimeStrategyExitCancel(primaryBase, {
      terminal: definition.terminal,
      terminalAtCancelBoundary: "terminalAtCancelBoundary" in definition
        && definition.terminalAtCancelBoundary,
    }), [100, 100, 100], { markTimes: marks })
    const rejectedBase = runtimeLaneInput({ laneId: `${definition.id}-rejected`,
      symbol: definition.rejected, collateral: 20, feeBps: 0, executableTime: definition.entry })
    Object.assign(rejectedBase.trial.request.order, {
      side: definition.side, stop_price: definition.side === "long" ? 90 : 110,
      target_price: definition.side === "long" ? 110 : 90,
    })
    const rejected = withRuntimeRisk(rejectedBase, [100, 100, 100], { markTimes: marks })
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: portfolioId }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: portfolioId }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    return { lanes, allocationPlan, riskPlan, entry: definition.entry }
  })
  const reservation = createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "strategy-exit-cancel-cycle-sequence-4",
    reservation_ref: "reservation://strategy-exit-cancel-cycle-sequence/4",
    issued_at: "2026-07-14T00:00:30Z", expires_at: "2026-07-14T00:14:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "trial-group-1",
    trial_group_hash: HASH, portfolio_id: portfolioId, settlement_asset: "USDT", initial_cash: 100,
    cycle_count: fixtures.length, max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles: fixtures.map((fixture, index) => ({
      cycle_index: index + 1, allocation_plan_hash: fixture.allocationPlan.plan_hash,
      risk_plan_hash: fixture.riskPlan.plan_hash, earliest_cycle_time: fixture.entry,
      max_gross_exposure_amount: 200, max_abs_net_exposure_amount: 100, max_portfolio_risk_amount: 25,
      lanes: fixture.lanes.map((lane, laneIndex) => ({ lane_id: lane.lane_id, priority_rank: laneIndex + 1,
        trial_id: lane.trial.request.trial_id, run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        max_lane_risk_amount: 15 })),
    })),
    limitations: ["one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion"],
  })
  const planned = fixtures.map((fixture) => ({ ...fixture, integratedPlan: integratedPortfolioPlan(
    fixture.allocationPlan, reservation.reservation_hash, fixture.riskPlan, reservation.reservation_hash,
  ) }))
  const plan = cycleSequencePlan(portfolioId, reservation.reservation_hash, planned)
  const root = mkdtempSync(join(tmpdir(), "replay-strategy-exit-cancel-cycle-sequence-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-strategy-exit-cancel-cycle-interrupted-"))
  try {
    const input = { plan, reservation,
      cycles: planned.map((fixture, index) => ({ cycle_index: index + 1,
        integrated_plan: fixture.integratedPlan, allocation_plan: fixture.allocationPlan,
        risk_plan: fixture.riskPlan,
        lanes: [...fixture.lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })) })),
      artifact_store: createReplayLocalArtifactStore(root) }
    expect(runReplayPortfolioCycleSequence(input)).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: { code: "cycle-risk-failed", cycle_index: 1 },
    })
    const outcome = runReplayPortfolioProtectiveStrategyExitCancelCycleSequence(input)
    if (!outcome.evidence || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "Strategy-exit Cancel Cycle Sequence missing")
    }
    expect(outcome.evidence.cycle_commits.map((commit) => [commit.cycle_index,
      commit.opening_available_cash, commit.ending_available_cash])).toEqual([
      [1, 100, 111], [2, 111, 122], [3, 122, 112], [4, 112, 101],
    ])
    expect(outcome.evidence.consolidated_ledger.map((entry) => [entry.cycle_index,
      entry.cycle_entry.amount, entry.cycle_entry.terminal_owner])).toEqual([
      [1, 11, "initial_take_profit"], [2, 11, "initial_take_profit"],
      [3, -10, "initial_protective_stop"], [4, -11, "initial_protective_stop"],
    ])
    expect(outcome.evidence.consolidated_ledger.every((entry) =>
      entry.cycle_ledger_entry_hash === entry.cycle_entry.ledger_entry_hash)).toBe(true)
    expect(outcome.evidence.consolidated_journal.filter((entry) =>
      entry.cycle_entry.posting_kind === "opening_cash").map((entry) => entry.cycle_index)).toEqual([1])
    expect(outcome.evidence.consolidated_trial_balance).toMatchObject({
      opening_equity_posting_count: 1, initial_cash: 100, ending_available_cash: 101,
      ending_reserved_isolated_collateral: 0, ending_settled_cash: 101,
      ending_unrealized_pnl: 0, ending_portfolio_nav: 101, balanced: true,
      balances: { opening_equity: 100, realized_pnl_income: 22, realized_pnl_loss: 21 },
    })
    expect(outcome.evidence.evidence_hash)
      .toBe(replayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidenceHash(outcome.evidence))
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "cycle_sequence_plan", "cycle_sequence_reservation", "cycle_cancel_terminal_artifact_manifests",
      "cycle_cancel_terminal_evidence", "cycle_cancel_terminal_accounting_artifact_manifests",
      "cycle_cancel_terminal_accounting_evidence", "consolidated_ledger", "consolidated_journal",
      "consolidated_trial_balance", "consolidated_fingerprint", "cancel_cycle_sequence_evidence",
    ])
    const retry = runReplayPortfolioProtectiveStrategyExitCancelCycleSequence(input)
    expect(retry.evidence).toEqual(outcome.evidence)
    expect(retry.idempotent_replay).toBe(true)
    let riskCalls = 0
    expect(runReplayPortfolioProtectiveStrategyExitCancelCycleSequence({ ...input,
      execute_risk_slice: (engineInput) => {
        riskCalls += 1
        if (riskCalls === 3) throw new Error("fixture strategy-exit cancel cycle 3 Risk failure")
        return executeReplayRuntimeSharedWalletRiskSlice(engineInput)
      },
    })).toMatchObject({ status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cancel-cycle-risk-failed", cycle_index: 3,
        partial_sequence_result_published: false } })
    const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
    expect(runReplayPortfolioProtectiveStrategyExitCancelCycleSequence({ ...input,
      artifact_store: failWriteOnce(interruptedBase, "consolidated-journal.json") })).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cancel-cycle-sequence-artifact-failed", partial_sequence_result_published: false },
    })
    const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
      namespace.listNames().includes("consolidated-ledger.json"))
    expect(orphan?.exists("portfolio-protective-strategy-exit-cancel-cycle-sequence-artifact-manifest.json"))
      .toBe(false)
    const tampered = structuredClone(outcome.evidence)
    tampered.consolidated_journal[1]!.cycle_index = 2
    tampered.consolidated_journal[1]!.sequence_entry_hash =
      replayPortfolioProtectiveStrategyExitCancelCycleSequenceJournalEntryHash(tampered.consolidated_journal[1]!)
    tampered.fingerprint.consolidated_journal_hash = canonicalHash(tampered.consolidated_journal)
    tampered.fingerprint.fingerprint_hash =
      replayPortfolioProtectiveStrategyExitCancelCycleSequenceFingerprintHash(tampered.fingerprint)
    tampered.evidence_hash = replayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence(tampered))
      .toThrow("journal")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(interruptedRoot, { recursive: true, force: true })
  }
})

test("Portfolio protective-stop cancel degrades risk without releasing budget and preserves target ownership", () => {
  for (const item of [
    { id: "long", side: "long" as const, stop: 90, target: 110, targetOpen: 111 },
    { id: "short", side: "short" as const, stop: 110, target: 90, targetOpen: 89 },
  ]) {
    const laneBase = runtimeLaneInput({
      laneId: `stop-cancel-${item.id}`, symbol: item.id === "long" ? "BTCUSDT" : "ETHUSDT",
      collateral: 20, feeBps: 0,
    })
    Object.assign(laneBase.trial.request.order, {
      side: item.side, stop_price: item.stop, target_price: item.target,
    })
    const lane = withRuntimeRisk(withRuntimeProtectiveStopCancel(laneBase), [100, 100, 100])
    const root = mkdtempSync(join(tmpdir(), `replay-portfolio-stop-cancel-${item.id}-`))
    try {
      const input = protectiveStopCancelPortfolioInput(
        [lane], `portfolio-stop-cancel-${item.id}`, root,
      )
      expect(runReplayIntegratedPortfolio(input)).toMatchObject({
        status: "failed", failure: { code: "integrated-risk-failed", partial_result_published: false },
      })
      const outcome = runReplayPortfolioProtectiveStopCancelTerminal(input)
      if (!outcome.evidence || !outcome.artifact_manifest || !outcome.source_protective_terminal_evidence) {
        throw new Error(outcome.failure?.message ?? "protective-stop cancel terminal missing")
      }
      const record = outcome.evidence.lane_records[0]!
      expect(record).toMatchObject({
        owner: "initial_take_profit", cancel_status: "cancelled_then_terminal",
        cancelled_stop_price: item.stop, active_protection_mode: "target_only",
        current_risk_state: "released_on_full_flat", admission_frozen_stop_risk_amount: 10,
        current_active_stop_risk_amount: 0, reserved_admission_risk_amount: 0,
        risk_budget_release_amount: 10, cancel_cashflow: 0,
        terminal_phase: 20, realized_pnl: 11, ending_open: false,
      })
      expect(outcome.source_protective_terminal_evidence.lane_records[0]?.owner)
        .toBe("initial_protective_stop")
      expect(outcome.evidence.ohlcv_resolutions[0]).toMatchObject({
        observation_kind: "bar_open_gap",
        active_protection: {
          protection_mode: "target_only", stop_order_status: "cancelled", target_order_status: "active",
          stop_trigger_price: item.stop, target_trigger_price: item.target,
        },
        canonical: { terminal_role: "target" },
      })
      expect(outcome.evidence.ohlcv_resolutions[0]!.paths
        .every((path) => path.simulated_execution_price === item.targetOpen)).toBe(true)
      expect(outcome.evidence).toMatchObject({
        ending_settled_cash: 111, ending_available_cash: 111,
        historical_admission_frozen_stop_risk: 10, ending_portfolio_frozen_stop_risk: 0,
        ending_portfolio_active_stop_bounded_risk: 0, total_risk_budget_released: 10,
        unbounded_by_active_stop_lane_ids: [], cancel_cashflow_total: 0,
        terminal_owner_counts: { initial_take_profit: 1 },
      })
      expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
        "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
        "cancel_terminal_records", "ohlcv_resolutions", "cancel_terminal_fingerprint",
        "cancel_terminal_evidence",
      ])
      const accounting = runReplayPortfolioProtectiveStopCancelTerminalAccounting(input)
      if (!accounting.evidence || !accounting.artifact_manifest || !accounting.cancel_terminal_evidence) {
        throw new Error(accounting.failure?.message ?? "protective-stop cancel accounting missing")
      }
      expect(accounting.evidence.ledger.map((entry) => [
        entry.cashflow_kind, entry.amount, entry.settled_cash_after, entry.terminal_owner,
      ])).toEqual([["realized_pnl", 11, 111, "initial_take_profit"]])
      expect(accounting.evidence.journal.map((entry) => entry.posting_kind)).toEqual([
        "opening_cash", "collateral_reserve", "realized_pnl", "collateral_release",
      ])
      expect(accounting.evidence.journal.some((entry) => entry.posting_kind.includes("cancel"))).toBe(false)
      expect(accounting.evidence.trial_balance).toMatchObject({
        ending_available_cash: 111, ending_reserved_isolated_collateral: 0,
        ending_settled_cash: 111, ending_unrealized_pnl: 0, ending_portfolio_nav: 111, balanced: true,
      })
      const risk = runReplayIntegratedPortfolio({
        ...input, allow_predeclared_protective_stop_cancel_projection: true,
      }).risk_result!
      expect(() => assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence(
        accounting.evidence!, {
          cancel_terminal_evidence: accounting.cancel_terminal_evidence!,
          cancel_terminal_manifest: outcome.artifact_manifest!, risk_result: risk,
        },
      )).not.toThrow()
      expect(runReplayPortfolioProtectiveStopCancelTerminal(input)).toMatchObject({
        status: "completed", idempotent_replay: true, evidence: outcome.evidence,
      })
      expect(runReplayPortfolioProtectiveStopCancelTerminal({
        ...input, execute_cancel_terminal: () => { throw new Error("fixture stop cancel Engine failure") },
      })).toMatchObject({
        status: "failed", source_protective_terminal_evidence: null, evidence: null,
        artifact_manifest: null,
        failure: { code: "cancel-terminal-engine-failed", partial_result_published: false },
      })
      const tamperedAccounting = structuredClone(accounting.evidence)
      tamperedAccounting.ledger[0]!.terminal_owner = "initial_protective_stop"
      tamperedAccounting.ledger[0]!.ledger_entry_hash =
        replayPortfolioProtectiveStopCancelTerminalAccountingLedgerEntryHash(tamperedAccounting.ledger[0]!)
      tamperedAccounting.fingerprint.ledger_hash = canonicalHash(tamperedAccounting.ledger)
      tamperedAccounting.fingerprint.fingerprint_hash =
        replayPortfolioProtectiveStopCancelTerminalAccountingFingerprintHash(tamperedAccounting.fingerprint)
      tamperedAccounting.evidence_hash =
        replayPortfolioProtectiveStopCancelTerminalAccountingEvidenceHash(tamperedAccounting)
      expect(() => assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence(
        tamperedAccounting, {
          cancel_terminal_evidence: accounting.cancel_terminal_evidence!,
          cancel_terminal_manifest: outcome.artifact_manifest!, risk_result: risk,
        },
      )).toThrow("ledger record binding")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  const raceBase = runtimeLaneInput({ laneId: "stop-cancel-race", symbol: "SOLUSDT", collateral: 20, feeBps: 0 })
  Object.assign(raceBase.trial.request.order, { side: "long", stop_price: 90, target_price: 110 })
  const race = withRuntimeRisk(withRuntimeProtectiveStopCancel(raceBase, { sameBoundaryStop: true }),
    [100, 100, 100])
  const raceRoot = mkdtempSync(join(tmpdir(), "replay-portfolio-stop-cancel-race-"))
  try {
    const outcome = runReplayPortfolioProtectiveStopCancelTerminal(
      protectiveStopCancelPortfolioInput([race], "portfolio-stop-cancel-race", raceRoot),
    )
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "stop cancel race missing")
    expect(outcome.evidence.lane_records[0]).toMatchObject({
      owner: "initial_protective_stop", cancel_status: "terminal_before_or_at_decision",
      active_protection_mode: "bracket", current_risk_state: "released_on_full_flat",
      realized_pnl: -10, risk_budget_release_amount: 10,
    })
  } finally { rmSync(raceRoot, { recursive: true, force: true }) }

  const openBase = runtimeLaneInput({ laneId: "stop-cancel-open", symbol: "XRPUSDT", collateral: 20, feeBps: 0 })
  Object.assign(openBase.trial.request.order, { side: "long", stop_price: 90, target_price: 110 })
  const openLane = withRuntimeRisk(withRuntimeProtectiveStopCancel(openBase, { terminal: "open" }),
    [100, 100, 105])
  const openRoot = mkdtempSync(join(tmpdir(), "replay-portfolio-stop-cancel-open-"))
  try {
    const input = protectiveStopCancelPortfolioInput([openLane], "portfolio-stop-cancel-open", openRoot)
    const outcome = runReplayPortfolioProtectiveStopCancelTerminal(input)
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "stop cancel open evidence missing")
    const record = outcome.evidence.lane_records[0]!
    expect(record).toMatchObject({
      owner: "open_at_data_end", cancel_status: "cancelled_no_terminal",
      active_protection_mode: "target_only", current_risk_state: "unbounded_by_active_stop",
      admission_frozen_stop_risk_amount: 10, current_active_stop_risk_amount: null,
      reserved_admission_risk_amount: 10, risk_budget_release_amount: 0,
      cancel_cashflow: 0, ending_open: true, ending_unrealized_pnl: 5,
    })
    expect(outcome.source_protective_terminal_evidence?.lane_records[0]?.owner)
      .toBe("initial_protective_stop")
    expect(outcome.evidence).toMatchObject({
      ending_settled_cash: 100, ending_reserved_isolated_collateral: 20, ending_available_cash: 80,
      ending_unrealized_pnl: 5, ending_portfolio_nav: 105,
      ending_gross_mark_exposure: 105, ending_net_mark_exposure: 105,
      historical_admission_frozen_stop_risk: 10, ending_portfolio_frozen_stop_risk: 10,
      ending_portfolio_active_stop_bounded_risk: null, total_risk_budget_released: 0,
      unbounded_by_active_stop_lane_ids: [openLane.lane_id], cancel_cashflow_total: 0,
    })
    expect(() => assertReplayPortfolioProtectiveReplacementCycleFullFlat(outcome.evidence!))
      .toThrow("full-flat")
    const accounting = runReplayPortfolioProtectiveStopCancelTerminalAccounting(input)
    expect(accounting.evidence?.journal.map((entry) => entry.posting_kind)).toEqual([
      "opening_cash", "collateral_reserve", "terminal_mark_to_market",
    ])
    const tampered = structuredClone(outcome.evidence)
    tampered.lane_records[0]!.current_risk_state = "protected_by_active_stop"
    tampered.lane_records[0]!.current_active_stop_risk_amount = 10
    tampered.lane_records[0]!.record_hash =
      replayPortfolioProtectiveStopCancelTerminalRecordHash(tampered.lane_records[0]!)
    tampered.lane_records_hash = canonicalHash(tampered.lane_records)
    tampered.fingerprint.lane_records_hash = tampered.lane_records_hash
    tampered.fingerprint.fingerprint_hash =
      replayPortfolioProtectiveStopCancelTerminalFingerprintHash(tampered.fingerprint)
    tampered.evidence_hash = replayPortfolioProtectiveStopCancelTerminalEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveStopCancelTerminalEvidence(tampered))
      .toThrow("cancelled-open risk degradation")
  } finally { rmSync(openRoot, { recursive: true, force: true }) }

  const liquidationBase = runtimeLaneInput({
    laneId: "stop-cancel-liquidation", symbol: "ADAUSDT", collateral: 20, feeBps: 0,
  })
  Object.assign(liquidationBase.trial.request.order, { side: "long", stop_price: 90, target_price: 110 })
  const liquidationLane = withRuntimeRisk(
    withRuntimeProtectiveStopCancel(liquidationBase, { terminal: "open" }), [100, 80, 80],
  )
  const liquidationRoot = mkdtempSync(join(tmpdir(), "replay-portfolio-stop-cancel-liquidation-"))
  try {
    const outcome = runReplayPortfolioProtectiveStopCancelTerminal(protectiveStopCancelPortfolioInput(
      [liquidationLane], "portfolio-stop-cancel-liquidation", liquidationRoot,
    ))
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "stop cancel liquidation missing")
    expect(outcome.evidence.lane_records[0]).toMatchObject({
      owner: "exact_liquidation", cancel_status: "cancelled_then_terminal",
      active_protection_mode: "target_only", current_risk_state: "released_on_full_flat",
      realized_pnl: -20, risk_budget_release_amount: 10, ending_open: false,
    })
    expect(outcome.evidence).toMatchObject({
      ending_settled_cash: 80, ending_available_cash: 80,
      ending_portfolio_frozen_stop_risk: 0, total_risk_budget_released: 10,
      terminal_owner_counts: { exact_liquidation: 1 },
    })
  } finally { rmSync(liquidationRoot, { recursive: true, force: true }) }
})

test("protective-stop cancel releases admission risk only after full-flat and rolls four committed cycles", () => {
  const definitions = [
    { id: "stop-cancel-cycle-long", symbol: "BTCUSDT", rejected: "ETHUSDT",
      entry: "2026-07-14T00:01:00Z", side: "long" as const, terminal: "target" as const,
      marks: [100, 100, 100] as [number, number, number] },
    { id: "stop-cancel-cycle-short", symbol: "SOLUSDT", rejected: "BNBUSDT",
      entry: "2026-07-14T00:04:00Z", side: "short" as const, terminal: "target" as const,
      marks: [100, 100, 100] as [number, number, number] },
    { id: "stop-cancel-cycle-liquidation", symbol: "XRPUSDT", rejected: "ADAUSDT",
      entry: "2026-07-14T00:07:00Z", side: "long" as const, terminal: "open" as const,
      marks: [100, 80, 80] as [number, number, number] },
    { id: "stop-cancel-cycle-final", symbol: "DOGEUSDT", rejected: "LTCUSDT",
      entry: "2026-07-14T00:10:00Z", side: "long" as const, terminal: "target" as const,
      marks: [100, 100, 100] as [number, number, number] },
  ] as const
  const portfolioId = "portfolio-stop-cancel-cycle-sequence-1"
  const fixtures = definitions.map((definition) => {
    const markTimes: [string, string, string] = [definition.entry,
      new Date(Date.parse(definition.entry) + 60_000).toISOString().replace(".000Z", "Z"),
      new Date(Date.parse(definition.entry) + 120_000).toISOString().replace(".000Z", "Z")]
    const primaryBase = runtimeLaneInput({ laneId: definition.id, symbol: definition.symbol,
      collateral: 20, feeBps: 0, executableTime: definition.entry })
    Object.assign(primaryBase.trial.request.order, {
      side: definition.side, stop_price: definition.side === "long" ? 90 : 110,
      target_price: definition.side === "long" ? 110 : 90,
    })
    const primary = withRuntimeRisk(withRuntimeProtectiveStopCancel(primaryBase, {
      terminal: definition.terminal,
    }), [...definition.marks] as [number, number, number], { markTimes })
    const rejected = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
      laneId: `${definition.id}-rejected`, symbol: definition.rejected, collateral: 20, feeBps: 0,
      executableTime: definition.entry,
    }), { executableTime: markTimes[2], open: 100 }), [100, 100, 100], { markTimes })
    const lanes = [primary, rejected]
    const allocationDraft = portfolioAllocationPlan(lanes)
    const allocationBody = { ...allocationDraft, portfolio_id: portfolioId }
    const allocationPlan = { ...allocationBody, plan_hash: replayPortfolioAllocationPlanHash(allocationBody) }
    const riskDraft = runtimeRiskPlan(lanes)
    const riskBody = { ...riskDraft, portfolio_id: portfolioId }
    const riskPlan = { ...riskBody, plan_hash: replayRuntimeSharedWalletRiskPlanHash(riskBody) }
    return { lanes, allocationPlan, riskPlan, entry: definition.entry }
  })
  const reservation = createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "stop-cancel-cycle-sequence-4",
    reservation_ref: "reservation://stop-cancel-cycle-sequence/4",
    issued_at: "2026-07-14T00:00:30Z", expires_at: "2026-07-14T00:14:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "trial-group-1",
    trial_group_hash: HASH, portfolio_id: portfolioId, settlement_asset: "USDT", initial_cash: 100,
    cycle_count: fixtures.length, max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles: fixtures.map((fixture, index) => ({
      cycle_index: index + 1, allocation_plan_hash: fixture.allocationPlan.plan_hash,
      risk_plan_hash: fixture.riskPlan.plan_hash, earliest_cycle_time: fixture.entry,
      max_gross_exposure_amount: 200, max_abs_net_exposure_amount: 100, max_portfolio_risk_amount: 25,
      lanes: fixture.lanes.map((lane, laneIndex) => ({ lane_id: lane.lane_id, priority_rank: laneIndex + 1,
        trial_id: lane.trial.request.trial_id, run_id: lane.trial.request.run_id,
        trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
        trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
        max_lane_risk_amount: 15 })),
    })),
    limitations: ["one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion"],
  })
  const planned = fixtures.map((fixture) => ({ ...fixture, integratedPlan: integratedPortfolioPlan(
    fixture.allocationPlan, reservation.reservation_hash, fixture.riskPlan, reservation.reservation_hash,
  ) }))
  const plan = cycleSequencePlan(portfolioId, reservation.reservation_hash, planned)
  const root = mkdtempSync(join(tmpdir(), "replay-stop-cancel-cycle-sequence-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-stop-cancel-cycle-interrupted-"))
  try {
    const input = { plan, reservation,
      cycles: planned.map((fixture, index) => ({ cycle_index: index + 1,
        integrated_plan: fixture.integratedPlan, allocation_plan: fixture.allocationPlan,
        risk_plan: fixture.riskPlan,
        lanes: [...fixture.lanes].reverse().map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })) })),
      artifact_store: createReplayLocalArtifactStore(root) }
    expect(runReplayPortfolioCycleSequence(input)).toMatchObject({
      status: "failed", result: null, artifact_manifest: null,
      failure: { code: "cycle-risk-failed", cycle_index: 1 },
    })
    const outcome = runReplayPortfolioProtectiveStopCancelCycleSequence(input)
    if (!outcome.evidence || !outcome.artifact_manifest) {
      throw new Error(outcome.failure?.message ?? "Protective Stop Cancel Cycle Sequence missing")
    }
    expect(outcome.evidence.cycle_commits.map((commit) => [commit.cycle_index,
      commit.opening_available_cash, commit.ending_available_cash])).toEqual([
      [1, 100, 111], [2, 111, 122], [3, 122, 102], [4, 102, 113],
    ])
    expect(outcome.evidence.consolidated_ledger.map((entry) => [entry.cycle_index,
      entry.cycle_entry.amount, entry.cycle_entry.terminal_owner])).toEqual([
      [1, 11, "initial_take_profit"], [2, 11, "initial_take_profit"],
      [3, -20, "exact_liquidation"], [4, 11, "initial_take_profit"],
    ])
    expect(outcome.evidence.consolidated_ledger.every((entry) =>
      entry.cycle_ledger_entry_hash === entry.cycle_entry.ledger_entry_hash)).toBe(true)
    expect(outcome.evidence.consolidated_journal.filter((entry) =>
      entry.cycle_entry.posting_kind === "opening_cash").map((entry) => entry.cycle_index)).toEqual([1])
    expect(outcome.evidence.consolidated_trial_balance).toMatchObject({
      opening_equity_posting_count: 1, initial_cash: 100, ending_available_cash: 113,
      ending_reserved_isolated_collateral: 0, ending_settled_cash: 113,
      ending_unrealized_pnl: 0, ending_portfolio_nav: 113, balanced: true,
      balances: { opening_equity: 100, realized_pnl_income: 33, realized_pnl_loss: 20 },
    })
    expect(outcome.evidence.evidence_hash)
      .toBe(replayPortfolioProtectiveStopCancelCycleSequenceEvidenceHash(outcome.evidence))
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "cycle_sequence_plan", "cycle_sequence_reservation", "cycle_cancel_terminal_artifact_manifests",
      "cycle_cancel_terminal_evidence", "cycle_cancel_terminal_accounting_artifact_manifests",
      "cycle_cancel_terminal_accounting_evidence", "consolidated_ledger", "consolidated_journal",
      "consolidated_trial_balance", "consolidated_fingerprint", "cancel_cycle_sequence_evidence",
    ])
    const retry = runReplayPortfolioProtectiveStopCancelCycleSequence(input)
    expect(retry.evidence).toEqual(outcome.evidence); expect(retry.idempotent_replay).toBe(true)
    let riskCalls = 0
    expect(runReplayPortfolioProtectiveStopCancelCycleSequence({ ...input,
      execute_risk_slice: (engineInput) => {
        riskCalls += 1
        if (riskCalls === 3) throw new Error("fixture stop cancel cycle 3 Risk failure")
        return executeReplayRuntimeSharedWalletRiskSlice(engineInput)
      },
    })).toMatchObject({ status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cancel-cycle-risk-failed", cycle_index: 3,
        partial_sequence_result_published: false } })
    const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
    expect(runReplayPortfolioProtectiveStopCancelCycleSequence({ ...input,
      artifact_store: failWriteOnce(interruptedBase, "consolidated-journal.json") })).toMatchObject({
      status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cancel-cycle-sequence-artifact-failed", partial_sequence_result_published: false },
    })
    const orphan = interruptedBase.discoverAttemptNamespaces().find((namespace) =>
      namespace.listNames().includes("consolidated-ledger.json"))
    expect(orphan?.exists("portfolio-protective-stop-cancel-cycle-sequence-artifact-manifest.json"))
      .toBe(false)
    const tampered = structuredClone(outcome.evidence)
    tampered.consolidated_journal[1]!.cycle_index = 2
    tampered.consolidated_journal[1]!.sequence_entry_hash =
      replayPortfolioProtectiveStopCancelCycleSequenceJournalEntryHash(tampered.consolidated_journal[1]!)
    tampered.fingerprint.consolidated_journal_hash = canonicalHash(tampered.consolidated_journal)
    tampered.fingerprint.fingerprint_hash =
      replayPortfolioProtectiveStopCancelCycleSequenceFingerprintHash(tampered.fingerprint)
    tampered.evidence_hash = replayPortfolioProtectiveStopCancelCycleSequenceEvidenceHash(tampered)
    expect(() => assertReplayPortfolioProtectiveStopCancelCycleSequenceEvidence(tampered)).toThrow("journal")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(interruptedRoot, { recursive: true, force: true })
  }
})

test("runtime shared wallet Portfolio evidence reconciles ledger, double-entry journal, Trial Balance, and fingerprint", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 100,
  }), { executableTime: "2026-07-14T00:04:00Z", open: 100 }), [100, 100, 100], { fundingRate: 0.01 })
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 20, feeBps: 100,
  }), [100, 100, 100])
  const plan = runtimeRiskPlan([laneA, laneB])
  const authority = runtimeRiskReservation(plan, [laneA, laneB], ["lane-a", "lane-b"])
  const outcome = runReplayRuntimeSharedWalletRiskSlice({
    plan,
    risk_reservation: authority,
    lanes: [laneB, laneA].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  if (!outcome.result) throw new Error(outcome.failure?.message ?? "risk Result missing")

  const evidence = createReplayRuntimeSharedWalletPortfolioEvidence({
    plan, risk_reservation: authority, risk_result: outcome.result,
  })
  expect(evidence.portfolio_ledger.map((entry) => [entry.cashflow_kind, entry.amount])).toEqual([
    ["entry_fee", -1],
    ["entry_fee", -1],
    ["funding", -1],
    ["strategy_exit_fee", -1],
  ])
  expect(evidence.portfolio_ledger.at(-1)?.settled_cash_after).toBe(96)
  expect(evidence.trial_balance).toMatchObject({
    total_debits: evidence.trial_balance.total_credits,
    ending_available_cash: 76,
    ending_reserved_isolated_collateral: 20,
    ending_settled_cash: 96,
    ending_unrealized_pnl: 0,
    ending_portfolio_nav: 96,
    balanced: true,
  })
  expect(evidence.trial_balance.balances).toMatchObject({
    wallet_cash: 76,
    isolated_margin_collateral: 20,
    opening_equity: 100,
    funding_expense: 1,
    fee_expense: 3,
  })
  expect(evidence.portfolio_journal.map((entry) => entry.posting_kind)).toEqual([
    "opening_cash",
    "collateral_reserve", "entry_fee",
    "collateral_reserve", "entry_fee",
    "funding",
    "strategy_exit_fee", "collateral_release",
  ])
  expect(evidence.fingerprint).toMatchObject({
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    risk_reservation_hash: authority.reservation_hash,
    risk_result_hash: outcome.result.result_hash,
  })
  expect(createReplayRuntimeSharedWalletPortfolioEvidence({
    plan, risk_reservation: authority, risk_result: outcome.result,
  })).toEqual(evidence)
  expect(() => assertReplayRuntimeSharedWalletPortfolioEvidence(evidence)).not.toThrow()
})

test("Portfolio fixed partial consumes certified lane Results and resizes wallet risk exposure", () => {
  for (const item of [
    { id: "long", side: "long" as const, stop: 90, target: 120, expectedPnl: 8 },
    { id: "short", side: "short" as const, stop: 110, target: 80, expectedPnl: 8 },
  ]) {
    const base = runtimeLaneInput({ laneId: `fixed-partial-${item.id}`,
      symbol: item.id === "long" ? "BTCUSDT" : "ETHUSDT", collateral: 20, feeBps: 0 })
    Object.assign(base.trial.request.order, { side: item.side, stop_price: item.stop, target_price: item.target })
    const lane = withRuntimeRisk(withRuntimeFixedPartial(base), [100, 105, item.side === "long" ? 110 : 90], {
      markTimes: ["2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z", "2026-07-14T00:04:00Z"],
    })
    lane.trial.funding_events = [
      { timestamp: "2026-07-14T00:02:30Z", rate: 0.001, mark_price: 100 },
      { timestamp: "2026-07-14T00:03:30Z", rate: 0.001, mark_price: item.side === "long" ? 106 : 94 },
    ]
    const dataHash = canonicalHash({ bars: lane.trial.bars, funding_events: lane.trial.funding_events,
      mark_events: lane.trial.mark_events, supplemental_facts: [] })
    lane.trial.dataset_manifest.data_hash = dataHash; lane.trial.request.dataset_hash = dataHash
    lane.trial.attempt_lease.request_hash = canonicalHash(lane.trial.request)
    const root = mkdtempSync(join(tmpdir(), `replay-portfolio-fixed-partial-${item.id}-`))
    try {
      const input = protectiveStopCancelPortfolioInput([lane], `portfolio-fixed-partial-${item.id}`, root)
      expect(runReplayIntegratedPortfolio(input)).toMatchObject({
        status: "failed", failure: { code: "integrated-risk-failed", partial_result_published: false },
      })
      const outcome = runReplayPortfolioFixedPartialTerminal(input)
      if (!outcome.evidence || !outcome.artifact_manifest || !outcome.lane_results) {
        throw new Error(outcome.failure?.message ?? "fixed-partial evidence missing")
      }
      const record = outcome.evidence.lane_records.find((candidate) => candidate.lane_id === lane.lane_id)!
      expect(record).toMatchObject({ partial_status: "filled_then_terminal", partial_quantity: 0.4,
        generation_two_quantity: 0.6, owner: "strategy_exit", realized_pnl_total: item.expectedPnl,
        ending_open: false, ending_quantity: 0, released_collateral: 20,
        admission_frozen_stop_risk_amount: 10, current_active_stop_risk_amount: 0,
        reserved_admission_risk_amount: 0, risk_budget_release_amount: 10 })
      expect(outcome.lane_results[0]!.result.fills.map((fill) => [fill.order_role, fill.quantity]))
        .toEqual([["entry", 1], ["strategy_partial_reduce", 0.4], ["strategy_exit", 0.6]])
      expect(outcome.lane_results[0]!.result.order_events.filter((event) =>
        event.timestamp === record.partial_time && event.event_key.boundary_phase === 90)
        .map((event) => [event.kind, event.remaining_quantity])).toEqual([
          ["cancelled", 1], ["cancelled", 1], ["submitted", 0.6], ["activated", 0.6],
          ["submitted", 0.6], ["activated", 0.6],
        ])
      const expectedFunding = item.side === "long" ? -0.1636 : 0.1564
      expect(record.funding_cashflow_total).toBe(expectedFunding)
      expect(outcome.evidence).toMatchObject({ ending_reserved_isolated_collateral: 0,
        ending_available_cash: 100 + item.expectedPnl + expectedFunding,
        ending_gross_mark_exposure: 0, ending_net_mark_exposure: 0,
        ending_portfolio_frozen_stop_risk: 0, ending_portfolio_active_stop_bounded_risk: 0 })
      expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
        "source_protective_terminal_artifact_manifest", "source_protective_terminal_evidence",
        "lane_result_artifact_manifests", "lane_results", "fixed_partial_terminal_records",
        "fixed_partial_terminal_fingerprint", "fixed_partial_terminal_evidence",
      ])
      const accounting = runReplayPortfolioFixedPartialTerminalAccounting(input)
      if (!accounting.evidence) throw new Error(accounting.failure?.message ?? "fixed-partial accounting missing")
      expect(accounting.evidence.ledger.filter((entry) => entry.cashflow_kind === "funding")
        .map((entry) => entry.amount)).toEqual(item.side === "long" ? [-0.1, -0.0636] : [0.1, 0.0564])
      expect(accounting.evidence.ledger.filter((entry) => entry.cashflow_kind === "realized_pnl")
        .map((entry) => entry.amount)).toEqual([2, 6])
      expect(accounting.evidence.trial_balance).toMatchObject({ ending_available_cash: 100
        + item.expectedPnl + expectedFunding, ending_reserved_isolated_collateral: 0,
        ending_unrealized_pnl: 0, balanced: true })
      expect(runReplayPortfolioFixedPartialTerminal(input)).toMatchObject({
        status: "completed", idempotent_replay: true, evidence: outcome.evidence,
      })
    } finally { rmSync(root, { recursive: true, force: true }) }
  }

  const openBase = runtimeLaneInput({ laneId: "fixed-partial-open", symbol: "SOLUSDT", collateral: 20, feeBps: 0 })
  const openLane = withRuntimeRisk(withRuntimeFixedPartial(openBase, { terminal: "open" }), [100, 105, 106])
  const openRoot = mkdtempSync(join(tmpdir(), "replay-portfolio-fixed-partial-open-"))
  try {
    const outcome = runReplayPortfolioFixedPartialTerminal(
      protectiveStopCancelPortfolioInput([openLane], "portfolio-fixed-partial-open", openRoot))
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "fixed-partial open missing")
    expect(outcome.evidence.lane_records.find((record) => record.lane_id === openLane.lane_id)).toMatchObject({
      partial_status: "filled_open_at_data_end", owner: "open_at_data_end", ending_open: true,
      ending_quantity: 0.6, ending_mark_price: 106, ending_mark_notional: 63.6,
      ending_unrealized_pnl: 3.6, released_collateral: 0, reserved_admission_risk_amount: 10,
      current_active_stop_risk_amount: 6,
    })
    expect(outcome.evidence).toMatchObject({ ending_reserved_isolated_collateral: 20,
      ending_gross_mark_exposure: 63.6, ending_net_mark_exposure: 63.6,
      ending_portfolio_frozen_stop_risk: 10, ending_portfolio_active_stop_bounded_risk: 6 })
  } finally { rmSync(openRoot, { recursive: true, force: true }) }

  const raceBase = runtimeLaneInput({ laneId: "fixed-partial-race", symbol: "XRPUSDT", collateral: 20, feeBps: 0 })
  const raceLane = withRuntimeRisk(withRuntimeFixedPartial(raceBase, { sameBoundaryStop: true }), [100, 100, 100])
  const raceRoot = mkdtempSync(join(tmpdir(), "replay-portfolio-fixed-partial-race-"))
  try {
    const outcome = runReplayPortfolioFixedPartialTerminal(
      protectiveStopCancelPortfolioInput([raceLane], "portfolio-fixed-partial-race", raceRoot))
    if (!outcome.evidence) throw new Error(outcome.failure?.message ?? "fixed-partial race missing")
    expect(outcome.evidence.lane_records.find((record) => record.lane_id === raceLane.lane_id)).toMatchObject({
      partial_status: "terminal_before_partial", partial_fill_hash: null,
      owner: "initial_protective_stop", ending_open: false,
    })
  } finally { rmSync(raceRoot, { recursive: true, force: true }) }
})

test("Portfolio Artifact uses manifest-last commit, is idempotent, and retries orphan payloads without partial Result", () => {
  const laneA = withRuntimeRisk(withRuntimeLifecycleExit(runtimeLaneInput({
    laneId: "lane-a", symbol: "BTCUSDT", collateral: 20, feeBps: 0,
  }), { executableTime: "2026-07-14T00:03:00Z", open: 110 }), [100, 80, 80])
  const laneB = withRuntimeRisk(runtimeLaneInput({
    laneId: "lane-b", symbol: "ETHUSDT", collateral: 80, feeBps: 0,
    executableTime: "2026-07-14T00:03:00Z",
  }), [100, 100, 100])
  const plan = runtimeRiskPlan([laneA, laneB])
  const authority = runtimeRiskReservation(plan, [laneA, laneB], ["lane-b", "lane-a"])
  const risk = runReplayRuntimeSharedWalletRiskSlice({
    plan,
    risk_reservation: authority,
    lanes: [laneA, laneB].map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
  })
  if (!risk.result) throw new Error(risk.failure?.message ?? "risk Result missing")
  const root = mkdtempSync(join(tmpdir(), "replay-portfolio-artifact-"))
  const retryRoot = mkdtempSync(join(tmpdir(), "replay-portfolio-artifact-retry-"))
  try {
    const store = createReplayLocalArtifactStore(root)
    const first = publishReplayRuntimeSharedWalletPortfolioArtifact({
      plan, risk_reservation: authority, risk_result: risk.result, artifact_store: store,
    })
    expect(first.status).toBe("committed")
    expect(first.idempotent_replay).toBe(false)
    expect(first.artifact_manifest?.files.map((file) => file.role)).toEqual([...REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES])
    expect(first.artifact_manifest?.completeness).toEqual({
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_REQUIRED_ARTIFACT_ROLES,
      commit_marker: "portfolio-artifact-manifest.json",
      partial_payload_without_manifest_is_authoritative: false,
    })
    expect(() => assertReplayPortfolioArtifactOutcome(first)).not.toThrow()

    const second = publishReplayRuntimeSharedWalletPortfolioArtifact({
      plan, risk_reservation: authority, risk_result: risk.result, artifact_store: store,
    })
    expect(second.failure).toBeNull()
    expect(second.status).toBe("committed")
    expect(second.idempotent_replay).toBe(true)
    expect(second.artifact_manifest).toEqual(first.artifact_manifest)
    expect(second.artifact_commit).toEqual(first.artifact_commit)

    const retryStore = createReplayLocalArtifactStore(retryRoot)
    const interruptedStore = failWriteOnce(retryStore, "portfolio-journal.json")
    const interrupted = publishReplayRuntimeSharedWalletPortfolioArtifact({
      plan, risk_reservation: authority, risk_result: risk.result, artifact_store: interruptedStore,
    })
    expect(interrupted).toMatchObject({
      status: "failed",
      artifact_manifest: null,
      artifact_commit: null,
      failure: { code: "portfolio-artifact-store-failed", partial_result_published: false },
    })
    const namespace = retryStore.openAttempt({
      idempotency_key_hash: canonicalHash({
        portfolio_id: plan.portfolio_id,
        portfolio_plan_hash: plan.plan_hash,
        risk_reservation_hash: authority.reservation_hash,
      }),
      attempt_id_hash: risk.result.result_hash,
    })
    expect(namespace.exists("portfolio-artifact-manifest.json")).toBe(false)
    expect(namespace.listNames().length).toBeGreaterThan(0)

    const retried = publishReplayRuntimeSharedWalletPortfolioArtifact({
      plan, risk_reservation: authority, risk_result: risk.result, artifact_store: retryStore,
    })
    expect(retried.status).toBe("committed")
    expect(retried.idempotent_replay).toBe(false)
    expect(namespace.exists("portfolio-artifact-manifest.json")).toBe(true)

    const tamperedResult = structuredClone(risk.result)
    tamperedResult.ending_portfolio_nav += 1
    tamperedResult.result_hash = replayRuntimeSharedWalletRiskResultHash(tamperedResult)
    const rejected = publishReplayRuntimeSharedWalletPortfolioArtifact({
      plan, risk_reservation: authority, risk_result: tamperedResult, artifact_store: store,
    })
    expect(rejected.status).toBe("failed")
    expect(rejected.failure?.code).toBe("portfolio-evidence-invalid")
    expect(rejected.artifact_manifest).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(retryRoot, { recursive: true, force: true })
  }
})

function failWriteOnce(store: ReplayArtifactStore, targetName: string): ReplayArtifactStore {
  let failed = false
  return {
    capability: store.capability,
    openAttempt: (identity) => {
      const namespace = store.openAttempt(identity)
      const wrapper: ReplayArtifactNamespace = {
        namespace_ref: namespace.namespace_ref,
        fileRef: (name) => namespace.fileRef(name),
        exists: (name) => namespace.exists(name),
        listNames: () => namespace.listNames(),
        read: (name) => namespace.read(name),
        readRef: (ref) => namespace.readRef(ref),
        writeImmutable: (name, content) => {
          if (!failed && name === targetName) {
            failed = true
            throw new Error("fixture interrupted Portfolio payload write")
          }
          return namespace.writeImmutable(name, content)
        },
        remove: (name) => namespace.remove(name),
      }
      return wrapper
    },
  }
}
