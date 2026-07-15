import type { Database } from "bun:sqlite"
import {
  assertReplayInstrumentStatusProviderCertificationSnapshot,
  type ReplayInstrumentStatusProviderCertificationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

interface CertificationRow {
  certification_hash: string
  certification_json: string
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
