import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { writeFundingReport, writeRegimeManifest } from "../../../../benchmark/src/lib/strategy-benchmark-test-fixture"
import { run } from "./main"

type JSONRecord = Record<string, unknown>

test("calibration suite CLI runs without trade DB writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "calibration-suite-cli-"))
  try {
    const datasets = [0, 17, 41].map((offset, index) => ({
      dataset_id: ["BTC", "ETH", "SOL"][index],
      manifest_path: writeRegimeManifest(dir, index, offset),
      indicator_report_path: writeFundingReport(dir, index, -0.00001 + index * 0.00001),
    }))
    const dbPath = join(dir, "trade.db")
    const result = run(["--json", JSON.stringify({
      datasets,
      fee_bps: 1,
      slippage_bps: 0,
      funding_bps_per_8h: 0,
      random_trials: 20,
    })])

    assert.equal(result.ok, true)
    assert.equal(result.schema_version, "calibration-suite.script-response.v1")
    assert.equal(existsSync(dbPath), false)
    const data = asRecord(result.data)
    assert.equal(data.purpose, "rd_pipeline_calibration_only")
    assert.match(String(data.report_hash), /^[a-f0-9]{64}$/)
    assertSchemaRequired(readSchema(), data)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("calibration suite CLI rejects invalid payloads", () => {
  const result = run(["--json", JSON.stringify({ datasets: [] })])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /at least three datasets/)
})

test("benchmark mode preserves the fixed benchmark envelope and schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "calibration-benchmark-cli-"))
  try {
    const datasets = [0, 17, 41].map((offset, index) => ({
      dataset_id: ["BTC", "ETH", "SOL"][index],
      manifest_path: writeRegimeManifest(dir, index, offset),
    }))
    const result = run(["--benchmark", "--json", JSON.stringify({
      datasets,
      horizon_bars: [12, 24, 48],
      volatility_bars: 12,
      rebalance_bars: 3,
      fee_bps: 1,
      slippage_bps: 0,
      funding_bps_per_8h: 0,
      random_trials: 20,
    })])
    assert.equal(result.ok, true)
    assert.equal(result.schema_version, "benchmark-runner.script-response.v1")
    const data = asRecord(result.data)
    assert.equal(data.purpose, "rd_pipeline_calibration_only")
    assertSchemaRequired(readBenchmarkSchema(), data)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function readSchema(): JSONRecord {
  const schema = JSON.parse(readFileSync(new URL("../schemas/strategy-calibration-result.schema.json", import.meta.url), "utf8")) as JSONRecord
  assert.equal(schema.$id, "trade-flow.strategy-calibration-result.v1")
  assert.deepEqual(asArray(schema.required), ["calibration_suite_id", "purpose", "harness_hash", "report_hash", "previous_run_comparison", "calibrated", "blocked_by", "data_panel", "components", "diagnostics", "failure_analysis", "notes"])
  return schema
}

function readBenchmarkSchema(): JSONRecord {
  const schema = JSON.parse(readFileSync(new URL("../schemas/strategy-benchmark-result.schema.json", import.meta.url), "utf8")) as JSONRecord
  assert.equal(schema.$id, "trade-flow.strategy-benchmark-result.v1")
  assert.deepEqual(asArray(schema.required), ["benchmark_id", "harness_hash", "purpose", "calibrated", "blocked_by", "datasets", "period", "assumptions", "observed", "execution_attribution", "chronological_folds", "regime_attribution", "cost_stress", "cost_stress_attribution", "funding_stress", "funding_stress_attribution", "funding_event_coverage", "historical_funding", "historical_funding_attribution", "negative_control"])
  return schema
}

function assertSchemaRequired(schema: JSONRecord, value: JSONRecord): void {
  for (const field of asArray(schema.required)) {
    assert.ok(Object.prototype.hasOwnProperty.call(value, String(field)), `missing ${String(field)}`)
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
