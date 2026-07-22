#!/usr/bin/env bun

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { drainForegroundChild } from "../../../../contracts/runtime-core/src/foreground-child"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  buildL2WatchConsumerForegroundPlan,
  buildL2WatchConsumerForegroundReceipt,
} from "../lib/l2-book-watch-consumer-foreground"
import {
  findUniqueActiveL2WatchConsumer,
  parseL2WatchConsumerLaunchArgs,
} from "../lib/l2-book-watch-consumer-runtime"

const root = repoRoot()
const moduleRoot = resolve(import.meta.dir, "../..")
const config = parseL2WatchConsumerLaunchArgs(process.argv.slice(2))
if (findUniqueActiveL2WatchConsumer(root) != null) throw new Error("an active L2 watch consumer already exists")
const plan = buildL2WatchConsumerForegroundPlan({
  root,
  module_root: moduleRoot,
  bun_path: process.execPath,
  token: `foreground-${Date.now()}-${process.pid}`,
  config,
})
mkdirSync(plan.runtime_directory, { recursive: true })
writeFileSync(plan.log_path, `${JSON.stringify({ event: "foreground_starting", at: new Date().toISOString() })}\n`, { flag: "wx", mode: 0o600 })

const supervisor = Bun.spawn({
  cmd: plan.supervisor_command,
  cwd: root,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
})
let receiptWritten = false
try {
  const receipt = buildL2WatchConsumerForegroundReceipt(root, plan, supervisor.pid, new Date().toISOString())
  writeFileSync(plan.receipt_path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  receiptWritten = true
  process.stdout.write(`${JSON.stringify({ event: "l2_watch_consumer_foreground_started", receipt_path: `${plan.runtime_ref}/launch-receipt.json` })}\n`)
  const exitCode = await drainForegroundChild(supervisor)
  appendFileSync(plan.log_path, `${JSON.stringify({ event: "foreground_terminal", at: new Date().toISOString(), exit_code: exitCode })}\n`)
  process.exitCode = exitCode
} finally {
  if (!receiptWritten && supervisor.exitCode == null) supervisor.kill("SIGTERM")
}
