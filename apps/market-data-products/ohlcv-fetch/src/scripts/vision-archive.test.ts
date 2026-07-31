import assert from "node:assert/strict"
import test from "node:test"
import { aggregateMetrics, aggregateMicrostructure, utcDates } from "./vision-archive"

test("Vision metrics and microstructure aggregate causally into 4h buckets", () => {
  const metrics = aggregateMetrics([[
    "create_time,symbol,sum_open_interest,sum_open_interest_value,a,b,c,sum_taker_long_short_vol_ratio",
    "2024-01-01 00:00:00,BTCUSDT,1,100,0,0,0,1.2",
    "2024-01-01 03:55:00,BTCUSDT,1,120,0,0,0,0.8",
  ].join("\n")], "4h")
  assert.deepEqual(metrics.openInterest.map((item) => item.value), [120])
  assert.deepEqual(metrics.takerRatio.map((item) => item.value), [1])

  const micro = aggregateMicrostructure([
    "1,100,2,1,1,1704067200000,false\n2,100,1,2,2,1704067201000,true",
  ], [
    "timestamp,percentage,depth,notional\n2024-01-01 00:00:10,-1,1,1000\n2024-01-01 00:00:10,1,1,1200",
  ], "4h")
  assert.equal(micro.takerImbalance[0].value, 1 / 3)
  assert.equal(micro.tradeConcentration[0].value, 2 / 3)
  assert.equal(micro.depth1PctNotional[0].value, 1100)
})

test("Vision date enumeration is UTC inclusive", () => {
  assert.deepEqual(utcDates(Date.parse("2024-01-01T12:00:00Z"), Date.parse("2024-01-03T00:00:00Z")), ["2024-01-01", "2024-01-02", "2024-01-03"])
})
