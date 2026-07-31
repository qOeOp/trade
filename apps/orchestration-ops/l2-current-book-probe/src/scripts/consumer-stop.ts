#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
  assertL2WatchConsumerRuntimeRef,
  processMatchesL2WatchConsumerSupervisor,
  type L2WatchConsumerReceipt,
} from "../lib/l2-book-watch-consumer-runtime"

const root = repoRoot()
const receiptRef = requiredArg(process.argv.slice(2), "--receipt")
const receipt = JSON.parse(readFileSync(assertL2WatchConsumerRuntimeRef(root, receiptRef), "utf8")) as L2WatchConsumerReceipt
if (receipt.schema_version !== L2_WATCH_CONSUMER_RECEIPT_SCHEMA) throw new Error("unsupported L2 watch consumer receipt")
if (!processMatchesL2WatchConsumerSupervisor(receipt.supervisor_pid, receipt.runtime_directory)) {
  process.stdout.write(`${JSON.stringify({ ok: true, status: "already_stopped" })}\n`)
  process.exit(0)
}
const command = Bun.spawnSync({ cmd: ["ps", "-p", String(receipt.supervisor_pid), "-o", "command="], stdout: "pipe", stderr: "pipe" })
const text = command.stdout.toString()
if (command.exitCode !== 0 || !text.includes("consumer-supervisor.ts") || !text.includes(receipt.runtime_directory)) {
  throw new Error("refusing to signal pid that is not the exact L2 watch consumer supervisor")
}
process.kill(receipt.supervisor_pid, "SIGTERM")
process.stdout.write(`${JSON.stringify({ ok: true, status: "stop_requested" })}\n`)

function requiredArg(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  const value = index < 0 ? undefined : argv[index + 1]
  if (!value) throw new Error(`${name} is required`)
  return value
}
