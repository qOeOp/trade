import { loadCandlesFromManifest, loadManifest } from "./replay-core"
import { panelFundingEvents } from "../../../benchmark-engine/src/lib/strategy-benchmark-data"
import { strategyBenchmarkInputFromJson, type BenchmarkDataset } from "../../../benchmark-engine/src/lib/strategy-benchmark-inputs"
import type { JSONRecord } from "./json"

interface FundingCarryGovernanceInput {
  governanceId?: string
  datasets: BenchmarkDataset[]
  timeframe?: string
}

function runFundingCarryGovernance(input: FundingCarryGovernanceInput): JSONRecord {
  if (input.datasets.length === 0) throw new Error("funding carry governance requires at least one dataset")
  const timeframe = input.timeframe || "4h"
  const loaded = input.datasets.map((dataset) => {
    const manifest = loadManifest(dataset.manifestPath)
    const candles = loadCandlesFromManifest(dataset.manifestPath, manifest, timeframe)
    if (candles.length === 0) throw new Error(`dataset ${dataset.datasetId} has no candles for ${timeframe}`)
    return { dataset, manifest, candles }
  })
  const firstTimestamp = Math.min(...loaded.map((item) => item.candles[0]!.timestamp))
  const lastTimestamp = Math.max(...loaded.map((item) => item.candles.at(-1)!.timestamp))
  const funding = panelFundingEvents(input.datasets, firstTimestamp, lastTimestamp)
  const status = funding.coverage.status === "full" ? "ready_for_research" : "blocked"
  return {
    schema_version: "trade-flow.funding-carry-governance.v1",
    governance_id: input.governanceId || "funding-carry-governance",
    family_id: "funding_carry_v1",
    status,
    trial_permission: status === "ready_for_research",
    timeframe,
    replay_interval: {
      first_open: new Date(firstTimestamp).toISOString(),
      last_open: new Date(lastTimestamp).toISOString(),
    },
    funding_event_coverage: funding.coverage,
    datasets: loaded.map((item, index) => ({
      dataset_id: item.dataset.datasetId,
      symbol: stringField(item.manifest.symbol) || stringField(item.manifest.requested_symbol) || item.dataset.datasetId,
      manifest_path: item.dataset.manifestPath,
      indicator_report_path: item.dataset.indicatorReportPath || null,
      candle_rows: item.candles.length,
      funding_event_count: funding.eventsByAsset[index]?.length || 0,
      first_open: new Date(item.candles[0]!.timestamp).toISOString(),
      last_open: new Date(item.candles.at(-1)!.timestamp).toISOString(),
    })),
    required_data_contract: [
      "funding_event_timestamp",
      "availability_at_or_exchange_event_time",
      "funding_rate_value",
      "symbol",
      "coverage_gap_hours",
      "indicator_report_checksum_or_catalog_ref",
    ],
    blocked_by: status === "ready_for_research" ? [] : [{
      check_id: "FUNDING-COVERAGE",
      reason: `funding coverage is ${funding.coverage.status}; full coverage with max gap <= 9h is required before funding_carry_v1 trials`,
    }],
    next_system_actions: status === "ready_for_research"
      ? ["Run funding_carry_v1 research only with explicit funding cashflow and funding time-shift negative control."]
      : ["Run ohlcv-fetch calibration-market-features for this panel and rerun funding carry governance before spending strategy trials."],
  }
}

function fundingCarryGovernanceInputFromJson(value: JSONRecord): FundingCarryGovernanceInput {
  const parsed = strategyBenchmarkInputFromJson(value)
  return {
    governanceId: stringField(value.governance_id) || undefined,
    timeframe: parsed.timeframe,
    datasets: parsed.datasets,
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  fundingCarryGovernanceInputFromJson,
  runFundingCarryGovernance,
  type FundingCarryGovernanceInput,
}
