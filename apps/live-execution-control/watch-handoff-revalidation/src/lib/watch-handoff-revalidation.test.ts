import assert from "node:assert/strict"
import test from "node:test"
import { buildWatchTaskDefinition } from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import { revalidateWatchHandoff, type RevalidationDependencies } from "./watch-handoff-revalidation"

const definition = buildWatchTaskDefinition({
  task_id: "watch-revalidation-1",
  plan_ref: "plan://1",
  flow_id: "flow-1",
  intent_ref: "intent://1",
  intent_content_hash: "sha256:plan-1",
  symbol: "BTCUSDT",
  side: "long",
  source_refs: ["plan://1", "snapshot://1"],
  trigger: { kind: "mark_price_in_range", low: 99, high: 101 },
  invalidation: { kind: "mark_price_at_or_beyond", operator: "lte", price: 95 },
  lifetime: {
    created_at: "2026-07-23T00:00:00.000Z",
    not_before: "2026-07-23T00:00:01.000Z",
    deadline: "2026-07-23T00:30:00.000Z",
  },
  budget: { poll_interval_ms: 1_000, max_observations: 20, max_errors: 3, max_fact_age_ms: 2_000 },
  idempotency_key: "watch:flow-1:intent-1",
})

const input = {
  definition,
  handoff: {
    handoff_kind: "action_intent_revalidation",
    intent_ref: "intent://1",
    intent_content_hash: "sha256:plan-1",
    flow_id: "flow-1",
    idempotency_key: "watch:flow-1:intent-1",
    observation_ref: "snapshot://trigger",
    execution_authority: "none",
  },
  current_observation: {
    schema_version: "trade.watch-task-observation.v1",
    observation_ref: "snapshot://current",
    symbol: "BTCUSDT",
    observed_at: "2026-07-23T00:10:00.000Z",
    source_observed_at: "2026-07-23T00:10:00.000Z",
    mark_price: 100,
    continuity: "point_in_time",
  },
  preflight: {
    plan: {
      schema_version: "trade-plan-draft.v1",
      plan_ref: "plan://1",
      content_hash: "sha256:plan-1",
      symbol: "BTCUSDT",
      side: "long",
    },
    observe: {},
  },
  now: "2026-07-23T00:10:01.000Z",
}

const passing: RevalidationDependencies = {
  executionGate: () => ({ status: "ready" }),
  preflight: () => ({ verdict: "armable", blocked_by: [], warnings: [], decision_card: "armable" }),
}

test("passing revalidation remains a no-authority receipt", () => {
  const result = revalidateWatchHandoff(input, passing)
  assert.equal(result.status, "revalidation_passed")
  assert.equal(result.execution_authority, "none")
  assert.equal(result.next_step, "requires_separate_execution_authorization")
  assert.match(result.receipt_ref, /^watch-revalidation:/)
})

test("invalidation, deadline, and identity drift fail closed before preflight", () => {
  let preflightCalls = 0
  const dependencies: RevalidationDependencies = {
    executionGate: () => ({ status: "ready" }),
    preflight: () => {
      preflightCalls += 1
      return { verdict: "armable", blocked_by: [], warnings: [], decision_card: "armable" }
    },
  }
  const invalidated = revalidateWatchHandoff({
    ...input,
    current_observation: { ...input.current_observation, mark_price: 94 },
  }, dependencies)
  assert.equal(invalidated.status, "blocked")
  assert.equal(invalidated.reason, "invalidation_hit")
  const expired = revalidateWatchHandoff({ ...input, now: definition.lifetime.deadline }, dependencies)
  assert.equal(expired.reason, "deadline_reached")
  assert.equal(preflightCalls, 0)
  assert.throws(() => revalidateWatchHandoff({
    ...input,
    handoff: { ...input.handoff, intent_content_hash: "sha256:drifted" },
  }, dependencies), /identity drifted/)
})

test("preflight block cannot become execution authority", () => {
  const blocked = revalidateWatchHandoff(input, {
    executionGate: () => ({ status: "ready" }),
    preflight: () => ({
      verdict: "blocked",
      blocked_by: [{ check_id: "G-KILL-SWITCH", reason: "safe mode" }],
      warnings: [],
      decision_card: "blocked",
    }),
  })
  assert.equal(blocked.status, "blocked")
  assert.equal(blocked.reason, "preflight_blocked")
  assert.equal(blocked.execution_authority, "none")
  assert.equal(blocked.next_step, "stop")
})
