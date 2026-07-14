import { Database } from "bun:sqlite"
import {
  linkUniverseDataSurface,
  seedUniverse,
  upsertDataSurface,
  upsertPipelineRegistryItem,
  upsertUniverseCoverage,
  type DataSurfaceWrite,
  type PipelineRegistryItemWrite,
  type UniverseSeed,
} from "./research-control-plane-operations"

const EDGE_MAP = [
  ["Trend", "return_driver", "Time-Series Trend / Breakout Continuation / Cross-Sectional Momentum / Trend Pullback / Trend Exhaustion"],
  ["Mean Reversion", "return_driver", "Price Dislocation Reversion / Reference-Price Reversion / Cross-Sectional Reversion / Spread Reversion / Post-Shock Reversion"],
  ["Carry", "risk_premium", "Funding Carry / Basis Arbitrage / Calendar Spread / Lending Carry / Staking Yield"],
  ["Relative Value", "return_driver", "Pair Trading / Cointegration Spread / Basket Spread / ETF or Index Arbitrage / Residual Spread Reversion"],
  ["Volatility", "risk_premium", "Volatility Risk Premium / Convexity / Volatility Term Structure / Volatility Relative Value / Dispersion / Volatility Regime Transition"],
  ["Value", "risk_premium", "Network Valuation / Revenue Multiple / TVL Valuation / FDV or MC"],
  ["Quality", "risk_premium", "Protocol Revenue / Treasury Quality / Developer Activity / Tokenomics Quality"],
  ["Size", "risk_premium", "Small-Cap Premium / Liquidity Premium / Market-Cap Rotation"],
  ["Sentiment", "structural_edge", "News Reaction / Social Attention / Fear and Greed Regime / Search Trend / Exchange Flow"],
  ["Event", "structural_edge", "Listing / Unlock / Governance / ETF Flow / Macro Event"],
  ["Seasonality", "structural_edge", "Hour-of-Day / Day-of-Week / Month-End / Expiry Effect / Funding Window"],
  ["Order Flow", "market_mechanism", "Aggressor Imbalance / Absorption / Flow Persistence / Flow Exhaustion / Price-Flow Divergence"],
  ["Liquidity", "structural_edge", "Liquidity Sweep / Liquidity Void / Depth Depletion / Depth Replenishment / Depth Imbalance"],
  ["Forced Flow", "structural_edge", "Liquidation Cascade / Short Squeeze / Long Squeeze / ADL Pressure"],
  ["Liquidity Provision", "market_mechanism", "Single-Venue Market Making / Cross-Venue Market Making / Inventory-Aware Market Making / Rebate-Oriented Liquidity Provision / Options Market Making"],
  ["DeFi Native", "market_domain", "MEV / Bridge Flow / Stablecoin Depeg / DEX-CEX Arbitrage / Liquidity Migration"],
] as const

const READY_FAMILIES = new Set([
  "trend/time-series-trend", "trend/breakout-continuation", "trend/cross-sectional-momentum",
  "trend/trend-pullback", "carry/funding-carry", "volatility/volatility-regime-transition",
])

const CANONICALS = [
  ["trend/time-series-trend", "time-series-momentum", "Time-Series Momentum"],
  ["trend/breakout-continuation", "channel-breakout", "Channel Breakout"],
  ["trend/cross-sectional-momentum", "relative-weakness-momentum", "Relative Weakness Momentum"],
  ["trend/trend-pullback", "trend-pullback", "Trend Pullback"],
  ["carry/funding-carry", "funding-carry", "Funding Carry"],
  ["carry/funding-carry", "crowded-funding-unwind", "Crowded Funding Unwind"],
  ["volatility/volatility-regime-transition", "volatility-compression-breakout", "Volatility Compression Breakout"],
] as const

