import type { ControlPlaneAdmissionContextV1 } from "./control-plane-admission-contract.ts";
import { validControlPlaneAdmissionContextV1 } from "./control-plane-admission-contract.ts";
import {
  canonicalDevelopComposerDispatchRequestV2,
  canonicalDevelopComposerProjectionV2,
  canonicalDevelopComposerRunRequestV2,
  developComposerOwnerRunBodyV2,
  developComposerProjectionDigestV2,
  parseDevelopComposerOperationResponseV2,
  type DevelopComposerDispatchRequestV2,
  type DevelopComposerOperationResponseV2,
  type DevelopComposerRequestProjectionV2,
  type DevelopComposerRunRequestV2,
} from "./develop-composer-action-contract.ts";
import {
  admitDevelopComposerExecutionV2,
  DEVELOP_COMPOSER_EXECUTE_OPERATION,
} from "./develop-composer-operation.ts";
import {
  configuredEffectDispatchTargetV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
  type EffectDispatchClaimV1,
} from "./effect-dispatch-contract.ts";
import { operationalRunAvailableV1, operationalRunUnavailableV1 } from "./operational-run-reference.ts";
import type { ProductEdgeRoutingObservationV1 } from "./product-edge-routing-client.ts";
import { configuredRunStoreV1, type OperationRunV1, type PostgresRunStoreV1 } from "./run-store.ts";

const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024;
type Environment = Record<string, string | undefined>;

export type DevelopComposerOperationEnvelopeV2 = {
  status: number;
  envelope: {
    schema_version: 1;
    operation: typeof DEVELOP_COMPOSER_EXECUTE_OPERATION;
    channel: "DASHBOARD_DISPOSABLE_EXECUTION";
    availability: "available" | "unavailable";
    unavailable_reason: string | null;
    request_identity: string | null;
    projection_digest: string | null;
    operational_run: ReturnType<typeof operationalRunAvailableV1>
      | ReturnType<typeof operationalRunUnavailableV1>;
  };
};

export type DevelopComposerQueueStoreV2 = Pick<PostgresRunStoreV1,
  "assertEffectDispatchSchema" | "readDevelopComposerRecovery" | "beginDevelopComposer">;
export type DevelopComposerClaimStoreV2 = Pick<PostgresRunStoreV1,
  "readDevelopComposerRecovery" | "recordDevelopComposerSubmissionStarted"
  | "completeDevelopComposer">;

function unavailable(
  reason: string,
  status: number,
  run: OperationRunV1 | null = null,
  requestIdentity: string | null = null,
  projectionDigest: string | null = null,
): DevelopComposerOperationEnvelopeV2 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: DEVELOP_COMPOSER_EXECUTE_OPERATION,
      channel: "DASHBOARD_DISPOSABLE_EXECUTION",
      availability: "unavailable",
      unavailable_reason: reason,
      request_identity: requestIdentity,
      projection_digest: projectionDigest,
      operational_run: operationalRunUnavailableV1(run ? "RUN_RECOVERY_REQUIRED" : "RUN_NOT_STARTED", run),
    },
  };
}

function available(run: OperationRunV1, requestIdentity: string, projectionDigest: string) {
  return {
    status: 202,
    envelope: {
      schema_version: 1 as const,
      operation: DEVELOP_COMPOSER_EXECUTE_OPERATION,
      channel: "DASHBOARD_DISPOSABLE_EXECUTION" as const,
      availability: "available" as const,
      unavailable_reason: null,
      request_identity: requestIdentity,
      projection_digest: projectionDigest,
      operational_run: operationalRunAvailableV1(run),
    },
  };
}

function ownerConfiguration(environment: Environment, ownerUrl: string) {
  const token = environment.RD_OWNER_API_TOKEN;
  if (environment.DASHBOARD_DEPLOYMENT_CLASS !== "DISPOSABLE_LOCAL"
    || environment.DASHBOARD_DISPOSABLE_DEVELOP_COMPOSER_EXECUTION !== "ENABLED"
    || !token) return null;
  return { ownerUrl, token };
}

