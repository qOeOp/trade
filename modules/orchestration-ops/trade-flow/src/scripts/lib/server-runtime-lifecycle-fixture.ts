import { spawn, type ChildProcess } from "node:child_process"
import { isAbsolute } from "node:path"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { serverRuntimeProfileHash } from "./server-runtime-profile"

export const SERVER_RUNTIME_LIFECYCLE_FIXTURE_SCHEMA = "trade.server-runtime-lifecycle-fixture.v1" as const

type Component = "l2_owner" | "l2_consumer" | "control_runtime"
type LifecycleAction = "start" | "ready" | "fail" | "exit" | "stop" | "stopped"

interface ManagedChild {
  component: Component
  attempt: number
  child: ChildProcess
}

export interface ServerRuntimeLifecycleFixtureResult {
  schema_version: typeof SERVER_RUNTIME_LIFECYCLE_FIXTURE_SCHEMA
  profile_id: string
  deployment_id: string
  profile_hash: string
  status: "passed"
  fixture_scope: "synthetic_process_manager_only"
  events: Array<{
    sequence: number
    component: Component
    attempt: number
    action: LifecycleAction
  }>
  assertions: {
    dependency_start_order: true
    consumer_restart_isolated: true
    reverse_stop_order: true
    no_managed_child_alive: true
  }
  limitations: string[]
}

const FIXTURE_CHILD_SOURCE = `
process.on("SIGTERM", () => {
  process.stdout.write("DRAINED\\n")
  process.exit(0)
})
process.stdout.write("READY\\n")
setInterval(() => {}, 1000)
`

export async function runServerRuntimeLifecycleFixture(
  profile: ServerRuntimeProfile,
  bunPath: string,
  timeoutMs = 5_000,
): Promise<ServerRuntimeLifecycleFixtureResult> {
  if (!isAbsolute(bunPath) || /[\n\r\0]/.test(bunPath)) {
    throw new Error("bun_path must be an absolute path without control characters")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("timeout_ms must be an integer from 100 to 30000")
  }

  const events: ServerRuntimeLifecycleFixtureResult["events"] = []
  const children: ManagedChild[] = []
  const attempts: Record<Component, number> = {
    l2_owner: 0,
    l2_consumer: 0,
    control_runtime: 0,
  }
  const record = (managed: Pick<ManagedChild, "component" | "attempt">, action: LifecycleAction): void => {
    events.push({ sequence: events.length + 1, component: managed.component, attempt: managed.attempt, action })
  }

  const start = async (component: Component): Promise<ManagedChild> => {
    const attempt = attempts[component] + 1
    attempts[component] = attempt
    const managed: ManagedChild = {
      component,
      attempt,
      child: spawn(bunPath, ["-e", FIXTURE_CHILD_SOURCE], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    }
    children.push(managed)
    record(managed, "start")
    await waitForReady(managed.child, timeoutMs)
    record(managed, "ready")
    return managed
  }

  const terminate = async (managed: ManagedChild, action: "fail" | "stop"): Promise<void> => {
    record(managed, action)
    if (isAlive(managed.child)) {
      managed.child.kill(action === "fail" ? "SIGKILL" : "SIGTERM")
      await waitForExit(managed.child, timeoutMs)
    }
    record(managed, action === "fail" ? "exit" : "stopped")
  }

  let owner: ManagedChild | undefined
  let consumer: ManagedChild | undefined
  let control: ManagedChild | undefined
  try {
    owner = await start("l2_owner")
    consumer = await start("l2_consumer")
    control = await start("control_runtime")

    await terminate(consumer, "fail")
    if (!isAlive(owner.child) || !isAlive(control.child)) {
      throw new Error("consumer failure propagated to an independent component")
    }
    consumer = await start("l2_consumer")

    await terminate(control, "stop")
    await terminate(consumer, "stop")
    await terminate(owner, "stop")

    if (children.some(({ child }) => isAlive(child))) throw new Error("managed child remained alive after reverse drain")
    return {
      schema_version: SERVER_RUNTIME_LIFECYCLE_FIXTURE_SCHEMA,
      profile_id: profile.profile_id,
      deployment_id: profile.deployment_id,
      profile_hash: serverRuntimeProfileHash(profile),
      status: "passed",
      fixture_scope: "synthetic_process_manager_only",
      events,
      assertions: {
        dependency_start_order: true,
        consumer_restart_isolated: true,
        reverse_stop_order: true,
        no_managed_child_alive: true,
      },
      limitations: [
        "does_not_start_real_runtime_components",
        "does_not_install_or_invoke_systemd",
        "does_not_claim_owner_data_readiness",
        "no_network_exchange_domain_job_or_live_write_authority",
      ],
    }
  } finally {
    await Promise.all(children.filter(({ child }) => isAlive(child)).map(async ({ child }) => {
      child.kill("SIGKILL")
      await waitForExit(child, timeoutMs).catch(() => undefined)
    }))
  }
}

function waitForReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => finish(new Error("fixture child readiness timed out")), timeoutMs)
    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString()
      if (output.includes("READY\n")) finish()
    }
    const onExit = (): void => finish(new Error("fixture child exited before readiness"))
    const onError = (error: Error): void => finish(error)
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      child.stdout?.off("data", onData)
      child.off("exit", onExit)
      child.off("error", onError)
      if (error) reject(error)
      else resolve()
    }
    child.stdout?.on("data", onData)
    child.once("exit", onExit)
    child.once("error", onError)
  })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (!isAlive(child)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("fixture child exit timed out")), timeoutMs)
    const onExit = (): void => finish()
    const onError = (error: Error): void => finish(error)
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      child.off("exit", onExit)
      child.off("error", onError)
      if (error) reject(error)
      else resolve()
    }
    child.once("exit", onExit)
    child.once("error", onError)
  })
}

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}
