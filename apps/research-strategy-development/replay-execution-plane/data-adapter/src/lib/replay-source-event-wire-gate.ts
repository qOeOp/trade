import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayCrossSourceOrderingAttestation,
  type ReplayCrossSourceOrderingAttestation,
} from "../../../contracts/src/lib/replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_WIRE_GATE_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_WIRE_GATE_SCHEMA_VERSION,
  createReplaySourceEventWirePreExecutionGate,
  replaySourceEventWireGateDecision,
  assertReplaySourceEventWireGateLineage,
  type ReplaySourceEventWirePreExecutionGate,
  type ReplaySourceEventWireRequestedCapability,
} from "../../../contracts/src/lib/replay-source-event-wire-gate"
import {
  REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
  assertReplaySourceEventWireManifest,
  type ReplaySourceEventWireManifest,
} from "../../../contracts/src/lib/replay-source-event-wire"

export function evaluateReplaySourceEventWirePreExecutionGate(input: {
  wire_manifest: ReplaySourceEventWireManifest
  ordering_attestation: ReplayCrossSourceOrderingAttestation
  requested_capability: ReplaySourceEventWireRequestedCapability
}): ReplaySourceEventWirePreExecutionGate {
  assertReplaySourceEventWireManifest(input.wire_manifest)
  assertReplayCrossSourceOrderingAttestation(input.ordering_attestation)
  const outcome = replaySourceEventWireGateDecision({
    requested_capability: input.requested_capability,
    ordering_resolution: input.ordering_attestation.ordering_resolution,
  })
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_WIRE_GATE_SCHEMA_VERSION,
    gate_policy_version: REPLAY_SOURCE_EVENT_WIRE_GATE_POLICY_VERSION,
    wire_policy_version: REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
    event_key_policy_version: input.ordering_attestation.key_policy_version,
    scope: "pre_integration_wire_gate_only" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    requested_capability: input.requested_capability,
    ...outcome,
    wire_manifest_id: input.wire_manifest.wire_manifest_id,
    wire_manifest_hash: input.wire_manifest.manifest_hash,
    ordering_attestation_id: input.ordering_attestation.attestation_id,
    ordering_attestation_hash: input.ordering_attestation.attestation_hash,
    ordering_resolution: input.ordering_attestation.ordering_resolution,
    ambiguity_group_count: input.ordering_attestation.ambiguity_groups.length,
    ambiguity_groups_hash: canonicalHash(input.ordering_attestation.ambiguity_groups),
    ordering_limitations_hash: canonicalHash(input.ordering_attestation.limitations),
  }
  const body = {
    ...bodyWithoutId,
    gate_id: `source-event-wire-gate-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventWirePreExecutionGate(body)
  assertReplaySourceEventWireGateLineage(value, input.wire_manifest, input.ordering_attestation)
  return value
}
