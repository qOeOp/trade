import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  createReplayAttemptLeaseObservationSnapshot,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type ReplaySpawnBoundaryRevalidationRequest,
  type TrialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  canonicalJson,
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionInputSnapshot,
  createReplayDecisionHarnessContext,
  createReplayDecisionHarnessSourceBundle,
  createReplayDecisionMarketInputSnapshot,
  createReplayDecisionStateSnapshot,
  createReplayInstrumentStatusProvenance,
  replayDatasetHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayDecisionScheduleEntry,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
  createReplaySourceEventDecisionObservationHarnessContextBinding,
  createReplaySourceEventDecisionObservationHarnessContextBindingEntry,
  type ReplaySourceEventDecisionObservationHarnessContextBindingBody,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
  createReplayDecisionWorkerInputAssemblyV2,
  createReplayDecisionWorkerInputAssemblyV2Entry,
  type ReplayDecisionWorkerInputAssemblyV2Body,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v2"
import {
  assertReplayDecisionWorkerInputAssemblyV3,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v3"
import {
  assertReplayDecisionWorkerInputAssemblyV4,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v4"
import {
  assertReplayDecisionHarnessCodeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-code-admission"
import {
  assertReplayDecisionHarnessInvocationIdentitySet,
  createReplayDecisionHarnessInvocationIdentityEntry,
  deriveReplayDecisionHarnessInvocationId,
} from "../../../contracts/src/lib/replay-decision-harness-invocation-identity"
import {
  REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  createReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry,
  deriveReplayDecisionHarnessLogicalRequestId,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10,
  assertReplayDecisionHarnessWorkerRequestV10Materialization,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerResponseV10,
  assertReplayDecisionHarnessWorkerResponseV10Contract,
  type ReplayDecisionHarnessWorkerResponseV10Body,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessDispatchLeaseAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-admission"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDecisionHarnessDispatchEvidenceRegistration,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  createReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import {
  assertReplayDecisionHarnessWorkerV10RequestFrame,
  assertReplayDecisionHarnessWorkerV10ResponseFrame,
  assertReplayDecisionHarnessWorkerV10TransportContract,
  createReplayDecisionHarnessWorkerV10RequestFrame,
  createReplayDecisionHarnessWorkerV10ResponseFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  assertReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  assertReplayPositionOpenStateInputMaterialization,
} from "../../../contracts/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplayPositionOpenStateInputMaterializationLineage,
  buildReplayPositionOpenStateInputMaterialization,
} from "../../../engine/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplayDecisionWorkerInputAssemblyV3Lineage,
  buildReplayDecisionWorkerInputAssemblyV3,
} from "../../../engine/src/lib/replay-decision-worker-input-assembly-v3"
import { buildReplayDecisionHarness } from "./replay-decision-harness-build"
import { runReplayTrial } from "./replay-trial-runner"
import {
  createReplayDecisionHarnessCutoverRegistry,
  createReplayDecisionHarnessRegistry,
  executeReplayDecisionHarness,
} from "./replay-decision-harness"
import {
  assertReplayDecisionHarnessCodeAdmissionLineage,
  buildReplayDecisionHarnessCodeAdmission,
} from "./replay-decision-harness-code-admission"
import {
  readReplayDispatchEvidence,
  registerReplayDispatchEvidence,
} from "./replay-dispatch-evidence-registry"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10Capability,
} from "./replay-decision-harness-worker-v10-build"
import {
  readReplayWorkerV10BuildCapability,
  registerReplayWorkerV10BuildCapability,
} from "./replay-worker-v10-build-capability-registry"
import {
  assertReplayDecisionHarnessWorkerV10TransportContractLineage,
  buildReplayDecisionHarnessWorkerV10TransportContract,
} from "./replay-decision-harness-worker-v10-transport-contract"
import {
  readReplayWorkerV10TransportContract,
  registerReplayWorkerV10TransportContract,
} from "./replay-worker-v10-transport-contract-registry"
import {
  assertReplayDecisionHarnessWorkerV10StdioCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10StdioCapability,
} from "./replay-decision-harness-worker-v10-stdio-build"
import {
  readReplayWorkerV10StdioCapability,
  registerReplayWorkerV10StdioCapability,
} from "./replay-worker-v10-stdio-capability-registry"
import {
  readReplayWorkerV10NegativeProbeReceipt,
  runReplayWorkerV10NegativeProbeSuite,
} from "./replay-worker-v10-negative-probe-registry"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContractLineage,
  buildReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "./replay-decision-harness-worker-v10-successor-transport-contract"
import {
  readReplayWorkerV10SuccessorTransportContract,
  registerReplayWorkerV10SuccessorTransportContract,
} from "./replay-worker-v10-successor-transport-contract-registry"
import {
  executeReplayWorkerV10Cutover,
  readReplayWorkerV10CutoverReceipt,
} from "./replay-worker-v10-cutover"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import {
  admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "./replay-worker-v10-successor-spawn-boundary-revalidation-registry"
import {
  assertReplayDecisionHarnessInvocationIdentityLineage,
  buildReplayDecisionHarnessInvocationIdentitySet,
} from "./replay-decision-harness-invocation-identity"
import {
  assertReplayDecisionHarnessLogicalRequestIdentityUpgradeLineage,
  buildReplayDecisionHarnessLogicalRequestIdentityUpgrade,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage,
  buildReplayDecisionHarnessWorkerRequestV10Materialization,
} from "./replay-decision-harness-worker-request-v10"
import {
  assertReplayDecisionHarnessWorkerResponseV10ContractLineage,
  buildReplayDecisionHarnessWorkerResponseV10Contract,
} from "./replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessExecutionEnvelopeLineage,
  buildReplayDecisionHarnessExecutionEnvelope,
} from "./replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessDispatchLeaseAdmissionLineage,
  buildReplayDecisionHarnessDispatchLeaseAdmission,
} from "./replay-decision-harness-dispatch-lease-admission"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage,
  buildReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDecisionWorkerInputAssemblyV4Lineage,
  buildReplayDecisionWorkerInputAssemblyV4,
} from "./replay-decision-worker-input-assembly-v4"
import {
  expectFormalCutoverAdmission,
  expectWorkerV10Cutover,
} from "./replay-worker-v10-cutover-legacy-stage.assertions"
import { runReplayWorkerV10LegacyActivationStage } from "./replay-worker-v10-legacy-activation-stage"
import { runReplayWorkerV10SuccessorSpawnStage } from "./replay-worker-v10-successor-spawn-stage"
import { runReplayWorkerV10SuccessorCommandStage } from "./replay-worker-v10-successor-command-stage"
import { runReplayWorkerV10SuccessorIntentStage } from "./replay-worker-v10-successor-intent-stage"
import { runReplayWorkerV10SuccessorCapsuleStage } from "./replay-worker-v10-successor-capsule-stage"
import { runReplayWorkerV10SuccessorIntegrityStage } from "./replay-worker-v10-successor-integrity-stage"
import { runReplayWorkerV10UpstreamIntegrityStage } from "./replay-worker-v10-upstream-integrity-stage"
import { runReplayWorkerV10SuccessorExecutionStage } from "./replay-worker-v10-successor-execution-stage"
import { runReplayWorkerV10SuccessorLeaseStage } from "./replay-worker-v10-successor-lease-stage"
import { runReplayWorkerV10AuthorityResponseStage } from "./replay-worker-v10-authority-response-stage"
import { runReplayWorkerV10AuthorityProcessStage } from "./replay-worker-v10-authority-process-stage"
import { runReplayWorkerV10AuthoritySpawnStage } from "./replay-worker-v10-authority-spawn-stage"
import { runReplayWorkerV10AuthorityAdmissionStage } from "./replay-worker-v10-authority-admission-stage"
import { runReplayWorkerV10AuthorityTransportStage } from "./replay-worker-v10-authority-transport-stage"
import { runReplayWorkerV10PredecessorLaunchStage } from "./replay-worker-v10-predecessor-launch-stage"
import { runReplayWorkerV10PredecessorAdmissionEvidenceStage } from "./replay-worker-v10-predecessor-admission-evidence-stage"
import { runReplayWorkerV10ExecutionClaimStage } from "./replay-worker-v10-execution-claim-stage"

const HASH = "a".repeat(64)
const ACCOUNTING = {
  spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  product_type: "linear_derivative" as const,
  base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1",
  price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001",
}
const MAINTENANCE_TIER = {
  tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH,
  notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0,
}
const RISK_SNAPSHOT = {
  schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1,
  maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50,
}
const SPEC_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:spec-1", source_hash: HASH,
}
const STATUS_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const,
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:status-1", source_hash: HASH,
}
const PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-r4-152",
  certification_ref: "certification://fixture-status-provider/v1",
  status: "certified",
  certified_at: "2026-07-13T00:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "rd-status-provider-certification-v1",
  provider_capability_hash: HASH,
  producer_domain: "market-data-products",
  producer_id: "fixture-status-producer",
  producer_version: "v1",
  producer_build_hash: HASH,
  normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH,
  allowed_source_kind: "venue_status_event_archive",
  allowed_completeness: "complete_history",
})
const STATUS_PROVENANCE = createReplayInstrumentStatusProvenance({
  producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1",
  producer_build_hash: HASH, source_owner: "binance-usdm", provider_capability_hash: HASH,
  provider_certification_ref: PROVIDER_CERTIFICATION.certification_ref,
  provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
  source_kind: "venue_status_event_archive", normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH, completeness: "complete_history", coverage_start: "2020-01-01T00:00:00Z",
  coverage_end: "2030-01-01T00:00:00Z", source_observed_through: "2026-07-13T00:00:00Z",
  produced_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-source", source_hash: HASH,
  source_record_count: 1, status_epochs: [STATUS_SNAPSHOT],
})

const GOLDEN_REPLAY_BARS: ReplayMarketBar[] = [
  { open_time: "2026-07-14T00:00:00.000Z", close_time: "2026-07-14T04:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
  { open_time: "2026-07-14T04:00:00.000Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
  { open_time: "2026-07-14T08:00:00.000Z", close_time: "2026-07-14T12:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
]
const GOLDEN_REPLAY_DATASET_HASH = replayDatasetHash(GOLDEN_REPLAY_BARS)

function request(
  candidateHash = HASH,
  harnessHash = HASH,
  datasetHash = HASH,
): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T04:00:00Z",
    earliest_executable_time: "2026-07-14T08:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const schedule = {
    schema_version: "trade.rd-replay-decision-schedule.v13" as const,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [{
      decision_sequence: 1, decision_time: order.signal_time,
      expected_effect: "authorized_initial_order" as const,
      authorized_order_hash: canonicalHash(order), authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null, authorized_partial_reduce: null,
    }, {
      decision_sequence: 2, decision_time: "2026-07-14T12:00:00Z", expected_effect: "no_action" as const,
      authorized_order_hash: null, authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null, authorized_partial_reduce: null,
    }],
  }
  const marketRequirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const,
    source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const,
    lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const,
    undeclared_input_policy: "reject" as const,
  }
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "state-materialization-run", idempotency_key: "state-materialization-idem",
    experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH,
    trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: candidateHash,
    identity_hash_policy_version: "rd-identity-v1", experiment_contract_hash: HASH,
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://fixture", dataset_hash: datasetHash,
    supplemental_facts_hash: canonicalHash([]),
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: marketRequirement,
    decision_market_input_requirement_hash: canonicalHash(marketRequirement),
    decision_schedule: schedule, decision_schedule_hash: canonicalHash(schedule),
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]),
    instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    instrument_status_provenance_hash: canonicalHash(STATUS_PROVENANCE),
    instrument_status_provider_capability_hash: HASH,
    instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
    harness_hash: harnessHash, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order, cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle",
      earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open",
      position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: {
      policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated",
      collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1,
      maintenance_tier: structuredClone(MAINTENANCE_TIER), cashflow_scope: "position_attributed",
      collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat",
      settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path",
      mark_source_policy: "complete_exact_mark_else_ohlcv_adverse",
      maintenance_trigger: "margin_balance_below_maintenance_requirement",
      breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event",
      maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure",
      liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark",
      liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position",
      liquidation_order_priority: "cancel_strategy_exits_before_forced_fill",
      liquidation_deficit: "fail_without_result",
    },
    random_seed: 1,
  }
}

