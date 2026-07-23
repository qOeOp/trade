import { accessSync, constants, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { serverRuntimeProfileHash } from "./server-runtime-profile"
import { SERVER_RUNTIME_LAUNCHD_LABELS } from "./server-runtime-launchd"
import { isMacOsProtectedUserPath } from "./macos-protected-path"

export interface ServerRuntimeCommandResult {
  exit_code: number
  stdout: string
}

export type ServerRuntimeCommandExecutor = (command: string[], cwd: string, timeoutMs: number) => ServerRuntimeCommandResult

export interface ServerRuntimePreflightDependencies {
  path_check?: (checkId: string, path: string, executable?: boolean) => JSONRecord
  writable_directory_check?: (checkId: string, path: string) => JSONRecord
  launchd_source_check?: (root: string) => JSONRecord
  listener_check?: (listen: string) => JSONRecord
}

export interface ServerRuntimeStatus extends JSONRecord {
  schema_version: "trade.server-runtime-status.v1"
  observed_at: string
  profile_id: string
  deployment_id: string
  profile_hash: string
  status: "ready" | "degraded" | "not_ready"
  readiness: {
    l2_owner_ready: boolean
    l2_consumer_ready: boolean
    l2_epoch_matches_consumer: boolean
    control_lease_active: boolean
    process_manager_observable: boolean
    process_units_active: boolean
    overall_ready: boolean
  }
  components: {
    l2_owner: JSONRecord
    l2_consumer: JSONRecord
    control_runtime: JSONRecord
  }
  process_units: Record<string, JSONRecord>
  limitations: string[]
}

export function preflightServerRuntime(
  profile: ServerRuntimeProfile,
  root: string,
  bunPath: string,
  dependencies: ServerRuntimePreflightDependencies = {},
): JSONRecord {
  const checkPath = dependencies.path_check ?? pathCheck
  const checkWritable = dependencies.writable_directory_check ?? writableDirectoryCheck
  const checkLaunchdSource = dependencies.launchd_source_check ?? launchdSourceCheck
  const checkListener = dependencies.listener_check ?? listenerAvailabilityCheck
  const checks = [
    checkPath("bun_executable", bunPath, true),
    checkPath("l2_foreground_entry", resolve(root, "modules/market-data-products/l2-order-book-service/src/scripts/foreground.ts")),
    checkPath("l2_service_binary", resolve(root, "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-service"), true),
    checkPath("l2_query_binary", resolve(root, "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-query"), true),
    checkPath("consumer_foreground_entry", resolve(root, "modules/orchestration-ops/l2-current-book-probe/src/scripts/consumer-foreground.ts")),
    checkPath("control_runtime_entry", resolve(root, "modules/orchestration-ops/trade-flow/src/scripts/main.ts")),
    checkWritable("data_root_writable", resolve(root, "data")),
    checkWritable("runtime_root_writable", resolve(root, "tmp")),
    checkWritable("market_db_parent_writable", dirname(resolve(root, profile.l2_owner.market_data_db))),
    checkWritable("trade_db_parent_writable", dirname(resolve(root, profile.control_runtime.trade_db))),
    checkWritable("ops_db_parent_writable", dirname(resolve(root, profile.control_runtime.ops_runtime_db))),
    checkListener(profile.l2_owner.listen),
    {
      check_id: "safety_closed_world",
      status: profile.safety.domain_jobs_enabled === false
        && profile.safety.live_writes_allowed === false
        && profile.safety.notify_dry_run === true ? "ok" : "blocked",
      reason: "profile safety is fixed to no-domain-job, no-live-write, dry-run notification",
    },
    ...(profile.process_manager.target === "launchd" ? [checkLaunchdSource(root)] : []),
  ]
  return {
    schema_version: "trade.server-runtime-preflight.v1",
    profile_id: profile.profile_id,
    deployment_id: profile.deployment_id,
    profile_hash: serverRuntimeProfileHash(profile),
    status: checks.every((check) => check.status === "ok") ? "ready" : "blocked",
    checks,
    limitations: [
      "filesystem_and_release_preflight_only",
      "owner_database_integrity_requires_owner_migration_or_check",
      "preflight_does_not_start_or_signal_processes",
    ],
  }
}

export function readServerRuntimeStatus(
  profile: ServerRuntimeProfile,
  root: string,
  bunPath: string,
  execute: ServerRuntimeCommandExecutor = executeFixedCommand,
  observedAt = new Date().toISOString(),
): ServerRuntimeStatus {
  const l2Envelope = ownerRead(execute, [
    bunPath,
    resolve(root, "modules/market-data-products/l2-order-book-service/src/scripts/owner-health.ts"),
  ], root)
  const consumerEnvelope = ownerRead(execute, [
    bunPath,
    resolve(root, "modules/orchestration-ops/l2-current-book-probe/src/scripts/consumer-read.ts"),
  ], root)
  const parityEnvelope = ownerRead(execute, [
    bunPath,
    resolve(root, "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts"),
    "--db", profile.control_runtime.ops_runtime_db,
    "--action", "parity_status",
    "--json", JSON.stringify({ as_of: observedAt }),
  ], root)
  const units = Object.fromEntries(processManagerUnits(profile).map((unit) => [
    unit,
    unitState(execute, profile.process_manager.target, unit, root),
  ]))

  const l2 = record(l2Envelope.health)
  const consumer = record(consumerEnvelope.consumer)
  const l2Ready = record(l2.readiness).overall_ready === true
  const consumerReady = record(consumer.readiness).overall_ready === true
  const l2Epoch = stringField(record(l2.source).stream_epoch)
  const consumerEpoch = stringField(record(consumer.latest_baseline).stream_epoch)
  const epochsMatch = Boolean(l2Epoch && consumerEpoch && l2Epoch === consumerEpoch)
  const parity = record(parityEnvelope.parity_status)
  const controlLeaseActive = record(parity.supervisor_lease).active === true
  const unitValues = Object.values(units) as JSONRecord[]
  const managerObservable = unitValues.every((unit) => unit.status !== "unavailable")
  const unitsActive = managerObservable && unitValues.every((unit) => unit.status === "active")
  const ownerReady = l2Ready && consumerReady && epochsMatch && controlLeaseActive
  const status = ownerReady && unitsActive ? "ready"
    : ownerReady && !managerObservable ? "degraded"
      : "not_ready"
  return {
    schema_version: "trade.server-runtime-status.v1",
    observed_at: observedAt,
    profile_id: profile.profile_id,
    deployment_id: profile.deployment_id,
    profile_hash: serverRuntimeProfileHash(profile),
    status,
    readiness: {
      l2_owner_ready: l2Ready,
      l2_consumer_ready: consumerReady,
      l2_epoch_matches_consumer: epochsMatch,
      control_lease_active: controlLeaseActive,
      process_manager_observable: managerObservable,
      process_units_active: unitsActive,
      overall_ready: status === "ready",
    },
    components: {
      l2_owner: safeOwnerProjection(l2Envelope, "health"),
      l2_consumer: safeOwnerProjection(consumerEnvelope, "consumer"),
      control_runtime: safeOwnerProjection(parityEnvelope, "parity_status"),
    },
    process_units: units,
    limitations: [
      "aggregate_read_only_status",
      "owner_health_is_not_reimplemented",
      "degraded_when_process_manager_is_not_observable",
      "no_lifecycle_or_live_write_authority",
    ],
  }
}

function ownerRead(execute: ServerRuntimeCommandExecutor, command: string[], cwd: string): JSONRecord {
  const result = execute(command, cwd, 5_000)
  if (result.exit_code !== 0) return unavailable("owner_command_failed")
  try {
    const parsed = JSON.parse(result.stdout) as JSONRecord
    return parsed.ok === true ? parsed : unavailable("owner_returned_error")
  } catch {
    return unavailable("owner_response_invalid")
  }
}

function processManagerUnits(profile: ServerRuntimeProfile): string[] {
  return profile.process_manager.target === "systemd"
    ? ["trade-l2-owner.service", "trade-l2-consumer.service", "trade-control-runtime.service"]
    : Object.values(SERVER_RUNTIME_LAUNCHD_LABELS)
}

function unitState(
  execute: ServerRuntimeCommandExecutor,
  target: ServerRuntimeProfile["process_manager"]["target"],
  unit: string,
  cwd: string,
): JSONRecord {
  if (target === "launchd") {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined
    if (uid === undefined) return { status: "unavailable", reason: "launchd_user_domain_unavailable" }
    const result = execute(["launchctl", "print", `gui/${uid}/${unit}`], cwd, 3_000)
    if (result.exit_code !== 0) return { status: "unavailable", reason: "process_manager_unavailable" }
    const state = /\bstate\s*=\s*(running|waiting|exited)\b/.exec(result.stdout)?.[1]
    if (state === "running") return { status: "active" }
    if (state === "waiting" || state === "exited") return { status: "inactive" }
    return { status: "unavailable", reason: "unit_state_invalid" }
  }
  const result = execute(["systemctl", "show", unit, "--property=ActiveState", "--value"], cwd, 3_000)
  if (result.exit_code !== 0) return { status: "unavailable", reason: "process_manager_unavailable" }
  const state = result.stdout.trim()
  return ["active", "activating", "deactivating", "failed", "inactive"].includes(state)
    ? { status: state }
    : { status: "unavailable", reason: "unit_state_invalid" }
}

function executeFixedCommand(command: string[], cwd: string, timeoutMs: number): ServerRuntimeCommandResult {
  try {
    const result = Bun.spawnSync({ cmd: command, cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs })
    return { exit_code: result.exitCode, stdout: result.stdout.toString() }
  } catch {
    return { exit_code: 127, stdout: "" }
  }
}

function safeOwnerProjection(envelope: JSONRecord, field: string): JSONRecord {
  const projection = record(envelope[field])
  return Object.keys(projection).length > 0 ? projection : unavailable(stringField(envelope.reason) || "owner_unavailable")
}

function unavailable(reason: string): JSONRecord {
  return { status: "unavailable", reason }
}

function pathCheck(checkId: string, path: string, executable = false): JSONRecord {
  if (!existsSync(path)) return { check_id: checkId, status: "blocked", reason: "missing" }
  try {
    accessSync(path, executable ? constants.R_OK | constants.X_OK : constants.R_OK)
    return { check_id: checkId, status: "ok", reason: executable ? "readable_executable" : "readable" }
  } catch {
    return { check_id: checkId, status: "blocked", reason: executable ? "not_executable" : "not_readable" }
  }
}

function writableDirectoryCheck(checkId: string, path: string): JSONRecord {
  if (!existsSync(path)) return { check_id: checkId, status: "blocked", reason: "missing" }
  try {
    accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK)
    return { check_id: checkId, status: "ok", reason: "writable" }
  } catch {
    return { check_id: checkId, status: "blocked", reason: "not_writable" }
  }
}

