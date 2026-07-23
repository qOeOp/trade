import {
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  createReplayInstrumentStatusProviderCertificationSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
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
} from "../../../../contracts/src/lib/replay-contracts"

export const HASH = "a".repeat(64)
export const ACCOUNTING = {
  spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  product_type: "linear_derivative" as const,
  base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1",
  price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001",
}
export const MAINTENANCE_TIER = {
  tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH,
  notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0,
}
export const RISK_SNAPSHOT = {
  schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1,
  maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50,
}
export const SPEC_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:spec-1", source_hash: HASH,
}
export const STATUS_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const,
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:status-1", source_hash: HASH,
}
export const PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-r4-152",
  certification_ref: "certification://fixture-status-provider/v1",
  status: "certified",
  certified_at: "2026-07-13T00:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "rd-status-provider-certification-v1",
  provider_capability_hash: HASH,
  producer_domain: "market-data-products",
  producer_id: "fixture-status-producer",
  producer_version: "v1",
  producer_build_hash: HASH,
  normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH,
  allowed_source_kind: "venue_status_event_archive",
  allowed_completeness: "complete_history",
})
export const STATUS_PROVENANCE = createReplayInstrumentStatusProvenance({
  producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1",
  producer_build_hash: HASH, source_owner: "binance-usdm", provider_capability_hash: HASH,
  provider_certification_ref: PROVIDER_CERTIFICATION.certification_ref,
  provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
  source_kind: "venue_status_event_archive", normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH, completeness: "complete_history", coverage_start: "2020-01-01T00:00:00Z",
  coverage_end: "2030-01-01T00:00:00Z", source_observed_through: "2026-07-13T00:00:00Z",
  produced_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-source", source_hash: HASH,
  source_record_count: 1, status_epochs: [STATUS_SNAPSHOT],
})

export const GOLDEN_REPLAY_BARS: ReplayMarketBar[] = [
  { open_time: "2026-07-14T00:00:00.000Z", close_time: "2026-07-14T04:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
  { open_time: "2026-07-14T04:00:00.000Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
  { open_time: "2026-07-14T08:00:00.000Z", close_time: "2026-07-14T12:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
]
export const GOLDEN_REPLAY_DATASET_HASH = replayDatasetHash(GOLDEN_REPLAY_BARS)

export function goldenReplayDatasetManifest(): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-r4-152",
    manifest_ref: "dataset://fixture",
    data_hash: GOLDEN_REPLAY_DATASET_HASH,
    dataset_kind: "ohlcv",
    symbol: "BTCUSDT",
    timeframe: "4h",
    interval_ms: 14_400_000,
    row_count: GOLDEN_REPLAY_BARS.length,
    first_open_time: GOLDEN_REPLAY_BARS[0]!.open_time,
    last_close_time: GOLDEN_REPLAY_BARS.at(-1)!.close_time,
    observed_through: GOLDEN_REPLAY_BARS.at(-1)!.close_time,
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
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z",
      trading_enabled_at: "2020-01-01T00:00:00Z",
      delisted_at: null,
      status_history: "complete",
      status_epochs: [STATUS_SNAPSHOT],
      status_provenance: STATUS_PROVENANCE,
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}


