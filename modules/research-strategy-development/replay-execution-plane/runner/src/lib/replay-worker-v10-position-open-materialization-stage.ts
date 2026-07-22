import { expect } from "bun:test"
import {
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  canonicalHash,
  createReplayDecisionStateSnapshot,
  type ReplayDecisionStateSnapshot,
  type ReplayExecutionRequest,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayPositionOpenStateInputMaterialization,
  type ReplayPositionOpenStateInputMaterialization,
} from "../../../contracts/src/lib/replay-position-open-state-input-materialization"
import type {
  ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplayPositionOpenStateInputMaterializationLineage,
  buildReplayPositionOpenStateInputMaterialization,
  type ReplayPositionOpenStateInputMaterializationInput,
} from "../../../engine/src/lib/replay-position-open-state-input-materialization"

export interface ReplayWorkerV10PositionOpenMaterializationStageInput {
  request: ReplayExecutionRequest
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
}

export interface ReplayWorkerV10PositionOpenMaterializationStageOutput {
  source_events: ReplaySourceEvent[]
  decision_state_snapshot: ReplayDecisionStateSnapshot
  materialization_input: ReplayPositionOpenStateInputMaterializationInput
  materialization: ReplayPositionOpenStateInputMaterialization
}

export function runReplayWorkerV10PositionOpenMaterializationStage(
  stageInput: ReplayWorkerV10PositionOpenMaterializationStageInput,
): ReplayWorkerV10PositionOpenMaterializationStageOutput {
  const requestValue = stageInput.request
  const binding = stageInput.harness_context_binding

  const sourceEvents: ReplaySourceEvent[] = [{
    source_event_id: "source:bar_range:1", kind: "bar_range", source_index: 0,
    event_key: {
      event_time: "2026-07-14T08:00:00Z", boundary_phase: 20,
      source_sequence: 1, event_subphase: 0, stable_event_id: "source:bar_range:1",
    },
  }, {
    source_event_id: "source:bar_range:2", kind: "bar_range", source_index: 1,
    event_key: {
      event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
      source_sequence: 2, event_subphase: 0, stable_event_id: "source:bar_range:2",
    },
  }]
  const snapshot = createReplayDecisionStateSnapshot({
    schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
    run_id: requestValue.run_id, decision_sequence: 2, decision_time: "2026-07-14T12:00:00Z",
    observation_event_key: structuredClone(sourceEvents[1]!.event_key),
    source_prefix_hash: canonicalHash(sourceEvents),
    position: { state: "open", side: "long", signed_quantity: 1, average_entry_price: 100 },
    active_protection: {
      stop: { order_id: "stop-1", status: "active", trigger_price: 95, remaining_quantity: 1 },
      target: { order_id: "target-1", status: "active", trigger_price: 110, remaining_quantity: 1 },
    },
    mark_price: 102, cash_balance: 999.9, total_fees: 0.1, total_funding: 0,
    unrealized_pnl: 2, equity: 1001.9,
  })
  const input = {
    request: requestValue,
    harness_context_binding: binding,
    decision_state_snapshot: snapshot,
    source_events: sourceEvents,
  }
  const materialization = buildReplayPositionOpenStateInputMaterialization(input)
  expect(materialization.owner).toBe("replay_engine_runtime")
  expect(materialization.economic_recomputation).toBe("not_performed")
  expect(materialization.source_event_count).toBe(2)
  expect(materialization.decision_state_snapshot_hash).toBe(snapshot.snapshot_hash)
  expect(materialization.worker_request_materialization).toBe("forbidden")
  expect(materialization.harness_invocation).toBe("forbidden")
  expect(() => assertReplayPositionOpenStateInputMaterialization(materialization)).not.toThrow()
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, input)).not.toThrow()
  expect(buildReplayPositionOpenStateInputMaterialization(structuredClone(input))).toEqual(materialization)
  return {
    source_events: sourceEvents,
    decision_state_snapshot: snapshot,
    materialization_input: input,
    materialization,
  }
}

