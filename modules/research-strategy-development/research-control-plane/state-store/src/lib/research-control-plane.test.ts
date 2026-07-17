import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  AGGREGATE_TRADE_PROVIDER_BUILD_HASH,
  AGGREGATE_TRADE_PROVIDER_CAPABILITY,
  AGGREGATE_TRADE_PROVIDER_POLICY_HASH,
} from "../../../../../market-data-products/aggregate-trade-provider/src/lib/aggregate-trade-provider"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_SCHEMA_VERSION,
  createReplaySourceEventDecisionObservationBundle,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation-bundle"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_BOUNDARY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_SCHEMA_VERSION,
  createReplaySourceEventDecisionObservationBundleDerivationAttestation,
  createReplaySourceEventDecisionObservationBundleDerivationBoundary,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation-bundle-derivation"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_PROJECTION_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_RECORD_SCHEMA_VERSION,
  createReplaySourceEventDecisionObservationProjection,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation"
import {
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SCHEMA_VERSION,
  createReplaySourceEventDecisionScheduleObservationBinding,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-schedule-observation-binding"
import {
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_SCHEMA_VERSION,
  createReplaySourceEventDecisionScheduleObservationBindingSet,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-schedule-observation-binding-set"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  createReplayInstrumentStatusProvenance,
  createReplaySingleDecisionSchedule,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import type { ReplaySourceEventWireManifest } from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-wire"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplaySourceEventDecisionObservationInputMaterialization,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation-input-materialization"
import {
  assertReplayDecisionWorkerInputAssembly,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-decision-worker-input-assembly"
import {
  assertReplayDecisionMarketInputMaterialization,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-decision-market-input-materialization"
import {
  buildReplayCrossSourceOrderingAttestation,
} from "../../../../replay-execution-plane/data-adapter/src/lib/replay-cross-source-ordering"
import { buildReplaySourceEventProjectionAttestation } from "../../../../replay-execution-plane/data-adapter/src/lib/replay-source-event-projection"
import { materializeReplaySourceEventWire } from "../../../../replay-execution-plane/data-adapter/src/lib/replay-source-event-wire"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBindingLineage,
  buildReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../../replay-execution-plane/data-adapter/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplaySourceEventDecisionObservationInputMaterializationLineage,
  buildReplaySourceEventDecisionObservationInputMaterialization,
} from "../../../../replay-execution-plane/data-adapter/src/lib/replay-source-event-decision-observation-input-materialization"
import {
  assertReplayDecisionWorkerInputAssemblyLineage,
  buildReplayDecisionWorkerInputAssembly,
} from "../../../../replay-execution-plane/data-adapter/src/lib/replay-decision-worker-input-assembly"
import {
  assertReplayDecisionMarketInputMaterializationLineage,
  buildReplayDecisionMarketInputMaterialization,
} from "../../../../replay-execution-plane/data-adapter/src/lib/replay-decision-market-input-materialization"
import {
  REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
  REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
  REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION,
  REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION,
  REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION,
  REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
  REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION,
  assertTrialReservationSnapshot,
  hashTrialReservationSnapshot,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  createReplayInstrumentStatusProviderCertificationTermination,
  createReplayAggregateTradeProviderCertificationSnapshot,
  createReplayAggregateTradeProviderCertificationTermination,
  createReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  createReplayReservationCancellationSnapshot,
  createReplayAttemptCancellationSnapshot,
  createReplayAttemptCancellationObservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  RESEARCH_LIFECYCLE_RULE_VERSION,
  validateUniverseSeed,
} from "./research-control-plane-schema"
import {
  applyReviewerDecision,
  appendProposalRevision,
  candidateIdentityHash,
  materializeProposal,
  materializeGeneratedCandidate,
  registerExperiment,
  registerTrialGroup,
  trialGroupIdentityHash,
  transitionTrialGroup,
} from "./research-control-plane"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION } from "./research-contract-validator"
import { hashIdentityPayload } from "./research-identity-hash"
import { buildDefaultUniverseSeed, seedDefaultResearchControlPlane } from "./research-universe-default-seed"
import { ensureResearchStateSchema } from "./research-state-store"
import { issueTrialReservationSnapshot } from "./trial-reservation-snapshot"
import { claimReplayAttempt, finalizeReplayAttempt, renewReplayAttemptLease } from "./replay-attempt-authority"
import { recordReplayCheckpointReceipt } from "./replay-checkpoint-receipt"
import { issueReplayResumeAuthorization } from "./replay-resume-authorization"
import {
  assertReplayInstrumentStatusProviderCertificationAdmittedAt,
  registerReplayInstrumentStatusProviderCertification,
  registerReplayInstrumentStatusProviderCertificationTermination,
} from "./instrument-status-provider-certification-registry"
import {
  assertReplayAggregateTradeProviderCertificationAdmittedAt,
  issueReplayAggregateTradeEvidenceAdmission,
  readReplayAggregateTradeEvidenceAdmission,
  registerReplayAggregateTradeProviderCertification,
  registerReplayAggregateTradeProviderCertificationTermination,
} from "./aggregate-trade-provider-certification-registry"
import {
  issueReplayCrossSourceOrderingAdmission,
  readReplayCrossSourceOrderingAdmission,
} from "./cross-source-ordering-admission-registry"
import {
  issueReplayDecisionObservationBundleAdmission,
  readReplayDecisionObservationBundleAdmission,
} from "./decision-observation-bundle-admission-registry"
import {
  issueReplayDecisionObservationBundleDerivationAdmission,
  readReplayDecisionObservationBundleDerivationAdmission,
} from "./decision-observation-bundle-derivation-admission-registry"
import {
  cancelReplayAttemptByAuthority,
  createSqliteReplayCancellationCoordinationPort,
  readReplayAttemptCancellation,
  readReplayAttemptCancellationLatency,
  readReplayAttemptCancellationObservation,
  recordReplayAttemptCancellationObservation,
  resolveReplayAttemptCancellationDirective,
  registerReplayReservationCancellation,
} from "./replay-cancellation-authority"
import {
  appendExperimentResult,
  applySystemTransition,
  assertLifecycleProjection,
  finishTrial,
  openBlockerAndTransition,
  rebuildLifecycleProjection,
  resolveBlockerAndTransition,
  reserveTrial,
} from "./research-control-plane-operations"

const NOW = "2026-07-14T03:20:00Z"
const HASH_POLICY = "trade-flow.identity-hash.v1"
const PROVIDER_CAPABILITY_HASH = "8".repeat(64)
const PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-1", certification_ref: "certification://status-provider/v1",
  status: "certified", certified_at: "2026-07-13T00:00:00Z", valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane", certification_policy_version: "rd-status-provider-certification-v1",
  provider_capability_hash: PROVIDER_CAPABILITY_HASH, producer_domain: "market-data-products",
  producer_id: "market-data.instrument-status-provider", producer_version: "v1", producer_build_hash: "7".repeat(64),
  normalization_policy_version: "status-normalization-v1", normalization_policy_hash: "6".repeat(64),
  allowed_source_kind: "venue_status_event_archive", allowed_completeness: "complete_history",
})

const AGGREGATE_TRADE_PROVIDER_CAPABILITY_HASH = AGGREGATE_TRADE_PROVIDER_CAPABILITY.capability_hash
const AGGREGATE_TRADE_PROVIDER_CERTIFICATION = createReplayAggregateTradeProviderCertificationSnapshot({
  schema_version: REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "aggregate-trade-provider-certification-1",
  certification_ref: "certification://aggregate-trade-provider/v1",
  status: "certified",
  certified_at: "2026-07-13T00:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "rd-aggregate-trade-provider-certification-v1",
  provider_capability_hash: AGGREGATE_TRADE_PROVIDER_CAPABILITY_HASH,
  producer_domain: "market-data-products",
  producer_id: "market-data.aggregate-trade-provider",
  producer_version: "v1",
  producer_build_hash: AGGREGATE_TRADE_PROVIDER_BUILD_HASH,
  provider_policy_hash: AGGREGATE_TRADE_PROVIDER_POLICY_HASH,
  accepted_archive_schema: "trade.market-data-aggregate-trade-archive.v1",
  emitted_event_schema: "trade.rd-replay-aggregate-trade-event.v1",
  emitted_attestation_schema: "trade.rd-replay-aggregate-trade-coverage-attestation.v1",
  allowed_source_kind: "venue_aggregate_trade_archive",
  allowed_external_completeness: "not_verified",
})

