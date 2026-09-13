import { rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { configuredEffectWorkerV1, runEffectWorkerTickV1 } from "../lib/effect-worker.ts";
import { configuredRunStoreV1 } from "../lib/run-store.ts";

const readyFile = "/tmp/dashboard-effect-worker.ready";
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function safeReason(error) {
  return error instanceof Error && /^[A-Z0-9_:.-]{1,160}$/.test(error.message)
    ? error.message : "EFFECT_WORKER_FAILED";
}

let store = null;
try {
  const configuration = configuredEffectWorkerV1();
  if (!configuration) throw new Error("EFFECT_WORKER_CONFIGURATION_UNAVAILABLE");
  store = configuredRunStoreV1();
  if (!store) throw new Error("RUN_STORE_CONFIGURATION_UNAVAILABLE");
  await store.assertEffectDispatchSchema();
  let ready = false;
  while (!shutdown.signal.aborted) {
    const result = await runEffectWorkerTickV1({ store });
    if (result.state === "unavailable") {
      throw new Error(result.unavailable_reason ?? "EFFECT_WORKER_UNAVAILABLE");
    }
    if (!ready) {
      await writeFile(readyFile, "effect-worker\n", { mode: 0o600 });
      ready = true;
    }
    if (result.state !== "idle") {
      process.stdout.write(`${JSON.stringify({
        schema_version: 1,
        event: "dashboard_effect_worker_tick",
        ...result,
      })}\n`);
    }
    try {
      await delay(configuration.interval_ms, undefined, { signal: shutdown.signal });
    } catch (error) {
      if (!shutdown.signal.aborted) throw error;
    }
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schema_version: 1,
    event: "dashboard_effect_worker_failed",
    reason: safeReason(error),
  })}\n`);
  process.exitCode = 1;
} finally {
  await rm(readyFile, { force: true });
  if (store) await store.close();
}
