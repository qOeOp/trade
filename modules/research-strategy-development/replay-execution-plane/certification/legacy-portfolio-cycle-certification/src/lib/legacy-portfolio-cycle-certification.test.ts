import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  createReplayPortfolioAllocationReservationSnapshot,
  createReplayPortfolioCycleSequenceReservationSnapshot,
  createReplayPortfolioReallocationReservationSnapshot,
  createReplayRuntimeSharedWalletRiskReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type TrialReservationSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_ALLOCATION_PLAN_SCHEMA_VERSION,
  replayPortfolioAllocationPlanHash,
  type ReplayPortfolioAllocationPlan,
} from "../../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  assertReplayPortfolioCycleSequenceAccountingEvidence,
  replayPortfolioCycleSequenceAccountingEvidenceHash,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-accounting-contracts"
import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_PLAN_SCHEMA_VERSION,
  replayPortfolioCycleSequencePlanHash,
  type ReplayPortfolioCycleSequencePlan,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import {
  REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS,
  REPLAY_INTEGRATED_PORTFOLIO_PLAN_SCHEMA_VERSION,
  replayIntegratedPortfolioPlanHash,
  replayIntegratedPortfolioResultHash,
  type ReplayIntegratedPortfolioPlan,
} from "../../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import {
  REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS,
  REPLAY_PORTFOLIO_REALLOCATION_PLAN_SCHEMA_VERSION,
  replayPortfolioReallocationPlanHash,
  type ReplayPortfolioReallocationPlan,
} from "../../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import {
  REPLAY_RUNTIME_SHARED_WALLET_RISK_PLAN_SCHEMA_VERSION,
  replayRuntimeSharedWalletRiskPlanHash,
  type ReplayRuntimeSharedWalletRiskPlan,
} from "../../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS,
  REPLAY_TWO_CYCLE_PORTFOLIO_PLAN_SCHEMA_VERSION,
  replayTwoCyclePortfolioPlanHash,
  replayTwoCyclePortfolioResultHash,
  type ReplayTwoCyclePortfolioPlan,
} from "../../../../contracts/src/lib/replay-two-cycle-portfolio-contracts"
import {
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  type ReplayArtifactManifest,
  type ReplayExecutionRequest,
  type ReplayResult,
} from "../../../../contracts/src/lib/replay-contracts"
import { runReplayPortfolioReallocation } from
  "../../../../compatibility/legacy-portfolio-cycle/src/lib/replay-portfolio-reallocation-runner"
import { runReplayTwoCyclePortfolio } from
  "../../../../compatibility/legacy-portfolio-cycle/src/lib/replay-two-cycle-portfolio-runner"
import { runReplayPortfolioCycleSequenceAccounting } from
  "../../../../compatibility/legacy-portfolio-cycle/src/lib/replay-portfolio-cycle-sequence-accounting-runner"
import { createReplayLocalArtifactStore } from "../../../../runner/src/lib/replay-local-artifact-store"
import { runReplayIntegratedPortfolio } from "../../../../runner/src/lib/replay-integrated-portfolio-runner"
import { runReplayPortfolioCycleSequence } from "../../../../runner/src/lib/replay-portfolio-cycle-sequence-runner"
import type {
  ReplayTrialRunInput,
  ReplayTrialRunOutcome,
} from "../../../../runner/src/lib/replay-trial-runner"

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

type Lane = {
  lane_id: string
  trial: ReplayTrialRunInput
  outcome: ReplayTrialRunOutcome
}

