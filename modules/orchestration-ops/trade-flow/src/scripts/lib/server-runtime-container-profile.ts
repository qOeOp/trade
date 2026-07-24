import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"

export const SERVER_RUNTIME_CONTAINER_PROFILE_SCHEMA = "trade.server-runtime-container-profile.v2" as const

export interface ServerRuntimeContainerProfile {
  schema_version: typeof SERVER_RUNTIME_CONTAINER_PROFILE_SCHEMA
  profile_id: string
  deployment_id: string
  market_data_runtime: {
    market_data_db: "data/market_data.db"
    ohlcv_db: "data/ohlcv.db"
    l2: {
      max_instances: number
      base_port: number
      reconcile_interval_ms: number
      readiness_deadline_ms: number
    }
    ohlcv_worker: {
      max_symbols: number
      max_jobs_per_cycle: number
      max_rows_per_job: number
      interval_ms: number
      command_timeout_ms: number
    }
    funding_worker: {
      max_symbols: number
      max_jobs_per_cycle: number
      interval_ms: number
      command_timeout_ms: number
      request_timeout_ms: number
    }
    indicator_worker: {
      max_symbols: number
      max_jobs_per_cycle: number
      max_bars: number
      interval_ms: number
      command_timeout_ms: number
    }
  }
  control_runtime: {
    trade_db: string
    ops_runtime_db: string
    interval_seconds: number
    observe_agent_parity: boolean
  }
  shutdown_grace_seconds: number
  safety: {
    domain_jobs_enabled: false
    formal_replay_jobs_enabled: true
    live_writes_allowed: false
    notify_dry_run: true
  }
}

