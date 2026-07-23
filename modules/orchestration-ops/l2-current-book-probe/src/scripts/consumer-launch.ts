#!/usr/bin/env bun

import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
  assertL2WatchConsumerRuntimeRef,
  findUniqueActiveL2WatchConsumer,
  l2WatchConsumerSymbol,
  parseL2WatchConsumerLaunchArgs,
  type L2WatchConsumerReceipt,
} from "../lib/l2-book-watch-consumer-runtime"

const root = repoRoot()
const config = parseArgs(process.argv.slice(2))
const symbol = l2WatchConsumerSymbol(config)
if (findUniqueActiveL2WatchConsumer(root, { symbol }) != null) {
  throw new Error(`an active L2 watch consumer already exists for ${symbol}`)
}
const token = `${Date.now()}-${process.pid}`
const runtimeRef = `tmp/l2-book-watch-consumer/runtime/${token}`
const runtimeDirectory = assertL2WatchConsumerRuntimeRef(root, runtimeRef)
mkdirSync(runtimeDirectory, { recursive: true })
const logPath = resolve(runtimeDirectory, "supervisor.log")
const runtimeStatePath = resolve(runtimeDirectory, "runtime-state.json")
const observationStatePath = resolve(runtimeDirectory, "observation-state.json")
const terminalStatePath = resolve(runtimeDirectory, "terminal-state.json")
const receiptPath = resolve(runtimeDirectory, "launch-receipt.json")
const descriptor = openSync(logPath, "wx", 0o600)
let supervisor: ReturnType<typeof Bun.spawn>
try {
  supervisor = Bun.spawn({
    cmd: [
      process.execPath,
      resolve(import.meta.dir, "consumer-supervisor.ts"),
      "--runtime-dir", runtimeRef,
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
if (!Number.isSafeInteger(supervisor.pid) || supervisor.pid <= 1) throw new Error("detached L2 watch consumer supervisor pid is invalid")
const receipt: L2WatchConsumerReceipt = {
  schema_version: L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
  launched_at: new Date().toISOString(),
  supervisor_pid: supervisor.pid,
  runtime_directory: relative(root, runtimeDirectory),
  runtime_state_path: relative(root, runtimeStatePath),
  observation_state_path: relative(root, observationStatePath),
  terminal_state_path: relative(root, terminalStatePath),
  log_path: relative(root, logPath),
  config,
}
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 })
process.stdout.write(`${JSON.stringify({ ...receipt, receipt_path: relative(root, receiptPath) })}\n`)

export function parseArgs(argv: string[]) {
  return parseL2WatchConsumerLaunchArgs(argv)
}
