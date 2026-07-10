import assert from "node:assert/strict"
import test from "node:test"

import { evaluatePreflight, type PreflightInput } from "./main"

const baseInput: PreflightInput = {
  now: "2026-07-06T12:00:20+08:00",
  plan: {
    symbol: "BTCUSDT",
    side: "long",
    setup_id: "trend-breakout",
    direction_state: "偏多已确认",
    execution_verdict: "等条件",
    thesis: "4H trend is intact",
    entry_intent: "buy pullback",
    exit_intent: "exit below invalidation",
    invalidation: "4H close below range",
    stop_price: 64000,
    risk_budget_usdt: 20,
    expected_rr_net: 2.2,
    live_permission: "live-small",
  },
  observe: {
    created_at: "2026-07-06T12:00:00+08:00",
    symbol: "BTCUSDT",
    side: "long",
    setup_id: "trend-breakout",
    account: {
      equity_usdt: 1000,
    },
    action_intent: {
      target_action: "place_entry",
      request: {
        type: "LIMIT",
      },
    },
  },
  strategy: {
    status: "live-small",
  },
  account_config: {
    max_open_risk_pct: 0.1,
    max_day_loss_pct: 0.05,
  },
  target_action: "place_entry",
  request: {
    type: "LIMIT",
  },
  aggregate_view: {
    active_plans_risk_sum: 10,
    current_account_open_risk_usdt: 5,
    realized_pnl_today_usdt: 0,
    active_plans_worst_loss_at_stop: -10,
  },
}

test("evaluatePreflight arms a complete live-small plan", () => {
  const result = evaluatePreflight(baseInput)

  assert.equal(result.verdict, "armable")
  assert.deepEqual(result.blocked_by, [])
  assert.match(result.decision_card, /Verdict: 偏多已确认 \/ 等条件 \/ armable/)
})

test("evaluatePreflight blocks stale observe", () => {
  const result = evaluatePreflight({
    ...baseInput,
    now: "2026-07-06T12:01:00+08:00",
  })

  assert.equal(result.verdict, "blocked")
  assert.equal(result.blocked_by[0].check_id, "G-OBS-FRESH")
})

