#!/usr/bin/env bun

import { parseBoundedInteger } from "../../../../../contracts/runtime-core/src/resident-worker"
import {
  runStrategyRegistryResidentForeground,
  type StrategyRegistryResidentForegroundConfig,
} from "../lib/strategy-registry-resident-foreground"

async function main(argv: string[]): Promise<void> {
  const config = parseArgs(argv)
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  await runStrategyRegistryResidentForeground(
    config,
    controller.signal,
  )
}

export function parseArgs(argv: string[]): StrategyRegistryResidentForegroundConfig {
  const config: StrategyRegistryResidentForegroundConfig = {
    db_path: "data/rd_state.db",
    state_path: "tmp/runtime/strategy-registry-worker/state.json",
    candidate_root: "data/release-candidates/strategy-drafts",
    environment_id: process.env.TRADE_ENVIRONMENT_ID || "local:local",
    worker_id: process.env.TRADE_STRATEGY_REGISTRY_WORKER_ID
      || "strategy-registry-resident-1",
    lease_duration_ms: 60_000,
    max_attempts: 3,
    interval_ms: 5_000,
    max_cycles: 0,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value) throw new Error(`${flag} requires a value`)
    index += 1
    switch (flag) {
      case "--db": config.db_path = value; break
      case "--state-path": config.state_path = value; break
      case "--candidate-root": config.candidate_root = value; break
      case "--environment-id": config.environment_id = value; break
      case "--worker-id": config.worker_id = value; break
      case "--lease-duration-ms":
        config.lease_duration_ms = parseBoundedInteger(
          value,
          1_000,
          3_600_000,
          "lease_duration_ms",
        )
        break
      case "--max-attempts":
        config.max_attempts = parseBoundedInteger(
          value,
          1,
          100,
          "max_attempts",
        )
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
      default: throw new Error(`unknown flag: ${flag}`)
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
