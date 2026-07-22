import type { Database } from "bun:sqlite"
import {
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  canonicalHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  assertReplayL2CompactedEpochSource,
  assertReplayL2DepthReadBatch,
  type ReplayL2CompactedEpochSource,
  type ReplayL2DepthReadBatch,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-l2-depth-contracts"
import {
  REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS,
  REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_SCHEMA_VERSION,
  assertReplayL2ExperimentAttachmentAuthoritySnapshot,
  createReplayL2ExperimentAttachmentAuthoritySnapshot,
  type ReplayL2ExperimentAttachmentAuthoritySnapshot,
} from "../../../contracts/src/lib/replay-l2-experiment-attachment-authority"
import {
  assertTrialReservationSnapshot,
  hashTrialReservationSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

interface AuthorityRow {
  authority_snapshot_hash: string
  authority_json: string
}

export interface IssueReplayL2ExperimentAttachmentAuthorityInput {
  authority_snapshot_id: string
  authority_snapshot_ref: string
  issued_at: string
  authority_id: string
  authority_policy_version: string
  reservation: TrialReservationSnapshot
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  source: ReplayL2CompactedEpochSource
  batch: ReplayL2DepthReadBatch
}

export function issueReplayL2ExperimentAttachmentAuthority(
  db: Database,
  input: IssueReplayL2ExperimentAttachmentAuthorityInput,
): ReplayL2ExperimentAttachmentAuthoritySnapshot {
  assertTrialReservationSnapshot(input.reservation)
  assertReplayExecutionRequest(input.request)
  assertReplayDatasetManifest(input.dataset_manifest)
  assertReplayL2CompactedEpochSource(input.source)
  assertReplayL2DepthReadBatch(input.batch)
  const reservationHash = hashTrialReservationSnapshot(input.reservation)
  assertIssuedInsideReservation(input.issued_at, input.reservation)
  assertAuthoritativeReservedTrial(db, input.reservation)
  assertRequestReservationIdentity(input.request, input.reservation, reservationHash)
  assertDatasetIdentity(input.dataset_manifest, input.request)
  assertSourceBatchIdentity(input.source, input.batch, input.dataset_manifest)

  const source = input.source
  const batch = input.batch
  const manifest = input.dataset_manifest
  const authority = createReplayL2ExperimentAttachmentAuthoritySnapshot({
    schema_version: REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_SCHEMA_VERSION,
    authority_snapshot_id: input.authority_snapshot_id,
    authority_snapshot_ref: input.authority_snapshot_ref,
    status: "authorized",
    issued_at: input.issued_at,
    authority_id: input.authority_id,
    authority_policy_version: input.authority_policy_version,
    trial_id: input.reservation.identity.trial_id,
    run_id: input.reservation.run_id,
    reservation_ref: input.reservation.reservation_ref,
    reservation_hash: reservationHash,
    request_schema_version: input.request.schema_version,
    request_hash: canonicalHash(input.request),
    dataset_manifest_id: manifest.manifest_id,
    dataset_manifest_ref: manifest.manifest_ref,
    dataset_data_hash: manifest.data_hash,
    dataset_manifest_hash: canonicalHash(manifest),
    venue_id: source.venue_id,
    symbol: source.symbol,
    source_id: source.source_id,
    source_hash: source.source_hash,
    compaction_id: source.compaction_id,
    epoch_id: source.epoch_id,
    stream_epoch: source.stream_epoch,
    source_row_count: source.row_count,
    source_parquet_hash: source.parquet_hash,
    source_retention_class: source.retention_class,
    source_deletion_eligible: source.deletion_eligible,
    batch_id: batch.batch_id,
    batch_hash: batch.batch_hash,
    batch_rows_hash: batch.rows_hash,
    batch_offset: batch.offset,
    batch_row_count: batch.row_count,
    batch_next_offset: batch.next_offset,
    frame_start_inclusive: batch.offset + 1,
    frame_end_exclusive: batch.next_offset + 1,
    batch_exhausted: batch.exhausted,
    attachment_scope: "one_exact_validated_batch_within_one_compacted_epoch",
    gap_policy: batch.gap_policy,
    economic_authority: "none",
    runner_compatibility: "not_bound",
    external_completeness: "not_verified",
    limitations: [...REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS],
    limitations_hash: canonicalHash(REPLAY_L2_EXPERIMENT_ATTACHMENT_AUTHORITY_LIMITATIONS),
  })

  return db.transaction(() => {
    const existing = db.query(`
      SELECT authority_snapshot_hash, authority_json
      FROM rd_replay_l2_experiment_attachment_authority
      WHERE authority_snapshot_id = $authority_snapshot_id
        OR authority_snapshot_ref = $authority_snapshot_ref
        OR reservation_hash = $reservation_hash
        OR request_hash = $request_hash
        OR batch_hash = $batch_hash
    `).get({
      $authority_snapshot_id: authority.authority_snapshot_id,
      $authority_snapshot_ref: authority.authority_snapshot_ref,
      $reservation_hash: authority.reservation_hash,
      $request_hash: authority.request_hash,
      $batch_hash: authority.batch_hash,
    }) as AuthorityRow | null
    if (existing) {
      if (existing.authority_snapshot_hash !== authority.authority_snapshot_hash) {
        throw new Error("Replay L2 experiment attachment authority identity already exists with different content")
      }
      return parseAuthorityRow(existing)
    }
    db.query(`
      INSERT INTO rd_replay_l2_experiment_attachment_authority(
        authority_snapshot_id, authority_snapshot_ref, authority_snapshot_hash,
        status, issued_at, authority_id, authority_policy_version, trial_id, run_id,
        reservation_ref, reservation_hash, request_hash, dataset_manifest_id,
        dataset_manifest_ref, dataset_data_hash, dataset_manifest_hash, venue_id, symbol,
        source_id, source_hash, compaction_id, epoch_id, stream_epoch, source_row_count,
        source_parquet_hash, batch_id, batch_hash, batch_rows_hash, batch_offset,
        batch_row_count, batch_next_offset, frame_start_inclusive, frame_end_exclusive,
        batch_exhausted, attachment_scope, economic_authority, runner_compatibility,
        external_completeness, limitations_hash, authority_json
      ) VALUES (
        $authority_snapshot_id, $authority_snapshot_ref, $authority_snapshot_hash,
        $status, $issued_at, $authority_id, $authority_policy_version, $trial_id, $run_id,
        $reservation_ref, $reservation_hash, $request_hash, $dataset_manifest_id,
        $dataset_manifest_ref, $dataset_data_hash, $dataset_manifest_hash, $venue_id, $symbol,
        $source_id, $source_hash, $compaction_id, $epoch_id, $stream_epoch, $source_row_count,
        $source_parquet_hash, $batch_id, $batch_hash, $batch_rows_hash, $batch_offset,
        $batch_row_count, $batch_next_offset, $frame_start_inclusive, $frame_end_exclusive,
        $batch_exhausted, $attachment_scope, $economic_authority, $runner_compatibility,
        $external_completeness, $limitations_hash, $authority_json
      )
    `).run({
      $authority_snapshot_id: authority.authority_snapshot_id,
      $authority_snapshot_ref: authority.authority_snapshot_ref,
      $authority_snapshot_hash: authority.authority_snapshot_hash,
      $status: authority.status,
      $issued_at: authority.issued_at,
      $authority_id: authority.authority_id,
      $authority_policy_version: authority.authority_policy_version,
      $trial_id: authority.trial_id,
      $run_id: authority.run_id,
      $reservation_ref: authority.reservation_ref,
      $reservation_hash: authority.reservation_hash,
      $request_hash: authority.request_hash,
      $dataset_manifest_id: authority.dataset_manifest_id,
      $dataset_manifest_ref: authority.dataset_manifest_ref,
      $dataset_data_hash: authority.dataset_data_hash,
      $dataset_manifest_hash: authority.dataset_manifest_hash,
      $venue_id: authority.venue_id,
      $symbol: authority.symbol,
      $source_id: authority.source_id,
      $source_hash: authority.source_hash,
      $compaction_id: authority.compaction_id,
      $epoch_id: authority.epoch_id,
      $stream_epoch: authority.stream_epoch,
      $source_row_count: authority.source_row_count,
      $source_parquet_hash: authority.source_parquet_hash,
      $batch_id: authority.batch_id,
      $batch_hash: authority.batch_hash,
      $batch_rows_hash: authority.batch_rows_hash,
      $batch_offset: authority.batch_offset,
      $batch_row_count: authority.batch_row_count,
      $batch_next_offset: authority.batch_next_offset,
      $frame_start_inclusive: authority.frame_start_inclusive,
      $frame_end_exclusive: authority.frame_end_exclusive,
      $batch_exhausted: authority.batch_exhausted ? 1 : 0,
      $attachment_scope: authority.attachment_scope,
      $economic_authority: authority.economic_authority,
      $runner_compatibility: authority.runner_compatibility,
      $external_completeness: authority.external_completeness,
      $limitations_hash: authority.limitations_hash,
      $authority_json: JSON.stringify(authority),
    })
    return structuredClone(authority)
  }).immediate()
}

export function readReplayL2ExperimentAttachmentAuthority(
  db: Database,
  reservationHash: string,
): ReplayL2ExperimentAttachmentAuthoritySnapshot {
  const row = db.query(`
    SELECT authority_snapshot_hash, authority_json
    FROM rd_replay_l2_experiment_attachment_authority
    WHERE reservation_hash = $reservation_hash
  `).get({ $reservation_hash: reservationHash }) as AuthorityRow | null
  if (!row) throw new Error("Replay L2 experiment attachment authority is not registered")
  return parseAuthorityRow(row)
}

function assertIssuedInsideReservation(issuedAtText: string, reservation: TrialReservationSnapshot): void {
  const issuedAt = Date.parse(issuedAtText)
  if (!Number.isFinite(issuedAt) || issuedAt < Date.parse(reservation.issued_at)
      || issuedAt >= Date.parse(reservation.expires_at)) {
    throw new Error("Replay L2 attachment authority must fall inside the Trial Reservation window")
  }
}

function assertAuthoritativeReservedTrial(db: Database, reservation: TrialReservationSnapshot): void {
  const trial = db.query(`
    SELECT run_id, status FROM rd_trial WHERE trial_id = $trial_id
  `).get({ $trial_id: reservation.identity.trial_id }) as { run_id: string; status: string } | null
  if (!trial || trial.run_id !== reservation.run_id || trial.status !== "reserved") {
    throw new Error("Replay L2 attachment authority requires the authoritative reserved Trial")
  }
}

function assertRequestReservationIdentity(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  reservationHash: string,
): void {
  if (request.trial_reservation_ref !== reservation.reservation_ref
      || request.trial_reservation_hash !== reservationHash || request.run_id !== reservation.run_id) {
    throw new Error("Replay L2 attachment Request does not bind the Trial Reservation")
  }
  for (const field of [
    "experiment_id", "trial_group_id", "trial_group_hash", "trial_id", "candidate_id",
    "candidate_hash", "identity_hash_policy_version", "experiment_contract_hash",
  ] as const) {
    if (request[field] !== reservation.identity[field]) {
      throw new Error(`Replay L2 attachment Request identity mismatch: ${field}`)
    }
  }
  const bindings = reservation.bindings
  if (request.idempotency_key !== bindings.replay_idempotency_key
      || request.dataset_manifest_ref !== bindings.dataset_manifest_ref
      || request.dataset_hash !== bindings.dataset_hash
      || request.supplemental_facts_hash !== bindings.supplemental_facts_hash
      || request.supplemental_requirement_set_hash !== bindings.supplemental_requirement_set_hash
      || request.venue_risk_policy_schedule_hash !== bindings.venue_risk_policy_schedule_hash
      || request.instrument_spec_schedule_hash !== bindings.instrument_spec_schedule_hash
      || request.instrument_status_schedule_hash !== bindings.instrument_status_schedule_hash
      || request.instrument_status_provenance_hash !== bindings.instrument_status_provenance_hash
      || request.instrument_status_provider_capability_hash !== bindings.instrument_status_provider_capability_hash
      || request.instrument_status_provider_certification_hash !== bindings.instrument_status_provider_certification_hash
      || request.harness_hash !== bindings.harness_hash || request.assumptions_hash !== bindings.assumptions_hash
      || canonicalHash(request.cost_policy) !== bindings.cost_policy_hash
      || canonicalHash(request.margin_policy) !== bindings.margin_policy_hash
      || request.simulator_policy.version !== bindings.simulator_policy_version
      || bindings.execution_mode !== "step") {
    throw new Error("Replay L2 attachment Request bindings do not match the Trial Reservation")
  }
}

function assertDatasetIdentity(manifest: ReplayDatasetManifest, request: ReplayExecutionRequest): void {
  if (manifest.manifest_ref !== request.dataset_manifest_ref || manifest.data_hash !== request.dataset_hash
      || manifest.symbol !== request.symbol || manifest.timeframe !== request.timeframe) {
    throw new Error("Replay L2 attachment Dataset does not match the frozen Request")
  }
}

function assertSourceBatchIdentity(
  source: ReplayL2CompactedEpochSource,
  batch: ReplayL2DepthReadBatch,
  manifest: ReplayDatasetManifest,
): void {
  if (batch.row_count <= 0 || batch.source_id !== source.source_id || batch.source_hash !== source.source_hash
      || batch.compaction_id !== source.compaction_id || source.symbol !== manifest.symbol
      || batch.next_offset > source.row_count || batch.exhausted !== (batch.next_offset === source.row_count)) {
    throw new Error("Replay L2 attachment Source, Batch, and Dataset identities do not close")
  }
  const windowStart = Date.parse(manifest.first_open_time)
  const windowEnd = Date.parse(manifest.last_close_time)
  let previousFinalUpdateId = batch.predecessor_final_update_id
  batch.rows.forEach((row, index) => {
    if (row.symbol !== source.symbol || row.stream_epoch !== source.stream_epoch
        || row.frame_index !== batch.offset + index + 1
        || row.exchange_event_time_ms < windowStart || row.exchange_event_time_ms > windowEnd
        || (previousFinalUpdateId !== null && row.previous_final_update_id !== previousFinalUpdateId)) {
      throw new Error("Replay L2 attachment Batch escapes its epoch, frame, or Dataset window")
    }
    previousFinalUpdateId = row.final_update_id
  })
}

function parseAuthorityRow(row: AuthorityRow): ReplayL2ExperimentAttachmentAuthoritySnapshot {
  const authority = JSON.parse(row.authority_json) as ReplayL2ExperimentAttachmentAuthoritySnapshot
  assertReplayL2ExperimentAttachmentAuthoritySnapshot(authority)
  if (authority.authority_snapshot_hash !== row.authority_snapshot_hash) {
    throw new Error("Replay L2 experiment attachment authority registry row is inconsistent")
  }
  return authority
}
