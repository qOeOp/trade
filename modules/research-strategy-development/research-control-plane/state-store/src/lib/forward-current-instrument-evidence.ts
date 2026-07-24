import type { Database } from "bun:sqlite"
import {
  assertForwardCurrentInstrumentEvidenceBinding,
  assertForwardCurrentInstrumentProviderCertification,
  type ForwardCurrentInstrumentEvidenceBinding,
  type ForwardCurrentInstrumentProviderCertification,
} from "../../../../forward-evidence-plane/contracts/src/lib/forward-current-instrument-evidence"
import {
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  ensureForwardDatasetCandidateSchema,
  readForwardDatasetCandidate,
} from "./forward-dataset-candidate"
import {
  readForwardObservationProgram,
} from "./forward-observation-program"

export function ensureForwardCurrentInstrumentEvidenceSchema(
  db: Database,
): void {
  ensureForwardDatasetCandidateSchema(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS
      rd_forward_current_instrument_provider_certification (
        certification_hash TEXT PRIMARY KEY,
        certification_id TEXT NOT NULL UNIQUE,
        provider_capability_hash TEXT NOT NULL,
        certified_at TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        certification_json TEXT NOT NULL CHECK(json_valid(certification_json))
      );
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_current_instrument_provider_certification_no_update
    BEFORE UPDATE ON rd_forward_current_instrument_provider_certification
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward current instrument provider certification is immutable'
      );
    END;
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_current_instrument_provider_certification_no_delete
    BEFORE DELETE ON rd_forward_current_instrument_provider_certification
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward current instrument provider certification is durable'
      );
    END;
    CREATE TABLE IF NOT EXISTS
      rd_forward_current_instrument_evidence_binding (
        binding_id TEXT PRIMARY KEY,
        binding_hash TEXT NOT NULL UNIQUE,
        candidate_id TEXT NOT NULL UNIQUE,
        candidate_hash TEXT NOT NULL,
        program_id TEXT NOT NULL,
        program_hash TEXT NOT NULL,
        provider_certification_hash TEXT NOT NULL,
        evidence_series_hash TEXT NOT NULL,
        instrument_status_series_hash TEXT NOT NULL,
        instrument_status_provenance_series_hash TEXT NOT NULL,
        instrument_spec_series_hash TEXT NOT NULL,
        coverage_start TEXT NOT NULL,
        coverage_end TEXT NOT NULL,
        observation_count INTEGER NOT NULL CHECK(observation_count >= 2),
        binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
        created_at TEXT NOT NULL,
        FOREIGN KEY(candidate_id)
          REFERENCES rd_forward_dataset_candidate(candidate_id),
        FOREIGN KEY(provider_certification_hash)
          REFERENCES rd_forward_current_instrument_provider_certification(
            certification_hash
          )
      );
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_current_instrument_evidence_binding_no_update
    BEFORE UPDATE ON rd_forward_current_instrument_evidence_binding
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward current instrument evidence binding is immutable'
      );
    END;
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_current_instrument_evidence_binding_no_delete
    BEFORE DELETE ON rd_forward_current_instrument_evidence_binding
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward current instrument evidence binding is durable'
      );
    END;
  `)
}

export function registerForwardCurrentInstrumentProviderCertification(
  db: Database,
  certification: ForwardCurrentInstrumentProviderCertification,
): "created" | "existing" {
  ensureForwardCurrentInstrumentEvidenceSchema(db)
  assertForwardCurrentInstrumentProviderCertification(certification)
  const existing =
    readForwardCurrentInstrumentProviderCertification(
      db,
      certification.certification_hash,
    )
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(certification)) {
      throw new Error(
        "Forward current instrument provider certification identity drifted",
      )
    }
    return "existing"
  }
  const idCollision = db.query(`
    SELECT certification_hash
    FROM rd_forward_current_instrument_provider_certification
    WHERE certification_id=$certification_id
  `).get({
    $certification_id: certification.certification_id,
  }) as { certification_hash: string } | null
  if (idCollision) {
    throw new Error(
      "Forward current instrument provider certification id collided",
    )
  }
  db.query(`
    INSERT INTO rd_forward_current_instrument_provider_certification(
      certification_hash, certification_id, provider_capability_hash,
      certified_at, valid_until, certification_json
    ) VALUES (
      $certification_hash, $certification_id, $provider_capability_hash,
      $certified_at, $valid_until, $certification_json
    )
  `).run({
    $certification_hash: certification.certification_hash,
    $certification_id: certification.certification_id,
    $provider_capability_hash:
      certification.provider_capability_hash,
    $certified_at: certification.certified_at,
    $valid_until: certification.valid_until,
    $certification_json: canonicalJson(certification),
  })
  return "created"
}

export function readForwardCurrentInstrumentProviderCertification(
  db: Database,
  certificationHash: string,
): ForwardCurrentInstrumentProviderCertification | undefined {
  ensureForwardCurrentInstrumentEvidenceSchema(db)
  const row = db.query(`
    SELECT certification_json
    FROM rd_forward_current_instrument_provider_certification
    WHERE certification_hash=$certification_hash
  `).get({
    $certification_hash: digest(
      certificationHash,
      "certification_hash",
    ),
  }) as { certification_json: string } | null
  if (!row) return undefined
  const certification = JSON.parse(row.certification_json) as
    ForwardCurrentInstrumentProviderCertification
  assertForwardCurrentInstrumentProviderCertification(certification)
  return certification
}

export function admitForwardCurrentInstrumentEvidenceBinding(
  db: Database,
  binding: ForwardCurrentInstrumentEvidenceBinding,
): "created" | "existing" {
  ensureForwardCurrentInstrumentEvidenceSchema(db)
  const candidate = readForwardDatasetCandidate(db, binding.candidate_id)
  if (!candidate) {
    throw new Error("Forward current instrument candidate is missing")
  }
  const program = readForwardObservationProgram(db, candidate.program_id)
  if (!program) {
    throw new Error("Forward current instrument program is missing")
  }
  const certification =
    readForwardCurrentInstrumentProviderCertification(
      db,
      binding.provider_certification.certification_hash,
    )
  if (!certification
      || canonicalJson(certification)
        !== canonicalJson(binding.provider_certification)) {
    throw new Error(
      "Forward current instrument provider certification was not admitted",
    )
  }
  assertForwardCurrentInstrumentEvidenceBinding({
    program,
    candidate,
    binding,
  })
  const existing = readForwardCurrentInstrumentEvidenceBinding(
    db,
    binding.candidate_id,
  )
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(binding)) {
      throw new Error(
        "Forward current instrument evidence identity drifted",
      )
    }
    return "existing"
  }
  db.query(`
    INSERT INTO rd_forward_current_instrument_evidence_binding(
      binding_id, binding_hash, candidate_id, candidate_hash,
      program_id, program_hash, provider_certification_hash,
      evidence_series_hash, instrument_status_series_hash,
      instrument_status_provenance_series_hash,
      instrument_spec_series_hash, coverage_start, coverage_end,
      observation_count, binding_json, created_at
    ) VALUES (
      $binding_id, $binding_hash, $candidate_id, $candidate_hash,
      $program_id, $program_hash, $provider_certification_hash,
      $evidence_series_hash, $instrument_status_series_hash,
      $instrument_status_provenance_series_hash,
      $instrument_spec_series_hash, $coverage_start, $coverage_end,
      $observation_count, $binding_json, $created_at
    )
  `).run({
    $binding_id: binding.binding_id,
    $binding_hash: binding.binding_hash,
    $candidate_id: binding.candidate_id,
    $candidate_hash: binding.candidate_hash,
    $program_id: binding.program_id,
    $program_hash: binding.program_hash,
    $provider_certification_hash:
      binding.provider_certification.certification_hash,
    $evidence_series_hash: binding.evidence_series_hash,
    $instrument_status_series_hash:
      binding.instrument_status_series_hash,
    $instrument_status_provenance_series_hash:
      binding.instrument_status_provenance_series_hash,
    $instrument_spec_series_hash: binding.instrument_spec_series_hash,
    $coverage_start: binding.observation_policy.coverage_start,
    $coverage_end: binding.observation_policy.coverage_end,
    $observation_count: binding.observations.length,
    $binding_json: canonicalJson(binding),
    $created_at: binding.created_at,
  })
  return "created"
}

export function readForwardCurrentInstrumentEvidenceBinding(
  db: Database,
  candidateId: string,
): ForwardCurrentInstrumentEvidenceBinding | undefined {
  ensureForwardCurrentInstrumentEvidenceSchema(db)
  const row = db.query(`
    SELECT binding_json
    FROM rd_forward_current_instrument_evidence_binding
    WHERE candidate_id=$candidate_id
  `).get({
    $candidate_id: identifier(candidateId, "candidate_id"),
  }) as { binding_json: string } | null
  if (!row) return undefined
  return JSON.parse(row.binding_json) as
    ForwardCurrentInstrumentEvidenceBinding
}

function digest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be sha256`)
  }
  return value
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}
