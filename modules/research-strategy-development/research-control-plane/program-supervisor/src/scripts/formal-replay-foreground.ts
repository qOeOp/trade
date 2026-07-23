#!/usr/bin/env bun

import {
  parseBoundedInteger,
} from "../../../../../contracts/runtime-core/src/resident-worker"
import {
  runFormalReplayResidentForeground,
  type FormalReplayResidentForegroundConfig,
} from "../lib/formal-replay-resident-foreground"
import type {
  FormalReplayResidentCycleResult,
} from "../lib/formal-replay-resident-worker"

async function main(argv: string[]): Promise<void> {
  const config = parseArgs(argv)
  const controller = new AbortController()
  let activeChild: {
    exitCode: number | null
    kill(signal: NodeJS.Signals): void
  } | null = null
  const stop = () => {
    controller.abort()
    if (activeChild && activeChild.exitCode == null) {
      activeChild.kill("SIGTERM")
    }
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  await runFormalReplayResidentForeground(
    config,
    controller.signal,
    {
      cycle: async (dbPath, input) => {
        const child = Bun.spawn({
          cmd: [
            process.execPath,
            new URL("./main.ts", import.meta.url).pathname,
            "--formal-replay-worker-once",
            "--db",
            dbPath,
            "--json",
            JSON.stringify(input),
          ],
          cwd: process.cwd(),
          env: process.env,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        })
        activeChild = child
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        activeChild = null
        let envelope: Record<string, unknown>
        try {
          envelope = JSON.parse(stdout) as Record<string, unknown>
        } catch {
          throw new Error(
            stderr.trim() || `formal Replay worker child exited ${exitCode}`,
          )
        }
        if (envelope.ok !== true
            || !envelope.data
            || typeof envelope.data !== "object"
            || Array.isArray(envelope.data)) {
          throw new Error(
            typeof envelope.error === "string"
              ? envelope.error
              : "formal Replay worker child returned an invalid envelope",
          )
        }
        return envelope.data as unknown as FormalReplayResidentCycleResult
      },
      wait: async (intervalMs, consecutiveFailures, register) => {
        const milliseconds = consecutiveFailures === 0
          ? intervalMs
          : Math.min(intervalMs, 1_000 * 2 ** Math.min(consecutiveFailures - 1, 6))
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, milliseconds)
          register(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      },
      now: () => new Date().toISOString(),
    },
  )
}

function parseArgs(argv: string[]): FormalReplayResidentForegroundConfig {
  const config: FormalReplayResidentForegroundConfig = {
    db_path: "data/rd_state.db",
    environment_id: process.env.TRADE_ENVIRONMENT_ID || "local:local",
    queue_worker_id: process.env.TRADE_FORMAL_REPLAY_WORKER_ID
      || "formal-replay-resident-1",
    queue_lease_duration_ms: 18_000_000,
    state_path: "tmp/runtime/formal-replay-worker/state.json",
    interval_ms: 5_000,
    max_cycles: 0,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value) throw new Error(`${flag} requires a value`)
    index += 1
    switch (flag) {
      case "--db":
        config.db_path = value
        break
      case "--environment-id":
        config.environment_id = value
        break
      case "--worker-id":
        config.queue_worker_id = value
        break
      case "--queue-lease-duration-ms":
        config.queue_lease_duration_ms = parseBoundedInteger(
          value,
          300_001,
          86_400_000,
          "queue_lease_duration_ms",
        )
        break
      case "--state-path":
        config.state_path = value
        break
      case "--interval-ms":
        config.interval_ms = parseBoundedInteger(
          value,
          100,
          300_000,
          "interval_ms",
        )
        break
      case "--max-cycles":
        config.max_cycles = parseBoundedInteger(
          value,
          0,
          1_000_000,
          "max_cycles",
        )
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }
  return config
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