test("evaluatePreflight blocks unverified setup for new risk", () => {
  const result = evaluatePreflight({
    ...baseInput,
    strategy: {
      status: "shadow",
    },
    plan: {
      ...baseInput.plan,
      live_permission: "shadow",
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-SETUP-LIVE-PERMISSION"))
})

test("evaluatePreflight treats adjust_position add as new risk", () => {
  const result = evaluatePreflight({
    ...baseInput,
    target_action: "adjust_position",
    request: {
      direction: "add",
      entries: [{ price: 65000, risk_ratio: 0.5 }],
    },
    strategy: {
      status: "shadow",
    },
    plan: {
      ...baseInput.plan,
      live_permission: "shadow",
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-SETUP-LIVE-PERMISSION"))
})

test("evaluatePreflight does not treat adjust_position reduce as new risk", () => {
  const result = evaluatePreflight({
    ...baseInput,
    target_action: "adjust_position",
    request: {
      direction: "reduce",
      qty_ratio: 0.5,
    },
    strategy: {
      status: "shadow",
    },
    plan: {
      ...baseInput.plan,
      setup_id: "",
      live_permission: "shadow",
    },
  })

  assert.equal(result.verdict, "armable")
  assert.equal(result.blocked_by.some((item) => item.check_id === "G-SETUP-LIVE-PERMISSION"), false)
})

test("evaluatePreflight abstains for no_action", () => {
  const result = evaluatePreflight({
    ...baseInput,
    target_action: "no_action",
  })

  assert.equal(result.verdict, "abstain")
})

test("evaluatePreflight blocks open risk cap breach", () => {
  const result = evaluatePreflight({
    ...baseInput,
    aggregate_view: {
      active_plans_risk_sum: 90,
      current_account_open_risk_usdt: 5,
      realized_pnl_today_usdt: 0,
      active_plans_worst_loss_at_stop: 0,
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-RISK-OPEN-CAP"))
})

test("evaluatePreflight blocks runtime policy single-trade risk cap", () => {
  const result = evaluatePreflight({
    ...baseInput,
    runtime_policy: {
      effective_limits: {
        max_single_trade_risk_usdt: 10,
      },
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-MAX-SINGLE-TRADE-RISK"))
})

test("evaluatePreflight blocks small-account notional and leverage caps", () => {
  const result = evaluatePreflight({
    ...baseInput,
    plan: {
      ...baseInput.plan,
      stop_price: 64900,
      risk_budget_usdt: 20,
    },
    request: {
      type: "LIMIT",
      entries: [{ price: 65000, risk_ratio: 1 }],
    },
    runtime_policy: {
      effective_limits: {
        max_entry_notional_usdt: 1000,
        max_single_position_leverage: 5,
      },
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-MAX-ENTRY-NOTIONAL"))
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-SINGLE-POSITION-LEVERAGE-CAP"))
})

test("evaluatePreflight blocks excessive new-risk actions per cycle", () => {
  const result = evaluatePreflight({
    ...baseInput,
    runtime_policy: {
      effective_limits: {
        max_open_actions_per_cycle: 2,
      },
    },
    aggregate_view: {
      ...baseInput.aggregate_view,
      open_actions_this_cycle: 2,
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-OPEN-RATE-CAP"))
})

test("evaluatePreflight blocks reentry before cooldown expires", () => {
  const result = evaluatePreflight({
    ...baseInput,
    runtime_policy: {
      effective_limits: {
        reentry_cooldown_minutes: 60,
      },
    },
    aggregate_view: {
      ...baseInput.aggregate_view,
      minutes_since_last_close: 15,
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-REENTRY-COOLDOWN"))
})

test("evaluatePreflight blocks opposite-side new risk in the same lane", () => {
  const result = evaluatePreflight({
    ...baseInput,
    plan: {
      ...baseInput.plan,
      side: "short",
    },
    observe: {
      ...baseInput.observe,
      side: "short",
    },
    aggregate_view: {
      ...baseInput.aggregate_view,
      current_lane_position_state: "long",
    },
  })

  assert.equal(result.verdict, "blocked")
  assert.ok(result.blocked_by.some((item) => item.check_id === "G-SAME-LANE-OPPOSITE-OPEN-CAP"))
})

test("evaluatePreflight blocks early noise reduction but allows hard-stop reduction", () => {
  const noise = evaluatePreflight({
    ...baseInput,
    target_action: "adjust_position",
    request: {
      direction: "reduce",
      qty_ratio: 0.5,
      exit_reason: "noise",
    },
    runtime_policy: {
      effective_limits: {
        min_hold_minutes_before_noise_close: 30,
      },
    },
    aggregate_view: {
      ...baseInput.aggregate_view,
      position_age_minutes: 5,
    },
  })

  assert.equal(noise.verdict, "blocked")
  assert.ok(noise.blocked_by.some((item) => item.check_id === "G-MIN-HOLD-BEFORE-NOISE-CLOSE"))

  const hardStop = evaluatePreflight({
    ...baseInput,
    target_action: "adjust_position",
    request: {
      direction: "reduce",
      qty_ratio: 0.5,
      exit_reason: "stop",
    },
    runtime_policy: {
      effective_limits: {
        min_hold_minutes_before_noise_close: 30,
      },
    },
    aggregate_view: {
      ...baseInput.aggregate_view,
      position_age_minutes: 5,
    },
  })

  assert.equal(hardStop.verdict, "armable")

  const takeProfit = evaluatePreflight({
    ...baseInput,
    target_action: "adjust_position",
    request: {
      direction: "reduce",
      qty_ratio: 0.5,
      exit_reason: "take_profit",
    },
    runtime_policy: {
      effective_limits: {
        min_hold_minutes_before_noise_close: 30,
      },
    },
    aggregate_view: {
      ...baseInput.aggregate_view,
      position_age_minutes: 5,
    },
  })

  assert.equal(takeProfit.verdict, "armable")
})

test("evaluatePreflight safe mode blocks new risk but allows defensive reduction", () => {
  const blocked = evaluatePreflight({
    ...baseInput,
    runtime_health: {
      safe_mode_active: true,
      safe_mode_reason: "ai parser failures",
    },
  })

  assert.equal(blocked.verdict, "blocked")
  assert.ok(blocked.blocked_by.some((item) => item.check_id === "G-KILL-SWITCH"))

  const defensive = evaluatePreflight({
    ...baseInput,
    target_action: "adjust_position",
    request: {
      direction: "reduce",
      qty_ratio: 0.5,
    },
    runtime_health: {
      safe_mode_active: true,
      safe_mode_reason: "ai parser failures",
    },
  })

  assert.equal(defensive.verdict, "armable")
})