export function buildDefaultUniverseSeed(now: string): UniverseSeed {
  const rootPath = "strategy-universe"
  const nodes: UniverseSeed["nodes"] = [{
    node_id: "universe:strategy-universe", level: 0, node_type: "universe",
    slug: rootPath, name: "Strategy Universe", path: rootPath,
    research_scope_status: "active", implementation_scope_status: "ready",
    created_at: now, updated_at: now,
  }]
  const axes: UniverseSeed["axes"] = []
  for (const [edgeName, axis, families] of EDGE_MAP) {
    const edgeSlug = slug(edgeName)
    const edgeId = `edge:${edgeSlug}`
    const activeEdge = ["trend", "mean-reversion", "carry", "volatility"].includes(edgeSlug)
    nodes.push({
      node_id: edgeId, parent_node_id: "universe:strategy-universe", level: 1, node_type: "edge",
      slug: edgeSlug, name: edgeName, path: `${rootPath}/${edgeSlug}`,
      research_scope_status: activeEdge ? "active" : "catalog_only",
      implementation_scope_status: activeEdge
        ? (["trend", "carry", "volatility"].includes(edgeSlug) ? "ready" : "tool_blocked")
        : "product_out_of_scope",
      created_at: now, updated_at: now,
    })
    axes.push({ node_id: edgeId, axis, is_primary: true, created_at: now })
    for (const familyName of families.split(" / ")) {
      const familySlug = slug(familyName)
      const relativePath = `${edgeSlug}/${familySlug}`
      const ready = READY_FAMILIES.has(relativePath)
      const familyId = `family:${relativePath}`
      nodes.push({
        node_id: familyId, parent_node_id: edgeId, level: 2, node_type: "mechanism_family",
        slug: familySlug, name: familyName, path: `${rootPath}/${relativePath}`,
        research_scope_status: ready ? "active" : "catalog_only",
        implementation_scope_status: ready ? "ready" : activeEdge ? "tool_blocked" : "product_out_of_scope",
        created_at: now, updated_at: now,
      })
      axes.push({ node_id: familyId, axis, is_primary: true, created_at: now })
    }
  }
  for (const [parentPath, canonicalSlug, name] of CANONICALS) {
    const edgeSlug = parentPath.split("/")[0]!
    const axis = EDGE_MAP.find(([edge]) => slug(edge) === edgeSlug)![1]
    const nodeId = `canonical:${parentPath}/${canonicalSlug}`
    nodes.push({
      node_id: nodeId, parent_node_id: `family:${parentPath}`, level: 3, node_type: "canonical_strategy",
      slug: canonicalSlug, name, path: `${rootPath}/${parentPath}/${canonicalSlug}`,
      research_scope_status: "active", implementation_scope_status: "ready",
      created_at: now, updated_at: now,
    })
    axes.push({ node_id: nodeId, axis, is_primary: true, created_at: now })
  }
  return { nodes, axes }
}

export function seedDefaultResearchControlPlane(db: Database, now: string): {
  nodes: number; data_surfaces: number; capabilities: number; coverage_records: number
} {
  const universe = buildDefaultUniverseSeed(now)
  seedUniverse(db, universe)
  const surfaces = buildDefaultDataSurfaceSeed(now)
  for (const surface of surfaces) upsertDataSurface(db, surface)
  const capabilities = buildDefaultCapabilitySeed(now)
  for (const capability of capabilities) upsertPipelineRegistryItem(db, capability)

  const links = [
    ["canonical:trend/time-series-trend/time-series-momentum", "ohlcv"],
    ["canonical:trend/breakout-continuation/channel-breakout", "ohlcv"],
    ["canonical:trend/cross-sectional-momentum/relative-weakness-momentum", "ohlcv"],
    ["canonical:trend/trend-pullback/trend-pullback", "ohlcv"],
    ["canonical:carry/funding-carry/funding-carry", "ohlcv"],
    ["canonical:carry/funding-carry/funding-carry", "funding"],
    ["canonical:carry/funding-carry/crowded-funding-unwind", "ohlcv"],
    ["canonical:carry/funding-carry/crowded-funding-unwind", "funding"],
    ["canonical:carry/funding-carry/crowded-funding-unwind", "open-interest"],
    ["canonical:volatility/volatility-regime-transition/volatility-compression-breakout", "ohlcv"],
  ] as const
  for (const [node, surface] of links) {
    const ready = surface === "ohlcv" || surface === "funding"
    linkUniverseDataSurface(db, {
      node_id: node, surface_id: `surface:${surface}`, requirement_type: "required",
      coverage_status: ready ? "ready" : "partial", updated_at: now,
    })
  }
  const familyCoverage = [
    ["canonical:trend/time-series-trend/time-series-momentum", "time_series_momentum_v1"],
    ["canonical:trend/breakout-continuation/channel-breakout", "structure_breakout_retest_v1"],
    ["canonical:trend/cross-sectional-momentum/relative-weakness-momentum", "relative_weakness_momentum_v1"],
    ["canonical:trend/trend-pullback/trend-pullback", "trend_pullback_v1"],
    ["canonical:carry/funding-carry/funding-carry", "funding_carry_v1"],
    ["canonical:carry/funding-carry/crowded-funding-unwind", "funding_unwind_risk_guard_v1"],
    ["canonical:volatility/volatility-regime-transition/volatility-compression-breakout", "volatility_compression_breakout_v1"],
  ] as const
  let coverageRecords = 0
  for (const [node, family] of familyCoverage) {
    upsertUniverseCoverage(db, {
      coverage_id: `coverage:family:${family}`, node_id: node, coverage_type: "family",
      scope_ref: family, module_ref: "modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
      coverage_status: "ready", evidence_ref: `family://${family}`, updated_at: now,
    })
    upsertUniverseCoverage(db, {
      coverage_id: `coverage:replay:${family}`, node_id: node, coverage_type: "replay",
      scope_ref: family, module_ref: "modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
      coverage_status: family === "relative_weakness_momentum_v1" ? "partial" : "ready",
      evidence_ref: `family://${family}`, updated_at: now,
    })
    coverageRecords += 2
  }
  return { nodes: universe.nodes.length, data_surfaces: surfaces.length, capabilities: capabilities.length, coverage_records: coverageRecords }
}

