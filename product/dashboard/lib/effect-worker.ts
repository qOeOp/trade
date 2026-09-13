import {
  executeClaimedArtifactFormationV1,
} from "./artifact-formation-client.ts";
import {
  boundEffectWorkerIdentityV1,
  configuredEffectDispatchTargetDigestsV1,
  effectDispatchOperationIdsV1,
  type EffectDispatchTargetDigestsV1,
  type EffectDispatchClaimV1,
} from "./effect-dispatch-contract.ts";
import type { PostgresRunStoreV1 } from "./run-store.ts";
import {
  executeClaimedExploratoryReplayOperationV2,
} from "./exploratory-replay-operation-client.ts";
import { executeClaimedDevelopComposerOperationV2 } from "./develop-composer-operation-client.ts";
import { DEVELOP_COMPOSER_EXECUTE_OPERATION } from "./develop-composer-operation.ts";
import { EXPLORATORY_REPLAY_EXECUTE_OPERATION } from "./exploratory-replay-operation.ts";
import {
  executeClaimedSourceResearchOperationV1,
} from "./source-research-operation.ts";

type Environment = Record<string, string | undefined>;

export type EffectWorkerTickV1 = {
  schema_version: 1;
  state: "idle" | "executed" | "unavailable";
  unavailable_reason: string | null;
  run_identity: string | null;
};

export type EffectWorkerConfigurationV1 = {
  schema_version: 1;
  configured_identity: string;
  worker_identity: string;
  worker_capability: string;
  worker_artifact_digest: string;
  target_digests: EffectDispatchTargetDigestsV1;
  interval_ms: number;
};

function intervalMilliseconds(value: string | undefined): number | null {
  const parsed = value === undefined || value === "" ? 1_000 : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 250 && parsed <= 60_000 ? parsed : null;
}

export function configuredEffectWorkerV1(
  environment: Environment = process.env,
): EffectWorkerConfigurationV1 | null {
  const configuredIdentity = environment.DASHBOARD_EFFECT_WORKER_ID;
  const workerCapability = environment.DASHBOARD_EFFECT_WORKER_TOKEN;
  const workerArtifactDigest = environment.DASHBOARD_EFFECT_WORKER_ARTIFACT_DIGEST;
  const interval = intervalMilliseconds(environment.DASHBOARD_EFFECT_WORKER_INTERVAL_MS);
  const targetDigests = configuredEffectDispatchTargetDigestsV1(environment);
  if (!configuredIdentity || !workerCapability || !workerArtifactDigest
    || !targetDigests || interval === null) return null;
  const workerIdentity = boundEffectWorkerIdentityV1({
    configuredIdentity,
    operationIds: effectDispatchOperationIdsV1,
    workerCapability,
    workerArtifactDigest,
  });
  if (!workerIdentity) return null;
  return {
    schema_version: 1,
    configured_identity: configuredIdentity,
    worker_identity: workerIdentity,
    worker_capability: workerCapability,
    worker_artifact_digest: workerArtifactDigest,
    target_digests: targetDigests,
    interval_ms: interval,
  };
}

async function executeClaimV1({
  claim,
  store,
  environment,
  fetcher,
}: {
  claim: EffectDispatchClaimV1;
  store: PostgresRunStoreV1;
  environment: Environment;
  fetcher: typeof fetch;
}) {
  if (claim.operation_id === "artifact_build.formation_execute.v1") {
    return executeClaimedArtifactFormationV1({
      claim,
      environment,
      fetcher,
      store,
    });
  }
  if (claim.operation_id === EXPLORATORY_REPLAY_EXECUTE_OPERATION) {
    return executeClaimedExploratoryReplayOperationV2({
      claim,
      environment,
      fetcher,
      store,
    });
  }
  if (claim.operation_id === DEVELOP_COMPOSER_EXECUTE_OPERATION) {
    return executeClaimedDevelopComposerOperationV2({
      claim,
      environment,
      fetcher,
      store,
    });
  }
  return executeClaimedSourceResearchOperationV1({
    claim,
    environment,
    fetcher,
    store,
  });
}

export async function runEffectWorkerTickV1({
  store,
  environment = process.env,
  fetcher = fetch,
  nowEpochMs = Date.now(),
}: {
  store: PostgresRunStoreV1;
  environment?: Environment;
  fetcher?: typeof fetch;
  nowEpochMs?: number;
}): Promise<EffectWorkerTickV1> {
  const configuration = configuredEffectWorkerV1(environment);
  if (!configuration) {
    return {
      schema_version: 1,
      state: "unavailable",
      unavailable_reason: "EFFECT_WORKER_CONFIGURATION_UNAVAILABLE",
      run_identity: null,
    };
  }
  await store.registerEffectWorker({
    configuredIdentity: configuration.configured_identity,
    workerIdentity: configuration.worker_identity,
    operationIds: effectDispatchOperationIdsV1,
    workerCapability: configuration.worker_capability,
    workerArtifactDigest: configuration.worker_artifact_digest,
    leaseMilliseconds: 300_000,
  });
  const claim = await store.claimNextEffect({
    workerIdentity: configuration.worker_identity,
    workerCapability: configuration.worker_capability,
    targetDigests: configuration.target_digests,
    leaseMilliseconds: 240_000,
  });
  if (!claim) {
    return {
      schema_version: 1,
      state: "idle",
      unavailable_reason: null,
      run_identity: null,
    };
  }
  const leaseAbort = new AbortController();
  let renewalFailure: unknown = null;
  let renewalPromise: Promise<void> | null = null;
  const renewal = setInterval(() => {
    if (renewalPromise || renewalFailure) return;
    renewalPromise = store.renewEffectClaim({
      runIdentity: claim.run_identity,
      workerIdentity: configuration.worker_identity,
      workerCapability: configuration.worker_capability,
      claimToken: claim.claim_token,
    }).catch((error: unknown) => {
      renewalFailure = error;
      leaseAbort.abort(error);
    }).finally(() => {
      renewalPromise = null;
    });
  }, 30_000);
  renewal.unref();
  const guardedFetcher: typeof fetch = (input, init) => fetcher(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, leaseAbort.signal])
      : leaseAbort.signal,
  });
  let retry = true;
  try {
    const result = await executeClaimV1({
      claim,
      store,
      environment,
      fetcher: guardedFetcher,
    });
    if (renewalFailure) throw renewalFailure;
    retry = result === "retry";
  } catch {
    retry = true;
  } finally {
    clearInterval(renewal);
    await renewalPromise;
  }
  if (renewalFailure) throw new Error("EFFECT_WORKER_RENEWAL_UNAVAILABLE");
  await store.settleEffectClaim({
    runIdentity: claim.run_identity,
    workerIdentity: configuration.worker_identity,
    workerCapability: configuration.worker_capability,
    claimToken: claim.claim_token,
    retry,
  });
  return {
    schema_version: 1,
    state: "executed",
    unavailable_reason: null,
    run_identity: claim.run_identity,
  };
}
