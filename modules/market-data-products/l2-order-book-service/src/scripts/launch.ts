#!/usr/bin/env bun

import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_LAUNCH_RECEIPT_SCHEMA,
  assertOutputRef,
  assertRuntimeRef,
  validateLaunchConfig,
  type LaunchConfig,
  type LaunchReceipt,
} from "../control/runtime-contract"

const root = repoRoot()
const moduleRoot = resolve(import.meta.dir, "../..")
const config = parseArgs(process.argv.slice(2))
validateLaunchConfig(config)
assertOutputRef(root, config.output_base)

const build = Bun.spawnSync({ cmd: ["cargo", "build", "--release", "--bins"], cwd: moduleRoot, stdout: "inherit", stderr: "inherit" })
if (build.exitCode !== 0) throw new Error(`L2 release build failed with exit code ${build.exitCode}`)
const token = `${Date.now()}-${process.pid}`
const runtimeRef = `tmp/l2-order-book-service/runtime/${token}`
const runtimeDirectory = assertRuntimeRef(root, runtimeRef)
mkdirSync(runtimeDirectory, { recursive: true })
const logPath = resolve(runtimeDirectory, "supervisor.log")
const runtimeStatePath = resolve(runtimeDirectory, "runtime-state.json")
const terminalStatePath = resolve(runtimeDirectory, "terminal-state.json")
const receiptPath = resolve(runtimeDirectory, "launch-receipt.json")
const serviceBinary = resolve(moduleRoot, "target/release/l2-order-book-service")
const queryBinary = resolve(moduleRoot, "target/release/l2-order-book-query")
const descriptor = openSync(logPath, "wx", 0o600)
let supervisor: ReturnType<typeof Bun.spawn>
try {
  supervisor = Bun.spawn({
    cmd: [
      process.execPath,
      resolve(moduleRoot, "src/scripts/runtime-supervisor.ts"),
      "--runtime-dir", relative(root, runtimeDirectory),
      "--service-binary", relative(root, serviceBinary),
      "--config", JSON.stringify(config),
    ],
    cwd: root,
    stdin: "ignore",
    stdout: descriptor,
    stderr: descriptor,
    detached: true,
  })
  supervisor.unref()
} finally {
  closeSync(descriptor)
}
if (!Number.isSafeInteger(supervisor.pid) || supervisor.pid <= 1) throw new Error("detached L2 supervisor pid is invalid")
const receipt: LaunchReceipt = {
  schema_version: L2_LAUNCH_RECEIPT_SCHEMA,
  launched_at: new Date().toISOString(),
  supervisor_pid: supervisor.pid,
  runtime_directory: relative(root, runtimeDirectory),
  runtime_state_path: relative(root, runtimeStatePath),
  terminal_state_path: relative(root, terminalStatePath),
  log_path: relative(root, logPath),
  service_binary: relative(root, serviceBinary),
  query_binary: relative(root, queryBinary),
  config,
}
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 })
process.stdout.write(`${JSON.stringify({ ...receipt, receipt_path: relative(root, receiptPath) })}\n`)

function parseArgs(argv: string[]): LaunchConfig {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    values[name.slice(2).replaceAll("-", "_")] = value
  }
  return {
    symbol: values.symbol ?? "BTCUSDT",
    output_base: values.output_base ?? "data/l2",
    listen: values.listen ?? "127.0.0.1:50061",
    epoch_seconds: numberValue(values.epoch_seconds, 86_100),
    duration_seconds: numberValue(values.duration_seconds, 0),
    queue_capacity: numberValue(values.queue_capacity, 256),
    segment_frames: numberValue(values.segment_frames, 1_000),
    sync_every_frames: numberValue(values.sync_every_frames, 100),
    stale_after_ms: numberValue(values.stale_after_ms, 2_000),
    restart_limit: numberValue(values.restart_limit, 0),
  }
}

function numberValue(value: string | undefined, fallback: number): number {
  return value == null ? fallback : Number(value)
}
