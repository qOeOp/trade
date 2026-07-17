import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayCrossSourceOrderingAttestation,
  type ReplayCrossSourceKind,
  type ReplayCrossSourceOrderingAttestation,
} from "../../../contracts/src/lib/replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_CANDIDATE_REDUCER_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_EVENT_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_SCHEMA_VERSION,
  assertReplaySourceEventCandidateTrace,
  assertReplaySourceEventWireGateLineage,
  createReplaySourceEventCandidateTrace,
  replaySourceEventCandidateSourceCounts,
  type ReplaySourceEventCandidateTrace,
  type ReplaySourceEventCandidateTraceEvent,
  type ReplaySourceEventWirePreExecutionGate,
} from "../../../contracts/src/lib/replay-source-event-wire-gate"
import {
  assertReplaySourceEventWireManifest,
  type ReplaySourceEventWireManifest,
} from "../../../contracts/src/lib/replay-source-event-wire"

export interface ReplaySourceEventWireCandidateReducerInput {
  wire_manifest: ReplaySourceEventWireManifest
  ordering_attestation: ReplayCrossSourceOrderingAttestation
  pre_execution_gate: ReplaySourceEventWirePreExecutionGate
}

export function reduceReplaySourceEventWireCandidateSchedule(
  input: ReplaySourceEventWireCandidateReducerInput,
): ReplaySourceEventCandidateTrace {
  assertReplaySourceEventWireGateLineage(
    input.pre_execution_gate,
    input.wire_manifest,
    input.ordering_attestation,
  )
  if (input.pre_execution_gate.requested_capability !== "non_economic_schedule_trace"
      || input.pre_execution_gate.decision !== "admitted_candidate_trace") {
    throw new Error("SourceEvent candidate reducer requires an admitted non-economic schedule gate")
  }
  const ambiguityByEventId = ambiguityGroupByStableEventId(input.ordering_attestation)
  const traceEvents: ReplaySourceEventCandidateTraceEvent[] = input.wire_manifest.wire_events.map((event, index) => {
    const ambiguityGroupHash = ambiguityByEventId.get(event.native_event_id) ?? null
    return {
      schema_version: REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_EVENT_SCHEMA_VERSION,
      trace_event_id: `source-event-candidate-trace-${event.wire_event_id}`,
      event_ordinal: index,
      wire_event_id: event.wire_event_id,
      source_kind: event.source_kind,
      kind: event.kind,
      effective_time: event.effective_time,
      availability_at: event.availability_at,
      payload_hash: event.payload_hash,
      ordering_key: structuredClone(event.ordering_key),
      ordering_evidence: ambiguityGroupHash
        ? "deterministic_tie_break_only"
        : "declared_timestamp_unique",
      ambiguity_group_hash: ambiguityGroupHash,
      execution_effect: "none",
    }
  })
  const lastBySource = lastWireEventIdBySource(input.wire_manifest)
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_SCHEMA_VERSION,
    reducer_policy_version: REPLAY_SOURCE_EVENT_CANDIDATE_REDUCER_POLICY_VERSION,
    scope: "pre_integration_non_economic_schedule_trace" as const,
    economic_authority: "none" as const,
    execution_effects: "forbidden" as const,
    runner_compatibility: "not_bound" as const,
    wire_manifest_id: input.wire_manifest.wire_manifest_id,
    wire_manifest_hash: input.wire_manifest.manifest_hash,
    gate_id: input.pre_execution_gate.gate_id,
    gate_hash: input.pre_execution_gate.gate_hash,
    ordering_attestation_id: input.ordering_attestation.attestation_id,
    ordering_attestation_hash: input.ordering_attestation.attestation_hash,
    ordering_resolution: input.ordering_attestation.ordering_resolution,
    ambiguity_group_count: input.ordering_attestation.ambiguity_groups.length,
    ambiguity_groups_hash: canonicalHash(input.ordering_attestation.ambiguity_groups),
    trace_events: traceEvents,
    trace_events_hash: canonicalHash(traceEvents),
    source_observation_counts: replaySourceEventCandidateSourceCounts(traceEvents),
    last_wire_event_id_by_source: lastBySource,
  }
  const body = {
    ...bodyWithoutId,
    trace_id: `source-event-candidate-trace-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventCandidateTrace(body)
  assertReplaySourceEventWireCandidateReducerLineage(value, input)
  return value
}

export function assertReplaySourceEventWireCandidateReducerLineage(
  trace: ReplaySourceEventCandidateTrace,
  input: ReplaySourceEventWireCandidateReducerInput,
): void {
  assertReplaySourceEventCandidateTrace(trace)
  assertReplaySourceEventWireManifest(input.wire_manifest)
  assertReplayCrossSourceOrderingAttestation(input.ordering_attestation)
  assertReplaySourceEventWireGateLineage(
    input.pre_execution_gate,
    input.wire_manifest,
    input.ordering_attestation,
  )
  if (trace.wire_manifest_id !== input.wire_manifest.wire_manifest_id
      || trace.wire_manifest_hash !== input.wire_manifest.manifest_hash
      || trace.gate_id !== input.pre_execution_gate.gate_id
      || trace.gate_hash !== input.pre_execution_gate.gate_hash
      || trace.ordering_attestation_id !== input.ordering_attestation.attestation_id
      || trace.ordering_attestation_hash !== input.ordering_attestation.attestation_hash
      || trace.ambiguity_groups_hash !== canonicalHash(input.ordering_attestation.ambiguity_groups)
      || trace.trace_events.length !== input.wire_manifest.wire_events.length) {
    throw new Error("SourceEvent candidate reducer authority lineage drift")
  }
  const ambiguityByEventId = ambiguityGroupByStableEventId(input.ordering_attestation)
  for (const [index, event] of input.wire_manifest.wire_events.entries()) {
    const traceEvent = trace.trace_events[index]
    if (!traceEvent
        || traceEvent.wire_event_id !== event.wire_event_id
        || traceEvent.payload_hash !== event.payload_hash
        || canonicalHash(traceEvent.ordering_key) !== canonicalHash(event.ordering_key)
        || traceEvent.ambiguity_group_hash !== (ambiguityByEventId.get(event.native_event_id) ?? null)) {
      throw new Error("SourceEvent candidate reducer event lineage drift")
    }
  }
}

function ambiguityGroupByStableEventId(
  attestation: ReplayCrossSourceOrderingAttestation,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const group of attestation.ambiguity_groups) {
    const groupHash = canonicalHash(group)
    for (const id of group.stable_event_ids) {
      if (result.has(id)) throw new Error("SourceEvent ambiguity event cannot belong to multiple groups")
      result.set(id, groupHash)
    }
  }
  return result
}

function lastWireEventIdBySource(
  wire: ReplaySourceEventWireManifest,
): Record<ReplayCrossSourceKind, string> {
  const result: Record<ReplayCrossSourceKind, string> = {
    instrument_status: "",
    funding: "",
    aggregate_trade: "",
    ohlcv: "",
  }
  for (const event of wire.wire_events) result[event.source_kind] = event.wire_event_id
  return result
}
