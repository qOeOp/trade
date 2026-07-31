import assert from "node:assert/strict"
import test from "node:test"
import { compilePlanWatchTask, type WatchTaskCompileInput } from "./watch-task-compiler"

const input: WatchTaskCompileInput = {
  task_id: "watch-compile-1",
  flow_id: "flow-1",
  plan: {
    schema_version: "trade-plan-draft.v1",
    plan_ref: "plan://1",
    symbol: "BTCUSDT",
    side: "long",
    source_refs: ["decision://1"],
    expires_at: "2026-07-23T01:00:00.000Z",
    content_hash: "sha256:plan-1",
  },
  action_intent: {
    schema_version: "trade.protocol.action-intent-ref.v1",
    intent_ref: "intent://1",
    intent_kind: "trade_plan",
    status: "proposed",
    symbol: "BTCUSDT",
    side: "long",
    source_refs: ["plan://1"],
    expires_at: "2026-07-23T01:00:00.000Z",
    content_hash: "sha256:plan-1",
  },
  market_source_ref: "binance://usdm/BTCUSDT/mark-price",
  trigger_low: 99,
  trigger_high: 101,
  invalidation_price: 95,
  created_at: "2026-07-23T00:00:00.000Z",
  not_before: "2026-07-23T00:00:01.000Z",
  deadline: "2026-07-23T00:30:00.000Z",
  poll_interval_ms: 1_000,
  max_observations: 100,
  max_errors: 3,
  max_fact_age_ms: 2_000,
  idempotency_key: "watch:flow-1:intent-1",
}

test("watch compiler binds matching plan and intent into the fixed task contract", () => {
  const result = compilePlanWatchTask(input)
  assert.equal(result.plan_ref, "plan://1")
  assert.equal(result.intent_ref, "intent://1")
  assert.equal(result.intent_content_hash, "sha256:plan-1")
  assert.equal(result.invalidation.operator, "lte")
  assert.equal(result.source_refs.includes("binance://usdm/BTCUSDT/mark-price"), true)
})

test("watch compiler rejects lineage, identity, hash, and expiry drift", () => {
  assert.throws(() => compilePlanWatchTask({
    ...input,
    action_intent: { ...(input.action_intent as Record<string, unknown>), source_refs: ["decision://1"] },
  }), /include plan_ref/)
  assert.throws(() => compilePlanWatchTask({
    ...input,
    action_intent: { ...(input.action_intent as Record<string, unknown>), content_hash: "sha256:changed" },
  }), /hash mismatch/)
  assert.throws(() => compilePlanWatchTask({
    ...input,
    action_intent: { ...(input.action_intent as Record<string, unknown>), symbol: "ETHUSDT" },
  }), /symbol\/side mismatch/)
  assert.throws(() => compilePlanWatchTask({ ...input, deadline: "2026-07-23T01:00:00.001Z" }), /exceeds plan expiry/)
})
