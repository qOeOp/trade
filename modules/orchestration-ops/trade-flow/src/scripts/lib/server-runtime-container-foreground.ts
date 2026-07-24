import type { ServerRuntimeContainerProfile } from "./server-runtime-container-profile"
import {
  serverRuntimeContainerProcessSpecs,
  type ServerRuntimeContainerComponent,
  type ServerRuntimeContainerProcessSpec,
} from "./server-runtime-container-processes"

export const SERVER_RUNTIME_CONTAINER_FOREGROUND_SCHEMA = "trade.server-runtime-container-foreground.v1" as const

type ComponentId = ServerRuntimeContainerComponent

export interface ContainerRuntimeChild {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  kill(signal: NodeJS.Signals): void
}

export interface ContainerRuntimeDependencies {
  spawn?: (spec: ServerRuntimeContainerProcessSpec) => ContainerRuntimeChild
  ready?: (component: ComponentId) => Promise<boolean>
  sleep?: (milliseconds: number) => Promise<void>
  signal?: AbortSignal
  clock?: () => number
}

export interface ServerRuntimeContainerForegroundResult {
  schema_version: typeof SERVER_RUNTIME_CONTAINER_FOREGROUND_SCHEMA
  status: "completed" | "failed"
  reason: "signal" | "component_exit" | "startup_failed"
  started_components: ComponentId[]
  ready_components: ComponentId[]
  failed_component?: ComponentId
  exit_code?: number
  all_children_stopped: boolean
  live_writes_allowed: false
}

const START_ORDER: ComponentId[] = [
  "control-runtime",
  "market-data-manager",
  "ohlcv-worker",
  "funding-worker",
  "indicator-worker",
  "formal-replay-worker",
]

export async function runServerRuntimeContainerForeground(
  profile: ServerRuntimeContainerProfile,
  releaseRoot: string,
  bunPath: string,
  dependencies: ContainerRuntimeDependencies,
  readinessTimeoutMs = 60_000,
  shutdownGraceMs = profile.shutdown_grace_seconds * 1_000,
): Promise<ServerRuntimeContainerForegroundResult> {
  if (!Number.isSafeInteger(readinessTimeoutMs) || readinessTimeoutMs < 100 || readinessTimeoutMs > 300_000) {
    throw new Error("readiness timeout must be an integer from 100 to 300000")
  }
  if (!Number.isSafeInteger(shutdownGraceMs) || shutdownGraceMs < 100 || shutdownGraceMs > 300_000) {
    throw new Error("shutdown grace must be an integer from 100 to 300000")
  }
  if (!dependencies.spawn || !dependencies.ready) throw new Error("container runtime spawn and readiness dependencies are required")
  const sleep = dependencies.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds))
  const clock = dependencies.clock ?? Date.now
  const specs = new Map(serverRuntimeContainerProcessSpecs(profile, releaseRoot, bunPath).map((spec) => [spec.id, spec]))
  const children = new Map<ComponentId, ContainerRuntimeChild>()
  const started: ComponentId[] = []
  const ready: ComponentId[] = []
  let startupComponent: ComponentId | undefined

  try {
    for (const component of START_ORDER) {
      startupComponent = component
      if (dependencies.signal?.aborted) {
        await drainChildren(children, started, sleep, shutdownGraceMs)
        return terminal("completed", "signal", started, ready, children)
      }
      const spec = specs.get(component)
      if (!spec) throw new Error(`container runtime omitted component ${component}`)
      const child = dependencies.spawn(spec)
      children.set(component, child)
      started.push(component)
      await waitUntilReady(component, child, dependencies.ready, dependencies.signal, sleep, clock, readinessTimeoutMs)
      ready.push(component)
    }
    startupComponent = undefined

    const terminalEvent = await Promise.race([
      abortEvent(dependencies.signal),
      ...started.map(async (component) => ({
        kind: "component_exit" as const,
        component,
        exitCode: await children.get(component)!.exited,
      })),
    ])
    if (terminalEvent.kind === "signal") {
      await drainChildren(children, started, sleep, shutdownGraceMs)
      return terminal("completed", "signal", started, ready, children)
    }
    await drainChildren(children, started, sleep, shutdownGraceMs)
    return terminal("failed", "component_exit", started, ready, children, terminalEvent.component, terminalEvent.exitCode)
  } catch {
    await drainChildren(children, started, sleep, shutdownGraceMs)
    return terminal("failed", "startup_failed", started, ready, children, startupComponent)
  }
}

async function waitUntilReady(
  component: ComponentId,
  child: ContainerRuntimeChild,
  ready: NonNullable<ContainerRuntimeDependencies["ready"]>,
  signal: AbortSignal | undefined,
  sleep: NonNullable<ContainerRuntimeDependencies["sleep"]>,
  clock: () => number,
  timeoutMs: number,
): Promise<void> {
  const deadline = clock() + timeoutMs
  while (clock() < deadline) {
    if (signal?.aborted) throw new Error("container runtime startup was interrupted")
    if (child.exitCode != null) throw new Error(`${component} exited before readiness`)
    if (await ready(component)) return
    await sleep(100)
  }
  throw new Error(`${component} readiness timed out`)
}

async function drainChildren(
  children: Map<ComponentId, ContainerRuntimeChild>,
  started: ComponentId[],
  sleep: NonNullable<ContainerRuntimeDependencies["sleep"]>,
  graceMs: number,
): Promise<void> {
  const live = [...started].reverse().map((component) => children.get(component)!).filter((child) => child.exitCode == null)
  for (const child of live) child.kill("SIGTERM")
  const deadline = Date.now() + graceMs
  while (live.some((child) => child.exitCode == null) && Date.now() < deadline) await sleep(25)
  const remaining = live.filter((child) => child.exitCode == null)
  for (const child of remaining) child.kill("SIGKILL")
  await Promise.all(remaining.map((child) => child.exited))
}

function abortEvent(signal?: AbortSignal): Promise<{ kind: "signal" }> {
  if (signal?.aborted) return Promise.resolve({ kind: "signal" })
  return new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ kind: "signal" }), { once: true }))
}

function terminal(
  status: ServerRuntimeContainerForegroundResult["status"],
  reason: ServerRuntimeContainerForegroundResult["reason"],
  started: ComponentId[],
  ready: ComponentId[],
  children: Map<ComponentId, ContainerRuntimeChild>,
  failedComponent?: ComponentId,
  exitCode?: number,
): ServerRuntimeContainerForegroundResult {
  return {
    schema_version: SERVER_RUNTIME_CONTAINER_FOREGROUND_SCHEMA,
    status,
    reason,
    started_components: [...started],
    ready_components: [...ready],
    ...(failedComponent ? { failed_component: failedComponent } : {}),
    ...(exitCode != null ? { exit_code: exitCode } : {}),
    all_children_stopped: [...children.values()].every((child) => child.exitCode != null),
    live_writes_allowed: false,
  }
}
