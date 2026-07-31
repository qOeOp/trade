import type { Database } from "bun:sqlite"
import {
  assertReplayInstrumentStatusProviderCertificationSnapshot,
  assertReplayInstrumentStatusProviderCertificationTermination,
  type ReplayInstrumentStatusProviderCertificationSnapshot,
  type ReplayInstrumentStatusProviderCertificationTermination,
} from "../../../contracts/src/lib/control-plane-contracts"

interface CertificationRow {
  certification_hash: string
  certification_json: string
}

interface TerminationRow {
  termination_hash: string
  termination_json: string
}

export function registerReplayInstrumentStatusProviderCertification(
  db: Database,
  certification: ReplayInstrumentStatusProviderCertificationSnapshot,
): ReplayInstrumentStatusProviderCertificationSnapshot {
  assertReplayInstrumentStatusProviderCertificationSnapshot(certification)
  const existing = db.query(`
    SELECT certification_hash, certification_json
    FROM rd_replay_instrument_status_provider_certification
    WHERE certification_id = $certification_id OR certification_ref = $certification_ref
  `).get({
    $certification_id: certification.certification_id,
    $certification_ref: certification.certification_ref,
  }) as CertificationRow | null
  const canonicalJson = JSON.stringify(certification)
  if (existing) {
    if (existing.certification_hash !== certification.certification_hash) {
      throw new Error("Replay provider certification identity already exists with different content")
    }
    const registered = JSON.parse(existing.certification_json) as ReplayInstrumentStatusProviderCertificationSnapshot
    assertReplayInstrumentStatusProviderCertificationSnapshot(registered)
    return registered
  }
  db.query(`
    INSERT INTO rd_replay_instrument_status_provider_certification(
      certification_id, certification_ref, certification_hash, status,
      certified_at, valid_until, certifier_id, certification_policy_version,
      provider_capability_hash, producer_domain, producer_id, producer_version,
      producer_build_hash, normalization_policy_version, normalization_policy_hash,
      allowed_source_kind, allowed_completeness, certification_json
    ) VALUES (
      $certification_id, $certification_ref, $certification_hash, $status,
      $certified_at, $valid_until, $certifier_id, $certification_policy_version,
      $provider_capability_hash, $producer_domain, $producer_id, $producer_version,
      $producer_build_hash, $normalization_policy_version, $normalization_policy_hash,
      $allowed_source_kind, $allowed_completeness, $certification_json
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
    $normalization_policy_version: certification.normalization_policy_version,
    $normalization_policy_hash: certification.normalization_policy_hash,
    $allowed_source_kind: certification.allowed_source_kind,
    $allowed_completeness: certification.allowed_completeness,
    $certification_json: canonicalJson,
  })
  return structuredClone(certification)
}

export function readReplayInstrumentStatusProviderCertification(
  db: Database,
  certificationHash: string,
): ReplayInstrumentStatusProviderCertificationSnapshot {
  const row = db.query(`
    SELECT certification_hash, certification_json
    FROM rd_replay_instrument_status_provider_certification
    WHERE certification_hash = $certification_hash
  `).get({ $certification_hash: certificationHash }) as CertificationRow | null
  if (!row) throw new Error("Replay provider certification is not registered")
  const certification = JSON.parse(row.certification_json) as ReplayInstrumentStatusProviderCertificationSnapshot
  assertReplayInstrumentStatusProviderCertificationSnapshot(certification)
  if (certification.certification_hash !== row.certification_hash) {
    throw new Error("Replay provider certification registry row is inconsistent")
  }
  return certification
}

export function registerReplayInstrumentStatusProviderCertificationTermination(
  db: Database,
  termination: ReplayInstrumentStatusProviderCertificationTermination,
): ReplayInstrumentStatusProviderCertificationTermination {
  assertReplayInstrumentStatusProviderCertificationTermination(termination)
  const write = db.transaction(() => {
    const existing = db.query(`
      SELECT termination_hash, termination_json
      FROM rd_replay_instrument_status_provider_certification_termination
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
        throw new Error("Replay provider certification already has a different termination")
      }
      return parseTerminationRow(existing)
    }

    const certification = readReplayInstrumentStatusProviderCertification(db, termination.certification_hash)
    const effectiveAt = Date.parse(termination.effective_at)
    if (effectiveAt < Date.parse(certification.certified_at) || effectiveAt >= Date.parse(certification.valid_until)) {
      throw new Error("Replay provider certification termination must fall inside its validity window")
    }
    if (termination.termination_type === "superseded") {
      const successorHash = termination.successor_certification_hash as string
      const successor = assertReplayInstrumentStatusProviderCertificationAdmittedAt(db, successorHash, termination.effective_at)
      if (successor.producer_domain !== certification.producer_domain || successor.producer_id !== certification.producer_id) {
        throw new Error("Replay provider certification successor must belong to the same provider")
      }
    }

    db.query(`
      INSERT INTO rd_replay_instrument_status_provider_certification_termination(
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
  })
  return write.immediate()
}

export function readReplayInstrumentStatusProviderCertificationTermination(
  db: Database,
  certificationHash: string,
): ReplayInstrumentStatusProviderCertificationTermination | null {
  const row = db.query(`
    SELECT termination_hash, termination_json
    FROM rd_replay_instrument_status_provider_certification_termination
    WHERE certification_hash = $certification_hash
  `).get({ $certification_hash: certificationHash }) as TerminationRow | null
  return row ? parseTerminationRow(row) : null
}

export function assertReplayInstrumentStatusProviderCertificationAdmittedAt(
  db: Database,
  certificationHash: string,
  admittedAt: string,
): ReplayInstrumentStatusProviderCertificationSnapshot {
  const certification = readReplayInstrumentStatusProviderCertification(db, certificationHash)
  const instant = Date.parse(admittedAt)
  if (!Number.isFinite(instant)
      || instant < Date.parse(certification.certified_at)
      || instant >= Date.parse(certification.valid_until)) {
    throw new Error("Trial Reservation must be issued while provider certification is valid")
  }
  const termination = readReplayInstrumentStatusProviderCertificationTermination(db, certificationHash)
  if (termination && instant >= Date.parse(termination.effective_at)) {
    throw new Error(`Trial Reservation provider certification was ${termination.termination_type}`)
  }
  return certification
}

function parseTerminationRow(row: TerminationRow): ReplayInstrumentStatusProviderCertificationTermination {
  const termination = JSON.parse(row.termination_json) as ReplayInstrumentStatusProviderCertificationTermination
  assertReplayInstrumentStatusProviderCertificationTermination(termination)
  if (termination.termination_hash !== row.termination_hash) {
    throw new Error("Replay provider certification termination registry row is inconsistent")
  }
  return termination
}
