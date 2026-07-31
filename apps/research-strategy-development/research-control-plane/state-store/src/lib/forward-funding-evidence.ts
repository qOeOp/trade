import type { Database } from "bun:sqlite"
import {
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  compileMarketDataDemand,
  type MarketDataDemand,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import type {
  FundingReplayEvent,
} from "../../../../../contracts/market-data-demand-contract/src/funding-replay-slice-contract"
import {
  assertForwardFundingEvidenceBinding,
  buildForwardFundingMarketDataDemand,
  type ForwardFundingEvidenceBinding,
} from "../../../../forward-evidence-plane/contracts/src/lib/forward-funding-evidence"
import {
  ensureForwardDatasetCandidateSchema,
  readForwardDatasetCandidate,
} from "./forward-dataset-candidate"
import {
  readForwardObservationProgram,
} from "./forward-observation-program"

export interface ForwardFundingDemandDelivery {
  candidate_id: string
  demand: MarketDataDemand
  owner_commit_status: "created" | "renewed" | "existing"
  accepted_at: string
}

export function ensureForwardFundingEvidenceSchema(db: Database): void {
  ensureForwardDatasetCandidateSchema(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_forward_funding_demand_delivery (
      demand_hash TEXT PRIMARY KEY,
      demand_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_hash TEXT NOT NULL,
      program_id TEXT NOT NULL,
      demand_json TEXT NOT NULL CHECK(json_valid(demand_json)),
      lease_issued_at TEXT NOT NULL,
      owner_commit_status TEXT NOT NULL CHECK(
        owner_commit_status IN ('created', 'renewed', 'existing')
      ),
      accepted_at TEXT NOT NULL,
      FOREIGN KEY(candidate_id)
        REFERENCES rd_forward_dataset_candidate(candidate_id),
      FOREIGN KEY(program_id)
        REFERENCES rd_forward_observation_program(program_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rd_forward_funding_demand_latest
    ON rd_forward_funding_demand_delivery(
      candidate_id, lease_issued_at DESC, demand_hash
    );
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_funding_demand_delivery_no_update
    BEFORE UPDATE ON rd_forward_funding_demand_delivery
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward funding demand delivery is immutable'
      );
    END;
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_funding_demand_delivery_no_delete
    BEFORE DELETE ON rd_forward_funding_demand_delivery
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward funding demand delivery is durable'
      );
    END;
    CREATE TABLE IF NOT EXISTS rd_forward_funding_evidence_binding (
      binding_id TEXT PRIMARY KEY,
      binding_hash TEXT NOT NULL UNIQUE,
      candidate_id TEXT NOT NULL UNIQUE,
      candidate_hash TEXT NOT NULL,
      program_id TEXT NOT NULL,
      program_hash TEXT NOT NULL,
      demand_hash TEXT NOT NULL,
      coverage_audit_hash TEXT NOT NULL,
      market_data_fact_hash TEXT NOT NULL,
      funding_slice_hash TEXT NOT NULL,
      funding_slice_content_sha256 TEXT NOT NULL,
      binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
      created_at TEXT NOT NULL,
      FOREIGN KEY(candidate_id)
        REFERENCES rd_forward_dataset_candidate(candidate_id),
      FOREIGN KEY(demand_hash)
        REFERENCES rd_forward_funding_demand_delivery(demand_hash)
    );
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_funding_evidence_binding_no_update
    BEFORE UPDATE ON rd_forward_funding_evidence_binding
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward funding evidence binding is immutable'
      );
    END;
    CREATE TRIGGER IF NOT EXISTS
      rd_forward_funding_evidence_binding_no_delete
    BEFORE DELETE ON rd_forward_funding_evidence_binding
    BEGIN
      SELECT RAISE(
        ABORT,
        'Forward funding evidence binding is durable'
      );
    END;
  `)
}

export function recordForwardFundingDemandDelivery(
  db: Database,
  input: ForwardFundingDemandDelivery,
): "created" | "existing" {
  ensureForwardFundingEvidenceSchema(db)
  const candidate = readForwardDatasetCandidate(db, input.candidate_id)
  if (!candidate) throw new Error("Forward funding candidate is missing")
  const program = readForwardObservationProgram(db, candidate.program_id)
  if (!program) throw new Error("Forward funding program is missing")
  const demand = compileMarketDataDemand(input.demand)
  const expected = buildForwardFundingMarketDataDemand(
    program,
    candidate,
    {
      issued_at: demand.lease.issued_at,
      lease_duration_ms:
        Date.parse(demand.lease.expires_at)
        - Date.parse(demand.lease.issued_at),
    },
  )
  if (canonicalJson(demand) !== canonicalJson(expected)) {
    throw new Error("Forward funding delivered demand drifted")
  }
  const acceptedAt = utc(input.accepted_at, "accepted_at")
  if (Date.parse(acceptedAt) < Date.parse(demand.lease.issued_at)) {
    throw new Error("Forward funding demand acceptance predates issuance")
  }
  const status = commitStatus(input.owner_commit_status)
  const existing = readForwardFundingDemandDelivery(
    db,
    demand.demand_hash,
  )
  const delivery = {
    candidate_id: candidate.candidate_id,
    demand,
    owner_commit_status: status,
    accepted_at: acceptedAt,
  }
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(delivery)) {
      throw new Error("Forward funding delivery identity drifted")
    }
    return "existing"
  }
  db.query(`
    INSERT INTO rd_forward_funding_demand_delivery(
      demand_hash, demand_id, candidate_id, candidate_hash,
      program_id, demand_json, lease_issued_at,
      owner_commit_status, accepted_at
    ) VALUES (
      $demand_hash, $demand_id, $candidate_id, $candidate_hash,
      $program_id, $demand_json, $lease_issued_at,
      $owner_commit_status, $accepted_at
    )
  `).run({
    $demand_hash: demand.demand_hash,
    $demand_id: demand.demand_id,
    $candidate_id: candidate.candidate_id,
    $candidate_hash: candidate.candidate_hash,
    $program_id: program.program_id,
    $demand_json: canonicalJson(demand),
    $lease_issued_at: demand.lease.issued_at,
    $owner_commit_status: status,
    $accepted_at: acceptedAt,
  })
  return "created"
}

export function readForwardFundingDemandDelivery(
  db: Database,
  demandHash: string,
): ForwardFundingDemandDelivery | undefined {
  ensureForwardFundingEvidenceSchema(db)
  const row = db.query(`
    SELECT candidate_id, demand_json, owner_commit_status, accepted_at
    FROM rd_forward_funding_demand_delivery
    WHERE demand_hash=$demand_hash
  `).get({
    $demand_hash: digest(demandHash, "demand_hash"),
  }) as {
    candidate_id: string
    demand_json: string
    owner_commit_status: ForwardFundingDemandDelivery["owner_commit_status"]
    accepted_at: string
  } | null
  if (!row) return undefined
  return {
    candidate_id: row.candidate_id,
    demand: compileMarketDataDemand(JSON.parse(row.demand_json)),
    owner_commit_status: commitStatus(row.owner_commit_status),
    accepted_at: utc(row.accepted_at, "stored accepted_at"),
  }
}

export function readLatestForwardFundingDemandDelivery(
  db: Database,
  candidateId: string,
): ForwardFundingDemandDelivery | undefined {
  ensureForwardFundingEvidenceSchema(db)
  const row = db.query(`
    SELECT demand_hash
    FROM rd_forward_funding_demand_delivery
    WHERE candidate_id=$candidate_id
    ORDER BY lease_issued_at DESC, demand_hash COLLATE BINARY
    LIMIT 1
  `).get({
    $candidate_id: identifier(candidateId, "candidate_id"),
  }) as { demand_hash: string } | null
  return row
    ? readForwardFundingDemandDelivery(db, row.demand_hash)
    : undefined
}

export function admitForwardFundingEvidenceBinding(
  db: Database,
  input: {
    binding: ForwardFundingEvidenceBinding
    verified_events: FundingReplayEvent[]
  },
): "created" | "existing" {
  ensureForwardFundingEvidenceSchema(db)
  const binding = structuredClone(input.binding)
  const candidate = readForwardDatasetCandidate(db, binding.candidate_id)
  if (!candidate) throw new Error("Forward funding candidate is missing")
  const program = readForwardObservationProgram(db, candidate.program_id)
  if (!program) throw new Error("Forward funding program is missing")
  assertForwardFundingEvidenceBinding({
    program,
    candidate,
    binding,
    verified_events: structuredClone(input.verified_events),
  })
  const delivery = readForwardFundingDemandDelivery(
    db,
    binding.demand.demand_hash,
  )
  if (!delivery
      || delivery.candidate_id !== binding.candidate_id
      || delivery.accepted_at !== binding.demand_accepted_at
      || delivery.owner_commit_status !== binding.owner_commit_status
      || canonicalJson(delivery.demand)
        !== canonicalJson(binding.demand)) {
    throw new Error("Forward funding evidence demand receipt drifted")
  }
  const existing = readForwardFundingEvidenceBinding(
    db,
    binding.candidate_id,
  )
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(binding)) {
      throw new Error("Forward funding evidence identity drifted")
    }
    return "existing"
  }
  db.query(`
    INSERT INTO rd_forward_funding_evidence_binding(
      binding_id, binding_hash, candidate_id, candidate_hash,
      program_id, program_hash, demand_hash, coverage_audit_hash,
      market_data_fact_hash, funding_slice_hash,
      funding_slice_content_sha256, binding_json, created_at
    ) VALUES (
      $binding_id, $binding_hash, $candidate_id, $candidate_hash,
      $program_id, $program_hash, $demand_hash, $coverage_audit_hash,
      $market_data_fact_hash, $funding_slice_hash,
      $funding_slice_content_sha256, $binding_json, $created_at
    )
  `).run({
    $binding_id: binding.binding_id,
    $binding_hash: binding.binding_hash,
    $candidate_id: binding.candidate_id,
    $candidate_hash: binding.candidate_hash,
    $program_id: binding.program_id,
    $program_hash: binding.program_hash,
    $demand_hash: binding.demand.demand_hash,
    $coverage_audit_hash: binding.coverage_audit.audit_hash,
    $market_data_fact_hash: binding.market_data_fact.fact_hash,
    $funding_slice_hash: binding.funding_slice.slice_hash,
    $funding_slice_content_sha256:
      binding.funding_slice.content_sha256,
    $binding_json: canonicalJson(binding),
    $created_at: binding.created_at,
  })
  return "created"
}

export function readForwardFundingEvidenceBinding(
  db: Database,
  candidateId: string,
): ForwardFundingEvidenceBinding | undefined {
  ensureForwardFundingEvidenceSchema(db)
  const row = db.query(`
    SELECT binding_json
    FROM rd_forward_funding_evidence_binding
    WHERE candidate_id=$candidate_id
  `).get({
    $candidate_id: identifier(candidateId, "candidate_id"),
  }) as { binding_json: string } | null
  if (!row) return undefined
  return JSON.parse(row.binding_json) as ForwardFundingEvidenceBinding
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
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

function commitStatus(
  value: unknown,
): ForwardFundingDemandDelivery["owner_commit_status"] {
  if (value !== "created"
      && value !== "renewed"
      && value !== "existing") {
    throw new Error("owner_commit_status is unsupported")
  }
  return value
}
