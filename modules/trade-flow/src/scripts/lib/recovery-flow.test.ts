import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { ensureSchema, appendPlanEvent } from "./plan-events"
import { cronRecoverFromTools, reconcileFromTools } from "./recovery-flow"
import type { Runner } from "../../../../flow/observe-runner/src/lib/observe-runner"

test("reconcile-from-tools uses injected runner with stable account snapshot command contract", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  seedObserve(db, "flow-reconcile-fixture")
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const runner: Runner = async (command, options) => {
    calls.push({ command, cwd: options?.cwd })
    return accountSnapshotResponse()
  }

  try {
    const result = await reconcileFromTools(db, "flow-reconcile-fixture", {
      repoRoot: "/repo",
      historyLimit: 25,
    }, runner) as { drafts: unknown[] }
    assert.equal(result.drafts.length, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cwd, "/repo/modules/binance/account-snapshot")
    assert.deepEqual(calls[0].command, [
      "bun",
      "src/scripts/main.ts",
      "--symbol",
      "BTCUSDT",
      "--include-history",
      "--history-limit",
      "25",
    ])
  } finally {
    db.close()
  }
})

test("cron recover runner failure does not apply reconcile drafts", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  seedObserve(db, "flow-recover-failure")
  const runner: Runner = async () => ({
    ok: false,
    error: "snapshot unavailable",
    stdout: "",
    stderr: "boom",
    exitCode: 1,
  })

  try {
    await assert.rejects(
      () => cronRecoverFromTools(db, "flow-recover-failure", {
        repoRoot: "/repo",
        apply_reconcile: true,
      }, true, runner),
      /reconcile snapshot failed/,
    )
    const row = db.query("SELECT COUNT(*) AS count FROM plan_event WHERE kind='order_fill'").get() as { count: number }
    assert.equal(row.count, 0)
  } finally {
    db.close()
  }
})

test("cron recover writes needs_review event when reconcile has unmatched facts", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  seedObserve(db, "flow-unmatched-recover")
  const runner: Runner = async () => ({
    ok: true,
    data: {
      ok: true,
      data: {
        openOrders: {
          regular: [{
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            status: "NEW",
            origQty: "0.01",
            price: "65000",
            orderId: "8001",
            clientOrderId: "foreign-flow-entry",
            positionSide: "BOTH",
            source: "openOrders",
            sourceType: "standard",
          }],
          protective: [],
        },
        positions: [],
      },
    },
    stdout: "{}",
    stderr: "",
  })

  try {
    const result = await cronRecoverFromTools(db, "flow-unmatched-recover", {
      repoRoot: "/repo",
      needs_review_event_key: "needs-review-fixture",
    }, true, runner) as {
      status: string
      review_event: { kind: string; body_json: { status: string; reason: string } }
      after: { risk_lock: { locked: boolean; reason: string } }
    }
    assert.equal(result.status, "abort_unmatched_reconcile")
    assert.equal(result.review_event.kind, "review")
    assert.equal(result.review_event.body_json.status, "needs_review")
    assert.equal(result.review_event.body_json.reason, "unmatched_reconcile")
    assert.equal(result.after.risk_lock.locked, true)
    assert.equal(result.after.risk_lock.reason, "needs_review")

    const row = db.query("SELECT COUNT(*) AS count FROM plan_event WHERE kind='review'").get() as { count: number }
    assert.equal(row.count, 1)
  } finally {
    db.close()
  }
})

function seedObserve(db: Database, chainId: string): void {
  appendPlanEvent(db, {
    event_key: `${chainId}-observe-1`,
    chain_id: chainId,
    kind: "observe",
    created_at: "2026-07-06T12:00:00Z",
    body_json: {
      symbol: "BTCUSDT",
      action_intent: { target_action: "no_action" },
    },
  })
}

function accountSnapshotResponse() {
  return {
    ok: true as const,
    data: {
      ok: true,
      data: {
        openOrders: {
          regular: [{
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            status: "NEW",
            origQty: "0.01",
            price: "65000",
            orderId: "7001",
            clientOrderId: "flow-reconcile-fixture-1-entry",
            positionSide: "BOTH",
            source: "openOrders",
            sourceType: "standard",
          }],
          protective: [],
        },
        positions: [],
      },
    },
    stdout: "{}",
    stderr: "",
  }
}
