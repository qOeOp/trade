import { expect, test } from "bun:test"
import {
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  canonicalHash,
  createReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayExactTradeStopResolution,
  resolveReplayExactTradeStopPath,
  type ReplayExactTradeStopResolutionInput,
} from "./replay-exact-trade-stop-resolution"

const HASH = "a".repeat(64)

function input(prices: number[], side: "long" | "short" = "long"): ReplayExactTradeStopResolutionInput {
  const events: ReplayAggregateTradeEvent[] = prices.map((price, index) => ({
    schema_version: REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
    symbol: "BTCUSDT",
    aggregate_trade_id: 1000 + index,
    first_trade_id: 2000 + index,
    last_trade_id: 2000 + index,
    trade_time: index < 2 ? "2026-07-14T04:00:00.100Z" : `2026-07-14T04:00:0${index}.100Z`,
    available_at: index < 2 ? "2026-07-14T04:00:00.101Z" : `2026-07-14T04:00:0${index}.101Z`,
    price,
    quantity: 1,
    buyer_is_maker: index % 2 === 0,
  }))
  const coverageAttestation = createReplayAggregateTradeCoverageAttestation({
    attestation_id: `coverage-${side}-${prices.join("-")}`,
    attestation_ref: "aggregate-trades://fixture/window-1",
    symbol: "BTCUSDT",
    coverage_start: "2026-07-14T04:00:00Z",
    coverage_end: "2026-07-14T05:00:00Z",
    source_ref: "binance-vision://fixture/aggTrades",
    source_hash: HASH,
    produced_at: "2026-07-14T06:00:00Z",
    events,
  })
  return {
    run_id: `run-${side}`,
    position_side: side,
    entry_trigger_price: side === "long" ? 102 : 98,
    protective_stop_price: side === "long" ? 95 : 105,
    target_price: side === "long" ? 110 : 90,
    coverage_attestation: coverageAttestation,
    events,
  }
}

test("same OHLC envelope resolves to opposite terminal owners under ordered aggregate trades", () => {
  const targetFirst = resolveReplayExactTradeStopPath(input([100, 102, 110, 95, 101]))
  const stopFirst = resolveReplayExactTradeStopPath(input([100, 102, 95, 110, 101]))
  expect(targetFirst.entry_trigger).toMatchObject({ aggregate_trade_id: 1001, reference_price: 102 })
  expect(targetFirst.terminal_trigger).toMatchObject({ role: "target", aggregate_trade_id: 1002, reference_price: 110 })
  expect(stopFirst.terminal_trigger).toMatchObject({ role: "stop", aggregate_trade_id: 1002, reference_price: 95 })
  expect(targetFirst.outcome).toBe("entry_triggered_then_protection_triggered")
  expect(targetFirst.limitations).toContain("not-fill-queue-slippage-or-market-impact-evidence")
})

test("protection becomes observable only after the aggregate trade that triggers entry", () => {
  const entryOvershoot = resolveReplayExactTradeStopPath(input([100, 111, 101]))
  expect(entryOvershoot.entry_trigger).toMatchObject({ reference_price: 111 })
  expect(entryOvershoot.terminal_trigger).toBeNull()
  expect(entryOvershoot.outcome).toBe("entry_triggered_position_open")

  const untriggered = resolveReplayExactTradeStopPath(input([100, 101, 99]))
  expect(untriggered).toMatchObject({ outcome: "untriggered", entry_trigger: null, terminal_trigger: null })
})

test("long/short price reflection preserves ordered Stop path semantics", () => {
  const long = resolveReplayExactTradeStopPath(input([100, 102, 110, 95]))
  const short = resolveReplayExactTradeStopPath(input([100, 98, 90, 105], "short"))
  expect(long.terminal_trigger?.role).toBe("target")
  expect(short.terminal_trigger?.role).toBe("target")
  expect(long.entry_trigger!.reference_price + short.entry_trigger!.reference_price).toBe(200)
  expect(long.terminal_trigger!.reference_price + short.terminal_trigger!.reference_price).toBe(200)
})

test("resolution rejects semantic tamper even when the attacker recomputes its hash", () => {
  const resolutionInput = input([100, 102, 110, 95])
  const resolution = resolveReplayExactTradeStopPath(resolutionInput)
  expect(() => assertReplayExactTradeStopResolution(resolution, resolutionInput)).not.toThrow()
  const tampered = structuredClone(resolution)
  if (!tampered.terminal_trigger) throw new Error("fixture requires terminal trigger")
  tampered.terminal_trigger.role = "stop"
  const { resolution_hash: _resolutionHash, ...body } = tampered
  tampered.resolution_hash = canonicalHash(body)
  expect(() => assertReplayExactTradeStopResolution(tampered, resolutionInput)).toThrow("ordered event evidence")
})
