import { relative, resolve } from "node:path"

export const L2_LAUNCH_RECEIPT_SCHEMA = "trade.l2-service-launch-receipt.v1" as const
export const L2_RUNTIME_STATE_SCHEMA = "trade.l2-service-runtime-state.v1" as const
export const L2_TERMINAL_STATE_SCHEMA = "trade.l2-service-terminal-state.v1" as const

export interface LaunchConfig {
  symbol: string
  output_base: string
  listen: string
  epoch_seconds: number
  duration_seconds: number
  queue_capacity: number
  segment_frames: number
  sync_every_frames: number
  stale_after_ms: number
  restart_limit: number
  market_data_db: string
  admission_interval_ms: number
  disk_check_interval_ms: number
  disk_soft_min_bytes: number
  disk_hard_min_bytes: number
}

export interface LaunchReceipt {
  schema_version: typeof L2_LAUNCH_RECEIPT_SCHEMA
  launched_at: string
  supervisor_pid: number
  runtime_directory: string
  runtime_state_path: string
  terminal_state_path: string
  log_path: string
  service_binary: string
  query_binary: string
  config: LaunchConfig
}

export interface RuntimeState {
  schema_version: typeof L2_RUNTIME_STATE_SCHEMA
  updated_at: string
  status: "starting" | "running" | "backoff" | "stopping"
  supervisor_pid: number
  service_pid: number | null
  attempt: number
  consecutive_failures: number
  last_exit_code: number | null
  next_restart_at: string | null
  disk_status: "healthy" | "soft_limit" | "hard_limit" | "unknown"
  disk_available_bytes: number | null
  disk_last_error: string
  admission_status: "pending" | "ready" | "degraded" | "disabled"
  admission_last_checked_at: string | null
  admission_last_error: string
  admission_created_total: number
  admission_rejected_incomplete_total: number
  admission_rejected_invalid_total: number
}

export function assertRuntimeRef(root: string, ref: string): string {
  const path = resolve(root, ref)
  const normalized = relative(root, path).replaceAll("\\", "/")
  if (!normalized.startsWith("tmp/l2-order-book-service/") || normalized.includes("../")) {
    throw new Error("L2 control files must stay under tmp/l2-order-book-service/")
  }
  return path
}

export function assertOutputRef(root: string, ref: string): string {
  const path = resolve(root, ref)
  const normalized = relative(root, path).replaceAll("\\", "/")
  if (!(normalized === "data/l2" || normalized.startsWith("data/l2/")
    || normalized.startsWith("tmp/l2-order-book-service/")) || normalized.includes("../")) {
    throw new Error("L2 output must stay under data/l2/ or tmp/l2-order-book-service/")
  }
  return path
}

export function assertMarketDataDbRef(root: string, ref: string): string {
  const path = resolve(root, ref)
  const normalized = relative(root, path).replaceAll("\\", "/")
  if (!(normalized.startsWith("data/") || normalized.startsWith("tmp/l2-order-book-service/"))
    || normalized.includes("../") || !normalized.endsWith(".db")) {
    throw new Error("market data DB must stay under project data/ or tmp/l2-order-book-service/")
  }
  return path
}

export function validateLaunchConfig(config: LaunchConfig): void {
  if (!/^[A-Z0-9]{5,20}$/.test(config.symbol)) throw new Error("symbol must be an uppercase venue symbol")
  if (!/^127\.0\.0\.1:\d{1,5}$/.test(config.listen)) throw new Error("listen must be loopback IPv4")
  const port = Number(config.listen.split(":")[1])
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("listen port is invalid")
  bounded(config.epoch_seconds, 5, 86_400, "epoch_seconds")
  bounded(config.duration_seconds, 0, 86_400, "duration_seconds")
  bounded(config.queue_capacity, 1, 1_000_000, "queue_capacity")
  bounded(config.segment_frames, 1, 1_000_000, "segment_frames")
  bounded(config.sync_every_frames, 1, config.segment_frames, "sync_every_frames")
  bounded(config.stale_after_ms, 100, 60_000, "stale_after_ms")
  bounded(config.restart_limit, 0, 1_000_000, "restart_limit")
  bounded(config.admission_interval_ms, 0, 3_600_000, "admission_interval_ms")
  if (config.admission_interval_ms > 0 && config.admission_interval_ms < 1_000) throw new Error("admission_interval_ms must be zero or at least 1000")
  bounded(config.disk_check_interval_ms, 1_000, 3_600_000, "disk_check_interval_ms")
  bounded(config.disk_hard_min_bytes, 1, Number.MAX_SAFE_INTEGER, "disk_hard_min_bytes")
  bounded(config.disk_soft_min_bytes, config.disk_hard_min_bytes, Number.MAX_SAFE_INTEGER, "disk_soft_min_bytes")
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

function bounded(value: number, minimum: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
}