function authorizeReplayTrialRequest(requestValue: ReplayExecutionRequest): TrialReservationSnapshot {
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: `reservation:${requestValue.run_id}`,
    reservation_ref: requestValue.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z",
    expires_at: "2026-07-15T00:00:00Z",
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: requestValue.experiment_id,
      trial_group_id: requestValue.trial_group_id,
      trial_group_hash: requestValue.trial_group_hash,
      trial_id: requestValue.trial_id,
      candidate_id: requestValue.candidate_id,
      candidate_hash: requestValue.candidate_hash,
      identity_hash_policy_version: requestValue.identity_hash_policy_version,
      experiment_contract_hash: requestValue.experiment_contract_hash,
    },
    trial_ordinal: 1,
    run_id: requestValue.run_id,
    counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1",
    candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: requestValue.idempotency_key,
      execution_spec_hash: replayExecutionSpecHash(requestValue),
      dataset_manifest_ref: requestValue.dataset_manifest_ref,
      dataset_hash: requestValue.dataset_hash,
      liquidity_capacity_attestation_hash: null,
      supplemental_facts_hash: requestValue.supplemental_facts_hash,
      supplemental_requirement_set_hash: requestValue.supplemental_requirement_set_hash,
      venue_risk_policy_schedule_hash: requestValue.venue_risk_policy_schedule_hash,
      instrument_spec_schedule_hash: requestValue.instrument_spec_schedule_hash,
      instrument_status_schedule_hash: requestValue.instrument_status_schedule_hash,
      instrument_status_provenance_hash: requestValue.instrument_status_provenance_hash,
      instrument_status_provider_capability_hash: requestValue.instrument_status_provider_capability_hash,
      instrument_status_provider_certification_hash: requestValue.instrument_status_provider_certification_hash,
      harness_hash: requestValue.harness_hash,
      assumptions_hash: requestValue.assumptions_hash,
      cost_policy_hash: canonicalHash(requestValue.cost_policy),
      margin_policy_hash: canonicalHash(requestValue.margin_policy),
      simulator_policy_version: requestValue.simulator_policy.version,
      execution_mode: "step",
    },
    instrument_status_provider_certification: PROVIDER_CERTIFICATION,
    required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
  }
  requestValue.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  return reservation
}

