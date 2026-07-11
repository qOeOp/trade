import assert from "node:assert/strict"
import test from "node:test"

import { compileExecutionContract } from "../../../../contracts/execution-contract/src/execution-contract"
import {
  buildExecutionCommandSpec,
  buildOrderCancelCommand,
  buildPositionAdjustCommand,
  buildPositionProtectCommand,
} from "./execution-router"

test("execution command spec routes place_entry to order-place with compiled contract", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "place_entry",
    execution_contract_input: contractInput(),
  })

  assert.equal(spec.target_action, "place_entry")
  assert.equal(spec.tool, "binance-order-place")
  assert.equal(spec.cwd, "/repo/modules/exchange-gateway/binance-write/order-place")
  assert.deepEqual(spec.command.slice(0, 8), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--side",
    "BUY",
    "--type",
    "STOP_MARKET",
  ])
  assert.ok(spec.command.includes("--new-client-order-id"))
  assert.ok(spec.command.includes("flow-route-1-1-entry"))
  assert.ok(spec.command.includes("--yes"))
  assertFlagValue(spec.command, "--exchange-runtime-db", "/repo/data/exchange_runtime.db")
  assertFlagValue(spec.command, "--requested-by-ref", "execution:flow-route-1:obs-route-1")
})

test("execution command spec resolves semantic entry intent before routing order-place", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "place_entry",
    execution_contract_input: {
      ...contractInput(),
      entries: [{
        intent: "entry_at",
        price: 66000,
        reference_price: 65000,
        margin_usdt: 100,
      }],
    },
  })

  assert.deepEqual(spec.command.slice(0, 12), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--side",
    "BUY",
    "--type",
    "STOP_MARKET",
    "--quantity",
    "0.003",
    "--position-side",
    "BOTH",
  ])
  assert.ok(spec.command.includes("--stop-price"))
  assert.ok(spec.command.includes("66000"))
})

test("execution command spec keeps dry-run and live-small compiled contract parity", () => {
  const input = {
    repoRoot: "/repo",
    target_action: "place_entry",
    execution_contract_input: {
      ...contractInput(),
      entries: [{
        intent: "entry_at",
        price: 66000,
        reference_price: 65000,
        margin_usdt: 100,
      }],
    },
  }
  const dryRunSpec = buildExecutionCommandSpec(input)
  const precompiled = compileExecutionContract(input.execution_contract_input as unknown as Parameters<typeof compileExecutionContract>[0])
  const liveSmallSpec = buildExecutionCommandSpec(input, precompiled)

  assert.deepEqual(liveSmallSpec.command, dryRunSpec.command)
  assert.equal(precompiled.entries[0].resolver_snapshot.route_reason.includes("breakout"), true)
})

test("execution command spec routes cancel_order to order-cancel", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "cancel_order",
    request: {
      symbol: "btc/usdt",
      orig_client_order_id: "flow-route-1-1-entry",
    },
  })

  assert.equal(spec.tool, "binance-order-cancel")
  assert.equal(spec.cwd, "/repo/modules/exchange-gateway/binance-write/order-cancel")
  assert.deepEqual(spec.command, [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--orig-client-order-id",
    "flow-route-1-1-entry",
    "--yes",
    "--exchange-runtime-db",
    "/repo/data/exchange_runtime.db",
    "--requested-by-ref",
    "execution:BTCUSDT:cancel_order:flow-route-1-1-entry",
  ])
})

test("cancel command maps algo-all bucket without order identifiers", () => {
  assert.deepEqual(buildOrderCancelCommand({
    target_action: "cancel_order",
    request: {
      symbol: "ETHUSDT",
      order_bucket: "algo",
      scope: "all",
    },
  }), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "ETHUSDT",
    "--algo",
    "--all",
    "--yes",
  ])
})

test("position adjust command only maps reduce or close", () => {
  assert.deepEqual(buildPositionAdjustCommand({
    target_action: "adjust_position",
    request: {
      symbol: "SOLUSDT",
      position_side: "LONG",
      direction: "reduce",
      reduce_quantity: 1.25,
    },
  }), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "SOLUSDT",
    "--position-side",
    "LONG",
    "--reduce-quantity",
    "1.25",
    "--yes",
  ])

  assert.deepEqual(buildPositionAdjustCommand({
    target_action: "adjust_position",
    request: {
      symbol: "SOLUSDT",
      position_side: "SHORT",
      direction: "close",
    },
  }), [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "SOLUSDT",
    "--position-side",
    "SHORT",
    "--close-position",
    "true",
    "--yes",
  ])

  assert.throws(
    () => buildPositionAdjustCommand({
      target_action: "adjust_position",
      request: {
        symbol: "SOLUSDT",
        position_side: "LONG",
        direction: "add",
        quantity: 1,
      },
    }),
    /only supports reduce or close/,
  )
})

test("execution command spec routes adjust_position with exchange audit flags", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "adjust_position",
    request: {
      symbol: "SOLUSDT",
      position_side: "LONG",
      direction: "reduce",
      reduce_quantity: 1.25,
    },
  })

  assert.equal(spec.tool, "binance-position-adjust")
  assert.equal(spec.cwd, "/repo/modules/exchange-gateway/binance-write/position-adjust")
  assertFlagValue(spec.command, "--exchange-runtime-db", "/repo/data/exchange_runtime.db")
  assertFlagValue(spec.command, "--requested-by-ref", "execution:SOLUSDT:adjust_position")
})

test("position protect command maps stop take-profit and trailing legs", () => {
  const command = buildPositionProtectCommand({
    target_action: "sync_protection",
    plan: {
      symbol: "BTCUSDT",
      stop_price: 64000,
    },
    request: {
      position_side: "LONG",
      quantity: "0.01",
      take_profit_trigger: 69000,
      trailing_activation_price: 68000,
      callback_rate: 0.5,
      working_type: "MARK_PRICE",
      price_protect: false,
    },
  })

  assert.deepEqual(command, [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--position-side",
    "LONG",
    "--quantity",
    "0.01",
    "--stop-loss-trigger",
    "64000",
    "--take-profit-trigger",
    "69000",
    "--trailing-activation-price",
    "68000",
    "--callback-rate",
    "0.5",
    "--working-type",
    "MARK_PRICE",
    "--price-protect",
    "false",
    "--yes",
  ])
})

test("execution command spec routes sync_protection with exchange audit flags", () => {
  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "sync_protection",
    plan: {
      symbol: "BTCUSDT",
      stop_price: 64000,
    },
    request: {
      position_side: "LONG",
      quantity: "0.01",
      stop_loss_trigger: 64000,
    },
  })

  assert.equal(spec.tool, "binance-position-protect")
  assert.equal(spec.cwd, "/repo/modules/exchange-gateway/binance-write/position-protect")
  assertFlagValue(spec.command, "--exchange-runtime-db", "/repo/data/exchange_runtime.db")
  assertFlagValue(spec.command, "--requested-by-ref", "execution:BTCUSDT:sync_protection")
})

test("no_action has no executable command spec", () => {
  assert.throws(
    () => buildExecutionCommandSpec({ target_action: "no_action" }),
    /no_action has no executable/,
  )
  assert.throws(
    () => buildExecutionCommandSpec({}),
    /no_action has no executable/,
  )
})

function contractInput() {
  return {
    source_observe_event_key: "obs-route-1",
    chain_id: "flow-route-1",
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
  }
}

function assertFlagValue(command: string[], flag: string, value: string): void {
  const index = command.indexOf(flag)
  assert.notEqual(index, -1)
  assert.equal(command[index + 1], value)
}
