import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"

export const SERVER_RUNTIME_PROFILE_SCHEMA = "trade.server-runtime-profile.v1" as const

export function defaultServerRuntimeProfileRef(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? "profile/server-runtime-macos.json" : "profile/server-runtime.json"
}

export interface ServerRuntimeProfile {
  schema_version: typeof SERVER_RUNTIME_PROFILE_SCHEMA
  profile_id: string
  deployment_id: string
  l2_owner: {
    symbol: string
    output_base: string
    listen: string
    epoch_seconds: number
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
    resource_check_interval_ms: number
  }
  l2_consumer: {
    max_cycles: number
    session_ms: number
    max_events: number
    watch_ms: number
    depth: number
    max_freshness_ms: number
    restart_limit: number
  }
  control_runtime: {
    trade_db: string
    ops_runtime_db: string
    interval_seconds: number
    observe_agent_parity: boolean
  }
  process_manager: {
    target: "systemd" | "launchd"
    service_user: string
    service_group: string
    restart_seconds: number
    start_limit_burst: number
    start_limit_interval_seconds: number
    shutdown_grace_seconds: number
  }
  safety: {
    domain_jobs_enabled: false
    live_writes_allowed: false
    notify_dry_run: true
  }
}

export function parseServerRuntimeProfile(value: unknown): ServerRuntimeProfile {
  const root = record(value, "profile")
  exactKeys(root, [
    "schema_version", "profile_id", "deployment_id", "l2_owner", "l2_consumer",
    "control_runtime", "process_manager", "safety",
  ], "profile")
  if (root.schema_version !== SERVER_RUNTIME_PROFILE_SCHEMA) throw new Error("unsupported server runtime profile schema")
  const profileId = identifier(root.profile_id, "profile_id")
  const deploymentId = identifier(root.deployment_id, "deployment_id")
  const l2Owner = record(root.l2_owner, "l2_owner")
  exactKeys(l2Owner, [
    "symbol", "output_base", "listen", "epoch_seconds", "queue_capacity", "segment_frames",
    "sync_every_frames", "stale_after_ms", "restart_limit", "market_data_db",
    "admission_interval_ms", "disk_check_interval_ms", "disk_soft_min_bytes",
    "disk_hard_min_bytes", "resource_check_interval_ms",
  ], "l2_owner")
  const l2Consumer = record(root.l2_consumer, "l2_consumer")
  exactKeys(l2Consumer, [
    "max_cycles", "session_ms", "max_events", "watch_ms", "depth", "max_freshness_ms", "restart_limit",
  ], "l2_consumer")
  const controlRuntime = record(root.control_runtime, "control_runtime")
  exactKeys(controlRuntime, ["trade_db", "ops_runtime_db", "interval_seconds", "observe_agent_parity"], "control_runtime")
  const processManager = record(root.process_manager, "process_manager")
  exactKeys(processManager, [
    "target", "service_user", "service_group", "restart_seconds", "start_limit_burst",
    "start_limit_interval_seconds", "shutdown_grace_seconds",
  ], "process_manager")
  const safety = record(root.safety, "safety")
  exactKeys(safety, ["domain_jobs_enabled", "live_writes_allowed", "notify_dry_run"], "safety")

  if (!/^[A-Z0-9]{5,20}$/.test(text(l2Owner.symbol, "l2_owner.symbol"))) throw new Error("l2_owner.symbol is invalid")
  const outputBase = runtimeRef(l2Owner.output_base, "l2_owner.output_base", ["data/l2"])
  const listen = text(l2Owner.listen, "l2_owner.listen")
  if (!/^127\.0\.0\.1:\d{1,5}$/.test(listen)) throw new Error("l2_owner.listen must be loopback IPv4")
  const port = Number(listen.slice(listen.lastIndexOf(":") + 1))
  integer(port, 1, 65_535, "l2_owner.listen port")
  const marketDataDb = runtimeRef(l2Owner.market_data_db, "l2_owner.market_data_db", ["data/"])
  if (!marketDataDb.endsWith(".db")) throw new Error("l2_owner.market_data_db must end in .db")
  const softBytes = integer(l2Owner.disk_soft_min_bytes, 1, Number.MAX_SAFE_INTEGER, "l2_owner.disk_soft_min_bytes")
  const hardBytes = integer(l2Owner.disk_hard_min_bytes, 1, softBytes, "l2_owner.disk_hard_min_bytes")
  const sessionMs = integer(l2Consumer.session_ms, 2_000, 300_000, "l2_consumer.session_ms")
  const watchMs = integer(l2Consumer.watch_ms, 100, 5_000, "l2_consumer.watch_ms")
  if (sessionMs < watchMs + 3_000) throw new Error("l2_consumer.session_ms must cover snapshot and watch")
  const processManagerTarget = enumValue(processManager.target, ["systemd", "launchd"] as const, "process_manager.target")
  const serviceUser = serviceIdentity(processManager.service_user, "process_manager.service_user")
  const serviceGroup = serviceIdentity(processManager.service_group, "process_manager.service_group")
  if (processManagerTarget === "launchd" && (serviceUser !== "current" || serviceGroup !== "current")) {
    throw new Error("launchd profile service identity must be current/current")
  }
  if (processManagerTarget === "systemd" && (serviceUser === "current" || serviceGroup === "current")) {
    throw new Error("systemd profile requires an explicit service identity")
  }
  if (safety.domain_jobs_enabled !== false || safety.live_writes_allowed !== false || safety.notify_dry_run !== true) {
    throw new Error("server shadow safety cannot enable domain jobs, live writes, or real notifications")
  }
  if (typeof controlRuntime.observe_agent_parity !== "boolean") throw new Error("control_runtime.observe_agent_parity must be boolean")

  const profile: ServerRuntimeProfile = {
    schema_version: SERVER_RUNTIME_PROFILE_SCHEMA,
    profile_id: profileId,
    deployment_id: deploymentId,
    l2_owner: {
      symbol: text(l2Owner.symbol, "l2_owner.symbol"),
      output_base: outputBase,
      listen,
      epoch_seconds: integer(l2Owner.epoch_seconds, 5, 86_400, "l2_owner.epoch_seconds"),
      queue_capacity: integer(l2Owner.queue_capacity, 1, 1_000_000, "l2_owner.queue_capacity"),
      segment_frames: integer(l2Owner.segment_frames, 1, 1_000_000, "l2_owner.segment_frames"),
      sync_every_frames: integer(l2Owner.sync_every_frames, 1, Number(l2Owner.segment_frames), "l2_owner.sync_every_frames"),
      stale_after_ms: integer(l2Owner.stale_after_ms, 100, 60_000, "l2_owner.stale_after_ms"),
      restart_limit: integer(l2Owner.restart_limit, 1, 1_000_000, "l2_owner.restart_limit"),
      market_data_db: marketDataDb,
      admission_interval_ms: integer(l2Owner.admission_interval_ms, 1_000, 3_600_000, "l2_owner.admission_interval_ms"),
      disk_check_interval_ms: integer(l2Owner.disk_check_interval_ms, 1_000, 3_600_000, "l2_owner.disk_check_interval_ms"),
      disk_soft_min_bytes: softBytes,
      disk_hard_min_bytes: hardBytes,
      resource_check_interval_ms: integer(l2Owner.resource_check_interval_ms, 1_000, 3_600_000, "l2_owner.resource_check_interval_ms"),
    },
    l2_consumer: {
      max_cycles: integer(l2Consumer.max_cycles, 1, 120, "l2_consumer.max_cycles"),
      session_ms: sessionMs,
      max_events: integer(l2Consumer.max_events, 1, 100, "l2_consumer.max_events"),
      watch_ms: watchMs,
      depth: integer(l2Consumer.depth, 1, 100, "l2_consumer.depth"),
      max_freshness_ms: integer(l2Consumer.max_freshness_ms, 100, 2_000, "l2_consumer.max_freshness_ms"),
      restart_limit: integer(l2Consumer.restart_limit, 1, 1_000_000, "l2_consumer.restart_limit"),
    },
    control_runtime: {
      trade_db: dbRef(controlRuntime.trade_db, "control_runtime.trade_db"),
      ops_runtime_db: dbRef(controlRuntime.ops_runtime_db, "control_runtime.ops_runtime_db"),
      interval_seconds: integer(controlRuntime.interval_seconds, 1, 3_600, "control_runtime.interval_seconds"),
      observe_agent_parity: controlRuntime.observe_agent_parity,
    },
    process_manager: {
      target: processManagerTarget,
      service_user: serviceUser,
      service_group: serviceGroup,
      restart_seconds: integer(processManager.restart_seconds, 1, 300, "process_manager.restart_seconds"),
      start_limit_burst: integer(processManager.start_limit_burst, 1, 100, "process_manager.start_limit_burst"),
      start_limit_interval_seconds: integer(processManager.start_limit_interval_seconds, 1, 3_600, "process_manager.start_limit_interval_seconds"),
      shutdown_grace_seconds: integer(processManager.shutdown_grace_seconds, 5, 300, "process_manager.shutdown_grace_seconds"),
    },
    safety: {
      domain_jobs_enabled: false,
      live_writes_allowed: false,
      notify_dry_run: true,
    },
  }
  if (profile.control_runtime.trade_db === profile.control_runtime.ops_runtime_db
    || profile.control_runtime.trade_db === profile.l2_owner.market_data_db
    || profile.control_runtime.ops_runtime_db === profile.l2_owner.market_data_db) {
    throw new Error("owner databases must use distinct paths")
  }
  return profile
}

export function serverRuntimeProfileHash(profile: ServerRuntimeProfile): string {
  return canonicalHash(profile)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !expected.has(key))
  const missing = allowed.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() !== value || !value) throw new Error(`${field} must be a non-empty trimmed string`)
  if (/[\n\r\0]/.test(value)) throw new Error(`${field} contains a forbidden control character`)
  return value
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function serviceIdentity(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  const result = text(value, field)
  if (!allowed.includes(result)) throw new Error(`${field} must be one of: ${allowed.join(", ")}`)
  return result as T[number]
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return Number(value)
}

function runtimeRef(value: unknown, field: string, prefixes: string[]): string {
  const result = text(value, field).replaceAll("\\", "/")
  if (result.startsWith("/") || result.split("/").includes("..") || !prefixes.some((prefix) => result.startsWith(prefix))) {
    throw new Error(`${field} must be a repository runtime ref`)
  }
  return result
}

function dbRef(value: unknown, field: string): string {
  const result = runtimeRef(value, field, ["data/", "tmp/"])
  if (!result.endsWith(".db")) throw new Error(`${field} must end in .db`)
  return result
}
