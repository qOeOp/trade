#!/usr/bin/env bun

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { drainForegroundChild } from "../../../../contracts/runtime-core/src/foreground-child"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { findUniqueActiveL2Runtime } from "../control/active-runtime"
import { buildL2ForegroundReceipt, buildL2ForegroundRuntimePlan } from "../control/foreground-runtime"
import { parseLaunchConfigArgs } from "../control/runtime-contract"

const root = repoRoot()
const moduleRoot = resolve(import.meta.dir, "../..")
const config = parseLaunchConfigArgs(process.argv.slice(2))
if (findUniqueActiveL2Runtime(root, { symbol: config.symbol }) != null) {
  throw new Error(`an active L2 supervisor already exists for ${config.symbol}`)
}
const plan = buildL2ForegroundRuntimePlan({
  root,
  module_root: moduleRoot,
  bun_path: process.execPath,
  token: `foreground-${Date.now()}-${process.pid}`,
  config,
})
if (!existsSync(plan.service_binary) || !existsSync(plan.query_binary)) {
  throw new Error("L2 release binaries are missing; build release bins before foreground start")
}
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
  const receipt = buildL2ForegroundReceipt(root, plan, supervisor.pid, new Date().toISOString())
  writeFileSync(plan.receipt_path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  receiptWritten = true
  process.stdout.write(`${JSON.stringify({ event: "l2_foreground_started", receipt_path: `${plan.runtime_ref}/launch-receipt.json` })}\n`)
  const exitCode = await drainForegroundChild(supervisor)
  appendFileSync(plan.log_path, `${JSON.stringify({ event: "foreground_terminal", at: new Date().toISOString(), exit_code: exitCode })}\n`)
  process.exitCode = exitCode
} finally {
  if (!receiptWritten && supervisor.exitCode == null) supervisor.kill("SIGTERM")
}
