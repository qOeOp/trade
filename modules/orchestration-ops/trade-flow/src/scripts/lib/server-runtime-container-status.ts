import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ServerRuntimeContainerProfile } from "./server-runtime-container-profile"
import type { ServerRuntimeContainerComponent } from "./server-runtime-container-processes"

type JSONRecord = Record<string, unknown>

export const SERVER_RUNTIME_CONTAINER_STATUS_SCHEMA = "trade.server-runtime-container-status.v1" as const

export interface ContainerStatusCommandResult {
  exit_code: number
  stdout: string
}

export type ContainerStatusExecutor = (command: string[]) => Promise<ContainerStatusCommandResult>
export type ContainerStateReader = (component: Exclude<ServerRuntimeContainerComponent, "control-runtime">) => unknown

export interface ServerRuntimeContainerStatus {
  schema_version: typeof SERVER_RUNTIME_CONTAINER_STATUS_SCHEMA
  status: "ready" | "not_ready"
  components: Record<ServerRuntimeContainerComponent, { ready: boolean }>
  overall_ready: boolean
  live_writes_allowed: false
}

export async function readServerRuntimeContainerStatus(
  profile: ServerRuntimeContainerProfile,
  root: string,
  bunPath: string,
  executor: ContainerStatusExecutor,
  readState: ContainerStateReader = (component) => readStateFile(root, component),
  now: () => number = Date.now,
): Promise<ServerRuntimeContainerStatus> {
  const components = {
    "control-runtime": {
      ready: await readServerRuntimeContainerComponentReady(
        "control-runtime", profile, root, bunPath, executor, readState, now,
      ),
    },
    "market-data-manager": {
      ready: await readServerRuntimeContainerComponentReady(
        "market-data-manager", profile, root, bunPath, executor, readState, now,
      ),
    },
    "ohlcv-worker": {
      ready: await readServerRuntimeContainerComponentReady(
        "ohlcv-worker", profile, root, bunPath, executor, readState, now,
      ),
    },
    "indicator-worker": {
      ready: await readServerRuntimeContainerComponentReady(
        "indicator-worker", profile, root, bunPath, executor, readState, now,
      ),
    },
  }
  const overallReady = Object.values(components).every((component) => component.ready)
  return {
    schema_version: SERVER_RUNTIME_CONTAINER_STATUS_SCHEMA,
    status: overallReady ? "ready" : "not_ready",
    components,
    overall_ready: overallReady,
    live_writes_allowed: false,
  }
}

export async function readServerRuntimeContainerComponentReady(
  component: ServerRuntimeContainerComponent,
  profile: ServerRuntimeContainerProfile,
  root: string,
  bunPath: string,
  executor: ContainerStatusExecutor,
  readState: ContainerStateReader = (stateComponent) => readStateFile(root, stateComponent),
  now: () => number = Date.now,
): Promise<boolean> {
  if (component === "control-runtime") {
    const result = await executor([
      bunPath,
      resolve(root, "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts"),
      "--db", profile.control_runtime.ops_runtime_db,
      "--action", "parity_status",
    ])
    if (result.exit_code !== 0) return false
    try {
      return record(record(JSON.parse(result.stdout)).parity_status).supervisor_lease != null
        && record(record(record(JSON.parse(result.stdout)).parity_status).supervisor_lease).active === true
    } catch {
      return false
    }
  }
  try {
    const state = record(readState(component))
    if (state.status !== "running") return false
    const observedAt = Date.parse(text(state.observed_at))
    if (!Number.isFinite(observedAt)) return false
    return now() - observedAt >= 0 && now() - observedAt <= maximumStateAge(profile, component)
  } catch {
    return false
  }
}

function maximumStateAge(
  profile: ServerRuntimeContainerProfile,
  component: Exclude<ServerRuntimeContainerComponent, "control-runtime">,
): number {
  const market = profile.market_data_runtime
  if (component === "market-data-manager") {
    return market.l2.reconcile_interval_ms * 3 + market.l2.readiness_deadline_ms
  }
  if (component === "ohlcv-worker") {
    return market.ohlcv_worker.interval_ms * 3 + market.ohlcv_worker.command_timeout_ms
  }
  return market.indicator_worker.interval_ms * 3 + market.indicator_worker.command_timeout_ms
}

function readStateFile(root: string, component: Exclude<ServerRuntimeContainerComponent, "control-runtime">): unknown {
  const path = component === "market-data-manager"
    ? "tmp/market-data-runtime-manager/latest-state.json"
    : component === "ohlcv-worker"
      ? "tmp/ohlcv-demand-worker/latest-state.json"
      : "tmp/indicator-demand-worker/latest-state.json"
  return JSON.parse(readFileSync(resolve(root, path), "utf8"))
}

function record(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}
