#!/usr/bin/env bun

import { existsSync, renameSync, statfsSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_RUNTIME_STATE_SCHEMA,
  L2_TERMINAL_STATE_SCHEMA,
  assertMarketDataDbRef,
  assertOutputRef,
  assertRuntimeRef,
  validateLaunchConfig,
  type LaunchConfig,
  type RuntimeState,
} from "../control/runtime-contract"

const root = repoRoot()
const args = parseArgs(process.argv.slice(2))
const runtimeDirectory = assertRuntimeRef(root, args.runtimeDir)
const binary = resolve(root, args.serviceBinary)
const config = JSON.parse(args.config) as LaunchConfig
validateLaunchConfig(config)
const outputPath = assertOutputRef(root, config.output_base)
assertMarketDataDbRef(root, config.market_data_db)
const statePath = resolve(runtimeDirectory, "runtime-state.json")
const terminalPath = resolve(runtimeDirectory, "terminal-state.json")
let child: ReturnType<typeof Bun.spawn> | undefined
let stopRequested = false
let signalName = ""
let fatalReason = ""
let diskStatus: RuntimeState["disk_status"] = "unknown"
let diskAvailableBytes: number | null = null
let admissionStatus: RuntimeState["admission_status"] = config.admission_interval_ms === 0 ? "disabled" : "pending"
let admissionLastCheckedAt: string | null = null
let admissionLastError = ""
let admissionCreatedTotal = 0
let admissionRejectedIncompleteTotal = 0
let admissionRejectedInvalidTotal = 0
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopRequested = true
    signalName = signal
    writeState("stopping", null)
    child?.kill("SIGTERM")
  })
}