test("control plane schema initializes frozen stages and lifecycle rules", () => {
  const db = openDb()
  try {
    const tables = db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'rd_%'
    `).all() as Array<{ name: string }>
    const names = new Set(tables.map((row) => row.name))
    for (const required of [
      "rd_universe_node",
      "rd_proposal_revision",
      "rd_trial_group",
      "rd_experiment_contract",
      "rd_trial",
      "rd_replay_instrument_status_provider_certification",
      "rd_replay_instrument_status_provider_certification_termination",
      "rd_replay_aggregate_trade_provider_certification",
      "rd_replay_aggregate_trade_provider_certification_termination",
      "rd_replay_aggregate_trade_evidence_admission",
      "rd_replay_cross_source_ordering_admission",
      "rd_replay_decision_observation_bundle_admission",
      "rd_replay_decision_observation_bundle_derivation_admission",
      "rd_replay_reservation_cancellation",
      "rd_replay_attempt",
      "rd_replay_attempt_cancellation",
      "rd_replay_attempt_cancellation_observation",
      "rd_experiment_result",
      "rd_review_decision",
      "rd_lifecycle_event",
      "rd_knowledge_edge_evidence",
    ]) {
      assert.equal(names.has(required), true, `missing ${required}`)
    }
    assert.equal(count(db, "rd_result_stage"), 8)
    assert.equal(count(db, "rd_lifecycle_transition_rule") >= 20, true)
  } finally {
    db.close()
  }
})

test("Control Plane provider certification registry is immutable and create-or-identical", () => {
  const db = openDb()
  try {
    assert.deepEqual(registerReplayInstrumentStatusProviderCertification(db, PROVIDER_CERTIFICATION), PROVIDER_CERTIFICATION)
    assert.throws(() => db.query(`
      UPDATE rd_replay_instrument_status_provider_certification
      SET valid_until = '2026-09-01T00:00:00Z'
      WHERE certification_id = 'status-provider-certification-1'
    `).run(), /immutable/)
    const { certification_hash: _certificationHash, ...certificationBody } = PROVIDER_CERTIFICATION
    const collision = createReplayInstrumentStatusProviderCertificationSnapshot({
      ...certificationBody,
      valid_until: "2026-09-01T00:00:00Z",
    })
    assert.throws(
      () => registerReplayInstrumentStatusProviderCertification(db, collision),
      /different content/,
    )
  } finally {
    db.close()
  }
})

test("Control Plane rotates or revokes provider certification without rewriting prior admission", () => {
  const db = openDb()
  try {
    const { certification_hash: _, ...certificationBody } = PROVIDER_CERTIFICATION
    const successor = createReplayInstrumentStatusProviderCertificationSnapshot({
      ...certificationBody,
      certification_id: "status-provider-certification-2",
      certification_ref: "certification://status-provider/v2",
      provider_capability_hash: "5".repeat(64),
      producer_version: "v2",
      producer_build_hash: "4".repeat(64),
    })
    registerReplayInstrumentStatusProviderCertification(db, successor)
    const termination = createReplayInstrumentStatusProviderCertificationTermination({
      schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
      termination_id: "status-provider-termination-1",
      termination_ref: "certification-termination://status-provider/v1",
      certification_hash: PROVIDER_CERTIFICATION.certification_hash,
      termination_type: "superseded",
      recorded_at: NOW,
      effective_at: "2026-07-14T03:30:00Z",
      authority_id: "research-control-plane",
      termination_policy_version: "rd-status-provider-termination-v1",
      reason_code: "provider_build_rotation",
      successor_certification_hash: successor.certification_hash,
    })
    assert.deepEqual(registerReplayInstrumentStatusProviderCertificationTermination(db, termination), termination)
    assert.deepEqual(registerReplayInstrumentStatusProviderCertificationTermination(db, termination), termination)
    assert.equal(
      assertReplayInstrumentStatusProviderCertificationAdmittedAt(db, PROVIDER_CERTIFICATION.certification_hash, NOW).certification_hash,
      PROVIDER_CERTIFICATION.certification_hash,
    )
    assert.equal(
      assertReplayInstrumentStatusProviderCertificationAdmittedAt(db, successor.certification_hash, termination.effective_at).certification_hash,
      successor.certification_hash,
    )
    assert.throws(
      () => assertReplayInstrumentStatusProviderCertificationAdmittedAt(db, PROVIDER_CERTIFICATION.certification_hash, termination.effective_at),
      /superseded/,
    )
    assert.throws(() => db.query(`
      UPDATE rd_replay_instrument_status_provider_certification_termination
      SET reason_code = 'certification_error'
      WHERE termination_id = 'status-provider-termination-1'
    `).run(), /immutable/)
    const { termination_hash: _terminationHash, ...terminationBody } = termination
    const competing = createReplayInstrumentStatusProviderCertificationTermination({
      ...terminationBody,
      termination_id: "status-provider-termination-competing",
      termination_ref: "certification-termination://status-provider/competing",
      termination_type: "revoked",
      reason_code: "certification_error",
      successor_certification_hash: null,
    })
    assert.throws(
      () => registerReplayInstrumentStatusProviderCertificationTermination(db, competing),
      /different termination/,
    )
    const revokedCertification = createReplayInstrumentStatusProviderCertificationSnapshot({
      ...certificationBody,
      certification_id: "status-provider-certification-revoked",
      certification_ref: "certification://status-provider/revoked",
      provider_capability_hash: "3".repeat(64),
      producer_version: "revoked-build",
      producer_build_hash: "2".repeat(64),
    })
    registerReplayInstrumentStatusProviderCertification(db, revokedCertification)
    registerReplayInstrumentStatusProviderCertificationTermination(db, createReplayInstrumentStatusProviderCertificationTermination({
      schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
      termination_id: "status-provider-termination-revoked",
      termination_ref: "certification-termination://status-provider/revoked",
      certification_hash: revokedCertification.certification_hash,
      termination_type: "revoked",
      recorded_at: NOW,
      effective_at: "2026-07-14T03:40:00Z",
      authority_id: "research-control-plane",
      termination_policy_version: "rd-status-provider-termination-v1",
      reason_code: "determinism_regression",
      successor_certification_hash: null,
    }))
    assert.throws(
      () => assertReplayInstrumentStatusProviderCertificationAdmittedAt(db, revokedCertification.certification_hash, "2026-07-14T03:40:00Z"),
      /revoked/,
    )
  } finally {
    db.close()
  }
})

test("Control Plane admits aggregate trade evidence only as a Reservation-bound pre-integration sidecar", () => {
  const db = openDb()
  try {
    assert.deepEqual(
      registerReplayAggregateTradeProviderCertification(db, AGGREGATE_TRADE_PROVIDER_CERTIFICATION),
      AGGREGATE_TRADE_PROVIDER_CERTIFICATION,
    )
    assert.deepEqual(
      registerReplayAggregateTradeProviderCertification(db, AGGREGATE_TRADE_PROVIDER_CERTIFICATION),
      AGGREGATE_TRADE_PROVIDER_CERTIFICATION,
    )
    assert.throws(() => db.query(`
      UPDATE rd_replay_aggregate_trade_provider_certification
      SET valid_until = '2026-09-01T00:00:00Z'
      WHERE certification_id = 'aggregate-trade-provider-certification-1'
    `).run(), /immutable/)

    seedExecutableExperiment(db, false)
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    reserveTrial(db, {
      trial_id: "trial-aggregate-trade", trial_group_id: "group-1", experiment_id: "experiment-1", trial_ordinal: 1,
      candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
      identity_hash_policy_version: HASH_POLICY, run_id: "run-aggregate-trade",
      idempotency_key: "trial-aggregate-trade-key", created_at: NOW,
    })
    const reservation = issueTrialReservationSnapshot(db, {
      trial_id: "trial-aggregate-trade",
      reservation_id: "reservation-aggregate-trade",
      reservation_ref: "reservation://aggregate-trade",
      issued_at: NOW,
      expires_at: "2026-07-14T04:08:00Z",
      bindings: {
        replay_idempotency_key: "replay-aggregate-trade",
        execution_spec_hash: "a".repeat(64),
        dataset_manifest_ref: "dataset://aggregate-trade-fixture",
        dataset_hash: "b".repeat(64),
        liquidity_capacity_attestation_hash: null,
        supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
        venue_risk_policy_schedule_hash: "c".repeat(64),
        instrument_spec_schedule_hash: "d".repeat(64),
        instrument_status_schedule_hash: "f".repeat(64),
        instrument_status_provenance_hash: "3".repeat(64),
        instrument_status_provider_capability_hash: PROVIDER_CAPABILITY_HASH,
        instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
        harness_hash: "e".repeat(64),
        assumptions_hash: "f".repeat(64),
        cost_policy_hash: "1".repeat(64),
        margin_policy_hash: "2".repeat(64),
        simulator_policy_version: "rd-replay-simulator-v16",
        execution_mode: "step",
      },
      required_capabilities: ["closed-candle", "step"],
    })
    const admissionInput = {
      admission_id: "aggregate-trade-admission-1",
      admission_ref: "admission://aggregate-trade/trial-aggregate-trade",
      issued_at: "2026-07-14T03:25:00Z",
      authority_id: "research-control-plane",
      admission_policy_version: "rd-aggregate-trade-evidence-admission-v1",
      reservation,
      provider_certification_hash: AGGREGATE_TRADE_PROVIDER_CERTIFICATION.certification_hash,
      provider_capability_hash: AGGREGATE_TRADE_PROVIDER_CAPABILITY_HASH,
      archive_id: "aggregate-trade-archive-1",
      archive_hash: "6".repeat(64),
      source_receipt_hash: "7".repeat(64),
      completeness_audit_hash: "8".repeat(64),
      evidence_ref: "evidence://aggregate-trade/trial-aggregate-trade",
      evidence_hash: "9".repeat(64),
      coverage_attestation_hash: "a".repeat(64),
      evidence_produced_at: "2026-07-14T03:15:00Z",
      coverage_start: "2026-07-14T03:00:00Z",
      coverage_end: "2026-07-14T03:10:00Z",
    }
    const admission = issueReplayAggregateTradeEvidenceAdmission(db, admissionInput)
    assert.equal(admission.scope, "pre_integration_exact_price_path_only")
    assert.equal(admission.external_completeness, "not_verified")
    assert.deepEqual(issueReplayAggregateTradeEvidenceAdmission(db, admissionInput), admission)
    assert.deepEqual(readReplayAggregateTradeEvidenceAdmission(db, admission.reservation_hash), admission)

    const bars = [{
      open_time: "2026-07-14T03:00:00Z", close_time: "2026-07-14T03:05:00Z",
      open: 100, high: 102, low: 99, close: 101, volume: 10, closed: true as const,
    }]
    const fundingEvents = [{ timestamp: "2026-07-14T03:00:00Z", rate: 0.0001, mark_price: 100 }]
    const instrumentStatusEvents = [{
      schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
      snapshot_id: "status-cross-source-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const,
      effective_at: "2026-07-14T03:00:00Z", valid_until: null, observed_at: "2026-07-14T03:00:00.500Z",
      source_ref: "archive:status:cross-source-1", source_hash: "d".repeat(64),
    }]
    const aggregateTradeEvents = [{
      schema_version: "trade.rd-replay-aggregate-trade-event.v1" as const,
      symbol: "BTCUSDT", aggregate_trade_id: 10, first_trade_id: 100, last_trade_id: 101,
      trade_time: "2026-07-14T03:00:00Z", available_at: "2026-07-14T03:00:00Z",
      price: 100, quantity: 1, buyer_is_maker: false,
    }]
    const orderingAttestation = buildReplayCrossSourceOrderingAttestation({
      symbol: "BTCUSDT",
      timeframe: "5m",
      window_start_inclusive: admission.coverage_start,
      window_end_exclusive: admission.coverage_end,
      bars,
      funding_events: fundingEvents,
      instrument_status_events: instrumentStatusEvents,
      instrument_status_completeness: "complete_history",
      aggregate_trade_events: aggregateTradeEvents,
    })
    const aggregateTradeEventsHash = orderingAttestation.source_collections
      .find((collection) => collection.source_kind === "aggregate_trade")!.content_hash
    const orderingAdmissionInput = {
      admission_id: "cross-source-ordering-admission-1",
      admission_ref: "admission://cross-source-ordering/trial-aggregate-trade",
      issued_at: "2026-07-14T03:26:00Z",
      authority_id: "research-control-plane",
      admission_policy_version: "rd-cross-source-ordering-admission-v1",
      reservation,
      aggregate_trade_evidence_admission_ref: admission.admission_ref,
      aggregate_trade_evidence_admission_hash: admission.admission_hash,
      aggregate_trade_coverage_events_hash: aggregateTradeEventsHash,
      ordering_attestation: orderingAttestation,
    }
    const orderingAdmission = issueReplayCrossSourceOrderingAdmission(db, orderingAdmissionInput)
    assert.equal(orderingAdmission.scope, "pre_integration_cross_source_ordering_only")
    assert.equal(orderingAdmission.economic_authority, "none")
    assert.equal(orderingAdmission.ordering_resolution, "resolution_limited")
    assert.deepEqual(issueReplayCrossSourceOrderingAdmission(db, orderingAdmissionInput), orderingAdmission)
    assert.deepEqual(readReplayCrossSourceOrderingAdmission(db, admission.reservation_hash), orderingAdmission)
    assert.throws(() => issueReplayCrossSourceOrderingAdmission(db, {
      ...orderingAdmissionInput,
      aggregate_trade_evidence_admission_hash: "e".repeat(64),
    }), /does not bind/)
    assert.throws(() => issueReplayCrossSourceOrderingAdmission(db, {
      ...orderingAdmissionInput,
      aggregate_trade_coverage_events_hash: "e".repeat(64),
    }), /coverage events hash/)
    assert.throws(() => db.query(`
      UPDATE rd_replay_cross_source_ordering_admission
      SET economic_authority = 'runner'
      WHERE admission_id = 'cross-source-ordering-admission-1'
    `).run(), /immutable/)

    const request = decisionObservationRequest(reservation)
    const sourceProjection = buildReplaySourceEventProjectionAttestation({
      ordering_admission: orderingAdmission,
      ordering_attestation: orderingAttestation,
    })
    const wireManifest = materializeReplaySourceEventWire({
      bars,
      funding_events: fundingEvents,
      instrument_status_events: instrumentStatusEvents,
      aggregate_trade_events: aggregateTradeEvents,
      ordering_attestation: orderingAttestation,
      ordering_admission: orderingAdmission,
      projection: sourceProjection,
    })
    const derivationFixture = decisionObservationDerivationFixture(request, wireManifest)
    const bundle = derivationFixture.bundle
    const bundleAdmissionInput = {
      admission_id: "decision-observation-bundle-admission-1",
      admission_ref: "admission://decision-observation-bundle/trial-aggregate-trade",
      issued_at: "2026-07-14T03:27:00Z",
      authority_id: "research-control-plane",
      admission_policy_version: "rd-decision-observation-bundle-admission-v1",
      reservation,
      request,
      wire_manifest: wireManifest,
      bundle,
    }
    const bundleAdmission = issueReplayDecisionObservationBundleAdmission(db, bundleAdmissionInput)
    assert.equal(bundleAdmission.schema_version, REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION)
    assert.equal(bundleAdmission.scope, "pre_integration_non_economic_observation_audit_only")
    assert.equal(bundleAdmission.parent_lineage_validation, "wire_identity_and_schedule_binding_only")
    assert.equal(bundleAdmission.projection_derivation_compatibility, "not_certified")
    assert.equal(bundleAdmission.harness_invocation, "forbidden")
    assert.equal(bundleAdmission.economic_authority, "none")
    assert.deepEqual(issueReplayDecisionObservationBundleAdmission(db, bundleAdmissionInput), bundleAdmission)
    assert.deepEqual(
      readReplayDecisionObservationBundleAdmission(db, hashTrialReservationSnapshot(reservation)),
      bundleAdmission,
    )
    assert.throws(() => issueReplayDecisionObservationBundleAdmission(db, {
      ...bundleAdmissionInput,
      admission_id: "decision-observation-bundle-admission-competing",
      admission_ref: "admission://decision-observation-bundle/competing",
    }), /different content/)
    assert.throws(() => issueReplayDecisionObservationBundleAdmission(db, {
      ...bundleAdmissionInput,
      request: { ...request, dataset_hash: "9".repeat(64) },
    }), /data bindings/)
    assert.throws(() => db.query(`
      UPDATE rd_replay_decision_observation_bundle_admission
      SET economic_authority = 'runner'
      WHERE admission_id = 'decision-observation-bundle-admission-1'
    `).run(), /immutable/)

    const derivationAdmissionInput = {
      admission_id: "decision-observation-derivation-admission-1",
      admission_ref: "admission://decision-observation-derivation/trial-aggregate-trade",
      issued_at: "2026-07-14T03:28:00Z",
      authority_id: "research-control-plane",
      admission_policy_version: "rd-decision-observation-derivation-admission-v1",
      reservation,
      bundle,
      derivation_attestation: derivationFixture.derivation_attestation,
    }
    const derivationAdmission = issueReplayDecisionObservationBundleDerivationAdmission(
      db,
      derivationAdmissionInput,
    )
    assert.equal(
      derivationAdmission.schema_version,
      REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION,
    )
    assert.equal(derivationAdmission.control_plane_parent_replay, "not_performed")
    assert.equal(
      derivationAdmission.control_plane_validation,
      "attestation_schema_hash_and_admitted_bundle_binding",
    )
    assert.equal(derivationAdmission.harness_invocation, "forbidden")
    assert.equal(derivationAdmission.economic_authority, "none")
    assert.deepEqual(
      issueReplayDecisionObservationBundleDerivationAdmission(db, derivationAdmissionInput),
      derivationAdmission,
    )
    assert.deepEqual(
      readReplayDecisionObservationBundleDerivationAdmission(db, hashTrialReservationSnapshot(reservation)),
      derivationAdmission,
    )
    assert.throws(() => issueReplayDecisionObservationBundleDerivationAdmission(db, {
      ...derivationAdmissionInput,
      admission_id: "decision-observation-derivation-admission-competing",
      admission_ref: "admission://decision-observation-derivation/competing",
    }), /different content/)
    const substitutedAttestation = structuredClone(derivationFixture.derivation_attestation)
    substitutedAttestation.bundle_hash = "8".repeat(64)
    const {
      attestation_hash: _substitutedHash,
      attestation_id: _substitutedId,
      ...substitutedBodyWithoutId
    } = substitutedAttestation
    substitutedAttestation.attestation_id
      = `source-event-decision-observation-derivation-${canonicalHash(substitutedBodyWithoutId).slice(0, 24)}`
    const { attestation_hash: _rehash, ...substitutedBody } = substitutedAttestation
    substitutedAttestation.attestation_hash = canonicalHash(substitutedBody)
    assert.throws(() => issueReplayDecisionObservationBundleDerivationAdmission(db, {
      ...derivationAdmissionInput,
      derivation_attestation: substitutedAttestation,
    }), /does not bind the admitted Bundle/)
    assert.throws(() => db.query(`
      UPDATE rd_replay_decision_observation_bundle_derivation_admission
      SET economic_authority = 'runner'
      WHERE admission_id = 'decision-observation-derivation-admission-1'
    `).run(), /immutable/)

    const harnessContextBindingInput = {
      request,
      bundle,
      derivation_admission: derivationAdmission,
    }
    const harnessContextBinding = buildReplaySourceEventDecisionObservationHarnessContextBinding(
      harnessContextBindingInput,
    )
    assert.equal(harnessContextBinding.harness_invocation, "forbidden")
    assert.equal(harnessContextBinding.decision_input_materialization, "not_certified")
    assert.equal(harnessContextBinding.worker_request_compatibility, "not_bound")
    assert.equal(harnessContextBinding.decision_output_authority, "none")
    assert.equal(harnessContextBinding.economic_authority, "none")
    assert.equal(harnessContextBinding.entries[0]!.harness_context.decision_time, bundle.first_as_of_time)
    assert.equal(
      buildReplaySourceEventDecisionObservationHarnessContextBinding(
        structuredClone(harnessContextBindingInput),
      ).binding_hash,
      harnessContextBinding.binding_hash,
    )
    assert.doesNotThrow(() => assertReplaySourceEventDecisionObservationHarnessContextBindingLineage(
      harnessContextBinding,
      harnessContextBindingInput,
    ))
    assert.throws(() => buildReplaySourceEventDecisionObservationHarnessContextBinding({
      ...harnessContextBindingInput,
      request: { ...request, harness_hash: "7".repeat(64) },
    }), /Request does not match Derivation Admission/)

    const substitutedContext = structuredClone(harnessContextBinding)
    substitutedContext.entries[0]!.harness_context.random_seed += 1
    substitutedContext.entries[0]!.harness_context_hash
      = canonicalHash(substitutedContext.entries[0]!.harness_context)
    const { entry_hash: _entryHash, ...entryBody } = substitutedContext.entries[0]!
    substitutedContext.entries[0]!.entry_hash = canonicalHash(entryBody)
    substitutedContext.entries_hash = canonicalHash(substitutedContext.entries)
    substitutedContext.entry_hashes_hash
      = canonicalHash(substitutedContext.entries.map((item) => item.entry_hash))
    substitutedContext.harness_context_hashes_hash
      = canonicalHash(substitutedContext.entries.map((item) => item.harness_context_hash))
    const {
      binding_hash: _bindingHash,
      binding_id: _bindingId,
      ...bindingBodyWithoutId
    } = substitutedContext
    substitutedContext.binding_id
      = `source-event-observation-harness-context-${canonicalHash(bindingBodyWithoutId).slice(0, 24)}`
    const { binding_hash: _bindingRehash, ...bindingBody } = substitutedContext
    substitutedContext.binding_hash = canonicalHash(bindingBody)
    assert.doesNotThrow(() => assertReplaySourceEventDecisionObservationHarnessContextBinding(substitutedContext))
    assert.throws(() => assertReplaySourceEventDecisionObservationHarnessContextBindingLineage(
      substitutedContext,
      harnessContextBindingInput,
    ), /parent lineage drift/)

    const extendedHarnessBinding = structuredClone(harnessContextBinding) as typeof harnessContextBinding & {
      runner_authority?: string
    }
    extendedHarnessBinding.runner_authority = "allowed"
    const { binding_hash: _extendedBindingHash, ...extendedBindingBody } = extendedHarnessBinding
    extendedHarnessBinding.binding_hash = canonicalHash(extendedBindingBody)
    assert.throws(
      () => assertReplaySourceEventDecisionObservationHarnessContextBinding(extendedHarnessBinding),
      /field whitelist/,
    )

    const inputMaterializationInput = {
      request,
      dataset_manifest: decisionObservationManifest(request),
      bundle,
      derivation_admission: derivationAdmission,
      harness_context_binding: harnessContextBinding,
    }
    const inputMaterialization = buildReplaySourceEventDecisionObservationInputMaterialization(
      inputMaterializationInput,
    )
    assert.equal(inputMaterialization.raw_dataset_revalidation, "not_performed")
    assert.equal(inputMaterialization.supplemental_input_materialization, "certified_empty_requirement_set_only")
    assert.equal(inputMaterialization.market_input_materialization, "certified_from_admitted_closed_bar_observations")
    assert.equal(inputMaterialization.state_input_materialization, "not_materialized_runtime_state_required")
    assert.equal(inputMaterialization.worker_request_materialization, "forbidden")
    assert.equal(inputMaterialization.harness_invocation, "forbidden")
    assert.equal(inputMaterialization.runner_compatibility, "not_bound")
    assert.equal(inputMaterialization.entries[0]!.decision_input_snapshot.selected_records.length, 0)
    assert.deepEqual(inputMaterialization.entries[0]!.decision_market_input_snapshot.bars, bars)
    assert.equal(inputMaterialization.entries[0]!.state_input_status, "not_applicable_non_position_phase")
    assert.equal(inputMaterialization.entries[0]!.decision_state_snapshot, null)
    assert.equal(
      buildReplaySourceEventDecisionObservationInputMaterialization(
        structuredClone(inputMaterializationInput),
      ).materialization_hash,
      inputMaterialization.materialization_hash,
    )
    assert.doesNotThrow(() => assertReplaySourceEventDecisionObservationInputMaterializationLineage(
      inputMaterialization,
      inputMaterializationInput,
    ))
    assert.throws(() => buildReplaySourceEventDecisionObservationInputMaterialization({
      ...inputMaterializationInput,
      dataset_manifest: {
        ...inputMaterializationInput.dataset_manifest,
        manifest_ref: "dataset://drift",
      },
    }), /Dataset Manifest does not match Request/)
    assert.throws(() => buildReplaySourceEventDecisionObservationInputMaterialization({
      ...inputMaterializationInput,
      dataset_manifest: {
        ...inputMaterializationInput.dataset_manifest,
        interval_ms: inputMaterializationInput.dataset_manifest.interval_ms + 1,
      },
    }), /bar duration differs from interval/)

    const marketMaterializationInput = {
      request,
      dataset_manifest: inputMaterializationInput.dataset_manifest,
      bundle,
      derivation_admission: derivationAdmission,
      harness_context_binding: harnessContextBinding,
    }
    const marketMaterialization = buildReplayDecisionMarketInputMaterialization(marketMaterializationInput)
    assert.equal(marketMaterialization.supplemental_binding_validation, "not_inspected_outside_market_responsibility")
    assert.equal(marketMaterialization.raw_dataset_revalidation, "not_performed")
    assert.equal(marketMaterialization.worker_request_materialization, "forbidden")
    assert.deepEqual(
      marketMaterialization.entries[0]!.decision_market_input_snapshot,
      inputMaterialization.entries[0]!.decision_market_input_snapshot,
    )
    assert.doesNotThrow(() => assertReplayDecisionMarketInputMaterialization(marketMaterialization))
    assert.doesNotThrow(() => assertReplayDecisionMarketInputMaterializationLineage(
      marketMaterialization,
      marketMaterializationInput,
    ))

    const supplementalRequirementSet = {
      schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
      mode: "signal_time_complete" as const,
      undeclared_input_policy: "reject" as const,
      requirements: [{
        requirement_id: "fixture-open-interest",
        source_id: "fixture-open-interest",
        entity_key: request.symbol,
        fact_key: "open_interest",
        event_time_start_inclusive: "2026-07-14T03:00:00Z",
        event_time_end_inclusive: "2026-07-14T03:00:00Z",
        minimum_visible_event_count: 1,
        maximum_latest_event_age_ms: 300_000,
      }],
    }
    const nonEmptySupplementalRequest = {
      ...request,
      supplemental_facts_hash: "b".repeat(64),
      supplemental_requirement_set: supplementalRequirementSet,
      supplemental_requirement_set_hash: canonicalHash(supplementalRequirementSet),
    }
    const { admission_hash: _admissionHash, ...derivationAdmissionBody } = derivationAdmission
    const nonEmptyDerivationAdmission = createReplayDecisionObservationBundleDerivationAdmissionSnapshot({
      ...derivationAdmissionBody,
      request_hash: canonicalHash(nonEmptySupplementalRequest),
    })
    const nonEmptyHarnessContextBinding = buildReplaySourceEventDecisionObservationHarnessContextBinding({
      request: nonEmptySupplementalRequest,
      bundle,
      derivation_admission: nonEmptyDerivationAdmission,
    })
    const nonEmptyMarketMaterialization = buildReplayDecisionMarketInputMaterialization({
      ...marketMaterializationInput,
      request: nonEmptySupplementalRequest,
      derivation_admission: nonEmptyDerivationAdmission,
      harness_context_binding: nonEmptyHarnessContextBinding,
    })
    assert.equal(
      nonEmptyMarketMaterialization.entries[0]!.decision_market_input_snapshot_hash,
      marketMaterialization.entries[0]!.decision_market_input_snapshot_hash,
    )
    assert.notEqual(nonEmptyMarketMaterialization.request_hash, marketMaterialization.request_hash)
    assert.notEqual(
      nonEmptyMarketMaterialization.harness_context_binding_hash,
      marketMaterialization.harness_context_binding_hash,
    )
    assert.throws(() => buildReplaySourceEventDecisionObservationInputMaterialization({
      ...inputMaterializationInput,
      request: nonEmptySupplementalRequest,
      derivation_admission: nonEmptyDerivationAdmission,
      harness_context_binding: nonEmptyHarnessContextBinding,
    }), /only certifies empty supplemental requirements/)
    assert.throws(() => assertReplayDecisionMarketInputMaterializationLineage(
      nonEmptyMarketMaterialization,
      marketMaterializationInput,
    ), /parent lineage drift/)

    const workerInputAssemblyInput = {
      harness_context_binding: harnessContextBinding,
      observation_input_materialization: inputMaterialization,
      initial_signal_supplemental_materialization: null,
    }
    const workerInputAssembly = buildReplayDecisionWorkerInputAssembly(workerInputAssemblyInput)
    assert.equal(workerInputAssembly.parent_validation, "self_hash_and_cross_object_binding_only")
    assert.equal(workerInputAssembly.complete_entry_count, 1)
    assert.equal(workerInputAssembly.incomplete_market_entry_count, 0)
    assert.equal(workerInputAssembly.incomplete_state_entry_count, 0)
    assert.equal(workerInputAssembly.worker_request_count, 0)
    assert.equal(workerInputAssembly.entries[0]!.input_tuple_status, "complete_non_executable_build_unbound")
    assert.equal(workerInputAssembly.entries[0]!.worker_request, null)
    assert.equal(workerInputAssembly.source_bundle_binding, "not_bound")
    assert.equal(workerInputAssembly.build_attestation_binding, "not_bound")
    assert.doesNotThrow(() => assertReplayDecisionWorkerInputAssembly(workerInputAssembly))
    assert.doesNotThrow(() => assertReplayDecisionWorkerInputAssemblyLineage(
      workerInputAssembly,
      workerInputAssemblyInput,
    ))
    assert.deepEqual(buildReplayDecisionWorkerInputAssembly(
      structuredClone(workerInputAssemblyInput),
    ), workerInputAssembly)
    assert.throws(() => buildReplayDecisionWorkerInputAssembly({
      ...workerInputAssemblyInput,
      initial_signal_supplemental_materialization: {} as never,
    }), /exactly one materialization source/)
    const substitutedWorkerAssembly = structuredClone(workerInputAssembly)
    substitutedWorkerAssembly.entries[0]!.harness_context.random_seed += 1
    assert.throws(
      () => assertReplayDecisionWorkerInputAssembly(substitutedWorkerAssembly),
      /semantic drift/,
    )

    const substitutedInput = structuredClone(inputMaterialization)
    const substitutedMarketSnapshot = substitutedInput.entries[0]!.decision_market_input_snapshot
    substitutedMarketSnapshot.interval_ms = 240_000
    substitutedMarketSnapshot.bars[0]!.open_time = "2026-07-14T03:01:00Z"
    substitutedMarketSnapshot.bars_hash = canonicalHash(substitutedMarketSnapshot.bars)
    const { snapshot_hash: _substitutedMarketHash, ...substitutedMarketBody } = substitutedMarketSnapshot
    substitutedMarketSnapshot.snapshot_hash = canonicalHash(substitutedMarketBody)
    substitutedInput.entries[0]!.decision_market_input_snapshot_hash = substitutedMarketSnapshot.snapshot_hash
    const { entry_hash: _substitutedInputEntryHash, ...substitutedInputEntryBody } = substitutedInput.entries[0]!
    substitutedInput.entries[0]!.entry_hash = canonicalHash(substitutedInputEntryBody)
    substitutedInput.entries_hash = canonicalHash(substitutedInput.entries)
    substitutedInput.entry_hashes_hash = canonicalHash(substitutedInput.entries.map((item) => item.entry_hash))
    substitutedInput.decision_market_input_snapshot_hashes_hash
      = canonicalHash(substitutedInput.entries.map((item) => item.decision_market_input_snapshot_hash))
    const {
      materialization_hash: _substitutedMaterializationHash,
      materialization_id: _substitutedMaterializationId,
      ...substitutedInputBodyWithoutId
    } = substitutedInput
    substitutedInput.materialization_id
      = `source-event-decision-input-${canonicalHash(substitutedInputBodyWithoutId).slice(0, 24)}`
    const { materialization_hash: _substitutedInputRehash, ...substitutedInputBody } = substitutedInput
    substitutedInput.materialization_hash = canonicalHash(substitutedInputBody)
    assert.doesNotThrow(() => assertReplaySourceEventDecisionObservationInputMaterialization(substitutedInput))
    assert.throws(() => assertReplaySourceEventDecisionObservationInputMaterializationLineage(
      substitutedInput,
      inputMaterializationInput,
    ), /parent lineage drift/)

    const futureLeakingInput = structuredClone(inputMaterialization)
    const futureMarketSnapshot = futureLeakingInput.entries[0]!.decision_market_input_snapshot
    futureMarketSnapshot.bars[0]!.open_time = "2026-07-14T03:01:00Z"
    futureMarketSnapshot.bars[0]!.close_time = "2026-07-14T03:06:00Z"
    futureMarketSnapshot.bars_hash = canonicalHash(futureMarketSnapshot.bars)
    const { snapshot_hash: _futureMarketHash, ...futureMarketBody } = futureMarketSnapshot
    futureMarketSnapshot.snapshot_hash = canonicalHash(futureMarketBody)
    futureLeakingInput.entries[0]!.decision_market_input_snapshot_hash = futureMarketSnapshot.snapshot_hash
    assert.throws(
      () => assertReplaySourceEventDecisionObservationInputMaterialization(futureLeakingInput),
      /future or discontinuous market input/,
    )

    const extendedInputMaterialization = structuredClone(inputMaterialization) as typeof inputMaterialization & {
      runner_authority?: string
    }
    extendedInputMaterialization.runner_authority = "allowed"
    const { materialization_hash: _extendedInputHash, ...extendedInputBody } = extendedInputMaterialization
    extendedInputMaterialization.materialization_hash = canonicalHash(extendedInputBody)
    assert.throws(
      () => assertReplaySourceEventDecisionObservationInputMaterialization(extendedInputMaterialization),
      /field whitelist/,
    )

    assert.throws(() => issueReplayAggregateTradeEvidenceAdmission(db, {
      ...admissionInput,
      admission_id: "aggregate-trade-admission-competing",
      admission_ref: "admission://aggregate-trade/competing",
      evidence_hash: "b".repeat(64),
    }), /different content/)
    assert.throws(() => issueReplayAggregateTradeEvidenceAdmission(db, {
      ...admissionInput,
      provider_capability_hash: "c".repeat(64),
    }), /does not match/)

    const termination = createReplayAggregateTradeProviderCertificationTermination({
      schema_version: REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
      termination_id: "aggregate-trade-provider-termination-1",
      termination_ref: "certification-termination://aggregate-trade-provider/v1",
      certification_hash: AGGREGATE_TRADE_PROVIDER_CERTIFICATION.certification_hash,
      termination_type: "revoked",
      recorded_at: NOW,
      effective_at: "2026-07-14T03:30:00Z",
      authority_id: "research-control-plane",
      termination_policy_version: "rd-aggregate-trade-provider-termination-v1",
      reason_code: "determinism_regression",
      successor_certification_hash: null,
    })
    assert.deepEqual(registerReplayAggregateTradeProviderCertificationTermination(db, termination), termination)
    assert.equal(
      assertReplayAggregateTradeProviderCertificationAdmittedAt(
        db,
        AGGREGATE_TRADE_PROVIDER_CERTIFICATION.certification_hash,
        admission.issued_at,
      ).certification_hash,
      AGGREGATE_TRADE_PROVIDER_CERTIFICATION.certification_hash,
    )
    assert.throws(() => assertReplayAggregateTradeProviderCertificationAdmittedAt(
      db,
      AGGREGATE_TRADE_PROVIDER_CERTIFICATION.certification_hash,
      termination.effective_at,
    ), /revoked/)
    assert.deepEqual(readReplayAggregateTradeEvidenceAdmission(db, admission.reservation_hash), admission)
    assert.deepEqual(readReplayCrossSourceOrderingAdmission(db, admission.reservation_hash), orderingAdmission)
    assert.throws(() => issueReplayCrossSourceOrderingAdmission(db, {
      ...orderingAdmissionInput,
      admission_id: "cross-source-ordering-admission-after-revoke",
      admission_ref: "admission://cross-source-ordering/after-revoke",
      issued_at: termination.effective_at,
    }), /revoked/)
  } finally {
    db.close()
  }
})

test("universe seed validator enforces hierarchy paths and primary axes", () => {
  const db = openDb()
  try {
    seedUniverse(db)
    assert.doesNotThrow(() => validateUniverseSeed(db))
    db.query("UPDATE rd_universe_node SET path='wrong/path' WHERE node_id='canonical-1'").run()
    assert.throws(() => validateUniverseSeed(db), /invalid path/)
  } finally {
    db.close()
  }
})

test("default control-plane seed installs the frozen universe, registries, and mapped coverage", () => {
  const db = openDb()
  try {
    const counts = seedDefaultResearchControlPlane(db, NOW)
    assert.equal(counts.nodes > 80, true)
    assert.equal(counts.data_surfaces, 11)
    assert.equal(counts.capabilities, 7)
    assert.doesNotThrow(() => validateUniverseSeed(db))
    assert.equal(count(db, "rd_universe_data_surface"), 10)
    assert.equal(count(db, "rd_universe_coverage"), 14)
    assert.equal(buildDefaultUniverseSeed(NOW).nodes.filter((node) => node.level === 3).length, 7)
  } finally {
    db.close()
  }
})

test("proposal revisions are monotonic, validated, and materialize once", () => {
  const db = openDb()
  try {
    appendProposalRevision(db, proposalRevision({ validation_status: "invalid" }))
    assert.throws(() => materializeProposal(db, {
      proposal_id: "proposal-1",
      revision: 1,
      materialization_ref: "family-backlog://item-1",
      materialized_at: NOW,
    }), /only a valid proposal revision/)

    appendProposalRevision(db, proposalRevision({ revision: 2, validation_status: "valid" }))
    assert.throws(
      () => appendProposalRevision(db, proposalRevision({ revision: 4, validation_status: "valid" })),
      /revision must be 3/,
    )
    materializeProposal(db, {
      proposal_id: "proposal-1",
      revision: 2,
      materialization_ref: "experiment://experiment-1",
      materialized_at: NOW,
    })
    assert.throws(() => materializeProposal(db, {
      proposal_id: "proposal-1",
      revision: 2,
      materialization_ref: "experiment://experiment-2",
      materialized_at: NOW,
    }), /already materialized/)
    assert.throws(
      () => db.query("UPDATE rd_proposal_revision SET validation_ref='changed' WHERE proposal_id='proposal-1'").run(),
      /append-only/,
    )
  } finally {
    db.close()
  }
})

test("trial groups freeze search identity and reject post-hoc candidates", () => {
  const db = openDb()
  try {
    registerTrialGroup(db, trialGroup())
    assert.throws(
      () => db.query("UPDATE rd_trial_group SET max_trials=99 WHERE trial_group_id='group-1'").run(),
      /definition is immutable/,
    )
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    assert.throws(() => db.query(`
      INSERT INTO rd_trial_group_candidate(
        trial_group_id, candidate_id, candidate_identity_hash,
        identity_hash_policy_version, parameter_assignment_json,
        candidate_ordinal, created_at
      ) VALUES ('group-1', 'candidate-2', 'candidate-hash-2', $policy, '{}', 2, $now)
    `).run({ $policy: HASH_POLICY, $now: NOW }), /candidate cannot be added/)
  } finally {
    db.close()
  }
})

test("generated candidates can only materialize through the frozen registered generator", () => {
  const db = openDb()
  try {
    const base = {
      trial_group_id: "generated-group", hypothesis_scope_ref: "hypothesis-generated",
      identity_hash_policy_version: HASH_POLICY, candidate_mode: "generated_from_space" as const,
      candidate_generator_ref: "generator://bounded-grid/v1",
      search_space_json: { schema_version: "trade-flow.rd-search-space.v1", lookback: [10, 20] },
      selection_protocol_json: { schema_version: "trade-flow.rd-selection.v1", method: "ordered" },
      max_trials: 2, trial_accounting_policy_version: "trial-accounting-v1",
      registered_at: NOW, created_at: NOW, candidates: [],
    }
    registerTrialGroup(db, { ...base, group_hash: trialGroupIdentityHash(base) })
    transitionTrialGroup(db, { trial_group_id: "generated-group", action: "start", occurred_at: NOW })
    const input = {
      trial_group_id: "generated-group", candidate_generator_ref: "generator://bounded-grid/v1",
      identity_hash_policy_version: HASH_POLICY,
      candidate: {
        candidate_id: "generated-1", candidate_identity_hash: candidateIdentityHash({ lookback: 10 }),
        parameter_assignment_json: { lookback: 10 }, candidate_ordinal: 1, created_at: NOW,
      },
    }
    materializeGeneratedCandidate(db, input)
    materializeGeneratedCandidate(db, input)
    assert.equal(count(db, "rd_trial_group_candidate"), 1)
    assert.throws(() => materializeGeneratedCandidate(db, {
      ...input, candidate_generator_ref: "generator://other",
    }), /registered running group generator/)
    transitionTrialGroup(db, { trial_group_id: "generated-group", action: "seal", occurred_at: NOW })
    assert.throws(() => materializeGeneratedCandidate(db, {
      ...input,
      candidate: { ...input.candidate, candidate_id: "generated-2", candidate_ordinal: 2 },
    }), /registered running group generator/)
  } finally {
    db.close()
  }
})

test("experiment facts enforce trial identity, sentinel, freeze, and append-only invariants", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db)
    assert.doesNotThrow(() => assertLifecycleProjection(db, "experiment-1"))
    assert.throws(() => insertExperimentResult(db, "result-any", "__any__"), /CHECK constraint/)
    insertExperimentResult(db, "result-1", "historical_validation")
    assert.throws(
      () => db.query("UPDATE rd_experiment_result SET artifact_ref='changed' WHERE result_id='result-1'").run(),
      /append-only/,
    )

    assert.throws(() => applyReviewerDecision(db, reviewerDecision({
      decision_id: "decision-no-primary",
      idempotency_key: "decision-key-no-primary",
      lifecycle_event_id: "event-no-primary",
      lifecycle_idempotency_key: "event-key-no-primary",
      evidence: [{ result_id: "result-1", evidence_role: "supporting" }],
    })), /exactly one primary/)
    assert.equal(count(db, "rd_review_decision"), 0)
    assert.equal(count(db, "rd_lifecycle_event"), 2)

    applyReviewerDecision(db, reviewerDecision())
    const frozen = db.query(`
      SELECT lifecycle_state, lifecycle_version, selected_candidate_id,
             selected_trial_id, candidate_hash
      FROM rd_experiment_contract
      WHERE experiment_id='experiment-1'
    `).get() as Record<string, string | number>
    assert.deepEqual(frozen, {
      lifecycle_state: "draft_frozen",
      lifecycle_version: 3,
      selected_candidate_id: "candidate-1",
      selected_trial_id: "trial-1",
      candidate_hash: candidateIdentityHash({ lookback: 20 }),
    })
    assert.throws(() => db.query(`
      UPDATE rd_experiment_contract
      SET candidate_hash='replacement-hash'
      WHERE experiment_id='experiment-1'
    `).run(), /frozen candidate identity is immutable/)
  } finally {
    db.close()
  }
})

test("Control Plane atomically issues an immutable Replay Trial Reservation snapshot", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db, false)
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    reserveTrial(db, {
      trial_id: "trial-reserved", trial_group_id: "group-1", experiment_id: "experiment-1", trial_ordinal: 1,
      candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }), identity_hash_policy_version: HASH_POLICY,
      run_id: "run-reserved", idempotency_key: "trial-reserved-key", created_at: NOW,
    })
    const snapshot = issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-1", reservation_ref: "reservation://trial-reserved", issued_at: NOW,
      expires_at: "2026-07-14T04:08:00Z",
      bindings: {
        replay_idempotency_key: "replay-key", execution_spec_hash: "a".repeat(64), dataset_manifest_ref: "dataset://fixture", dataset_hash: "b".repeat(64), liquidity_capacity_attestation_hash: null,
        supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
        venue_risk_policy_schedule_hash: "c".repeat(64), instrument_spec_schedule_hash: "d".repeat(64), instrument_status_schedule_hash: "f".repeat(64), instrument_status_provenance_hash: "3".repeat(64),
        instrument_status_provider_capability_hash: PROVIDER_CAPABILITY_HASH, instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash, harness_hash: "e".repeat(64),
        assumptions_hash: "f".repeat(64), cost_policy_hash: "1".repeat(64), margin_policy_hash: "2".repeat(64),
        simulator_policy_version: "rd-replay-simulator-v7", execution_mode: "step",
      },
      required_capabilities: ["closed-candle", "step"],
    })
    assert.equal(snapshot.status, "reserved")
    assert.equal(snapshot.identity.trial_group_hash, trialGroup().group_hash)
    assert.equal(snapshot.identity.candidate_hash, candidateIdentityHash({ lookback: 20 }))
    assert.equal(snapshot.identity.experiment_contract_hash, hashIdentityPayload(experimentContract()))
    assert.equal(snapshot.counts_against_budget, true)
    const { certification_hash: _oldCertificationHash, ...oldCertificationBody } = PROVIDER_CERTIFICATION
    const successorCertification = createReplayInstrumentStatusProviderCertificationSnapshot({
      ...oldCertificationBody,
      certification_id: "status-provider-certification-reservation-successor",
      certification_ref: "certification://status-provider/reservation-successor",
      provider_capability_hash: "5".repeat(64),
      producer_version: "v2",
      producer_build_hash: "4".repeat(64),
    })
    registerReplayInstrumentStatusProviderCertification(db, successorCertification)
    registerReplayInstrumentStatusProviderCertificationTermination(db, createReplayInstrumentStatusProviderCertificationTermination({
      schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
      termination_id: "status-provider-termination-reservation",
      termination_ref: "certification-termination://status-provider/reservation",
      certification_hash: PROVIDER_CERTIFICATION.certification_hash,
      termination_type: "superseded",
      recorded_at: NOW,
      effective_at: "2026-07-14T03:30:00Z",
      authority_id: "research-control-plane",
      termination_policy_version: "rd-status-provider-termination-v1",
      reason_code: "provider_build_rotation",
      successor_certification_hash: successorCertification.certification_hash,
    }))
    assert.doesNotThrow(() => assertTrialReservationSnapshot(snapshot))
    assert.throws(() => issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-superseded", reservation_ref: "reservation://superseded",
      issued_at: "2026-07-14T03:30:00Z", expires_at: "2026-07-14T04:08:00Z",
      bindings: snapshot.bindings, required_capabilities: snapshot.required_capabilities,
    }), /superseded/)
    const successorSnapshot = issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-successor", reservation_ref: "reservation://successor",
      issued_at: "2026-07-14T03:30:00Z", expires_at: "2026-07-14T04:08:00Z",
      bindings: {
        ...snapshot.bindings,
        instrument_status_provider_capability_hash: successorCertification.provider_capability_hash,
        instrument_status_provider_certification_hash: successorCertification.certification_hash,
      },
      required_capabilities: snapshot.required_capabilities,
    })
    assert.equal(successorSnapshot.instrument_status_provider_certification.certification_hash, successorCertification.certification_hash)
    const historicalClaim = claimReplayAttempt(db, {
      attempt_id: "attempt-pre-cutover-reservation",
      worker_id: "worker-pre-cutover-reservation",
      idempotency_key: "attempt-key-pre-cutover-reservation",
      request_hash: "9".repeat(64),
      claimed_at: "2026-07-14T03:40:00Z",
      lease_expires_at: "2026-07-14T03:50:00Z",
      trial_reservation: snapshot,
    })
    assert.equal(historicalClaim.attempt_ordinal, 1)
    finalizeReplayAttempt(db, {
      attempt_id: historicalClaim.attempt_id,
      worker_id: historicalClaim.worker_id,
      expected_lease_generation: historicalClaim.lease_generation,
      status: "cancelled",
      finalized_at: "2026-07-14T03:41:00Z",
      failure_class: "resource",
    })
    assert.throws(() => issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-unknown-certification", reservation_ref: "reservation://unknown-certification", issued_at: NOW,
      expires_at: "2026-07-14T04:08:00Z",
      bindings: { ...snapshot.bindings, instrument_status_provider_certification_hash: "9".repeat(64) },
      required_capabilities: snapshot.required_capabilities,
    }), /not registered/)
    const { certification_hash: _providerCertificationHash, ...providerCertificationBody } = PROVIDER_CERTIFICATION
    const expiredCertification = createReplayInstrumentStatusProviderCertificationSnapshot({
      ...providerCertificationBody,
      certification_id: "status-provider-certification-expired",
      certification_ref: "certification://status-provider/expired",
      certified_at: "2026-07-14T01:00:00Z",
      valid_until: "2026-07-14T03:00:00Z",
    })
    registerReplayInstrumentStatusProviderCertification(db, expiredCertification)
    assert.throws(() => issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-expired-certification", reservation_ref: "reservation://expired-certification", issued_at: NOW,
      expires_at: "2026-07-14T04:08:00Z",
      bindings: { ...snapshot.bindings, instrument_status_provider_certification_hash: expiredCertification.certification_hash },
      required_capabilities: snapshot.required_capabilities,
    }), /must be issued while provider certification is valid/)
    assert.throws(() => issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-requirement-drift", reservation_ref: "reservation://trial-reserved-requirement-drift", issued_at: NOW,
      expires_at: "2026-07-14T04:08:00Z",
      bindings: { ...snapshot.bindings, supplemental_requirement_set_hash: "9".repeat(64) },
      required_capabilities: snapshot.required_capabilities,
    }), /does not match the frozen Experiment Contract/)
    finishTrial(db, { trial_id: "trial-reserved", status: "completed", completed_at: NOW })
    assert.throws(() => issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-2", reservation_ref: "reservation://trial-reserved", issued_at: NOW,
      expires_at: "2026-07-14T04:08:00Z",
      bindings: snapshot.bindings, required_capabilities: snapshot.required_capabilities,
    }), /no longer reserved/)
  } finally {
    db.close()
  }
})

test("Control Plane fences Replay Attempt leases and permits retry only after a terminal or expired attempt", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db, false)
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    reserveTrial(db, {
      trial_id: "trial-attempt", trial_group_id: "group-1", experiment_id: "experiment-1", trial_ordinal: 1,
      candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }), identity_hash_policy_version: HASH_POLICY,
      run_id: "run-attempt", idempotency_key: "trial-attempt-key", created_at: NOW,
    })
    const reservation = issueTrialReservationSnapshot(db, {
      trial_id: "trial-attempt", reservation_id: "reservation-attempt", reservation_ref: "reservation://trial-attempt", issued_at: NOW,
      expires_at: "2026-07-14T04:08:00Z",
      bindings: {
        replay_idempotency_key: "replay-attempt-key", execution_spec_hash: "a".repeat(64), dataset_manifest_ref: "dataset://fixture", dataset_hash: "b".repeat(64), liquidity_capacity_attestation_hash: null,
        supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
        venue_risk_policy_schedule_hash: "c".repeat(64), instrument_spec_schedule_hash: "d".repeat(64), instrument_status_schedule_hash: "f".repeat(64), instrument_status_provenance_hash: "3".repeat(64),
        instrument_status_provider_capability_hash: PROVIDER_CAPABILITY_HASH, instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash, harness_hash: "e".repeat(64),
        assumptions_hash: "f".repeat(64), cost_policy_hash: "1".repeat(64), margin_policy_hash: "2".repeat(64),
        simulator_policy_version: "rd-replay-simulator-v7", execution_mode: "step",
      },
      required_capabilities: ["closed-candle", "step"],
    })
    assert.throws(() => claimReplayAttempt(db, {
      attempt_id: "attempt-expired", worker_id: "worker-expired", idempotency_key: "attempt-key-expired",
      request_hash: "9".repeat(64), claimed_at: reservation.expires_at, lease_expires_at: "2026-07-14T04:13:00Z",
      trial_reservation: reservation,
    }), /issued_at <= claimed_at < expires_at/)
    const first = claimReplayAttempt(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", idempotency_key: "attempt-key-1",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:00:00Z", lease_expires_at: "2026-07-14T04:05:00Z",
      trial_reservation: reservation,
    })
    assert.equal(first.attempt_ordinal, 1)
    assert.equal(first.lease_generation, 1)
    assert.throws(() => claimReplayAttempt(db, {
      attempt_id: "attempt-conflict", worker_id: "worker-2", idempotency_key: "attempt-key-conflict",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:01:00Z", lease_expires_at: "2026-07-14T04:06:00Z",
      trial_reservation: reservation,
    }), /already has active attempt/)
    const renewed = renewReplayAttemptLease(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", expected_lease_generation: 1,
      heartbeat_at: "2026-07-14T04:02:00Z", lease_expires_at: "2026-07-14T04:07:00Z",
    })
    assert.equal(renewed.status, "running")
    assert.equal(renewed.lease_generation, 2)
    const firstReceipt = recordReplayCheckpointReceipt(db, {
      receipt_id: "checkpoint-receipt-1", receipt_ref: "receipt://attempt-1/2",
      recorded_at: "2026-07-14T04:02:30Z", attempt_lease: renewed,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-1/diagnostic-checkpoint-commit-2-2-6666666666666666.json", sha256: "8".repeat(64),
        checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-2-2-6666666666666666.json",
        checkpoint_sha256: "7".repeat(64), checkpoint_hash: "6".repeat(64),
        producer_attempt_id: "attempt-1", producer_lease_generation: 2,
        storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, next_source_offset: 2,
      },
    })
    assert.equal(firstReceipt.next_source_offset, 2)
    assert.equal(firstReceipt.storage_policy_version, REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
    assert.throws(() => recordReplayCheckpointReceipt(db, {
      receipt_id: "checkpoint-receipt-unsupported-storage", receipt_ref: "receipt://attempt-1/unsupported-storage",
      recorded_at: "2026-07-14T04:02:30Z", attempt_lease: renewed,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-1/unsupported-storage-commit.json", sha256: "8".repeat(64),
        checkpoint_ref: "artifact://attempt-1/unsupported-storage-checkpoint.json",
        checkpoint_sha256: "7".repeat(64), checkpoint_hash: "6".repeat(64),
        producer_attempt_id: "attempt-1", producer_lease_generation: 2,
        storage_policy_version: "unsupported-storage-policy" as typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
        next_source_offset: 3,
      },
    }), /storage_policy_version is not supported/)
    assert.deepEqual(recordReplayCheckpointReceipt(db, {
      receipt_id: "checkpoint-receipt-1", receipt_ref: "receipt://attempt-1/2",
      recorded_at: "2026-07-14T04:02:30Z", attempt_lease: renewed,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-1/diagnostic-checkpoint-commit-2-2-6666666666666666.json", sha256: "8".repeat(64),
        checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-2-2-6666666666666666.json",
        checkpoint_sha256: "7".repeat(64), checkpoint_hash: "6".repeat(64),
        producer_attempt_id: "attempt-1", producer_lease_generation: 2,
        storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, next_source_offset: 2,
      },
    }), firstReceipt)
    assert.throws(() => recordReplayCheckpointReceipt(db, {
      receipt_id: "checkpoint-receipt-stale-lease", receipt_ref: "receipt://attempt-1/stale-lease",
      recorded_at: "2026-07-14T04:02:30Z", attempt_lease: first,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-1/stale-lease-commit.json", sha256: "2".repeat(64),
        checkpoint_ref: "artifact://attempt-1/stale-lease-checkpoint.json",
        checkpoint_sha256: "3".repeat(64), checkpoint_hash: "4".repeat(64),
        producer_attempt_id: "attempt-1", producer_lease_generation: 1,
        storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, next_source_offset: 3,
      },
    }), /lease does not match Control Plane state/)
    assert.throws(() => recordReplayCheckpointReceipt(db, {
      receipt_id: "checkpoint-receipt-rollback", receipt_ref: "receipt://attempt-1/1",
      recorded_at: "2026-07-14T04:02:40Z", attempt_lease: renewed,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-1/rollback-commit.json", sha256: "2".repeat(64),
        checkpoint_ref: "artifact://attempt-1/rollback-checkpoint.json",
        checkpoint_sha256: "3".repeat(64), checkpoint_hash: "4".repeat(64),
        producer_attempt_id: "attempt-1", producer_lease_generation: 2,
        storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, next_source_offset: 1,
      },
    }), /progress must advance monotonically/)
    assert.throws(() => db.query(`
      UPDATE rd_replay_checkpoint_receipt SET next_source_offset=3
      WHERE receipt_id='checkpoint-receipt-1'
    `).run(), /Replay Checkpoint Receipt is immutable/)
    assert.throws(() => finalizeReplayAttempt(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", expected_lease_generation: 1,
      status: "failed", finalized_at: "2026-07-14T04:03:00Z", failure_class: "deterministic_engine",
    }), /fencing token mismatch/)
    finalizeReplayAttempt(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", expected_lease_generation: 2,
      status: "cancelled", finalized_at: "2026-07-14T04:03:00Z", failure_class: "resource",
      diagnostic_checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-commit-2-2-6666666666666666.json",
      diagnostic_checkpoint_hash: "8".repeat(64),
    })
    assert.throws(() => finalizeReplayAttempt(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", expected_lease_generation: 2,
      status: "cancelled", finalized_at: "2026-07-14T04:03:00Z", failure_class: "resource",
      diagnostic_checkpoint_ref: "artifact://attempt-1/changed.json",
      diagnostic_checkpoint_hash: "8".repeat(64),
    }), /already terminal/)
    const second = claimReplayAttempt(db, {
      attempt_id: "attempt-2", worker_id: "worker-2", idempotency_key: "attempt-key-2",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:04:00Z", lease_expires_at: "2026-07-14T04:06:00Z",
      trial_reservation: reservation,
    })
    assert.equal(second.attempt_ordinal, 2)
    const resumeAuthorization = issueReplayResumeAuthorization(db, {
      authorization_id: "resume-authorization-1",
      authorization_ref: "authorization://replay-resume/1",
      issued_at: "2026-07-14T04:04:30Z",
      source_attempt_id: "attempt-1",
      source_checkpoint_receipt_id: "checkpoint-receipt-1",
      target_attempt_lease: second,
    })
    assert.equal(resumeAuthorization.source_attempt_status, "cancelled")
    assert.equal(resumeAuthorization.target_attempt_id, "attempt-2")
    assert.equal(resumeAuthorization.target_attempt_lease_hash.length, 64)
    assert.deepEqual(issueReplayResumeAuthorization(db, {
      authorization_id: "resume-authorization-1",
      authorization_ref: "authorization://replay-resume/1",
      issued_at: "2026-07-14T04:04:30Z",
      source_attempt_id: "attempt-1",
      source_checkpoint_receipt_id: "checkpoint-receipt-1",
      target_attempt_lease: second,
    }), resumeAuthorization)
    assert.throws(() => db.query(`
      UPDATE rd_replay_resume_authorization SET diagnostic_checkpoint_hash=$hash
      WHERE authorization_id='resume-authorization-1'
    `).run({ $hash: "7".repeat(64) }), /Replay Resume Authorization is immutable/)
    const secondReceipt = recordReplayCheckpointReceipt(db, {
      receipt_id: "checkpoint-receipt-2", receipt_ref: "receipt://attempt-2/3",
      recorded_at: "2026-07-14T04:05:00Z", attempt_lease: second,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-2/diagnostic-checkpoint-commit-1-3-3333333333333333.json", sha256: "5".repeat(64),
        checkpoint_ref: "artifact://attempt-2/diagnostic-checkpoint-1-3-3333333333333333.json",
        checkpoint_sha256: "4".repeat(64), checkpoint_hash: "3".repeat(64),
        producer_attempt_id: "attempt-2", producer_lease_generation: 1,
        storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, next_source_offset: 3,
      },
    })
    assert.equal(secondReceipt.attempt_id, "attempt-2")
    const secondLatestReceiptInput = {
      receipt_id: "checkpoint-receipt-3", receipt_ref: "receipt://attempt-2/4",
      recorded_at: "2026-07-14T04:05:30Z", attempt_lease: second,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-2/diagnostic-checkpoint-commit-1-4-bbbbbbbbbbbbbbbb.json", sha256: "9".repeat(64),
        checkpoint_ref: "artifact://attempt-2/diagnostic-checkpoint-1-4-bbbbbbbbbbbbbbbb.json",
        checkpoint_sha256: "a".repeat(64), checkpoint_hash: "b".repeat(64),
        producer_attempt_id: "attempt-2", producer_lease_generation: 1,
        storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, next_source_offset: 4,
      },
    }
    const secondLatestReceipt = recordReplayCheckpointReceipt(db, secondLatestReceiptInput)
    assert.equal(secondLatestReceipt.next_source_offset, 4)
    const third = claimReplayAttempt(db, {
      attempt_id: "attempt-3", worker_id: "worker-3", idempotency_key: "attempt-key-3",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:07:00Z", lease_expires_at: "2026-07-14T04:12:00Z",
      trial_reservation: reservation,
    })
    assert.equal(third.attempt_ordinal, 3)
    assert.equal((db.query("SELECT status FROM rd_replay_attempt WHERE attempt_id='attempt-2'").get() as { status: string }).status, "expired")
    assert.deepEqual(recordReplayCheckpointReceipt(db, secondLatestReceiptInput), secondLatestReceipt)
    assert.throws(() => issueReplayResumeAuthorization(db, {
      authorization_id: "resume-authorization-stale-receipt",
      authorization_ref: "authorization://replay-resume/stale-receipt",
      issued_at: "2026-07-14T04:07:30Z",
      source_attempt_id: "attempt-2",
      source_checkpoint_receipt_id: "checkpoint-receipt-2",
      target_attempt_lease: third,
    }), /latest Checkpoint Receipt/)
    const crashResumeAuthorization = issueReplayResumeAuthorization(db, {
      authorization_id: "resume-authorization-2",
      authorization_ref: "authorization://replay-resume/2",
      issued_at: "2026-07-14T04:07:30Z",
      source_attempt_id: "attempt-2",
      source_checkpoint_receipt_id: "checkpoint-receipt-3",
      target_attempt_lease: third,
    })
    assert.equal(crashResumeAuthorization.source_attempt_status, "expired")
    assert.equal(crashResumeAuthorization.diagnostic_checkpoint_hash, "9".repeat(64))
    assert.throws(() => finalizeReplayAttempt(db, {
      attempt_id: "attempt-2", worker_id: "worker-2", expected_lease_generation: 1,
      status: "cancelled", finalized_at: "2026-07-14T04:05:00Z", failure_class: "resource",
    }), /already terminal/)
    finalizeReplayAttempt(db, {
      attempt_id: "attempt-3", worker_id: "worker-3", expected_lease_generation: 1,
      status: "completed", finalized_at: "2026-07-14T04:10:00Z",
      result_hash: "3".repeat(64), artifact_ref: "artifact://attempt-3", artifact_hash: "4".repeat(64),
      terminal_checkpoint_hash: "5".repeat(64),
    })
    assert.throws(() => claimReplayAttempt(db, {
      attempt_id: "attempt-4", worker_id: "worker-4", idempotency_key: "attempt-key-4",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:11:00Z", lease_expires_at: "2026-07-14T04:16:00Z",
      trial_reservation: reservation,
    }), /issued_at <= claimed_at < expires_at/)
    assert.throws(() => db.query("UPDATE rd_replay_attempt SET artifact_ref='changed' WHERE attempt_id='attempt-3'").run(), /terminal Replay Attempt is immutable/)
  } finally {
    db.close()
  }
})

test("Control Plane cancellation authority separately fences future claims and one active Attempt", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db, false)
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    reserveTrial(db, {
      trial_id: "trial-cancellation", trial_group_id: "group-1", experiment_id: "experiment-1", trial_ordinal: 1,
      candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }), identity_hash_policy_version: HASH_POLICY,
      run_id: "run-cancellation", idempotency_key: "trial-cancellation-key", created_at: NOW,
    })
    const reservation = issueTrialReservationSnapshot(db, {
      trial_id: "trial-cancellation", reservation_id: "reservation-cancellation", reservation_ref: "reservation://trial-cancellation",
      issued_at: NOW, expires_at: "2026-07-14T04:08:00Z",
      bindings: {
        replay_idempotency_key: "replay-cancellation-key", execution_spec_hash: "a".repeat(64), dataset_manifest_ref: "dataset://fixture", dataset_hash: "b".repeat(64), liquidity_capacity_attestation_hash: null,
        supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
        venue_risk_policy_schedule_hash: "c".repeat(64), instrument_spec_schedule_hash: "d".repeat(64), instrument_status_schedule_hash: "f".repeat(64), instrument_status_provenance_hash: "3".repeat(64),
        instrument_status_provider_capability_hash: PROVIDER_CAPABILITY_HASH, instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash, harness_hash: "e".repeat(64),
        assumptions_hash: "f".repeat(64), cost_policy_hash: "1".repeat(64), margin_policy_hash: "2".repeat(64),
        simulator_policy_version: "rd-replay-simulator-v7", execution_mode: "step",
      },
      required_capabilities: ["closed-candle", "step"],
    })
    const reservationCancellation = createReplayReservationCancellationSnapshot({
      schema_version: REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION,
      cancellation_id: "reservation-cancellation-1", cancellation_ref: "cancellation://reservation/1",
      status: "cancelled", recorded_at: "2026-07-14T03:30:00Z", effective_at: "2026-07-14T03:50:00Z",
      authority_id: "research-control-plane", cancellation_policy_version: "rd-replay-cancellation-v1",
      reason_code: "provider_certification_incident", trial_id: reservation.identity.trial_id, run_id: reservation.run_id,
      reservation_ref: reservation.reservation_ref, reservation_hash: hashTrialReservationSnapshot(reservation),
      scope: "future_attempt_claims",
    })
    assert.deepEqual(registerReplayReservationCancellation(db, reservationCancellation, reservation), reservationCancellation)
    assert.deepEqual(registerReplayReservationCancellation(db, reservationCancellation, reservation), reservationCancellation)
    const { cancellation_hash: _reservationCancellationHash, ...reservationCancellationBody } = reservationCancellation
    assert.throws(() => registerReplayReservationCancellation(db, createReplayReservationCancellationSnapshot({
      ...reservationCancellationBody,
      cancellation_id: "reservation-cancellation-competing",
      cancellation_ref: "cancellation://reservation/competing",
      reason_code: "policy_withdrawal",
    }), reservation), /different cancellation/)
    const first = claimReplayAttempt(db, {
      attempt_id: "attempt-cancellation-1", worker_id: "worker-cancellation", idempotency_key: "attempt-cancellation-key",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T03:40:00Z", lease_expires_at: "2026-07-14T04:05:00Z",
      trial_reservation: reservation,
    })
    const renewed = renewReplayAttemptLease(db, {
      attempt_id: first.attempt_id, worker_id: first.worker_id, expected_lease_generation: first.lease_generation,
      heartbeat_at: "2026-07-14T03:45:00Z", lease_expires_at: "2026-07-14T04:07:00Z",
    })
    assert.equal(claimReplayAttempt(db, {
      attempt_id: first.attempt_id, worker_id: first.worker_id, idempotency_key: "attempt-cancellation-key",
      request_hash: first.request_hash, claimed_at: "2026-07-14T04:00:00Z", lease_expires_at: renewed.lease_expires_at,
      trial_reservation: reservation,
    }).attempt_id, first.attempt_id)
    const attemptCancellationBody = {
      schema_version: REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
      cancellation_id: "attempt-cancellation-authority-1", cancellation_ref: "cancellation://attempt/1",
      status: "cancelled" as const, recorded_at: "2026-07-14T03:46:00Z",
      authority_id: "research-control-plane", cancellation_policy_version: "rd-replay-cancellation-v1",
      reason_code: "provider_certification_incident" as const, trial_id: renewed.trial_id, run_id: renewed.run_id,
      reservation_ref: renewed.reservation_ref, reservation_hash: renewed.reservation_hash, request_hash: renewed.request_hash,
      attempt_id: renewed.attempt_id, attempt_ordinal: renewed.attempt_ordinal, worker_id: renewed.worker_id,
      target_lease_generation: renewed.lease_generation, scope: "active_attempt" as const,
    }
    assert.throws(() => cancelReplayAttemptByAuthority(db, createReplayAttemptCancellationSnapshot({
      ...attemptCancellationBody,
      cancellation_id: "attempt-cancellation-stale", cancellation_ref: "cancellation://attempt/stale",
      target_lease_generation: 1,
    })), /generation is stale/)
    const attemptCancellation = createReplayAttemptCancellationSnapshot(attemptCancellationBody)
    assert.deepEqual(cancelReplayAttemptByAuthority(db, attemptCancellation), attemptCancellation)
    assert.deepEqual(cancelReplayAttemptByAuthority(db, attemptCancellation), attemptCancellation)
    assert.deepEqual(readReplayAttemptCancellation(db, renewed.attempt_id), attemptCancellation)
    const coordinationPort = createSqliteReplayCancellationCoordinationPort(db)
    assert.deepEqual(coordinationPort.poll({
      attempt_lease: renewed,
      observed_at: "2026-07-14T03:47:00Z",
    }), {
      command: "cancel",
      attempt_lease: renewed,
      observed_at: "2026-07-14T03:47:00Z",
      attempt_cancellation: attemptCancellation,
    })
    assert.throws(() => resolveReplayAttemptCancellationDirective(
      db,
      renewed,
      renewed.lease_expires_at,
    ), /missed the worker lease window/)
    const observationBody = {
      schema_version: REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION,
      observation_id: "attempt-cancellation-observation-1",
      observation_ref: "cancellation-observation://attempt/1",
      status: "observed" as const,
      observed_at: "2026-07-14T03:47:00Z",
      cancellation_id: attemptCancellation.cancellation_id,
      cancellation_ref: attemptCancellation.cancellation_ref,
      cancellation_hash: attemptCancellation.cancellation_hash,
      trial_id: attemptCancellation.trial_id,
      run_id: attemptCancellation.run_id,
      reservation_ref: attemptCancellation.reservation_ref,
      reservation_hash: attemptCancellation.reservation_hash,
      request_hash: attemptCancellation.request_hash,
      attempt_id: attemptCancellation.attempt_id,
      attempt_ordinal: attemptCancellation.attempt_ordinal,
      worker_id: attemptCancellation.worker_id,
      target_lease_generation: attemptCancellation.target_lease_generation,
      outcome_schema_version: "trade.rd-replay-run-outcome.v35" as const,
      outcome_status: "cancelled" as const,
      outcome_failure_code: "execution-cancelled-at-checkpoint" as const,
      partial_result_published: false as const,
    }
    assert.throws(() => recordReplayAttemptCancellationObservation(
      db,
      createReplayAttemptCancellationObservationSnapshot({
        ...observationBody,
        observation_id: "attempt-cancellation-observation-too-early",
        observation_ref: "cancellation-observation://attempt/too-early",
        observed_at: "2026-07-14T03:45:00Z",
      }),
      "2026-07-14T03:48:00Z",
    ), /cannot be observed before/)
    const observation = createReplayAttemptCancellationObservationSnapshot(observationBody)
    assert.deepEqual(coordinationPort.inspectRecovery({ observation }), {
      status: "pending",
      observation_hash: observation.observation_hash,
    })
    assert.throws(() => recordReplayAttemptCancellationObservation(
      db,
      observation,
      "2026-07-14T03:46:00Z",
    ), /registered before worker observation/)
    coordinationPort.acknowledge({ observation, registered_at: "2026-07-14T03:48:00Z" })
    coordinationPort.acknowledge({ observation, registered_at: "2026-07-14T03:49:00Z" })
    assert.deepEqual(coordinationPort.inspectRecovery({ observation }), {
      status: "already_registered",
      observation_hash: observation.observation_hash,
    })
    assert.deepEqual(readReplayAttemptCancellationObservation(db, renewed.attempt_id), observation)
    assert.deepEqual(readReplayAttemptCancellationLatency(db, renewed.attempt_id), {
      cancellation_recorded_at: "2026-07-14T03:46:00Z",
      worker_observed_at: "2026-07-14T03:47:00Z",
      control_plane_registered_at: "2026-07-14T03:48:00Z",
      authority_to_observation_ms: 60_000,
      observation_to_registration_ms: 60_000,
      authority_to_registration_ms: 120_000,
    })
    assert.throws(() => recordReplayAttemptCancellationObservation(
      db,
      createReplayAttemptCancellationObservationSnapshot({
        ...observationBody,
        observation_id: "attempt-cancellation-observation-competing",
        observation_ref: "cancellation-observation://attempt/competing",
        observed_at: "2026-07-14T03:48:00Z",
      }),
      "2026-07-14T03:49:00Z",
    ), /different observation/)
    const { cancellation_hash: _attemptCancellationHash, ...storedAttemptCancellationBody } = attemptCancellation
    assert.throws(() => cancelReplayAttemptByAuthority(db, createReplayAttemptCancellationSnapshot({
      ...storedAttemptCancellationBody,
      cancellation_id: "attempt-cancellation-competing",
      cancellation_ref: "cancellation://attempt/competing",
      reason_code: "policy_withdrawal",
    })), /different authority cancellation/)
    assert.throws(() => renewReplayAttemptLease(db, {
      attempt_id: renewed.attempt_id, worker_id: renewed.worker_id, expected_lease_generation: renewed.lease_generation,
      heartbeat_at: "2026-07-14T03:47:00Z", lease_expires_at: "2026-07-14T04:08:00Z",
    }), /terminal/)
    assert.throws(() => recordReplayCheckpointReceipt(db, {
      receipt_id: "checkpoint-after-authority-cancel", receipt_ref: "receipt://attempt-cancellation/after-cancel",
      recorded_at: "2026-07-14T03:47:00Z", attempt_lease: renewed,
      diagnostic_checkpoint_commit: {
        ref: "artifact://attempt-cancellation/commit.json", sha256: "8".repeat(64),
        checkpoint_ref: "artifact://attempt-cancellation/checkpoint.json", checkpoint_sha256: "7".repeat(64),
        checkpoint_hash: "6".repeat(64), producer_attempt_id: renewed.attempt_id,
        producer_lease_generation: renewed.lease_generation,
        storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, next_source_offset: 1,
      },
    }), /active Attempt/)
    assert.throws(() => finalizeReplayAttempt(db, {
      attempt_id: renewed.attempt_id, worker_id: renewed.worker_id,
      expected_lease_generation: renewed.lease_generation, status: "completed", finalized_at: "2026-07-14T03:47:00Z",
      result_hash: "5".repeat(64), artifact_ref: "artifact://cancelled", artifact_hash: "4".repeat(64),
      terminal_checkpoint_hash: "3".repeat(64),
    }), /already terminal/)
    assert.throws(() => claimReplayAttempt(db, {
      attempt_id: "attempt-cancellation-2", worker_id: "worker-cancellation-2", idempotency_key: "attempt-cancellation-key-2",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:00:00Z", lease_expires_at: "2026-07-14T04:05:00Z",
      trial_reservation: reservation,
    }), /Reservation was cancelled/)
    assert.throws(() => db.query(`
      UPDATE rd_replay_reservation_cancellation SET reason_code='policy_withdrawal'
      WHERE cancellation_id='reservation-cancellation-1'
    `).run(), /immutable/)
    assert.throws(() => db.query(`
      UPDATE rd_replay_attempt_cancellation SET reason_code='policy_withdrawal'
      WHERE cancellation_id='attempt-cancellation-authority-1'
    `).run(), /immutable/)
    assert.throws(() => db.query(`
      UPDATE rd_replay_attempt_cancellation_observation SET observed_at='2026-07-14T03:49:00Z'
      WHERE observation_id='attempt-cancellation-observation-1'
    `).run(), /immutable/)
  } finally {
    db.close()
  }
})

test("knowledge evidence can only supersede evidence on the same edge", () => {
  const db = openDb()
  try {
    db.exec(`
      INSERT INTO rd_knowledge_node VALUES
        ('kg-1', 'hypothesis', 'h1', 'h1', 'H1', NULL, '${NOW}', '${NOW}'),
        ('kg-2', 'result', 'r1', 'r1', 'R1', NULL, '${NOW}', '${NOW}'),
        ('kg-3', 'result', 'r2', 'r2', 'R2', NULL, '${NOW}', '${NOW}');
      INSERT INTO rd_knowledge_edge VALUES
        ('edge-1', 'kg-2', 'kg-1', 'supports', NULL, '${NOW}'),
        ('edge-2', 'kg-3', 'kg-1', 'refutes', NULL, '${NOW}');
      INSERT INTO rd_knowledge_edge_evidence(
        edge_evidence_id, edge_id, evidence_ref, evidence_type, observed_at,
        idempotency_key, created_at
      ) VALUES ('evidence-1', 'edge-1', 'artifact://r1', 'result', '${NOW}', 'kg-key-1', '${NOW}');
    `)
    assert.throws(() => db.query(`
      INSERT INTO rd_knowledge_edge_evidence(
        edge_evidence_id, edge_id, evidence_ref, evidence_type, observed_at,
        supersedes_edge_evidence_id, supersedes_edge_id, idempotency_key, created_at
      ) VALUES (
        'evidence-2', 'edge-2', 'artifact://r2', 'result', $now,
        'evidence-1', 'edge-1', 'kg-key-2', $now
      )
    `).run({ $now: NOW }), /CHECK constraint/)
  } finally {
    db.close()
  }
})

test("suspend and resume preserve prior state, require a fresh fingerprint, and projection rebuild is deterministic", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db)
    applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 2,
      trigger_type: "system", trigger_value: "fingerprint_stale",
      trigger_ref: "fingerprint://stale", event_id: "event-suspend",
      idempotency_key: "event-key-suspend", created_at: NOW,
    })
    const suspended = db.query(`
      SELECT lifecycle_state, suspended_from_state FROM rd_experiment_contract
      WHERE experiment_id='experiment-1'
    `).get()
    assert.deepEqual(suspended, { lifecycle_state: "suspended", suspended_from_state: "discovery" })
    assert.throws(() => applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 3,
      trigger_type: "system", trigger_value: "resume_discovery",
      trigger_ref: "fingerprint://fresh", event_id: "event-resume-bad",
      idempotency_key: "event-key-resume-bad", created_at: NOW,
    }), /fresh evidence fingerprint/)
    applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 3,
      trigger_type: "system", trigger_value: "resume_discovery",
      trigger_ref: "fingerprint://fresh", event_id: "event-resume",
      idempotency_key: "event-key-resume", fresh_fingerprint: true, created_at: NOW,
    })
    applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 3,
      trigger_type: "system", trigger_value: "resume_discovery",
      trigger_ref: "fingerprint://fresh", event_id: "event-resume",
      idempotency_key: "event-key-resume", fresh_fingerprint: true, created_at: NOW,
    })
    assert.throws(
      () => db.query("UPDATE rd_experiment_contract SET lifecycle_version=99 WHERE experiment_id='experiment-1'").run(),
      /latest authoritative event/,
    )
    db.exec("DROP TRIGGER require_lifecycle_projection_event")
    db.query("UPDATE rd_experiment_contract SET lifecycle_version=99 WHERE experiment_id='experiment-1'").run()
    ensureResearchStateSchema(db)
    assert.throws(() => assertLifecycleProjection(db, "experiment-1"), /does not match/)
    rebuildLifecycleProjection(db, "experiment-1", NOW)
    assert.doesNotThrow(() => assertLifecycleProjection(db, "experiment-1"))
  } finally {
    db.close()
  }
})

test("blocker fact and lifecycle projection commit atomically", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db, false)
    openBlockerAndTransition(db, {
      blocker_id: "blocker-1", experiment_id: "experiment-1", blocker_type: "external_data",
      detail_ref: "data://gap", idempotency_key: "blocker-key-1", created_at: NOW,
      expected_version: 1, lifecycle_event_id: "event-blocked", lifecycle_idempotency_key: "event-key-blocked",
    })
    assert.equal((db.query("SELECT lifecycle_state FROM rd_experiment_contract WHERE experiment_id='experiment-1'").get() as { lifecycle_state: string }).lifecycle_state, "blocked")
    resolveBlockerAndTransition(db, {
      blocker_id: "blocker-1", experiment_id: "experiment-1", close_reason: "resolved", closed_at: NOW,
      expected_version: 2, lifecycle_event_id: "event-unblocked", lifecycle_idempotency_key: "event-key-unblocked",
    })
    assert.equal((db.query("SELECT lifecycle_state FROM rd_experiment_contract WHERE experiment_id='experiment-1'").get() as { lifecycle_state: string }).lifecycle_state, "proposed")
    assert.doesNotThrow(() => assertLifecycleProjection(db, "experiment-1"))
  } finally {
    db.close()
  }
})

function decisionObservationDerivationFixture(
  request: ReplayExecutionRequest,
  wire: ReplaySourceEventWireManifest,
) {
  const scheduleEntry = request.decision_schedule.entries[0]!
  const emptyHash = canonicalHash([])
  const closedBarWire = wire.wire_events.find((event) => event.kind === "bar_range")!
  const closedBar = structuredClone(closedBarWire.payload) as ReplayMarketBar
  const observation = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_RECORD_SCHEMA_VERSION,
    observation_id: `source-event-decision-observation-${closedBarWire.wire_event_id}`,
    observation_ordinal: 0,
    payload_record_id: "pit-payload-record-admission-fixture",
    payload_record_hash: canonicalHash({ wire_event_id: closedBarWire.wire_event_id }),
    transition_id: "visibility-transition-admission-fixture",
    wire_event_id: closedBarWire.wire_event_id,
    source_kind: "ohlcv" as const,
    effective_time: closedBarWire.effective_time,
    availability_at: closedBarWire.availability_at,
    observation_type: "closed_bar" as const,
    observation: closedBar,
    observation_hash: canonicalHash(closedBar),
    payload_hash: closedBarWire.payload_hash,
    source_envelope_hash: closedBarWire.source_envelope_hash,
    projection_effect: "read_only_observation" as const,
    execution_effect: "none" as const,
  }
  const projection = createReplaySourceEventDecisionObservationProjection({
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_PROJECTION_SCHEMA_VERSION,
    projection_id: "decision-observation-projection-admission-fixture",
    projection_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_POLICY_VERSION,
    field_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION,
    scope: "pre_integration_non_economic_decision_observation_projection",
    projection_purpose: "candidate_decision_input_fields_only",
    decision_input_compatibility: "not_asserted",
    decision_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    harness_compatibility: "not_bound",
    runner_compatibility: "not_bound",
    future_payload_access: "forbidden",
    bar_open_visibility: "open_only_no_range_fields",
    closed_bar_visibility: "full_ohlcv_only_when_closed",
    payload_view_id: "pit-payload-view-admission-fixture",
    payload_view_hash: "6".repeat(64),
    wire_manifest_id: wire.wire_manifest_id,
    wire_manifest_hash: wire.manifest_hash,
    cut_id: "visibility-cut-admission-fixture",
    cut_hash: "7".repeat(64),
    as_of_time: scheduleEntry.decision_time,
    observation_count: 1,
    observations: [observation],
    observations_hash: canonicalHash([observation]),
    observation_values_hash: canonicalHash([observation.observation]),
    source_observation_counts: { instrument_status: 0, funding: 0, aggregate_trade: 0, ohlcv: 1 },
    future_transition_count: 0,
    future_transition_ids_hash: emptyHash,
  })
  const bindingBodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_POLICY_VERSION,
    scope: "pre_integration_non_economic_schedule_observation_binding" as const,
    binding_purpose: "prove_frozen_decision_time_equals_observation_as_of_time" as const,
    schedule_authority: "external_frozen_reference_only" as const,
    schedule_validation: "structural_hash_and_selected_entry_only" as const,
    selected_effect_handling: "opaque_frozen_label_not_executed" as const,
    observation_authority: "whitelisted_non_economic_projection_only" as const,
    time_binding_rule: "observation_as_of_time_equals_selected_decision_time" as const,
    harness_invocation: "forbidden" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    decision_schedule_schema_version: request.decision_schedule.schema_version,
    decision_schedule_hash: request.decision_schedule_hash,
    decision_schedule_entry_count: request.decision_schedule.entries.length,
    selected_decision_sequence: scheduleEntry.decision_sequence,
    selected_decision_time: scheduleEntry.decision_time,
    selected_expected_effect: scheduleEntry.expected_effect,
    selected_schedule_entry_hash: canonicalHash(scheduleEntry),
    observation_projection_id: projection.projection_id,
    observation_projection_hash: projection.projection_hash,
    observation_field_policy_version: projection.field_policy_version,
    observation_as_of_time: projection.as_of_time,
    observation_count: projection.observation_count,
    payload_view_hash: projection.payload_view_hash,
    cut_hash: projection.cut_hash,
  }
  const binding = createReplaySourceEventDecisionScheduleObservationBinding({
    ...bindingBodyWithoutId,
    binding_id: `source-event-decision-schedule-observation-${canonicalHash(bindingBodyWithoutId).slice(0, 24)}`,
  })
  const setBodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_SCHEMA_VERSION,
    binding_set_policy_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_POLICY_VERSION,
    scope: "pre_integration_non_economic_schedule_observation_binding_set" as const,
    set_purpose: "prove_complete_frozen_schedule_observation_coverage" as const,
    schedule_authority: "external_frozen_reference_only" as const,
    schedule_validation: "structural_hash_and_member_lineage_only" as const,
    completeness_rule: "exactly_one_binding_per_schedule_entry" as const,
    ordering_rule: "decision_sequence_ascending" as const,
    duplicate_binding_policy: "reject" as const,
    cross_schedule_binding_policy: "forbidden" as const,
    selected_effect_handling: "opaque_frozen_label_not_executed" as const,
    harness_invocation: "forbidden" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    decision_schedule_schema_version: request.decision_schedule.schema_version,
    decision_schedule_hash: request.decision_schedule_hash,
    decision_schedule_entry_count: 1,
    binding_count: 1,
    bindings: [binding],
    bindings_hash: canonicalHash([binding]),
    binding_hashes_hash: canonicalHash([binding.binding_hash]),
    observation_projection_hashes_hash: canonicalHash([projection.projection_hash]),
    first_decision_time: scheduleEntry.decision_time,
    last_decision_time: scheduleEntry.decision_time,
  }
  const bindingSet = createReplaySourceEventDecisionScheduleObservationBindingSet({
    ...setBodyWithoutId,
    binding_set_id: `source-event-decision-schedule-observation-set-${canonicalHash(setBodyWithoutId).slice(0, 24)}`,
  })
  const bundleBodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_SCHEMA_VERSION,
    bundle_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_POLICY_VERSION,
    scope: "pre_integration_non_economic_decision_observation_bundle" as const,
    bundle_purpose: "portable_schedule_bound_observation_payloads" as const,
    projection_payload_rule: "exactly_one_projection_per_binding" as const,
    ordering_rule: "binding_sequence_ascending" as const,
    payload_portability: "projection_payloads_embedded_with_external_parent_lineage" as const,
    parent_lineage_requirement: "mandatory_for_authoritative_rebuild" as const,
    decision_input_compatibility: "not_asserted" as const,
    harness_compatibility: "not_bound" as const,
    harness_invocation: "forbidden" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    artifact_compatibility: "not_bound" as const,
    runner_compatibility: "not_bound" as const,
    decision_schedule_hash: request.decision_schedule_hash,
    decision_schedule_entry_count: 1,
    binding_set_id: bindingSet.binding_set_id,
    binding_set_hash: bindingSet.binding_set_hash,
    binding_set: bindingSet,
    projection_count: 1,
    projections: [projection],
    projections_hash: canonicalHash([projection]),
    projection_ids_hash: canonicalHash([projection.projection_id]),
    projection_hashes_hash: canonicalHash([projection.projection_hash]),
    observation_values_hashes_hash: canonicalHash([projection.observation_values_hash]),
    first_as_of_time: projection.as_of_time,
    last_as_of_time: projection.as_of_time,
  }
  const bundle = createReplaySourceEventDecisionObservationBundle({
    ...bundleBodyWithoutId,
    bundle_id: `source-event-decision-observation-bundle-${canonicalHash(bundleBodyWithoutId).slice(0, 24)}`,
  })
  const boundary = createReplaySourceEventDecisionObservationBundleDerivationBoundary({
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_BOUNDARY_SCHEMA_VERSION,
    decision_sequence: binding.selected_decision_sequence,
    decision_time: binding.selected_decision_time,
    visibility_cut_id: projection.cut_id,
    visibility_cut_hash: projection.cut_hash,
    pit_payload_view_id: projection.payload_view_id,
    pit_payload_view_hash: projection.payload_view_hash,
    observation_projection_id: projection.projection_id,
    observation_projection_hash: projection.projection_hash,
    schedule_binding_id: binding.binding_id,
    schedule_binding_hash: binding.binding_hash,
    visible_transition_count: projection.observation_count,
    observation_count: projection.observation_count,
    observations_hash: projection.observations_hash,
    observation_values_hash: projection.observation_values_hash,
    future_transition_count: projection.future_transition_count,
    future_transition_ids_hash: projection.future_transition_ids_hash,
  })
  const attestationBodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_SCHEMA_VERSION,
    derivation_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_POLICY_VERSION,
    scope: "pre_integration_non_economic_observation_bundle_derivation" as const,
    attestation_purpose: "prove_bundle_rebuild_from_complete_parent_chain" as const,
    derivation_chain: "wire_gate_trace_cursor_cut_view_projection_binding_bundle" as const,
    certification_result: "certified_against_supplied_parent_chain" as const,
    common_parent_rule: "one_wire_gate_trace_cursor_for_all_boundaries" as const,
    independent_verification: "external_parent_replay_required" as const,
    portability: "hash_summary_without_parent_payload_duplication" as const,
    control_plane_admission_compatibility: "not_bound" as const,
    decision_input_compatibility: "not_asserted" as const,
    harness_compatibility: "not_bound" as const,
    harness_invocation: "forbidden" as const,
    runner_compatibility: "not_bound" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    wire_manifest_id: wire.wire_manifest_id,
    wire_manifest_hash: wire.manifest_hash,
    ordering_attestation_id: wire.ordering_attestation_id,
    ordering_attestation_hash: wire.ordering_attestation_hash,
    pre_execution_gate_id: "source-event-wire-gate-contract-fixture",
    pre_execution_gate_hash: "8".repeat(64),
    candidate_trace_id: "source-event-candidate-trace-contract-fixture",
    candidate_trace_hash: "9".repeat(64),
    availability_cursor_id: "source-event-availability-cursor-contract-fixture",
    availability_cursor_hash: "a".repeat(64),
    decision_schedule_hash: request.decision_schedule_hash,
    bundle_id: bundle.bundle_id,
    bundle_hash: bundle.bundle_hash,
    binding_set_id: bundle.binding_set_id,
    binding_set_hash: bundle.binding_set_hash,
    boundary_count: 1,
    boundaries: [boundary],
    boundaries_hash: canonicalHash([boundary]),
    cut_hashes_hash: canonicalHash([boundary.visibility_cut_hash]),
    payload_view_hashes_hash: canonicalHash([boundary.pit_payload_view_hash]),
    projection_hashes_hash: canonicalHash([boundary.observation_projection_hash]),
    binding_hashes_hash: canonicalHash([boundary.schedule_binding_hash]),
    first_decision_time: boundary.decision_time,
    last_decision_time: boundary.decision_time,
  }
  return {
    bundle,
    derivation_attestation: createReplaySourceEventDecisionObservationBundleDerivationAttestation({
      ...attestationBodyWithoutId,
      attestation_id: `source-event-decision-observation-derivation-${canonicalHash(attestationBodyWithoutId).slice(0, 24)}`,
    }),
  }
}

function decisionObservationRequest(reservation: ReturnType<typeof issueTrialReservationSnapshot>): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side: "long",
    quantity: 1,
    signal_time: "2026-07-14T03:05:00Z",
    earliest_executable_time: "2026-07-14T03:10:00Z",
    stop_price: 95,
    target_price: 105,
    entry_execution: { order_type: "market" },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const decisionMarketInputRequirement = {
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
    run_id: reservation.run_id,
    idempotency_key: reservation.bindings.replay_idempotency_key,
    experiment_id: reservation.identity.experiment_id,
    trial_group_id: reservation.identity.trial_group_id,
    trial_group_hash: reservation.identity.trial_group_hash,
    trial_id: reservation.identity.trial_id,
    candidate_id: reservation.identity.candidate_id,
    candidate_hash: reservation.identity.candidate_hash,
    identity_hash_policy_version: reservation.identity.identity_hash_policy_version,
    experiment_contract_hash: reservation.identity.experiment_contract_hash,
    trial_reservation_ref: reservation.reservation_ref,
    trial_reservation_hash: hashTrialReservationSnapshot(reservation),
    dataset_manifest_ref: reservation.bindings.dataset_manifest_ref,
    dataset_hash: reservation.bindings.dataset_hash,
    supplemental_facts_hash: reservation.bindings.supplemental_facts_hash,
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: decisionMarketInputRequirement,
    decision_market_input_requirement_hash: canonicalHash(decisionMarketInputRequirement),
    decision_schedule: decisionSchedule,
    decision_schedule_hash: canonicalHash(decisionSchedule),
    venue_risk_policy_schedule_hash: reservation.bindings.venue_risk_policy_schedule_hash,
    instrument_spec_schedule_hash: reservation.bindings.instrument_spec_schedule_hash,
    instrument_status_schedule_hash: reservation.bindings.instrument_status_schedule_hash,
    instrument_status_provenance_hash: reservation.bindings.instrument_status_provenance_hash,
    instrument_status_provider_capability_hash: reservation.bindings.instrument_status_provider_capability_hash,
    instrument_status_provider_certification_hash: reservation.bindings.instrument_status_provider_certification_hash,
    harness_hash: reservation.bindings.harness_hash,
    assumptions_hash: reservation.bindings.assumptions_hash,
    symbol: "BTCUSDT",
    timeframe: "5m",
    initial_cash: 1_000,
    order,
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION,
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      gap_fill_policy: "worse_open",
      position_accounting: "average_cost",
      funding_timing: "exact_event",
      end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: {
      policy_id: "fixture",
      version: "rd-replay-isolated-margin-v7",
      mode: "isolated",
      collateral_asset: "USDT",
      isolated_collateral: 1_000,
      initial_margin_rate: 0.1,
      maintenance_tier: {
        tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: "5".repeat(64),
        notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0,
      },
      cashflow_scope: "position_attributed",
      collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat",
      settled_cashflow_account: "isolated_margin_collateral",
      observation_scope: "source_event_path",
      mark_source_policy: "complete_exact_mark_else_ohlcv_adverse",
      maintenance_trigger: "margin_balance_below_maintenance_requirement",
      breach_terminal_priority: "risk_before_strategy_exit",
      breach_evidence: "first_observed_source_event",
      maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure",
      liquidation: "simulated_full_close",
      liquidation_trigger_sources: "mark_or_funding_mark",
      liquidation_execution_price: "trigger_mark_adverse_slippage",
      liquidation_quantity: "full_position",
      liquidation_order_priority: "cancel_strategy_exits_before_forced_fill",
      liquidation_deficit: "fail_without_result",
    },
    random_seed: 1,
  }
}

function decisionObservationManifest(request: ReplayExecutionRequest): ReplayDatasetManifest {
  const status = {
    schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "status-decision-input-1",
    venue_id: "binance-usdm",
    symbol: request.symbol,
    status: "trading" as const,
    effective_at: "2020-01-01T00:00:00Z",
    valid_until: null,
    observed_at: "2026-07-14T03:00:00Z",
    source_ref: "archive:status:decision-input-1",
    source_hash: "6".repeat(64),
  }
  const statusProvenance = createReplayInstrumentStatusProvenance({
    producer_domain: "market-data-products",
    producer_id: "fixture-status-provider",
    producer_version: "v1",
    producer_build_hash: "7".repeat(64),
    provider_capability_hash: request.instrument_status_provider_capability_hash,
    provider_certification_ref: "certification://status-provider/v1",
    provider_certification_hash: request.instrument_status_provider_certification_hash,
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    normalization_policy_version: "status-normalization-v1",
    normalization_policy_hash: "8".repeat(64),
    completeness: "complete_history",
    coverage_start: "2020-01-01T00:00:00Z",
    coverage_end: "2030-01-01T00:00:00Z",
    source_observed_through: "2026-07-14T03:10:00Z",
    produced_at: "2026-07-14T03:10:00Z",
    source_ref: "archive:status:decision-input",
    source_hash: "9".repeat(64),
    source_record_count: 1,
    status_epochs: [status],
  })
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-decision-input-1",
    manifest_ref: request.dataset_manifest_ref,
    data_hash: request.dataset_hash,
    dataset_kind: "ohlcv",
    symbol: request.symbol,
    timeframe: request.timeframe,
    interval_ms: 300_000,
    row_count: 1,
    first_open_time: "2026-07-14T03:00:00Z",
    last_close_time: "2026-07-14T03:05:00Z",
    observed_through: "2026-07-14T03:10:00Z",
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
      requirement_set_hash: request.supplemental_requirement_set_hash,
    },
    venue_risk_policy_epochs: [{
      schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
      snapshot_id: "risk-decision-input-1",
      venue_id: "binance-usdm",
      symbol: request.symbol,
      effective_at: "2020-01-01T00:00:00Z",
      valid_until: null,
      observed_at: "2026-07-14T03:00:00Z",
      source_ref: "archive:risk:decision-input-1",
      source_hash: "a".repeat(64),
      initial_margin_rate: request.margin_policy.initial_margin_rate,
      maintenance_tier: structuredClone(request.margin_policy.maintenance_tier),
      liquidation_fee_bps: request.cost_policy.liquidation_fee_bps,
    }],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z",
      trading_enabled_at: "2020-01-01T00:00:00Z",
      delisted_at: null,
      status_history: "complete",
      status_epochs: [status],
      status_provenance: statusProvenance,
      spec_epochs: [{
        schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
        snapshot_id: "spec-decision-input-1",
        venue_id: "binance-usdm",
        symbol: request.symbol,
        effective_at: "2020-01-01T00:00:00Z",
        valid_until: null,
        observed_at: "2026-07-14T03:00:00Z",
        source_ref: "archive:spec:decision-input-1",
        source_hash: "b".repeat(64),
      }],
      accounting: {
        spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
        product_type: "linear_derivative",
        base_asset: "BTC",
        quote_asset: "USDT",
        settlement_asset: "USDT",
        contract_multiplier: "1",
        price_increment: "0.01",
        quantity_increment: "0.001",
        settlement_increment: "0.00000001",
      },
    },
    universe: { selected_at: "2026-07-14T02:59:00Z", survivorship: "point_in_time" },
  }
}

function openDb(): Database {
  const db = new Database(":memory:")
  ensureResearchStateSchema(db)
  registerReplayInstrumentStatusProviderCertification(db, PROVIDER_CERTIFICATION)
  return db
}

function seedUniverse(db: Database): void {
  const insertNode = db.query(`
    INSERT INTO rd_universe_node(
      node_id, parent_node_id, level, node_type, slug, name, path,
      research_scope_status, implementation_scope_status, created_at, updated_at
    ) VALUES (
      $node_id, $parent_node_id, $level, $node_type, $slug, $name, $path,
      'active', 'ready', $now, $now
    )
  `)
  const rows = [
    ["root", null, 0, "universe", "strategy-universe", "Strategy Universe", "strategy-universe"],
    ["edge-1", "root", 1, "edge", "trend", "Trend", "strategy-universe/trend"],
    ["family-1", "edge-1", 2, "mechanism_family", "time-series-trend", "Time-Series Trend", "strategy-universe/trend/time-series-trend"],
    ["canonical-1", "family-1", 3, "canonical_strategy", "trend-pullback", "Trend Pullback", "strategy-universe/trend/time-series-trend/trend-pullback"],
  ] as const
  for (const [nodeId, parentId, level, type, slug, name, path] of rows) {
    insertNode.run({
      $node_id: nodeId,
      $parent_node_id: parentId,
      $level: level,
      $node_type: type,
      $slug: slug,
      $name: name,
      $path: path,
      $now: NOW,
    })
  }
  const insertAxis = db.query(`
    INSERT INTO rd_universe_node_axis(node_id, axis, is_primary, created_at)
    VALUES ($node_id, 'return_driver', 1, $now)
  `)
  for (const nodeId of ["edge-1", "family-1", "canonical-1"]) {
    insertAxis.run({ $node_id: nodeId, $now: NOW })
  }
}

function seedExecutableExperiment(db: Database, startDiscovery = true): void {
  seedUniverse(db)
  appendProposalRevision(db, proposalRevision({ validation_status: "valid" }))
  registerTrialGroup(db, trialGroup())
  registerExperiment(db, {
    experiment_id: "experiment-1",
    proposal_id: "proposal-1",
    proposal_revision: 1,
    canonical_node_id: "canonical-1",
    hypothesis_id: "hypothesis-1",
    code_family_id: "time_series_momentum_v1",
    trial_group_id: "group-1",
    trial_group_hash: trialGroup().group_hash,
    contract_hash: hashIdentityPayload(experimentContract()),
    identity_hash_policy_version: HASH_POLICY,
    contract_validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION,
    lifecycle_rule_version: RESEARCH_LIFECYCLE_RULE_VERSION,
    scope_policy_version: "scope-v1",
    contract_json: experimentContract(),
    bootstrap_event_id: "event-1",
    bootstrap_idempotency_key: "event-key-1",
    registered_at: NOW,
  })
  if (!startDiscovery) return
  db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
  applySystemTransition(db, {
    experiment_id: "experiment-1", expected_version: 1,
    trigger_type: "system", trigger_value: "pre_run_gate_passed",
    trigger_ref: "system://pre-run-gate", event_id: "event-2",
    idempotency_key: "event-key-2", created_at: NOW,
  })
  reserveTrial(db, {
    trial_id: "trial-1", trial_group_id: "group-1", experiment_id: "experiment-1",
    trial_ordinal: 1, candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    identity_hash_policy_version: HASH_POLICY, run_id: "run-1",
    idempotency_key: "trial-key-1", created_at: NOW,
  })
  finishTrial(db, { trial_id: "trial-1", status: "completed", completed_at: NOW })
  db.query(`
    INSERT INTO rd_result_type(result_type_id, status, description)
    VALUES ('replay_result', 'active', 'Replay result artifact')
  `).run()
}

function insertExperimentResult(db: Database, resultId: string, stageId: string): void {
  appendExperimentResult(db, {
    result_id: resultId, experiment_id: "experiment-1", result_scope: "trial",
    trial_id: "trial-1", trial_group_id: "group-1", run_id: "run-1",
    idempotency_key: `result-key:${resultId}`, stage_id: stageId,
    result_type_id: "replay_result", artifact_ref: "artifact://result-1",
    evidence_fingerprint_json: {
      policy_hash: "p", harness_hash: "h", data_hash: "d",
      assumptions_hash: "a", temporal_contract: "closed-candle",
    },
    summary_json: {}, created_at: NOW,
  })
}

function proposalRevision(overrides: Partial<Parameters<typeof appendProposalRevision>[1]> = {}): Parameters<typeof appendProposalRevision>[1] {
  const valid = overrides.validation_status !== "invalid"
  const proposalJson = overrides.proposal_json ?? (valid
    ? experimentContract()
    : { schema_version: "trade-flow.rd-experiment-contract.v3" })
  return {
    proposal_id: "proposal-1",
    planner_run_id: "planner-run-1",
    proposal_kind: "experiment",
    revision: 1,
    proposal_hash: overrides.proposal_hash ?? hashIdentityPayload(proposalJson),
    identity_hash_policy_version: HASH_POLICY,
    proposal_json: proposalJson,
    validation_status: valid ? "valid" : "invalid",
    validation_ref: `validator://${RESEARCH_CONTRACT_VALIDATOR_VERSION}/proposal-1`,
    created_at: NOW,
    ...overrides,
  }
}

function trialGroup(): Parameters<typeof registerTrialGroup>[1] {
  const candidate = {
    candidate_id: "candidate-1",
    candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    parameter_assignment_json: { lookback: 20 },
    candidate_ordinal: 1,
    created_at: NOW,
  }
  const identity: Omit<Parameters<typeof registerTrialGroup>[1], "group_hash"> = {
    trial_group_id: "group-1",
    hypothesis_scope_ref: "hypothesis-1",
    identity_hash_policy_version: HASH_POLICY,
    candidate_mode: "enumerated",
    search_space_json: { schema_version: "trade-flow.rd-search-space.v1", candidates: 1 },
    selection_protocol_json: { schema_version: "trade-flow.rd-selection.v1", method: "predeclared" },
    max_trials: 1,
    trial_accounting_policy_version: "trial-accounting-v1",
    registered_at: NOW,
    created_at: NOW,
    candidates: [candidate],
  }
  return { ...identity, group_hash: trialGroupIdentityHash(identity) }
}

function experimentContract(): Record<string, unknown> {
  return {
    schema_version: "trade-flow.rd-experiment-contract.v3",
    canonical_node_id: "canonical-1",
    code_family_id: "time_series_momentum_v1",
    implementation_version: "v1",
    contract_versions: {
      identity_hash_policy: HASH_POLICY,
      validator: RESEARCH_CONTRACT_VALIDATOR_VERSION,
      lifecycle_rule: RESEARCH_LIFECYCLE_RULE_VERSION,
      scope_policy: "scope-v1",
    },
    hypothesis: { falsifiable_claim: "trend persistence exceeds costs" },
    economic_rationale: { why_exists: "slow positioning adjustment" },
    asset_universe_definition: { venue: "binance-usdm", selection_timestamp_rule: "point_in_time" },
    timeframe: { signal: "4h", execution: "4h" },
    sampling_and_alignment: { closed_candle_only: true },
    required_data: ["surface:ohlcv"],
    feature_definition: {}, target_definition: {}, forecast_definition: {}, signal_definition: {},
    position_rule: {}, portfolio_construction: {}, risk_rule: {}, execution_rule: {},
    transaction_cost_model: {}, expected_holding_period: {}, benchmark: {}, validation_plan: {},
    rejection_criteria: ["net return does not exceed cost"],
    trial_group_ref: { trial_group_id: "group-1", group_hash: trialGroupHashForContract() },
    candidate_registration: { candidate_ids: ["candidate-1"] },
    parent_experiment_id: null, random_seed: 1,
    code_commit_ref: "git://code", harness_commit_ref: "git://harness",
    data_snapshot_ref: "data://snapshot", assumptions_ref: "assumptions://v1",
    replay_execution_input: {
      supplemental_requirement_set_schema_version: "trade.rd-replay-supplemental-requirement-set.v1",
      supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
    },
  }
}

function trialGroupHashForContract(): string {
  const candidate = {
    candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    parameter_assignment_json: { lookback: 20 }, candidate_ordinal: 1, created_at: NOW,
  }
  return trialGroupIdentityHash({
    trial_group_id: "group-1", hypothesis_scope_ref: "hypothesis-1",
    identity_hash_policy_version: HASH_POLICY, candidate_mode: "enumerated",
    search_space_json: { schema_version: "trade-flow.rd-search-space.v1", candidates: 1 },
    selection_protocol_json: { schema_version: "trade-flow.rd-selection.v1", method: "predeclared" },
    max_trials: 1, trial_accounting_policy_version: "trial-accounting-v1", candidates: [candidate],
  })
}

function reviewerDecision(
  overrides: Partial<Parameters<typeof applyReviewerDecision>[1]> = {},
): Parameters<typeof applyReviewerDecision>[1] {
  return {
    decision_id: "decision-1",
    experiment_id: "experiment-1",
    reviewer_run_id: "reviewer-run-1",
    idempotency_key: "decision-key-1",
    expected_version: 2,
    stage_id: "historical_validation",
    decision: "accept_for_draft",
    rationale_ref: "artifact://review-1",
    evidence: [{ result_id: "result-1", evidence_role: "primary" }],
    lifecycle_event_id: "event-3",
    lifecycle_idempotency_key: "event-key-3",
    selected_trial_id: "trial-1",
    created_at: NOW,
    ...overrides,
  }
}

function count(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
