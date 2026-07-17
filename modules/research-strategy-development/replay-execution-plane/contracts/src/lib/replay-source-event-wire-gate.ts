import { canonicalHash } from "./replay-contracts"
import {
  REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION,
  REPLAY_CROSS_SOURCE_RANK_BY_SOURCE,
  assertReplayCrossSourceEventKey,
  assertReplayCrossSourceOrderingAttestation,
  compareReplayCrossSourceEventKeys,
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
  type ReplayCrossSourceEventKey,
  type ReplayCrossSourceKind,
  type ReplayCrossSourceOrderingAttestation,
} from "./replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
  assertReplaySourceEventWireManifest,
  type ReplaySourceEventWireKind,
  type ReplaySourceEventWireManifest,
} from "./replay-source-event-wire"

export const REPLAY_SOURCE_EVENT_WIRE_GATE_SCHEMA_VERSION = "trade.rd-replay-source-event-wire-pre-execution-gate.v1" as const
export const REPLAY_SOURCE_EVENT_WIRE_GATE_POLICY_VERSION = "rd-replay-source-event-wire-pre-execution-gate-v1" as const
export const REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_SCHEMA_VERSION = "trade.rd-replay-source-event-candidate-trace.v1" as const
export const REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_EVENT_SCHEMA_VERSION = "trade.rd-replay-source-event-candidate-trace-event.v1" as const
export const REPLAY_SOURCE_EVENT_CANDIDATE_REDUCER_POLICY_VERSION = "rd-replay-source-event-candidate-reducer-v1" as const

export type ReplaySourceEventWireRequestedCapability =
  | "non_economic_schedule_trace"
  | "economic_exact_trigger"

export type ReplaySourceEventWireGateDecision =
  | "admitted_candidate_trace"
  | "rejected_resolution_limited"
  | "rejected_economic_consumer_not_certified"

export interface ReplaySourceEventWirePreExecutionGate {
  schema_version: typeof REPLAY_SOURCE_EVENT_WIRE_GATE_SCHEMA_VERSION
  gate_id: string
  gate_policy_version: typeof REPLAY_SOURCE_EVENT_WIRE_GATE_POLICY_VERSION
  wire_policy_version: typeof REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION
  event_key_policy_version: typeof REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION
  scope: "pre_integration_wire_gate_only"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  requested_capability: ReplaySourceEventWireRequestedCapability
  decision: ReplaySourceEventWireGateDecision
  reason:
    | "non_economic_trace_preserves_ordering_limitations"
    | "cross_source_ordering_is_resolution_limited"
    | "economic_wire_consumer_is_not_certified"
  wire_manifest_id: string
  wire_manifest_hash: string
  ordering_attestation_id: string
  ordering_attestation_hash: string
  ordering_resolution: ReplayCrossSourceOrderingAttestation["ordering_resolution"]
  ambiguity_group_count: number
  ambiguity_groups_hash: string
  ordering_limitations_hash: string
  gate_hash: string
}

export type ReplaySourceEventWirePreExecutionGateBody = Omit<ReplaySourceEventWirePreExecutionGate, "gate_hash">

export interface ReplaySourceEventCandidateTraceEvent {
  schema_version: typeof REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_EVENT_SCHEMA_VERSION
  trace_event_id: string
  event_ordinal: number
  wire_event_id: string
  source_kind: ReplayCrossSourceKind
  kind: ReplaySourceEventWireKind
  effective_time: string
  availability_at: string
  payload_hash: string
  ordering_key: ReplayCrossSourceEventKey
  ordering_evidence: "declared_timestamp_unique" | "deterministic_tie_break_only"
  ambiguity_group_hash: string | null
  execution_effect: "none"
}

