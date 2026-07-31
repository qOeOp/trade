import type { Database } from "bun:sqlite"
import {
  assertForwardDatasetCandidate,
  type ForwardDatasetCandidate,
} from "../../../../forward-evidence-plane/contracts/src/lib/forward-dataset-candidate"
import type {
  ReplayMarketBar,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  ensureForwardObservationCandleSegmentSchema,
  listForwardObservationCandleSegments,
} from "./forward-observation-candle-segment"
import {
  readForwardObservationProgram,
} from "./forward-observation-program"

export function ensureForwardDatasetCandidateSchema(db: Database): void {
  ensureForwardObservationCandleSegmentSchema(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_forward_dataset_candidate (
      candidate_id TEXT PRIMARY KEY,
      candidate_hash TEXT NOT NULL UNIQUE,
      program_id TEXT NOT NULL,
      program_hash TEXT NOT NULL,
      head_segment_id TEXT NOT NULL UNIQUE,
      head_segment_hash TEXT NOT NULL UNIQUE,
      data_watermark TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK(row_count > 0),
      bars_artifact_ref TEXT NOT NULL,
      bars_artifact_sha256 TEXT NOT NULL,
      ohlcv_only_replay_dataset_hash TEXT NOT NULL,
      candidate_json TEXT NOT NULL CHECK(json_valid(candidate_json)),
      created_at TEXT NOT NULL,
      UNIQUE(program_id, data_watermark),
      FOREIGN KEY (program_id)
        REFERENCES rd_forward_observation_program(program_id),
      FOREIGN KEY (head_segment_id)
        REFERENCES rd_forward_observation_candle_segment(segment_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rd_forward_dataset_candidate_latest
    ON rd_forward_dataset_candidate(
      program_id, data_watermark DESC, candidate_id
    );
    CREATE TRIGGER IF NOT EXISTS rd_forward_dataset_candidate_no_update
    BEFORE UPDATE ON rd_forward_dataset_candidate
    BEGIN
      SELECT RAISE(ABORT, 'Forward dataset candidate is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS rd_forward_dataset_candidate_no_delete
    BEFORE DELETE ON rd_forward_dataset_candidate
    BEGIN
      SELECT RAISE(ABORT, 'Forward dataset candidate is durable');
    END;
  `)
}

export function admitForwardDatasetCandidate(
  db: Database,
  input: {
    candidate: ForwardDatasetCandidate
    verified_bars: ReplayMarketBar[]
  },
): "created" | "existing" {
  ensureForwardDatasetCandidateSchema(db)
  const candidate = structuredClone(input.candidate)
  const existing = readForwardDatasetCandidate(db, candidate.candidate_id)
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(candidate)) {
      throw new Error("Forward dataset candidate identity drifted")
    }
  }
  const program = readForwardObservationProgram(db, candidate.program_id)
  if (!program) {
    throw new Error("Forward dataset candidate program is missing")
  }
  const segments = listForwardObservationCandleSegments(
    db,
    candidate.program_id,
    candidate.segment_chain.length,
  )
  if (segments.length !== candidate.segment_chain.length
      || segments.at(-1)?.segment_id !== candidate.head_segment_id) {
    throw new Error(
      "Forward dataset candidate does not bind the complete segment prefix",
    )
  }
  assertForwardDatasetCandidate(
    program,
    segments,
    structuredClone(input.verified_bars),
    candidate,
  )
  if (existing) return "existing"
  const experiment = db.query(`
    SELECT lifecycle_state FROM rd_experiment_contract
    WHERE experiment_id=$experiment_id
  `).get({
    $experiment_id: program.experiment_id,
  }) as { lifecycle_state: string } | null
  if (!experiment || experiment.lifecycle_state !== "forward_observation") {
    throw new Error(
      "Forward dataset candidate requires forward_observation lifecycle",
    )
  }
  db.query(`
    INSERT INTO rd_forward_dataset_candidate(
      candidate_id, candidate_hash, program_id, program_hash,
      head_segment_id, head_segment_hash, data_watermark, row_count,
      bars_artifact_ref, bars_artifact_sha256,
      ohlcv_only_replay_dataset_hash, candidate_json, created_at
    ) VALUES (
      $candidate_id, $candidate_hash, $program_id, $program_hash,
      $head_segment_id, $head_segment_hash, $data_watermark, $row_count,
      $bars_artifact_ref, $bars_artifact_sha256,
      $ohlcv_only_replay_dataset_hash, $candidate_json, $created_at
    )
  `).run({
    $candidate_id: candidate.candidate_id,
    $candidate_hash: candidate.candidate_hash,
    $program_id: candidate.program_id,
    $program_hash: candidate.program_hash,
    $head_segment_id: candidate.head_segment_id,
    $head_segment_hash: candidate.head_segment_hash,
    $data_watermark: candidate.window.data_watermark,
    $row_count: candidate.window.row_count,
    $bars_artifact_ref: candidate.bars_artifact_ref,
    $bars_artifact_sha256: candidate.bars_artifact_sha256,
    $ohlcv_only_replay_dataset_hash:
      candidate.ohlcv_only_replay_dataset_hash,
    $candidate_json: canonicalJson(candidate),
    $created_at: candidate.created_at,
  })
  return "created"
}

export function readForwardDatasetCandidate(
  db: Database,
  candidateId: string,
): ForwardDatasetCandidate | undefined {
  ensureForwardDatasetCandidateSchema(db)
  const row = db.query(`
    SELECT candidate_json FROM rd_forward_dataset_candidate
    WHERE candidate_id=$candidate_id
  `).get({
    $candidate_id: identifier(candidateId, "candidate_id"),
  }) as { candidate_json: string } | null
  if (!row) return undefined
  return JSON.parse(row.candidate_json) as ForwardDatasetCandidate
}

export function readLatestForwardDatasetCandidate(
  db: Database,
  programId: string,
): ForwardDatasetCandidate | undefined {
  ensureForwardDatasetCandidateSchema(db)
  const row = db.query(`
    SELECT candidate_json FROM rd_forward_dataset_candidate
    WHERE program_id=$program_id
    ORDER BY data_watermark DESC, candidate_id COLLATE BINARY
    LIMIT 1
  `).get({
    $program_id: identifier(programId, "program_id"),
  }) as { candidate_json: string } | null
  if (!row) return undefined
  return JSON.parse(row.candidate_json) as ForwardDatasetCandidate
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}
