import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { run } from "./main"

test("event store CLI returns structured errors", () => {
  const result = run(["--append-event", "--json", "{}"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /event_key is required/)
})

test("event store CLI exposes latest order fill as owner read surface", () => {
  const dbPath = join(repoRoot(), "data", "test", `event-store-cli-${crypto.randomUUID()}.db`)
  try {
    const event = {
      event_key: "fill-cli-1",
      chain_id: "flow-cli-1",
      kind: "order_fill",
      created_at: "2026-07-11T00:00:00Z",
      body_json: {
        source: "reconcile",
        sub_kind: "fill",
        client_order_id: "client-cli-1",
      },
    }

    const append = run(["--append-event", "--db", dbPath, "--json", JSON.stringify(event)])
    assert.equal(append.ok, true)

    const result = run(["--read-latest-order-fill", "--db", dbPath, "--chain-id", "flow-cli-1"]) as {
      ok: boolean
      data: { event_key: string; chain_id: string; kind: string }
    }
    assert.equal(result.ok, true)
    assert.equal(result.data.event_key, "fill-cli-1")
    assert.equal(result.data.chain_id, "flow-cli-1")
    assert.equal(result.data.kind, "order_fill")
  } finally {
    rmSync(dbPath, { force: true })
  }
})

test("event store CLI appends event write envelopes", () => {
  const dbPath = join(repoRoot(), "data", "test", `event-store-envelope-${crypto.randomUUID()}.db`)
  try {
    const event = {
      event_key: "observe-envelope-1",
      chain_id: "flow-envelope-1",
      kind: "observe",
      created_at: "2026-07-11T00:00:00Z",
      body_json: { source: "slow_track", symbol: "BTCUSDT" },
    }
    const envelope = {
      schema_version: "trade.protocol.event-write-envelope.v1",
      event_ref: "trade_event_store:plan_event/observe-envelope-1",
      owner_store: "trade_event_store",
      event_kind: "observe",
      flow_id: "flow-envelope-1",
      source_job_id: "slow_track_market_watch",
      idempotency_key: "cycle-1:J03:observe-envelope-1",
      body_ref: "inline:observe-envelope-1",
      event_inline: event,
    }

    const append = run(["--append-event-envelope", "--db", dbPath, "--json", JSON.stringify(envelope)]) as {
      ok: boolean
      data: { event_ref: string; event_inline: { event_key: string } }
    }
    assert.equal(append.ok, true)
    assert.equal(append.data.event_ref, "trade_event_store:plan_event/observe-envelope-1")
    assert.equal(append.data.event_inline.event_key, "observe-envelope-1")

    const result = run(["--read-flow-events", "--db", dbPath, "--chain-id", "flow-envelope-1"]) as {
      ok: boolean
      data: Array<{ event_key: string; kind: string }>
    }
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.map((eventRow) => eventRow.event_key), ["observe-envelope-1"])
  } finally {
    rmSync(dbPath, { force: true })
  }
})

test("event store CLI lists chain ids for owner-side scans", () => {
  const dbPath = join(repoRoot(), "data", "test", `event-store-chain-list-${crypto.randomUUID()}.db`)
  try {
    for (const chainId of ["flow-b", "flow-a"]) {
      const append = run(["--append-event", "--db", dbPath, "--json", JSON.stringify({
        event_key: `${chainId}-observe`,
        chain_id: chainId,
        kind: "observe",
        created_at: "2026-07-11T00:00:00Z",
        body_json: { source: "slow_track" },
      })])
      assert.equal(append.ok, true)
    }

    const result = run(["--list-chain-ids", "--db", dbPath]) as {
      ok: boolean
      data: string[]
    }
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, ["flow-a", "flow-b"])
  } finally {
    rmSync(dbPath, { force: true })
  }
})
