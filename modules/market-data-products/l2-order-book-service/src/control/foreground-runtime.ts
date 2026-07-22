import { relative, resolve } from "node:path"
import {
  L2_LAUNCH_RECEIPT_SCHEMA,
  assertMarketDataDbRef,
  assertOutputRef,
  assertRuntimeRef,
  validateLaunchConfig,
  type LaunchConfig,
  type LaunchReceipt,
} from "./runtime-contract"

export interface L2ForegroundRuntimePlan {
  runtime_ref: string
  runtime_directory: string
  runtime_state_path: string
  terminal_state_path: string
  receipt_path: string
  log_path: string
  service_binary: string
  query_binary: string
  supervisor_command: string[]
  config: LaunchConfig
}

export function buildL2ForegroundRuntimePlan(input: {
  root: string
  module_root: string
  bun_path: string
  token: string
  config: LaunchConfig
}): L2ForegroundRuntimePlan {
  validateToken(input.token)
  validateLaunchConfig(input.config)
  assertOutputRef(input.root, input.config.output_base)
  assertMarketDataDbRef(input.root, input.config.market_data_db)
  const runtimeRef = `tmp/l2-order-book-service/runtime/${input.token}`
  const runtimeDirectory = assertRuntimeRef(input.root, runtimeRef)
  const runtimeStatePath = resolve(runtimeDirectory, "runtime-state.json")
  const terminalStatePath = resolve(runtimeDirectory, "terminal-state.json")
  const receiptPath = resolve(runtimeDirectory, "launch-receipt.json")
  const logPath = resolve(runtimeDirectory, "foreground.log")
  const serviceBinary = resolve(input.module_root, "target/release/l2-order-book-service")
  const queryBinary = resolve(input.module_root, "target/release/l2-order-book-query")
  const supervisorScript = resolve(input.module_root, "src/scripts/runtime-supervisor.ts")
  return {
    runtime_ref: runtimeRef,
    runtime_directory: runtimeDirectory,
    runtime_state_path: runtimeStatePath,
    terminal_state_path: terminalStatePath,
    receipt_path: receiptPath,
    log_path: logPath,
    service_binary: serviceBinary,
    query_binary: queryBinary,
    supervisor_command: [
      input.bun_path,
      supervisorScript,
      "--runtime-dir",
      runtimeRef,
      "--service-binary",
      repoRef(input.root, serviceBinary),
      "--config",
      JSON.stringify(input.config),
    ],
    config: input.config,
  }
}

export function buildL2ForegroundReceipt(
  root: string,
  plan: L2ForegroundRuntimePlan,
  supervisorPid: number,
  launchedAt: string,
): LaunchReceipt {
  if (!Number.isSafeInteger(supervisorPid) || supervisorPid <= 1) {
    throw new Error("foreground L2 supervisor pid is invalid")
  }
  if (!Number.isFinite(Date.parse(launchedAt))) throw new Error("launched_at must be a valid date")
  return {
    schema_version: L2_LAUNCH_RECEIPT_SCHEMA,
    launched_at: launchedAt,
    supervisor_pid: supervisorPid,
    runtime_directory: repoRef(root, plan.runtime_directory),
    runtime_state_path: repoRef(root, plan.runtime_state_path),
    terminal_state_path: repoRef(root, plan.terminal_state_path),
    log_path: repoRef(root, plan.log_path),
    service_binary: repoRef(root, plan.service_binary),
    query_binary: repoRef(root, plan.query_binary),
    config: plan.config,
  }
}

function repoRef(root: string, path: string): string {
  const ref = relative(root, path).replaceAll("\\", "/")
  if (!ref || ref.startsWith("../") || ref === "..") throw new Error("foreground runtime path escaped repository")
  return ref
}

function validateToken(token: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(token)) {
    throw new Error("foreground runtime token is invalid")
  }
}