function laneFixture(laneId: string, symbol: string): Lane {
  const runId = `run-${laneId}`
  const trialId = `trial-${laneId}`
  const request = {
    run_id: runId,
    symbol,
    initial_cash: 100,
    trial_id: trialId,
    candidate_id: `candidate-${laneId}`,
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
      replay_idempotency_key: `idempotency-${laneId}`,
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
  const lease: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: `attempt-${laneId}`,
    attempt_ordinal: 1,
    worker_id: `worker-${laneId}`,
    trial_id: trialId,
    run_id: runId,
    reservation_ref: reservation.reservation_ref,
    reservation_hash: request.trial_reservation_hash,
    request_hash: canonicalHash(request),
    status: "running",
    lease_generation: 1,
    claimed_at: "2026-07-14T00:00:00Z",
    heartbeat_at: "2026-07-14T00:00:30Z",
    lease_expires_at: "2026-07-14T00:10:00Z",
  }
  const result = {
    run_id: runId,
    metrics: { initial_cash: 100, ending_equity: 100, net_pnl: 0 },
  } as ReplayResult
  const artifact = { run_id: runId, result_hash: canonicalHash(result) } as ReplayArtifactManifest
  return {
    lane_id: laneId,
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

function runtimeLane(
  laneId: string,
  symbol: string,
  entryTime: string,
  exitTime: string,
  exitOpen = 100,
): Lane {
  const lane = laneFixture(laneId, symbol)
  Object.assign(lane.trial.request, {
    dataset_hash: HASH,
    order: {
      side: "long",
      quantity: 1,
      signal_time: "2026-07-14T00:00:00Z",
      earliest_executable_time: entryTime,
      stop_price: 90,
      target_price: 120,
      entry_execution: { order_type: "market" },
    },
    cost_policy: {
      policy_id: "cost-v1", version: "v1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 0,
    },
    simulator_policy: { earliest_execution: "next_open" },
    margin_policy: { mode: "isolated", collateral_asset: "USDT", isolated_collateral: 20 },
  })
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: "sell" as const,
    order_type: "market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: new Date(Date.parse(exitTime) - 30_000).toISOString(),
    earliest_executable_time: exitTime,
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
  lane.trial.bars = [
    { openTime: entryTime, open: 100 },
    { openTime: exitTime, open: exitOpen },
  ].map(({ openTime, open }) => ({
    open_time: openTime,
    close_time: new Date(Date.parse(openTime) + 59_999).toISOString(),
    open,
    high: open + 1,
    low: open - 1,
    close: open,
    volume: 10,
    closed: true,
  }))
  const markTimes: [string, string, string] = [
    entryTime,
    new Date(Date.parse(entryTime) + 60_000).toISOString().replace(".000Z", "Z"),
    new Date(Date.parse(entryTime) + 120_000).toISOString().replace(".000Z", "Z"),
  ]
  const riskEpoch = {
    schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
    snapshot_id: `risk-${laneId}`,
    venue_id: "binance-usdm",
    symbol,
    effective_at: "2026-07-01T00:00:00Z",
    valid_until: null,
    observed_at: "2026-07-14T00:00:00Z",
    source_ref: `fixture:risk:${laneId}`,
    source_hash: HASH,
    initial_margin_rate: 0.1,
    maintenance_tier: {
      tier_id: "tier-1",
      snapshot_ref: "fixture:tier-1",
      snapshot_hash: HASH,
      notional_floor: 0,
      notional_cap: 50_000,
      maintenance_margin_rate: 0.05,
      maintenance_amount: 0,
    },
    liquidation_fee_bps: 0,
  }
  const statusEpoch = {
    schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: `status-${laneId}`,
    venue_id: "binance-usdm",
    symbol,
    status: "trading" as const,
    effective_at: "2026-07-01T00:00:00Z",
    valid_until: null,
    observed_at: "2026-07-14T00:00:00Z",
    source_ref: `fixture:status:${laneId}`,
    source_hash: HASH,
  }
  lane.trial.mark_events = markTimes.map((timestamp, source_sequence) => ({
    timestamp, available_at: timestamp, source_sequence, mark_price: 100,
  }))
  lane.trial.funding_events = [{ timestamp: exitTime, rate: 0, mark_price: 100 }]
  lane.trial.dataset_manifest = {
    ...lane.trial.dataset_manifest,
    symbol,
    first_open_time: entryTime,
    last_close_time: markTimes[2],
    observed_through: markTimes[2],
    funding_availability: "event_time",
    mark_availability: "event_time",
    mark_coverage: "complete_grid",
    mark_interval_ms: 60_000,
    mark_event_count: 3,
    venue_risk_policy_epochs: [riskEpoch],
    instrument: {
      ...(lane.trial.dataset_manifest.instrument ?? {}),
      status_history: "complete",
      status_epochs: [statusEpoch],
      accounting: {
        ...(lane.trial.dataset_manifest.instrument?.accounting ?? {}),
        settlement_asset: "USDT",
        price_increment: "0.01",
        settlement_increment: "0.01",
        contract_multiplier: "1",
      },
    },
  } as ReplayTrialRunInput["dataset_manifest"]
  const dataHash = canonicalHash({
    bars: lane.trial.bars,
    funding_events: lane.trial.funding_events,
    mark_events: lane.trial.mark_events,
    supplemental_facts: [],
  })
  lane.trial.dataset_manifest.data_hash = dataHash
  lane.trial.request.dataset_hash = dataHash
  lane.trial.request.venue_risk_policy_schedule_hash = canonicalHash([riskEpoch])
  Object.assign(lane.trial.request.margin_policy, {
    initial_margin_rate: riskEpoch.initial_margin_rate,
    maintenance_tier: structuredClone(riskEpoch.maintenance_tier),
  })
  lane.trial.attempt_lease.request_hash = canonicalHash(lane.trial.request)
  lane.trial.observed_at = new Date(Date.parse(entryTime) - 10_000).toISOString()
  return lane
}

function allocationPlan(portfolioId: string, lanes: Lane[]): ReplayPortfolioAllocationPlan {
  const body: Omit<ReplayPortfolioAllocationPlan, "plan_hash"> = {
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_PLAN_SCHEMA_VERSION,
    portfolio_id: portfolioId,
    execution_mode: "simultaneous_entry_exposure_risk_budget_allocation_v1",
    allocation_scope: "entry_slice_collect_same_time_then_allocate_before_fill",
    matching_scope: "market_next_open_full_fill_or_reject_no_resize",
    exposure_scope: "fixed_entry_execution_notional_until_slice_end",
    risk_budget_scope: "fixed_entry_to_frozen_stop_adverse_execution_plus_round_trip_fees",
    failure_policy: "input_or_engine_failure_no_partial_allocation_result",
    lanes: lanes.map((lane) => ({
      lane_id: lane.lane_id,
      symbol: lane.trial.request.symbol,
      run_id: lane.trial.request.run_id,
      request_hash: canonicalHash(lane.trial.request),
      trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
      attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lane.trial.attempt_lease),
      side: lane.trial.request.order.side,
      quantity: lane.trial.request.order.quantity,
      earliest_executable_time: lane.trial.request.order.earliest_executable_time,
      stop_price: lane.trial.request.order.stop_price,
      isolated_collateral: lane.trial.request.margin_policy.isolated_collateral,
      fee_bps: lane.trial.request.cost_policy.fee_bps,
      slippage_bps: lane.trial.request.cost_policy.slippage_bps,
      price_increment: lane.trial.dataset_manifest.instrument.accounting.price_increment,
      settlement_increment: lane.trial.dataset_manifest.instrument.accounting.settlement_increment,
      contract_multiplier: "1" as const,
    })),
  }
  return { ...body, plan_hash: replayPortfolioAllocationPlanHash(body) }
}

function allocationReservation(plan: ReplayPortfolioAllocationPlan, lanes: Lane[]) {
  return createReplayPortfolioAllocationReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
    reservation_id: `allocation-${plan.portfolio_id}`,
    reservation_ref: `reservation://allocation/${plan.portfolio_id}`,
    issued_at: "2026-07-14T00:00:30Z",
    expires_at: "2026-07-14T00:10:00Z",
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
    max_gross_exposure_amount: 200,
    max_abs_net_exposure_amount: 100,
    max_portfolio_risk_amount: 25,
    lanes: allocationAuthorityLanes(lanes),
    limitations: [
      "market_next_open_full_fill_or_reject_no_resize_entry_slice_only",
      "entry_notional_exposure_and_frozen_stop_loss_budget_not_dynamic_var",
      "no_exit_funding_liquidation_cross_margin_partial_fill_or_borrow",
    ],
  })
}

