#!/usr/bin/env bun

import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_LAUNCH_RECEIPT_SCHEMA,
  assertMarketDataDbRef,
  assertOutputRef,
  assertRuntimeRef,
  parseLaunchConfigArgs,
  type LaunchReceipt,
} from "../control/runtime-contract"

const root = repoRoot()
const moduleRoot = resolve(import.meta.dir, "../..")
const config = parseLaunchConfigArgs(process.argv.slice(2))
assertOutputRef(root, config.output_base)
assertMarketDataDbRef(root, config.market_data_db)

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
