import {
  assertReplayCrossSourceOrderingAdmissionSnapshot,
  type ReplayCrossSourceOrderingAdmissionSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayCrossSourceOrderingAttestation,
  type ReplayCrossSourceEventEnvelope,
  type ReplayCrossSourceOrderingAttestation,
} from "../../../contracts/src/lib/replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_PROJECTION_LIMITATIONS,
  REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_PROJECTION_SCHEMA_VERSION,
  assertReplaySourceEventProjectionAttestation,
  createReplaySourceEventProjectionAttestation,
  replayProjectedSourceEventKind,
  type ReplaySourceEventProjection,
  type ReplaySourceEventProjectionAttestation,
} from "../../../contracts/src/lib/replay-source-event-projection"

export interface ReplaySourceEventProjectionInput {
  ordering_admission: ReplayCrossSourceOrderingAdmissionSnapshot
  ordering_attestation: ReplayCrossSourceOrderingAttestation
}

export function buildReplaySourceEventProjectionAttestation(
  input: ReplaySourceEventProjectionInput,
): ReplaySourceEventProjectionAttestation {
  assertReplayCrossSourceOrderingAdmissionSnapshot(input.ordering_admission)
  assertReplayCrossSourceOrderingAttestation(input.ordering_attestation)
  assertOrderingAdmissionAttestationBinding(input.ordering_admission, input.ordering_attestation)

  const projectedEvents = input.ordering_attestation.ordered_events.map(projectSourceEvent)
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION,
    projection_policy_version: REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION,
    scope: "pre_integration_source_event_projection_only" as const,
    economic_authority: "none" as const,
    production_source_event_compatibility: "not_asserted" as const,
    payload_materialization: "hash_only" as const,
    trial_id: input.ordering_admission.trial_id,
    run_id: input.ordering_admission.run_id,
    reservation_ref: input.ordering_admission.reservation_ref,
    reservation_hash: input.ordering_admission.reservation_hash,
    dataset_manifest_ref: input.ordering_admission.dataset_manifest_ref,
    dataset_hash: input.ordering_admission.dataset_hash,
    ordering_admission_ref: input.ordering_admission.admission_ref,
    ordering_admission_hash: input.ordering_admission.admission_hash,
    ordering_attestation_id: input.ordering_attestation.attestation_id,
    ordering_attestation_hash: input.ordering_attestation.attestation_hash,
    event_key_policy_version: input.ordering_attestation.key_policy_version,
    symbol: input.ordering_attestation.symbol,
    timeframe: input.ordering_attestation.timeframe,
    window_start_inclusive: input.ordering_attestation.window_start_inclusive,
    window_end_exclusive: input.ordering_attestation.window_end_exclusive,
    source_kinds: structuredClone(input.ordering_admission.source_kinds),
    ordering_resolution: input.ordering_attestation.ordering_resolution,
    ordered_events_hash: input.ordering_attestation.ordered_events_hash,
    ambiguity_groups_hash: canonicalHash(input.ordering_attestation.ambiguity_groups),
    ambiguity_group_count: input.ordering_attestation.ambiguity_groups.length,
    ordering_limitations_hash: canonicalHash(input.ordering_attestation.limitations),
    projected_events: projectedEvents,
    projected_events_hash: canonicalHash(projectedEvents),
    projection_limitations: [...REPLAY_SOURCE_EVENT_PROJECTION_LIMITATIONS],
    projection_limitations_hash: canonicalHash(REPLAY_SOURCE_EVENT_PROJECTION_LIMITATIONS),
  }
  const body = {
    ...bodyWithoutId,
    projection_id: `source-event-projection-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventProjectionAttestation(body)
  assertReplaySourceEventProjectionLineage(value, input.ordering_admission, input.ordering_attestation)
  return value
}

export function assertReplaySourceEventProjectionLineage(
  projection: ReplaySourceEventProjectionAttestation,
  admission: ReplayCrossSourceOrderingAdmissionSnapshot,
  attestation: ReplayCrossSourceOrderingAttestation,
): void {
  assertReplaySourceEventProjectionAttestation(projection)
  assertReplayCrossSourceOrderingAdmissionSnapshot(admission)
  assertReplayCrossSourceOrderingAttestation(attestation)
  assertOrderingAdmissionAttestationBinding(admission, attestation)
  if (projection.trial_id !== admission.trial_id
      || projection.run_id !== admission.run_id
      || projection.reservation_ref !== admission.reservation_ref
      || projection.reservation_hash !== admission.reservation_hash
      || projection.dataset_manifest_ref !== admission.dataset_manifest_ref
      || projection.dataset_hash !== admission.dataset_hash
      || projection.ordering_admission_ref !== admission.admission_ref
      || projection.ordering_admission_hash !== admission.admission_hash
      || projection.ordering_attestation_id !== attestation.attestation_id
      || projection.ordering_attestation_hash !== attestation.attestation_hash
      || projection.event_key_policy_version !== attestation.key_policy_version
      || projection.symbol !== attestation.symbol
      || projection.timeframe !== attestation.timeframe
      || projection.window_start_inclusive !== attestation.window_start_inclusive
      || projection.window_end_exclusive !== attestation.window_end_exclusive
      || projection.ordering_resolution !== attestation.ordering_resolution
      || projection.ordered_events_hash !== attestation.ordered_events_hash
      || projection.ambiguity_groups_hash !== canonicalHash(attestation.ambiguity_groups)
      || projection.ambiguity_group_count !== attestation.ambiguity_groups.length
      || projection.ordering_limitations_hash !== canonicalHash(attestation.limitations)) {
    throw new Error("SourceEvent projection authority or ordering lineage drift")
  }
  if (projection.projected_events.length !== attestation.ordered_events.length) {
    throw new Error("SourceEvent projection must preserve one event per ordered envelope")
  }
  for (const [index, envelope] of attestation.ordered_events.entries()) {
    if (canonicalHash(projection.projected_events[index]) !== canonicalHash(projectSourceEvent(envelope))) {
      throw new Error("SourceEvent projection does not losslessly preserve its source envelope")
    }
  }
}

function assertOrderingAdmissionAttestationBinding(
  admission: ReplayCrossSourceOrderingAdmissionSnapshot,
  attestation: ReplayCrossSourceOrderingAttestation,
): void {
  const collectionHash = (source: ReplayCrossSourceOrderingAdmissionSnapshot["source_kinds"][number]): string => {
    const value = attestation.source_collections.find((collection) => collection.source_kind === source)
    if (!value) throw new Error(`ordering attestation lacks admitted ${source} collection`)
    return value.content_hash
  }
  if (admission.ordering_attestation_id !== attestation.attestation_id
      || admission.ordering_attestation_hash !== attestation.attestation_hash
      || admission.ordering_attestation_schema_version !== attestation.schema_version
      || admission.event_key_policy_version !== attestation.key_policy_version
      || admission.symbol !== attestation.symbol
      || admission.timeframe !== attestation.timeframe
      || admission.window_start_inclusive !== attestation.window_start_inclusive
      || admission.window_end_exclusive !== attestation.window_end_exclusive
      || canonicalHash(admission.source_kinds) !== canonicalHash(attestation.source_collections.map((item) => item.source_kind))
      || admission.instrument_status_events_hash !== collectionHash("instrument_status")
      || admission.funding_events_hash !== collectionHash("funding")
      || admission.aggregate_trade_events_hash !== collectionHash("aggregate_trade")
      || admission.ohlcv_bars_hash !== collectionHash("ohlcv")
      || admission.source_collections_hash !== canonicalHash(attestation.source_collections)
      || admission.ordered_events_hash !== attestation.ordered_events_hash
      || admission.ambiguity_groups_hash !== canonicalHash(attestation.ambiguity_groups)
      || admission.ambiguity_group_count !== attestation.ambiguity_groups.length
      || admission.ordering_resolution !== attestation.ordering_resolution
      || admission.limitations_hash !== canonicalHash(attestation.limitations)
      || canonicalHash(admission.limitations) !== canonicalHash(attestation.limitations)) {
    throw new Error("ordering admission does not bind the supplied ordering attestation")
  }
}

function projectSourceEvent(envelope: ReplayCrossSourceEventEnvelope): ReplaySourceEventProjection {
  const sourceEnvelopeHash = canonicalHash(envelope)
  return {
    schema_version: REPLAY_SOURCE_EVENT_PROJECTION_SCHEMA_VERSION,
    projection_event_id: `projected-source-event-${sourceEnvelopeHash.slice(0, 24)}`,
    source_kind: envelope.source_kind,
    projected_kind: replayProjectedSourceEventKind(envelope.event_kind),
    symbol: envelope.symbol,
    source_index: envelope.event_key.source_sequence,
    effective_time: envelope.effective_time,
    availability_at: envelope.availability_at,
    native_event_id: envelope.native_event_id,
    payload_hash: envelope.payload_hash,
    source_envelope_hash: sourceEnvelopeHash,
    ordering_key: structuredClone(envelope.event_key),
    execution_disposition: "non_economic_projection_only",
  }
}
