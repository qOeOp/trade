import { Database } from "bun:sqlite"
import { asRecord, numberField, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export interface MarketManifest {
  manifest_id: string
  dataset_kind: string
  source: string
  exchange: string
  symbol?: string
  timeframe?: string
  first_ts?: number
  last_ts?: number
  rows?: number
  content_hash: string
  manifest_path: string
  created_at: string
  freshness_json?: JSONRecord
}

export interface CanonicalCandle {
  manifest_id: string
  exchange: string
  symbol: string
  timeframe: string
  open_time: number
  close_time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
  quote_volume?: number
}

export interface FundingEvent {
  manifest_id: string
  exchange: string
  symbol: string
  funding_time: number
  funding_rate: number
  mark_price?: number
}

export interface FeatureManifest {
  feature_manifest_id: string
  source_manifest_id: string
  feature_set_id: string
  symbol?: string
  timeframe?: string
  content_hash: string
  manifest_path: string
  generated_at: string
}

export interface FundingEventQuery {
  exchange?: string
  symbol?: string
  since_ts?: number
  until_ts?: number
  limit?: number
}

export interface FeatureManifestQuery {
  symbol?: string
  timeframe?: string
  feature_set_id?: string
  limit?: number
}

export interface CandleSeriesQuery {
  exchange?: string
  symbol: string
  timeframe: string
  since_ts?: number
  until_ts?: number
  limit?: number
}

export function ensureMarketDataSchema(db: Database): void {
  configureSqliteConnection(db)
  db.run(`
    CREATE TABLE IF NOT EXISTS market_manifest (
      manifest_id     TEXT PRIMARY KEY,
      dataset_kind    TEXT NOT NULL,
      source          TEXT NOT NULL,
      exchange        TEXT NOT NULL,
      symbol          TEXT,
      timeframe       TEXT,
      first_ts        BIGINT,
      last_ts         BIGINT,
      rows            BIGINT,
      content_hash    TEXT NOT NULL,
      manifest_path   TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      freshness_json  TEXT CHECK(freshness_json IS NULL OR json_valid(freshness_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS funding_event (
      manifest_id  TEXT NOT NULL,
      exchange     TEXT NOT NULL,
      symbol       TEXT NOT NULL,
      funding_time BIGINT NOT NULL,
      funding_rate DOUBLE NOT NULL,
      mark_price   DOUBLE,
      PRIMARY KEY (exchange, symbol, funding_time)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS feature_manifest (
      feature_manifest_id TEXT PRIMARY KEY,
      source_manifest_id  TEXT NOT NULL,
      feature_set_id      TEXT NOT NULL,
      symbol              TEXT,
      timeframe           TEXT,
      content_hash        TEXT NOT NULL,
      manifest_path       TEXT NOT NULL,
      generated_at        TEXT NOT NULL
    )
  `)
}

export function ensureOhlcvSchema(db: Database): void {
  configureSqliteConnection(db)
  db.run(`
    CREATE TABLE IF NOT EXISTS canonical_candle (
      manifest_id TEXT NOT NULL,
      exchange    TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      timeframe   TEXT NOT NULL,
      open_time   BIGINT NOT NULL,
      close_time  BIGINT NOT NULL,
      open        DOUBLE NOT NULL,
      high        DOUBLE NOT NULL,
      low         DOUBLE NOT NULL,
      close       DOUBLE NOT NULL,
      volume      DOUBLE,
      quote_volume DOUBLE,
      PRIMARY KEY (exchange, symbol, timeframe, open_time)
    )
  `)
}

function configureSqliteConnection(db: Database): void {
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
}

export function upsertMarketManifest(db: Database, manifest: MarketManifest): void {
  validateMarketManifest(manifest)
  db.query(`
    INSERT INTO market_manifest(
      manifest_id, dataset_kind, source, exchange, symbol, timeframe,
      first_ts, last_ts, rows, content_hash, manifest_path, created_at, freshness_json
    )
    VALUES (
      $manifest_id, $dataset_kind, $source, $exchange, $symbol, $timeframe,
      $first_ts, $last_ts, $rows, $content_hash, $manifest_path, $created_at, $freshness_json
    )
    ON CONFLICT(manifest_id) DO UPDATE SET
      dataset_kind = excluded.dataset_kind,
      source = excluded.source,
      exchange = excluded.exchange,
      symbol = excluded.symbol,
      timeframe = excluded.timeframe,
      first_ts = excluded.first_ts,
      last_ts = excluded.last_ts,
      rows = excluded.rows,
      content_hash = excluded.content_hash,
      manifest_path = excluded.manifest_path,
      created_at = excluded.created_at,
      freshness_json = excluded.freshness_json
  `).run({
    $manifest_id: manifest.manifest_id,
    $dataset_kind: manifest.dataset_kind,
    $source: manifest.source,
    $exchange: manifest.exchange,
    $symbol: manifest.symbol ?? null,
    $timeframe: manifest.timeframe ?? null,
    $first_ts: manifest.first_ts ?? null,
    $last_ts: manifest.last_ts ?? null,
    $rows: manifest.rows ?? null,
    $content_hash: manifest.content_hash,
    $manifest_path: manifest.manifest_path,
    $created_at: manifest.created_at,
    $freshness_json: manifest.freshness_json ? JSON.stringify(manifest.freshness_json) : null,
  })
}

export function upsertCanonicalCandles(db: Database, candles: CanonicalCandle[], batchSize = 1000): number {
  const insert = db.query(`
    INSERT INTO canonical_candle(
      manifest_id, exchange, symbol, timeframe, open_time, close_time,
      open, high, low, close, volume, quote_volume
    )
    VALUES (
      $manifest_id, $exchange, $symbol, $timeframe, $open_time, $close_time,
      $open, $high, $low, $close, $volume, $quote_volume
    )
    ON CONFLICT(exchange, symbol, timeframe, open_time) DO UPDATE SET
      manifest_id = excluded.manifest_id,
      close_time = excluded.close_time,
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      quote_volume = excluded.quote_volume
  `)
  let count = 0
  const writeBatch = db.transaction((items: CanonicalCandle[]) => {
    for (const candle of items) {
      validateCanonicalCandle(candle)
      insert.run({
        $manifest_id: candle.manifest_id,
        $exchange: candle.exchange,
        $symbol: candle.symbol,
        $timeframe: candle.timeframe,
        $open_time: candle.open_time,
        $close_time: candle.close_time,
        $open: candle.open,
        $high: candle.high,
        $low: candle.low,
        $close: candle.close,
        $volume: candle.volume ?? null,
        $quote_volume: candle.quote_volume ?? null,
      })
      count += 1
    }
  })
  const size = Math.max(1, Math.floor(batchSize))
  for (let index = 0; index < candles.length; index += size) {
    writeBatch(candles.slice(index, index + size))
  }
  return count
}

export function upsertFundingEvents(db: Database, events: FundingEvent[]): number {
  const insert = db.query(`
    INSERT INTO funding_event(manifest_id, exchange, symbol, funding_time, funding_rate, mark_price)
    VALUES ($manifest_id, $exchange, $symbol, $funding_time, $funding_rate, $mark_price)
    ON CONFLICT(exchange, symbol, funding_time) DO UPDATE SET
      manifest_id = excluded.manifest_id,
      funding_rate = excluded.funding_rate,
      mark_price = excluded.mark_price
  `)
  let count = 0
  db.transaction(() => {
    for (const event of events) {
      validateFundingEvent(event)
      insert.run({
        $manifest_id: event.manifest_id,
        $exchange: event.exchange,
        $symbol: event.symbol,
        $funding_time: event.funding_time,
        $funding_rate: event.funding_rate,
        $mark_price: event.mark_price ?? null,
      })
      count += 1
    }
  })()
  return count
}

export function upsertFeatureManifest(db: Database, manifest: FeatureManifest): void {
  validateFeatureManifest(manifest)
  db.query(`
    INSERT INTO feature_manifest(
      feature_manifest_id, source_manifest_id, feature_set_id, symbol, timeframe,
      content_hash, manifest_path, generated_at
    )
    VALUES (
      $feature_manifest_id, $source_manifest_id, $feature_set_id, $symbol, $timeframe,
      $content_hash, $manifest_path, $generated_at
    )
    ON CONFLICT(feature_manifest_id) DO UPDATE SET
      source_manifest_id = excluded.source_manifest_id,
      feature_set_id = excluded.feature_set_id,
      symbol = excluded.symbol,
      timeframe = excluded.timeframe,
      content_hash = excluded.content_hash,
      manifest_path = excluded.manifest_path,
      generated_at = excluded.generated_at
  `).run({
    $feature_manifest_id: manifest.feature_manifest_id,
    $source_manifest_id: manifest.source_manifest_id,
    $feature_set_id: manifest.feature_set_id,
    $symbol: manifest.symbol ?? null,
    $timeframe: manifest.timeframe ?? null,
    $content_hash: manifest.content_hash,
    $manifest_path: manifest.manifest_path,
    $generated_at: manifest.generated_at,
  })
}

export function readMarketManifest(db: Database, manifestId: string): MarketManifest | null {
  const row = db.query(`
    SELECT manifest_id, dataset_kind, source, exchange, symbol, timeframe,
      first_ts, last_ts, rows, content_hash, manifest_path, created_at, freshness_json
    FROM market_manifest
    WHERE manifest_id = $manifest_id
  `).get({ $manifest_id: manifestId }) as MarketManifestRow | null
  return row ? manifestFromRow(row) : null
}

export function readFundingEvents(db: Database, query: FundingEventQuery): FundingEvent[] {
  const limit = boundedLimit(query.limit, 1000)
  const rows = db.query(`
    SELECT manifest_id, exchange, symbol, funding_time, funding_rate, mark_price
    FROM funding_event
    WHERE ($exchange IS NULL OR exchange = $exchange)
      AND ($symbol IS NULL OR symbol = $symbol)
      AND ($since_ts IS NULL OR funding_time >= $since_ts)
      AND ($until_ts IS NULL OR funding_time <= $until_ts)
    ORDER BY funding_time
    LIMIT $limit
  `).all({
    $exchange: query.exchange || null,
    $symbol: query.symbol || null,
    $since_ts: query.since_ts ?? null,
    $until_ts: query.until_ts ?? null,
    $limit: limit,
  }) as FundingEventRow[]
  return rows.map(fundingEventFromRow)
}

export function readLatestCandleOpenTime(db: Database, query: { exchange?: string; symbol: string; timeframe: string }): number | null {
  const row = db.query(`
    SELECT MAX(open_time) AS open_time
    FROM canonical_candle
    WHERE ($exchange IS NULL OR exchange = $exchange)
      AND symbol = $symbol
      AND timeframe = $timeframe
  `).get({
    $exchange: query.exchange || null,
    $symbol: query.symbol,
    $timeframe: query.timeframe,
  }) as { open_time: number | null } | null
  return typeof row?.open_time === "number" ? row.open_time : null
}

export function readCanonicalCandles(db: Database, query: CandleSeriesQuery): CanonicalCandle[] {
  const limit = boundedLimit(query.limit, 5000)
  const rows = db.query(`
    SELECT manifest_id, exchange, symbol, timeframe, open_time, close_time,
      open, high, low, close, volume, quote_volume
    FROM canonical_candle
    WHERE ($exchange IS NULL OR exchange = $exchange)
      AND symbol = $symbol
      AND timeframe = $timeframe
      AND ($since_ts IS NULL OR open_time >= $since_ts)
      AND ($until_ts IS NULL OR open_time <= $until_ts)
    ORDER BY open_time
    LIMIT $limit
  `).all({
    $exchange: query.exchange || null,
    $symbol: query.symbol,
    $timeframe: query.timeframe,
    $since_ts: query.since_ts ?? null,
    $until_ts: query.until_ts ?? null,
    $limit: limit,
  }) as CanonicalCandleRow[]
  return rows.map(canonicalCandleFromRow)
}

export function readFeatureManifest(db: Database, featureManifestId: string): FeatureManifest | null {
  const row = db.query(`
    SELECT feature_manifest_id, source_manifest_id, feature_set_id, symbol, timeframe,
      content_hash, manifest_path, generated_at
    FROM feature_manifest
    WHERE feature_manifest_id = $feature_manifest_id
  `).get({ $feature_manifest_id: featureManifestId }) as FeatureManifestRow | null
  return row ? featureManifestFromRow(row) : null
}

export function listFeatureManifests(db: Database, query: FeatureManifestQuery): FeatureManifest[] {
  const limit = boundedLimit(query.limit, 100)
  const rows = db.query(`
    SELECT feature_manifest_id, source_manifest_id, feature_set_id, symbol, timeframe,
      content_hash, manifest_path, generated_at
    FROM feature_manifest
    WHERE ($symbol IS NULL OR symbol = $symbol)
      AND ($timeframe IS NULL OR timeframe = $timeframe)
      AND ($feature_set_id IS NULL OR feature_set_id = $feature_set_id)
    ORDER BY generated_at DESC, feature_manifest_id
    LIMIT $limit
  `).all({
    $symbol: query.symbol || null,
    $timeframe: query.timeframe || null,
    $feature_set_id: query.feature_set_id || null,
    $limit: limit,
  }) as FeatureManifestRow[]
  return rows.map(featureManifestFromRow)
}

export function buildMarketManifest(input: JSONRecord): MarketManifest {
  const now = stringField(input.created_at) || stringField(input.now) || new Date().toISOString()
  return {
    manifest_id: stringField(input.manifest_id),
    dataset_kind: stringField(input.dataset_kind),
    source: stringField(input.source),
    exchange: stringField(input.exchange) || "binance_usdm",
    symbol: stringField(input.symbol) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    first_ts: optionalNumber(input.first_ts),
    last_ts: optionalNumber(input.last_ts),
    rows: optionalNumber(input.rows),
    content_hash: stringField(input.content_hash),
    manifest_path: stringField(input.manifest_path),
    created_at: now,
    freshness_json: optionalRecord(input.freshness_json ?? input.freshness),
  }
}

export function buildCanonicalCandles(value: unknown): CanonicalCandle[] {
  return Array.isArray(value) ? value.map(asRecord).map((row) => ({
    manifest_id: stringField(row.manifest_id),
    exchange: stringField(row.exchange) || "binance_usdm",
    symbol: stringField(row.symbol),
    timeframe: stringField(row.timeframe),
    open_time: numberField(row.open_time),
    close_time: numberField(row.close_time),
    open: numberField(row.open),
    high: numberField(row.high),
    low: numberField(row.low),
    close: numberField(row.close),
    volume: optionalNumber(row.volume),
    quote_volume: optionalNumber(row.quote_volume),
  })) : []
}

export function buildFundingEvents(value: unknown): FundingEvent[] {
  return Array.isArray(value) ? value.map(asRecord).map((row) => ({
    manifest_id: stringField(row.manifest_id),
    exchange: stringField(row.exchange) || "binance_usdm",
    symbol: stringField(row.symbol),
    funding_time: numberField(row.funding_time),
    funding_rate: numberField(row.funding_rate),
    mark_price: optionalNumber(row.mark_price),
  })) : []
}

export function buildFeatureManifest(input: JSONRecord): FeatureManifest {
  const now = stringField(input.generated_at) || stringField(input.now) || new Date().toISOString()
  return {
    feature_manifest_id: stringField(input.feature_manifest_id),
    source_manifest_id: stringField(input.source_manifest_id),
    feature_set_id: stringField(input.feature_set_id),
    symbol: stringField(input.symbol) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    content_hash: stringField(input.content_hash),
    manifest_path: stringField(input.manifest_path),
    generated_at: now,
  }
}

function validateMarketManifest(manifest: MarketManifest): void {
  if (!manifest.manifest_id || !manifest.dataset_kind || !manifest.source || !manifest.exchange || !manifest.content_hash || !manifest.manifest_path || !manifest.created_at) {
    throw new Error("manifest_id, dataset_kind, source, exchange, content_hash, manifest_path, and created_at are required")
  }
}

function validateCanonicalCandle(candle: CanonicalCandle): void {
  if (!candle.manifest_id || !candle.exchange || !candle.symbol || !candle.timeframe || !Number.isFinite(candle.open_time) || !Number.isFinite(candle.close_time)) {
    throw new Error("canonical candle identity fields are required")
  }
  for (const field of ["open", "high", "low", "close"] as const) {
    if (!Number.isFinite(candle[field])) {
      throw new Error(`canonical candle ${field} is required`)
    }
  }
}

function validateFundingEvent(event: FundingEvent): void {
  if (!event.manifest_id || !event.exchange || !event.symbol || !Number.isFinite(event.funding_time) || !Number.isFinite(event.funding_rate)) {
    throw new Error("funding event identity fields and funding_rate are required")
  }
}

function validateFeatureManifest(manifest: FeatureManifest): void {
  if (!manifest.feature_manifest_id || !manifest.source_manifest_id || !manifest.feature_set_id || !manifest.content_hash || !manifest.manifest_path || !manifest.generated_at) {
    throw new Error("feature_manifest_id, source_manifest_id, feature_set_id, content_hash, manifest_path, and generated_at are required")
  }
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function optionalRecord(value: unknown): JSONRecord | undefined {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : undefined
}

function boundedLimit(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), 10_000)
}

