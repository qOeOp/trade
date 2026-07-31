import { resolve } from "node:path"
import type { L2MultiSymbolPlan } from "./multi-symbol-plan"

export interface ManagedL2Pair {
  assignment: L2MultiSymbolPlan["instances"][number]
  owner: ManagedProcess
  consumer: ManagedProcess
}

export interface ManagedProcess {
  service_id: string
  role: "owner" | "consumer"
}

export interface MarketDataManagerDependencies {
  start_owner: (command: string[], serviceId: string) => Promise<ManagedProcess>
  wait_owner_ready: (symbol: string, process: ManagedProcess) => Promise<boolean>
  start_consumer: (command: string[], serviceId: string) => Promise<ManagedProcess>
  wait_consumer_ready: (symbol: string, process: ManagedProcess) => Promise<boolean>
  drain: (process: ManagedProcess) => Promise<void>
}

export interface MarketDataManagerApplyResult {
  status: "completed" | "source_blocked" | "failed"
  source_plan_hash: string
  desired_plan_hash: string
  effects: Array<{
    sequence: number
    kind: "drained" | "started" | "start_failed"
    service_id: string
    symbol: string
    reason: string
  }>
  active_service_ids: string[]
  failure_class?: "owner_start_failed" | "owner_not_ready" | "consumer_start_failed" | "consumer_not_ready" | "drain_failed"
}

export function buildManagedL2Commands(input: {
  root: string
  bun_path: string
  instance: L2MultiSymbolPlan["instances"][number]
  market_data_db: string
}): { owner: string[]; consumer: string[] } {
  if (!input.root.startsWith("/") || !input.bun_path.startsWith("/")) throw new Error("manager root and bun_path must be absolute")
  if (input.market_data_db !== "data/market_data.db") throw new Error("manager market_data_db is fixed")
  const ownerScript = resolve(
    input.root,
    "apps/market-data-products/l2-order-book-service/src/scripts/foreground.ts",
  )
  const consumerScript = resolve(
    input.root,
    "apps/orchestration-ops/l2-current-book-probe/src/scripts/consumer-foreground.ts",
  )
  return {
    owner: [
      input.bun_path,
      ownerScript,
      "--symbol", input.instance.symbol,
      "--output-base", input.instance.output_base,
      "--listen", input.instance.listen,
      "--epoch-seconds", "86100",
      "--queue-capacity", "256",
      "--segment-frames", "1000",
      "--sync-every-frames", "100",
      "--stale-after-ms", "2000",
      "--restart-limit", "8",
      "--market-data-db", input.market_data_db,
      "--admission-interval-ms", "30000",
      "--disk-check-interval-ms", "5000",
      "--disk-soft-min-bytes", String(10 * 1024 ** 3),
      "--disk-hard-min-bytes", String(5 * 1024 ** 3),
      "--resource-check-interval-ms", "30000",
    ],
    consumer: [
      input.bun_path,
      consumerScript,
      "--symbol", input.instance.symbol,
      "--max-cycles", "120",
      "--session-ms", "300000",
      "--max-events", "20",
      "--watch-ms", "1000",
      "--depth", String(input.instance.minimum_depth),
      "--max-freshness-ms", String(Math.min(2_000, input.instance.max_freshness_ms)),
      "--restart-limit", "8",
    ],
  }
}

