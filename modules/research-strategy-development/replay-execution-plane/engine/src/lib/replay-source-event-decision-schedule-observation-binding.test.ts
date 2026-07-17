import { expect, test } from "bun:test"
import {
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  canonicalHash,
  type ReplayDecisionSchedule,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventDecisionScheduleObservationBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-schedule-observation-binding"
import { replaySourceEventWireTestFixture } from "../../../data-adapter/src/lib/replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "../../../data-adapter/src/lib/replay-source-event-wire-gate"
import { buildReplaySourceEventAvailabilityCursor } from "./replay-source-event-availability-cursor"
import { buildReplaySourceEventDecisionObservationProjection } from "./replay-source-event-decision-observation"
import {
  assertReplaySourceEventDecisionScheduleObservationBindingLineage,
  buildReplaySourceEventDecisionScheduleObservationBinding,
  type ReplaySourceEventDecisionScheduleObservationBindingInput,
} from "./replay-source-event-decision-schedule-observation-binding"
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
): ReplaySourceEventDecisionScheduleObservationBindingInput {
  const fixture = replaySourceEventWireTestFixture()
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
