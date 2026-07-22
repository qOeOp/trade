import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildWatchTaskDefinition,
  evaluateWatchTask,
  WATCH_TASK_OBSERVATION_SCHEMA,
} from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import { ensureOpsRuntimeSchema } from "./ops-runtime-store"
import {
  applyWatchTaskEvaluation,
  armWatchTask,
  cancelWatchTask,
  completeWatchTask,
  createWatchTask,
  handoffWatchTask,
  readWatchTask,
  readWatchTaskTransitions,
} from "./watch-task-store"

const definition = buildWatchTaskDefinition({
  task_id: "watch-store-1",
  plan_ref: "plan://1",
  flow_id: "flow-1",
  intent_ref: "intent://1",
  intent_content_hash: "sha256:intent-1",
  symbol: "BTCUSDT",
  side: "long",
  source_refs: ["market://btc"],
  trigger: { kind: "mark_price_in_range", low: 99, high: 101 },
  invalidation: { kind: "mark_price_at_or_beyond", operator: "lte", price: 95 },
  lifetime: {
    created_at: "2026-07-23T00:00:00.000Z",
    not_before: "2026-07-23T00:00:01.000Z",
    deadline: "2026-07-23T01:00:00.000Z",
  },
  budget: { poll_interval_ms: 1_000, max_observations: 10, max_errors: 1, max_fact_age_ms: 2_000 },
  idempotency_key: "watch:flow-1:intent-1",
})

test("watch task store persists monotonic trigger, handoff, and completion audit", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    const created = createWatchTask(db, definition)
    assert.equal(created.status, "created")
    assert.deepEqual(createWatchTask(db, definition), created)
    const armed = armWatchTask(db, {
      task_id: definition.task_id,
      definition_hash: definition.definition_hash,
      expected_version: created.version,
      now: "2026-07-23T00:00:00.500Z",
    })
    const evaluation = evaluateWatchTask({
      definition,
      observation: {
        schema_version: WATCH_TASK_OBSERVATION_SCHEMA,
        observation_ref: "market://observation/1",
        symbol: "BTCUSDT",
        observed_at: "2026-07-23T00:00:02.000Z",
        source_observed_at: "2026-07-23T00:00:01.500Z",
        mark_price: 100,
        continuity: "continuous",
      },
      now: "2026-07-23T00:00:02.000Z",
      observation_count: armed.observation_count,
      error_count: armed.error_count,
    })
    const triggered = applyWatchTaskEvaluation(db, {
      task_id: definition.task_id,
      expected_version: armed.version,
      evaluation,
    })
    assert.equal(triggered.status, "triggered")
    assert.equal(triggered.handoff?.execution_authority, "none")
    assert.throws(() => applyWatchTaskEvaluation(db, {
      task_id: definition.task_id,
      expected_version: armed.version,
      evaluation,
    }), /version conflict/)
    const handedOff = handoffWatchTask(db, {
      task_id: definition.task_id,
      expected_version: triggered.version,
      handoff_receipt_ref: "preflight://intake/1",
      now: "2026-07-23T00:00:02.100Z",
    })
    assert.equal(handedOff.handoff_receipt_ref, "preflight://intake/1")
    const completed = completeWatchTask(db, {
      task_id: definition.task_id,
      expected_version: handedOff.version,
      downstream_result_ref: "preflight://result/1",
      now: "2026-07-23T00:00:02.200Z",
    })
    assert.equal(completed.status, "completed")
    assert.equal(completed.downstream_result_ref, "preflight://result/1")
    assert.deepEqual(readWatchTaskTransitions(db, definition.task_id).map((item) => item.to_status), [
      "created", "armed", "triggered", "handed_off", "completed",
    ])
  } finally {
    db.close()
  }
})

test("watch task store restores active state and terminal states reject resurrection", () => {
  const db = new Database(":memory:")
  ensureOpsRuntimeSchema(db)
  try {
    const alternate = buildWatchTaskDefinition({
      ...definition,
      task_id: "watch-store-2",
      idempotency_key: "watch:flow-1:intent-2",
    })
    const created = createWatchTask(db, alternate)
    assert.equal(readWatchTask(db, alternate.task_id)?.definition.definition_hash, alternate.definition_hash)
    const cancelled = cancelWatchTask(db, {
      task_id: alternate.task_id,
      expected_version: created.version,
      reason: "plan_replaced",
      now: "2026-07-23T00:00:00.500Z",
    })
    assert.equal(cancelled.status, "cancelled")
    assert.throws(() => armWatchTask(db, {
      task_id: alternate.task_id,
      definition_hash: alternate.definition_hash,
      expected_version: cancelled.version,
      now: "2026-07-23T00:00:00.600Z",
    }), /cannot arm/)
  } finally {
    db.close()
  }
})