let attempt = 0
let consecutiveFailures = 0
let lastExitCode: number | null = null
let terminalStatus: "completed" | "failed" = "failed"
let terminalReason = "supervisor_failed"
try {
  while (!stopRequested) {
    if (sampleDisk() === "hard_limit") {
      terminalReason = `disk_hard_limit:${diskAvailableBytes ?? "unknown"}`
      break
    }
    if (config.admission_interval_ms > 0 && admissionLastCheckedAt == null) runAdmission()
    attempt += 1
    writeState("starting", null)
    child = Bun.spawn({
      cmd: [
        binary,
        "--yes-public-network",
        "--symbol", config.symbol,
        "--output-base", config.output_base,
        "--listen", config.listen,
        "--queue-capacity", String(config.queue_capacity),
        "--segment-frames", String(config.segment_frames),
        "--sync-every-frames", String(config.sync_every_frames),
        "--stale-after-ms", String(config.stale_after_ms),
        "--epoch-seconds", String(config.epoch_seconds),
        "--duration-seconds", String(config.duration_seconds),
      ],
      cwd: root,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    })
    const childStartedAt = Date.now()
    writeState("running", null)
    let lastDiskCheckAt = Date.now()
    let lastAdmissionCheckAt = Date.now()
    const monitor = setInterval(() => {
      const now = Date.now()
      if (now - lastDiskCheckAt >= config.disk_check_interval_ms) {
        lastDiskCheckAt = now
        if (sampleDisk() === "hard_limit" && !fatalReason) {
          fatalReason = `disk_hard_limit:${diskAvailableBytes ?? "unknown"}`
          child?.kill("SIGTERM")
        }
      }
      if (config.admission_interval_ms > 0 && now - lastAdmissionCheckAt >= config.admission_interval_ms) {
        lastAdmissionCheckAt = now
        runAdmission()
      }
      writeState(fatalReason ? "stopping" : "running", null)
    }, Math.min(config.disk_check_interval_ms, config.admission_interval_ms || config.disk_check_interval_ms))
    lastExitCode = await child.exited
    clearInterval(monitor)
    child = undefined
    if (config.admission_interval_ms > 0) runAdmission()
    if (fatalReason) {
      terminalReason = fatalReason
      break
    }
    if (stopRequested) {
      terminalStatus = "completed"
      terminalReason = signalName || "operator_stop"
      break
    }
    if (config.duration_seconds > 0 && lastExitCode === 0) {
      terminalStatus = "completed"
      terminalReason = "requested_duration_elapsed"
      break
    }
    consecutiveFailures = Date.now() - childStartedAt >= 60_000 ? 1 : consecutiveFailures + 1
    if (config.restart_limit > 0 && consecutiveFailures > config.restart_limit) {
      terminalReason = "restart_limit_exceeded"
      break
    }
    const delayMs = Math.min(30_000, 250 * 2 ** Math.min(consecutiveFailures - 1, 7))
    const nextRestart = new Date(Date.now() + delayMs).toISOString()
    writeState("backoff", nextRestart)
    await Bun.sleep(delayMs)
  }
} catch (error) {
  terminalReason = error instanceof Error ? error.message : String(error)
} finally {
  if (child != null) {
    child.kill("SIGTERM")
    lastExitCode = await child.exited
  }
  writeFileSync(terminalPath, `${JSON.stringify({
    schema_version: L2_TERMINAL_STATE_SCHEMA,
    finished_at: new Date().toISOString(),
    status: terminalStatus,
    reason: terminalReason,
    supervisor_pid: process.pid,
    attempts: attempt,
    last_exit_code: lastExitCode,
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 })
}
if (terminalStatus === "failed") process.exitCode = 1

function writeState(status: RuntimeState["status"], nextRestartAt: string | null): void {
  const state: RuntimeState = {
    schema_version: L2_RUNTIME_STATE_SCHEMA,
    updated_at: new Date().toISOString(),
    status,
    supervisor_pid: process.pid,
    service_pid: child?.pid ?? null,
    attempt,
    consecutive_failures: consecutiveFailures,
    last_exit_code: lastExitCode,
    next_restart_at: nextRestartAt,
    disk_status: diskStatus,
    disk_available_bytes: diskAvailableBytes,
    admission_status: admissionStatus,
    admission_last_checked_at: admissionLastCheckedAt,
    admission_last_error: admissionLastError,
    admission_created_total: admissionCreatedTotal,
    admission_rejected_incomplete_total: admissionRejectedIncompleteTotal,
    admission_rejected_invalid_total: admissionRejectedInvalidTotal,
  }
  const temporary = `${statePath}.tmp.${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  renameSync(temporary, statePath)
}

function sampleDisk(): RuntimeState["disk_status"] {
  try {
    const stats = statfsSync(existingAncestor(outputPath))
    const available = Number(stats.bavail) * Number(stats.bsize)
    if (!Number.isSafeInteger(available) || available < 0) throw new Error("filesystem returned invalid available bytes")
    diskAvailableBytes = available
    diskStatus = available <= config.disk_hard_min_bytes ? "hard_limit"
      : available <= config.disk_soft_min_bytes ? "soft_limit" : "healthy"
  } catch (error) {
    diskAvailableBytes = null
    diskStatus = "unknown"
    admissionLastError = `disk_status:${error instanceof Error ? error.message : String(error)}`
  }
  return diskStatus
}

function runAdmission(): void {
  admissionLastCheckedAt = new Date().toISOString()
  const ownerScript = resolve(root, "modules/market-data-products/market-data-store/src/scripts/main.ts")
  const invocation = Bun.spawnSync({
    cmd: [
      process.execPath,
      ownerScript,
      "--db", config.market_data_db,
      "--action", "reconcile_l2_epoch_manifests",
      "--json", JSON.stringify({ scan_roots: [config.output_base], observed_at: admissionLastCheckedAt }),
    ],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    timeout: Math.min(30_000, Math.max(5_000, config.admission_interval_ms)),
  })
  if (invocation.exitCode !== 0) {
    admissionStatus = "degraded"
    admissionLastError = invocation.stderr.toString().trim() || invocation.stdout.toString().trim() || `owner exit ${invocation.exitCode}`
    return
  }
  try {
    const response = JSON.parse(invocation.stdout.toString()) as { result?: Record<string, unknown> }
    const result = response.result ?? {}
    admissionCreatedTotal += safeCount(result.created)
    admissionRejectedIncompleteTotal += safeCount(result.rejected_incomplete)
    admissionRejectedInvalidTotal += safeCount(result.rejected_invalid)
    admissionStatus = safeCount(result.rejected_invalid) > 0 ? "degraded" : "ready"
    admissionLastError = admissionStatus === "degraded" ? JSON.stringify(result.problems ?? []) : ""
  } catch (error) {
    admissionStatus = "degraded"
    admissionLastError = `invalid owner response: ${error instanceof Error ? error.message : String(error)}`
  }
}

function existingAncestor(path: string): string {
  let current = path
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current)
  if (!existsSync(current)) throw new Error("no existing ancestor for L2 output path")
  return current
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function parseArgs(argv: string[]): { runtimeDir: string; serviceBinary: string; config: string } {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) throw new Error(`incomplete supervisor argument: ${name ?? "<missing>"}`)
    values[name.slice(2).replaceAll("-", "_")] = value
  }
  if (!values.runtime_dir || !values.service_binary || !values.config) throw new Error("runtime-dir, service-binary, and config are required")
  return { runtimeDir: values.runtime_dir, serviceBinary: values.service_binary, config: values.config }
}

process.stdout.write(`${JSON.stringify({ event: "supervisor_terminal", runtime_directory: relative(root, runtimeDirectory), status: terminalStatus })}\n`)
