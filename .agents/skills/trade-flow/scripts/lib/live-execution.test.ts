import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { runLiveSmall } from "./live-execution"
import { ensureSchema } from "./plan-events"
import type { Runner } from "./observe-adapter"

test("live-small uses injected runner with stable order-place command contract", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const runner: Runner = async (command, options) => {
    calls.push({ command, cwd: options?.cwd })
    return {
      ok: true,
      data: {
        ok: true,
        data: {
          method: "futuresCreateAlgoOrder",
          result: { algoId: 9001, clientAlgoId: "flow-live-fixture-1-entry" },
          confirmedResult: { algoId: 9001, clientAlgoId: "flow-live-fixture-1-entry" },
        },
      },
      stdout: "{}",
      stderr: "",
    }
  }

  try {
    const result = await runLiveSmall(db, liveSmallInput(), true, runner)
    assert.equal(result.recorded, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cwd, "/repo/.agents/skills/binance-order-place")
    assert.deepEqual(calls[0].command.slice(0, 8), [
      "bun",
      "scripts/main.ts",
      "--symbol",
      "BTCUSDT",
      "--side",
      "BUY",
      "--type",
      "STOP_MARKET",
    ])
    assert.ok(calls[0].command.includes("--new-client-order-id"))
    assert.ok(calls[0].command.includes("flow-live-fixture-1-entry"))
    assert.ok(calls[0].command.includes("--yes"))
  } finally {
    db.close()
  }
})

test("live-small runner failure does not record order_fill", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  const runner: Runner = async () => ({
    ok: false,
    error: "order-place unavailable",
    stdout: "",
    stderr: "boom",
    exitCode: 1,
  })

  try {
    await assert.rejects(
      () => runLiveSmall(db, liveSmallInput(), true, runner),
      /live-small execution failed/,
    )
    const row = db.query("SELECT COUNT(*) AS count FROM plan_event WHERE kind='order_fill'").get() as { count: number }
    assert.equal(row.count, 0)
  } finally {
    db.close()
  }
})

function liveSmallInput() {
  return {
    repoRoot: "/repo",
    now: "2026-07-06T12:00:20+08:00",
    event_key: "evt-live-fixture-1",
    created_at: "2026-07-06T12:00:21Z",
    target_action: "place_entry",
    plan: {
      symbol: "BTCUSDT",
      side: "long",
      setup_id: "trend-breakout",
      direction_state: "偏多已确认",
      execution_verdict: "等条件",
      thesis: "4H trend is intact",
      entry_intent: "buy breakout",
      exit_intent: "exit below invalidation",
      invalidation: "4H close below range",
      stop_price: 64000,
      risk_budget_usdt: 10,
      expected_rr_net: 2,
      live_permission: "live-small",
    },
    observe: {
      created_at: "2026-07-06T12:00:00+08:00",
      symbol: "BTCUSDT",
      side: "long",
      setup_id: "trend-breakout",
      account: { equity_usdt: 1000 },
    },
    strategy: { status: "live-small" },
    account_config: {
      max_open_risk_pct: 0.1,
      max_day_loss_pct: 0.05,
    },
    request: { type: "STOP_MARKET" },
    aggregate_view: {
      active_plans_risk_sum: 0,
      current_account_open_risk_usdt: 0,
      realized_pnl_today_usdt: 0,
      active_plans_worst_loss_at_stop: 0,
    },
    execution_contract_input: {
      source_observe_event_key: "obs-live-fixture-1",
      chain_id: "flow-live-fixture",
      setup_id: "trend-breakout",
      market: "usdm",
      symbol: "BTCUSDT",
      side: "long",
      position_side: "BOTH",
      margin_mode: "isolated",
      target_leverage: 2,
      account_snapshot: {
        equity_usdt: 1000,
        available_balance_usdt: 900,
        snapshot_at: "2026-07-06T12:00:00+08:00",
      },
      risk: {
        risk_budget_usdt: 10,
        stop_price: 64000,
        invalidation: "below range",
        expected_rr_net: 2,
      },
      entries: [{
        type: "STOP_MARKET",
        stop_price: 66000,
        margin_usdt: 100,
      }],
      exchange_rules: {
        quantity_step_size: "0.001",
        min_qty: "0.001",
      },
    },
  }
}
