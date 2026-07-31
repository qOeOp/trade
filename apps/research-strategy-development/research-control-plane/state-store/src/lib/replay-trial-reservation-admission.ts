import type { Database } from "bun:sqlite"
import {
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_REQUEST_SCHEMA_VERSION,
  assertReplayDatasetManifest,
  assertReplayLiquidityCapacityBinding,
  canonicalHash,
  replayDatasetManifestHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayVenueRiskPolicySnapshot,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  REPLAY_TRIAL_RESERVATION_ADMISSION_RECORD_SCHEMA_VERSION,
  assertReplayTrialReservationAdmissionRecord,
  assertReplayTrialReservationAdmissionRequest,
  createReplayTrialReservationAdmissionRecord,
  type ReplayTrialReservationAdmissionRecord,
  type ReplayTrialReservationAdmissionRequest,
} from "../../../contracts/src/lib/replay-trial-reservation-admission"
import {
  assertExperimentTrialPlanRecord,
  type ExperimentTrialPlanRecord,
} from "../../../contracts/src/lib/experiment-trial-plan"
import { canonicalControlPlaneHash, hashTrialReservationSnapshot } from "../../../contracts/src/lib/control-plane-contracts"
import { issueTrialReservationSnapshot } from "./trial-reservation-snapshot"

interface SourceRow {
  plan_hash: string
  plan_json: string
  item_candidate_id: string
  item_candidate_identity_hash: string
  item_run_id: string
  trial_group_id: string
  experiment_id: string
  trial_ordinal: number
  candidate_id: string
  candidate_identity_hash: string
  identity_hash_policy_version: string
  run_id: string
  trial_status: string
  group_hash: string
  group_status: string
  experiment_contract_hash: string
  lifecycle_state: string
}

interface AdmissionRow {
  admission_request_hash: string
  admission_json: string
}