export async function applyL2MultiSymbolPlan(input: {
  root: string
  bun_path: string
  market_data_db: string
  plan: L2MultiSymbolPlan
  active: Map<string, ManagedL2Pair>
  dependencies: MarketDataManagerDependencies
}): Promise<MarketDataManagerApplyResult> {
  const effects: MarketDataManagerApplyResult["effects"] = []
  if (input.plan.lifecycle_authority !== "proposal_only") throw new Error("L2 desired plan authority drifted")
  if (input.plan.status !== "ready") {
    return result("source_blocked", input, effects)
  }
  for (const action of input.plan.actions) {
    if (action.kind !== "drain") continue
    const pair = input.active.get(action.service_id)
    if (pair == null || pair.assignment.symbol !== action.symbol) {
      return result("failed", input, effects, "drain_failed")
    }
    try {
      await input.dependencies.drain(pair.consumer)
      await input.dependencies.drain(pair.owner)
    } catch {
      return result("failed", input, effects, "drain_failed")
    }
    input.active.delete(action.service_id)
    effects.push({
      sequence: effects.length + 1,
      kind: "drained",
      service_id: action.service_id,
      symbol: action.symbol,
      reason: action.reason,
    })
  }
  for (const action of input.plan.actions) {
    if (action.kind !== "start") continue
    const instance = input.plan.instances.find((item) => item.service_id === action.service_id)
    if (instance == null || instance.symbol !== action.symbol || instance.slot !== action.slot) {
      throw new Error("L2 start action does not bind a desired instance")
    }
    const commands = buildManagedL2Commands({
      root: input.root,
      bun_path: input.bun_path,
      instance,
      market_data_db: input.market_data_db,
    })
    let owner: ManagedProcess
    try {
      owner = await input.dependencies.start_owner(commands.owner, action.service_id)
    } catch {
      effects.push(failedEffect(effects.length + 1, action, "owner_start_failed"))
      return result("failed", input, effects, "owner_start_failed")
    }
    if (!await input.dependencies.wait_owner_ready(action.symbol, owner)) {
      await safeDrain(owner, input.dependencies)
      effects.push(failedEffect(effects.length + 1, action, "owner_not_ready"))
      return result("failed", input, effects, "owner_not_ready")
    }
    let consumer: ManagedProcess
    try {
      consumer = await input.dependencies.start_consumer(commands.consumer, action.service_id)
    } catch {
      await safeDrain(owner, input.dependencies)
      effects.push(failedEffect(effects.length + 1, action, "consumer_start_failed"))
      return result("failed", input, effects, "consumer_start_failed")
    }
    if (!await input.dependencies.wait_consumer_ready(action.symbol, consumer)) {
      await safeDrain(consumer, input.dependencies)
      await safeDrain(owner, input.dependencies)
      effects.push(failedEffect(effects.length + 1, action, "consumer_not_ready"))
      return result("failed", input, effects, "consumer_not_ready")
    }
    input.active.set(action.service_id, { assignment: instance, owner, consumer })
    effects.push({
      sequence: effects.length + 1,
      kind: "started",
      service_id: action.service_id,
      symbol: action.symbol,
      reason: action.reason,
    })
  }
  return result("completed", input, effects)
}

function failedEffect(
  sequence: number,
  action: Extract<L2MultiSymbolPlan["actions"][number], { kind: "start" }>,
  reason: string,
): MarketDataManagerApplyResult["effects"][number] {
  return {
    sequence,
    kind: "start_failed",
    service_id: action.service_id,
    symbol: action.symbol,
    reason,
  }
}

function result(
  status: MarketDataManagerApplyResult["status"],
  input: {
    plan: L2MultiSymbolPlan
    active: Map<string, ManagedL2Pair>
  },
  effects: MarketDataManagerApplyResult["effects"],
  failureClass?: MarketDataManagerApplyResult["failure_class"],
): MarketDataManagerApplyResult {
  return {
    status,
    source_plan_hash: input.plan.source_plan_hash,
    desired_plan_hash: input.plan.plan_hash,
    effects,
    active_service_ids: [...input.active.keys()].sort(),
    ...(failureClass == null ? {} : { failure_class: failureClass }),
  }
}

async function safeDrain(process: ManagedProcess, dependencies: MarketDataManagerDependencies): Promise<void> {
  try {
    await dependencies.drain(process)
  } catch {
    // The start failure remains authoritative; cleanup failure is retried during manager shutdown.
  }
}
