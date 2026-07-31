import { expect, test } from "bun:test"
import { fundingEventRangeSum, trailingFundingAverage } from "./funding-events"

const events = [
  { timestamp: new Date(100).toISOString(), value: 0.001 },
  { timestamp: new Date(200).toISOString(), value: -0.0004 },
  { timestamp: new Date(300).toISOString(), value: 0.0002 },
]

test("funding windows use an exclusive start and inclusive end", () => {
  expect(fundingEventRangeSum(events, 100, 300)).toBeCloseTo(-0.0002)
  const trailing = trailingFundingAverage(events, 250, 2)
  expect(trailing?.average).toBeCloseTo(0.0003)
  expect(trailing?.count).toBe(2)
})
