import assert from "node:assert/strict"
import test from "node:test"
import { runL2BookWatchSession } from "./l2-book-watch-session"

test("session takes one baseline then completes bounded watch cycles", async () => {
  let snapshots = 0
  let watches = 0
  const result = await runL2BookWatchSession({ max_cycles: 2, session_ms: 10_000, max_events: 5, watch_ms: 250 }, {
    readSnapshot: () => { snapshots += 1; return snapshot("epoch-1") },
    readWatch: () => { watches += 1; return watch("epoch-1") },
    monotonicNow: () => 0,
    utcNow: () => "2026-07-22T00:00:00.000Z",
  })
  assert.equal(result.status, "completed")
  assert.equal(result.stop_reason, "max_cycles_reached")
  assert.equal(snapshots, 1)
  assert.equal(watches, 2)
  assert.deepEqual(result.metrics, {
    duration_ms: 0,
    completed_watch_cycles: 2,
    snapshot_count: 1,
    resnapshot_count: 0,
    watch_failure_count: 0,
    snapshot_failure_count: 0,
    reconnect_count: 0,
    resync_signal_count: 0,
    epoch_rollover_count: 0,
    observed_epoch_count: 1,
    retry_sleep_ms: 0,
    max_consecutive_failures: 0,
    total_failure_count: 0,
  })
})

test("watch failure backs off, resnapshots, and reconnects without exposing error details", async () => {
  let now = 0
  let snapshotCalls = 0
  let watchCalls = 0
  const result = await runL2BookWatchSession({ max_cycles: 1, session_ms: 10_000 }, {
    readSnapshot: () => snapshot(++snapshotCalls === 1 ? "epoch-1" : "epoch-2"),
    readWatch: () => {
      watchCalls += 1
      if (watchCalls === 1) throw new Error("secret endpoint and local path")
      return watch("epoch-2")
    },
    sleep: async (milliseconds) => { now += milliseconds },
    monotonicNow: () => now,
    utcNow: () => "2026-07-22T00:00:00.000Z",
  })
  assert.equal(result.status, "completed")
  assert.equal((result.metrics as Record<string, unknown>).reconnect_count, 1)
  assert.equal((result.metrics as Record<string, unknown>).resnapshot_count, 1)
  assert.equal((result.metrics as Record<string, unknown>).epoch_rollover_count, 1)
  assert.equal(JSON.stringify(result).includes("secret endpoint"), false)
  const transitions = result.transitions as Array<Record<string, unknown>>
  assert.deepEqual(transitions.map((item) => item.kind), ["snapshot", "retry", "snapshot", "watch"])
  assert.equal(transitions[1].error_class, "watch_unavailable")
})

test("resync and rollover force a successful final resnapshot before completion", async () => {
  let snapshotCalls = 0
  const result = await runL2BookWatchSession({ max_cycles: 1, session_ms: 10_000 }, {
    readSnapshot: () => snapshot(++snapshotCalls === 1 ? "epoch-1" : "epoch-2"),
    readWatch: () => watch("epoch-1", { finalEpoch: "epoch-2", resyncCount: 1 }),
    monotonicNow: () => 0,
    utcNow: () => "2026-07-22T00:00:00.000Z",
  })
  assert.equal(snapshotCalls, 2)
  assert.equal((result.metrics as Record<string, unknown>).resync_signal_count, 1)
  assert.equal((result.metrics as Record<string, unknown>).resnapshot_count, 1)
  assert.equal((result.final_baseline as Record<string, unknown>).stream_epoch, "epoch-2")
  const transitions = result.transitions as Array<Record<string, unknown>>
  assert.equal(transitions.at(-1)?.kind, "snapshot")
  assert.equal(transitions.at(-1)?.reason, "epoch_or_resync")
})