function goldenReplayDatasetManifest(): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-r4-152",
    manifest_ref: "dataset://fixture",
    data_hash: GOLDEN_REPLAY_DATASET_HASH,
    dataset_kind: "ohlcv",
    symbol: "BTCUSDT",
    timeframe: "4h",
    interval_ms: 14_400_000,
    row_count: GOLDEN_REPLAY_BARS.length,
    first_open_time: GOLDEN_REPLAY_BARS[0]!.open_time,
    last_close_time: GOLDEN_REPLAY_BARS.at(-1)!.close_time,
    observed_through: GOLDEN_REPLAY_BARS.at(-1)!.close_time,
    closed_candles_only: true,
    bar_final_availability: "close_time",
    funding_availability: "event_time",
    mark_availability: "event_time",
    mark_coverage: "none",
    mark_interval_ms: null,
    mark_event_count: 0,
    supplemental_facts: {
      coverage: "none",
      record_count: 0,
      source_ids: [],
      content_hash: canonicalHash([]),
      requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z",
      trading_enabled_at: "2020-01-01T00:00:00Z",
      delisted_at: null,
      status_history: "complete",
      status_epochs: [STATUS_SNAPSHOT],
      status_provenance: STATUS_PROVENANCE,
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

function contextBinding(requestValue: ReplayExecutionRequest) {
  const entries = requestValue.decision_schedule.entries.map((scheduleEntry: ReplayDecisionScheduleEntry) => {
    const context = createReplayDecisionHarnessContext(requestValue, scheduleEntry)
    return createReplaySourceEventDecisionObservationHarnessContextBindingEntry({
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
      decision_sequence: scheduleEntry.decision_sequence, decision_time: scheduleEntry.decision_time,
      selected_expected_effect: scheduleEntry.expected_effect,
      selected_schedule_entry_hash: canonicalHash(scheduleEntry),
      schedule_binding_id: `fixture-schedule-binding-${scheduleEntry.decision_sequence}`,
      schedule_binding_hash: HASH,
      observation_projection_id: `fixture-observation-projection-${scheduleEntry.decision_sequence}`,
      observation_projection_hash: HASH, observation_as_of_time: scheduleEntry.decision_time,
      observation_count: 1, observations_hash: HASH, observation_values_hash: HASH,
      visibility_cut_hash: HASH, pit_payload_view_hash: HASH, harness_hash: requestValue.harness_hash,
      harness_context: context, harness_context_hash: canonicalHash(context),
    })
  })
  const bodyWithoutId: Omit<ReplaySourceEventDecisionObservationHarnessContextBindingBody, "binding_id"> = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
    scope: "pre_integration_non_economic_observation_harness_context_binding",
    binding_purpose: "bind_admitted_observation_boundaries_to_frozen_harness_context_identity",
    authority_source: "control_plane_derivation_admission", context_derivation: "canonical_request_and_schedule_entry",
    observation_binding: "admitted_bundle_member_identity_only", decision_input_materialization: "not_certified",
    supplemental_input_compatibility: "not_bound", market_input_compatibility: "not_bound",
    state_input_compatibility: "not_bound", worker_request_compatibility: "not_bound",
    harness_invocation: "forbidden", decision_output_authority: "none", signal_authority: "none",
    order_authority: "none", economic_authority: "none", runner_compatibility: "not_bound",
    request_schema_version: requestValue.schema_version, request_hash: canonicalHash(requestValue),
    run_id: requestValue.run_id, experiment_id: requestValue.experiment_id,
    trial_group_id: requestValue.trial_group_id, trial_id: requestValue.trial_id,
    candidate_id: requestValue.candidate_id, candidate_hash: requestValue.candidate_hash,
    reservation_ref: requestValue.trial_reservation_ref, reservation_hash: requestValue.trial_reservation_hash,
    dataset_manifest_ref: requestValue.dataset_manifest_ref, dataset_hash: requestValue.dataset_hash,
    derivation_admission_id: "fixture-derivation-admission-1",
    derivation_admission_ref: "admission://fixture/derivation-1", derivation_admission_hash: HASH,
    bundle_id: "fixture-observation-bundle-1", bundle_hash: HASH,
    decision_schedule_hash: requestValue.decision_schedule_hash, harness_hash: requestValue.harness_hash,
    harness_context_schema_version: entries[0]!.harness_context.schema_version,
    entry_count: entries.length, entries, entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    harness_context_hashes_hash: canonicalHash(entries.map((entry) => entry.harness_context_hash)),
    observation_projection_hashes_hash: canonicalHash(entries.map((entry) => entry.observation_projection_hash)),
    first_decision_time: entries[0]!.decision_time, last_decision_time: entries.at(-1)!.decision_time,
  }
  return createReplaySourceEventDecisionObservationHarnessContextBinding({
    ...bodyWithoutId,
    binding_id: `source-event-observation-harness-context-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
}

function workerInputAssemblyV2(requestValue: ReplayExecutionRequest, binding: ReturnType<typeof contextBinding>) {
  const entries = binding.entries.map((contextEntry) => {
    const decisionTime = contextEntry.decision_time
    const close = Date.parse(decisionTime)
    const decisionInput = createReplayDecisionInputSnapshot(requestValue, [], decisionTime)
    const marketInput = createReplayDecisionMarketInputSnapshot({
      request: requestValue,
      decision_time: decisionTime,
      interval_ms: 14_400_000,
      bars: [{
        open_time: new Date(close - 14_400_000).toISOString(), close_time: decisionTime,
        open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true,
      }],
    })
    const needsState = contextEntry.harness_context.decision_phase === "position_open"
    return createReplayDecisionWorkerInputAssemblyV2Entry({
      schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
      decision_sequence: contextEntry.decision_sequence,
      decision_time: decisionTime,
      decision_phase: contextEntry.harness_context.decision_phase,
      harness_context_binding_entry_hash: contextEntry.entry_hash,
      harness_context: structuredClone(contextEntry.harness_context),
      harness_context_hash: contextEntry.harness_context_hash,
      supplemental_input_source: "r4_97_empty_input_materialization",
      decision_input_snapshot: decisionInput,
      decision_input_snapshot_hash: decisionInput.snapshot_hash,
      market_input_source: "r4_100_market_input_materialization",
      decision_market_input_snapshot: marketInput,
      decision_market_input_snapshot_hash: marketInput.snapshot_hash,
      r4_97_embedded_market_compatibility: "exact_snapshot_match",
      state_input_status: needsState
        ? "runtime_state_required_not_materialized" : "not_applicable_non_position_phase",
      decision_state_snapshot: null,
      input_tuple_status: needsState
        ? "incomplete_runtime_state_snapshot" : "complete_non_executable_build_unbound",
      worker_request: null,
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
  const bodyWithoutId: Omit<ReplayDecisionWorkerInputAssemblyV2Body, "assembly_id"> = {
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
    assembly_policy_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
    scope: "pre_worker_non_economic_complete_input_tuple_assembly",
    purpose: "bind_context_supplemental_and_market_snapshots_without_creating_worker_request",
    parent_validation: "self_hash_and_cross_object_binding_only",
    source_bundle_binding: "not_bound", build_attestation_binding: "not_bound",
    invocation_identity_materialization: "forbidden", worker_request_materialization: "forbidden",
    harness_invocation: "forbidden", decision_output_authority: "none", signal_authority: "none",
    order_authority: "none", economic_authority: "none", runner_compatibility: "not_bound",
    request_hash: canonicalHash(requestValue), run_id: requestValue.run_id,
    experiment_id: requestValue.experiment_id, trial_group_id: requestValue.trial_group_id,
    trial_id: requestValue.trial_id, candidate_id: requestValue.candidate_id,
    candidate_hash: requestValue.candidate_hash, harness_context_binding_id: binding.binding_id,
    harness_context_binding_hash: binding.binding_hash,
    observation_input_materialization_id: "fixture-r4-97-materialization",
    observation_input_materialization_hash: HASH,
    initial_signal_supplemental_materialization_id: null,
    initial_signal_supplemental_materialization_hash: null,
    market_input_materialization_id: "fixture-r4-100-materialization",
    market_input_materialization_hash: HASH,
    supplemental_source_policy: "exactly_one_request_bound_r4_97_or_r4_98_materialization",
    market_source_policy: "required_same_request_context_bound_r4_100_materialization",
    r4_97_embedded_market_policy: "require_exact_match_then_use_r4_100",
    entry_count: entries.length, entries, entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    complete_entry_count: 1, incomplete_state_entry_count: 1, missing_market_entry_count: 0,
    worker_request_count: 0,
  }
  return createReplayDecisionWorkerInputAssemblyV2({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v2-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
}

const replayProfileStartedAt = performance.now()

function replayProfile(stage: string): void {
  if (process.env.REPLAY_TEST_PROFILE !== "1") return
  const elapsed = ((performance.now() - replayProfileStartedAt) / 1_000).toFixed(2)
  process.stderr.write(`[replay-worker-v10-test] ${elapsed}s ${stage}\n`)
}

test("Replay binds runtime inputs and deterministic code evidence without Worker authority", async () => {
  replayProfile("start")
  const sourceBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "fixture://decision-harness/r4-104",
    entrypoint: { file_path: "strategy.ts", export_name: "decide" },
    files: [{
      path: "strategy.ts",
      content_utf8: [
        "export function decide(input) {",
        "  if (input.request_context.decision_phase !== 'initial_entry') return { decision_output: { action: 'no_action' }, trace: null }",
        "  return { decision_output: { action: 'submit_initial_order', order: { side: 'long', quantity: 1, signal_time: '2026-07-14T04:00:00Z', earliest_executable_time: '2026-07-14T08:00:00Z', stop_price: 95, target_price: 110, entry_execution: { order_type: 'market' } } }, trace: null }",
        "}",
        "",
      ].join("\n"),
    }],
  })
  const buildAttestation = buildReplayDecisionHarness(sourceBundle)
  const requestValue = request(HASH, sourceBundle.bundle_hash, GOLDEN_REPLAY_DATASET_HASH)
  const trialReservation = authorizeReplayTrialRequest(requestValue)
  const binding = contextBinding(requestValue)
  const sourceEvents: ReplaySourceEvent[] = [{
    source_event_id: "source:bar_range:1", kind: "bar_range", source_index: 0,
    event_key: {
      event_time: "2026-07-14T08:00:00Z", boundary_phase: 20,
      source_sequence: 1, event_subphase: 0, stable_event_id: "source:bar_range:1",
    },
  }, {
    source_event_id: "source:bar_range:2", kind: "bar_range", source_index: 1,
    event_key: {
      event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
      source_sequence: 2, event_subphase: 0, stable_event_id: "source:bar_range:2",
    },
  }]
  const snapshot = createReplayDecisionStateSnapshot({
    schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
    run_id: requestValue.run_id, decision_sequence: 2, decision_time: "2026-07-14T12:00:00Z",
    observation_event_key: structuredClone(sourceEvents[1]!.event_key),
    source_prefix_hash: canonicalHash(sourceEvents),
    position: { state: "open", side: "long", signed_quantity: 1, average_entry_price: 100 },
    active_protection: {
      stop: { order_id: "stop-1", status: "active", trigger_price: 95, remaining_quantity: 1 },
      target: { order_id: "target-1", status: "active", trigger_price: 110, remaining_quantity: 1 },
    },
    mark_price: 102, cash_balance: 999.9, total_fees: 0.1, total_funding: 0,
    unrealized_pnl: 2, equity: 1001.9,
  })
  const input = {
    request: requestValue,
    harness_context_binding: binding,
    decision_state_snapshot: snapshot,
    source_events: sourceEvents,
  }
  const materialization = buildReplayPositionOpenStateInputMaterialization(input)
  expect(materialization.owner).toBe("replay_engine_runtime")
  expect(materialization.economic_recomputation).toBe("not_performed")
  expect(materialization.source_event_count).toBe(2)
  expect(materialization.decision_state_snapshot_hash).toBe(snapshot.snapshot_hash)
  expect(materialization.worker_request_materialization).toBe("forbidden")
  expect(materialization.harness_invocation).toBe("forbidden")
  expect(() => assertReplayPositionOpenStateInputMaterialization(materialization)).not.toThrow()
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, input)).not.toThrow()
  expect(buildReplayPositionOpenStateInputMaterialization(structuredClone(input))).toEqual(materialization)

  const sourceAssemblyV2 = workerInputAssemblyV2(requestValue, binding)
  const assemblyV3Input = {
    source_assembly_v2: sourceAssemblyV2,
    state_input_materializations: [materialization],
  }
  const assemblyV3 = buildReplayDecisionWorkerInputAssemblyV3(assemblyV3Input)
  expect(assemblyV3.owner).toBe("replay_engine_runtime")
  expect(assemblyV3.source_assembly_v2_hash).toBe(sourceAssemblyV2.assembly_hash)
  expect(assemblyV3.state_materialization_count).toBe(1)
  expect(assemblyV3.complete_entry_count).toBe(2)
  expect(assemblyV3.incomplete_state_entry_count).toBe(0)
  expect(assemblyV3.entries[1]!.state_input_materialization_hash).toBe(materialization.materialization_hash)
  expect(assemblyV3.entries[1]!.input_tuple_status).toBe("complete_non_executable_build_unbound")
  expect(assemblyV3.worker_request_count).toBe(0)
  expect(assemblyV3.entries.every((entry) => entry.worker_request === null)).toBeTrue()
  expect(() => assertReplayDecisionWorkerInputAssemblyV3(assemblyV3)).not.toThrow()
  expect(() => assertReplayDecisionWorkerInputAssemblyV3Lineage(assemblyV3, assemblyV3Input)).not.toThrow()
  expect(buildReplayDecisionWorkerInputAssemblyV3(structuredClone(assemblyV3Input))).toEqual(assemblyV3)
  expect(() => buildReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3Input,
    state_input_materializations: [],
  })).toThrow("exactly one State parent")
  expect(() => assertReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision Worker input assembly v3 authority")

  const assemblyV4Input = {
    source_assembly_v3: assemblyV3,
    harness_context_binding: binding,
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  }
  const assemblyV4 = buildReplayDecisionWorkerInputAssemblyV4(assemblyV4Input)
  expect(assemblyV4.owner).toBe("replay_runner_code_admission")
  expect(assemblyV4.input_tuple_status).toBe("complete_non_executable_build_bound")
  expect(assemblyV4.source_bundle_hash).toBe(sourceBundle.bundle_hash)
  expect(assemblyV4.build_attestation_hash).toBe(buildAttestation.attestation_hash)
  expect(assemblyV4.build_artifact_hash).toBe(buildAttestation.artifact.sha256)
  expect(assemblyV4.worker_request_count).toBe(0)
  expect(assemblyV4.worker_request_materialization).toBe("forbidden")
  expect(assemblyV4.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionWorkerInputAssemblyV4(assemblyV4)).not.toThrow()
  expect(() => assertReplayDecisionWorkerInputAssemblyV4Lineage(assemblyV4, assemblyV4Input)).not.toThrow()
  expect(buildReplayDecisionWorkerInputAssemblyV4(structuredClone(assemblyV4Input))).toEqual(assemblyV4)
  const forgedBuild = createReplayDecisionHarnessBuildAttestation({
    source_bundle: sourceBundle,
    runtime_version: buildAttestation.runtime.runtime_version,
    runtime_executable_sha256: buildAttestation.runtime.executable_sha256,
    artifact_content_utf8: `${buildAttestation.artifact.content_utf8}// forged\n`,
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4Input,
    build_attestation: forgedBuild,
  })).toThrow("does not match deterministic rebuild")
  const mismatchedBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "fixture://decision-harness/r4-104-mismatch",
    entrypoint: { file_path: "strategy.ts", export_name: "decide" },
    files: [{ path: "strategy.ts", content_utf8: "export function decide() { return null }\n" }],
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4Input,
    source_bundle: mismatchedBundle,
    build_attestation: buildReplayDecisionHarness(mismatchedBundle),
  })).toThrow("input/Context/code binding drift")
  expect(() => assertReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision Worker input assembly v4 authority")

  const registry = createReplayDecisionHarnessRegistry([{
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  }])
  replayProfile("base assembly and registry")
  const codeAdmissionInput = { source_assembly_v4: assemblyV4, registry }
  const codeAdmission = buildReplayDecisionHarnessCodeAdmission(codeAdmissionInput)
  expect(codeAdmission.owner).toBe("replay_runner_registry_admission")
  expect(codeAdmission.admission_status).toBe("compatible_exact_registration_observed")
  expect(codeAdmission.registry_registration_lifetime).toBe("immutable_for_process_lifetime")
  expect(codeAdmission.registry_instance_identity).toBe("unavailable")
  expect(codeAdmission.registry_instance_id).toBeNull()
  expect(codeAdmission.future_lookup_guarantee).toBe("not_proven")
  expect(codeAdmission.registry_authenticity).toBe("process_local_interface_observation_not_signed")
  expect(codeAdmission.lookup_value).toBe(sourceBundle.bundle_hash)
  expect(codeAdmission.registry_entry.source_bundle).toEqual(sourceBundle)
  expect(codeAdmission.registry_entry.build_attestation).toEqual(buildAttestation)
  expect(codeAdmission.worker_request_count).toBe(0)
  expect(codeAdmission.worker_request_materialization).toBe("forbidden")
  expect(codeAdmission.harness_invocation).toBe("forbidden")
  expect(codeAdmission.trial_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessCodeAdmission(codeAdmission)).not.toThrow()
  expect(() => assertReplayDecisionHarnessCodeAdmissionLineage(codeAdmission, codeAdmissionInput)).not.toThrow()
  const independentlyCreatedRegistry = createReplayDecisionHarnessRegistry([{
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  }])
  expect(buildReplayDecisionHarnessCodeAdmission({
    source_assembly_v4: structuredClone(assemblyV4),
    registry: independentlyCreatedRegistry,
  })).toEqual(codeAdmission)
  expect(() => buildReplayDecisionHarnessCodeAdmission({
    source_assembly_v4: assemblyV4,
    registry: createReplayDecisionHarnessRegistry([]),
  })).toThrow("bundle hash is not registered")
  const mismatchedRegistration = {
    source_bundle: sourceBundle,
    build_attestation: forgedBuild,
  }
  expect(() => buildReplayDecisionHarnessCodeAdmission({
    source_assembly_v4: assemblyV4,
    registry: {
      capability: structuredClone(registry.capability),
      resolve: () => structuredClone(mismatchedRegistration),
    },
  })).toThrow("does not exactly match R4.104 code evidence")
  expect(() => assertReplayDecisionHarnessCodeAdmission({
    ...codeAdmission,
    future_lookup_guarantee: "proven" as never,
  })).toThrow("unsupported decision harness code admission authority")
  expect(() => assertReplayDecisionHarnessCodeAdmission({
    ...codeAdmission,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision harness code admission authority")

  const invocationIdentityInput = { code_admission: codeAdmission }
  const invocationIdentities = buildReplayDecisionHarnessInvocationIdentitySet(invocationIdentityInput)
  expect(invocationIdentities.owner).toBe("replay_runner_invocation_admission")
  expect(invocationIdentities.identity_formula_compatibility).toBe("exact_existing_worker_request_v9_derivation")
  expect(invocationIdentities.request_context_identity_limit)
    .toBe("context_not_direct_hash_member_parent_evidence_only")
  expect(invocationIdentities.reproducibility_pair_identity)
    .toBe("same_logical_invocation_id_for_both_processes")
  expect(invocationIdentities.process_instance_identity).toBe("not_materialized")
  expect(invocationIdentities.execution_attempt_identity).toBe("not_materialized")
  expect(invocationIdentities.retry_identity).toBe("not_materialized")
  expect(invocationIdentities.entry_count).toBe(2)
  expect(invocationIdentities.invocation_identity_count).toBe(2)
  expect(new Set(invocationIdentities.entries.map((entry) => entry.invocation_id)).size).toBe(2)
  expect(invocationIdentities.entries[0]!.decision_state_snapshot_hash).toBeNull()
  expect(invocationIdentities.entries[1]!.decision_state_snapshot_hash).toBe(snapshot.snapshot_hash)
  expect(invocationIdentities.entries[0]!.worker_request).toBeNull()
  expect(invocationIdentities.worker_request_count).toBe(0)
  expect(invocationIdentities.worker_request_materialization).toBe("forbidden")
  expect(invocationIdentities.harness_invocation).toBe("forbidden")
  expect(invocationIdentities.trial_authority).toBe("none")
  expect(invocationIdentities.entries[0]!.invocation_id).toBe(deriveReplayDecisionHarnessInvocationId({
    run_id: requestValue.run_id,
    source_bundle_hash: sourceBundle.bundle_hash,
    artifact_hash: buildAttestation.artifact.sha256,
    decision_input_snapshot_hash: sourceAssemblyV2.entries[0]!.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: sourceAssemblyV2.entries[0]!.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: null,
  }))
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet(invocationIdentities)).not.toThrow()
  expect(() => assertReplayDecisionHarnessInvocationIdentityLineage(
    invocationIdentities,
    invocationIdentityInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessInvocationIdentitySet({
    code_admission: structuredClone(codeAdmission),
  })).toEqual(invocationIdentities)
  const firstIdentity = invocationIdentities.entries[0]!
  const { entry_hash: _identityEntryHash, ...firstIdentityBody } = firstIdentity
  const forgedInvocationEntry = createReplayDecisionHarnessInvocationIdentityEntry({
    ...firstIdentityBody,
    invocation_id: "b".repeat(64),
  })
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    entries: [forgedInvocationEntry, invocationIdentities.entries[1]!],
  })).toThrow("invocation identity derivation drift")
  const contextDriftEntry = createReplayDecisionHarnessInvocationIdentityEntry({
    ...firstIdentityBody,
    request_context_hash: "b".repeat(64),
  })
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    entries: [contextDriftEntry, invocationIdentities.entries[1]!],
  })).toThrow("entry parent binding drift")
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    process_instance_identity: "materialized" as never,
  })).toThrow("unsupported decision harness invocation identity set authority")
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision harness invocation identity set authority")

  const identityUpgradeInput = { source_invocation_identity_set: invocationIdentities }
  const identityUpgrade = buildReplayDecisionHarnessLogicalRequestIdentityUpgrade(identityUpgradeInput)
  expect(identityUpgrade.owner).toBe("replay_runner_protocol_admission")
  expect(identityUpgrade.activation_status).toBe("identity_policy_frozen_worker_request_not_materialized")
  expect(identityUpgrade.target_worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v10")
  expect(identityUpgrade.target_worker_request_schema_version)
    .toBe("trade.rd-replay-decision-harness-worker-request.v10")
  expect(identityUpgrade.request_context_direct_binding).toBe("required")
  expect(identityUpgrade.code_admission_direct_binding).toBe("required")
  expect(identityUpgrade.attempt_identity_policy).toBe("separate_execution_envelope_not_logical_request_hash")
  expect(identityUpgrade.attempt_lease_binding).toBe("forbidden")
  expect(identityUpgrade.retry_stability).toBe("same_frozen_inputs_and_code_admission_same_logical_request_id")
  expect(identityUpgrade.process_instance_identity).toBe("not_materialized")
  expect(identityUpgrade.execution_attempt_identity).toBe("not_materialized")
  expect(identityUpgrade.entries[0]!.legacy_v9_invocation_id).toBe(invocationIdentities.entries[0]!.invocation_id)
  expect(identityUpgrade.entries[0]!.logical_request_id).not.toBe(identityUpgrade.entries[0]!.legacy_v9_invocation_id)
  expect(identityUpgrade.entries[0]!.worker_request).toBeNull()
  expect(identityUpgrade.worker_request_count).toBe(0)
  expect(identityUpgrade.worker_request_materialization).toBe("forbidden")
  expect(identityUpgrade.harness_invocation).toBe("forbidden")
  expect(identityUpgrade.trial_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade(identityUpgrade)).not.toThrow()
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgradeLineage(
    identityUpgrade,
    identityUpgradeInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    source_invocation_identity_set: structuredClone(invocationIdentities),
  })).toEqual(identityUpgrade)
  const firstUpgradeEntry = identityUpgrade.entries[0]!
  const logicalIdInput = {
    identity_policy_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    target_worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
    run_id: firstUpgradeEntry.run_id,
    code_admission_hash: firstUpgradeEntry.code_admission_hash,
    source_bundle_hash: firstUpgradeEntry.source_bundle_hash,
    artifact_hash: firstUpgradeEntry.artifact_hash,
    request_context_hash: firstUpgradeEntry.request_context_hash,
    decision_input_snapshot_hash: firstUpgradeEntry.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: firstUpgradeEntry.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: firstUpgradeEntry.decision_state_snapshot_hash,
  }
  expect(deriveReplayDecisionHarnessLogicalRequestId(logicalIdInput)).toBe(firstUpgradeEntry.logical_request_id)
  expect(deriveReplayDecisionHarnessLogicalRequestId({
    ...logicalIdInput,
    request_context_hash: "b".repeat(64),
  })).not.toBe(firstUpgradeEntry.logical_request_id)
  expect(deriveReplayDecisionHarnessLogicalRequestId({
    ...logicalIdInput,
    code_admission_hash: "b".repeat(64),
  })).not.toBe(firstUpgradeEntry.logical_request_id)
  const { entry_hash: _upgradeEntryHash, ...firstUpgradeEntryBody } = firstUpgradeEntry
  const forgedLogicalIdEntry = createReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry({
    ...firstUpgradeEntryBody,
    logical_request_id: "b".repeat(64),
  })
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...identityUpgrade,
    entries: [forgedLogicalIdEntry, identityUpgrade.entries[1]!],
  })).toThrow("logical request identity upgrade derivation drift")
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...identityUpgrade,
    attempt_lease_hash: HASH,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...identityUpgrade,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision harness logical request identity upgrade authority")

  const requestV10Input = { source_identity_upgrade: identityUpgrade }
  const requestV10Materialization = buildReplayDecisionHarnessWorkerRequestV10Materialization(requestV10Input)
  expect(requestV10Materialization.owner).toBe("replay_runner_protocol_admission")
  expect(requestV10Materialization.activation_status).toBe("contract_materialized_non_executable")
  expect(requestV10Materialization.field_policy).toBe("exact_whitelist_no_attempt_or_process_fields")
  expect(requestV10Materialization.self_validation_policy).toBe("content_hashes_logical_id_and_request_hash")
  expect(requestV10Materialization.migration_policy).toBe("v9_execution_unchanged_v10_contract_only")
  expect(requestV10Materialization.activation_gate)
    .toBe("response_echo_execution_envelope_transport_and_worker_certification_required")
  expect(requestV10Materialization.request_count).toBe(2)
  expect(requestV10Materialization.response_contract).toBe("not_materialized")
  expect(requestV10Materialization.execution_envelope).toBe("not_materialized")
  expect(requestV10Materialization.transport).toBe("forbidden")
  expect(requestV10Materialization.harness_invocation).toBe("forbidden")
  expect(requestV10Materialization.trial_authority).toBe("none")
  const firstRequestV10 = requestV10Materialization.requests[0]!
  expect(firstRequestV10.schema_version).toBe("trade.rd-replay-decision-harness-worker-request.v10")
  expect(firstRequestV10.worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v10")
  expect(firstRequestV10.logical_request_id).toBe(identityUpgrade.entries[0]!.logical_request_id)
  expect(firstRequestV10.legacy_v9_invocation_id).toBe(identityUpgrade.entries[0]!.legacy_v9_invocation_id)
  expect(firstRequestV10.request_context).toEqual(sourceAssemblyV2.entries[0]!.harness_context)
  expect(firstRequestV10.decision_input_snapshot).toEqual(sourceAssemblyV2.entries[0]!.decision_input_snapshot)
  expect(firstRequestV10.decision_market_input_snapshot)
    .toEqual(sourceAssemblyV2.entries[0]!.decision_market_input_snapshot)
  expect(firstRequestV10.decision_state_snapshot).toBeNull()
  expect(requestV10Materialization.requests[1]!.decision_state_snapshot).toEqual(snapshot)
  expect(firstRequestV10.execution_admission).toBe("not_granted")
  expect(firstRequestV10.execution_envelope).toBeNull()
  expect(firstRequestV10.transport_status).toBe("not_invoked")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10(firstRequestV10)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerRequestV10Materialization(requestV10Materialization)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage(
    requestV10Materialization,
    requestV10Input,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerRequestV10Materialization({
    source_identity_upgrade: structuredClone(identityUpgrade),
  })).toEqual(requestV10Materialization)
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    attempt_lease_hash: HASH,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    logical_request_id: "b".repeat(64),
  })).toThrow("logical identity or self-hash drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    request_context: {
      ...firstRequestV10.request_context,
      candidate_hash: "b".repeat(64),
    },
  })).toThrow("embedded input hash or run binding drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10Materialization({
    ...requestV10Materialization,
    transport: "stdio" as never,
  })).toThrow("unsupported decision harness Worker Request v10 materialization authority")

  const workerV10BuildInput = { source_code_admission: codeAdmission }
  replayProfile("worker request identity")
  const workerV10BuildCapability = buildReplayDecisionHarnessWorkerV10Capability(workerV10BuildInput)
  expect(workerV10BuildCapability.activation_status)
    .toBe("build_capability_available_process_not_admitted")
  expect(workerV10BuildCapability.legacy_v9_worker_protocol_version)
    .toBe("rd-replay-harness-worker-stdio-v9")
  expect(workerV10BuildCapability.target_worker_protocol_version)
    .toBe("rd-replay-harness-worker-stdio-v10")
  expect(workerV10BuildCapability.migration_policy)
    .toBe("separate_v10_artifact_v9_execution_path_unchanged")
  expect(workerV10BuildCapability.artifact.sha256).not.toBe(buildAttestation.artifact.sha256)
  expect(workerV10BuildCapability.artifact_relation).toBe("distinct_from_legacy_v9_worker_artifact")
  expect(workerV10BuildCapability.decoder_input_surface).toBe("one_in_memory_plain_object_no_byte_frame")
  expect(workerV10BuildCapability.decoder_validation_policy)
    .toBe("exact_field_whitelist_protocol_schema_and_non_executable_markers")
  expect(workerV10BuildCapability.semantic_validation_policy)
    .toBe("runner_v10_contract_validation_still_required_before_future_dispatch")
  expect(workerV10BuildCapability.transport_frame_design_status).toBe("not_designed")
  expect(workerV10BuildCapability.stdio_loop).toBe("not_materialized")
  expect(workerV10BuildCapability.process_launch).toBe("not_materialized")
  expect(workerV10BuildCapability.worker_request_instance_count).toBe(0)
  expect(workerV10BuildCapability.request_decode_occurrence).toBe("not_materialized")
  expect(workerV10BuildCapability.dispatch_occurrence).toBe("not_materialized")
  expect(workerV10BuildCapability.harness_invocation).toBe("forbidden")
  expect(workerV10BuildCapability.response_instance).toBeNull()
  expect(workerV10BuildCapability.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability(workerV10BuildCapability)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapabilityLineage(
    workerV10BuildCapability,
    workerV10BuildInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerV10Capability({
    source_code_admission: structuredClone(codeAdmission),
  })).toEqual(workerV10BuildCapability)

  const decoderModuleRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-decoder-module-"))
  try {
    const decoderModulePath = join(decoderModuleRoot, workerV10BuildCapability.artifact.file_name)
    writeFileSync(decoderModulePath, workerV10BuildCapability.artifact.content_utf8, "utf8")
    const decoderModule = await import(
      `${pathToFileURL(decoderModulePath).href}?artifact=${workerV10BuildCapability.artifact.sha256}`
    ) as Record<string, unknown>
    const decode = decoderModule[workerV10BuildCapability.decoder_export_name]
    if (typeof decode !== "function") throw new Error("expected Worker v10 decoder export")
    expect(decode(structuredClone(firstRequestV10))).toEqual(firstRequestV10)
    expect(() => decode({ ...firstRequestV10, frame_id: "not-designed" }))
      .toThrow("field whitelist drift")
    expect(() => decode(Object.assign(Object.create({ inherited: true }), firstRequestV10)))
      .toThrow("must be one plain object")
    expect(() => decode({ ...firstRequestV10, worker_protocol_version: "rd-replay-harness-worker-stdio-v9" }))
      .toThrow("protocol drift")
    expect(() => decode({ ...firstRequestV10, transport_status: "invoked" }))
      .toThrow("executable markers are forbidden")
  } finally {
    rmSync(decoderModuleRoot, { recursive: true, force: true })
  }

  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    target_worker_protocol_version: "rd-replay-harness-worker-stdio-v9" as never,
  })).toThrow("unsupported decision harness Worker v10 build capability authority")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    worker_request_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 build capability authority")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    artifact: { ...workerV10BuildCapability.artifact, content_utf8: "forged" },
  })).toThrow("parent or artifact binding drift")

  const workerV10RegistryRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-build-registry-"))
  try {
    expect(readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toBeNull()
    const registeredWorkerV10Capability = registerReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })
    expect(registeredWorkerV10Capability).toEqual(workerV10BuildCapability)
    expect(registerReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: structuredClone(codeAdmission),
    })).toEqual(workerV10BuildCapability)
    expect(readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toEqual(workerV10BuildCapability)
    const capabilityFile = readdirSync(workerV10RegistryRoot)
      .find((name) => name.startsWith("worker-v10-build-capability-"))
    if (!capabilityFile) throw new Error("expected Replay Worker v10 build capability registry file")
    writeFileSync(join(workerV10RegistryRoot, capabilityFile), "{}\n", "utf8")
    expect(() => readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toThrow()
  } finally {
    rmSync(workerV10RegistryRoot, { recursive: true, force: true })
  }

  const differentWorkerV10RegistryRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-build-different-"))
  try {
    const { capability_hash: originalCapabilityHash, ...workerV10CapabilityBody } = workerV10BuildCapability
    expect(originalCapabilityHash).toHaveLength(64)
    const forgedGeneratedSource = `${workerV10CapabilityBody.generated_entrypoint_content_utf8}// forged\n`
    const forgedArtifact = `${workerV10CapabilityBody.artifact.content_utf8}// forged\n`
    const forgedCapability = createReplayDecisionHarnessWorkerV10BuildCapability({
      ...workerV10CapabilityBody,
      generated_entrypoint_content_utf8: forgedGeneratedSource,
      generated_entrypoint_hash: createHash("sha256").update(forgedGeneratedSource, "utf8").digest("hex"),
      artifact: {
        ...workerV10CapabilityBody.artifact,
        content_utf8: forgedArtifact,
        sha256: createHash("sha256").update(forgedArtifact, "utf8").digest("hex"),
      },
    })
    const differentFile = join(
      differentWorkerV10RegistryRoot,
      `worker-v10-build-capability-${forgedCapability.capability_key}.json`,
    )
    writeFileSync(differentFile, `${canonicalJson(forgedCapability)}\n`, "utf8")
    expect(() => registerReplayWorkerV10BuildCapability({
      registry_root: differentWorkerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toThrow("already registered with different evidence")
  } finally {
    rmSync(differentWorkerV10RegistryRoot, { recursive: true, force: true })
  }

  const responseV10ContractInput = { source_request_materialization: requestV10Materialization }
  const responseV10Contract = buildReplayDecisionHarnessWorkerResponseV10Contract(responseV10ContractInput)
  expect(responseV10Contract.owner).toBe("replay_runner_protocol_admission")
  expect(responseV10Contract.activation_status).toBe("schema_frozen_response_not_materialized")
  expect(responseV10Contract.worker_response_schema_version)
    .toBe("trade.rd-replay-decision-harness-worker-response.v10")
  expect(responseV10Contract.response_field_whitelist).toEqual([...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS])
  expect(responseV10Contract.request_echo_fields)
    .toEqual([...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS])
  expect(responseV10Contract.decision_output_policy)
    .toBe("typed_shape_and_hash_only_schedule_authority_not_granted")
  expect(responseV10Contract.migration_policy).toBe("v9_response_and_receipt_execution_path_unchanged")
  expect(responseV10Contract.response_instance_count).toBe(0)
  expect(responseV10Contract.response_instances).toEqual([])
  expect(responseV10Contract.response_admission).toBe("not_granted")
  expect(responseV10Contract.execution_envelope).toBe("not_materialized")
  expect(responseV10Contract.process_receipt).toBe("not_materialized")
  expect(responseV10Contract.harness_receipt).toBe("not_materialized")
  expect(responseV10Contract.transport).toBe("forbidden")
  expect(responseV10Contract.harness_invocation).toBe("forbidden")
  expect(responseV10Contract.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10Contract(responseV10Contract)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerResponseV10ContractLineage(
    responseV10Contract,
    responseV10ContractInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerResponseV10Contract({
    source_request_materialization: structuredClone(requestV10Materialization),
  })).toEqual(responseV10Contract)
  const responseOutput = { action: "no_action" as const }
  const responseTrace = { fixture: "schema-validation-only" }
  const responseV10Body: ReplayDecisionHarnessWorkerResponseV10Body = {
    schema_version: "trade.rd-replay-decision-harness-worker-response.v10",
    worker_protocol_version: firstRequestV10.worker_protocol_version,
    logical_request_id: firstRequestV10.logical_request_id,
    request_hash: firstRequestV10.request_hash,
    run_id: firstRequestV10.run_id,
    code_admission_hash: firstRequestV10.code_admission_hash,
    source_bundle_hash: firstRequestV10.source_bundle_hash,
    artifact_hash: firstRequestV10.artifact_hash,
    request_context_hash: firstRequestV10.request_context_hash,
    decision_input_snapshot_hash: firstRequestV10.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: firstRequestV10.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: firstRequestV10.decision_state_snapshot_hash,
    decision_output: responseOutput,
    decision_output_hash: canonicalHash(responseOutput),
    trace: responseTrace,
    trace_hash: canonicalHash(responseTrace),
    authority_status: "unadmitted_worker_claim",
  }
  const responseV10 = { ...responseV10Body, response_hash: canonicalHash(responseV10Body) }
  expect(() => assertReplayDecisionHarnessWorkerResponseV10(responseV10, firstRequestV10)).not.toThrow()
  const echoDriftBody = { ...responseV10Body, request_hash: "b".repeat(64) }
  expect(() => assertReplayDecisionHarnessWorkerResponseV10({
    ...echoDriftBody,
    response_hash: canonicalHash(echoDriftBody),
  }, firstRequestV10)).toThrow("Request echo drift")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10({
    ...responseV10,
    execution_envelope_hash: HASH,
  } as never, firstRequestV10)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10Contract({
    ...responseV10Contract,
    response_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker Response v10 contract authority")

  const authorityBinding = assemblyV4.harness_context_binding
  const attemptLease: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "attempt-envelope-1",
    attempt_ordinal: 1,
    worker_id: "worker-authority-1",
    trial_id: authorityBinding.trial_id,
    run_id: authorityBinding.run_id,
    reservation_ref: authorityBinding.reservation_ref,
    reservation_hash: authorityBinding.reservation_hash,
    request_hash: authorityBinding.request_hash,
    status: "running",
    lease_generation: 2,
    claimed_at: "2026-07-14T00:00:00Z",
    heartbeat_at: "2026-07-14T00:00:30Z",
    lease_expires_at: "2026-07-14T00:05:00Z",
  }
  const envelopeInput = {
    source_response_contract: responseV10Contract,
    logical_request_id: firstRequestV10.logical_request_id,
    attempt_lease: attemptLease,
  }
  const executionEnvelope = buildReplayDecisionHarnessExecutionEnvelope(envelopeInput)
  expect(executionEnvelope.owner).toBe("replay_runner_execution_admission")
  expect(executionEnvelope.worker_request_hash).toBe(firstRequestV10.request_hash)
  expect(executionEnvelope.replay_execution_request_hash).toBe(authorityBinding.request_hash)
  expect(executionEnvelope.worker_request_hash).not.toBe(executionEnvelope.replay_execution_request_hash)
  expect(executionEnvelope.attempt_lease_hash).toBe(hashReplayAttemptLeaseSnapshot(attemptLease))
  expect(executionEnvelope.worker_identity_semantics)
    .toBe("control_plane_worker_authority_not_os_process_identity")
  expect(executionEnvelope.succession_kind).toBe("root_binding")
  expect(executionEnvelope.predecessor_execution_envelope_hash).toBeNull()
  expect(executionEnvelope.lease_generation_policy).toBe("one_envelope_one_exact_generation")
  expect(executionEnvelope.cross_attempt_retry_policy)
    .toBe("new_attempt_requires_new_root_envelope_logical_request_stable")
  expect(executionEnvelope.reproducibility_pair_policy)
    .toBe("shared_envelope_distinct_future_process_receipts")
  expect(executionEnvelope.lease_freshness_at_dispatch)
    .toBe("not_evaluated_requires_future_transport_admission")
  expect(executionEnvelope.process_instance_identity).toBe("not_materialized")
  expect(executionEnvelope.transport_admission).toBe("not_granted")
  expect(executionEnvelope.transport).toBe("forbidden")
  expect(executionEnvelope.harness_invocation).toBe("forbidden")
  expect(executionEnvelope.response_instance).toBeNull()
  expect(executionEnvelope.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope(executionEnvelope)).not.toThrow()
  expect(() => assertReplayDecisionHarnessExecutionEnvelopeLineage(executionEnvelope, envelopeInput)).not.toThrow()
  expect(buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    source_response_contract: structuredClone(responseV10Contract),
    attempt_lease: structuredClone(attemptLease),
  })).toEqual(executionEnvelope)
  const renewedLease: ReplayAttemptLeaseSnapshot = {
    ...attemptLease,
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:02:00Z",
    lease_expires_at: "2026-07-14T00:07:00Z",
  }
  const successorInput = {
    ...envelopeInput,
    attempt_lease: renewedLease,
    predecessor_execution_envelope: executionEnvelope,
  }
  const successorEnvelope = buildReplayDecisionHarnessExecutionEnvelope(successorInput)
  expect(successorEnvelope.succession_kind).toBe("same_attempt_lease_generation_successor")
  expect(successorEnvelope.predecessor_execution_envelope_hash).toBe(executionEnvelope.envelope_hash)
  expect(successorEnvelope.logical_request_id).toBe(executionEnvelope.logical_request_id)
  expect(successorEnvelope.worker_request_hash).toBe(executionEnvelope.worker_request_hash)
  expect(successorEnvelope.lease_generation).toBe(3)
  expect(successorEnvelope.envelope_hash).not.toBe(executionEnvelope.envelope_hash)
  expect(() => assertReplayDecisionHarnessExecutionEnvelopeLineage(successorEnvelope, successorInput)).not.toThrow()
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    predecessor_execution_envelope: executionEnvelope,
  })).toThrow("generation or heartbeat did not advance")
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...successorInput,
    attempt_lease: { ...renewedLease, worker_id: "forged-worker" },
  })).toThrow("changed immutable authority")
  const retryLease: ReplayAttemptLeaseSnapshot = {
    ...attemptLease,
    attempt_id: "attempt-envelope-2",
    attempt_ordinal: 2,
    worker_id: "worker-authority-2",
    lease_generation: 1,
    claimed_at: "2026-07-14T00:10:00Z",
    heartbeat_at: "2026-07-14T00:10:30Z",
    lease_expires_at: "2026-07-14T00:15:00Z",
  }
  const retryEnvelope = buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    attempt_lease: retryLease,
  })
  expect(retryEnvelope.succession_kind).toBe("root_binding")
  expect(retryEnvelope.predecessor_execution_envelope_hash).toBeNull()
  expect(retryEnvelope.logical_request_id).toBe(executionEnvelope.logical_request_id)
  expect(retryEnvelope.attempt_id).not.toBe(executionEnvelope.attempt_id)
  expect(retryEnvelope.envelope_hash).not.toBe(executionEnvelope.envelope_hash)
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    attempt_lease: { ...attemptLease, request_hash: "b".repeat(64) },
  })).toThrow("does not match Replay authority")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope({
    ...executionEnvelope,
    process_id: 1234,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope({
    ...executionEnvelope,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Execution Envelope authority")

  const dispatchAdmissionInput = {
    source_execution_envelope: executionEnvelope,
    current_attempt_lease: attemptLease,
    observed_at: attemptLease.heartbeat_at,
  }
  const dispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission(dispatchAdmissionInput)
  expect(dispatchAdmission.owner).toBe("replay_runner_dispatch_admission")
  expect(dispatchAdmission.source_execution_envelope_hash).toBe(executionEnvelope.envelope_hash)
  expect(dispatchAdmission.current_attempt_lease_hash).toBe(executionEnvelope.attempt_lease_hash)
  expect(dispatchAdmission.freshness_window_policy).toBe("heartbeat_inclusive_lease_expiry_exclusive")
  expect(dispatchAdmission.current_lease_match_policy).toBe("exact_attempt_worker_generation_and_hash")
  expect(dispatchAdmission.freshness_outcome).toBe("fresh_at_control_plane_observed_at")
  expect(dispatchAdmission.dispatch_eligibility).toBe("lease_freshness_admitted_only")
  expect(dispatchAdmission.dispatch_occurrence).toBe("not_materialized")
  expect(dispatchAdmission.clock_evidence).toBe("control_plane_observation_not_external_time_attestation")
  expect(dispatchAdmission.process_instance_identity).toBe("not_materialized")
  expect(dispatchAdmission.transport_admission).toBe("not_granted")
  expect(dispatchAdmission.transport).toBe("forbidden")
  expect(dispatchAdmission.harness_invocation).toBe("forbidden")
  expect(dispatchAdmission.response_instance).toBeNull()
  expect(dispatchAdmission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission(dispatchAdmission)).not.toThrow()
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmissionLineage(
    dispatchAdmission,
    dispatchAdmissionInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: structuredClone(executionEnvelope),
    current_attempt_lease: structuredClone(attemptLease),
    observed_at: attemptLease.heartbeat_at,
  })).toEqual(dispatchAdmission)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    observed_at: "2026-07-14T00:00:29Z",
  })).toThrow("precedes fencing heartbeat")
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    observed_at: attemptLease.lease_expires_at,
  })).toThrow("expired at observed_at")
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    current_attempt_lease: renewedLease,
    observed_at: renewedLease.heartbeat_at,
  })).toThrow("current Lease generation and a successor Envelope")
  const successorDispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: successorEnvelope,
    current_attempt_lease: renewedLease,
    observed_at: renewedLease.heartbeat_at,
  })
  expect(successorDispatchAdmission.lease_generation).toBe(3)
  expect(successorDispatchAdmission.source_execution_envelope_hash).toBe(successorEnvelope.envelope_hash)
  expect(successorDispatchAdmission.admission_hash).not.toBe(dispatchAdmission.admission_hash)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: executionEnvelope,
    current_attempt_lease: retryLease,
    observed_at: retryLease.heartbeat_at,
  })).toThrow("current Attempt authority does not match Execution Envelope")
  const retryDispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: retryEnvelope,
    current_attempt_lease: retryLease,
    observed_at: retryLease.heartbeat_at,
  })
  expect(retryDispatchAdmission.attempt_id).toBe(retryLease.attempt_id)
  expect(retryDispatchAdmission.attempt_ordinal).toBe(2)
  expect(retryDispatchAdmission.retry_attempt_policy).toBe("new_root_envelope_required_before_readmission")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmission,
    process_id: 1234,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmission,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Dispatch Lease Admission authority")

  const leaseObservationBody = {
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
    observation_id: "lease-observation-envelope-1",
    observation_ref: "observation://replay-attempt-lease/envelope-1",
    observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
    status: "active_lease_observed" as const,
    observed_at: attemptLease.heartbeat_at,
    authority_owner: "research_control_plane" as const,
    authority_source: "research_control_plane_state_store" as const,
    read_consistency: "single_control_plane_transaction" as const,
    clock_evidence: "caller_supplied_utc_not_external_time_attestation" as const,
    trial_id: attemptLease.trial_id,
    run_id: attemptLease.run_id,
    attempt_id: attemptLease.attempt_id,
    attempt_ordinal: attemptLease.attempt_ordinal,
    worker_id: attemptLease.worker_id,
    lease_generation: attemptLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(attemptLease),
    attempt_lease: attemptLease,
  }
  const leaseObservation = createReplayAttemptLeaseObservationSnapshot(leaseObservationBody)
  const authorityBindingInput = {
    source_execution_envelope: executionEnvelope,
    control_plane_lease_observation: leaseObservation,
  }
  const dispatchAuthorityBinding = buildReplayDecisionHarnessDispatchLeaseAuthorityBinding(authorityBindingInput)
  expect(dispatchAuthorityBinding.authority_observation_status).toBe("control_plane_receipt_verified")
  expect(dispatchAuthorityBinding.control_plane_observation_hash).toBe(leaseObservation.observation_hash)
  expect(dispatchAuthorityBinding.source_dispatch_lease_admission_hash).toBe(dispatchAdmission.admission_hash)
  expect(dispatchAuthorityBinding.receipt_binding_policy)
    .toBe("exact_observation_time_lease_hash_attempt_worker_and_generation")
  expect(dispatchAuthorityBinding.dispatch_eligibility)
    .toBe("authority_receipt_and_lease_freshness_admitted_only")
  expect(dispatchAuthorityBinding.dispatch_occurrence).toBe("not_materialized")
  expect(dispatchAuthorityBinding.clock_evidence).toBe("caller_supplied_utc_not_external_time_attestation")
  expect(dispatchAuthorityBinding.transport_admission).toBe("not_granted")
  expect(dispatchAuthorityBinding.response_instance).toBeNull()
  expect(dispatchAuthorityBinding.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(dispatchAuthorityBinding)).not.toThrow()
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage(
    dispatchAuthorityBinding,
    authorityBindingInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: structuredClone(executionEnvelope),
    control_plane_lease_observation: structuredClone(leaseObservation),
  })).toEqual(dispatchAuthorityBinding)
  const dispatchEvidenceRegistryRoot = mkdtempSync(join(tmpdir(), "replay-dispatch-evidence-"))
  replayProfile("dispatch envelope and lease binding")
  try {
    expect(() => registerReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_binding: dispatchAuthorityBinding,
      registered_at: attemptLease.lease_expires_at,
    })).toThrow("must occur inside the observed Lease window")
    const dispatchEvidenceRegistration = registerReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_binding: dispatchAuthorityBinding,
      registered_at: "2026-07-14T00:00:31Z",
    })
    expect(dispatchEvidenceRegistration.source_authority_binding_hash)
      .toBe(dispatchAuthorityBinding.binding_hash)
    expect(dispatchEvidenceRegistration.evidence_status).toBe("durable_pre_dispatch_evidence_only")
    expect(dispatchEvidenceRegistration.dispatch_claim).toBeNull()
    expect(dispatchEvidenceRegistration.dispatch_eligibility)
      .toBe("requires_future_current_lease_revalidation_and_one_time_dispatch_claim")
    expect(dispatchEvidenceRegistration.dispatch_occurrence).toBe("not_materialized")
    expect(() => assertReplayDecisionHarnessDispatchEvidenceRegistration(
      dispatchEvidenceRegistration,
    )).not.toThrow()
    expect(registerReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_binding: structuredClone(dispatchAuthorityBinding),
      registered_at: "2026-07-14T00:00:32Z",
    })).toEqual(dispatchEvidenceRegistration)
    expect(readReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      attempt_id: dispatchEvidenceRegistration.attempt_id,
      lease_generation: dispatchEvidenceRegistration.lease_generation,
      logical_request_id: dispatchEvidenceRegistration.logical_request_id,
    })).toEqual(dispatchEvidenceRegistration)

    const missingTransportContractRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-transport-missing-"))
    try {
      expect(() => registerReplayWorkerV10TransportContract({
        registry_root: missingTransportContractRoot,
        source_worker_v10_build_capability: workerV10BuildCapability,
        source_execution_envelope: executionEnvelope,
      })).toThrow("requires the exact durable v10 Build Capability")
    } finally {
      rmSync(missingTransportContractRoot, { recursive: true, force: true })
    }
    const durableWorkerV10Capability = registerReplayWorkerV10BuildCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_code_admission: codeAdmission,
    })
    expect(durableWorkerV10Capability).toEqual(workerV10BuildCapability)
    const transportContractInput = {
      source_worker_v10_build_capability: durableWorkerV10Capability,
      source_execution_envelope: executionEnvelope,
    }
    replayProfile("durable build capability")
    const workerV10TransportContract = buildReplayDecisionHarnessWorkerV10TransportContract(
      transportContractInput,
    )
    expect(workerV10TransportContract.status).toBe("frozen_blocked_zero_instance")
    expect(workerV10TransportContract.logical_request_artifact_hash).toBe(buildAttestation.artifact.sha256)
    expect(workerV10TransportContract.logical_request_artifact_role)
      .toBe("legacy_v9_code_admission_anchor_not_transport_executable")
    expect(workerV10TransportContract.transport_process_artifact_hash)
      .toBe(workerV10BuildCapability.artifact.sha256)
    expect(workerV10TransportContract.transport_process_artifact_hash)
      .not.toBe(workerV10TransportContract.logical_request_artifact_hash)
    expect(workerV10TransportContract.transport_process_artifact_role)
      .toBe("r4_118_v10_decoder_module_candidate_not_stdio_process_artifact")
    expect(workerV10TransportContract.artifact_bridge_status).toBe("exact_migration_lineage_verified")
    expect(workerV10TransportContract.migration_scope).toBe("v1_bridge_not_long_term_artifact_taxonomy")
    expect(workerV10TransportContract.process_model)
      .toBe("fresh_single_request_process_no_pool_keepalive_or_multiplex")
    expect(workerV10TransportContract.process_lifecycle).toEqual([
      "spawn_exact_artifact",
      "write_one_request_frame",
      "close_stdin",
      "read_one_response_frame",
      "await_process_exit",
    ])
    expect(workerV10TransportContract.request_frame_encoding).toBe("canonical_json_utf8_lf_then_eof")
    expect(workerV10TransportContract.response_frame_encoding)
      .toBe("canonical_json_utf8_lf_then_process_exit")
    expect(workerV10TransportContract.frame_identity_policy)
      .toBe("logical_frame_excludes_process_identity_write_receipt_must_bind_process")
    expect(workerV10TransportContract.blockers).toEqual([
      "source_v10_capability_is_decoder_module_without_stdio_loop",
      "v10_stdio_process_artifact_not_materialized",
      "v10_process_instance_not_materialized",
      "target_worker_request_execution_admission_not_granted",
      "target_worker_request_transport_status_not_invoked",
      "transport_frame_instances_not_materialized",
    ])
    expect(workerV10TransportContract.r4_117_gate_relation)
      .toBe("successor_contract_does_not_rewrite_prior_blocked_gate")
    expect(workerV10TransportContract.stdio_process_artifact).toBe("not_materialized")
    expect(workerV10TransportContract.process_instance_count).toBe(0)
    expect(workerV10TransportContract.request_frame_instance_count).toBe(0)
    expect(workerV10TransportContract.request_write_receipt_count).toBe(0)
    expect(workerV10TransportContract.response_frame_instance_count).toBe(0)
    expect(workerV10TransportContract.response_read_receipt_count).toBe(0)
    expect(workerV10TransportContract.dispatch_occurrence).toBe("not_materialized")
    expect(workerV10TransportContract.harness_invocation).toBe("forbidden")
    expect(workerV10TransportContract.decision_output_authority).toBe("none")
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContract(
      workerV10TransportContract,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContractLineage(
      workerV10TransportContract,
      transportContractInput,
    )).not.toThrow()

    const requestFrameCandidate = createReplayDecisionHarnessWorkerV10RequestFrame({
      schema_version: workerV10TransportContract.request_frame_schema_version,
      frame_kind: "worker_request",
      worker_protocol_version: workerV10TransportContract.worker_protocol_version,
      transport_contract_id: workerV10TransportContract.contract_id,
      transport_contract_hash: workerV10TransportContract.contract_hash,
      execution_envelope_hash: workerV10TransportContract.source_execution_envelope_hash,
      process_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
      logical_request_id: firstRequestV10.logical_request_id,
      worker_request_hash: firstRequestV10.request_hash,
      worker_request: structuredClone(firstRequestV10),
      authority_status: "unadmitted_transport_candidate",
    })
    expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
      requestFrameCandidate,
      workerV10TransportContract,
    )).not.toThrow()
    expect(Buffer.byteLength(`${canonicalJson(requestFrameCandidate)}\n`, "utf8"))
      .toBeLessThanOrEqual(workerV10TransportContract.max_request_frame_bytes)
    const { frame_hash: requestFrameHash, ...requestFrameBody } = requestFrameCandidate
    expect(requestFrameHash).toHaveLength(64)
    const wrongArtifactRequestFrame = createReplayDecisionHarnessWorkerV10RequestFrame({
      ...requestFrameBody,
      process_artifact_hash: buildAttestation.artifact.sha256,
    })
    expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
      wrongArtifactRequestFrame,
      workerV10TransportContract,
    )).toThrow("Transport Contract binding drift")

    const responseFrameCandidate = createReplayDecisionHarnessWorkerV10ResponseFrame({
      schema_version: workerV10TransportContract.response_frame_schema_version,
      frame_kind: "worker_response",
      worker_protocol_version: workerV10TransportContract.worker_protocol_version,
      transport_contract_id: workerV10TransportContract.contract_id,
      transport_contract_hash: workerV10TransportContract.contract_hash,
      execution_envelope_hash: workerV10TransportContract.source_execution_envelope_hash,
      process_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
      logical_request_id: responseV10.logical_request_id,
      worker_request_hash: responseV10.request_hash,
      worker_response_hash: responseV10.response_hash,
      worker_response: structuredClone(responseV10),
      authority_status: "unadmitted_transport_candidate",
    })
    expect(() => assertReplayDecisionHarnessWorkerV10ResponseFrame(
      responseFrameCandidate,
      workerV10TransportContract,
    )).not.toThrow()
    expect(Buffer.byteLength(`${canonicalJson(responseFrameCandidate)}\n`, "utf8"))
      .toBeLessThanOrEqual(workerV10TransportContract.max_response_frame_bytes)
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContract({
      ...workerV10TransportContract,
      logical_request_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
    })).toThrow("parent or artifact bridge drift")
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContract({
      ...workerV10TransportContract,
      request_frame_instance_count: 1 as never,
    })).toThrow("unsupported decision harness Worker v10 Transport Contract authority")

    const registeredTransportContract = registerReplayWorkerV10TransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...transportContractInput,
    })
    expect(registeredTransportContract).toEqual(workerV10TransportContract)
    expect(registerReplayWorkerV10TransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_worker_v10_build_capability: structuredClone(durableWorkerV10Capability),
      source_execution_envelope: structuredClone(executionEnvelope),
    })).toEqual(workerV10TransportContract)
    expect(readReplayWorkerV10TransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...transportContractInput,
    })).toEqual(workerV10TransportContract)

    const missingStdioCapabilityRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-stdio-missing-"))
    try {
      expect(() => registerReplayWorkerV10StdioCapability({
        registry_root: missingStdioCapabilityRoot,
        source_transport_contract: workerV10TransportContract,
      })).toThrow("requires the exact durable Transport Contract")
    } finally {
      rmSync(missingStdioCapabilityRoot, { recursive: true, force: true })
    }
    const workerV10StdioCapability = buildReplayDecisionHarnessWorkerV10StdioCapability({
      source_transport_contract: registeredTransportContract,
    })
    replayProfile("stdio capability")
    expect(workerV10StdioCapability.status)
      .toBe("stdio_process_capability_available_transport_activation_not_granted")
    expect(workerV10StdioCapability.source_decoder_artifact_hash)
      .toBe(workerV10BuildCapability.artifact.sha256)
    expect(workerV10StdioCapability.artifact.sha256)
      .not.toBe(workerV10StdioCapability.source_decoder_artifact_hash)
    expect(workerV10StdioCapability.artifact.sha256)
      .not.toBe(workerV10StdioCapability.source_legacy_v9_artifact_hash)
    expect(workerV10StdioCapability.r4_119_binding_relation)
      .toBe("successor_artifact_requires_new_transport_contract_no_retroactive_rewrite")
    expect(workerV10StdioCapability.valid_frame_policy)
      .toBe("reject_before_decode_until_successor_transport_activation")
    expect(workerV10StdioCapability.process_instance_count).toBe(0)
    expect(workerV10StdioCapability.worker_request_frame_instance_count).toBe(0)
    expect(workerV10StdioCapability.worker_request_decode_occurrence).toBe("not_materialized")
    expect(workerV10StdioCapability.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10StdioCapability(
      workerV10StdioCapability,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10StdioCapabilityLineage(
      workerV10StdioCapability,
      { source_transport_contract: registeredTransportContract },
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10StdioCapability({
      ...workerV10StdioCapability,
      source_decoder_artifact_hash: workerV10StdioCapability.artifact.sha256,
    })).toThrow("parent or artifact binding drift")
    const successorArtifactFrame = createReplayDecisionHarnessWorkerV10RequestFrame({
      ...requestFrameBody,
      process_artifact_hash: workerV10StdioCapability.artifact.sha256,
    })
    expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
      successorArtifactFrame,
      workerV10TransportContract,
    )).toThrow("Transport Contract binding drift")

    const durableStdioCapability = registerReplayWorkerV10StdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_transport_contract: registeredTransportContract,
    })
    expect(durableStdioCapability).toEqual(workerV10StdioCapability)
    expect(registerReplayWorkerV10StdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_transport_contract: structuredClone(registeredTransportContract),
    })).toEqual(workerV10StdioCapability)
    expect(readReplayWorkerV10StdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_transport_contract: registeredTransportContract,
    })).toEqual(workerV10StdioCapability)

    const negativeProbeReceipt = runReplayWorkerV10NegativeProbeSuite({
      registry_root: dispatchEvidenceRegistryRoot,
      source_stdio_capability: durableStdioCapability,
      clock: { now: () => "2026-07-14T00:00:33Z" },
    })
    expect(negativeProbeReceipt.status).toBe("complete_expected_pre_decode_rejections")
    expect(negativeProbeReceipt.probe_order).toEqual([
      "empty_eof",
      "invalid_json_lf",
      "missing_lf",
      "multiple_frames",
      "oversized_input",
    ])
    expect(negativeProbeReceipt.probe_results.map((item) => item.exit_status))
      .toEqual([64, 65, 67, 68, 66])
    expect(negativeProbeReceipt.process_instance_count).toBe(5)
    expect(negativeProbeReceipt.worker_request_frame_instance_count).toBe(0)
    expect(negativeProbeReceipt.worker_request_write_receipt_count).toBe(0)
    expect(negativeProbeReceipt.worker_request_decode_occurrence).toBe("not_materialized")
    expect(negativeProbeReceipt.dispatch_occurrence)
      .toBe("not_materialized_only_non_frame_probe_bytes")
    expect(negativeProbeReceipt.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(
      negativeProbeReceipt,
    )).not.toThrow()
    expect(runReplayWorkerV10NegativeProbeSuite({
      registry_root: dispatchEvidenceRegistryRoot,
      source_stdio_capability: durableStdioCapability,
      clock: { now: () => "2026-07-14T00:00:34Z" },
    })).toEqual(negativeProbeReceipt)
    expect(readReplayWorkerV10NegativeProbeReceipt({
      registry_root: dispatchEvidenceRegistryRoot,
      source_stdio_capability: durableStdioCapability,
    })).toEqual(negativeProbeReceipt)

    const missingSuccessorTransportRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-successor-missing-"))
    try {
      expect(() => registerReplayWorkerV10SuccessorTransportContract({
        registry_root: missingSuccessorTransportRoot,
        source_negative_probe_receipt: negativeProbeReceipt,
      })).toThrow()
    } finally {
      rmSync(missingSuccessorTransportRoot, { recursive: true, force: true })
    }
    const successorTransportInput = { source_negative_probe_receipt: negativeProbeReceipt }
    const successorTransportContract = buildReplayDecisionHarnessWorkerV10SuccessorTransportContract(
      successorTransportInput,
    )
    replayProfile("successor transport")
    expect(successorTransportContract.status).toBe("artifact_bound_activation_blocked_zero_instance")
    expect(successorTransportContract.logical_request_artifact_hash).toBe(buildAttestation.artifact.sha256)
    expect(successorTransportContract.predecessor_decoder_artifact_hash)
      .toBe(workerV10BuildCapability.artifact.sha256)
    expect(successorTransportContract.successor_process_artifact_hash)
      .toBe(workerV10StdioCapability.artifact.sha256)
    expect(successorTransportContract.artifact_binding_status)
      .toBe("successor_stdio_process_artifact_bound")
    expect(successorTransportContract.predecessor_contract_relation)
      .toBe("r4_119_immutable_not_rewritten")
    expect(successorTransportContract.target_request_execution_admission).toBe("not_granted")
    expect(successorTransportContract.target_request_transport_status).toBe("not_invoked")
    expect(successorTransportContract.immutable_request_policy)
      .toBe("request_v10_markers_cannot_be_mutated_by_transport_contract")
    expect(successorTransportContract.blockers).toEqual([
      "target_worker_request_execution_admission_not_granted",
      "target_worker_request_transport_status_not_invoked",
      "current_lease_revalidation_for_successor_process_not_materialized",
      "attempt_bound_stdio_process_launch_intent_not_materialized",
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_instance_not_materialized",
      "worker_request_write_receipt_not_materialized",
      "worker_request_decode_receipt_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(successorTransportContract.source_negative_probe_process_instance_count).toBe(5)
    expect(successorTransportContract.source_negative_probe_worker_request_frame_count).toBe(0)
    expect(successorTransportContract.admitted_process_instance_count).toBe(0)
    expect(successorTransportContract.current_lease_revalidation_receipt).toBeNull()
    expect(successorTransportContract.attempt_bound_process_launch_intent).toBeNull()
    expect(successorTransportContract.attempt_bound_process_receipt).toBeNull()
    expect(successorTransportContract.request_frame_instance_count).toBe(0)
    expect(successorTransportContract.request_write_receipt_count).toBe(0)
    expect(successorTransportContract.request_decode_receipt_count).toBe(0)
    expect(successorTransportContract.response_frame_instance_count).toBe(0)
    expect(successorTransportContract.response_read_receipt_count).toBe(0)
    expect(successorTransportContract.dispatch_occurrence).toBe("not_materialized")
    expect(successorTransportContract.transport_activation).toBe("blocked")
    expect(successorTransportContract.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(
      successorTransportContract,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContractLineage(
      successorTransportContract,
      successorTransportInput,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract({
      ...successorTransportContract,
      successor_process_artifact_hash: successorTransportContract.predecessor_decoder_artifact_hash,
    })).toThrow("parent or artifact binding drift")
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract({
      ...successorTransportContract,
      request_frame_instance_count: 1 as never,
    })).toThrow("unsupported decision harness Worker v10 successor Transport Contract authority")

    const registeredSuccessorTransport = registerReplayWorkerV10SuccessorTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_negative_probe_receipt: negativeProbeReceipt,
    })
    expect(registeredSuccessorTransport).toEqual(successorTransportContract)
    expect(registerReplayWorkerV10SuccessorTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_negative_probe_receipt: structuredClone(negativeProbeReceipt),
    })).toEqual(successorTransportContract)
    expect(readReplayWorkerV10SuccessorTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_negative_probe_receipt: negativeProbeReceipt,
    })).toEqual(successorTransportContract)

    const executionClaimStage = runReplayWorkerV10ExecutionClaimStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_transport_contract: successorTransportContract,
      lease_observation_body: leaseObservationBody,
      lease_observation: leaseObservation,
      dispatch_evidence_registration: dispatchEvidenceRegistration,
      attempt_lease: attemptLease,
      renewed_lease: renewedLease,
      profile: replayProfile,
    })
    const executionAdmissionContract = executionClaimStage.execution_admission_contract
    const claimObservation = executionClaimStage.claim_observation
    const claimRenewedObservation = executionClaimStage.renewed_claim_observation
    const dispatchClaim = executionClaimStage.dispatch_claim
    const predecessorAdmissionEvidenceStage =
      runReplayWorkerV10PredecessorAdmissionEvidenceStage({
        registry_root: dispatchEvidenceRegistryRoot,
        execution_admission_contract: executionAdmissionContract,
        dispatch_claim: dispatchClaim,
        lease_observation_body: leaseObservationBody,
        claim_observation: claimObservation,
        renewed_claim_observation: claimRenewedObservation,
        successor_transport_contract: successorTransportContract,
        profile: replayProfile,
      })
    const preIssueObservation = predecessorAdmissionEvidenceStage.pre_issue_observation
    const preIssueInput = predecessorAdmissionEvidenceStage.pre_issue_input
    const registryReadReceipt = predecessorAdmissionEvidenceStage.registry_read_receipt
    const registryProvenanceInput =
      predecessorAdmissionEvidenceStage.registry_provenance_input
    const registryProvenance = predecessorAdmissionEvidenceStage.registry_provenance
    const clockAttestation = predecessorAdmissionEvidenceStage.clock_attestation
    const clockBindingInput = predecessorAdmissionEvidenceStage.clock_binding_input
    const clockBinding = predecessorAdmissionEvidenceStage.clock_binding
    const predecessorLaunchStage = runReplayWorkerV10PredecessorLaunchStage({
      registry_root: dispatchEvidenceRegistryRoot,
      clock_binding: clockBinding,
      dispatch_claim: dispatchClaim,
      pre_issue_observation: preIssueObservation,
      registry_read_receipt: registryReadReceipt,
      clock_attestation: clockAttestation,
      attempt_lease: attemptLease,
      lease_observation_body: leaseObservationBody,
      profile: replayProfile,
    })
    const commandInput = predecessorLaunchStage.command_input
    const executionAdmissionCommand = predecessorLaunchStage.execution_command
    const postCommandObservation = predecessorLaunchStage.post_command_observation
    const postCommandReadAt = predecessorLaunchStage.post_command_read_at
    const postCommandRegistryReceipt = predecessorLaunchStage.post_command_registry_receipt
    const postCommandClockAttestation = predecessorLaunchStage.post_command_clock_attestation
    const processIntentInput = predecessorLaunchStage.process_intent_input
    const processLaunchIntent = predecessorLaunchStage.process_launch_intent
    const processReadinessInput = predecessorLaunchStage.process_readiness_input
    const processLaunchReadiness = predecessorLaunchStage.process_launch_readiness

    const authorityTransportStage = runReplayWorkerV10AuthorityTransportStage({
      registry_root: dispatchEvidenceRegistryRoot,
      process_launch_readiness: processLaunchReadiness,
      first_worker_request: firstRequestV10,
      execution_envelope: executionEnvelope,
      first_worker_response: responseV10,
      predecessor_successor_transport_contract: successorTransportContract,
      profile: replayProfile,
    })
    const authorityBuildInput = authorityTransportStage.frame_build_input
    const authorityFrameBuild = authorityTransportStage.frame_build
    const activatedStdioInput = authorityTransportStage.activated_stdio_input
    const activatedStdio = authorityTransportStage.activated_stdio
    const authorityTransportInput = authorityTransportStage.transport_input
    const authorityTransport = authorityTransportStage.transport

    const authorityAdmissionStage = runReplayWorkerV10AuthorityAdmissionStage({
      registry_root: dispatchEvidenceRegistryRoot,
      post_command_observation: postCommandObservation,
      authority_transport: authorityTransport,
      activated_stdio: activatedStdio,
      predecessor_execution_command: executionAdmissionCommand,
      predecessor_process_launch_intent: processLaunchIntent,
      post_command_clock_attestation: postCommandClockAttestation,
      predecessor_successor_transport_contract: successorTransportContract,
      lease_observation_body: leaseObservationBody,
    })
    const authorityCommandInput = authorityAdmissionStage.command_input
    const authorityCommand = authorityAdmissionStage.command
    const authorityIntentInput = authorityAdmissionStage.intent_input
    const authorityIntent = authorityAdmissionStage.intent
    const authorityIntentRegistryReceipt = authorityAdmissionStage.intent_registry_receipt
    const authorityCapsuleInput = authorityAdmissionStage.capsule_input
    const authorityCapsule = authorityAdmissionStage.capsule

    const authoritySpawnStage = runReplayWorkerV10AuthoritySpawnStage({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_capsule: authorityCapsule,
      intent_registry_receipt: authorityIntentRegistryReceipt,
      profile: replayProfile,
    })
    const spawnRevalidationRequestInput = authoritySpawnStage.request_input
    const spawnRevalidationRequest = authoritySpawnStage.request
    const spawnRevalidationInput = authoritySpawnStage.revalidation_input
    const spawnRevalidation = authoritySpawnStage.revalidation

    const authorityProcessStage = await runReplayWorkerV10AuthorityProcessStage({
      registry_root: dispatchEvidenceRegistryRoot,
      spawn_revalidation: spawnRevalidation,
      authority_capsule: authorityCapsule,
      activated_stdio: activatedStdio,
      authority_transport: authorityTransport,
      authority_command: authorityCommand,
      authority_intent: authorityIntent,
      profile: replayProfile,
    })
    const authorityProcessReceipt = authorityProcessStage.process_receipt
    const authorityDispatchReceipt = authorityProcessStage.dispatch_receipt
    const authorityDispatchAttempt = authorityProcessStage.dispatch_attempt

    const authorityResponseStage = runReplayWorkerV10AuthorityResponseStage({
      registry_root: dispatchEvidenceRegistryRoot,
      dispatch_receipt: authorityDispatchReceipt,
      dispatch_attempt: authorityDispatchAttempt,
      process_receipt: authorityProcessReceipt,
      replay_execution_request: requestValue,
      profile: replayProfile,
    })
    const authorityResponseValidation = authorityResponseStage.response_validation
    const authorityScheduleAdmission = authorityResponseStage.schedule_admission
    const reproducibilityPairContract =
      authorityResponseStage.reproducibility_pair_contract

    const successorLeaseStage = runReplayWorkerV10SuccessorLeaseStage({
      registry_root: dispatchEvidenceRegistryRoot,
      reproducibility_pair_contract: reproducibilityPairContract,
      first_execution_envelope: executionEnvelope,
      first_schedule_admission: authorityScheduleAdmission,
      first_worker_request: firstRequestV10,
      replay_execution_request_hash: authorityBinding.request_hash,
      predecessor_attempt_lease: attemptLease,
      profile: replayProfile,
    })
    const successorAuthorityContract = successorLeaseStage.authority_contract
    const requestedSuccessorLeaseExpiry = successorLeaseStage.requested_lease_expiry
    const successorLeaseResult = successorLeaseStage.result
    const successorLeaseAdmission = successorLeaseStage.admission

    const successorExecutionStage = runReplayWorkerV10SuccessorExecutionStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_lease_admission: successorLeaseAdmission,
      predecessor_execution_envelope: executionEnvelope,
      comparison_successor_envelope: successorEnvelope,
      predecessor_lease_generation: attemptLease.lease_generation,
      durable_worker_capability: durableWorkerV10Capability,
      predecessor_transport_contract: workerV10TransportContract,
      predecessor_stdio_capability: durableStdioCapability,
      predecessor_negative_probe_receipt: negativeProbeReceipt,
      predecessor_successor_transport_contract: successorTransportContract,
      predecessor_execution_admission_contract: executionAdmissionContract,
      profile: replayProfile,
    })
    const successorEnvelopeAdmission = successorExecutionStage.envelope_admission
    const successorTransportAdmission = successorExecutionStage.transport_admission
    const successorStdioProbeAdmission = successorExecutionStage.stdio_probe_admission
    const successorExecutionContractAdmission =
      successorExecutionStage.execution_contract_admission

    const successorCommandStage = runReplayWorkerV10SuccessorCommandStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_execution_contract_admission: successorExecutionContractAdmission,
      successor_lease_admission: successorLeaseAdmission,
      predecessor_lease_generation: attemptLease.lease_generation,
      predecessor_execution_admission_command_hash: executionAdmissionCommand.command_hash,
      requested_successor_lease_expiry: requestedSuccessorLeaseExpiry,
      profile: replayProfile,
    })
    const successorCommandAdmission = successorCommandStage.command_admission
    const successorExecutionCommand = successorCommandStage.execution_command

    const successorIntentStage = runReplayWorkerV10SuccessorIntentStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_command_admission: successorCommandAdmission,
      successor_execution_contract_admission: successorExecutionContractAdmission,
      successor_stdio_probe_admission: successorStdioProbeAdmission,
      command_observation: successorCommandStage.command_observation,
      requested_successor_lease_expiry: requestedSuccessorLeaseExpiry,
      profile: replayProfile,
    })
    const successorProcessLaunchIntent = successorIntentStage.process_launch_intent

    const successorCapsuleStage = runReplayWorkerV10SuccessorCapsuleStage({
      registry_root: dispatchEvidenceRegistryRoot,
      process_launch_intent: successorProcessLaunchIntent,
      execution_command: successorExecutionCommand,
      execution_contract_admission: successorExecutionContractAdmission,
      profile: replayProfile,
    })
    const successorAuthorityCapsule = successorCapsuleStage.authority_capsule
    const successorCapsuleFile = successorCapsuleStage.capsule_file
    const successorIntentFile = successorCapsuleStage.intent_file

    const successorSpawnStage = runReplayWorkerV10SuccessorSpawnStage({
      registry_root: dispatchEvidenceRegistryRoot,
      capsule_file: successorCapsuleFile,
      intent_file: successorIntentFile,
      authority_capsule: successorAuthorityCapsule,
      process_launch_intent: successorProcessLaunchIntent,
      successor_lease_admission: successorLeaseAdmission,
      profile: replayProfile,
    })
    const successorSpawnResult = successorSpawnStage.result
    const buildSuccessorSpawnReceipt = successorSpawnStage.build_receipt
    const successorSpawnRevalidation = successorSpawnResult.spawn_boundary_revalidation
    let cutoverRevalidationCalls = 0
    const cutoverInput = {
      registry_root: dispatchEvidenceRegistryRoot,
      source_pair_contract: reproducibilityPairContract,
      source_successor_spawn_revalidation: successorSpawnRevalidation,
      source_successor_authority_capsule: successorAuthorityCapsule,
      source_successor_process_launch_intent: successorProcessLaunchIntent,
      source_successor_stdio_probe_admission: successorStdioProbeAdmission,
      authority_port: {
        revalidate: (request: ReplaySpawnBoundaryRevalidationRequest) => {
          cutoverRevalidationCalls += 1
          return buildSuccessorSpawnReceipt(
            request, "2026-07-14T00:04:10Z", "2026-07-14T00:04:11Z", "12000000", "12000100",
          )
        },
      },
    }
    const cutover = executeReplayWorkerV10Cutover(cutoverInput)
    replayProfile("worker cutover")
    expectWorkerV10Cutover({
      outcome: cutover,
      revalidation_calls: cutoverRevalidationCalls,
    })
    expect(readReplayWorkerV10CutoverReceipt(cutoverInput)).toEqual(cutover.receipt)
    const cutoverRetry = executeReplayWorkerV10Cutover(cutoverInput)
    expect(cutoverRetry.disposition).toBe("existing_cutover_receipt")
    expect(cutoverRetry.receipt).toEqual(cutover.receipt)
    expect(cutoverRevalidationCalls).toBe(1)
    const cutoverWorkerRequest = cutover.receipt.second_request_frame.worker_request
    const formalCutoverAdmission = executeReplayDecisionHarness({
      registry: createReplayDecisionHarnessCutoverRegistry([{
        source_bundle: sourceBundle,
        build_attestation: buildAttestation,
      }], [cutover.receipt]),
      request: requestValue,
      schedule_entry: requestValue.decision_schedule.entries[0]!,
      decision_input_snapshot: cutoverWorkerRequest.decision_input_snapshot,
      decision_market_input_snapshot: cutoverWorkerRequest.decision_market_input_snapshot,
      decision_state_snapshot: cutoverWorkerRequest.decision_state_snapshot,
    })
    replayProfile("formal cutover admission")
    expectFormalCutoverAdmission({
      receipt: formalCutoverAdmission.receipt,
      cutover: cutover.receipt,
    })
    const resultArtifactRoot = mkdtempSync(join(tmpdir(), "rd-replay-r4-152-result-golden-"))
    try {
      const cutoverRegistry = createReplayDecisionHarnessCutoverRegistry([{
        source_bundle: sourceBundle,
        build_attestation: buildAttestation,
      }], [cutover.receipt])
      const completedTrial = runReplayTrial({
        request: requestValue,
        trial_reservation: trialReservation,
        attempt_lease: successorLeaseAdmission.successor_attempt_lease,
        observed_at: "2026-07-14T00:04:12Z",
        dataset_manifest: goldenReplayDatasetManifest(),
        bars: GOLDEN_REPLAY_BARS,
        decision_harness_registry: cutoverRegistry,
        artifact_root: resultArtifactRoot,
      })
      expect(completedTrial.status).toBe("completed")
      expect(completedTrial.result?.status).toBe("completed")
      const initialDecisionEvidence = completedTrial.result?.decision_evidence_timeline.entries[0]
      expect(initialDecisionEvidence?.decision_harness_receipt?.receipt_hash)
        .toBe(cutover.receipt.receipt_hash)
      expect(initialDecisionEvidence?.decision_harness_receipt?.worker_protocol_version)
        .toBe("rd-replay-harness-worker-stdio-v10")
      expect(completedTrial.result?.fingerprint.decision_harness_receipt_hash)
        .toBe(cutover.receipt.receipt_hash)
      expect(completedTrial.result?.fingerprint.decision_harness_worker_protocol_version)
        .toBe("rd-replay-harness-worker-stdio-v10")
      expect(completedTrial.result?.fingerprint.dataset_hash).toBe(GOLDEN_REPLAY_DATASET_HASH)
      expect(completedTrial.result?.fingerprint.trial_reservation_hash)
        .toBe(hashTrialReservationSnapshot(trialReservation))
      expect(completedTrial.artifact_manifest?.result_hash)
        .toBe(completedTrial.result?.fingerprint.result_hash)
      expect(completedTrial.artifact_manifest?.files.some(
        (file) => file.role === "decision_evidence_timeline",
      )).toBe(true)
      expect(completedTrial.artifact_manifest?.completeness.authoritative_result).toBe(true)
      const idempotentTrial = runReplayTrial({
        request: requestValue,
        trial_reservation: trialReservation,
        attempt_lease: successorLeaseAdmission.successor_attempt_lease,
        observed_at: "2026-07-14T00:04:12Z",
        dataset_manifest: goldenReplayDatasetManifest(),
        bars: GOLDEN_REPLAY_BARS,
        decision_harness_registry: cutoverRegistry,
        artifact_root: resultArtifactRoot,
      })
      expect(idempotentTrial.status).toBe("completed")
      expect(idempotentTrial.idempotent_replay).toBe(true)
      expect(idempotentTrial.artifact_manifest).toEqual(completedTrial.artifact_manifest)
    } finally {
      rmSync(resultArtifactRoot, { recursive: true, force: true })
    }
    expect(admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
      registry_root: dispatchEvidenceRegistryRoot,
      source_successor_authority_capsule: structuredClone(successorAuthorityCapsule),
      source_successor_process_launch_intent: structuredClone(successorProcessLaunchIntent),
      authority_port: {
        revalidate: () => {
          successorSpawnStage.record_authority_port_call()
          throw new Error("durable successor revalidation retry must not call Control Plane")
        },
      },
    })).toEqual(successorSpawnResult)
    expect(successorSpawnStage.authority_port_call_count()).toBe(1)
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation({
      ...successorSpawnRevalidation,
      successor_worker_process_count: 1 as never,
    })).toThrow()

    runReplayWorkerV10SuccessorIntegrityStage({
      registry_root: dispatchEvidenceRegistryRoot,
      command_stage: successorCommandStage,
      intent_stage: successorIntentStage,
      capsule_stage: successorCapsuleStage,
      spawn_stage: successorSpawnStage,
      execution_contract_admission: successorExecutionContractAdmission,
      stdio_probe_admission: successorStdioProbeAdmission,
      transport_admission: successorTransportAdmission,
      envelope_admission: successorEnvelopeAdmission,
      lease_admission: successorLeaseAdmission,
      authority_contract: successorAuthorityContract,
      renewal_request: successorLeaseResult.renewal_request,
      reproducibility_pair_contract: reproducibilityPairContract,
      authority_schedule_admission: authorityScheduleAdmission,
      authority_response_validation: authorityResponseValidation,
      replay_execution_request: requestValue,
    })

    runReplayWorkerV10UpstreamIntegrityStage({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_response_validation: authorityResponseValidation,
      authority_dispatch_receipt: authorityDispatchReceipt,
      authority_process_receipt: authorityProcessReceipt,
      spawn_revalidation: spawnRevalidation,
      spawn_revalidation_input: spawnRevalidationInput,
      spawn_revalidation_request: spawnRevalidationRequest,
      spawn_revalidation_request_input: spawnRevalidationRequestInput,
      authority_capsule: authorityCapsule,
      authority_capsule_input: authorityCapsuleInput,
      authority_intent: authorityIntent,
      authority_intent_input: authorityIntentInput,
      authority_command: authorityCommand,
      authority_command_input: authorityCommandInput,
      authority_transport: authorityTransport,
      authority_transport_input: authorityTransportInput,
      activated_stdio: activatedStdio,
      activated_stdio_input: activatedStdioInput,
      authority_frame_build: authorityFrameBuild,
      authority_build_input: authorityBuildInput,
      process_launch_readiness: processLaunchReadiness,
      process_readiness_input: processReadinessInput,
      post_command_registry_receipt: postCommandRegistryReceipt,
      post_command_read_at: postCommandReadAt,
      post_command_clock_attestation: postCommandClockAttestation,
      execution_admission_command: executionAdmissionCommand,
      process_launch_intent: processLaunchIntent,
      process_intent_input: processIntentInput,
      registry_read_receipt: registryReadReceipt,
      clock_attestation: clockAttestation,
      registry_provenance: registryProvenance,
      clock_binding: clockBinding,
      command_input: commandInput,
      clock_binding_input: clockBindingInput,
      registry_provenance_input: registryProvenanceInput,
      pre_issue_input: preIssueInput,
      execution_admission_contract: executionAdmissionContract,
      successor_transport_contract: successorTransportContract,
      negative_probe_receipt: negativeProbeReceipt,
      durable_stdio_capability: durableStdioCapability,
      worker_v10_transport_contract: workerV10TransportContract,
      transport_contract_input: transportContractInput,
    })

    runReplayWorkerV10LegacyActivationStage({
      registry_root: dispatchEvidenceRegistryRoot,
      lease_observation_body: leaseObservationBody,
      execution_envelope: executionEnvelope,
      dispatch_claim: dispatchClaim,
      claim_observation: claimObservation,
      claim_renewed_observation: claimRenewedObservation,
      attempt_lease: attemptLease,
      dispatch_evidence_registration: dispatchEvidenceRegistration,
      profile: replayProfile,
    })
  } finally {
    rmSync(dispatchEvidenceRegistryRoot, { recursive: true, force: true })
  }
  const renewedObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-2",
    observation_ref: "observation://replay-attempt-lease/envelope-2",
    observed_at: renewedLease.heartbeat_at,
    lease_generation: renewedLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(renewedLease),
    attempt_lease: renewedLease,
  })
  expect(() => buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: executionEnvelope,
    control_plane_lease_observation: renewedObservation,
  })).toThrow("current Lease generation and a successor Envelope")
  const successorAuthorityBinding = buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: successorEnvelope,
    control_plane_lease_observation: renewedObservation,
  })
  expect(successorAuthorityBinding.source_dispatch_lease_admission.lease_generation).toBe(3)
  expect(successorAuthorityBinding.binding_hash).not.toBe(dispatchAuthorityBinding.binding_hash)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...authorityBindingInput,
    control_plane_lease_observation: {
      ...leaseObservation,
      observation_hash: "b".repeat(64),
    },
  })).toThrow("observation hash mismatch")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...dispatchAuthorityBinding,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Dispatch Lease Authority Binding authority")

  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: sourceEvents.slice(1),
  })).toThrow("source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: [...sourceEvents, {
      source_event_id: "source:bar_open:3", kind: "bar_open", source_index: 2,
      event_key: {
        event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
        source_sequence: 3, event_subphase: 0, stable_event_id: "source:bar_open:3",
      },
    }],
  })).toThrow("exact complete source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    harness_context_binding: contextBinding(request("b".repeat(64))),
  })).toThrow("Request/Context binding drift")
  const mismatchedRequest = request("b".repeat(64))
  const mismatchedState = buildReplayPositionOpenStateInputMaterialization({
    request: mismatchedRequest,
    harness_context_binding: contextBinding(mismatchedRequest),
    decision_state_snapshot: snapshot,
    source_events: sourceEvents,
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3Input,
    state_input_materializations: [mismatchedState],
  })).toThrow("R4.102 parent binding drift")
  expect(() => assertReplayPositionOpenStateInputMaterialization({
    ...materialization,
    worker_request_materialization: "allowed" as never,
  })).toThrow("unsupported position-open State input materialization authority")
  const { snapshot_hash: _snapshotHash, ...snapshotBody } = snapshot
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, {
    ...input,
    decision_state_snapshot: createReplayDecisionStateSnapshot({
      ...snapshotBody,
      cash_balance: 999.8,
    }),
  })).toThrow("parent lineage drift")
}, 600_000)
