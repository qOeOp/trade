import assert from "node:assert/strict"
import test from "node:test"

import { buildSetupEvent, projectSetupEvents } from "./setup-event-chain"

test("setup event chain projects common setup behavior", () => {
  const open = buildSetupEvent({
    chainId: "chain-1",
    behavior: "open_setup",
    backend: "rd_artifact",
    source: "test",
    createdAt: "2026-07-09T00:00:00.000Z",
    payload: {
      side: "short",
      entry: 100,
      initial_stop: 105,
      active_stop: 105,
      target: 90,
    },
  })
  const observed = buildSetupEvent({
    chainId: "chain-1",
    behavior: "observe_setup",
    backend: "rd_artifact",
    source: "test",
    createdAt: "2026-07-09T04:00:00.000Z",
    payload: {
      bar_closed_at: "2026-07-09T08:00:00.000Z",
      bars_held: 1,
      active_stop: 100,
      mfe_r: 0.8,
      mae_r: -0.2,
      close_r: 0.4,
      break_even_armed: true,
    },
  })
  const close = buildSetupEvent({
    chainId: "chain-1",
    behavior: "close_setup",
    backend: "rd_artifact",
    source: "test",
    createdAt: "2026-07-09T08:00:00.000Z",
    payload: {
      exit_reason: "stop",
      exit_time: "2026-07-09T08:00:00.000Z",
      exit_price: 100,
      r: 0,
      bars_held: 2,
    },
  })

  const projection = projectSetupEvents([open, observed, close])
  assert.equal(projection.status, "closed")
  assert.equal(projection.side, "short")
  assert.equal(projection.entry, 100)
  assert.equal(projection.active_stop, 100)
  assert.equal(projection.mfe_r, 0.8)
  assert.equal(projection.mae_r, -0.2)
  assert.equal(projection.close_r, 0.4)
  assert.equal(projection.break_even_armed, true)
  assert.equal(projection.exit_reason, "stop")
  assert.equal(projection.r, 0)
  assert.equal(projection.event_count, 3)
})
