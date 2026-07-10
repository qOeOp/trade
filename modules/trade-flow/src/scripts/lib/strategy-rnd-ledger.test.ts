import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import {
  appendJsonLine,
  assertHoldoutUnused,
  assertRunIdUnused,
  buildRndLedgerRecord,
  holdoutKeyForInput,
  loadRndLedger,
  redactLoopInputForArtifact,
  safeFileName,
  summarizeRejectedReasons,
  writeJsonFile,
  type StrategyRndLedgerBatchView,
} from "./strategy-rnd-ledger"

test("strategy R&D ledger summarizes rejected reasons deterministically", () => {
  const summary = summarizeRejectedReasons(batchView())
  assert.deepEqual(summary, [
    { check_id: "low_oos_r", count: 2 },
    { check_id: "weak_pf", count: 1 },
  ])
})

test("strategy R&D ledger record includes locked holdout key", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-ledger-record-"))
  try {
    const input = {
      manifestPath: writeManifest(dir),
      timeframe: "4h",
      antiOverfitStage: "locked_holdout" as const,
      candidates: [{ candidateId: "C-1" }],
    }
    const record = buildRndLedgerRecord({
      input,
      runId: "run-1",
      created_at: "2026-07-08T12:00:00Z",
      artifactRef: "/tmp/run-1.json",
      batch: batchView(),
    })

    assert.equal(record.run_id, "run-1")
    assert.equal(record.stage, "locked_holdout")
    assert.equal(record.holdout_key, holdoutKeyForInput(input))
    assert.equal(record.rejected_reasons[0].check_id, "low_oos_r")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D ledger holdout key includes benchmark supplemental data", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-ledger-supplemental-"))
  try {
    const manifestPath = writeManifest(dir)
    const benchmarkManifestPath = writeManifest(join(dir, "benchmark"))
    const base = {
      manifestPath,
      timeframe: "4h",
      antiOverfitStage: "locked_holdout" as const,
      candidates: [{ candidateId: "C-1", params: { side: "short" } }],
    }
    const withBenchmark = {
      ...base,
      candidates: [{ candidateId: "C-1", params: { side: "short", benchmark_manifest_path: benchmarkManifestPath } }],
    }

    assert.notEqual(holdoutKeyForInput(base), holdoutKeyForInput(withBenchmark))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D ledger enforces run id and holdout idempotence", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-ledger-"))
  try {
    const ledgerPath = join(dir, "ledger.jsonl")
    const manifestPath = writeManifest(dir)
    const record = buildRndLedgerRecord({
      input: {
        manifestPath,
        antiOverfitStage: "locked_holdout",
        candidates: [{ candidateId: "C-1" }],
      },
      runId: "run-1",
      created_at: "2026-07-08T12:00:00Z",
      artifactRef: "/tmp/run-1.json",
      batch: batchView(),
    })
    appendJsonLine(ledgerPath, record)

    assert.equal(loadRndLedger(ledgerPath).length, 1)
    assert.throws(() => assertRunIdUnused(ledgerPath, "run-1"), /run_id already exists/)
    assert.throws(() => assertHoldoutUnused(ledgerPath, record.holdout_key || ""), /locked holdout/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D ledger writes artifacts and redacts loop input", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-rnd-artifact-"))
  try {
    const artifactPath = join(dir, `${safeFileName("run:1/unsafe")}.json`)
    writeJsonFile(artifactPath, {
      input: redactLoopInputForArtifact({
        manifestPath: "/tmp/manifest.json",
        indicatorReportPath: "/tmp/indicator.json",
        factorCompose: true,
        factorSeeds: [{
          factorId: "rsi",
          role: "filter",
          transform: "zscore",
          lookback: 20,
          op: "gt",
          value: 1,
        }],
        candidates: [{ candidateId: "C-1" }],
        ledgerPath: "/tmp/secret-ledger.jsonl",
        artifactRoot: "/tmp/secret-artifacts",
      }),
    })
    const written = JSON.parse(readFileSync(artifactPath, "utf8")) as { input: Record<string, unknown> }
    assert.equal(written.input.ledgerPath, undefined)
    assert.equal(written.input.artifactRoot, undefined)
    assert.equal(written.input.ledger_path, undefined)
    assert.equal(written.input.artifact_root, undefined)
    assert.equal(Array.isArray(written.input.factor_seeds), true)
    assert.equal((written.input.candidates as Array<Record<string, unknown>>)[0].candidate_id, "C-1")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function batchView(): StrategyRndLedgerBatchView {
  return {
    batch_id: "batch-1",
    hypothesis: "test hypothesis",
    candidate_source: "provided",
    outcome: "no_promote",
    trial_count: 3,
    accepted_count: 0,
    winner: null,
    candidates: [{
      gate: {
        accepted: false,
        blocked_by: [
          { check_id: "low_oos_r", reason: "low oos R" },
          { check_id: "weak_pf", reason: "weak profit factor" },
        ],
      },
    }, {
      gate: {
        accepted: false,
        blocked_by: [
          { check_id: "low_oos_r", reason: "low oos R" },
        ],
      },
    }],
  }
}

function writeManifest(dir: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "4h.csv"), [
    "timestamp,open_time,open,high,low,close,volume",
    "2026-07-08T00:00:00Z,1783468800000,100,101,99,100.5,1000",
    "2026-07-08T04:00:00Z,1783483200000,100.5,102,100,101,1000",
  ].join("\n"))
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 1,
    symbol: "BTCUSDT",
    exchange: "binance-usdm",
    closed_candles_only: true,
    columns: ["timestamp", "open_time", "open", "high", "low", "close", "volume"],
    source: {
      provider: "fixture",
      market: "usdm",
    },
    timeframes: {
      "4h": {
        file: "4h.csv",
      },
    },
  }))
  return manifestPath
}
