import assert from "node:assert/strict"
import test from "node:test"
import { drainForegroundChild, type ForegroundSignalHost } from "./foreground-child"

test("foreground child forwards stop signals, drains, and removes handlers", async () => {
  const handlers = new Map<NodeJS.Signals, () => void>()
  const host: ForegroundSignalHost = {
    on: (signal, handler) => handlers.set(signal, handler),
    off: (signal, handler) => {
      if (handlers.get(signal) === handler) handlers.delete(signal)
    },
  }
  let resolveExit: (code: number) => void = () => undefined
  const killed: NodeJS.Signals[] = []
  const child = {
    exitCode: null as number | null,
    exited: new Promise<number>((resolve) => {
      resolveExit = resolve
    }),
    kill: (signal: NodeJS.Signals) => {
      killed.push(signal)
    },
  }
  const draining = drainForegroundChild(child, host)
  handlers.get("SIGTERM")?.()
  assert.deepEqual(killed, ["SIGTERM"])
  child.exitCode = 0
  resolveExit(0)
  assert.equal(await draining, 0)
  assert.equal(handlers.size, 0)
})

test("foreground child does not signal an already terminal child", async () => {
  const handlers = new Map<NodeJS.Signals, () => void>()
  const host: ForegroundSignalHost = {
    on: (signal, handler) => handlers.set(signal, handler),
    off: (signal) => handlers.delete(signal),
  }
  const killed: NodeJS.Signals[] = []
  const draining = drainForegroundChild({
    exitCode: 3,
    exited: Promise.resolve(3),
    kill: (signal) => killed.push(signal),
  }, host)
  handlers.get("SIGINT")?.()
  assert.equal(await draining, 3)
  assert.deepEqual(killed, [])
  assert.equal(handlers.size, 0)
})
