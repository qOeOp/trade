import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { replayRegisteredStrategy } from "./strategy-replay"
import { evaluateRndSignal, runStrategyRndBatch, runStrategyRndLoop } from "./strategy-rnd"
import { runStrategyRndCampaignWithDeps } from "./strategy-rnd-campaign"
import { runStrategyPanelRnd } from "./strategy-panel-rnd"
import type { JSONRecord } from "./json"

test("replay result schema matches mechanical replay outer report", () => {
  const schema = readSchema("replay-result")
  assert.equal(schema.$id, "trade-flow.replay-result.v1")
  assert.deepEqual(asArray(schema.required), ["strategy_id", "symbol", "timeframe", "sample_count", "win_rate", "avg_r", "total_r", "max_drawdown_r", "profit_factor", "expectancy_r", "gate", "trades", "assumptions", "provenance", "notes"])
  const dir = mkdtempSync(join(tmpdir(), "replay-schema-"))
  try {
    const result = replayRegisteredStrategy({ manifestPath: writeManifest(dir), strategyId: "S-BTC-4H-TREND-PULLBACK" }) as unknown as JSONRecord
    assertSchemaRequired(schema, result)
    assert.equal(result.strategy_id, "S-BTC-4H-TREND-PULLBACK")
    assert.equal(result.symbol, "BTCUSDT")
    assert.equal(asRecord(result.gate).live_small_candidate, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy R&D batch loop campaign panel and signal schemas match shallow research reports", () => {
  const batchSchema = readSchema("strategy-rnd-batch-result")
  const loopSchema = readSchema("strategy-rnd-loop-result")
  const campaignSchema = readSchema("strategy-rnd-campaign-result")
  const panelSchema = readSchema("strategy-panel-rnd-result")
  const signalSchema = readSchema("strategy-signal-result")
  assert.equal(batchSchema.$id, "trade-flow.strategy-rnd-batch-result.v1")
  assert.equal(loopSchema.$id, "trade-flow.strategy-rnd-loop-result.v1")
  assert.equal(campaignSchema.$id, "trade-flow.strategy-rnd-campaign-result.v1")
  assert.equal(panelSchema.$id, "trade-flow.strategy-panel-rnd-result.v1")
  assert.equal(signalSchema.$id, "trade-flow.strategy-signal-result.v1")

    const dir = mkdtempSync(join(tmpdir(), "research-schema-"))
  try {
    const manifestPath = writeManifest(dir)
    const validationManifestPath = writeManifest(dir, "validation", 400)
    const candidate = {
      candidateId: "C-SCHEMA-LONG",
      params: { side: "long" },
    }
    const batch = runStrategyRndBatch({
      batchId: "rnd-schema-batch",
      manifestPath,
      candidates: [candidate],
    }) as unknown as JSONRecord
    assertSchemaRequired(batchSchema, batch)
    assert.equal(batch.batch_id, "rnd-schema-batch")
    assert.equal(batch.trial_count, 1)
    assert.ok(["candidate_found", "no_promote"].includes(String(batch.outcome)))

    const loop = runStrategyRndLoop({
      runId: "rnd-schema-loop",
      batchId: "rnd-schema-loop",
      manifestPath,
      artifactRoot: join(dir, "artifacts"),
      ledgerPath: join(dir, "strategy-rnd-ledger.jsonl"),
      candidates: [candidate],
      now: "2026-07-08T12:00:00Z",
    }) as unknown as JSONRecord
    assertSchemaRequired(loopSchema, loop)
    assert.equal(loop.run_id, "rnd-schema-loop")
    assert.equal(asRecord(loop.batch).batch_id, "rnd-schema-loop")

    const campaign = runStrategyRndCampaignWithDeps({
      campaignId: "rnd-schema-campaign",
      maxTotalTrials: 1,
      ledgerPath: join(dir, "campaign-ledger.jsonl"),
      artifactRoot: join(dir, "campaign-artifacts"),
      hypotheses: [{
        hypothesisId: "h1",
        thesisCertificate: thesisCertificate(),
        manifestPath,
        validationManifestPath,
        candidates: [candidate],
      }],
      now: "2026-07-08T12:00:00Z",
    }, {
      resolveCandidateCount: () => 1,
      runLoop: (input) => ({
        artifact_ref: join(dir, `${input.runId}.json`),
        batch: {
          outcome: "no_promote",
          trial_count: 1,
          winner: null,
        },
      }),
    }) as unknown as JSONRecord
    assertSchemaRequired(campaignSchema, campaign)
    assert.equal(campaign.campaign_id, "rnd-schema-campaign")
    assert.equal(campaign.trial_budget, 1)

    const panel = runStrategyPanelRnd({
      panelId: "panel-schema",
      datasets: ["BTC", "ETH", "SOL"].map((datasetId) => ({ datasetId, manifestPath })),
      candidates: [candidate],
    }) as JSONRecord
    assertSchemaRequired(panelSchema, panel)
    assert.equal(panel.panel_id, "panel-schema")
    assert.equal(panel.dataset_count, 3)

    const signal = evaluateRndSignal({
      manifestPath,
      entryPrice: 120,
      now: new Date(1_700_000_000_000 + 280 * 4 * 60 * 60 * 1000).toISOString(),
      candidate,
    }) as JSONRecord
    assertSchemaRequired(signalSchema, signal)
    assert.equal(signal.candidate_id, "C-SCHEMA-LONG")
    assert.ok(["entry", "no_action"].includes(String(signal.action)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeManifest(dir: string, stem = "4h", startIndex = 0): string {
  let close = 100
  const rows = Array.from({ length: 280 }, (_, index) => {
    const open = close
    close += 0.25 + (index > 220 && index % 8 === 0 ? -3 : 0)
    const timestamp = 1_700_000_000_000 + (startIndex + index) * 14_400_000
    return [new Date(timestamp).toISOString(), timestamp, open.toFixed(4), (Math.max(open, close) + 0.5).toFixed(4), (Math.min(open, close) - 0.5).toFixed(4), close.toFixed(4), 1000 + index].join(",")
  })
  const file = `${stem}.csv`
  writeFileSync(join(dir, file), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const path = join(dir, `${stem}-manifest.json`)
  writeFileSync(path, JSON.stringify({
    schema_version: 2,
    symbol: "BTCUSDT",
    closed_candles_only: true,
    checksum_verified: true,
    timeframes: {
      "4h": {
        file,
      },
    },
  }))
  return path
}

function thesisCertificate() {
  return {
    edgeType: "structural trend continuation",
    behavioralHypothesis: "late momentum buyers defend pullbacks after trend confirmation",
    marketParticipants: "trend followers and trapped countertrend liquidity",
    regime: "liquid perpetual markets with persistent directional drift",
    invalidation: "fails when pullbacks no longer hold above trend support",
    costSensitivity: "edge must survive fee, slippage, and funding stress",
    candidateUniverse: "trend pullback family with fixed long side parameters",
    negativeControls: ["side_flip", "entry_lag"],
  }
}

function readSchema(name: string): JSONRecord {
  return JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), "utf8")) as JSONRecord
}

function assertSchemaRequired(schema: JSONRecord, value: JSONRecord): void {
  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in value, `missing required field ${String(field)}`)
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
