import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import type { Runner } from "../../../../contracts/runtime-core/src/tool-runner"
import { appendPlanEvent, ensureSchema, readFlowEvents } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { applyReconcileDrafts, reduceFlowState } from "../../../../portfolio-execution-state/flow-projector/src/lib/flow-projector"
import { cronRecoverFromTools, reconcileFromTools } from "./recovery-runner"

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
    const result = await reconcileFromTools(":memory:", "flow-reconcile-fixture", {
      repoRoot: "/repo",
      historyLimit: 25,
    }, runner, testRuntime(db)) as { drafts: unknown[] }
    assert.equal(result.drafts.length, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cwd, "/repo/apps/exchange-gateway/binance-read/account-snapshot")
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
      () => cronRecoverFromTools(":memory:", "flow-recover-failure", {
        repoRoot: "/repo",
        apply_reconcile: true,
      }, true, runner, testRuntime(db)),
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
    const result = await cronRecoverFromTools(":memory:", "flow-unmatched-recover", {
      repoRoot: "/repo",
      needs_review_event_key: "needs-review-fixture",
    }, true, runner, testRuntime(db)) as {
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

function testRuntime(db: Database) {
  return {
    eventReader: (_dbPath: string, chainId: string) => readFlowEvents(db, chainId) as unknown as Record<string, unknown>[],
    stateReader: (_dbPath: string, chainId: string) => reduceFlowState(db, chainId),
    eventAppender: (_dbPath: string, event: Record<string, unknown>) => {
      appendPlanEvent(db, event as unknown as Parameters<typeof appendPlanEvent>[1])
      return event
    },
    reconcileApplier: (_dbPath: string, reconcile: Record<string, unknown>, yes: boolean) => applyReconcileDrafts(db, reconcile, yes),
  }
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