function riskPlan(portfolioId: string, lanes: Lane[]): ReplayRuntimeSharedWalletRiskPlan {
  const body: Omit<ReplayRuntimeSharedWalletRiskPlan, "plan_hash"> = {
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_PLAN_SCHEMA_VERSION,
    portfolio_id: portfolioId,
    execution_mode: "runtime_shared_wallet_exact_risk_full_liquidation_v1",
    capital_semantics: "single_runtime_wallet_event_committed_risk_cash_reuse",
    matching_scope: "market_next_open_and_trigger_mark_full_fill",
    margin_scope: "isolated_positions_shared_admission_cash",
    funding_scope: "frozen_exact_events_t_minus_position",
    risk_scope: "complete_exact_mark_grid_isolated_maintenance_full_liquidation",
    same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority",
    failure_policy: "engine_failure_or_liquidation_deficit_no_partial_portfolio_result",
    lanes: lanes.map((lane) => {
      const exitIntent = lane.trial.request.decision_schedule?.entries[0]?.authorized_reduce_only_exit ?? null
      const manifest = lane.trial.dataset_manifest
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
        contract_multiplier: "1" as const,
        fee_bps: lane.trial.request.cost_policy.fee_bps,
        slippage_bps: lane.trial.request.cost_policy.slippage_bps,
        funding_event_count: lane.trial.funding_events?.length ?? 0,
        funding_events_hash: canonicalHash(lane.trial.funding_events ?? []),
        mark_event_count: lane.trial.mark_events?.length ?? 0,
        mark_events_hash: canonicalHash(lane.trial.mark_events ?? []),
        venue_risk_policy_epochs: structuredClone(manifest.venue_risk_policy_epochs),
        venue_risk_policy_epochs_hash: canonicalHash(manifest.venue_risk_policy_epochs),
        instrument_status_epochs: structuredClone(manifest.instrument.status_epochs),
        instrument_status_epochs_hash: canonicalHash(manifest.instrument.status_epochs),
      }
    }),
  }
  return { ...body, plan_hash: replayRuntimeSharedWalletRiskPlanHash(body) }
}

