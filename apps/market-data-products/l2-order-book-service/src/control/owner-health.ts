import type { LaunchReceipt, RuntimeState } from "./runtime-contract"

export const L2_OWNER_HEALTH_SCHEMA = "trade.l2-service-owner-health.v1" as const

export interface L2SourceHealth {
  schema_version: "trade.l2-health.v1"
  symbol: string
  service_status: string
  stream_epoch: string
  continuity_status: string
  source_ready: boolean
  raw_writer_ready: boolean
  projector_ready: boolean
  read_ready: boolean
  broker_enabled: boolean
  broker_ready: boolean
  last_update_id: number
  last_receive_time_ms: number
  freshness_ms: number
  incident_count: number
  last_incident: string
}

export interface L2OwnerHealth {
  schema_version: typeof L2_OWNER_HEALTH_SCHEMA
  observed_at: string
  status: "healthy" | "degraded" | "starting" | "stopped" | "failed" | "orphaned" | "unavailable"
  symbol: string | null
  readiness: {
    supervisor_alive: boolean
    service_alive: boolean
    control_state_fresh: boolean
    control_ready: boolean
    source_read_ready: boolean
    overall_ready: boolean
  }
  control: null | {
    runtime_status: RuntimeState["status"]
    state_updated_at: string
    state_age_ms: number
    state_stale_after_ms: number
    attempt: number
    consecutive_failures: number
    disk_status: RuntimeState["disk_status"]
    disk_available_bytes: number | null
    admission_status: RuntimeState["admission_status"]
    admission_last_checked_at: string | null
    admission_last_error: string
    resource_last_checked_at: string | null
    resource_last_error: string
    service_rss_bytes: number | null
    service_rss_max_bytes: number
    service_cpu_percent: number | null
    service_cpu_max_percent: number
  }
  source: L2SourceHealth | null
  health_error: string
  lifecycle_authority: "none"
  limitations: string[]
}

export function buildUnavailableL2OwnerHealth(observedAt: string): L2OwnerHealth {
  requireUtc(observedAt, "observed_at")
  return {
    schema_version: L2_OWNER_HEALTH_SCHEMA,
    observed_at: observedAt,
    status: "unavailable",
    symbol: null,
    readiness: {
      supervisor_alive: false,
      service_alive: false,
      control_state_fresh: false,
      control_ready: false,
      source_read_ready: false,
      overall_ready: false,
    },
    control: null,
    source: null,
    health_error: "no active L2 supervisor is registered",
    lifecycle_authority: "none",
    limitations: limitations(),
  }
}

export function selectUniqueActiveL2Launch<T>(active: T[]): T | null {
  if (active.length > 1) throw new Error("multiple active L2 supervisors require operator resolution")
  return active[0] ?? null
}

