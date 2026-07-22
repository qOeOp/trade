#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { L2_LAUNCH_RECEIPT_SCHEMA, assertRuntimeRef, processIsAlive, type LaunchReceipt } from "../control/runtime-contract"

const root = repoRoot()
const receiptRef = requiredArg(process.argv.slice(2), "--receipt")
const receipt = JSON.parse(readFileSync(assertRuntimeRef(root, receiptRef), "utf8")) as LaunchReceipt
if (receipt.schema_version !== L2_LAUNCH_RECEIPT_SCHEMA) throw new Error("unsupported L2 launch receipt")
if (!processIsAlive(receipt.supervisor_pid)) {
  process.stdout.write(`${JSON.stringify({ ok: true, status: "already_stopped", supervisor_pid: receipt.supervisor_pid })}\n`)
  process.exit(0)
}
const command = Bun.spawnSync({ cmd: ["ps", "-p", String(receipt.supervisor_pid), "-o", "command="], stdout: "pipe", stderr: "pipe" })
const text = command.stdout.toString()
if (command.exitCode !== 0 || !text.includes("runtime-supervisor.ts") || !text.includes(receipt.runtime_directory)) {
  throw new Error("refusing to signal pid that is not the exact L2 supervisor")
}
process.kill(receipt.supervisor_pid, "SIGTERM")
process.stdout.write(`${JSON.stringify({ ok: true, status: "stop_requested", supervisor_pid: receipt.supervisor_pid })}\n`)

function requiredArg(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  const value = index < 0 ? undefined : argv[index + 1]
  if (!value) throw new Error(`${name} is required`)
  return value
}