export function parseServerRuntimeContainerProfile(value: unknown): ServerRuntimeContainerProfile {
  const root = record(value, "profile")
  exact(root, [
    "schema_version", "profile_id", "deployment_id", "market_data_runtime",
    "control_runtime", "shutdown_grace_seconds", "safety",
  ], "profile")
  if (root.schema_version !== SERVER_RUNTIME_CONTAINER_PROFILE_SCHEMA) {
    throw new Error("unsupported server container profile schema")
  }
  const market = record(root.market_data_runtime, "market_data_runtime")
  exact(market, [
    "market_data_db", "ohlcv_db", "l2", "ohlcv_worker", "funding_worker",
    "indicator_worker",
  ], "market_data_runtime")
  if (market.market_data_db !== "data/market_data.db" || market.ohlcv_db !== "data/ohlcv.db") {
    throw new Error("server container market database paths are fixed")
  }
  const l2 = record(market.l2, "market_data_runtime.l2")
  exact(l2, ["max_instances", "base_port", "reconcile_interval_ms", "readiness_deadline_ms"], "market_data_runtime.l2")
  const maxInstances = integer(l2.max_instances, 1, 20, "l2.max_instances")
  const basePort = integer(l2.base_port, 1_024, 65_535, "l2.base_port")
  if (basePort + maxInstances - 1 > 65_535) throw new Error("server container L2 port range exceeds 65535")
  const ohlcv = record(market.ohlcv_worker, "market_data_runtime.ohlcv_worker")
  exact(ohlcv, [
    "max_symbols", "max_jobs_per_cycle", "max_rows_per_job", "interval_ms", "command_timeout_ms",
  ], "market_data_runtime.ohlcv_worker")
  const funding = record(market.funding_worker, "market_data_runtime.funding_worker")
  exact(funding, [
    "max_symbols", "max_jobs_per_cycle", "interval_ms", "command_timeout_ms",
    "request_timeout_ms",
  ], "market_data_runtime.funding_worker")
  const indicator = record(market.indicator_worker, "market_data_runtime.indicator_worker")
  exact(indicator, [
    "max_symbols", "max_jobs_per_cycle", "max_bars", "interval_ms", "command_timeout_ms",
  ], "market_data_runtime.indicator_worker")
  const control = record(root.control_runtime, "control_runtime")
  exact(control, ["trade_db", "ops_runtime_db", "interval_seconds", "observe_agent_parity"], "control_runtime")
  const safety = record(root.safety, "safety")
  exact(safety, [
    "domain_jobs_enabled",
    "formal_replay_jobs_enabled",
    "live_writes_allowed",
    "notify_dry_run",
  ], "safety")
  if (safety.domain_jobs_enabled !== false
      || safety.formal_replay_jobs_enabled !== true
      || safety.live_writes_allowed !== false
      || safety.notify_dry_run !== true) {
    throw new Error("server container shadow safety cannot be widened")
  }
  if (typeof control.observe_agent_parity !== "boolean") throw new Error("observe_agent_parity must be boolean")
  const tradeDb = dbRef(control.trade_db, "control_runtime.trade_db")
  const opsDb = dbRef(control.ops_runtime_db, "control_runtime.ops_runtime_db")
  if (new Set([
    tradeDb,
    opsDb,
    market.market_data_db,
    market.ohlcv_db,
    "data/rd_state.db",
  ]).size !== 5) {
    throw new Error("server container owner databases must use distinct paths")
  }
  return {
    schema_version: SERVER_RUNTIME_CONTAINER_PROFILE_SCHEMA,
    profile_id: identifier(root.profile_id, "profile_id"),
    deployment_id: identifier(root.deployment_id, "deployment_id"),
    market_data_runtime: {
      market_data_db: "data/market_data.db",
      ohlcv_db: "data/ohlcv.db",
      l2: {
        max_instances: maxInstances,
        base_port: basePort,
        reconcile_interval_ms: integer(l2.reconcile_interval_ms, 1_000, 300_000, "l2.reconcile_interval_ms"),
        readiness_deadline_ms: integer(l2.readiness_deadline_ms, 5_000, 120_000, "l2.readiness_deadline_ms"),
      },
      ohlcv_worker: {
        max_symbols: integer(ohlcv.max_symbols, 1, 100, "ohlcv.max_symbols"),
        max_jobs_per_cycle: integer(ohlcv.max_jobs_per_cycle, 1, 20, "ohlcv.max_jobs_per_cycle"),
        max_rows_per_job: integer(ohlcv.max_rows_per_job, 1, 100_000, "ohlcv.max_rows_per_job"),
        interval_ms: integer(ohlcv.interval_ms, 5_000, 3_600_000, "ohlcv.interval_ms"),
        command_timeout_ms: integer(ohlcv.command_timeout_ms, 5_000, 600_000, "ohlcv.command_timeout_ms"),
      },
      funding_worker: {
        max_symbols: integer(funding.max_symbols, 1, 100, "funding.max_symbols"),
        max_jobs_per_cycle: integer(funding.max_jobs_per_cycle, 1, 20, "funding.max_jobs_per_cycle"),
        interval_ms: integer(funding.interval_ms, 5_000, 3_600_000, "funding.interval_ms"),
        command_timeout_ms: integer(funding.command_timeout_ms, 5_000, 600_000, "funding.command_timeout_ms"),
        request_timeout_ms: integer(funding.request_timeout_ms, 1_000, 120_000, "funding.request_timeout_ms"),
      },
      indicator_worker: {
        max_symbols: integer(indicator.max_symbols, 1, 100, "indicator.max_symbols"),
        max_jobs_per_cycle: integer(indicator.max_jobs_per_cycle, 1, 20, "indicator.max_jobs_per_cycle"),
        max_bars: integer(indicator.max_bars, 1, 50_000, "indicator.max_bars"),
        interval_ms: integer(indicator.interval_ms, 5_000, 3_600_000, "indicator.interval_ms"),
        command_timeout_ms: integer(indicator.command_timeout_ms, 5_000, 900_000, "indicator.command_timeout_ms"),
      },
    },
    control_runtime: {
      trade_db: tradeDb,
      ops_runtime_db: opsDb,
      interval_seconds: integer(control.interval_seconds, 1, 3_600, "control_runtime.interval_seconds"),
      observe_agent_parity: control.observe_agent_parity,
    },
    shutdown_grace_seconds: integer(root.shutdown_grace_seconds, 5, 300, "shutdown_grace_seconds"),
    safety: {
      domain_jobs_enabled: false,
      formal_replay_jobs_enabled: true,
      live_writes_allowed: false,
      notify_dry_run: true,
    },
  }
}

export function serverRuntimeContainerProfileHash(profile: ServerRuntimeContainerProfile): string {
  return canonicalHash(profile)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, allowed: string[], field: string): void {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !expected.has(key))
  const missing = allowed.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return Number(value)
}

function dbRef(value: unknown, field: string): string {
  if (typeof value !== "string"
    || !/^data\/(?:[a-z0-9_-]+\/)?[a-z0-9_-]+\.db$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}
