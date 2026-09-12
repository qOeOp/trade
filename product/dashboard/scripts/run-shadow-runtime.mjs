import { rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { configuredRunStoreV1 } from "../lib/run-store.ts";
import {
  configuredShadowRuntimeV1,
  runShadowRuntimeTickV1,
  shadowRuntimeRoleV1,
} from "../lib/shadow-runtime.ts";

const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function safeFailureReason(error) {
  return error instanceof Error && /^[A-Z0-9_:.-]{1,160}$/.test(error.message)
    ? error.message
    : "SHADOW_RUNTIME_FAILED";
}

function writeState(result) {
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    event: "dashboard_shadow_runtime_tick",
    ...result,
  })}\n`);
}

const role = shadowRuntimeRoleV1(process.argv[2]);
const readyFile = role ? `/tmp/dashboard-shadow-${role}.ready` : null;
let store = null;
try {
  if (!role) throw new Error("SHADOW_RUNTIME_ROLE_UNAVAILABLE");
  const configuration = configuredShadowRuntimeV1(role);
  if (!configuration) throw new Error("SHADOW_RUNTIME_CONFIGURATION_UNAVAILABLE");
  store = configuredRunStoreV1();
  if (!store) throw new Error("RUN_STORE_CONFIGURATION_UNAVAILABLE");
  await store.assertSchema();
  let previousState = null;
  while (!shutdown.signal.aborted) {
    const result = await runShadowRuntimeTickV1({ role, store });
    if (result.state === "unavailable") {
      throw new Error(result.unavailable_reason ?? "SHADOW_RUNTIME_UNAVAILABLE");
    }
    if (previousState === null) await writeFile(readyFile, `${role}\n`, { mode: 0o600 });
    if (result.state !== "idle" || result.state !== previousState) writeState(result);
    previousState = result.state;
    try {
      await delay(configuration.interval_ms, undefined, { signal: shutdown.signal });
    } catch (error) {
      if (!shutdown.signal.aborted) throw error;
    }
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schema_version: 1,
    event: "dashboard_shadow_runtime_failed",
    role: role ?? "unknown",
    reason: safeFailureReason(error),
  })}\n`);
  process.exitCode = 1;
} finally {
  if (readyFile) await rm(readyFile, { force: true });
  if (store) await store.close();
}
