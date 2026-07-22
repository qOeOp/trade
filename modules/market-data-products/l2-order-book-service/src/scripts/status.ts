#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_LAUNCH_RECEIPT_SCHEMA,
  L2_RUNTIME_STATE_SCHEMA,
  L2_TERMINAL_STATE_SCHEMA,
  assertRuntimeRef,
  processIsAlive,
  type LaunchReceipt,
  type RuntimeState,
} from "../control/runtime-contract"

const root = repoRoot()
const receiptRef = requiredArg(process.argv.slice(2), "--receipt")
const receiptPath = assertRuntimeRef(root, receiptRef)
const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as LaunchReceipt
if (receipt.schema_version !== L2_LAUNCH_RECEIPT_SCHEMA) throw new Error("unsupported L2 launch receipt")
const statePath = assertRuntimeRef(root, receipt.runtime_state_path)
const terminalPath = assertRuntimeRef(root, receipt.terminal_state_path)
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) as RuntimeState : null
if (state != null && state.schema_version !== L2_RUNTIME_STATE_SCHEMA) throw new Error("unsupported L2 runtime state")
const terminal = existsSync(terminalPath) ? JSON.parse(readFileSync(terminalPath, "utf8")) as Record<string, unknown> : null
if (terminal != null && terminal.schema_version !== L2_TERMINAL_STATE_SCHEMA) throw new Error("unsupported L2 terminal state")
const supervisorAlive = processIsAlive(receipt.supervisor_pid)
const serviceAlive = state?.service_pid != null && processIsAlive(state.service_pid)
let health: unknown = null
let healthError = ""
if (serviceAlive) {
  const query = Bun.spawnSync({
    cmd: [resolve(root, receipt.query_binary), "--endpoint", `http://${receipt.config.listen}`, "--action", "health", "--symbol", receipt.config.symbol],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
  })
  if (query.exitCode === 0) health = JSON.parse(query.stdout.toString())
  else healthError = query.stderr.toString().trim() || `health query exit ${query.exitCode}`
}
const healthRecord = health != null && typeof health === "object" ? health as Record<string, unknown> : null
const sourceHealthy = healthRecord?.read_ready === true
const controlHealthy = state?.disk_status === "healthy"
  && (state.admission_status === "ready" || state.admission_status === "disabled")
  && state.resource_last_error === ""
const status = terminal?.status === "completed" ? "stopped"
  : terminal?.status === "failed" ? "failed"
    : !supervisorAlive ? "orphaned"
      : state?.status === "backoff" ? "degraded"
        : serviceAlive && sourceHealthy && controlHealthy ? "healthy"
          : serviceAlive && health != null ? "degraded" : "starting"
process.stdout.write(`${JSON.stringify({
  schema_version: "trade.l2-service-status.v1",
  observed_at: new Date().toISOString(),
  status,
  supervisor_alive: supervisorAlive,
  service_alive: serviceAlive,
  runtime_state: state,
  terminal_state: terminal,
  health,
  health_error: healthError || undefined,
  receipt_path: receiptRef,
  log_path: receipt.log_path,
})}\n`)

function requiredArg(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  const value = index < 0 ? undefined : argv[index + 1]
  if (!value) throw new Error(`${name} is required`)
  return value
}
