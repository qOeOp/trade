import assert from "node:assert/strict"
import test from "node:test"
import {
  buildWatchTaskDefinition,
  evaluateWatchTask,
  WATCH_TASK_OBSERVATION_SCHEMA,
  type WatchTaskObservation,
} from "./watch-task-contract"

const definition = buildWatchTaskDefinition({
  task_id: "watch-1",
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

test("watch task compiles one closed predicate and rejects semantic widening", () => {
  assert.match(definition.definition_hash, /^[a-f0-9]{64}$/)
  assert.throws(() => buildWatchTaskDefinition({
    ...definition,
    trigger: { ...definition.trigger, kind: "moving_average_cross" as "mark_price_in_range" },
  }), /trigger kind/)
  assert.throws(() => buildWatchTaskDefinition({
    ...definition,
    invalidation: { ...definition.invalidation, price: 100 },
  }), /below trigger/)
  assert.throws(() => buildWatchTaskDefinition({
    ...definition,
    lifetime: { ...definition.lifetime, deadline: "2026-07-24T00:00:01.001Z" },
  }), /24 hours/)
})

test("watch task waits, triggers typed revalidation, and checks invalidation first", () => {
  assert.equal(evaluateWatchTask({
    definition,
    observation: observation(110, "obs-wait"),
    now: "2026-07-23T00:00:02.000Z",
    observation_count: 0,
    error_count: 0,
  }).outcome, "wait")
  const triggered = evaluateWatchTask({
    definition,
    observation: observation(100, "obs-trigger"),
    now: "2026-07-23T00:00:02.000Z",
    observation_count: 1,
    error_count: 0,
  })
  assert.equal(triggered.outcome, "triggered")
  assert.equal(triggered.handoff?.execution_authority, "none")
  assert.equal(triggered.handoff?.intent_content_hash, definition.intent_content_hash)
  assert.deepEqual(evaluateWatchTask({
    definition,
    observation: observation(94, "obs-invalid"),
    now: "2026-07-23T00:00:02.000Z",
    observation_count: 2,
    error_count: 0,
  }).outcome, "blocked")
})

test("watch task expires and exhausts stale/error budgets without a handoff", () => {
  const expired = evaluateWatchTask({
    definition,
    now: definition.lifetime.deadline,
    observation_count: 0,
    error_count: 0,
  })
  assert.equal(expired.outcome, "expired")
  assert.equal(expired.handoff, undefined)

  const stale = { ...observation(100, "obs-stale"), source_observed_at: "2026-07-23T00:00:00.000Z" }
  const first = evaluateWatchTask({
    definition,
    observation: stale,
    now: "2026-07-23T00:00:03.000Z",
    observation_count: 0,
    error_count: 0,
  })
  assert.equal(first.outcome, "wait")
  const second = evaluateWatchTask({
    definition,
    observation: stale,
    now: "2026-07-23T00:00:03.000Z",
    observation_count: first.next_observation_count,
    error_count: first.next_error_count,
  })
  assert.equal(second.outcome, "blocked")
  assert.equal(second.reason, "error_budget_exhausted")
})

function observation(markPrice: number, ref: string): WatchTaskObservation {
  return {
    schema_version: WATCH_TASK_OBSERVATION_SCHEMA,
    observation_ref: ref,
    symbol: "BTCUSDT",
    observed_at: "2026-07-23T00:00:02.000Z",
    source_observed_at: "2026-07-23T00:00:01.500Z",
    mark_price: markPrice,
    continuity: "continuous",
  }
}
