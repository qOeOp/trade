import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import type { Runner } from "./observe-adapter"
import { ensureSchema, appendPlanEvent } from "./plan-events"
import { cronRecoverFromSkills, reconcileFromSkills } from "./recovery-flow"

test("reconcile-from-skills uses injected runner with stable account snapshot command contract", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  seedObserve(db, "flow-reconcile-fixture")
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const runner: Runner = async (command, options) => {
    calls.push({ command, cwd: options?.cwd })
    return accountSnapshotResponse()
  }

  try {
    const result = await reconcileFromSkills(db, "flow-reconcile-fixture", {
      repoRoot: "/repo",
      historyLimit: 25,
    }, runner) as { drafts: unknown[] }
    assert.equal(result.drafts.length, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cwd, "/repo/.agents/skills/binance-account-snapshot")
    assert.deepEqual(calls[0].command, [
      "bun",
      "scripts/main.ts",
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
      () => cronRecoverFromSkills(db, "flow-recover-failure", {
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
