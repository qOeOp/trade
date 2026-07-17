import { expect, test } from "bun:test"
import {
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  canonicalHash,
  type ReplayDecisionSchedule,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventDecisionObservationBundle,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"
import {
  assertReplaySourceEventDecisionObservationBundleDerivationAttestation,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle-derivation"
import {
  assertReplaySourceEventDecisionScheduleObservationBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-schedule-observation-binding"
import {
  assertReplaySourceEventDecisionScheduleObservationBindingSet,
} from "../../../contracts/src/lib/replay-source-event-decision-schedule-observation-binding-set"
import { replaySourceEventWireTestFixture } from "../../../data-adapter/src/lib/replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "../../../data-adapter/src/lib/replay-source-event-wire-gate"
import { buildReplaySourceEventAvailabilityCursor } from "./replay-source-event-availability-cursor"
import { buildReplaySourceEventDecisionObservationProjection } from "./replay-source-event-decision-observation"
import {
  assertReplaySourceEventDecisionObservationBundleLineage,
  buildReplaySourceEventDecisionObservationBundle,
} from "./replay-source-event-decision-observation-bundle"
import {
  assertReplaySourceEventDecisionObservationBundleDerivationLineage,
  certifyReplaySourceEventDecisionObservationBundleDerivation,
} from "./replay-source-event-decision-observation-bundle-derivation"
import {
  assertReplaySourceEventDecisionScheduleObservationBindingLineage,
  buildReplaySourceEventDecisionScheduleObservationBinding,
  type ReplaySourceEventDecisionScheduleObservationBindingInput,
} from "./replay-source-event-decision-schedule-observation-binding"
import {
  assertReplaySourceEventDecisionScheduleObservationBindingSetLineage,
  buildReplaySourceEventDecisionScheduleObservationBindingSet,
} from "./replay-source-event-decision-schedule-observation-binding-set"
import { buildReplaySourceEventPitPayloadView } from "./replay-source-event-pit-payload-view"
import { buildReplaySourceEventVisibilityCut } from "./replay-source-event-visibility-cut"
import { reduceReplaySourceEventWireCandidateSchedule } from "./replay-source-event-wire-candidate-reducer"

function frozenSchedule(): ReplayDecisionSchedule {
  return {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [
      {
        decision_sequence: 1,
        decision_time: "2026-07-14T04:00:00Z",
        expected_effect: "no_action",
        authorized_entry_cancel: null,
        authorized_reduce_only_exit: null,
        authorized_protective_stop_replace: null,
        authorized_partial_reduce: null,
        authorized_order_hash: null,
      },
      {
        decision_sequence: 2,
        decision_time: "2026-07-14T04:08:00Z",
        expected_effect: "authorized_initial_order",
        authorized_entry_cancel: null,
        authorized_reduce_only_exit: null,
        authorized_protective_stop_replace: null,
        authorized_partial_reduce: null,
        authorized_order_hash: "a".repeat(64),
      },
    ],
  }
}

function bindingInput(
  selectedDecisionSequence: number,
  asOfTime: string,
  scheduleValue = frozenSchedule(),
  scheduleHash = canonicalHash(scheduleValue),
  exact = false,
): ReplaySourceEventDecisionScheduleObservationBindingInput {
  const fixture = replaySourceEventWireTestFixture({ exact })
  const preExecutionGate = evaluateReplaySourceEventWirePreExecutionGate({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    requested_capability: "non_economic_schedule_trace",
  })
  const candidateTrace = reduceReplaySourceEventWireCandidateSchedule({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: preExecutionGate,
  })
  const cursorInput = {
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: preExecutionGate,
    candidate_trace: candidateTrace,
  }
  const availabilityCursor = buildReplaySourceEventAvailabilityCursor(cursorInput)
  const cutInput = { ...cursorInput, availability_cursor: availabilityCursor, as_of_time: asOfTime }
  const visibilityCut = buildReplaySourceEventVisibilityCut(cutInput)
  const viewInput = { ...cutInput, visibility_cut: visibilityCut }
  const observationInput = {
    ...viewInput,
    pit_payload_view: buildReplaySourceEventPitPayloadView(viewInput),
  }
  return {
    ...observationInput,
    decision_schedule: scheduleValue,
    decision_schedule_hash: scheduleHash,
    selected_decision_sequence: selectedDecisionSequence,
    decision_observation_projection: buildReplaySourceEventDecisionObservationProjection(observationInput),
  }
}

function bindingSetInput() {
  const schedule = frozenSchedule()
  const scheduleHash = canonicalHash(schedule)
  return {
    decision_schedule: schedule,
    decision_schedule_hash: scheduleHash,
    binding_inputs: [
      bindingInput(1, "2026-07-14T04:00:00Z", schedule, scheduleHash),
      bindingInput(2, "2026-07-14T04:08:00Z", schedule, scheduleHash),
    ],
  }
}

test("decision schedule observation binding freezes one schedule time without invoking execution", () => {
  const input = bindingInput(1, "2026-07-14T04:00:00Z")
  const binding = buildReplaySourceEventDecisionScheduleObservationBinding(input)
  const replayed = buildReplaySourceEventDecisionScheduleObservationBinding(structuredClone(input))

  expect(() => assertReplaySourceEventDecisionScheduleObservationBinding(binding)).not.toThrow()
  expect(() => assertReplaySourceEventDecisionScheduleObservationBindingLineage(binding, input)).not.toThrow()
  expect(replayed.binding_hash).toBe(binding.binding_hash)
  expect(binding.selected_decision_time).toBe(binding.observation_as_of_time)
  expect(binding.selected_expected_effect).toBe("no_action")
  expect(binding.harness_invocation).toBe("forbidden")
  expect(binding.decision_authority).toBe("none")
  expect(binding.signal_authority).toBe("none")
  expect(binding.order_authority).toBe("none")
  expect(binding.economic_authority).toBe("none")
})

test("each frozen schedule entry binds to its own causal observation prefix", () => {
  const first = buildReplaySourceEventDecisionScheduleObservationBinding(
    bindingInput(1, "2026-07-14T04:00:00Z"),
  )
  const second = buildReplaySourceEventDecisionScheduleObservationBinding(
    bindingInput(2, "2026-07-14T04:08:00Z"),
  )

  expect(first.selected_schedule_entry_hash).not.toBe(second.selected_schedule_entry_hash)
  expect(first.observation_projection_hash).not.toBe(second.observation_projection_hash)
  expect(first.observation_count).toBe(3)
  expect(second.observation_count).toBeGreaterThan(first.observation_count)
  expect(second.selected_expected_effect).toBe("authorized_initial_order")
  expect(second.selected_effect_handling).toBe("opaque_frozen_label_not_executed")
  expect(second.schedule_validation).toBe("structural_hash_and_selected_entry_only")
})

test("decision schedule observation binding rejects time, frozen hash, field, and lineage drift", () => {
  expect(() => buildReplaySourceEventDecisionScheduleObservationBinding(
    bindingInput(1, "2026-07-14T04:00:00.500Z"),
  )).toThrow("does not match observation as-of time")

  const schedule = frozenSchedule()
  const frozenHash = canonicalHash(schedule)
  schedule.entries[1]!.decision_time = "2026-07-14T04:09:00Z"
  expect(() => buildReplaySourceEventDecisionScheduleObservationBinding(
    bindingInput(2, "2026-07-14T04:08:00Z", schedule, frozenHash),
  )).toThrow("reference hash mismatch")
  expect(() => buildReplaySourceEventDecisionScheduleObservationBinding(
    bindingInput(2, "2026-07-14T04:08:00Z", schedule, canonicalHash(schedule)),
  )).toThrow("does not match observation as-of time")

  const input = bindingInput(1, "2026-07-14T04:00:00Z")
  const binding = buildReplaySourceEventDecisionScheduleObservationBinding(input)
  const substituted = structuredClone(binding)
  substituted.selected_expected_effect = "authorized_reduce_only_exit"
  const {
    binding_hash: _substitutedHash,
    binding_id: _substitutedId,
    ...substitutedBodyWithoutId
  } = substituted
  substituted.binding_id = `source-event-decision-schedule-observation-${canonicalHash(substitutedBodyWithoutId).slice(0, 24)}`
  const { binding_hash: _rehash, ...substitutedBody } = substituted
  substituted.binding_hash = canonicalHash(substitutedBody)
  expect(() => assertReplaySourceEventDecisionScheduleObservationBinding(substituted)).not.toThrow()
  expect(() => assertReplaySourceEventDecisionScheduleObservationBindingLineage(substituted, input))
    .toThrow("lineage drift")

  const extended = structuredClone(binding) as typeof binding & { decision_output_hash?: string }
  extended.decision_output_hash = "b".repeat(64)
  const { binding_hash: _extendedHash, ...extendedBody } = extended
  extended.binding_hash = canonicalHash(extendedBody)
  expect(() => assertReplaySourceEventDecisionScheduleObservationBinding(extended))
    .toThrow("field whitelist")
})

test("binding set covers every frozen schedule entry exactly once without execution authority", () => {
  const schedule = frozenSchedule()
  const scheduleHash = canonicalHash(schedule)
  const input = {
    decision_schedule: schedule,
    decision_schedule_hash: scheduleHash,
    binding_inputs: [
      bindingInput(1, "2026-07-14T04:00:00Z", schedule, scheduleHash),
      bindingInput(2, "2026-07-14T04:08:00Z", schedule, scheduleHash),
    ],
  }
  const set = buildReplaySourceEventDecisionScheduleObservationBindingSet(input)
  const replayed = buildReplaySourceEventDecisionScheduleObservationBindingSet(structuredClone(input))

  expect(() => assertReplaySourceEventDecisionScheduleObservationBindingSet(set)).not.toThrow()
  expect(() => assertReplaySourceEventDecisionScheduleObservationBindingSetLineage(set, input)).not.toThrow()
  expect(replayed.binding_set_hash).toBe(set.binding_set_hash)
  expect(set.binding_count).toBe(schedule.entries.length)
  expect(set.bindings.map((item) => item.selected_decision_sequence)).toEqual([1, 2])
  expect(set.completeness_rule).toBe("exactly_one_binding_per_schedule_entry")
  expect(set.cross_schedule_binding_policy).toBe("forbidden")
  expect(set.harness_invocation).toBe("forbidden")
  expect(set.decision_authority).toBe("none")
  expect(set.order_authority).toBe("none")
})

test("binding set rejects omission, duplicate, reorder, and cross-schedule mixing", () => {
  const schedule = frozenSchedule()
  const scheduleHash = canonicalHash(schedule)
  const first = bindingInput(1, "2026-07-14T04:00:00Z", schedule, scheduleHash)
  const second = bindingInput(2, "2026-07-14T04:08:00Z", schedule, scheduleHash)
  const base = { decision_schedule: schedule, decision_schedule_hash: scheduleHash }

  expect(() => buildReplaySourceEventDecisionScheduleObservationBindingSet({
    ...base,
    binding_inputs: [first],
  })).toThrow("not closed-world complete")
  expect(() => buildReplaySourceEventDecisionScheduleObservationBindingSet({
    ...base,
    binding_inputs: [first, structuredClone(first)],
  })).toThrow("input order or schedule drift")
  expect(() => buildReplaySourceEventDecisionScheduleObservationBindingSet({
    ...base,
    binding_inputs: [second, first],
  })).toThrow("input order or schedule drift")

  const foreignSchedule = frozenSchedule()
  foreignSchedule.entries[1]!.authorized_order_hash = "c".repeat(64)
  const foreignHash = canonicalHash(foreignSchedule)
  const foreignSecond = bindingInput(
    2,
    "2026-07-14T04:08:00Z",
    foreignSchedule,
    foreignHash,
  )
  expect(() => buildReplaySourceEventDecisionScheduleObservationBindingSet({
    ...base,
    binding_inputs: [first, foreignSecond],
  })).toThrow("input order or schedule drift")

  const set = buildReplaySourceEventDecisionScheduleObservationBindingSet({
    ...base,
    binding_inputs: [first, second],
  })
  const duplicatedProjection = structuredClone(set)
  duplicatedProjection.bindings[1]!.observation_projection_hash
    = duplicatedProjection.bindings[0]!.observation_projection_hash
  rehashBinding(duplicatedProjection.bindings[1]!)
  rehashBindingSet(duplicatedProjection)
  expect(() => assertReplaySourceEventDecisionScheduleObservationBindingSet(duplicatedProjection))
    .toThrow("duplicate member")
})

test("decision observation bundle carries every schedule-bound Projection without authority escalation", () => {
  const setInput = bindingSetInput()
  const bindingSet = buildReplaySourceEventDecisionScheduleObservationBindingSet(setInput)
  const input = {
    ...setInput,
    decision_schedule_observation_binding_set: bindingSet,
  }
  const bundle = buildReplaySourceEventDecisionObservationBundle(input)
  const replayed = buildReplaySourceEventDecisionObservationBundle(structuredClone(input))

  expect(() => assertReplaySourceEventDecisionObservationBundle(bundle)).not.toThrow()
  expect(() => assertReplaySourceEventDecisionObservationBundleLineage(bundle, input)).not.toThrow()
  expect(replayed.bundle_hash).toBe(bundle.bundle_hash)
  expect(bundle.projection_count).toBe(bindingSet.binding_count)
  expect(bundle.projections.map((item) => item.as_of_time))
    .toEqual(bindingSet.bindings.map((item) => item.selected_decision_time))
  expect(bundle.projections[0]!.observations.map((item) => item.observation_type))
    .toEqual(["funding_settlement", "aggregate_trade", "bar_open"])
  expect(bundle.decision_input_compatibility).toBe("not_asserted")
  expect(bundle.harness_compatibility).toBe("not_bound")
  expect(bundle.artifact_compatibility).toBe("not_bound")
  expect(bundle.order_authority).toBe("none")
})

test("decision observation bundle rejects omission, reorder, substitution, and field injection", () => {
  const setInput = bindingSetInput()
  const bindingSet = buildReplaySourceEventDecisionScheduleObservationBindingSet(setInput)
  const input = {
    ...setInput,
    decision_schedule_observation_binding_set: bindingSet,
  }
  const bundle = buildReplaySourceEventDecisionObservationBundle(input)

  const omitted = structuredClone(bundle)
  omitted.projections.pop()
  omitted.projection_count = omitted.projections.length
  omitted.last_as_of_time = omitted.projections.at(-1)!.as_of_time
  rehashBundle(omitted)
  expect(() => assertReplaySourceEventDecisionObservationBundle(omitted))
    .toThrow("cardinality drift")

  const reordered = structuredClone(bundle)
  reordered.projections.reverse()
  reordered.first_as_of_time = reordered.projections[0]!.as_of_time
  reordered.last_as_of_time = reordered.projections.at(-1)!.as_of_time
  rehashBundle(reordered)
  expect(() => assertReplaySourceEventDecisionObservationBundle(reordered))
    .toThrow("projection binding drift")

  const substituted = structuredClone(bundle)
  const funding = substituted.projections[1]!.observations.find(
    (item) => item.observation_type === "funding_settlement",
  )!
  ;(funding.observation as { rate: number }).rate = 0.25
  funding.observation_hash = canonicalHash(funding.observation)
  rehashProjection(substituted.projections[1]!)
  rehashBundle(substituted)
  expect(() => assertReplaySourceEventDecisionObservationBundle(substituted))
    .toThrow("projection binding drift")

  const extended = structuredClone(bundle) as typeof bundle & { harness_context_hash?: string }
  extended.harness_context_hash = "d".repeat(64)
  const { bundle_hash: _extendedHash, ...extendedBody } = extended
  extended.bundle_hash = canonicalHash(extendedBody)
  expect(() => assertReplaySourceEventDecisionObservationBundle(extended))
    .toThrow("field whitelist")
})

test("decision observation derivation attestation certifies the complete common parent chain", () => {
  const setInput = bindingSetInput()
  const input = {
    ...setInput,
    decision_schedule_observation_binding_set:
      buildReplaySourceEventDecisionScheduleObservationBindingSet(setInput),
  }
  const bundle = buildReplaySourceEventDecisionObservationBundle(input)
  const attestation = certifyReplaySourceEventDecisionObservationBundleDerivation(bundle, input)
  const replayed = certifyReplaySourceEventDecisionObservationBundleDerivation(
    structuredClone(bundle),
    structuredClone(input),
  )

  expect(() => assertReplaySourceEventDecisionObservationBundleDerivationAttestation(attestation))
    .not.toThrow()
  expect(() => assertReplaySourceEventDecisionObservationBundleDerivationLineage(
    attestation,
    bundle,
    input,
  )).not.toThrow()
  expect(replayed.attestation_hash).toBe(attestation.attestation_hash)
  expect(attestation.boundary_count).toBe(input.decision_schedule.entries.length)
  expect(attestation.certification_result).toBe("certified_against_supplied_parent_chain")
  expect(attestation.common_parent_rule).toBe("one_wire_gate_trace_cursor_for_all_boundaries")
  expect(attestation.control_plane_admission_compatibility).toBe("not_bound")
  expect(attestation.harness_invocation).toBe("forbidden")
  expect(attestation.economic_authority).toBe("none")
})

test("decision observation derivation rejects mixed roots, parent substitution, and authority injection", () => {
  const schedule = frozenSchedule()
  const scheduleHash = canonicalHash(schedule)
  const mixedSetInput = {
    decision_schedule: schedule,
    decision_schedule_hash: scheduleHash,
    binding_inputs: [
      bindingInput(1, "2026-07-14T04:00:00Z", schedule, scheduleHash),
      bindingInput(2, "2026-07-14T04:08:00Z", schedule, scheduleHash, true),
    ],
  }
  const mixedInput = {
    ...mixedSetInput,
    decision_schedule_observation_binding_set:
      buildReplaySourceEventDecisionScheduleObservationBindingSet(mixedSetInput),
  }
  const mixedBundle = buildReplaySourceEventDecisionObservationBundle(mixedInput)
  expect(() => certifyReplaySourceEventDecisionObservationBundleDerivation(mixedBundle, mixedInput))
    .toThrow("mixes parent chains")

  const setInput = bindingSetInput()
  const input = {
    ...setInput,
    decision_schedule_observation_binding_set:
      buildReplaySourceEventDecisionScheduleObservationBindingSet(setInput),
  }
  const bundle = buildReplaySourceEventDecisionObservationBundle(input)
  const attestation = certifyReplaySourceEventDecisionObservationBundleDerivation(bundle, input)
  const substitutedInput = structuredClone(input)
  substitutedInput.binding_inputs[1]!.pit_payload_view
    = substitutedInput.binding_inputs[0]!.pit_payload_view
  expect(() => assertReplaySourceEventDecisionObservationBundleDerivationLineage(
    attestation,
    bundle,
    substitutedInput,
  )).toThrow()

  const extended = structuredClone(attestation) as typeof attestation & { runner_admission?: string }
  extended.runner_admission = "allowed"
  const { attestation_hash: _oldHash, ...body } = extended
  extended.attestation_hash = canonicalHash(body)
  expect(() => assertReplaySourceEventDecisionObservationBundleDerivationAttestation(extended))
    .toThrow("field whitelist")
})

function rehashBinding(
  binding: ReturnType<typeof buildReplaySourceEventDecisionScheduleObservationBinding>,
): void {
  const { binding_hash: _oldHash, binding_id: _oldId, ...bodyWithoutId } = binding
  binding.binding_id
    = `source-event-decision-schedule-observation-${canonicalHash(bodyWithoutId).slice(0, 24)}`
  const { binding_hash: _rehash, ...body } = binding
  binding.binding_hash = canonicalHash(body)
}

function rehashBindingSet(
  set: ReturnType<typeof buildReplaySourceEventDecisionScheduleObservationBindingSet>,
): void {
  set.bindings_hash = canonicalHash(set.bindings)
  set.binding_hashes_hash = canonicalHash(set.bindings.map((item) => item.binding_hash))
  set.observation_projection_hashes_hash = canonicalHash(
    set.bindings.map((item) => item.observation_projection_hash),
  )
  const { binding_set_hash: _oldHash, binding_set_id: _oldId, ...bodyWithoutId } = set
  set.binding_set_id
    = `source-event-decision-schedule-observation-set-${canonicalHash(bodyWithoutId).slice(0, 24)}`
  const { binding_set_hash: _rehash, ...body } = set
  set.binding_set_hash = canonicalHash(body)
}

function rehashProjection(
  projection: ReturnType<typeof buildReplaySourceEventDecisionObservationProjection>,
): void {
  projection.observations_hash = canonicalHash(projection.observations)
  projection.observation_values_hash = canonicalHash(
    projection.observations.map((item) => item.observation),
  )
  const { projection_hash: _oldHash, ...body } = projection
  projection.projection_hash = canonicalHash(body)
}

function rehashBundle(
  bundle: ReturnType<typeof buildReplaySourceEventDecisionObservationBundle>,
): void {
  bundle.projections_hash = canonicalHash(bundle.projections)
  bundle.projection_ids_hash = canonicalHash(bundle.projections.map((item) => item.projection_id))
  bundle.projection_hashes_hash = canonicalHash(
    bundle.projections.map((item) => item.projection_hash),
  )
  bundle.observation_values_hashes_hash = canonicalHash(
    bundle.projections.map((item) => item.observation_values_hash),
  )
  const { bundle_hash: _oldHash, bundle_id: _oldId, ...bodyWithoutId } = bundle
  bundle.bundle_id
    = `source-event-decision-observation-bundle-${canonicalHash(bodyWithoutId).slice(0, 24)}`
  const { bundle_hash: _rehash, ...body } = bundle
  bundle.bundle_hash = canonicalHash(body)
}
