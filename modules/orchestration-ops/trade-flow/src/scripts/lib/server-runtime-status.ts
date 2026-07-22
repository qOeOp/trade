import { accessSync, constants, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { serverRuntimeProfileHash } from "./server-runtime-profile"

export interface ServerRuntimeCommandResult {
  exit_code: number
  stdout: string
}

export type ServerRuntimeCommandExecutor = (command: string[], cwd: string, timeoutMs: number) => ServerRuntimeCommandResult

export interface ServerRuntimePreflightDependencies {
  path_check?: (checkId: string, path: string, executable?: boolean) => JSONRecord
  writable_directory_check?: (checkId: string, path: string) => JSONRecord
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
    {
      check_id: "safety_closed_world",
      status: profile.safety.domain_jobs_enabled === false
        && profile.safety.live_writes_allowed === false
        && profile.safety.notify_dry_run === true ? "ok" : "blocked",
      reason: "profile safety is fixed to no-domain-job, no-live-write, dry-run notification",
    },
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
  const units = Object.fromEntries([
    "trade-l2-owner.service",
    "trade-l2-consumer.service",
    "trade-control-runtime.service",
  ].map((unit) => [unit, unitState(execute, unit, root)]))

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
      "degraded_when_systemd_is_not_observable",
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

function unitState(execute: ServerRuntimeCommandExecutor, unit: string, cwd: string): JSONRecord {
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

function record(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
