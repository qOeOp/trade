import { createHash } from "node:crypto"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { expect, test } from "bun:test"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  createReplayInstrumentStatusProvenance,
  replayDatasetHash,
  type ReplayDatasetManifest,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import {
  FORMAL_REPLAY_DATA_BUNDLE_COMPILE_REQUEST_SCHEMA,
  FORMAL_REPLAY_DATA_BUNDLE_SCHEMA,
  compileFormalReplayDataBundle,
} from "./formal-replay-data-bundle"

const HASH = "a".repeat(64)
const CSV = [
  "date,timestamp,open,high,low,close,volume",
  "2026-07-14T00:00:00.000Z,1783987200000,100,105,95,101,1",
  "2026-07-14T04:00:00.000Z,1784001600000,101,106,96,102,2",
  "",
].join("\n")
const BARS: ReplayMarketBar[] = [
  {
    open_time: "2026-07-14T00:00:00.000Z",
    close_time: "2026-07-14T04:00:00.000Z",
    open: 100,
    high: 105,
    low: 95,
    close: 101,
    volume: 1,
    closed: true,
  },
  {
    open_time: "2026-07-14T04:00:00.000Z",
    close_time: "2026-07-14T08:00:00.000Z",
    open: 101,
    high: 106,
    low: 96,
    close: 102,
    volume: 2,
    closed: true,
  },
]

test("formal Replay bundle compiler binds exact split bytes to the registered manifest", () => {
  const root = `tmp/formal-replay-bundle-${process.pid}-${Date.now()}`
  const sourceRef = `${root}/4h.csv`
  const outputRef = `${root}/bundle.json`
  mkdirSync(resolveRepoPath(root), { recursive: true })
  writeFileSync(resolveRepoPath(sourceRef), CSV)
  const request = {
    schema_version: FORMAL_REPLAY_DATA_BUNDLE_COMPILE_REQUEST_SCHEMA,
    dataset_manifest: manifest(),
    ohlcv_source: {
      ref: sourceRef,
      sha256: sha256(Buffer.from(CSV)),
    },
    funding_events_source: null,
    mark_events_source: null,
    supplemental_facts_source: null,
    output_ref: outputRef,
  }
  try {
    const first = compileFormalReplayDataBundle(request)
    expect(first.recovered).toBe(false)
    expect(first.row_count).toBe(2)
    expect(first.trading_authority).toBe(false)
    expect(first.bundle_sha256)
      .toBe(sha256(readFileSync(resolveRepoPath(outputRef))))
    const body = JSON.parse(readFileSync(resolveRepoPath(outputRef), "utf8"))
    expect(body.schema_version).toBe(FORMAL_REPLAY_DATA_BUNDLE_SCHEMA)
    expect(body.bars).toEqual(BARS)
    expect(body.dataset_manifest_hash).toBe(canonicalHash(manifest()))

    const recovered = compileFormalReplayDataBundle(request)
    expect(recovered).toEqual({ ...first, recovered: true })
    const linkRef = `${root}/linked.csv`
    symlinkSync(resolveRepoPath(sourceRef), resolveRepoPath(linkRef))
    expect(() => compileFormalReplayDataBundle({
      ...request,
      ohlcv_source: {
        ref: linkRef,
        sha256: sha256(Buffer.from(CSV)),
      },
      output_ref: `${root}/linked-bundle.json`,
    })).toThrow("non-symlink")
    writeFileSync(resolveRepoPath(sourceRef), CSV.replace(",102,2", ",103,2"))
    expect(() => compileFormalReplayDataBundle(request)).toThrow(
      "OHLCV source content drifted",
    )
  } finally {
    rmSync(resolveRepoPath(root), { recursive: true, force: true })
  }
})

test("formal Replay bundle compiler rejects manifest/data identity drift", () => {
  const root = `tmp/formal-replay-bundle-drift-${process.pid}-${Date.now()}`
  const sourceRef = `${root}/4h.csv`
  mkdirSync(resolveRepoPath(root), { recursive: true })
  writeFileSync(resolveRepoPath(sourceRef), CSV)
  try {
    expect(() => compileFormalReplayDataBundle({
      schema_version: FORMAL_REPLAY_DATA_BUNDLE_COMPILE_REQUEST_SCHEMA,
      dataset_manifest: { ...manifest(), data_hash: "b".repeat(64) },
      ohlcv_source: {
        ref: sourceRef,
        sha256: sha256(Buffer.from(CSV)),
      },
      funding_events_source: null,
      mark_events_source: null,
      supplemental_facts_source: null,
      output_ref: `${root}/bundle.json`,
    })).toThrow("data facts drifted")
  } finally {
    rmSync(resolveRepoPath(root), { recursive: true, force: true })
  }
})