export function buildL2OwnerHealth(input: {
  observed_at: string
  receipt: LaunchReceipt
  runtime_state: RuntimeState
  terminal_state: Record<string, unknown> | null
  supervisor_alive: boolean
  service_alive: boolean
  source_health: unknown
  health_error?: string
}): L2OwnerHealth {
  requireUtc(input.observed_at, "observed_at")
  requireUtc(input.runtime_state.updated_at, "runtime_state.updated_at")
  if (input.runtime_state.supervisor_pid !== input.receipt.supervisor_pid) {
    throw new Error("L2 runtime state does not bind the launch supervisor")
  }
  const source = input.source_health == null
    ? null
    : parseL2SourceHealth(input.source_health, input.receipt.config.symbol)
  const stateAgeMs = Date.parse(input.observed_at) - Date.parse(input.runtime_state.updated_at)
  if (stateAgeMs < 0) throw new Error("L2 runtime state is newer than the health observation")
  const stateStaleAfterMs = Math.max(
    input.receipt.config.disk_check_interval_ms,
    input.receipt.config.resource_check_interval_ms,
    input.receipt.config.admission_interval_ms,
  ) * 3
  const controlStateFresh = stateAgeMs <= stateStaleAfterMs
  const diskOperational = input.runtime_state.disk_status === "healthy"
    || input.runtime_state.disk_status === "soft_limit"
  const controlReady = controlStateFresh && diskOperational
    && (input.runtime_state.admission_status === "ready" || input.runtime_state.admission_status === "disabled")
    && input.runtime_state.resource_last_error === ""
  const sourceReadReady = source?.read_ready === true
  const overallReady = input.supervisor_alive && input.service_alive && controlReady && sourceReadReady
  const pressureDegraded = input.runtime_state.disk_status === "soft_limit"
  const terminalStatus = input.terminal_state?.status
  const status: L2OwnerHealth["status"] = terminalStatus === "completed" ? "stopped"
    : terminalStatus === "failed" ? "failed"
      : !input.supervisor_alive ? "orphaned"
        : overallReady && !pressureDegraded ? "healthy"
          : input.runtime_state.status === "starting" && !input.service_alive ? "starting"
            : "degraded"
  return {
    schema_version: L2_OWNER_HEALTH_SCHEMA,
    observed_at: input.observed_at,
    status,
    symbol: input.receipt.config.symbol,
    readiness: {
      supervisor_alive: input.supervisor_alive,
      service_alive: input.service_alive,
      control_state_fresh: controlStateFresh,
      control_ready: controlReady,
      source_read_ready: sourceReadReady,
      overall_ready: overallReady,
    },
    control: {
      runtime_status: input.runtime_state.status,
      state_updated_at: input.runtime_state.updated_at,
      state_age_ms: stateAgeMs,
      state_stale_after_ms: stateStaleAfterMs,
      attempt: input.runtime_state.attempt,
      consecutive_failures: input.runtime_state.consecutive_failures,
      disk_status: input.runtime_state.disk_status,
      disk_available_bytes: input.runtime_state.disk_available_bytes,
      admission_status: input.runtime_state.admission_status,
      admission_last_checked_at: input.runtime_state.admission_last_checked_at,
      admission_last_error: input.runtime_state.admission_last_error,
      resource_last_checked_at: input.runtime_state.resource_last_checked_at,
      resource_last_error: input.runtime_state.resource_last_error,
      service_rss_bytes: input.runtime_state.service_rss_bytes,
      service_rss_max_bytes: input.runtime_state.service_rss_max_bytes,
      service_cpu_percent: input.runtime_state.service_cpu_percent,
      service_cpu_max_percent: input.runtime_state.service_cpu_max_percent,
    },
    source,
    health_error: boundedError(input.health_error ?? ""),
    lifecycle_authority: "none",
    limitations: limitations(),
  }
}

function parseL2SourceHealth(value: unknown, expectedSymbol: string): L2SourceHealth {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("L2 source health must be an object")
  }
  const health = value as Record<string, unknown>
  if (health.schema_version !== "trade.l2-health.v1" || health.symbol !== expectedSymbol) {
    throw new Error("L2 source health identity drifted")
  }
  for (const field of ["source_ready", "raw_writer_ready", "projector_ready", "read_ready", "broker_enabled", "broker_ready"]) {
    if (typeof health[field] !== "boolean") throw new Error(`L2 source health ${field} must be boolean`)
  }
  for (const field of ["last_update_id", "last_receive_time_ms", "freshness_ms", "incident_count"]) {
    if (!Number.isSafeInteger(health[field]) || Number(health[field]) < 0) {
      throw new Error(`L2 source health ${field} must be a non-negative safe integer`)
    }
  }
  for (const field of ["service_status", "stream_epoch", "continuity_status", "last_incident"]) {
    if (typeof health[field] !== "string") throw new Error(`L2 source health ${field} must be text`)
  }
  return {
    schema_version: "trade.l2-health.v1",
    symbol: expectedSymbol,
    service_status: String(health.service_status),
    stream_epoch: String(health.stream_epoch),
    continuity_status: String(health.continuity_status),
    source_ready: Boolean(health.source_ready),
    raw_writer_ready: Boolean(health.raw_writer_ready),
    projector_ready: Boolean(health.projector_ready),
    read_ready: Boolean(health.read_ready),
    broker_enabled: Boolean(health.broker_enabled),
    broker_ready: Boolean(health.broker_ready),
    last_update_id: Number(health.last_update_id),
    last_receive_time_ms: Number(health.last_receive_time_ms),
    freshness_ms: Number(health.freshness_ms),
    incident_count: Number(health.incident_count),
    last_incident: String(health.last_incident),
  }
}

function limitations(): string[] {
  return [
    "local-process-and-loopback-health-only",
    "local-command-identity-check-is-not-cryptographic-attestation",
    "health-does-not-prove-external-market-data-completeness",
    "no-start-stop-restart-signal-or-lifecycle-authority",
    "no-trading-replay-fill-or-economic-authority",
  ]
}

function boundedError(value: string): string {
  return value.trim().slice(0, 2_000)
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be RFC 3339 UTC`)
}