async function boundedJson(response: Response): Promise<unknown | null> {
  const length = response.headers.get("content-length");
  if (length !== null && /^[0-9]+$/.test(length)
    && BigInt(length) > BigInt(MAX_OWNER_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OWNER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export async function projectDevelopComposerRequestV2({
  researchRequestLocator,
  ownerUrl,
  token,
  fetcher = fetch,
}: {
  researchRequestLocator: string;
  ownerUrl: string;
  token: string;
  fetcher?: typeof fetch;
}): Promise<DevelopComposerRequestProjectionV2 | null> {
  try {
    const url = new URL("/v2/develop-composer/request-projections", ownerUrl);
    url.searchParams.set("research_request_locator", researchRequestLocator);
    const response = await fetcher(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    return response.status === 200
      ? canonicalDevelopComposerProjectionV2(await boundedJson(response), researchRequestLocator)
      : null;
  } catch {
    return null;
  }
}

async function ownerPost({
  path,
  body,
  requestIdentity,
  ownerUrl,
  token,
  fetcher,
}: {
  path: string;
  body?: string;
  requestIdentity: string;
  ownerUrl: string;
  token: string;
  fetcher: typeof fetch;
}): Promise<DevelopComposerOperationResponseV2 | null> {
  try {
    const response = await fetcher(new URL(path, ownerUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "x-trade-effect-dispatcher": "TRADE_DASHBOARD",
      },
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    return parseDevelopComposerOperationResponseV2(
      response.status,
      await boundedJson(response),
      requestIdentity,
    );
  } catch {
    return null;
  }
}

function isAbsent(response: DevelopComposerOperationResponseV2): boolean {
  return response.disposition === "UNAVAILABLE"
    && response.coordinate === "operation"
    && response.reason === "terminal is unavailable";
}

async function resolveOwner(
  projection: DevelopComposerRequestProjectionV2,
  owner: { ownerUrl: string; token: string },
  fetcher: typeof fetch,
) {
  const response = await ownerPost({
    path: `/v2/develop-composer/runs/${encodeURIComponent(projection.request_identity)}/resolve`,
    requestIdentity: projection.request_identity,
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    fetcher,
  });
  if (!response) return { state: "unknown" as const };
  return isAbsent(response)
    ? { state: "absent" as const }
    : { state: "terminal" as const, response };
}

export async function enqueueDevelopComposerOperationV2({
  request,
  actionContext,
  environment = process.env,
  fetcher = fetch,
  routingResolver,
  nowEpochMs = Date.now(),
  store = configuredRunStoreV1(),
}: {
  request: DevelopComposerRunRequestV2;
  actionContext: ControlPlaneAdmissionContextV1;
  environment?: Environment;
  fetcher?: typeof fetch;
  routingResolver?: () => Promise<ProductEdgeRoutingObservationV1>;
  nowEpochMs?: number;
  store?: DevelopComposerQueueStoreV2 | null;
}): Promise<DevelopComposerOperationEnvelopeV2> {
  const canonical = canonicalDevelopComposerRunRequestV2(request);
  if (!canonical) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  if (!validControlPlaneAdmissionContextV1(actionContext)
    || actionContext.requestedAction !== "RUN") {
    return unavailable("EXECUTION_AUTHORIZATION_UNAVAILABLE", 503);
  }
  const target = configuredEffectDispatchTargetV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, environment);
  const owner = target && ownerConfiguration(environment, target.owner_url);
  if (!target || !owner) return unavailable("EXECUTION_CONFIGURATION_UNAVAILABLE", 503);
  if (!store) return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  const admission = await admitDevelopComposerExecutionV2({
    environment,
    nowEpochMs,
    ...(routingResolver ? { routingResolver: () => routingResolver() } : {}),
  });
  if (admission.availability !== "available") {
    return unavailable(admission.unavailable_reason === "DASHBOARD_ROUTING_UNAVAILABLE"
      ? "EXECUTION_ROUTING_UNAVAILABLE" : "EXECUTION_COMPATIBILITY_UNAVAILABLE", 503);
  }
  const projection = await projectDevelopComposerRequestV2({
    researchRequestLocator: canonical.research_request_locator,
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    fetcher,
  });
  if (!projection) return unavailable("EXECUTION_PREFLIGHT_UNAVAILABLE", 409);
  const projectionDigest = developComposerProjectionDigestV2(projection);
  const recoveryIdentity = { request_identity: projection.request_identity, projection_digest: projectionDigest };
  const dispatchRequest: DevelopComposerDispatchRequestV2 = { ...canonical, projection };
  const requestDigest = effectDispatchRequestDigestV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, dispatchRequest);
  if (!requestDigest) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  try {
    await store.assertEffectDispatchSchema();
    const prior = await store.readDevelopComposerRecovery(recoveryIdentity);
    if (prior) {
      if (prior.request_digest !== requestDigest) {
        return unavailable("EXECUTION_REQUEST_CONFLICT", 409, prior.run,
          projection.request_identity, projectionDigest);
      }
      return ["queued", "running"].includes(prior.run.state)
        ? available(prior.run, projection.request_identity, projectionDigest)
        : unavailable("EXECUTION_PRIOR_RUN_TERMINAL", 409, prior.run,
          projection.request_identity, projectionDigest);
    }
    const started = await store.beginDevelopComposer({
      recoveryIdentity,
      admission,
      actionContext,
      dispatchRequest,
      dispatchTarget: target,
    });
    return available(started.run, projection.request_identity, projectionDigest);
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503, null,
      projection.request_identity, projectionDigest);
  }
}

function sameDigest(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function terminalDisposition(
  response: DevelopComposerOperationResponseV2,
  projection: DevelopComposerRequestProjectionV2,
) {
  if (response.disposition === "SUCCESS") {
    if (!response.artifact
      || !sameDigest(response.artifact.design_digest, projection.design_digest)) return null;
    return { operationalState: "succeeded" as const, ownerOutcomeState: "available" as const,
      terminalCode: "OWNER_AVAILABLE" as const };
  }
  if (["CONFLICT", "UNSUPPORTED", "NEEDS_RESEARCH_REFINEMENT"].includes(response.disposition)) {
    return { operationalState: "failed" as const, ownerOutcomeState: "rejected" as const,
      terminalCode: "OWNER_REJECTED" as const };
  }
  if (response.disposition === "UNAVAILABLE") {
    return { operationalState: "failed" as const, ownerOutcomeState: "unavailable" as const,
      terminalCode: "OWNER_UNAVAILABLE" as const };
  }
  return null;
}

export async function executeClaimedDevelopComposerOperationV2({
  claim,
  environment = process.env,
  fetcher = fetch,
  store,
}: {
  claim: EffectDispatchClaimV1;
  environment?: Environment;
  fetcher?: typeof fetch;
  store: DevelopComposerClaimStoreV2;
}): Promise<"terminal" | "retry"> {
  if (claim.operation_id !== DEVELOP_COMPOSER_EXECUTE_OPERATION) return "retry";
  const request = canonicalDevelopComposerDispatchRequestV2(claim.request);
  const target = configuredEffectDispatchTargetV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, environment);
  const owner = target && ownerConfiguration(environment, target.owner_url);
  if (!request || !target || !owner
    || effectDispatchRequestDigestV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, request) !== claim.request_digest
    || effectDispatchTargetDigestV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, target) !== claim.frozen_target_digest
    || JSON.stringify(target) !== JSON.stringify(claim.frozen_target)) return "retry";
  const projectionDigest = developComposerProjectionDigestV2(request.projection);
  const recoveryIdentity = {
    request_identity: request.projection.request_identity,
    projection_digest: projectionDigest,
  };
  const recovery = await store.readDevelopComposerRecovery(recoveryIdentity);
  if (!recovery || recovery.request_digest !== claim.request_digest) return "retry";
  const currentProjection = await projectDevelopComposerRequestV2({
    researchRequestLocator: request.research_request_locator,
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    fetcher,
  });
  if (!currentProjection || JSON.stringify(currentProjection) !== JSON.stringify(request.projection)) {
    return "retry";
  }
  let resolution = await resolveOwner(request.projection, owner, fetcher);
  if (resolution.state === "unknown") return "retry";
  let transitionVersion = claim.transition_version;
  if (resolution.state === "absent") {
    if (recovery.submission_started || claim.claim_attempt > 1) return "retry";
    const started = await store.recordDevelopComposerSubmissionStarted({
      runIdentity: claim.run_identity,
      expectedTransitionVersion: transitionVersion,
    });
    transitionVersion = started.transition_version;
    const submitted = await ownerPost({
      path: "/v2/develop-composer/runs",
      body: developComposerOwnerRunBodyV2(request.research_request_locator),
      requestIdentity: request.projection.request_identity,
      ownerUrl: owner.ownerUrl,
      token: owner.token,
      fetcher,
    });
    if (!submitted) return "retry";
    resolution = await resolveOwner(request.projection, owner, fetcher);
    if (resolution.state !== "terminal") return "retry";
  }
  const terminal = terminalDisposition(resolution.response, request.projection);
  if (!terminal) return "retry";
  await store.completeDevelopComposer({
    runIdentity: claim.run_identity,
    expectedTransitionVersion: transitionVersion,
    ...terminal,
  });
  return "terminal";
}
