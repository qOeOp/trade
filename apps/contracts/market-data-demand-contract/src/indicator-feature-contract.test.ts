import assert from "node:assert/strict"
import test from "node:test"
import {
  buildIndicatorFeatureArtifact,
  compileIndicatorFeatureArtifact,
  indicatorProviderArgs,
} from "./indicator-feature-contract"

test("indicator feature artifact removes provider time and path nondeterminism", () => {
  const first = buildIndicatorFeatureArtifact({
    feature_set_ref: "indicator-set:technical-default-v1",
    source: source(),
    provider_report: report("/host-a/manifest.json", "2026-07-23T00:00:00Z"),
  })
  const second = buildIndicatorFeatureArtifact({
    feature_set_ref: "indicator-set:technical-default-v1",
    source: source(),
    provider_report: report("/host-b/manifest.json", "2026-07-23T00:01:00Z"),
  })
  assert.equal(first.content_hash, second.content_hash)
  assert.equal(compileIndicatorFeatureArtifact(first).content_hash, first.content_hash)
  assert.equal(Object.hasOwn(first, "generated_at"), false)
  assert.deepEqual(indicatorProviderArgs("indicator-set:factor-series-default-v1"), [
    "--indicators", "all", "--feature-series",
  ])
})

test("indicator feature artifact rejects source and provider identity drift", () => {
  assert.throws(() => buildIndicatorFeatureArtifact({
    feature_set_ref: "indicator-set:unknown",
    source: source(),
    provider_report: report("manifest.json", "2026-07-23T00:00:00Z"),
  }), /unsupported/)
  assert.throws(() => buildIndicatorFeatureArtifact({
    feature_set_ref: "indicator-set:technical-default-v1",
    source: source(),
    provider_report: { ...report("manifest.json", "2026-07-23T00:00:00Z"), symbol: "ETHUSDT" },
  }), /symbol drifted/)
})

function source() {
  const hash = "a".repeat(64)
  return {
    slice_ref: `market-data://candle-slice/${hash}`,
    content_sha256: hash,
    symbol: "BTCUSDT",
    timeframe: "1h",
    first_open_time: 0,
    last_open_time: 3_600_000,
  }
}

function report(path: string, generatedAt: string) {
  return {
    symbol: "BTC/USDT:USDT",
    exchange: "binanceusdm",
    source_manifest: path,
    generated_at: generatedAt,
    selected_indicators: {
      ema: {
        category: "moving-average",
        defaults: { period: 20 },
        function: "ema",
      },
    },
    timeframes: { "1h": { trend: "up", features: { "ema.value": [{ timestamp: "x", value: 1 }] } } },
    summary: { bias: "bullish" },
    summary_markdown: `generated ${generatedAt}`,
  }
}