function manifest(): ReplayDatasetManifest {
  const maintenanceTier = {
    tier_id: "tier-1",
    snapshot_ref: "fixture:margin-tier-1",
    snapshot_hash: HASH,
    notional_floor: 0,
    notional_cap: 50_000,
    maintenance_margin_rate: 0.005,
    maintenance_amount: 0,
  }
  const risk = {
    schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
    snapshot_id: "risk-1",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    effective_at: "2020-01-01T00:00:00.000Z",
    valid_until: null,
    observed_at: "2026-07-13T00:00:00.000Z",
    source_ref: "fixture:risk-1",
    source_hash: HASH,
    initial_margin_rate: 0.1,
    maintenance_tier: maintenanceTier,
    liquidation_fee_bps: 50,
  }
  const spec = {
    schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "spec-1",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    effective_at: "2020-01-01T00:00:00.000Z",
    valid_until: null,
    observed_at: "2026-07-13T00:00:00.000Z",
    source_ref: "fixture:spec-1",
    source_hash: HASH,
  }
  const status = {
    schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "status-1",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    status: "trading" as const,
    effective_at: "2020-01-01T00:00:00.000Z",
    valid_until: null,
    observed_at: "2026-07-13T00:00:00.000Z",
    source_ref: "fixture:status-1",
    source_hash: HASH,
  }
  const provenance = createReplayInstrumentStatusProvenance({
    producer_domain: "market-data-products",
    producer_id: "fixture-status-producer",
    producer_version: "v1",
    producer_build_hash: HASH,
    provider_capability_hash: HASH,
    provider_certification_ref: "certification://fixture-status-provider/v1",
    provider_certification_hash: HASH,
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    normalization_policy_version: "fixture-status-normalization-v1",
    normalization_policy_hash: HASH,
    completeness: "complete_history",
    coverage_start: "2020-01-01T00:00:00.000Z",
    coverage_end: "2030-01-01T00:00:00.000Z",
    source_observed_through: "2026-07-13T00:00:00.000Z",
    produced_at: "2026-07-13T00:00:00.000Z",
    source_ref: "fixture:status-source",
    source_hash: HASH,
    source_record_count: 1,
    status_epochs: [status],
  })
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1",
    manifest_ref: "dataset://fixture",
    data_hash: replayDatasetHash(BARS),
    dataset_kind: "ohlcv",
    symbol: "BTCUSDT",
    timeframe: "4h",
    interval_ms: 14_400_000,
    row_count: BARS.length,
    first_open_time: BARS[0]!.open_time,
    last_close_time: BARS.at(-1)!.close_time,
    observed_through: BARS.at(-1)!.close_time,
    closed_candles_only: true,
    bar_final_availability: "close_time",
    funding_availability: "event_time",
    mark_availability: "event_time",
    mark_coverage: "none",
    mark_interval_ms: null,
    mark_event_count: 0,
    supplemental_facts: {
      coverage: "none",
      record_count: 0,
      source_ids: [],
      content_hash: canonicalHash([]),
      requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    },
    venue_risk_policy_epochs: [risk],
    instrument: {
      listed_at: "2020-01-01T00:00:00.000Z",
      trading_enabled_at: "2020-01-01T00:00:00.000Z",
      delisted_at: null,
      status_history: "complete",
      status_epochs: [status],
      status_provenance: provenance,
      spec_epochs: [spec],
      accounting: {
        spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
        product_type: "linear_derivative",
        base_asset: "BTC",
        quote_asset: "USDT",
        settlement_asset: "USDT",
        contract_multiplier: "1",
        price_increment: "0.01",
        quantity_increment: "0.001",
        settlement_increment: "0.00000001",
      },
    },
    universe: {
      selected_at: "2026-07-13T00:00:00.000Z",
      survivorship: "point_in_time",
    },
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
