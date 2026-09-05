import {
  operationDeploymentForIdV1,
  operationRegistryV1,
  type RegisteredOperationId,
} from "./operation-registry.ts";
import type { PostgresRunStoreV1 } from "./run-store.ts";
import { executeClaimedShadowReadV1 } from "./shadow-dispatcher.ts";

type WorkerEnvironment = Record<string, string | undefined>;
type Fetcher = typeof fetch;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function boundShadowWorkerIdentityV1({
  configuredIdentity,
  operationIds,
  workerCapability,
  workerArtifactDigest,
}: {
  configuredIdentity: string;
  operationIds: readonly RegisteredOperationId[];
  workerCapability: string;
  workerArtifactDigest: string;
}): string | null {
  if (!IDENTITY.test(configuredIdentity) || Buffer.byteLength(workerCapability, "utf8") < 32
    || Buffer.byteLength(workerCapability, "utf8") > 4_096 || !DIGEST.test(workerArtifactDigest)
    || operationIds.length < 1 || new Set(operationIds).size !== operationIds.length) return null;
  const generation = sha256(JSON.stringify({
    schema_version: 1,
    configured_identity: configuredIdentity,
    operation_ids: [...operationIds].sort(),
    worker_artifact_digest: workerArtifactDigest,
    worker_capability_digest: sha256(workerCapability),
  }));
  return `dashboard-shadow-worker-v1-${generation.slice("sha256:".length)}`;
}

export type ShadowWorkerTickV1 = {
  schema_version: 1;
  state: "idle" | "executed" | "unavailable";
  unavailable_reason: string | null;
  run_identity: string | null;
};

export function availableShadowWorkerOperationsV1(
  environment: WorkerEnvironment = process.env,
  nowEpochMs = Date.now(),
): RegisteredOperationId[] {
  return operationRegistryV1
    .filter((operation) => operation.effect_set.length === 0
      && operationDeploymentForIdV1(operation.operation_id, environment, nowEpochMs)
        .deployment_state === "available")
    .map(({ operation_id }) => operation_id);
}

export async function runShadowWorkerTickV1({
  store,
  environment = process.env,
  fetcher = fetch,
  nowEpochMs = Date.now(),
  clock = Date.now,
}: {
  store: Pick<
    PostgresRunStoreV1,
    "registerShadowWorker" | "claimNextRead" | "completeClaimedRead"
  >;
  environment?: WorkerEnvironment;
  fetcher?: Fetcher;
  nowEpochMs?: number;
  clock?: () => number;
}): Promise<ShadowWorkerTickV1> {
  const configuredWorkerIdentity = environment.DASHBOARD_SHADOW_WORKER_ID;
  const workerCapability = environment.DASHBOARD_SHADOW_WORKER_TOKEN;
  const workerArtifactDigest = environment.DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST;
  if (!configuredWorkerIdentity || !workerCapability || !workerArtifactDigest) {
    return {
      schema_version: 1,
      state: "unavailable",
      unavailable_reason: "WORKER_CONFIGURATION_UNAVAILABLE",
      run_identity: null,
    };
  }
  const operationIds = availableShadowWorkerOperationsV1(environment, nowEpochMs);
  if (operationIds.length === 0) {
    return {
      schema_version: 1,
      state: "unavailable",
      unavailable_reason: "WORKER_COMPATIBILITY_UNAVAILABLE",
      run_identity: null,
    };
  }
  const workerIdentity = boundShadowWorkerIdentityV1({
    configuredIdentity: configuredWorkerIdentity,
    operationIds,
    workerCapability,
    workerArtifactDigest,
  });
  if (!workerIdentity) {
    return {
      schema_version: 1,
      state: "unavailable",
      unavailable_reason: "WORKER_CONFIGURATION_UNAVAILABLE",
      run_identity: null,
    };
  }
  await store.registerShadowWorker({
    workerIdentity,
    operationIds,
    workerCapability,
    workerArtifactDigest,
  });
  const claim = await store.claimNextRead({ workerIdentity, workerCapability });
  if (!claim) {
    return {
      schema_version: 1,
      state: "idle",
      unavailable_reason: null,
      run_identity: null,
    };
  }
  const execution = await executeClaimedShadowReadV1({
    claim,
    workerIdentity,
    store,
    environment,
    fetcher,
    nowEpochMs,
    clock,
  });
  return {
    schema_version: 1,
    state: "executed",
    unavailable_reason: null,
    run_identity: execution.run.run_identity,
  };
}
import { createHash } from "node:crypto";