function riskReservation(
  plan: ReplayRuntimeSharedWalletRiskPlan,
  lanes: Lane[],
  issuedAt = "2026-07-14T00:00:30Z",
) {
  return createReplayRuntimeSharedWalletRiskReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
    reservation_id: `risk-${plan.portfolio_id}`,
    reservation_ref: `reservation://risk/${plan.portfolio_id}`,
    issued_at: issuedAt,
    expires_at: "2026-07-14T00:10:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    portfolio_id: plan.portfolio_id,
    portfolio_plan_hash: plan.plan_hash,
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-exact-risk-v1",
    funding_policy_version: "exact-event-time-t-minus-position-v1",
    risk_policy_version: "complete-exact-mark-isolated-maintenance-full-liquidation-v1",
    same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority",
    lanes: baseAuthorityLanes(lanes),
    limitations: [
      "market_next_open_entry_full_exit_exact_funding_and_mark_risk_only",
      "isolated_margin_full_liquidation_no_cross_margin",
      "no_partial_liquidation_borrow_insurance_or_adl",
    ],
  })
}

function baseAuthorityLanes(lanes: Lane[]) {
  return lanes.map((lane, index) => ({
    lane_id: lane.lane_id,
    priority_rank: index + 1,
    trial_id: lane.trial.request.trial_id,
    run_id: lane.trial.request.run_id,
    trial_reservation_ref: lane.trial.trial_reservation.reservation_ref,
    trial_reservation_hash: hashTrialReservationSnapshot(lane.trial.trial_reservation),
  }))
}

function allocationAuthorityLanes(lanes: Lane[]): Array<{
  lane_id: string
  priority_rank: number
  trial_id: string
  run_id: string
  trial_reservation_ref: string
  trial_reservation_hash: string
  max_lane_risk_amount: number
}> {
  return baseAuthorityLanes(lanes).map((lane) => ({ ...lane, max_lane_risk_amount: 15 }))
}

function integratedPlan(
  allocation: ReplayPortfolioAllocationPlan,
  allocationReservationHash: string,
  risk: ReplayRuntimeSharedWalletRiskPlan,
  riskReservationHash: string,
): ReplayIntegratedPortfolioPlan {
  const laneSet = allocation.lanes.map((lane) => ({
    lane_id: lane.lane_id,
    symbol: lane.symbol,
    run_id: lane.run_id,
    request_hash: lane.request_hash,
    trial_reservation_hash: lane.trial_reservation_hash,
    attempt_lease_hash: lane.attempt_lease_hash,
  }))
  const body: Omit<ReplayIntegratedPortfolioPlan, "plan_hash"> = {
    schema_version: REPLAY_INTEGRATED_PORTFOLIO_PLAN_SCHEMA_VERSION,
    portfolio_id: allocation.portfolio_id,
    execution_mode: "initial_allocation_then_exact_risk_lifecycle_artifact_v1",
    allocation_plan_hash: allocation.plan_hash,
    allocation_reservation_hash: allocationReservationHash,
    risk_plan_hash: risk.plan_hash,
    risk_reservation_hash: riskReservationHash,
    initial_allocation_time: allocation.lanes[0]!.earliest_executable_time,
    lane_set_hash: canonicalHash(laneSet),
    event_ordering_policy: "pre_entry_funding_risk_then_allocation_phase_19_then_entry_phase_20_then_lifecycle",
    exposure_risk_state_policy: "fixed_entry_notional_and_frozen_stop_risk_released_on_full_close",
    artifact_policy: "integrated_evidence_payloads_then_manifest_last",
    failure_policy: "any_stage_failure_no_integrated_result_or_artifact",
    limitations: REPLAY_INTEGRATED_PORTFOLIO_LIMITATIONS,
  }
  return { ...body, plan_hash: replayIntegratedPortfolioPlanHash(body) }
}

