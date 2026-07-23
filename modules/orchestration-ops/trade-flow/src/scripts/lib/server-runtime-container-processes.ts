import { resolve } from "node:path"
import type { ServerRuntimeContainerProfile } from "./server-runtime-container-profile"

export type ServerRuntimeContainerComponent =
  | "control-runtime"
  | "market-data-manager"
  | "ohlcv-worker"
  | "indicator-worker"

export interface ServerRuntimeContainerProcessSpec {
  id: ServerRuntimeContainerComponent
  description: string
  command: string[]
}

export function serverRuntimeContainerProcessSpecs(
  profile: ServerRuntimeContainerProfile,
  root: string,
  bun: string,
): ServerRuntimeContainerProcessSpec[] {
  const market = profile.market_data_runtime
  const control = profile.control_runtime
  return [
    {
      id: "control-runtime",
      description: "Trade no-live control runtime",
      command: [
        bun,
        resolve(root, "modules/orchestration-ops/trade-flow/src/scripts/main.ts"),
        "--db", control.trade_db,
        "--run-program-shadow-supervisor",
        "--json",
        JSON.stringify({
          ops_runtime_db: control.ops_runtime_db,
          interval_seconds: control.interval_seconds,
          observe_agent_parity: control.observe_agent_parity,
          runtime_profile: "demand_driven_shadow",
        }),
      ],
    },
    {
      id: "market-data-manager",
      description: "Demand-driven multi-symbol L2 runtime manager",
      command: [
        bun,
        resolve(root, "modules/market-data-products/market-data-runtime-manager/src/scripts/foreground.ts"),
        "--market-data-db", market.market_data_db,
        "--max-instances", String(market.l2.max_instances),
        "--base-port", String(market.l2.base_port),
        "--reconcile-interval-ms", String(market.l2.reconcile_interval_ms),
        "--readiness-deadline-ms", String(market.l2.readiness_deadline_ms),
      ],
    },
    {
      id: "ohlcv-worker",
      description: "Demand-driven OHLCV coverage worker",
      command: [
        bun,
        resolve(root, "modules/market-data-products/ohlcv-demand-worker/src/scripts/foreground.ts"),
        "--market-data-db", market.market_data_db,
        "--ohlcv-db", market.ohlcv_db,
        "--max-symbols", String(market.ohlcv_worker.max_symbols),
        "--max-jobs-per-cycle", String(market.ohlcv_worker.max_jobs_per_cycle),
        "--max-rows-per-job", String(market.ohlcv_worker.max_rows_per_job),
        "--interval-ms", String(market.ohlcv_worker.interval_ms),
        "--command-timeout-ms", String(market.ohlcv_worker.command_timeout_ms),
      ],
    },
    {
      id: "indicator-worker",
      description: "Demand-driven deterministic indicator worker",
      command: [
        bun,
        resolve(root, "modules/market-data-products/indicator-demand-worker/src/scripts/foreground.ts"),
        "--market-data-db", market.market_data_db,
        "--ohlcv-db", market.ohlcv_db,
        "--max-symbols", String(market.indicator_worker.max_symbols),
        "--max-jobs-per-cycle", String(market.indicator_worker.max_jobs_per_cycle),
        "--max-bars", String(market.indicator_worker.max_bars),
        "--interval-ms", String(market.indicator_worker.interval_ms),
        "--command-timeout-ms", String(market.indicator_worker.command_timeout_ms),
      ],
    },
  ]
}
