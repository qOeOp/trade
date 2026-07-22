import assert from "node:assert/strict"
import test from "node:test"
import { runL2BookWatchProbe } from "./l2-book-watch-probe"

test("watch probe requires health before observing a bounded same-epoch watch", () => {
  const calls: string[] = []
  const result = runL2BookWatchProbe({ max_events: 5, watch_ms: 250 }, {
    readHealth: () => { calls.push("health"); return healthResponse() },
    readWatch: (args) => { calls.push(args.join(" ")); return watchResponse() },
  })
  assert.deepEqual(calls, ["health", "--max-events 5 --watch-ms 250"])
  assert.equal(result.status, "observed")
  assert.equal(result.follow_up, "none")
  assert.deepEqual(result.writes, [])
})

test("watch probe stops before watch when health fails and surfaces resync follow-up", () => {
  let watchCalls = 0
  assert.throws(() => runL2BookWatchProbe({}, {
    readHealth: () => healthResponse(false),
    readWatch: () => { watchCalls += 1; return watchResponse() },
  }), /health is not ready/)
  assert.equal(watchCalls, 0)

  const resync = runL2BookWatchProbe({ max_events: 5, watch_ms: 250 }, {
    readHealth: () => healthResponse(),
    readWatch: () => watchResponse({
      epoch_count: 2,
      resync_count: 1,
      final_state: "resync_required",
      event_count: 2,
      events: [event("epoch-1"), event("epoch-2", true)],
    }),
  })
  assert.equal(resync.status, "resync_observed")
  assert.equal(resync.follow_up, "read_new_current_book_snapshot")
})

test("watch probe rejects authority, initial epoch, and caller control drift", () => {
  const run = (overrides: Record<string, unknown>) => runL2BookWatchProbe({ max_events: 5, watch_ms: 250 }, {
    readHealth: () => healthResponse(),
    readWatch: () => watchResponse(overrides),
  })
  assert.throws(() => run({ authority: "trading" }), /authority drifted/)
  assert.throws(() => run({ events: [event("epoch-x")] }), /initial epoch drifted/)
  assert.throws(() => run({ requested_watch_ms: 500 }), /request contract drifted/)
  assert.throws(() => runL2BookWatchProbe({ endpoint: "remote" }), /unknown input field/)
})

function healthResponse(ready = true): Record<string, unknown> {
  return {
    ok: true,
    action: "read_active_l2_service_health",
    health: {
      schema_version: "trade.l2-service-owner-health.v1",
      status: ready ? "healthy" : "degraded",
      symbol: "BTCUSDT",
      readiness: {
        supervisor_alive: true, service_alive: true, control_state_fresh: true,
        control_ready: true, source_read_ready: ready, overall_ready: ready,
      },
      source: { stream_epoch: "epoch-1", continuity_status: "live", read_ready: ready },
      lifecycle_authority: "none",
    },
  }
}

function watchResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    action: "watch_active_l2_book",
    watch: {
      schema_version: "trade.l2-owner-book-watch.v1",
      symbol: "BTCUSDT",
      requested_max_events: 5,
      requested_watch_ms: 250,
      query_deadline_ms: 1_750,
      timed_out: true,
      event_count: 1,
      epoch_count: 1,
      resync_count: 0,
      final_state: "live",
      events: [event("epoch-1")],
      transport_semantics: "latest_only_coalescing_watermark",
      non_economic: true,
      execution_compatible: false,
      authority: "market_data_read_only",
      ...overrides,
    },
  }
}

function event(epoch: string, resync = false): Record<string, unknown> {
  return { symbol: "BTCUSDT", stream_epoch: epoch, resync_required: resync }
}