test("session returns bounded unavailable evidence after retry exhaustion", async () => {
  let now = 0
  const result = await runL2BookWatchSession({ max_cycles: 1, session_ms: 30_000 }, {
    readSnapshot: () => { throw new Error("owner unavailable") },
    sleep: async (milliseconds) => { now += milliseconds },
    monotonicNow: () => now,
    utcNow: () => "2026-07-22T00:00:00.000Z",
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, "unavailable")
  assert.equal(result.stop_reason, "retry_budget_exhausted")
  assert.equal((result.metrics as Record<string, unknown>).snapshot_failure_count, 7)
  assert.equal((result.metrics as Record<string, unknown>).retry_sleep_ms, 5_100)
})

test("session classifies owner-health failure without persisting raw error details", async () => {
  let now = 0
  let snapshots = 0
  const result = await runL2BookWatchSession({ max_cycles: 1, session_ms: 10_000 }, {
    readSnapshot: () => {
      snapshots += 1
      if (snapshots === 1) throw new Error("L2 service health failed: secret local path")
      return snapshot("epoch-1")
    },
    readWatch: () => watch("epoch-1"),
    sleep: async (milliseconds) => { now += milliseconds },
    monotonicNow: () => now,
    utcNow: () => "2026-07-22T00:00:00.000Z",
  })
  const transitions = result.transitions as Array<Record<string, unknown>>
  assert.equal(transitions[0].error_class, "owner_health_unavailable")
  assert.equal(JSON.stringify(result).includes("secret local path"), false)
})

test("session controls are bounded and closed to infrastructure injection", async () => {
  await assert.rejects(() => runL2BookWatchSession({ max_cycles: 121 }), /max_cycles must be/)
  await assert.rejects(() => runL2BookWatchSession({ session_ms: 1_999 }), /session_ms must be/)
  await assert.rejects(() => runL2BookWatchSession({ endpoint: "remote" }), /unknown input field/)
})

test("resident consumer can observe progress and request a bounded stop", async () => {
  const transitions: string[] = []
  let stop = false
  let yields = 0
  const result = await runL2BookWatchSession({ max_cycles: 10, session_ms: 30_000 }, {
    readSnapshot: () => snapshot("epoch-1"),
    readWatch: () => watch("epoch-1"),
    onTransition: (transition) => {
      transitions.push(String(transition.kind))
      if (transition.kind === "watch") stop = true
    },
    shouldStop: () => stop,
    yieldControl: async () => { yields += 1 },
    monotonicNow: () => 0,
    utcNow: () => "2026-07-22T00:00:00.000Z",
  })
  assert.equal(result.status, "stopped")
  assert.equal(result.stop_reason, "stop_requested")
  assert.deepEqual(transitions, ["snapshot", "watch"])
  assert.equal(yields, 2)
})

function snapshot(epoch: string): Record<string, unknown> {
  return {
    schema_version: "trade.ops-l2-current-book-probe.v1",
    ok: true,
    status: "observed",
    dependency: { stream_epoch: epoch },
    observation: { stream_epoch: epoch, book_hash: "a".repeat(64), freshness_ms: 10 },
    consumer_authority: "non_economic_observation_only",
    writes: [],
  }
}

function watch(
  startEpoch: string,
  input: { finalEpoch?: string; resyncCount?: number } = {},
): Record<string, unknown> {
  const finalEpoch = input.finalEpoch ?? startEpoch
  const resyncCount = input.resyncCount ?? 0
  const events = finalEpoch === startEpoch
    ? [{ stream_epoch: startEpoch }]
    : [{ stream_epoch: startEpoch }, { stream_epoch: finalEpoch }]
  return {
    schema_version: "trade.ops-l2-book-watch-probe.v1",
    ok: true,
    status: resyncCount > 0 ? "resync_observed" : "observed",
    dependency: { stream_epoch: startEpoch },
    observation: {
      event_count: events.length,
      epoch_count: new Set(events.map((event) => event.stream_epoch)).size,
      resync_count: resyncCount,
      final_state: resyncCount > 0 ? "resync_required" : "live",
      timed_out: true,
      events,
    },
    follow_up: resyncCount > 0 ? "read_new_current_book_snapshot" : "none",
    consumer_authority: "non_economic_observation_only",
    writes: [],
  }
}
