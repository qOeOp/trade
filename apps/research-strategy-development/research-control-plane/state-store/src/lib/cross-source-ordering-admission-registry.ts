import type { Database } from "bun:sqlite"
import { canonicalHash } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  assertReplayCrossSourceOrderingAttestation,
  type ReplayCrossSourceKind,
  type ReplayCrossSourceOrderingAttestation,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-cross-source-ordering"
import {
  assertReplayCrossSourceOrderingAdmissionSnapshot,
  assertTrialReservationSnapshot,
  createReplayCrossSourceOrderingAdmissionSnapshot,
  hashTrialReservationSnapshot,
  type ReplayCrossSourceOrderingAdmissionSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  assertReplayAggregateTradeProviderCertificationAdmittedAt,
  readReplayAggregateTradeEvidenceAdmission,
} from "./aggregate-trade-provider-certification-registry"

interface AdmissionRow {
  admission_hash: string
  admission_json: string
}

export interface IssueReplayCrossSourceOrderingAdmissionInput {
  admission_id: string
  admission_ref: string
  issued_at: string
  authority_id: string
  admission_policy_version: string
  reservation: TrialReservationSnapshot
  aggregate_trade_evidence_admission_ref: string
  aggregate_trade_evidence_admission_hash: string
  aggregate_trade_coverage_events_hash: string
  ordering_attestation: ReplayCrossSourceOrderingAttestation
}