export interface ReplaySourceEventCandidateTrace {
  schema_version: typeof REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_SCHEMA_VERSION
  trace_id: string
  reducer_policy_version: typeof REPLAY_SOURCE_EVENT_CANDIDATE_REDUCER_POLICY_VERSION
  scope: "pre_integration_non_economic_schedule_trace"
  economic_authority: "none"
  execution_effects: "forbidden"
  runner_compatibility: "not_bound"
  wire_manifest_id: string
  wire_manifest_hash: string
  gate_id: string
  gate_hash: string
  ordering_attestation_id: string
  ordering_attestation_hash: string
  ordering_resolution: ReplayCrossSourceOrderingAttestation["ordering_resolution"]
  ambiguity_group_count: number
  ambiguity_groups_hash: string
  trace_events: ReplaySourceEventCandidateTraceEvent[]
  trace_events_hash: string
  source_observation_counts: Record<ReplayCrossSourceKind, number>
  last_wire_event_id_by_source: Record<ReplayCrossSourceKind, string>
  trace_hash: string
}

export type ReplaySourceEventCandidateTraceBody = Omit<ReplaySourceEventCandidateTrace, "trace_hash">

export function replaySourceEventWireGateDecision(input: {
  requested_capability: ReplaySourceEventWireRequestedCapability
  ordering_resolution: ReplayCrossSourceOrderingAttestation["ordering_resolution"]
}): Pick<ReplaySourceEventWirePreExecutionGate, "decision" | "reason"> {
  if (input.requested_capability === "non_economic_schedule_trace") {
    return {
      decision: "admitted_candidate_trace",
      reason: "non_economic_trace_preserves_ordering_limitations",
    }
  }
  return input.ordering_resolution === "resolution_limited"
    ? {
        decision: "rejected_resolution_limited",
        reason: "cross_source_ordering_is_resolution_limited",
      }
    : {
        decision: "rejected_economic_consumer_not_certified",
        reason: "economic_wire_consumer_is_not_certified",
      }
}

export function createReplaySourceEventWirePreExecutionGate(
  body: ReplaySourceEventWirePreExecutionGateBody,
): ReplaySourceEventWirePreExecutionGate {
  const value: ReplaySourceEventWirePreExecutionGate = {
    ...structuredClone(body),
    gate_hash: canonicalHash(body),
  }
  assertReplaySourceEventWirePreExecutionGate(value)
  return value
}

export function createReplaySourceEventCandidateTrace(
  body: ReplaySourceEventCandidateTraceBody,
): ReplaySourceEventCandidateTrace {
  const value: ReplaySourceEventCandidateTrace = {
    ...structuredClone(body),
    trace_hash: canonicalHash(body),
  }
  assertReplaySourceEventCandidateTrace(value)
  return value
}

export function assertReplaySourceEventWirePreExecutionGate(
  value: ReplaySourceEventWirePreExecutionGate,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_WIRE_GATE_SCHEMA_VERSION
      || value.gate_policy_version !== REPLAY_SOURCE_EVENT_WIRE_GATE_POLICY_VERSION
      || value.wire_policy_version !== REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION
      || value.event_key_policy_version !== REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION
      || value.scope !== "pre_integration_wire_gate_only"
      || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound") {
    throw new Error("unsupported SourceEvent Wire pre-execution gate authority")
  }
  requireText(value.gate_id, "SourceEvent Wire gate id")
  requireText(value.wire_manifest_id, "SourceEvent Wire gate manifest id")
  requireText(value.ordering_attestation_id, "SourceEvent Wire gate ordering attestation id")
  for (const [field, item] of Object.entries({
    wire_manifest_hash: value.wire_manifest_hash,
    ordering_attestation_hash: value.ordering_attestation_hash,
    ambiguity_groups_hash: value.ambiguity_groups_hash,
    ordering_limitations_hash: value.ordering_limitations_hash,
    gate_hash: value.gate_hash,
  })) requireHash(item, `SourceEvent Wire gate ${field}`)
  if (!Number.isSafeInteger(value.ambiguity_group_count) || value.ambiguity_group_count < 0
      || (value.ordering_resolution === "resolution_limited" && value.ambiguity_group_count === 0)
      || (value.ordering_resolution === "exact_by_declared_timestamps" && value.ambiguity_group_count !== 0)) {
    throw new Error("SourceEvent Wire gate ambiguity claim is inconsistent")
  }
  const expected = replaySourceEventWireGateDecision(value)
  if (value.decision !== expected.decision || value.reason !== expected.reason) {
    throw new Error("SourceEvent Wire gate decision overclaims admitted capability")
  }
  const { gate_hash: gateHash, ...body } = value
  if (gateHash !== canonicalHash(body)) throw new Error("SourceEvent Wire gate hash mismatch")
}

