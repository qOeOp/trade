import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { runServerRuntimeContainerForeground, type ContainerRuntimeChild } from "./server-runtime-container-foreground"
import { parseServerRuntimeProfile } from "./server-runtime-profile"
import type { ServerRuntimeProcessSpec } from "./server-runtime-processes"

const profile = parseServerRuntimeProfile(JSON.parse(
  readFileSync(resolve(repoRoot(), "profile/server-runtime.json"), "utf8"),
))

test("container foreground starts in dependency order and drains in reverse on signal", async () => {
  const controller = new AbortController()
  const events: string[] = []
  const children = new Map<string, FakeChild>()
  const resultPromise = runServerRuntimeContainerForeground(profile, "/opt/trade", "/usr/bin/bun", {
    signal: controller.signal,
    spawn: (spec) => {
      events.push(`start:${spec.id}`)
      const child = new FakeChild(spec.id, events)
      children.set(spec.id, child)
      return child
    },
    ready: async (component) => {
      events.push(`ready:${component}`)
      if (component === "control-runtime") controller.abort()
      return true
    },
    sleep: async () => undefined,
  }, 1_000, 1_000)

  const result = await resultPromise
  assert.equal(result.status, "completed")
  assert.equal(result.reason, "signal")
  assert.deepEqual(result.started_components, ["l2-owner", "l2-consumer", "control-runtime"])
  assert.deepEqual(result.ready_components, ["l2-owner", "l2-consumer", "control-runtime"])
  assert.equal(result.all_children_stopped, true)
  assert.deepEqual(events, [
    "start:l2-owner", "ready:l2-owner",
    "start:l2-consumer", "ready:l2-consumer",
    "start:control-runtime", "ready:control-runtime",
    "kill:control-runtime:SIGTERM", "kill:l2-consumer:SIGTERM", "kill:l2-owner:SIGTERM",
  ])
})

test("container foreground fails the group when a ready component exits", async () => {
  const events: string[] = []
  const children = new Map<string, FakeChild>()
  const resultPromise = runServerRuntimeContainerForeground(profile, "/opt/trade", "/usr/bin/bun", {
    spawn: (spec) => {
      const child = new FakeChild(spec.id, events)
      children.set(spec.id, child)
      if (spec.id === "control-runtime") queueMicrotask(() => child.exit(0))
      return child
    },
    ready: async () => true,
    sleep: async () => undefined,
  }, 1_000, 1_000)

  const result = await resultPromise
  assert.equal(result.status, "failed")
  assert.equal(result.reason, "component_exit")
  assert.equal(result.failed_component, "control-runtime")
  assert.equal(result.exit_code, 0)
  assert.equal(result.all_children_stopped, true)
})

test("container foreground stops already-started components when readiness fails", async () => {
  const events: string[] = []
  let now = 0
  const result = await runServerRuntimeContainerForeground(profile, "/opt/trade", "/usr/bin/bun", {
    spawn: (spec: ServerRuntimeProcessSpec) => new FakeChild(spec.id, events),
    ready: async () => false,
    sleep: async () => { now += 100 },
    clock: () => now,
  }, 200, 1_000)

  assert.equal(result.status, "failed")
  assert.equal(result.reason, "startup_failed")
  assert.equal(result.failed_component, "l2-owner")
  assert.deepEqual(result.started_components, ["l2-owner"])
  assert.deepEqual(events, ["kill:l2-owner:SIGTERM"])
})

class FakeChild implements ContainerRuntimeChild {
  exitCode: number | null = null
  readonly exited: Promise<number>
  private resolveExit!: (code: number) => void

  constructor(private readonly id: string, private readonly events: string[]) {
    this.exited = new Promise((resolveExit) => { this.resolveExit = resolveExit })
  }

  kill(signal: NodeJS.Signals): void {
    this.events.push(`kill:${this.id}:${signal}`)
    this.exit(signal === "SIGKILL" ? 137 : 0)
  }

  exit(code: number): void {
    if (this.exitCode != null) return
    this.exitCode = code
    this.resolveExit(code)
  }
}