export function admitReplayTrialReservation(
  db: Database,
  request: ReplayTrialReservationAdmissionRequest,
): ReplayTrialReservationAdmissionRecord {
  assertReplayTrialReservationAdmissionRequest(request)
  const admit = db.transaction(() => {
    const requestHash = canonicalControlPlaneHash(request)
    const replay = db.query(`
      SELECT admission_request_hash, admission_json
      FROM rd_replay_trial_reservation_admission
      WHERE idempotency_key=$idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as AdmissionRow | null
    if (replay) {
      if (replay.admission_request_hash !== requestHash) {
        throw new Error("Replay Trial Reservation Admission idempotency key already exists with different content")
      }
      return parseAdmissionRecord(replay.admission_json)
    }

    const source = readSource(db, request.plan_id, request.trial_id)
    const plan = parsePlan(source.plan_json)
    assertAuthoritativeSource(request, plan, source)
    assertNoOverlappingReservation(db, request)

    const manifest = request.dataset_manifest as unknown as ReplayDatasetManifest
    assertReplayDatasetManifest(manifest)
    const spec = request.execution_spec as unknown as Omit<
      ReplayExecutionRequest,
      "trial_reservation_ref" | "trial_reservation_hash"
    >
    const executableRequest: ReplayExecutionRequest = {
      ...structuredClone(spec),
      schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
      trial_reservation_ref: request.reservation_ref,
      trial_reservation_hash: "0".repeat(64),
    }
    assertDatasetBindings(executableRequest, manifest, request.issued_at)
    const executionSpecHash = replayExecutionSpecHash(executableRequest)
    const datasetManifestHash = replayDatasetManifestHash(manifest)
    const liquidityHash = executableRequest.order.entry_execution.order_type === "market"
      ? null
      : executableRequest.order.entry_execution.liquidity_capacity_attestation_hash
    const snapshot = issueTrialReservationSnapshot(db, {
      trial_id: request.trial_id,
      reservation_id: request.reservation_id,
      reservation_ref: request.reservation_ref,
      issued_at: request.issued_at,
      expires_at: request.expires_at,
      bindings: {
        replay_idempotency_key: executableRequest.idempotency_key,
        execution_spec_hash: executionSpecHash,
        dataset_manifest_ref: manifest.manifest_ref,
        dataset_hash: manifest.data_hash,
        liquidity_capacity_attestation_hash: liquidityHash,
        supplemental_facts_hash: manifest.supplemental_facts.content_hash,
        supplemental_requirement_set_hash: manifest.supplemental_facts.requirement_set_hash,
        venue_risk_policy_schedule_hash: canonicalHash(manifest.venue_risk_policy_epochs),
        instrument_spec_schedule_hash: canonicalHash({
          epochs: manifest.instrument.spec_epochs,
          accounting: manifest.instrument.accounting,
        }),
        instrument_status_schedule_hash: canonicalHash(manifest.instrument.status_epochs),
        instrument_status_provenance_hash: canonicalHash(manifest.instrument.status_provenance),
        instrument_status_provider_capability_hash:
          manifest.instrument.status_provenance.provider_capability_hash,
        instrument_status_provider_certification_hash:
          manifest.instrument.status_provenance.provider_certification_hash,
        harness_hash: executableRequest.harness_hash,
        assumptions_hash: executableRequest.assumptions_hash,
        cost_policy_hash: canonicalHash(executableRequest.cost_policy),
        margin_policy_hash: canonicalHash(executableRequest.margin_policy),
        simulator_policy_version: executableRequest.simulator_policy.version,
        execution_mode: "step",
      },
      required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
    })
    assertProviderProvenance(snapshot.instrument_status_provider_certification, manifest.instrument.status_provenance)
    const reservationHash = hashTrialReservationSnapshot(snapshot)
    const record = createReplayTrialReservationAdmissionRecord({
      schema_version: REPLAY_TRIAL_RESERVATION_ADMISSION_RECORD_SCHEMA_VERSION,
      admission_id: request.admission_id,
      plan_id: request.plan_id,
      plan_hash: request.plan_hash,
      trial_id: request.trial_id,
      reservation_id: request.reservation_id,
      reservation_ref: request.reservation_ref,
      reservation_hash: reservationHash,
      execution_spec_hash: executionSpecHash,
      dataset_manifest_ref: manifest.manifest_ref,
      dataset_hash: manifest.data_hash,
      dataset_manifest_hash: datasetManifestHash,
      provider_certification_hash: manifest.instrument.status_provenance.provider_certification_hash,
      reservation_snapshot: snapshot,
      admitted_at: request.issued_at,
    })
    db.query(`
      INSERT INTO rd_replay_trial_reservation_admission(
        admission_id, plan_id, trial_id, reservation_id, reservation_ref,
        idempotency_key, admission_request_hash, execution_spec_hash,
        execution_spec_json, dataset_manifest_ref, dataset_hash, dataset_manifest_hash,
        dataset_manifest_json,
        provider_certification_hash, reservation_hash, reservation_snapshot_json,
        admission_hash, admission_json, issued_at, expires_at
      ) VALUES (
        $admission_id, $plan_id, $trial_id, $reservation_id, $reservation_ref,
        $idempotency_key, $admission_request_hash, $execution_spec_hash,
        $execution_spec_json, $dataset_manifest_ref, $dataset_hash, $dataset_manifest_hash,
        $dataset_manifest_json,
        $provider_certification_hash, $reservation_hash, $reservation_snapshot_json,
        $admission_hash, $admission_json, $issued_at, $expires_at
      )
    `).run({
      $admission_id: record.admission_id,
      $plan_id: record.plan_id,
      $trial_id: record.trial_id,
      $reservation_id: record.reservation_id,
      $reservation_ref: record.reservation_ref,
      $idempotency_key: request.idempotency_key,
      $admission_request_hash: requestHash,
      $execution_spec_hash: record.execution_spec_hash,
      $execution_spec_json: JSON.stringify(spec),
      $dataset_manifest_ref: record.dataset_manifest_ref,
      $dataset_hash: record.dataset_hash,
      $dataset_manifest_hash: record.dataset_manifest_hash,
      $dataset_manifest_json: JSON.stringify(manifest),
      $provider_certification_hash: record.provider_certification_hash,
      $reservation_hash: record.reservation_hash,
      $reservation_snapshot_json: JSON.stringify(record.reservation_snapshot),
      $admission_hash: record.admission_hash,
      $admission_json: JSON.stringify(record),
      $issued_at: record.reservation_snapshot.issued_at,
      $expires_at: record.reservation_snapshot.expires_at,
    })
    return record
  })
  return admit.immediate()
}

export function readReplayTrialReservationAdmission(
  db: Database,
  admissionId: string,
): ReplayTrialReservationAdmissionRecord {
  if (!admissionId.trim()) throw new Error("admission_id is required")
  const row = db.query(`
    SELECT admission_json FROM rd_replay_trial_reservation_admission WHERE admission_id=$admission_id
  `).get({ $admission_id: admissionId }) as { admission_json: string } | null
  if (!row) throw new Error("Replay Trial Reservation Admission Record is missing")
  return parseAdmissionRecord(row.admission_json)
}

function readSource(db: Database, planId: string, trialId: string): SourceRow {
  const row = db.query(`
    SELECT p.plan_hash, p.plan_json,
           i.candidate_id AS item_candidate_id,
           i.candidate_identity_hash AS item_candidate_identity_hash,
           i.run_id AS item_run_id,
           t.trial_group_id, t.experiment_id, t.trial_ordinal,
           t.candidate_id, t.candidate_identity_hash, t.identity_hash_policy_version,
           t.run_id, t.status AS trial_status,
           g.group_hash, g.status AS group_status,
           e.contract_hash AS experiment_contract_hash, e.lifecycle_state
    FROM rd_experiment_trial_plan p
    JOIN rd_experiment_trial_plan_item i ON i.plan_id=p.plan_id
    JOIN rd_trial t ON t.trial_id=i.trial_id
    JOIN rd_trial_group g ON g.trial_group_id=t.trial_group_id
    JOIN rd_experiment_contract e ON e.experiment_id=t.experiment_id
    WHERE p.plan_id=$plan_id AND i.trial_id=$trial_id
  `).get({ $plan_id: planId, $trial_id: trialId }) as SourceRow | null
  if (!row) throw new Error("Replay Trial Reservation Admission requires a planned reserved Trial")
  return row
}

function assertAuthoritativeSource(
  request: ReplayTrialReservationAdmissionRequest,
  plan: ExperimentTrialPlanRecord,
  source: SourceRow,
): void {
  const spec = request.execution_spec as unknown as Omit<
    ReplayExecutionRequest,
    "trial_reservation_ref" | "trial_reservation_hash"
  >
  if (request.plan_hash !== source.plan_hash || request.plan_hash !== plan.plan_hash
      || plan.plan_id !== request.plan_id || source.trial_status !== "reserved"
      || source.group_status !== "running" || source.lifecycle_state !== "discovery") {
    throw new Error("Replay Trial Reservation Admission source is not the active authoritative Trial Plan")
  }
  if (Date.parse(request.issued_at) < Date.parse(plan.planned_at)) {
    throw new Error("Replay Trial Reservation Admission cannot predate its Trial Plan")
  }
  const item = plan.trials.find((trial) => trial.trial_id === request.trial_id)
  if (!item || item.trial_ordinal !== source.trial_ordinal
      || item.candidate_id !== source.item_candidate_id
      || item.candidate_identity_hash !== source.item_candidate_identity_hash
      || item.run_id !== source.item_run_id
      || spec.experiment_id !== plan.experiment_id
      || spec.trial_group_id !== plan.trial_group_id
      || spec.trial_group_hash !== plan.trial_group_hash
      || spec.trial_id !== item.trial_id
      || spec.candidate_id !== item.candidate_id
      || spec.candidate_hash !== item.candidate_identity_hash
      || spec.identity_hash_policy_version !== plan.identity_hash_policy_version
      || spec.experiment_contract_hash !== plan.experiment_contract_hash
      || spec.run_id !== item.run_id
      || source.candidate_id !== item.candidate_id
      || source.candidate_identity_hash !== item.candidate_identity_hash
      || source.identity_hash_policy_version !== plan.identity_hash_policy_version
      || source.experiment_contract_hash !== plan.experiment_contract_hash
      || source.group_hash !== plan.trial_group_hash) {
    throw new Error("Replay execution spec identity drifted from the authoritative Trial Plan")
  }
}

function assertDatasetBindings(
  request: ReplayExecutionRequest,
  manifest: ReplayDatasetManifest,
  issuedAt: string,
): void {
  if (manifest.manifest_ref !== request.dataset_manifest_ref || manifest.data_hash !== request.dataset_hash
      || manifest.symbol !== request.symbol || manifest.timeframe !== request.timeframe) {
    throw new Error("Replay execution spec does not bind the supplied Dataset Manifest")
  }
  if (manifest.universe.survivorship !== "point_in_time"
      || manifest.instrument.status_history !== "complete") {
    throw new Error("Replay admission requires point-in-time universe and complete instrument status history")
  }
  if (Date.parse(manifest.observed_through) > Date.parse(issuedAt)) {
    throw new Error("Replay Dataset Manifest was not available when the Reservation was issued")
  }
  const expected = {
    supplemental_facts_hash: manifest.supplemental_facts.content_hash,
    supplemental_requirement_set_hash: manifest.supplemental_facts.requirement_set_hash,
    venue_risk_policy_schedule_hash: canonicalHash(manifest.venue_risk_policy_epochs),
    instrument_spec_schedule_hash: canonicalHash({
      epochs: manifest.instrument.spec_epochs,
      accounting: manifest.instrument.accounting,
    }),
    instrument_status_schedule_hash: canonicalHash(manifest.instrument.status_epochs),
    instrument_status_provenance_hash: canonicalHash(manifest.instrument.status_provenance),
    instrument_status_provider_capability_hash:
      manifest.instrument.status_provenance.provider_capability_hash,
    instrument_status_provider_certification_hash:
      manifest.instrument.status_provenance.provider_certification_hash,
  }
  for (const [field, expectedHash] of Object.entries(expected)) {
    if (request[field as keyof ReplayExecutionRequest] !== expectedHash) {
      throw new Error(`Replay execution spec ${field} does not match the Dataset Manifest`)
    }
  }
  assertReplayLiquidityCapacityBinding(request, manifest)
  const entryRisk = resolveRiskAt(manifest.venue_risk_policy_epochs, request.order.earliest_executable_time)
  if (request.margin_policy.initial_margin_rate !== entryRisk.initial_margin_rate
      || canonicalHash(request.margin_policy.maintenance_tier) !== canonicalHash(entryRisk.maintenance_tier)
      || request.cost_policy.liquidation_fee_bps !== entryRisk.liquidation_fee_bps) {
    throw new Error("Replay execution spec risk parameters do not match the active venue policy")
  }
}

function resolveRiskAt(
  schedule: ReplayVenueRiskPolicySnapshot[],
  timestamp: string,
): ReplayVenueRiskPolicySnapshot {
  const time = Date.parse(timestamp)
  const value = schedule.find((item) => Date.parse(item.effective_at) <= time
    && (item.valid_until === null || time < Date.parse(item.valid_until)))
  if (!value) throw new Error("Replay venue risk policy does not cover earliest execution")
  return value
}

function assertProviderProvenance(
  certification: ReturnType<typeof issueTrialReservationSnapshot>["instrument_status_provider_certification"],
  provenance: ReplayDatasetManifest["instrument"]["status_provenance"],
): void {
  if (provenance.provider_certification_ref !== certification.certification_ref
      || provenance.provider_certification_hash !== certification.certification_hash
      || provenance.provider_capability_hash !== certification.provider_capability_hash
      || provenance.producer_domain !== certification.producer_domain
      || provenance.producer_id !== certification.producer_id
      || provenance.producer_version !== certification.producer_version
      || provenance.producer_build_hash !== certification.producer_build_hash
      || provenance.normalization_policy_version !== certification.normalization_policy_version
      || provenance.normalization_policy_hash !== certification.normalization_policy_hash
      || provenance.source_kind !== certification.allowed_source_kind
      || provenance.completeness !== certification.allowed_completeness) {
    throw new Error("Replay Dataset provenance does not bind the admitted provider certification")
  }
}

function assertNoOverlappingReservation(
  db: Database,
  request: ReplayTrialReservationAdmissionRequest,
): void {
  const overlap = db.query(`
    SELECT a.reservation_hash
    FROM rd_replay_trial_reservation_admission a
    LEFT JOIN rd_replay_reservation_cancellation c
      ON c.reservation_hash=a.reservation_hash AND julianday(c.effective_at) <= julianday($issued_at)
    WHERE a.trial_id=$trial_id AND c.reservation_hash IS NULL
      AND julianday($issued_at) < julianday(a.expires_at)
      AND julianday(a.issued_at) < julianday($expires_at)
    LIMIT 1
  `).get({
    $trial_id: request.trial_id,
    $issued_at: request.issued_at,
    $expires_at: request.expires_at,
  })
  if (overlap) throw new Error("Replay Trial cannot hold overlapping active Reservations")
}

function parsePlan(json: string): ExperimentTrialPlanRecord {
  const value = JSON.parse(json) as ExperimentTrialPlanRecord
  assertExperimentTrialPlanRecord(value)
  return value
}

function parseAdmissionRecord(json: string): ReplayTrialReservationAdmissionRecord {
  const value = JSON.parse(json) as ReplayTrialReservationAdmissionRecord
  assertReplayTrialReservationAdmissionRecord(value)
  return value
}
