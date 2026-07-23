import { expect, test } from "bun:test"
import {
  shouldRenewForwardMarketDataDemand,
} from "./lib/rd-forward-observation-program"

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
