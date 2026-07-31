import type { Database } from "bun:sqlite"
import {
  assertForwardObservationCandleSegment,
  type ForwardObservationCandleSegment,
} from "../../../contracts/src/lib/forward-observation-candle-segment"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  ensureForwardObservationProgramSchema,
  readForwardMarketDataDemandDelivery,
  readForwardObservationProgram,
} from "./forward-observation-program"

export function ensureForwardObservationCandleSegmentSchema(
  db: Database,
): void {
  ensureForwardObservationProgramSchema(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_forward_observation_candle_segment (
      segment_id TEXT PRIMARY KEY,
      segment_hash TEXT NOT NULL UNIQUE,
      program_id TEXT NOT NULL,
      program_hash TEXT NOT NULL,
      previous_segment_id TEXT,
      previous_segment_hash TEXT,
      demand_hash TEXT NOT NULL,
      subscription_plan_hash TEXT NOT NULL,
      coverage_audit_hash TEXT NOT NULL,
      market_data_fact_hash TEXT NOT NULL UNIQUE,
      candle_slice_ref TEXT NOT NULL,
      candle_slice_content_sha256 TEXT NOT NULL,
      start_open_time TEXT NOT NULL,
      end_open_time TEXT NOT NULL,
      data_watermark TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK(row_count > 0),
      segment_json TEXT NOT NULL CHECK(json_valid(segment_json)),
      created_at TEXT NOT NULL,
      UNIQUE(program_id, data_watermark),
      FOREIGN KEY (program_id)
        REFERENCES rd_forward_observation_program(program_id),
      FOREIGN KEY (previous_segment_id)
        REFERENCES rd_forward_observation_candle_segment(segment_id),
      FOREIGN KEY (demand_hash)
        REFERENCES rd_forward_market_data_demand_delivery(demand_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_rd_forward_candle_segment_latest
    ON rd_forward_observation_candle_segment(
      program_id, data_watermark DESC, segment_id
    );
    CREATE TRIGGER IF NOT EXISTS rd_forward_candle_segment_no_update
    BEFORE UPDATE ON rd_forward_observation_candle_segment
    BEGIN
      SELECT RAISE(ABORT, 'Forward candle segment is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS rd_forward_candle_segment_no_delete
    BEFORE DELETE ON rd_forward_observation_candle_segment
    BEGIN
      SELECT RAISE(ABORT, 'Forward candle segment is durable');
    END;
  `)
}

export function admitForwardObservationCandleSegment(
  db: Database,
  segment: ForwardObservationCandleSegment,
): "created" | "existing" {
  ensureForwardObservationCandleSegmentSchema(db)
  const program = readForwardObservationProgram(db, segment.program_id)
  if (!program) throw new Error("Forward candle segment program is missing")
  const existing = readForwardObservationCandleSegment(
    db,
    segment.segment_id,
  )
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(segment)) {
      throw new Error("Forward candle segment identity drifted")
    }
    return "existing"
  }
  const latest = readLatestForwardObservationCandleSegment(
    db,
    program.program_id,
  )
  assertForwardObservationCandleSegment(program, segment, latest ?? null)
  const experiment = db.query(`
    SELECT lifecycle_state FROM rd_experiment_contract
    WHERE experiment_id=$experiment_id
  `).get({
    $experiment_id: program.experiment_id,
  }) as { lifecycle_state: string } | null
  if (!experiment || experiment.lifecycle_state !== "forward_observation") {
    throw new Error(
      "Forward candle segment requires forward_observation lifecycle",
    )
  }
  const delivery = readForwardMarketDataDemandDelivery(
    db,
    segment.demand.demand_hash,
  )
  if (!delivery
      || delivery.program_id !== program.program_id
      || delivery.accepted_at !== segment.demand_accepted_at
      || canonicalJson(delivery.demand) !== canonicalJson(segment.demand)) {
    throw new Error("Forward candle segment demand receipt drifted")
  }
  db.query(`
    INSERT INTO rd_forward_observation_candle_segment(
      segment_id, segment_hash, program_id, program_hash,
      previous_segment_id, previous_segment_hash, demand_hash,
      subscription_plan_hash, coverage_audit_hash,
      market_data_fact_hash, candle_slice_ref,
      candle_slice_content_sha256, start_open_time, end_open_time,
      data_watermark, row_count, segment_json, created_at
    ) VALUES (
      $segment_id, $segment_hash, $program_id, $program_hash,
      $previous_segment_id, $previous_segment_hash, $demand_hash,
      $subscription_plan_hash, $coverage_audit_hash,
      $market_data_fact_hash, $candle_slice_ref,
      $candle_slice_content_sha256, $start_open_time, $end_open_time,
      $data_watermark, $row_count, $segment_json, $created_at
    )
  `).run({
    $segment_id: segment.segment_id,
    $segment_hash: segment.segment_hash,
    $program_id: segment.program_id,
    $program_hash: segment.program_hash,
    $previous_segment_id: segment.previous_segment?.segment_id ?? null,
    $previous_segment_hash: segment.previous_segment?.segment_hash ?? null,
    $demand_hash: segment.demand.demand_hash,
    $subscription_plan_hash: segment.subscription_plan.plan_hash,
    $coverage_audit_hash: segment.coverage_audit.audit_hash,
    $market_data_fact_hash: segment.market_data_fact.fact_hash,
    $candle_slice_ref: segment.candle_slice.slice_ref,
    $candle_slice_content_sha256:
      segment.candle_slice.content_sha256,
    $start_open_time: segment.window.start_open_time,
    $end_open_time: segment.window.end_open_time,
    $data_watermark: segment.window.data_watermark,
    $row_count: segment.window.row_count,
    $segment_json: canonicalJson(segment),
    $created_at: segment.created_at,
  })
  return "created"
}

export function readForwardObservationCandleSegment(
  db: Database,
  segmentId: string,
): ForwardObservationCandleSegment | undefined {
  ensureForwardObservationCandleSegmentSchema(db)
  const row = db.query(`
    SELECT segment_json
    FROM rd_forward_observation_candle_segment
    WHERE segment_id=$segment_id
  `).get({
    $segment_id: identifier(segmentId, "segment_id"),
  }) as { segment_json: string } | null
  if (!row) return undefined
  return JSON.parse(row.segment_json) as ForwardObservationCandleSegment
}

export function readLatestForwardObservationCandleSegment(
  db: Database,
  programId: string,
): ForwardObservationCandleSegment | undefined {
  ensureForwardObservationCandleSegmentSchema(db)
  const row = db.query(`
    SELECT segment_json
    FROM rd_forward_observation_candle_segment
    WHERE program_id=$program_id
    ORDER BY data_watermark DESC, segment_id COLLATE BINARY
    LIMIT 1
  `).get({
    $program_id: identifier(programId, "program_id"),
  }) as { segment_json: string } | null
  if (!row) return undefined
  return JSON.parse(row.segment_json) as ForwardObservationCandleSegment
}

export function listForwardObservationCandleSegments(
  db: Database,
  programId: string,
  limit = 10_000,
): ForwardObservationCandleSegment[] {
  ensureForwardObservationCandleSegmentSchema(db)
  const rows = db.query(`
    SELECT segment_json
    FROM rd_forward_observation_candle_segment
    WHERE program_id=$program_id
    ORDER BY data_watermark, segment_id COLLATE BINARY
    LIMIT $limit
  `).all({
    $program_id: identifier(programId, "program_id"),
    $limit: integer(limit, 1, 100_000, "limit"),
  }) as Array<{ segment_json: string }>
  return rows.map((row) => (
    JSON.parse(row.segment_json) as ForwardObservationCandleSegment
  ))
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
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