export function issueReplayCrossSourceOrderingAdmission(
  db: Database,
  input: IssueReplayCrossSourceOrderingAdmissionInput,
): ReplayCrossSourceOrderingAdmissionSnapshot {
  assertTrialReservationSnapshot(input.reservation)
  assertReplayCrossSourceOrderingAttestation(input.ordering_attestation)
  const reservationHash = hashTrialReservationSnapshot(input.reservation)
  const issuedAt = Date.parse(input.issued_at)
  if (!Number.isFinite(issuedAt)
      || issuedAt < Date.parse(input.reservation.issued_at)
      || issuedAt >= Date.parse(input.reservation.expires_at)) {
    throw new Error("cross-source ordering admission must fall inside the Trial Reservation window")
  }
  const aggregateAdmission = readReplayAggregateTradeEvidenceAdmission(db, reservationHash)
  if (aggregateAdmission.admission_ref !== input.aggregate_trade_evidence_admission_ref
      || aggregateAdmission.admission_hash !== input.aggregate_trade_evidence_admission_hash) {
    throw new Error("cross-source ordering admission does not bind the registered aggregate trade evidence admission")
  }
  if (issuedAt < Date.parse(aggregateAdmission.issued_at)) {
    throw new Error("cross-source ordering admission cannot predate aggregate trade evidence admission")
  }
  assertReplayAggregateTradeProviderCertificationAdmittedAt(
    db,
    aggregateAdmission.provider_certification_hash,
    input.issued_at,
  )
  const trial = db.query(`
    SELECT trial_id, run_id, status FROM rd_trial WHERE trial_id = $trial_id
  `).get({ $trial_id: input.reservation.identity.trial_id }) as {
    trial_id: string
    run_id: string
    status: string
  } | null
  if (!trial || trial.run_id !== input.reservation.run_id || trial.status !== "reserved") {
    throw new Error("cross-source ordering admission requires the authoritative reserved Trial")
  }
  const attestation = input.ordering_attestation
  if (attestation.window_start_inclusive !== aggregateAdmission.coverage_start
      || attestation.window_end_exclusive !== aggregateAdmission.coverage_end) {
    throw new Error("cross-source ordering window must equal the admitted aggregate trade coverage window")
  }
  const expectedSources: ReplayCrossSourceKind[] = ["instrument_status", "funding", "aggregate_trade", "ohlcv"]
  const actualSources = attestation.source_collections.map((collection) => collection.source_kind)
  if (canonicalHash(actualSources) !== canonicalHash(expectedSources)) {
    throw new Error("cross-source ordering admission requires Instrument Status, Funding, Aggregate Trade, and OHLCV")
  }
  const collectionHash = (sourceKind: ReplayCrossSourceKind): string => {
    const collection = attestation.source_collections.find((candidate) => candidate.source_kind === sourceKind)
    if (!collection) throw new Error(`cross-source ordering attestation lacks ${sourceKind}`)
    return collection.content_hash
  }
  const aggregateTradeEventsHash = collectionHash("aggregate_trade")
  if (aggregateTradeEventsHash !== input.aggregate_trade_coverage_events_hash) {
    throw new Error("cross-source aggregate trade collection does not match the admitted coverage events hash")
  }
  const bindings = input.reservation.bindings
  const admission = createReplayCrossSourceOrderingAdmissionSnapshot({
    schema_version: "trade.rd-replay-cross-source-ordering-admission.v1",
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
    aggregate_trade_evidence_admission_ref: aggregateAdmission.admission_ref,
    aggregate_trade_evidence_admission_hash: aggregateAdmission.admission_hash,
    aggregate_trade_coverage_attestation_hash: aggregateAdmission.coverage_attestation_hash,
    ordering_attestation_id: attestation.attestation_id,
    ordering_attestation_hash: attestation.attestation_hash,
    ordering_attestation_schema_version: attestation.schema_version,
    event_key_policy_version: attestation.key_policy_version,
    symbol: attestation.symbol,
    timeframe: attestation.timeframe,
    window_start_inclusive: attestation.window_start_inclusive,
    window_end_exclusive: attestation.window_end_exclusive,
    dataset_manifest_ref: bindings.dataset_manifest_ref,
    dataset_hash: bindings.dataset_hash,
    instrument_status_schedule_hash: bindings.instrument_status_schedule_hash,
    instrument_status_provenance_hash: bindings.instrument_status_provenance_hash,
    source_kinds: expectedSources as ["instrument_status", "funding", "aggregate_trade", "ohlcv"],
    instrument_status_events_hash: collectionHash("instrument_status"),
    funding_events_hash: collectionHash("funding"),
    aggregate_trade_events_hash: aggregateTradeEventsHash,
    ohlcv_bars_hash: collectionHash("ohlcv"),
    source_collections_hash: canonicalHash(attestation.source_collections),
    ordered_events_hash: attestation.ordered_events_hash,
    ambiguity_groups_hash: canonicalHash(attestation.ambiguity_groups),
    ambiguity_group_count: attestation.ambiguity_groups.length,
    ordering_resolution: attestation.ordering_resolution,
    limitations: [...attestation.limitations],
    limitations_hash: canonicalHash(attestation.limitations),
    external_completeness: "not_verified",
    scope: "pre_integration_cross_source_ordering_only",
    economic_authority: "none",
  })
  return db.transaction(() => {
    const existing = db.query(`
      SELECT admission_hash, admission_json
      FROM rd_replay_cross_source_ordering_admission
      WHERE admission_id = $admission_id
        OR admission_ref = $admission_ref
        OR reservation_hash = $reservation_hash
        OR aggregate_trade_evidence_admission_hash = $aggregate_trade_evidence_admission_hash
    `).get({
      $admission_id: admission.admission_id,
      $admission_ref: admission.admission_ref,
      $reservation_hash: admission.reservation_hash,
      $aggregate_trade_evidence_admission_hash: admission.aggregate_trade_evidence_admission_hash,
    }) as AdmissionRow | null
    if (existing) {
      if (existing.admission_hash !== admission.admission_hash) {
        throw new Error("Replay cross-source ordering admission identity already exists with different content")
      }
      return parseAdmissionRow(existing)
    }
    db.query(`
      INSERT INTO rd_replay_cross_source_ordering_admission(
        admission_id, admission_ref, admission_hash, status, issued_at,
        authority_id, admission_policy_version, trial_id, run_id,
        reservation_ref, reservation_hash, aggregate_trade_evidence_admission_ref,
        aggregate_trade_evidence_admission_hash, aggregate_trade_coverage_attestation_hash,
        ordering_attestation_id, ordering_attestation_hash, ordering_resolution,
        ambiguity_group_count, dataset_manifest_ref, dataset_hash,
        instrument_status_schedule_hash, instrument_status_provenance_hash,
        instrument_status_events_hash, funding_events_hash, aggregate_trade_events_hash,
        ohlcv_bars_hash, source_collections_hash, ordered_events_hash,
        ambiguity_groups_hash, limitations_hash, external_completeness,
        scope, economic_authority, admission_json
      ) VALUES (
        $admission_id, $admission_ref, $admission_hash, $status, $issued_at,
        $authority_id, $admission_policy_version, $trial_id, $run_id,
        $reservation_ref, $reservation_hash, $aggregate_trade_evidence_admission_ref,
        $aggregate_trade_evidence_admission_hash, $aggregate_trade_coverage_attestation_hash,
        $ordering_attestation_id, $ordering_attestation_hash, $ordering_resolution,
        $ambiguity_group_count, $dataset_manifest_ref, $dataset_hash,
        $instrument_status_schedule_hash, $instrument_status_provenance_hash,
        $instrument_status_events_hash, $funding_events_hash, $aggregate_trade_events_hash,
        $ohlcv_bars_hash, $source_collections_hash, $ordered_events_hash,
        $ambiguity_groups_hash, $limitations_hash, $external_completeness,
        $scope, $economic_authority, $admission_json
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
      $aggregate_trade_evidence_admission_ref: admission.aggregate_trade_evidence_admission_ref,
      $aggregate_trade_evidence_admission_hash: admission.aggregate_trade_evidence_admission_hash,
      $aggregate_trade_coverage_attestation_hash: admission.aggregate_trade_coverage_attestation_hash,
      $ordering_attestation_id: admission.ordering_attestation_id,
      $ordering_attestation_hash: admission.ordering_attestation_hash,
      $ordering_resolution: admission.ordering_resolution,
      $ambiguity_group_count: admission.ambiguity_group_count,
      $dataset_manifest_ref: admission.dataset_manifest_ref,
      $dataset_hash: admission.dataset_hash,
      $instrument_status_schedule_hash: admission.instrument_status_schedule_hash,
      $instrument_status_provenance_hash: admission.instrument_status_provenance_hash,
      $instrument_status_events_hash: admission.instrument_status_events_hash,
      $funding_events_hash: admission.funding_events_hash,
      $aggregate_trade_events_hash: admission.aggregate_trade_events_hash,
      $ohlcv_bars_hash: admission.ohlcv_bars_hash,
      $source_collections_hash: admission.source_collections_hash,
      $ordered_events_hash: admission.ordered_events_hash,
      $ambiguity_groups_hash: admission.ambiguity_groups_hash,
      $limitations_hash: admission.limitations_hash,
      $external_completeness: admission.external_completeness,
      $scope: admission.scope,
      $economic_authority: admission.economic_authority,
      $admission_json: JSON.stringify(admission),
    })
    return structuredClone(admission)
  }).immediate()
}

export function readReplayCrossSourceOrderingAdmission(
  db: Database,
  reservationHash: string,
): ReplayCrossSourceOrderingAdmissionSnapshot {
  const row = db.query(`
    SELECT admission_hash, admission_json
    FROM rd_replay_cross_source_ordering_admission
    WHERE reservation_hash = $reservation_hash
  `).get({ $reservation_hash: reservationHash }) as AdmissionRow | null
  if (!row) throw new Error("Replay cross-source ordering admission is not registered")
  return parseAdmissionRow(row)
}

function parseAdmissionRow(row: AdmissionRow): ReplayCrossSourceOrderingAdmissionSnapshot {
  const admission = JSON.parse(row.admission_json) as ReplayCrossSourceOrderingAdmissionSnapshot
  assertReplayCrossSourceOrderingAdmissionSnapshot(admission)
  if (admission.admission_hash !== row.admission_hash) {
    throw new Error("Replay cross-source ordering admission registry row is inconsistent")
  }
  return admission
}