interface MarketManifestRow {
  manifest_id: string
  dataset_kind: string
  source: string
  exchange: string
  symbol: string | null
  timeframe: string | null
  first_ts: number | null
  last_ts: number | null
  rows: number | null
  content_hash: string
  manifest_path: string
  created_at: string
  freshness_json: string | null
}

interface FundingEventRow {
  manifest_id: string
  exchange: string
  symbol: string
  funding_time: number
  funding_rate: number
  mark_price: number | null
}

interface CanonicalCandleRow {
  manifest_id: string
  exchange: string
  symbol: string
  timeframe: string
  open_time: number
  close_time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  quote_volume: number | null
}

interface FeatureManifestRow {
  feature_manifest_id: string
  source_manifest_id: string
  feature_set_id: string
  symbol: string | null
  timeframe: string | null
  content_hash: string
  manifest_path: string
  generated_at: string
}

function manifestFromRow(row: MarketManifestRow): MarketManifest {
  return {
    manifest_id: row.manifest_id,
    dataset_kind: row.dataset_kind,
    source: row.source,
    exchange: row.exchange,
    symbol: row.symbol ?? undefined,
    timeframe: row.timeframe ?? undefined,
    first_ts: row.first_ts ?? undefined,
    last_ts: row.last_ts ?? undefined,
    rows: row.rows ?? undefined,
    content_hash: row.content_hash,
    manifest_path: row.manifest_path,
    created_at: row.created_at,
    freshness_json: row.freshness_json ? JSON.parse(row.freshness_json) as JSONRecord : undefined,
  }
}

function fundingEventFromRow(row: FundingEventRow): FundingEvent {
  return {
    manifest_id: row.manifest_id,
    exchange: row.exchange,
    symbol: row.symbol,
    funding_time: row.funding_time,
    funding_rate: row.funding_rate,
    mark_price: row.mark_price ?? undefined,
  }
}

function canonicalCandleFromRow(row: CanonicalCandleRow): CanonicalCandle {
  return {
    manifest_id: row.manifest_id,
    exchange: row.exchange,
    symbol: row.symbol,
    timeframe: row.timeframe,
    open_time: row.open_time,
    close_time: row.close_time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? undefined,
    quote_volume: row.quote_volume ?? undefined,
  }
}

function featureManifestFromRow(row: FeatureManifestRow): FeatureManifest {
  return {
    feature_manifest_id: row.feature_manifest_id,
    source_manifest_id: row.source_manifest_id,
    feature_set_id: row.feature_set_id,
    symbol: row.symbol ?? undefined,
    timeframe: row.timeframe ?? undefined,
    content_hash: row.content_hash,
    manifest_path: row.manifest_path,
    generated_at: row.generated_at,
  }
}
