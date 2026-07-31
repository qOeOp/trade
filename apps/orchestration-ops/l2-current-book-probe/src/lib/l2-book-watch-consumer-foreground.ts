import { relative, resolve } from "node:path"
import {
  L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
  assertL2WatchConsumerRuntimeRef,
  validateL2WatchConsumerConfig,
  type L2WatchConsumerConfig,
  type L2WatchConsumerReceipt,
} from "./l2-book-watch-consumer-runtime"

export interface L2WatchConsumerForegroundPlan {
  runtime_ref: string
  runtime_directory: string
  runtime_state_path: string
  observation_state_path: string
  terminal_state_path: string
  receipt_path: string
  log_path: string
  supervisor_command: string[]
  config: L2WatchConsumerConfig
}

export function buildL2WatchConsumerForegroundPlan(input: {
  root: string
  module_root: string
  bun_path: string
  token: string
  config: L2WatchConsumerConfig
}): L2WatchConsumerForegroundPlan {
  validateToken(input.token)
  validateL2WatchConsumerConfig(input.config)
  const runtimeRef = `tmp/l2-book-watch-consumer/runtime/${input.token}`
  const runtimeDirectory = assertL2WatchConsumerRuntimeRef(input.root, runtimeRef)
  const runtimeStatePath = resolve(runtimeDirectory, "runtime-state.json")
  const observationStatePath = resolve(runtimeDirectory, "observation-state.json")
  const terminalStatePath = resolve(runtimeDirectory, "terminal-state.json")
  const receiptPath = resolve(runtimeDirectory, "launch-receipt.json")
  const logPath = resolve(runtimeDirectory, "foreground.log")
  return {
    runtime_ref: runtimeRef,
    runtime_directory: runtimeDirectory,
    runtime_state_path: runtimeStatePath,
    observation_state_path: observationStatePath,
    terminal_state_path: terminalStatePath,
    receipt_path: receiptPath,
    log_path: logPath,
    supervisor_command: [
      input.bun_path,
      resolve(input.module_root, "src/scripts/consumer-supervisor.ts"),
      "--runtime-dir",
      runtimeRef,
      "--config",
      JSON.stringify(input.config),
    ],
    config: input.config,
  }
}

export function buildL2WatchConsumerForegroundReceipt(
  root: string,
  plan: L2WatchConsumerForegroundPlan,
  supervisorPid: number,
  launchedAt: string,
): L2WatchConsumerReceipt {
  if (!Number.isSafeInteger(supervisorPid) || supervisorPid <= 1) {
    throw new Error("foreground L2 watch consumer supervisor pid is invalid")
  }
  if (!Number.isFinite(Date.parse(launchedAt))) throw new Error("launched_at must be a valid date")
  return {
    schema_version: L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
    launched_at: launchedAt,
    supervisor_pid: supervisorPid,
    runtime_directory: repoRef(root, plan.runtime_directory),
    runtime_state_path: repoRef(root, plan.runtime_state_path),
    observation_state_path: repoRef(root, plan.observation_state_path),
    terminal_state_path: repoRef(root, plan.terminal_state_path),
    log_path: repoRef(root, plan.log_path),
    config: plan.config,
  }
}

function repoRef(root: string, path: string): string {
  const ref = relative(root, path).replaceAll("\\", "/")
  if (!ref || ref.startsWith("../") || ref === "..") throw new Error("foreground consumer path escaped repository")
  return ref
}

function validateToken(token: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(token)) {
    throw new Error("foreground consumer runtime token is invalid")
  }
}