function launchdSourceCheck(root: string): JSONRecord {
  if (!isMacOsProtectedUserPath(root, homedir())) {
    return { check_id: "launchd_source_privacy", status: "ok", reason: "source_root_not_macos_protected" }
  }
  if (process.env.TRADE_ALLOW_PROTECTED_LAUNCHD_PATH === "1") {
    return { check_id: "launchd_source_privacy", status: "ok", reason: "explicit_privacy_grant_acknowledged" }
  }
  return {
    check_id: "launchd_source_privacy",
    status: "blocked",
    reason: "protected_source_root_requires_privacy_grant_or_release_relocation",
  }
}

function listenerAvailabilityCheck(listen: string): JSONRecord {
  const port = listen.slice(listen.lastIndexOf(":") + 1)
  const lsof = existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : existsSync("/usr/bin/lsof") ? "/usr/bin/lsof" : ""
  if (!lsof) return { check_id: "l2_listener_available", status: "blocked", reason: "listener_probe_unavailable" }
  const result = spawnSync(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status === 1 && !result.stdout.trim()) {
    return { check_id: "l2_listener_available", status: "ok", reason: "no_listening_process" }
  }
  if (result.status === 0 && result.stdout.trim()) {
    return { check_id: "l2_listener_available", status: "blocked", reason: "listener_already_in_use" }
  }
  return { check_id: "l2_listener_available", status: "blocked", reason: "listener_availability_unknown" }
}

function record(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