export function assertReplaySourceEventCandidateTrace(value: ReplaySourceEventCandidateTrace): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_SCHEMA_VERSION
      || value.reducer_policy_version !== REPLAY_SOURCE_EVENT_CANDIDATE_REDUCER_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_schedule_trace"
      || value.economic_authority !== "none"
      || value.execution_effects !== "forbidden"
      || value.runner_compatibility !== "not_bound") {
    throw new Error("unsupported SourceEvent candidate trace authority")
  }
  for (const item of [value.trace_id, value.wire_manifest_id, value.gate_id, value.ordering_attestation_id]) {
    requireText(item, "SourceEvent candidate trace identity")
  }
  for (const [field, item] of Object.entries({
    wire_manifest_hash: value.wire_manifest_hash,
    gate_hash: value.gate_hash,
    ordering_attestation_hash: value.ordering_attestation_hash,
    ambiguity_groups_hash: value.ambiguity_groups_hash,
    trace_events_hash: value.trace_events_hash,
    trace_hash: value.trace_hash,
  })) requireHash(item, `SourceEvent candidate trace ${field}`)
  if (value.trace_events.length === 0) throw new Error("SourceEvent candidate trace requires events")
  let previousKey: ReplayCrossSourceEventKey | null = null
  const counts = emptySourceCounts()
  const lastIds = emptyLastSourceIds()
  const ambiguityHashes = new Set<string>()
  for (const [index, event] of value.trace_events.entries()) {
    assertReplaySourceEventCandidateTraceEvent(event)
    if (event.event_ordinal !== index) throw new Error("SourceEvent candidate trace ordinal drift")
    if (previousKey && compareReplayCrossSourceEventKeys(previousKey, event.ordering_key) >= 0) {
      throw new Error("SourceEvent candidate trace ordering drift")
    }
    previousKey = event.ordering_key
    counts[event.source_kind] += 1
    lastIds[event.source_kind] = event.wire_event_id
    if (event.ambiguity_group_hash) ambiguityHashes.add(event.ambiguity_group_hash)
  }
  if (canonicalHash(counts) !== canonicalHash(value.source_observation_counts)
      || canonicalHash(lastIds) !== canonicalHash(value.last_wire_event_id_by_source)) {
    throw new Error("SourceEvent candidate trace fold summary drift")
  }
  for (const source of Object.keys(counts) as ReplayCrossSourceKind[]) {
    if (counts[source] <= 0) throw new Error("SourceEvent candidate trace must cover every Wire source")
    requireText(lastIds[source], "SourceEvent candidate trace last Wire event id")
  }
  if (!Number.isSafeInteger(value.ambiguity_group_count) || value.ambiguity_group_count < 0
      || ambiguityHashes.size !== value.ambiguity_group_count
      || (value.ordering_resolution === "resolution_limited" && ambiguityHashes.size === 0)
      || (value.ordering_resolution === "exact_by_declared_timestamps" && ambiguityHashes.size !== 0)) {
    throw new Error("SourceEvent candidate trace ambiguity coverage drift")
  }
  if (value.trace_events_hash !== canonicalHash(value.trace_events)) {
    throw new Error("SourceEvent candidate trace events hash mismatch")
  }
  const { trace_hash: traceHash, ...body } = value
  if (traceHash !== canonicalHash(body)) throw new Error("SourceEvent candidate trace hash mismatch")
}

