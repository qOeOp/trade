import { resolve } from "node:path"
import type { ServerRuntimeProfile } from "./server-runtime-profile"

export interface ServerRuntimeProcessSpec {
  id: "l2-owner" | "l2-consumer" | "control-runtime"
  description: string
  command: string[]
}

export function serverRuntimeProcessSpecs(
  profile: ServerRuntimeProfile,
  root: string,
  bun: string,
): ServerRuntimeProcessSpec[] {
  const owner = profile.l2_owner
  const consumer = profile.l2_consumer
  const control = profile.control_runtime
  return [
    {
      id: "l2-owner",
      description: "Trade public L2 owner",
      command: [
        bun,
        resolve(root, "apps/market-data-products/l2-order-book-service/src/scripts/foreground.ts"),
        "--symbol", owner.symbol,
        "--output-base", owner.output_base,
        "--listen", owner.listen,
        "--epoch-seconds", String(owner.epoch_seconds),
        "--queue-capacity", String(owner.queue_capacity),
        "--segment-frames", String(owner.segment_frames),
        "--sync-every-frames", String(owner.sync_every_frames),
        "--stale-after-ms", String(owner.stale_after_ms),
        "--restart-limit", String(owner.restart_limit),
        "--market-data-db", owner.market_data_db,
        "--admission-interval-ms", String(owner.admission_interval_ms),
        "--disk-check-interval-ms", String(owner.disk_check_interval_ms),
        "--disk-soft-min-bytes", String(owner.disk_soft_min_bytes),
        "--disk-hard-min-bytes", String(owner.disk_hard_min_bytes),
        "--resource-check-interval-ms", String(owner.resource_check_interval_ms),
      ],
    },
    {
      id: "l2-consumer",
      description: "Trade resident L2 consumer",
      command: [
        bun,
        resolve(root, "apps/orchestration-ops/l2-current-book-probe/src/scripts/consumer-foreground.ts"),
        "--max-cycles", String(consumer.max_cycles),
        "--session-ms", String(consumer.session_ms),
        "--max-events", String(consumer.max_events),
        "--watch-ms", String(consumer.watch_ms),
        "--depth", String(consumer.depth),
        "--max-freshness-ms", String(consumer.max_freshness_ms),
        "--restart-limit", String(consumer.restart_limit),
      ],
    },
    {
      id: "control-runtime",
      description: "Trade no-live control runtime",
      command: [
        bun,
        resolve(root, "apps/orchestration-ops/trade-flow/src/scripts/main.ts"),
        "--db", control.trade_db,
        "--run-program-shadow-supervisor",
        "--json",
        JSON.stringify({
          ops_runtime_db: control.ops_runtime_db,
          interval_seconds: control.interval_seconds,
          observe_agent_parity: control.observe_agent_parity,
        }),
      ],
    },
  ]
}
