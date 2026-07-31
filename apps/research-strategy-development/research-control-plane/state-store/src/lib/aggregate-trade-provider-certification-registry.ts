import type { Database } from "bun:sqlite"
import {
  assertReplayAggregateTradeEvidenceAdmissionSnapshot,
  assertReplayAggregateTradeProviderCertificationSnapshot,
  assertReplayAggregateTradeProviderCertificationTermination,
  assertTrialReservationSnapshot,
  createReplayAggregateTradeEvidenceAdmissionSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAggregateTradeEvidenceAdmissionSnapshot,
  type ReplayAggregateTradeProviderCertificationSnapshot,
  type ReplayAggregateTradeProviderCertificationTermination,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

interface CertificationRow {
  certification_hash: string
  certification_json: string
}

interface TerminationRow {
  termination_hash: string
  termination_json: string
}

interface AdmissionRow {
  admission_hash: string
  admission_json: string
}

export interface IssueReplayAggregateTradeEvidenceAdmissionInput {
  admission_id: string
  admission_ref: string
  issued_at: string
  authority_id: string
  admission_policy_version: string
  reservation: TrialReservationSnapshot
  provider_certification_hash: string
  provider_capability_hash: string
  archive_id: string
  archive_hash: string
  source_receipt_hash: string
  completeness_audit_hash: string
  evidence_ref: string
  evidence_hash: string
  coverage_attestation_hash: string
  evidence_produced_at: string
  coverage_start: string
  coverage_end: string
}

export function registerReplayAggregateTradeProviderCertification(
  db: Database,
  certification: ReplayAggregateTradeProviderCertificationSnapshot,
): ReplayAggregateTradeProviderCertificationSnapshot {
  assertReplayAggregateTradeProviderCertificationSnapshot(certification)
  const existing = db.query(`
    SELECT certification_hash, certification_json
    FROM rd_replay_aggregate_trade_provider_certification
    WHERE certification_id = $certification_id OR certification_ref = $certification_ref
  `).get({
    $certification_id: certification.certification_id,
    $certification_ref: certification.certification_ref,
  }) as CertificationRow | null
  if (existing) {
    if (existing.certification_hash !== certification.certification_hash) {
      throw new Error("Replay aggregate trade provider certification identity already exists with different content")
    }
    return parseCertificationRow(existing)
  }
  db.query(`
    INSERT INTO rd_replay_aggregate_trade_provider_certification(
      certification_id, certification_ref, certification_hash, status,
      certified_at, valid_until, certifier_id, certification_policy_version,
      provider_capability_hash, producer_domain, producer_id, producer_version,
      producer_build_hash, provider_policy_hash, accepted_archive_schema,
      emitted_event_schema, emitted_attestation_schema, allowed_source_kind,
      allowed_external_completeness, certification_json
    ) VALUES (
      $certification_id, $certification_ref, $certification_hash, $status,
      $certified_at, $valid_until, $certifier_id, $certification_policy_version,
      $provider_capability_hash, $producer_domain, $producer_id, $producer_version,
      $producer_build_hash, $provider_policy_hash, $accepted_archive_schema,
      $emitted_event_schema, $emitted_attestation_schema, $allowed_source_kind,
      $allowed_external_completeness, $certification_json
    )
  `).run({
    $certification_id: certification.certification_id,
    $certification_ref: certification.certification_ref,
    $certification_hash: certification.certification_hash,
    $status: certification.status,
    $certified_at: certification.certified_at,
    $valid_until: certification.valid_until,
    $certifier_id: certification.certifier_id,
    $certification_policy_version: certification.certification_policy_version,
    $provider_capability_hash: certification.provider_capability_hash,
    $producer_domain: certification.producer_domain,
    $producer_id: certification.producer_id,
    $producer_version: certification.producer_version,
    $producer_build_hash: certification.producer_build_hash,
    $provider_policy_hash: certification.provider_policy_hash,
    $accepted_archive_schema: certification.accepted_archive_schema,
    $emitted_event_schema: certification.emitted_event_schema,
    $emitted_attestation_schema: certification.emitted_attestation_schema,
    $allowed_source_kind: certification.allowed_source_kind,
    $allowed_external_completeness: certification.allowed_external_completeness,
    $certification_json: JSON.stringify(certification),
  })
  return structuredClone(certification)
}

export function readReplayAggregateTradeProviderCertification(
  db: Database,
  certificationHash: string,
): ReplayAggregateTradeProviderCertificationSnapshot {
  const row = db.query(`
    SELECT certification_hash, certification_json
    FROM rd_replay_aggregate_trade_provider_certification
    WHERE certification_hash = $certification_hash
  `).get({ $certification_hash: certificationHash }) as CertificationRow | null
  if (!row) throw new Error("Replay aggregate trade provider certification is not registered")
  return parseCertificationRow(row)
}

export function registerReplayAggregateTradeProviderCertificationTermination(
  db: Database,
  termination: ReplayAggregateTradeProviderCertificationTermination,
): ReplayAggregateTradeProviderCertificationTermination {
  assertReplayAggregateTradeProviderCertificationTermination(termination)
  return db.transaction(() => {
    const existing = db.query(`
      SELECT termination_hash, termination_json
      FROM rd_replay_aggregate_trade_provider_certification_termination
      WHERE termination_id = $termination_id
        OR termination_ref = $termination_ref
        OR certification_hash = $certification_hash
    `).get({
      $termination_id: termination.termination_id,
      $termination_ref: termination.termination_ref,
      $certification_hash: termination.certification_hash,
    }) as TerminationRow | null
    if (existing) {
      if (existing.termination_hash !== termination.termination_hash) {
        throw new Error("Replay aggregate trade provider certification already has a different termination")
      }
      return parseTerminationRow(existing)
    }
    const certification = readReplayAggregateTradeProviderCertification(db, termination.certification_hash)
    const effectiveAt = Date.parse(termination.effective_at)
    if (effectiveAt < Date.parse(certification.certified_at) || effectiveAt >= Date.parse(certification.valid_until)) {
      throw new Error("Replay aggregate trade provider certification termination must fall inside its validity window")
    }
    if (termination.termination_type === "superseded") {
      const successor = assertReplayAggregateTradeProviderCertificationAdmittedAt(
        db,
        termination.successor_certification_hash as string,
        termination.effective_at,
      )
      if (successor.producer_id !== certification.producer_id) {
        throw new Error("Replay aggregate trade provider certification successor must belong to the same provider")
      }
    }
    db.query(`
      INSERT INTO rd_replay_aggregate_trade_provider_certification_termination(
        termination_id, termination_ref, termination_hash, certification_hash,
        termination_type, recorded_at, effective_at, authority_id,
        termination_policy_version, reason_code, successor_certification_hash,
        termination_json
      ) VALUES (
        $termination_id, $termination_ref, $termination_hash, $certification_hash,
        $termination_type, $recorded_at, $effective_at, $authority_id,
        $termination_policy_version, $reason_code, $successor_certification_hash,
        $termination_json
      )
    `).run({
      $termination_id: termination.termination_id,
      $termination_ref: termination.termination_ref,
      $termination_hash: termination.termination_hash,
      $certification_hash: termination.certification_hash,
      $termination_type: termination.termination_type,
      $recorded_at: termination.recorded_at,
      $effective_at: termination.effective_at,
      $authority_id: termination.authority_id,
      $termination_policy_version: termination.termination_policy_version,
      $reason_code: termination.reason_code,
      $successor_certification_hash: termination.successor_certification_hash,
      $termination_json: JSON.stringify(termination),
    })
    return structuredClone(termination)
  }).immediate()
}

export function readReplayAggregateTradeProviderCertificationTermination(
  db: Database,
  certificationHash: string,
): ReplayAggregateTradeProviderCertificationTermination | null {
  const row = db.query(`
    SELECT termination_hash, termination_json
    FROM rd_replay_aggregate_trade_provider_certification_termination
    WHERE certification_hash = $certification_hash
  `).get({ $certification_hash: certificationHash }) as TerminationRow | null
  return row ? parseTerminationRow(row) : null
}

export function assertReplayAggregateTradeProviderCertificationAdmittedAt(
  db: Database,
  certificationHash: string,
  admittedAt: string,
): ReplayAggregateTradeProviderCertificationSnapshot {
  const certification = readReplayAggregateTradeProviderCertification(db, certificationHash)
  const instant = Date.parse(admittedAt)
  if (!Number.isFinite(instant)
      || instant < Date.parse(certification.certified_at)
      || instant >= Date.parse(certification.valid_until)) {
    throw new Error("aggregate trade evidence must be admitted while provider certification is valid")
  }
  const termination = readReplayAggregateTradeProviderCertificationTermination(db, certificationHash)
  if (termination && instant >= Date.parse(termination.effective_at)) {
    throw new Error(`Replay aggregate trade provider certification was ${termination.termination_type}`)
  }
  return certification
}

export function issueReplayAggregateTradeEvidenceAdmission(
  db: Database,
  input: IssueReplayAggregateTradeEvidenceAdmissionInput,
): ReplayAggregateTradeEvidenceAdmissionSnapshot {
  assertTrialReservationSnapshot(input.reservation)
  const reservationHash = hashTrialReservationSnapshot(input.reservation)
  if (Date.parse(input.issued_at) < Date.parse(input.reservation.issued_at)
      || Date.parse(input.issued_at) >= Date.parse(input.reservation.expires_at)) {
    throw new Error("aggregate trade evidence admission must fall inside the Trial Reservation window")
  }
  const certification = assertReplayAggregateTradeProviderCertificationAdmittedAt(
    db,
    input.provider_certification_hash,
    input.issued_at,
  )
  if (certification.provider_capability_hash !== input.provider_capability_hash) {
    throw new Error("aggregate trade evidence capability does not match the registered certification")
  }
  const trial = db.query(`
    SELECT trial_id, run_id, status FROM rd_trial WHERE trial_id = $trial_id
  `).get({ $trial_id: input.reservation.identity.trial_id }) as {
    trial_id: string
    run_id: string
    status: string
  } | null
  if (!trial || trial.run_id !== input.reservation.run_id || trial.status !== "reserved") {
    throw new Error("aggregate trade evidence admission requires the authoritative reserved Trial")
  }
  const admission = createReplayAggregateTradeEvidenceAdmissionSnapshot({
    schema_version: "trade.rd-replay-aggregate-trade-evidence-admission.v1",
    admission_id: input.admission_id,
    admission_ref: input.admission_ref,
    status: "admitted",
    issued_at: input.issued_at,
    authority_id: input.authority_id,
    admission_policy_version: input.admission_policy_version,
    trial_id: input.reservation.identity.trial_id,
    run_id: input.reservation.run_id,
    reservation_ref: input.reservation.reservation_ref,
    reservation_hash: reservationHash,
    provider_capability_hash: input.provider_capability_hash,
    provider_certification_hash: input.provider_certification_hash,
    provider_certification: certification,
    archive_id: input.archive_id,
    archive_hash: input.archive_hash,
    source_receipt_hash: input.source_receipt_hash,
    completeness_audit_hash: input.completeness_audit_hash,
    evidence_ref: input.evidence_ref,
    evidence_hash: input.evidence_hash,
    coverage_attestation_hash: input.coverage_attestation_hash,
    evidence_produced_at: input.evidence_produced_at,
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    external_completeness: "not_verified",
    scope: "pre_integration_exact_price_path_only",
  })
  return db.transaction(() => {
    const existing = db.query(`
      SELECT admission_hash, admission_json
      FROM rd_replay_aggregate_trade_evidence_admission
      WHERE admission_id = $admission_id
        OR admission_ref = $admission_ref
        OR reservation_hash = $reservation_hash
    `).get({
      $admission_id: admission.admission_id,
      $admission_ref: admission.admission_ref,
      $reservation_hash: admission.reservation_hash,
    }) as AdmissionRow | null
    if (existing) {
      if (existing.admission_hash !== admission.admission_hash) {
        throw new Error("Replay aggregate trade evidence admission identity already exists with different content")
      }
      return parseAdmissionRow(existing)
    }
    db.query(`
      INSERT INTO rd_replay_aggregate_trade_evidence_admission(
        admission_id, admission_ref, admission_hash, status, issued_at,
        authority_id, admission_policy_version, trial_id, run_id,
        reservation_ref, reservation_hash, provider_capability_hash, provider_certification_hash,
        archive_id, archive_hash, evidence_ref, evidence_hash,
        coverage_attestation_hash, coverage_start, coverage_end,
        external_completeness, scope, admission_json
      ) VALUES (
        $admission_id, $admission_ref, $admission_hash, $status, $issued_at,
        $authority_id, $admission_policy_version, $trial_id, $run_id,
        $reservation_ref, $reservation_hash, $provider_capability_hash, $provider_certification_hash,
        $archive_id, $archive_hash, $evidence_ref, $evidence_hash,
        $coverage_attestation_hash, $coverage_start, $coverage_end,
        $external_completeness, $scope, $admission_json
      )
    `).run({
      $admission_id: admission.admission_id,
      $admission_ref: admission.admission_ref,
      $admission_hash: admission.admission_hash,
      $status: admission.status,
      $issued_at: admission.issued_at,
      $authority_id: admission.authority_id,
      $admission_policy_version: admission.admission_policy_version,
      $trial_id: admission.trial_id,
      $run_id: admission.run_id,
      $reservation_ref: admission.reservation_ref,
      $reservation_hash: admission.reservation_hash,
      $provider_capability_hash: admission.provider_capability_hash,
      $provider_certification_hash: admission.provider_certification.certification_hash,
      $archive_id: admission.archive_id,
      $archive_hash: admission.archive_hash,
      $evidence_ref: admission.evidence_ref,
      $evidence_hash: admission.evidence_hash,
      $coverage_attestation_hash: admission.coverage_attestation_hash,
      $coverage_start: admission.coverage_start,
      $coverage_end: admission.coverage_end,
      $external_completeness: admission.external_completeness,
      $scope: admission.scope,
      $admission_json: JSON.stringify(admission),
    })
    return structuredClone(admission)
  }).immediate()
}

export function readReplayAggregateTradeEvidenceAdmission(
  db: Database,
  reservationHash: string,
): ReplayAggregateTradeEvidenceAdmissionSnapshot {
  const row = db.query(`
    SELECT admission_hash, admission_json
    FROM rd_replay_aggregate_trade_evidence_admission
    WHERE reservation_hash = $reservation_hash
  `).get({ $reservation_hash: reservationHash }) as AdmissionRow | null
  if (!row) throw new Error("Replay aggregate trade evidence admission is not registered")
  return parseAdmissionRow(row)
}

function parseCertificationRow(row: CertificationRow): ReplayAggregateTradeProviderCertificationSnapshot {
  const certification = JSON.parse(row.certification_json) as ReplayAggregateTradeProviderCertificationSnapshot
  assertReplayAggregateTradeProviderCertificationSnapshot(certification)
  if (certification.certification_hash !== row.certification_hash) {
    throw new Error("Replay aggregate trade provider certification registry row is inconsistent")
  }
  return certification
}

function parseTerminationRow(row: TerminationRow): ReplayAggregateTradeProviderCertificationTermination {
  const termination = JSON.parse(row.termination_json) as ReplayAggregateTradeProviderCertificationTermination
  assertReplayAggregateTradeProviderCertificationTermination(termination)
  if (termination.termination_hash !== row.termination_hash) {
    throw new Error("Replay aggregate trade provider certification termination registry row is inconsistent")
  }
  return termination
}

function parseAdmissionRow(row: AdmissionRow): ReplayAggregateTradeEvidenceAdmissionSnapshot {
  const admission = JSON.parse(row.admission_json) as ReplayAggregateTradeEvidenceAdmissionSnapshot
  assertReplayAggregateTradeEvidenceAdmissionSnapshot(admission)
  if (admission.admission_hash !== row.admission_hash) {
    throw new Error("Replay aggregate trade evidence admission registry row is inconsistent")
  }
  return admission
}
