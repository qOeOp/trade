import assert from "node:assert/strict"
import test from "node:test"
import {
  strategyBenchmarkInputFromJson,
  strategyCalibrationInputFromJson,
} from "../../../benchmark-engine/src/lib/strategy-benchmark-inputs"

test("strategy benchmark input parser keeps public benchmark definition fixed", () => {
  const input = strategyBenchmarkInputFromJson({
    benchmark_id: "bench-1",
    timeframe: "4h",
    horizon_bars: [12, 24],
    maker_fee_bps: 0.2,
    taker_fee_bps: 1,
    market_order_share: 0.5,
    funding_bps_per_8h: 0.1,
    datasets: [{
      dataset_id: "BTC",
      manifest_path: "/tmp/btc.json",
      indicator_report_path: "/tmp/funding.json",
      market_data_db: "data/market_data.duckdb",
      funding_events_ref: "funding:binanceusdm:BTCUSDT:4h:abc",
      feature_manifest_ref: "market-features:binanceusdm:BTCUSDT:4h:def",
      symbol_status: "delisted",
    }],
  })

  assert.equal(input.benchmarkId, "bench-1")
  assert.equal(input.timeframe, "4h")
  assert.equal(input.horizonBars, undefined)
  assert.equal(input.makerFeeBps, 0.2)
  assert.equal(input.takerFeeBps, 1)
  assert.equal(input.marketOrderShare, 0.5)
  assert.equal(input.fundingBpsPer8h, 0.1)
  assert.equal(input.datasets[0].datasetId, "BTC")
  assert.equal(input.datasets[0].indicatorReportPath, "/tmp/funding.json")
  assert.equal(input.datasets[0].marketDataDb, "data/market_data.duckdb")
  assert.equal(input.datasets[0].fundingEventsRef, "funding:binanceusdm:BTCUSDT:4h:abc")
  assert.equal(input.datasets[0].featureManifestRef, "market-features:binanceusdm:BTCUSDT:4h:def")
  assert.equal(input.datasets[0].symbolStatus, "delisted")
})

test("strategy benchmark input parser ignores camel-case aliases", () => {
  const input = strategyBenchmarkInputFromJson({
    benchmarkId: "bench-1",
    makerFeeBps: 0.2,
    datasets: [{ datasetId: "BTC", manifestPath: "/tmp/btc.json", indicatorReportPath: "/tmp/funding.json" }],
  })

  assert.equal(input.benchmarkId, undefined)
  assert.equal(input.makerFeeBps, undefined)
  assert.equal(input.datasets[0].datasetId, "")
  assert.equal(input.datasets[0].manifestPath, "")
  assert.equal(input.datasets[0].indicatorReportPath, undefined)
  assert.equal(input.datasets[0].marketDataDb, undefined)
  assert.equal(input.datasets[0].fundingEventsRef, undefined)
  assert.equal(input.datasets[0].featureManifestRef, undefined)
  assert.equal(input.datasets[0].symbolStatus, undefined)
})

test("strategy calibration input parser preserves calibration-only fields", () => {
  const input = strategyCalibrationInputFromJson({
    calibration_suite_id: "suite-1",
    previous_calibration_report_path: "/tmp/previous.json",
    datasets: [],
  })

  assert.equal(input.suiteId, "suite-1")
  assert.equal(input.previousCalibrationReportPath, "/tmp/previous.json")
})