function cycleSequencePlan(
  portfolioId: string,
  reservationHash: string,
  cycles: Array<{
    integrated: ReplayIntegratedPortfolioPlan
    allocation: ReplayPortfolioAllocationPlan
    risk: ReplayRuntimeSharedWalletRiskPlan
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
      integrated_plan_hash: cycle.integrated.plan_hash,
      allocation_plan_hash: cycle.allocation.plan_hash,
      risk_plan_hash: cycle.risk.plan_hash,
      earliest_cycle_time: cycle.integrated.initial_allocation_time,
      lane_set_hash: cycle.integrated.lane_set_hash,
    })),
    cash_roll_forward_policy: "cycle_one_initial_then_predecessor_ending_available",
    successor_policy: "strictly_later_after_predecessor_full_flat_release",
    artifact_policy: "fixed_role_dynamic_cycle_payload_then_manifest_last",
    failure_policy: "any_cycle_or_artifact_failure_no_sequence_result_or_artifact",
    limitations: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_LIMITATIONS,
  }
  return { ...body, plan_hash: replayPortfolioCycleSequencePlanHash(body) }
}

test("P10 reallocation closes into one deterministic P11 two-cycle Result/Artifact", () => {
  const portfolioId = "portfolio-cycle-certification-1"
  const cycle1Lanes = [
    runtimeLane("lane-a", "BTCUSDT", "2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"),
    runtimeLane("lane-b", "ETHUSDT", "2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"),
  ]
  const cycle1Allocation = allocationPlan(portfolioId, cycle1Lanes)
  const cycle1AllocationAuthority = allocationReservation(cycle1Allocation, cycle1Lanes)
  const cycle1Risk = riskPlan(portfolioId, cycle1Lanes)
  const cycle1RiskAuthority = riskReservation(cycle1Risk, cycle1Lanes)
  const cycle1Integrated = integratedPlan(
    cycle1Allocation,
    cycle1AllocationAuthority.reservation_hash,
    cycle1Risk,
    cycle1RiskAuthority.reservation_hash,
  )
  const root = mkdtempSync(join(tmpdir(), "legacy-portfolio-cycle-certification-"))
  try {
    const artifactStore = createReplayLocalArtifactStore(root)
    const predecessor = runReplayIntegratedPortfolio({
      integrated_plan: cycle1Integrated,
      allocation_plan: cycle1Allocation,
      allocation_reservation: cycle1AllocationAuthority,
      risk_plan: cycle1Risk,
      risk_reservation: cycle1RiskAuthority,
      lanes: cycle1Lanes.map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: artifactStore,
    })
    if (!predecessor.result || !predecessor.artifact?.artifact_manifest) {
      throw new Error(predecessor.failure?.message ?? "cycle-1 predecessor missing")
    }

    const cycle2Lanes = [
      runtimeLane("lane-c", "SOLUSDT", "2026-07-14T00:04:00Z", "2026-07-14T00:05:00Z"),
      runtimeLane("lane-d", "BNBUSDT", "2026-07-14T00:04:00Z", "2026-07-14T00:05:00Z"),
    ]
    const cycle2Allocation = allocationPlan(portfolioId, cycle2Lanes)
    const cycle2Reservation = createReplayPortfolioReallocationReservationSnapshot({
      schema_version: REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
      reservation_id: "portfolio-reallocation-certification-1",
      reservation_ref: "reservation://portfolio-reallocation/certification-1",
      issued_at: "2026-07-14T00:03:10Z",
      expires_at: "2026-07-14T00:04:30Z",
      status: "reserved",
      authority_id: "research-control-plane",
      experiment_id: "experiment-1",
      trial_group_id: "trial-group-1",
      trial_group_hash: HASH,
      portfolio_id: portfolioId,
      portfolio_plan_hash: cycle2Allocation.plan_hash,
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
      lanes: allocationAuthorityLanes(cycle2Lanes),
      limitations: [
        "second_cycle_only_after_authoritative_full_flat_release",
        "opening_cash_derived_from_predecessor_result_not_control_plane_estimate",
        "no_third_cycle_partial_cross_margin_borrow_or_fast",
      ],
    })
    const reallocationBody: Omit<ReplayPortfolioReallocationPlan, "plan_hash"> = {
      schema_version: REPLAY_PORTFOLIO_REALLOCATION_PLAN_SCHEMA_VERSION,
      portfolio_id: portfolioId,
      execution_mode: "full_flat_release_then_second_allocation_cycle_v1",
      predecessor_integrated_result_hash: predecessor.result.result_hash,
      predecessor_artifact_manifest_hash: predecessor.artifact.artifact_manifest.manifest_hash,
      reallocation_reservation_hash: cycle2Reservation.reservation_hash,
      cycle_2_allocation_plan_hash: cycle2Allocation.plan_hash,
      cycle_2_event_time: "2026-07-14T00:04:00Z",
      opening_cash_policy: "predecessor_ending_available_cash_after_full_flat_release",
      eligibility_policy: "all_predecessor_positions_closed_and_exposure_risk_zero",
      failure_policy: "input_or_allocation_or_artifact_failure_no_reallocation_result",
      limitations: REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS,
    }
    const reallocationPlan = {
      ...reallocationBody,
      plan_hash: replayPortfolioReallocationPlanHash(reallocationBody),
    }
    const reallocationInput = {
      plan: reallocationPlan,
      reservation: cycle2Reservation,
      predecessor,
      allocation_plan: cycle2Allocation,
      lanes: cycle2Lanes.map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: artifactStore,
    }
    const reallocation = runReplayPortfolioReallocation(reallocationInput)
    if (!reallocation.result || !reallocation.allocation_result || !reallocation.artifact_manifest) {
      throw new Error(reallocation.failure?.message ?? "P10 result missing")
    }
    expect(reallocation.result).toMatchObject({
      reallocation_cycle: 2,
      predecessor_full_flat_time: "2026-07-14T00:03:00Z",
      opening_available_cash: 100,
      cycle_2_event_time: "2026-07-14T00:04:00Z",
      ending_gross_exposure: 100,
    })
    expect(runReplayPortfolioReallocation(reallocationInput)).toMatchObject({
      status: "completed", idempotent_replay: true, result: reallocation.result,
    })

    const cycle2Risk = riskPlan(portfolioId, cycle2Lanes)
    const cycle2RiskAuthority = riskReservation(cycle2Risk, cycle2Lanes, "2026-07-14T00:03:40Z")
    const twoCycleBody: Omit<ReplayTwoCyclePortfolioPlan, "plan_hash"> = {
      schema_version: REPLAY_TWO_CYCLE_PORTFOLIO_PLAN_SCHEMA_VERSION,
      portfolio_id: portfolioId,
      execution_mode: "cycle_one_integrated_then_cycle_two_allocation_exact_risk_v1",
      cycle_1_integrated_result_hash: predecessor.result.result_hash,
      cycle_1_artifact_manifest_hash: predecessor.artifact.artifact_manifest.manifest_hash,
      cycle_2_reallocation_result_hash: reallocation.result.result_hash,
      cycle_2_reallocation_manifest_hash: reallocation.artifact_manifest.manifest_hash,
      cycle_2_allocation_plan_hash: cycle2Allocation.plan_hash,
      cycle_2_allocation_result_hash: reallocation.allocation_result.result_hash,
      cycle_2_risk_plan_hash: cycle2Risk.plan_hash,
      cycle_2_risk_reservation_hash: cycle2RiskAuthority.reservation_hash,
      cash_bridge_policy: "cycle_1_ending_available_equals_cycle_2_shared_initial_cash",
      state_chain_policy: "cycle_1_chain_then_cycle_2_chain_with_strict_time_and_wallet_bridge",
      artifact_policy: "two_cycle_payloads_then_manifest_last",
      failure_policy: "any_stage_failure_no_two_cycle_result_or_artifact",
      limitations: REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS,
    }
    const twoCyclePlan = { ...twoCycleBody, plan_hash: replayTwoCyclePortfolioPlanHash(twoCycleBody) }
    const twoCycleInput = {
      plan: twoCyclePlan,
      cycle_1: predecessor,
      cycle_2_reallocation_plan: reallocationPlan,
      cycle_2_reallocation_reservation: cycle2Reservation,
      cycle_2_reallocation: reallocation,
      cycle_2_allocation_plan: cycle2Allocation,
      cycle_2_risk_plan: cycle2Risk,
      cycle_2_risk_reservation: cycle2RiskAuthority,
      cycle_2_lanes: cycle2Lanes.map((lane) => ({ lane_id: lane.lane_id, trial: lane.trial })),
      artifact_store: artifactStore,
    }
    const twoCycle = runReplayTwoCyclePortfolio(twoCycleInput)
    if (!twoCycle.result || !twoCycle.cycle_2_risk_result || !twoCycle.artifact_manifest) {
      throw new Error(twoCycle.failure?.message ?? "P11 result missing")
    }
    expect(twoCycle.result).toMatchObject({
      cycle_1_ending_available_cash: 100,
      cycle_2_opening_available_cash: 100,
      ending_available_cash: 100,
      ending_gross_exposure: 0,
      ending_net_exposure: 0,
      ending_portfolio_risk: 0,
    })
    expect(twoCycle.result.result_hash).toBe(replayTwoCyclePortfolioResultHash(twoCycle.result))
    expect(twoCycle.artifact_manifest.files.map((file) => file.role)).toEqual([
      "two_cycle_plan", "cycle_1_integrated_result", "cycle_1_artifact_manifest",
      "cycle_2_reallocation_result", "cycle_2_reallocation_manifest", "cycle_2_allocation_plan",
      "cycle_2_allocation_result", "cycle_2_risk_plan", "cycle_2_risk_reservation",
      "cycle_2_risk_result", "cycle_2_portfolio_evidence", "two_cycle_state_chain",
      "two_cycle_fingerprint", "two_cycle_result",
    ])
    expect(runReplayTwoCyclePortfolio(twoCycleInput)).toMatchObject({
      status: "completed", idempotent_replay: true, result: twoCycle.result,
    })

    const notFlat = structuredClone(predecessor)
    notFlat.result!.ending_gross_exposure = 1
    notFlat.result!.result_hash = replayIntegratedPortfolioResultHash(notFlat.result!)
    expect(runReplayPortfolioReallocation({ ...reallocationInput, predecessor: notFlat })).toMatchObject({
      status: "failed",
      result: null,
      failure: { code: "reallocation-input-invalid", partial_result_published: false },
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("P13 consolidates three predeclared full-flat cycles into one balanced accounting Artifact", () => {
  const portfolioId = "portfolio-cycle-accounting-certification-1"
  const definitions = [
    {
      ids: ["lane-seq-a", "lane-seq-b"],
      symbols: ["BTCUSDT", "ETHUSDT"],
      entry: "2026-07-14T00:01:00Z",
      exit: "2026-07-14T00:03:00Z",
      exitOpen: 110,
    },
    {
      ids: ["lane-seq-c", "lane-seq-d"],
      symbols: ["SOLUSDT", "BNBUSDT"],
      entry: "2026-07-14T00:04:00Z",
      exit: "2026-07-14T00:05:00Z",
      exitOpen: 100,
    },
    {
      ids: ["lane-seq-e", "lane-seq-f"],
      symbols: ["XRPUSDT", "ADAUSDT"],
      entry: "2026-07-14T00:07:00Z",
      exit: "2026-07-14T00:08:00Z",
      exitOpen: 100,
    },
  ] as const
  const fixtures = definitions.map((definition) => {
    const lanes = definition.ids.map((laneId, index) => runtimeLane(
      laneId,
      definition.symbols[index]!,
      definition.entry,
      definition.exit,
      index === 0 ? definition.exitOpen : 100,
    ))
    return {
      lanes,
      entry: definition.entry,
      allocation: allocationPlan(portfolioId, lanes),
      risk: riskPlan(portfolioId, lanes),
    }
  })
  const reservation = createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "cycle-sequence-accounting-certification-1",
    reservation_ref: "reservation://cycle-sequence/accounting-certification-1",
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
    cycle_count: fixtures.length,
    max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles: fixtures.map((fixture, index) => ({
      cycle_index: index + 1,
      allocation_plan_hash: fixture.allocation.plan_hash,
      risk_plan_hash: fixture.risk.plan_hash,
      earliest_cycle_time: fixture.entry,
      max_gross_exposure_amount: 200,
      max_abs_net_exposure_amount: 100,
      max_portfolio_risk_amount: 25,
      lanes: allocationAuthorityLanes(fixture.lanes),
    })),
    limitations: [
      "one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
    ],
  })
  const cycles = fixtures.map((fixture) => ({
    ...fixture,
    integrated: integratedPlan(
      fixture.allocation,
      reservation.reservation_hash,
      fixture.risk,
      reservation.reservation_hash,
    ),
  }))
  const plan = cycleSequencePlan(portfolioId, reservation.reservation_hash, cycles)
  const root = mkdtempSync(join(tmpdir(), "legacy-cycle-accounting-certification-"))
  try {
    const input = {
      plan,
      reservation,
      cycles: cycles.map((cycle, index) => ({
        cycle_index: index + 1,
        integrated_plan: cycle.integrated,
        allocation_plan: cycle.allocation,
        risk_plan: cycle.risk,
        lanes: [...cycle.lanes].reverse().map((lane) => ({
          lane_id: lane.lane_id,
          trial: lane.trial,
        })),
      })),
      artifact_store: createReplayLocalArtifactStore(root),
    }
    const sequence = runReplayPortfolioCycleSequence(input)
    if (!sequence.result || !sequence.artifact_manifest) {
      throw new Error(sequence.failure?.message ?? "P12 sequence prerequisite missing")
    }
    expect(sequence.result.cycle_records.map((record) => [
      record.opening_available_cash,
      record.ending_available_cash,
    ])).toEqual([[100, 110], [110, 110], [110, 110]])

    const accounting = runReplayPortfolioCycleSequenceAccounting(input)
    if (!accounting.evidence || !accounting.artifact_manifest || !accounting.sequence_result) {
      throw new Error(accounting.failure?.message ?? "P13 accounting evidence missing")
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
    expect(accounting.evidence.consolidated_trial_balance.balances).toMatchObject({
      opening_equity: 100,
      realized_pnl_income: 10,
    })
    expect([...new Set(accounting.evidence.consolidated_journal.map((entry) => entry.cycle_index))])
      .toEqual([1, 2, 3])
    expect(accounting.evidence.consolidated_journal.map((entry) => entry.global_journal_sequence))
      .toEqual(Array.from(
        { length: accounting.evidence.consolidated_journal.length },
        (_, index) => index + 1,
      ))
    expect(accounting.evidence.evidence_hash)
      .toBe(replayPortfolioCycleSequenceAccountingEvidenceHash(accounting.evidence))
    expect(accounting.artifact_manifest.files.map((file) => file.role)).toEqual([
      "sequence_result", "sequence_artifact_manifest", "cycle_accounting_evidence",
      "consolidated_ledger", "consolidated_journal", "consolidated_trial_balance",
      "consolidated_fingerprint", "consolidated_accounting_evidence",
    ])
    expect(runReplayPortfolioCycleSequenceAccounting(input)).toMatchObject({
      status: "completed",
      idempotent_replay: true,
      evidence: accounting.evidence,
    })
    expect(runReplayPortfolioCycleSequenceAccounting({
      ...input,
      publish_accounting_artifact: () => {
        throw new Error("fixture P13 Artifact failure")
      },
    })).toMatchObject({
      status: "failed",
      sequence_result: null,
      evidence: null,
      artifact_manifest: null,
      failure: {
        code: "sequence-accounting-artifact-failed",
        partial_result_published: false,
      },
    })
    const tamperedEvidence = structuredClone(accounting.evidence)
    tamperedEvidence.consolidated_trial_balance.opening_equity_posting_count = 2 as 1
    expect(() => assertReplayPortfolioCycleSequenceAccountingEvidence(tamperedEvidence))
      .toThrow("Trial Balance")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
