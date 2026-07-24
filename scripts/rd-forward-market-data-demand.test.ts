import { expect, test } from "bun:test"
import {
  shouldRenewForwardMarketDataDemand,
} from "./lib/rd-forward-observation-program"
import {
  parseArgs,
} from "./rd-forward-market-data-demand-worker"

test("Forward market-data lease renewal waits until the bounded renewal window", () => {
  const observedAt = "2026-07-23T00:00:00.000Z"
  expect(shouldRenewForwardMarketDataDemand(undefined, observedAt)).toBe(true)
  expect(shouldRenewForwardMarketDataDemand(
    "2026-07-23T12:00:00.000Z",
    observedAt,
  )).toBe(false)
  expect(shouldRenewForwardMarketDataDemand(
    "2026-07-23T06:00:00.000Z",
    observedAt,
  )).toBe(true)
})

test("Forward market-data worker keeps funding capacity and bounded smoke controls explicit", () => {
  const parsed = parseArgs([
    "--max-symbols", "12",
    "--max-cycles", "1",
  ])
  expect(parsed.max_symbols).toBe(12)
  expect(parsed.max_cycles).toBe(1)
  expect(() => parseArgs(["--max-symbols", "0"])).toThrow()
})
