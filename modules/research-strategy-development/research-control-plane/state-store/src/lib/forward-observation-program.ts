import type { Database } from "bun:sqlite"
import {
  assertForwardObservationMarketDataDemand,
  assertForwardObservationProgram,
  type ForwardObservationProgram,
} from "../../../contracts/src/lib/forward-observation-program"
import type { MarketDataDemand } from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"

export interface ForwardMarketDataDemandDelivery {
  program_id: string
  demand: MarketDataDemand
  owner_commit_status: "created" | "renewed" | "existing"
  accepted_at: string
}

export function ensureForwardObservationProgramSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_forward_observation_program (
      program_id TEXT PRIMARY KEY,
      source_admission_id TEXT NOT NULL UNIQUE,
      source_binding_hash TEXT NOT NULL UNIQUE,
      experiment_id TEXT NOT NULL UNIQUE,
      draft_id TEXT NOT NULL UNIQUE,
      selected_trial_id TEXT NOT NULL,
      historical_request_registration_id TEXT NOT NULL UNIQUE,
      historical_request_hash TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      frozen_at TEXT NOT NULL,
      first_observation_open_time TEXT NOT NULL,
      market_data_demand_id TEXT NOT NULL UNIQUE,
      program_hash TEXT NOT NULL UNIQUE,
      program_json TEXT NOT NULL CHECK(json_valid(program_json)),
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_admission_id)
        REFERENCES rd_forward_source_admission(admission_id),
      FOREIGN KEY (experiment_id)
        REFERENCES rd_experiment_contract(experiment_id),
      FOREIGN KEY (draft_id) REFERENCES rd_strategy_draft(draft_id),
      FOREIGN KEY (historical_request_registration_id)
        REFERENCES rd_replay_request_registration(registration_id)
    );
    CREATE TRIGGER IF NOT EXISTS rd_forward_observation_program_no_update
    BEFORE UPDATE ON rd_forward_observation_program
    BEGIN
      SELECT RAISE(ABORT, 'Forward observation program is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS rd_forward_observation_program_no_delete
    BEFORE DELETE ON rd_forward_observation_program
    BEGIN
      SELECT RAISE(ABORT, 'Forward observation program is durable');
    END;

    CREATE TABLE IF NOT EXISTS rd_forward_market_data_demand_delivery (
      demand_hash TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      demand_id TEXT NOT NULL,
      demand_json TEXT NOT NULL CHECK(json_valid(demand_json)),
      lease_issued_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      owner_commit_status TEXT NOT NULL CHECK(owner_commit_status IN (
        'created', 'renewed', 'existing'
      )),
      accepted_at TEXT NOT NULL,
      UNIQUE(program_id, lease_issued_at),
      FOREIGN KEY (program_id)
        REFERENCES rd_forward_observation_program(program_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rd_forward_demand_delivery_latest
    ON rd_forward_market_data_demand_delivery(
      program_id, lease_expires_at DESC, demand_hash
    );
    CREATE TRIGGER IF NOT EXISTS rd_forward_demand_delivery_no_update
    BEFORE UPDATE ON rd_forward_market_data_demand_delivery
    BEGIN
      SELECT RAISE(ABORT, 'Forward market-data delivery is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS rd_forward_demand_delivery_no_delete
    BEFORE DELETE ON rd_forward_market_data_demand_delivery
    BEGIN
      SELECT RAISE(ABORT, 'Forward market-data delivery is durable');
    END;
  `)
}

export function admitForwardObservationProgram(
  db: Database,
  program: ForwardObservationProgram,
): ForwardObservationProgram {
  assertForwardObservationProgram(program)
  ensureForwardObservationProgramSchema(db)
  const existing = readForwardObservationProgram(db, program.program_id)
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(program)) {
      throw new Error("Forward observation program identity drifted")
    }
    return existing
  }
  db.transaction(() => {
    const source = db.query(`
      SELECT binding_hash, binding_json, admitted_at
      FROM rd_forward_source_admission
      WHERE admission_id=$admission_id
    `).get({
      $admission_id: program.source_admission_id,
    }) as {
      binding_hash: string
      binding_json: string
      admitted_at: string
    } | null
    if (!source || source.binding_hash !== program.source_binding_hash) {
      throw new Error("Forward observation program source admission drifted")
    }
    const binding = JSON.parse(source.binding_json) as Record<string, unknown>
    if (binding.experiment_id !== program.experiment_id
        || binding.decision_id !== program.decision_id
        || binding.draft_id !== program.draft_id
        || binding.strategy_id !== program.strategy_id
        || binding.strategy_version !== program.strategy_version
        || binding.strategy_source_hash !== program.strategy_policy_hash
        || Date.parse(program.created_at) < Date.parse(source.admitted_at)) {
      throw new Error("Forward observation program source identity drifted")
    }
    const experiment = db.query(`
      SELECT lifecycle_state FROM rd_experiment_contract
      WHERE experiment_id=$experiment_id
    `).get({
      $experiment_id: program.experiment_id,
    }) as { lifecycle_state: string } | null
    if (!experiment || experiment.lifecycle_state !== "forward_observation") {
      throw new Error("Forward observation program requires forward_observation lifecycle")
    }
    const draft = db.query(`
      SELECT strategy_id, strategy_version, strategy_policy_hash,
             materialization_status, authorization_json
      FROM rd_strategy_draft WHERE draft_id=$draft_id
    `).get({
      $draft_id: program.draft_id,
    }) as {
      strategy_id: string
      strategy_version: string
      strategy_policy_hash: string
      materialization_status: string
      authorization_json: string
    } | null
    const authorization = draft
      ? JSON.parse(draft.authorization_json) as Record<string, unknown>
      : undefined
    const identity = authorization?.identity as Record<string, unknown>
      | undefined
    if (!draft
        || draft.materialization_status !== "ready"
        || draft.strategy_id !== program.strategy_id
        || draft.strategy_version !== program.strategy_version
        || draft.strategy_policy_hash !== program.strategy_policy_hash
        || authorization?.decision_id !== program.decision_id
        || authorization?.selected_trial_id !== program.selected_trial_id
        || authorization?.candidate_frozen_at !== program.frozen_at
        || identity?.experiment_id !== program.experiment_id) {
      throw new Error("Forward observation program Draft authority drifted")
    }
    const registration = db.query(`
      SELECT trial_id, request_hash, replay_request_json
      FROM rd_replay_request_registration
      WHERE registration_id=$registration_id
    `).get({
      $registration_id:
        program.historical_replay_request_registration_id,
    }) as {
      trial_id: string
      request_hash: string
      replay_request_json: string
    } | null
    const request = registration
      ? JSON.parse(registration.replay_request_json) as Record<string, unknown>
      : undefined
    if (!registration
        || registration.trial_id !== program.selected_trial_id
        || registration.request_hash
          !== program.historical_replay_request_hash
        || request?.experiment_id !== program.experiment_id
        || request?.trial_id !== program.selected_trial_id
        || request?.candidate_id !== identity?.candidate_id
        || request?.candidate_hash !== identity?.candidate_hash
        || request?.symbol !== program.symbol
        || request?.timeframe !== program.timeframe) {
      throw new Error(
        "Forward observation program historical Replay lineage drifted",
      )
    }
    db.query(`
      INSERT INTO rd_forward_observation_program(
        program_id, source_admission_id, source_binding_hash,
        experiment_id, draft_id, selected_trial_id,
        historical_request_registration_id, historical_request_hash,
        symbol, timeframe, frozen_at, first_observation_open_time,
        market_data_demand_id, program_hash, program_json, created_at
      ) VALUES (
        $program_id, $source_admission_id, $source_binding_hash,
        $experiment_id, $draft_id, $selected_trial_id,
        $registration_id, $request_hash,
        $symbol, $timeframe, $frozen_at, $first_open,
        $demand_id, $program_hash, $program_json, $created_at
      )
    `).run({
      $program_id: program.program_id,
      $source_admission_id: program.source_admission_id,
      $source_binding_hash: program.source_binding_hash,
      $experiment_id: program.experiment_id,
      $draft_id: program.draft_id,
      $selected_trial_id: program.selected_trial_id,
      $registration_id:
        program.historical_replay_request_registration_id,
      $request_hash: program.historical_replay_request_hash,
      $symbol: program.symbol,
      $timeframe: program.timeframe,
      $frozen_at: program.frozen_at,
      $first_open: program.first_observation_open_time,
      $demand_id: program.market_data_demand_id,
      $program_hash: program.program_hash,
      $program_json: canonicalJson(program),
      $created_at: program.created_at,
    })
  }).immediate()
  return requireForwardObservationProgram(db, program.program_id)
}

export function readForwardObservationProgram(
  db: Database,
  programId: string,
): ForwardObservationProgram | undefined {
  ensureForwardObservationProgramSchema(db)
  const row = db.query(`
    SELECT program_json FROM rd_forward_observation_program
    WHERE program_id=$program_id
  `).get({
    $program_id: identifier(programId, "program_id"),
  }) as { program_json: string } | null
  if (!row) return undefined
  const program = JSON.parse(row.program_json) as ForwardObservationProgram
  assertForwardObservationProgram(program)
  return program
}

export function listCollectingForwardObservationPrograms(
  db: Database,
  limit = 1_000,
): ForwardObservationProgram[] {
  ensureForwardObservationProgramSchema(db)
  const rows = db.query(`
    SELECT program.program_json
    FROM rd_forward_observation_program AS program
    JOIN rd_experiment_contract AS experiment
      ON experiment.experiment_id=program.experiment_id
    WHERE experiment.lifecycle_state='forward_observation'
    ORDER BY program.program_id COLLATE BINARY
    LIMIT $limit
  `).all({
    $limit: integer(limit, 1, 10_000, "limit"),
  }) as Array<{ program_json: string }>
  return rows.map((row) => {
    const program = JSON.parse(row.program_json) as ForwardObservationProgram
    assertForwardObservationProgram(program)
    return program
  })
}

export function recordForwardMarketDataDemandDelivery(
  db: Database,
  input: ForwardMarketDataDemandDelivery,
): "created" | "existing" {
  ensureForwardObservationProgramSchema(db)
  const program = requireForwardObservationProgram(db, input.program_id)
  const demand = assertForwardObservationMarketDataDemand(
    program,
    input.demand,
  )
  const acceptedAt = utc(input.accepted_at, "accepted_at")
  if (Date.parse(acceptedAt) < Date.parse(demand.lease.issued_at)
      || Date.parse(acceptedAt) > Date.parse(demand.lease.expires_at)) {
    throw new Error("Forward market-data delivery is outside its lease")
  }
  if (!["created", "renewed", "existing"].includes(
    input.owner_commit_status,
  )) {
    throw new Error("Forward market-data owner commit status is invalid")
  }
  const existing = db.query(`
    SELECT demand_json, owner_commit_status, accepted_at
    FROM rd_forward_market_data_demand_delivery
    WHERE demand_hash=$demand_hash
  `).get({
    $demand_hash: demand.demand_hash,
  }) as {
    demand_json: string
    owner_commit_status: string
    accepted_at: string
  } | null
  if (existing) {
    if (existing.demand_json !== canonicalJson(demand)
        || existing.owner_commit_status !== input.owner_commit_status
        || existing.accepted_at !== acceptedAt) {
      throw new Error("Forward market-data delivery identity drifted")
    }
    return "existing"
  }
  db.query(`
    INSERT INTO rd_forward_market_data_demand_delivery(
      demand_hash, program_id, demand_id, demand_json,
      lease_issued_at, lease_expires_at, owner_commit_status, accepted_at
    ) VALUES (
      $demand_hash, $program_id, $demand_id, $demand_json,
      $lease_issued_at, $lease_expires_at, $owner_commit_status, $accepted_at
    )
  `).run({
    $demand_hash: demand.demand_hash,
    $program_id: program.program_id,
    $demand_id: demand.demand_id,
    $demand_json: canonicalJson(demand),
    $lease_issued_at: demand.lease.issued_at,
    $lease_expires_at: demand.lease.expires_at,
    $owner_commit_status: input.owner_commit_status,
    $accepted_at: acceptedAt,
  })
  return "created"
}

export function readLatestForwardMarketDataDemandDelivery(
  db: Database,
  programId: string,
): ForwardMarketDataDemandDelivery | undefined {
  ensureForwardObservationProgramSchema(db)
  const row = db.query(`
    SELECT demand_json, owner_commit_status, accepted_at
    FROM rd_forward_market_data_demand_delivery
    WHERE program_id=$program_id
    ORDER BY lease_expires_at DESC, demand_hash COLLATE BINARY
    LIMIT 1
  `).get({
    $program_id: identifier(programId, "program_id"),
  }) as {
    demand_json: string
    owner_commit_status: ForwardMarketDataDemandDelivery["owner_commit_status"]
    accepted_at: string
  } | null
  if (!row) return undefined
  const program = requireForwardObservationProgram(db, programId)
  const demand = assertForwardObservationMarketDataDemand(
    program,
    JSON.parse(row.demand_json),
  )
  return {
    program_id: program.program_id,
    demand,
    owner_commit_status: row.owner_commit_status,
    accepted_at: utc(row.accepted_at, "stored accepted_at"),
  }
}

function requireForwardObservationProgram(
  db: Database,
  programId: string,
): ForwardObservationProgram {
  const program = readForwardObservationProgram(db, programId)
  if (!program) throw new Error("Forward observation program is missing")
  return program
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)
      || Number(value) < minimum
      || Number(value) > maximum) {
    throw new Error(`${field} is outside its allowed range`)
  }
  return Number(value)
}
