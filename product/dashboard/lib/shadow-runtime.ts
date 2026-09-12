import type { PostgresRunStoreV1 } from "./run-store.ts";
import { runShadowSchedulerTickV1 } from "./shadow-scheduler.ts";
import { runShadowWorkerTickV1 } from "./shadow-worker.ts";

type RuntimeEnvironment = Record<string, string | undefined>;

export type ShadowRuntimeRoleV1 = "worker" | "scheduler";

export type ShadowRuntimeConfigurationV1 = {
  schema_version: 1;
  role: ShadowRuntimeRoleV1;
  interval_ms: number;
};

export type ShadowRuntimeTickV1 = {
  schema_version: 1;
  role: ShadowRuntimeRoleV1;
  state: "idle" | "executed" | "enqueued" | "unavailable";
  unavailable_reason: string | null;
  activity_count: number;
};

const DEFAULT_INTERVAL_MS: Record<ShadowRuntimeRoleV1, number> = {
  worker: 1_000,
  scheduler: 5_000,
};

const MIN_INTERVAL_MS: Record<ShadowRuntimeRoleV1, number> = {
  worker: 250,
  scheduler: 1_000,
};

export function shadowRuntimeRoleV1(value: string | undefined): ShadowRuntimeRoleV1 | null {
  return value === "worker" || value === "scheduler" ? value : null;
}

export function configuredShadowRuntimeV1(
  role: ShadowRuntimeRoleV1,
  environment: RuntimeEnvironment = process.env,
): ShadowRuntimeConfigurationV1 | null {
  const variable = role === "worker"
    ? "DASHBOARD_SHADOW_WORKER_INTERVAL_MS"
    : "DASHBOARD_SHADOW_SCHEDULER_INTERVAL_MS";
  const raw = environment[variable];
  const interval = raw === undefined || raw === "" ? DEFAULT_INTERVAL_MS[role] : Number(raw);
  if (!Number.isSafeInteger(interval) || interval < MIN_INTERVAL_MS[role] || interval > 60_000) {
    return null;
  }
  return { schema_version: 1, role, interval_ms: interval };
}

export async function runShadowRuntimeTickV1({
  role,
  store,
  environment = process.env,
  nowEpochMs = Date.now(),
  clock = Date.now,
  fetcher = fetch,
}: {
  role: ShadowRuntimeRoleV1;
  store: PostgresRunStoreV1;
  environment?: RuntimeEnvironment;
  nowEpochMs?: number;
  clock?: () => number;
  fetcher?: typeof fetch;
}): Promise<ShadowRuntimeTickV1> {
  if (role === "worker") {
    const result = await runShadowWorkerTickV1({
      store,
      environment,
      nowEpochMs,
      clock,
      fetcher,
    });
    return {
      schema_version: 1,
      role,
      state: result.state,
      unavailable_reason: result.unavailable_reason,
      activity_count: result.state === "executed" ? 1 : 0,
    };
  }
  const result = await runShadowSchedulerTickV1({ store, environment, nowEpochMs });
  return {
    schema_version: 1,
    role,
    state: result.state,
    unavailable_reason: result.unavailable_reason,
    activity_count: result.enqueued_run_identities.length,
  };
}
