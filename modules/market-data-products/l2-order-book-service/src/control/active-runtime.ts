import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { selectUniqueActiveL2Launch } from "./owner-health"
import {
  L2_LAUNCH_RECEIPT_SCHEMA,
  L2_RUNTIME_STATE_SCHEMA,
  L2_TERMINAL_STATE_SCHEMA,
  assertRuntimeRef,
  processMatchesL2Supervisor,
  validateLaunchConfig,
  type LaunchReceipt,
  type RuntimeState,
} from "./runtime-contract"

export interface ActiveL2Runtime {
  receipt: LaunchReceipt
  state: RuntimeState
  terminal: Record<string, unknown> | null
}

export interface ActiveL2RuntimeLookupOptions {
  symbol?: string
  process_matches_supervisor?: (pid: number, runtimeDirectory: string) => boolean
}

export function findUniqueActiveL2Runtime(
  root: string,
  options: ActiveL2RuntimeLookupOptions = {},
): ActiveL2Runtime | null {
  const runtimeRoot = assertRuntimeRef(root, "tmp/l2-order-book-service/runtime")
  if (!existsSync(runtimeRoot)) return null
  const active: ActiveL2Runtime[] = []
  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const receiptPath = resolve(runtimeRoot, entry.name, "launch-receipt.json")
    if (!existsSync(receiptPath)) continue
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as LaunchReceipt
    if (receipt.schema_version !== L2_LAUNCH_RECEIPT_SCHEMA) throw new Error("unsupported L2 launch receipt")
    if (options.symbol != null && receipt.config.symbol !== options.symbol) continue
    const processMatches = options.process_matches_supervisor ?? processMatchesL2Supervisor
    if (!processMatches(receipt.supervisor_pid, receipt.runtime_directory)) continue
    validateLaunchConfig(receipt.config)
    const statePath = assertRuntimeRef(root, receipt.runtime_state_path)
    if (!existsSync(statePath)) continue
    const state = JSON.parse(readFileSync(statePath, "utf8")) as RuntimeState
    if (state.schema_version !== L2_RUNTIME_STATE_SCHEMA) throw new Error("unsupported L2 runtime state")
    if (state.supervisor_pid !== receipt.supervisor_pid) continue
    const terminalPath = assertRuntimeRef(root, receipt.terminal_state_path)
    const terminal = existsSync(terminalPath)
      ? JSON.parse(readFileSync(terminalPath, "utf8")) as Record<string, unknown>
      : null
    if (terminal != null && terminal.schema_version !== L2_TERMINAL_STATE_SCHEMA) {
      throw new Error("unsupported L2 terminal state")
    }
    active.push({ receipt, state, terminal })
  }
  return selectUniqueActiveL2Launch(active)
}
