import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { run } from "../scripts/main"
import { fundingCarryGovernanceInputFromJson, runFundingCarryGovernance } from "./funding-carry-governance"
import { resolveRepoPath } from "../../../../../../contracts/runtime-core/src/paths"

test("funding carry governance allows research only with full funding coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "funding-carry-governance-"))
  try {
    const first = Date.UTC(2024, 0, 1)
    const last = first + 40 * 4 * 3_600_000
    const report = runFundingCarryGovernance({
      governanceId: "funding-full",
      timeframe: "4h",
      datasets: [{
        datasetId: "BTCUSDT",
        manifestPath: writeManifest(dir, "BTCUSDT", first, 40),
        indicatorReportPath: writeFundingReport(dir, "BTCUSDT", first, last, 0.0001),
      }],
    })

    assert.equal(report.schema_version, "trade-flow.funding-carry-governance.v1")
    assert.equal(report.status, "ready_for_research")
    assert.equal(report.trial_permission, true)
    assert.equal(asRecord(report.funding_event_coverage).status, "full")
    assert.equal(asArray(report.blocked_by).length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("funding carry governance blocks missing funding reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "funding-carry-governance-missing-"))
  try {
    const report = runFundingCarryGovernance({
      datasets: [{
        datasetId: "ETHUSDT",
        manifestPath: writeManifest(dir, "ETHUSDT", Date.UTC(2024, 0, 1), 40),
      }],
    })

    assert.equal(report.status, "blocked")
    assert.equal(report.trial_permission, false)
    assert.equal(asRecord(report.funding_event_coverage).status, "not_provided")
    assert.equal(asRecord(asArray(report.blocked_by)[0]).check_id, "FUNDING-COVERAGE")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("funding carry governance CLI stays read-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funding-carry-governance-cli-"))
  const runtimeDir = resolveRepoPath("tmp/funding-carry-governance-cli-test")
  try {
    rmSync(runtimeDir, { recursive: true, force: true })
    const dbPath = join(runtimeDir, "trade.db")
    const result = run(["--json", JSON.stringify({
      datasets: [{
        dataset_id: "BTCUSDT",
        manifest_path: writeManifest(dir, "BTCUSDT", Date.UTC(2024, 0, 1), 40),
      }],
    })])

    assert.equal(result.ok, true)
    assert.equal((result.data as { status: string }).status, "blocked")
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(runtimeDir, { recursive: true, force: true })
  }
})

test("funding carry governance parser uses benchmark dataset contract", () => {
  const input = fundingCarryGovernanceInputFromJson({
    governance_id: "funding-parser",
    timeframe: "4h",
    datasets: [{ dataset_id: "BTCUSDT", manifest_path: "/tmp/btc.json", indicator_report_path: "/tmp/funding.json" }],
  })
  assert.equal(input.governanceId, "funding-parser")
  assert.equal(input.timeframe, "4h")
  assert.equal(input.datasets[0].datasetId, "BTCUSDT")
  assert.equal(input.datasets[0].indicatorReportPath, "/tmp/funding.json")
})

function writeManifest(dir: string, symbol: string, first: number, rows: number): string {
  const root = join(dir, symbol.toLowerCase())
  mkdirSync(root, { recursive: true })
  const lines = Array.from({ length: rows }, (_, index) => {
    const timestamp = first + index * 4 * 3_600_000
    const open = 100 + index
    const close = open + 0.5
    return [new Date(timestamp).toISOString(), timestamp, open, close + 1, open - 1, close, 1000].join(",")
  })
  writeFileSync(join(root, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...lines].join("\n"))
  const path = join(root, "manifest.json")
  writeFileSync(path, JSON.stringify({
    schema_version: 2,
    symbol,
    closed_candles_only: true,
    timeframes: { "4h": { file: "4h.csv", content_sha256: "fixture" } },
  }))
  return path
}

function writeFundingReport(dir: string, symbol: string, first: number, last: number, value: number): string {
  const root = join(dir, symbol.toLowerCase())
  const events = []
  for (let timestamp = first; timestamp <= last; timestamp += 8 * 3_600_000) {
    events.push({ timestamp: new Date(timestamp).toISOString(), value })
  }
  const path = join(root, "market-features.json")
  writeFileSync(path, JSON.stringify({ data: { market_events: { funding: events } } }))
  return path
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
