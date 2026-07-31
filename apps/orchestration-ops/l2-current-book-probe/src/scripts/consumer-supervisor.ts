#!/usr/bin/env bun

import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_WATCH_CONSUMER_RUNTIME_SCHEMA,
  L2_WATCH_CONSUMER_TERMINAL_SCHEMA,
  assertL2WatchConsumerRuntimeRef,
  atomicWriteJson,
  validateL2WatchConsumerConfig,
  type L2WatchConsumerConfig,
  type L2WatchConsumerRuntimeState,
} from "../lib/l2-book-watch-consumer-runtime"

const root = repoRoot()
const args = parseArgs(process.argv.slice(2))
const runtimeDirectory = assertL2WatchConsumerRuntimeRef(root, args.runtimeDir)
const runtimeStatePath = resolve(runtimeDirectory, "runtime-state.json")
const terminalStatePath = resolve(runtimeDirectory, "terminal-state.json")
const workerScript = resolve(import.meta.dir, "consumer-worker.ts")
const config = JSON.parse(args.config) as L2WatchConsumerConfig
validateL2WatchConsumerConfig(config)
const startedAt = Date.now()
let child: ReturnType<typeof Bun.spawn> | undefined
let stopRequested = false
let terminalStatus: "completed" | "failed" = "failed"
let terminalReason = "supervisor_failed"
let attempt = 0
let consecutiveFailures = 0
let lastExitCode: number | null = null

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopRequested = true
    terminalReason = signal
    writeState("stopping", null)
    child?.kill("SIGTERM")
  })
}

try {
  while (!stopRequested) {
    attempt += 1
    writeState("starting", null)
    child = Bun.spawn({
      cmd: [
        process.execPath, workerScript,
        "--runtime-dir", args.runtimeDir,
        "--config", JSON.stringify(config),
        "--worker-attempt", String(attempt),
      ],
      cwd: root,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    })
    const childStartedAt = Date.now()
    writeState("running", null)
    const monitor = setInterval(() => {
      if (config.duration_seconds > 0 && Date.now() - startedAt >= config.duration_seconds * 1_000) {
        stopRequested = true
        terminalReason = "requested_duration_elapsed"
        child?.kill("SIGTERM")
      }
      writeState(stopRequested ? "stopping" : "running", null)
    }, 1_000)
    lastExitCode = await child.exited
    clearInterval(monitor)
    child = undefined
    if (stopRequested) {
      terminalStatus = "completed"
      break
    }
    consecutiveFailures = Date.now() - childStartedAt >= 60_000 ? 1 : consecutiveFailures + 1
    if (config.restart_limit > 0 && consecutiveFailures > config.restart_limit) {
      terminalReason = "restart_limit_exceeded"
      break
    }
    const delayMs = Math.min(30_000, 250 * 2 ** Math.min(consecutiveFailures - 1, 7))
    writeState("backoff", new Date(Date.now() + delayMs).toISOString())
    await Bun.sleep(delayMs)
  }
} catch {
  terminalReason = "supervisor_internal_failure"
} finally {
  if (child != null) {
    child.kill("SIGTERM")
    lastExitCode = await child.exited
  }
  writeState("stopping", null)
  writeFileSync(terminalStatePath, `${JSON.stringify({
    schema_version: L2_WATCH_CONSUMER_TERMINAL_SCHEMA,
    finished_at: new Date().toISOString(),
    status: terminalStatus,
    reason: terminalReason,
    supervisor_pid: process.pid,
    attempts: attempt,
    last_exit_code: lastExitCode,
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 })
}
if (terminalStatus === "failed") process.exitCode = 1

function writeState(status: L2WatchConsumerRuntimeState["status"], nextRestartAt: string | null): void {
  atomicWriteJson(runtimeStatePath, {
    schema_version: L2_WATCH_CONSUMER_RUNTIME_SCHEMA,
    updated_at: new Date().toISOString(),
    status,
    supervisor_pid: process.pid,
    consumer_pid: child?.pid ?? null,
    attempt,
    consecutive_failures: consecutiveFailures,
    last_exit_code: lastExitCode,
    next_restart_at: nextRestartAt,
  } satisfies L2WatchConsumerRuntimeState)
}

function parseArgs(argv: string[]): { runtimeDir: string; config: string } {
  return { runtimeDir: requiredArg(argv, "--runtime-dir"), config: requiredArg(argv, "--config") }
}

function requiredArg(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  const value = index < 0 ? undefined : argv[index + 1]
  if (!value) throw new Error(`${name} is required`)
  return value
}
