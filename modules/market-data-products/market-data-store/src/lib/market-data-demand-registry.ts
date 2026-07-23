import type { Database } from "bun:sqlite"
import {
  compileMarketDataDemand,
  reconcileMarketDataDemands,
  type MarketDataDemand,
  type MarketDataSubscriptionPlan,
} from "../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"

export const MARKET_DATA_DEMAND_RELEASE_SCHEMA = "trade.market-data-demand-release.v1" as const

export interface MarketDataDemandRelease {
  schema_version: typeof MARKET_DATA_DEMAND_RELEASE_SCHEMA
  demand_id: string
  demand_hash: string
  released_at: string
  reason: "consumer_completed" | "subject_cancelled" | "subject_retired" | "superseded"
}

interface DemandRow {
  demand_id: string
  demand_hash: string
  body_json: string
  status: "active" | "released"
  registered_at: string
  released_at: string | null
  release_reason: MarketDataDemandRelease["reason"] | null
}

export function ensureMarketDataDemandRegistrySchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS market_data_demand (
      demand_id       TEXT PRIMARY KEY,
      demand_hash     TEXT NOT NULL,
      body_json       TEXT NOT NULL CHECK(json_valid(body_json)),
      status          TEXT NOT NULL CHECK(status IN ('active', 'released')),
      registered_at   TEXT NOT NULL,
      released_at     TEXT,
      release_reason  TEXT CHECK(release_reason IS NULL OR release_reason IN (
        'consumer_completed', 'subject_cancelled', 'subject_retired', 'superseded'
      )),
      CHECK(
        (status = 'active' AND released_at IS NULL AND release_reason IS NULL)
        OR
        (status = 'released' AND released_at IS NOT NULL AND release_reason IS NOT NULL)
      )
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_market_data_demand_status ON market_data_demand(status, demand_id)")
}

export function registerMarketDataDemand(
  db: Database,
  value: unknown,
  registeredAt?: string,
): "created" | "existing" {
  const demand = compileMarketDataDemand(value)
  const observedAt = registeredAt == null ? new Date().toISOString() : canonicalTime(registeredAt, "registered_at")
  if (Date.parse(observedAt) < Date.parse(demand.lease.issued_at)) {
    throw new Error("market data demand cannot be registered before lease issuance")
  }
  return db.transaction((): "created" | "existing" => {
    const existing = readRow(db, demand.demand_id)
    if (existing != null) {
      if (existing.demand_hash !== demand.demand_hash || existing.body_json !== JSON.stringify(demand)) {
        throw new Error("market data demand identity already exists with different content")
      }
      return "existing"
    }
    db.query(`
      INSERT INTO market_data_demand (
        demand_id, demand_hash, body_json, status, registered_at, released_at, release_reason
      ) VALUES (
        $demand_id, $demand_hash, $body_json, 'active', $registered_at, NULL, NULL
      )
    `).run({
      $demand_id: demand.demand_id,
      $demand_hash: demand.demand_hash,
      $body_json: JSON.stringify(demand),
      $registered_at: observedAt,
    })
    return "created"
  })()
}

export function releaseMarketDataDemand(
  db: Database,
  value: unknown,
): "released" | "existing" {
  const release = compileRelease(value)
  return db.transaction((): "released" | "existing" => {
    const existing = readRow(db, release.demand_id)
    if (existing == null) throw new Error("market data demand does not exist")
    if (existing.demand_hash !== release.demand_hash) throw new Error("market data demand release hash mismatch")
    const demand = compileMarketDataDemand(JSON.parse(existing.body_json))
    if (Date.parse(release.released_at) < Date.parse(demand.lease.issued_at)) {
      throw new Error("market data demand release precedes lease issuance")
    }
    if (existing.status === "released") {
      if (existing.released_at !== release.released_at || existing.release_reason !== release.reason) {
        throw new Error("market data demand already released with different terminal content")
      }
      return "existing"
    }
    db.query(`
      UPDATE market_data_demand
      SET status = 'released', released_at = $released_at, release_reason = $release_reason
      WHERE demand_id = $demand_id AND status = 'active'
    `).run({
      $released_at: release.released_at,
      $release_reason: release.reason,
      $demand_id: release.demand_id,
    })
    return "released"
  })()
}

export function readMarketDataDemand(db: Database, demandId: string): {
  demand: MarketDataDemand
  status: "active" | "released"
  registered_at: string
  release: MarketDataDemandRelease | null
} | null {
  requireIdentifier(demandId, "demand_id")
  const row = readRow(db, demandId)
  if (row == null) return null
  const demand = compileMarketDataDemand(JSON.parse(row.body_json))
  if (demand.demand_hash !== row.demand_hash) throw new Error("stored market data demand hash drifted")
  return {
    demand,
    status: row.status,
    registered_at: canonicalTime(row.registered_at, "stored registered_at"),
    release: row.status === "released" ? {
      schema_version: MARKET_DATA_DEMAND_RELEASE_SCHEMA,
      demand_id: demand.demand_id,
      demand_hash: demand.demand_hash,
      released_at: canonicalTime(row.released_at, "stored released_at"),
      reason: releaseReason(row.release_reason),
    } : null,
  }
}

export function reconcileRegisteredMarketDataDemands(
  db: Database,
  input: { observed_at: string; max_symbols: number },
): MarketDataSubscriptionPlan {
  const rows = db.query(`
    SELECT demand_id, demand_hash, body_json, status, registered_at, released_at, release_reason
    FROM market_data_demand
    WHERE status = 'active'
    ORDER BY demand_id COLLATE BINARY
  `).all() as DemandRow[]
  return reconcileMarketDataDemands({
    demands: rows.map((row) => {
      const demand = compileMarketDataDemand(JSON.parse(row.body_json))
      if (demand.demand_hash !== row.demand_hash || demand.demand_id !== row.demand_id) {
        throw new Error("stored market data demand identity drifted")
      }
      return demand
    }),
    observed_at: input.observed_at,
    max_symbols: input.max_symbols,
  })
}

function compileRelease(value: unknown): MarketDataDemandRelease {
  const input = record(value, "market_data_demand_release")
  exact(input, ["schema_version", "demand_id", "demand_hash", "released_at", "reason"], "market_data_demand_release")
  if (input.schema_version !== MARKET_DATA_DEMAND_RELEASE_SCHEMA) {
    throw new Error("market data demand release schema is unsupported")
  }
  return {
    schema_version: MARKET_DATA_DEMAND_RELEASE_SCHEMA,
    demand_id: requireIdentifier(input.demand_id, "demand_id"),
    demand_hash: sha256(input.demand_hash, "demand_hash"),
    released_at: canonicalTime(input.released_at, "released_at"),
    reason: releaseReason(input.reason),
  }
}

function readRow(db: Database, demandId: string): DemandRow | null {
  return db.query(`
    SELECT demand_id, demand_hash, body_json, status, registered_at, released_at, release_reason
    FROM market_data_demand
    WHERE demand_id = $demand_id
  `).get({ $demand_id: demandId }) as DemandRow | null
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, allowed: string[], field: string): void {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !expected.has(key))
  const missing = allowed.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function canonicalTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC time`)
  }
  return value
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a SHA-256 hex digest`)
  return value
}

function releaseReason(value: unknown): MarketDataDemandRelease["reason"] {
  if (
    value !== "consumer_completed"
    && value !== "subject_cancelled"
    && value !== "subject_retired"
    && value !== "superseded"
  ) throw new Error("market data demand release reason is unsupported")
  return value
}