export function buildDefaultDataSurfaceSeed(now: string): DataSurfaceWrite[] {
  const definitions = [
    ["ohlcv", "OHLCV", "market_price", "ready", "closed candles; closed-only, checksum, multi-timeframe"],
    ["funding", "Funding", "derivatives", "ready", "settlement time, availability_at, cashflow"],
    ["open-interest", "Open Interest", "derivatives", "partial", "exchange coverage, gaps, symbol mapping"],
    ["trades", "Trades", "microstructure", "partial", "causal aggregation and taker-side semantics"],
    ["liquidation", "Liquidation", "derivatives", "missing", "event timestamp, venue coverage, gap marker"],
    ["l2-depth", "L2 / Depth", "microstructure", "missing", "historical depth, queue realism, maker fill"],
    ["onchain", "On-chain", "onchain", "out_of_scope", "point-in-time, reorg, label bias"],
    ["options", "Options", "options", "out_of_scope", "survivorship, expiry, mark source"],
    ["macro-etf", "Macro / ETF", "macro_event", "missing", "release time, revisions, calendar"],
    ["social-news", "Social / News", "text_event", "missing", "source timestamp, lag, lookahead"],
    ["dex-cex", "DEX / CEX", "cross_venue", "out_of_scope", "venue mapping, fees, latency"],
  ] as const
  return definitions.map(([slugValue, name, surfaceType, status, temporalContract]) => ({
    surface_id: `surface:${slugValue}`, slug: slugValue, name,
    surface_type: surfaceType, coverage_status: status,
    availability_contract_json: {
      schema_version: "trade-flow.rd-data-availability-contract.v1",
      temporal_contract: temporalContract,
      requires_availability_at: true,
    },
    owner_module: slugValue === "ohlcv" || slugValue === "funding" || slugValue === "open-interest"
      ? "modules/market-data-products/market-data-store" : undefined,
    created_at: now, updated_at: now,
  }))
}

export function buildDefaultCapabilitySeed(now: string): PipelineRegistryItemWrite[] {
  const definitions = [
    ["feature", "ohlcv-features", "OHLCV Feature Set", "modules/research-strategy-development/agent-roles/developer/strategy-family-engine", ["ohlcv", "4h", "causal"]],
    ["feature", "funding-features", "Funding Feature Set", "modules/research-strategy-development/agent-roles/developer/strategy-family-engine", ["funding", "derivatives", "causal"]],
    ["forecast_model", "rule-score", "Deterministic Rule Score", "modules/research-strategy-development/agent-roles/developer/signal-engine", ["score", "deterministic"]],
    ["portfolio", "single-asset", "Single Asset Portfolio", "modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine", ["single_asset", "usdm"]],
    ["portfolio", "cross-sectional-rank", "Cross-sectional Rank Portfolio", "modules/research-strategy-development/replay-execution-plane/compatibility/panel-evaluator", ["panel", "ranking"]],
    ["risk_rule", "fixed-risk-geometry", "Fixed Risk Geometry", "modules/research-strategy-development/agent-roles/developer/strategy-family-engine", ["stop", "target", "time_exit"]],
    ["execution_rule", "bar-close-taker", "Bar-close Taker Execution", "modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine", ["closed_candle", "taker", "4h"]],
  ] as const
  return definitions.map(([registryType, slugValue, name, owner, tags]) => ({
    item_id: `capability:${registryType}:${slugValue}:v1`, registry_type: registryType,
    slug: slugValue, name, schema_version: "trade-flow.rd-capability-contract.v1", version: "v1",
    owner_module: owner, status: "active", deterministic: true, capability_tags: [...tags],
    contract_json: { schema_version: "trade-flow.rd-capability-contract.v1", owner, slug: slugValue },
    created_at: now, updated_at: now,
  }))
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}
