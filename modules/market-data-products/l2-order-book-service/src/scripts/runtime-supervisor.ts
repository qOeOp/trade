#!/usr/bin/env bun

import { renameSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_RUNTIME_STATE_SCHEMA,
  L2_TERMINAL_STATE_SCHEMA,
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
assertOutputRef(root, config.output_base)
const statePath = resolve(runtimeDirectory, "runtime-state.json")
const terminalPath = resolve(runtimeDirectory, "terminal-state.json")
let child: ReturnType<typeof Bun.spawn> | undefined
let stopRequested = false
let signalName = ""
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
    lastExitCode = await child.exited
    child = undefined
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
  }
  const temporary = `${statePath}.tmp.${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  renameSync(temporary, statePath)
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