export function assertReplaySourceEventCandidateTraceEvent(value: ReplaySourceEventCandidateTraceEvent): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_CANDIDATE_TRACE_EVENT_SCHEMA_VERSION
      || value.execution_effect !== "none") {
    throw new Error("unsupported SourceEvent candidate trace event effect")
  }
  requireText(value.trace_event_id, "SourceEvent candidate trace event id")
  requireText(value.wire_event_id, "SourceEvent candidate trace wire event id")
  requireHash(value.payload_hash, "SourceEvent candidate trace payload hash")
  requireUtc(value.effective_time, "SourceEvent candidate trace effective time")
  requireUtc(value.availability_at, "SourceEvent candidate trace availability time")
  if (Date.parse(value.availability_at) < Date.parse(value.effective_time)) {
    throw new Error("SourceEvent candidate trace event cannot be available before effective time")
  }
  if (!Number.isSafeInteger(value.event_ordinal) || value.event_ordinal < 0) {
    throw new Error("SourceEvent candidate trace event ordinal is invalid")
  }
  assertReplayCrossSourceEventKey(value.ordering_key)
  if (value.ordering_key.event_time !== value.effective_time
      || value.ordering_key.source_rank !== REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[value.source_kind]) {
    throw new Error("SourceEvent candidate trace EventKey lineage drift")
  }
  if (value.trace_event_id !== `source-event-candidate-trace-${value.wire_event_id}`) {
    throw new Error("SourceEvent candidate trace event id does not bind the Wire event")
  }
  const ambiguous = value.ambiguity_group_hash !== null
  if (ambiguous) requireHash(value.ambiguity_group_hash!, "SourceEvent candidate trace ambiguity group hash")
  if (ambiguous !== (value.ordering_evidence === "deterministic_tie_break_only")) {
    throw new Error("SourceEvent candidate trace ordering evidence overclaim")
  }
}

export function assertReplaySourceEventWireGateLineage(
  gate: ReplaySourceEventWirePreExecutionGate,
  wire: ReplaySourceEventWireManifest,
  attestation: ReplayCrossSourceOrderingAttestation,
): void {
  assertReplaySourceEventWirePreExecutionGate(gate)
  assertReplaySourceEventWireManifest(wire)
  assertReplayCrossSourceOrderingAttestation(attestation)
  if (wire.ordering_attestation_id !== attestation.attestation_id
      || wire.ordering_attestation_hash !== attestation.attestation_hash
      || wire.ordered_source_envelopes_hash !== attestation.ordered_events_hash
      || gate.wire_manifest_id !== wire.wire_manifest_id
      || gate.wire_manifest_hash !== wire.manifest_hash
      || gate.ordering_attestation_id !== attestation.attestation_id
      || gate.ordering_attestation_hash !== attestation.attestation_hash
      || gate.ordering_resolution !== attestation.ordering_resolution
      || gate.ambiguity_group_count !== attestation.ambiguity_groups.length
      || gate.ambiguity_groups_hash !== canonicalHash(attestation.ambiguity_groups)
      || gate.ordering_limitations_hash !== canonicalHash(attestation.limitations)) {
    throw new Error("SourceEvent Wire gate lineage drift")
  }
}

export function replaySourceEventCandidateSourceCounts(
  events: Array<{ source_kind: ReplayCrossSourceKind }>,
): Record<ReplayCrossSourceKind, number> {
  const counts = emptySourceCounts()
  for (const event of events) counts[event.source_kind] += 1
  return counts
}

function emptySourceCounts(): Record<ReplayCrossSourceKind, number> {
  return { instrument_status: 0, funding: 0, aggregate_trade: 0, ohlcv: 0 }
}

function emptyLastSourceIds(): Record<ReplayCrossSourceKind, string> {
  return { instrument_status: "", funding: "", aggregate_trade: "", ohlcv: "" }
}
