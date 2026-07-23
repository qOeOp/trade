import { resolve } from "node:path"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import type { ServerRuntimeProcessSpec } from "./server-runtime-processes"

type ComponentId = ServerRuntimeProcessSpec["id"]
type JSONRecord = Record<string, unknown>

export const SERVER_RUNTIME_CONTAINER_STATUS_SCHEMA = "trade.server-runtime-container-status.v1" as const

export interface ContainerStatusCommandResult {
  exit_code: number
  stdout: string
}

export type ContainerStatusExecutor = (command: string[]) => Promise<ContainerStatusCommandResult>

export interface ServerRuntimeContainerStatus {
  schema_version: typeof SERVER_RUNTIME_CONTAINER_STATUS_SCHEMA
  status: "ready" | "not_ready"
  components: Record<ComponentId, { ready: boolean }>
  overall_ready: boolean
  live_writes_allowed: false
}

export async function readServerRuntimeContainerStatus(
  profile: ServerRuntimeProfile,
  root: string,
  bunPath: string,
  executor: ContainerStatusExecutor,
): Promise<ServerRuntimeContainerStatus> {
  const components = {
    "l2-owner": { ready: await readServerRuntimeContainerComponentReady("l2-owner", profile, root, bunPath, executor) },
    "l2-consumer": { ready: await readServerRuntimeContainerComponentReady("l2-consumer", profile, root, bunPath, executor) },
    "control-runtime": { ready: await readServerRuntimeContainerComponentReady("control-runtime", profile, root, bunPath, executor) },
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
  component: ComponentId,
  profile: ServerRuntimeProfile,
  root: string,
  bunPath: string,
  executor: ContainerStatusExecutor,
): Promise<boolean> {
  const command = component === "l2-owner"
    ? [bunPath, resolve(root, "modules/market-data-products/l2-order-book-service/src/scripts/owner-health.ts")]
    : component === "l2-consumer"
      ? [bunPath, resolve(root, "modules/orchestration-ops/l2-current-book-probe/src/scripts/consumer-read.ts")]
      : [
          bunPath,
          resolve(root, "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts"),
          "--db", profile.control_runtime.ops_runtime_db,
          "--action", "parity_status",
        ]
  const result = await executor(command)
  if (result.exit_code !== 0) return false
  try {
    const value = record(JSON.parse(result.stdout))
    if (component === "l2-owner") {
      const health = record(value.health)
      return health.status === "healthy" && record(health.readiness).overall_ready === true
    }
    if (component === "l2-consumer") {
      const consumer = record(value.consumer)
      return consumer.status === "healthy" && record(consumer.readiness).overall_ready === true
    }
    return record(record(value.parity_status).supervisor_lease).active === true
  } catch {
    return false
  }
}

function record(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
