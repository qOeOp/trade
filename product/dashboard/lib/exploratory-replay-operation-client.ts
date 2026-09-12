import {
  isSafeNumber,
  LosslessNumber,
  parse as parseLosslessJson,
} from "lossless-json";

import {
  validControlPlaneAdmissionContextV1,
  type ControlPlaneAdmissionContextV1,
} from "./control-plane-admission-contract.ts";
import {
  canonicalExploratoryReplayDispatchRequestV2,
  canonicalExploratoryReplayRunRequestV2,
  canonicalReplayRequestDigestV2,
  exploratoryReplayOwnerProposalBodyV2,
  exploratoryReplayOwnerRequestBodyV2,
  normalizeExploratoryReplayOwnerRequestV2,
  type ExploratoryReplayDispatchRequestV2,
  type ExploratoryReplayRunRequestV2,
} from "./exploratory-replay-action-contract.ts";
import {
  admitExploratoryReplayExecutionV2,
  EXPLORATORY_REPLAY_EXECUTE_OPERATION,
} from "./exploratory-replay-operation.ts";
import { parseExploratoryReplayOwnerV2 } from "./exploratory-replay-readback-client.ts";
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
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
type Environment = Record<string, string | undefined>;
type Json = Record<string, unknown>;

export type ExploratoryReplayOperationResponseV2 = {
  status: number;
  envelope: {
    schema_version: 1;
    operation: typeof EXPLORATORY_REPLAY_EXECUTE_OPERATION;
    channel: "DASHBOARD_DISPOSABLE_EXECUTION";
    availability: "available" | "unavailable";
    unavailable_reason: string | null;
    request_identity: string | null;
    meaning_digest: string | null;
    operational_run: ReturnType<typeof operationalRunAvailableV1>
      | ReturnType<typeof operationalRunUnavailableV1>;
  };
};

export type ExploratoryReplayQueueStoreV2 = Pick<PostgresRunStoreV1,
  "assertEffectDispatchSchema" | "readExploratoryReplayRecovery" | "beginExploratoryReplay">;

export type ExploratoryReplayClaimStoreV2 = Pick<PostgresRunStoreV1,
  "readExploratoryReplayRecovery" | "recordExploratoryReplaySubmissionStarted"
  | "completeExploratoryReplay">;

type ReplaySelectorV2 = {
  request_identity: string;
  meaning_digest: string;
  canonical_request_digest: string;
};

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u001f") === [...expected].sort().join("\u001f");
}

function unavailable(
  reason: string,
  status: number,
  run: OperationRunV1 | null = null,
  requestIdentity: string | null = null,
  meaningDigest: string | null = null,
): ExploratoryReplayOperationResponseV2 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
      channel: "DASHBOARD_DISPOSABLE_EXECUTION",
      availability: "unavailable",
      unavailable_reason: reason,
      request_identity: requestIdentity,
      meaning_digest: meaningDigest,
      operational_run: operationalRunUnavailableV1(
        run ? "RUN_RECOVERY_REQUIRED" : "RUN_NOT_STARTED",
        run,
      ),
    },
  };
}

function ownerConfiguration(
  environment: Environment,
  ownerUrl: string,
): { ownerUrl: string; token: string } | null {
  const token = environment.RD_OWNER_API_TOKEN;
  if (environment.DASHBOARD_DEPLOYMENT_CLASS !== "DISPOSABLE_LOCAL"
    || environment.DASHBOARD_DISPOSABLE_EXPLORATORY_REPLAY_EXECUTION !== "ENABLED"
    || !token) return null;
  return { ownerUrl, token };
}

function parseOwnerJson(text: string): unknown {
  return parseLosslessJson(text, undefined, {
    parseNumber: (value) => isSafeNumber(value, { approx: false })
      ? Number(value)
      : new LosslessNumber(value),
    onDuplicateKey: ({ key }) => {
      throw new SyntaxError(`Duplicate Owner response key: ${key}`);
    },
  });
}

async function ownerPost({
  ownerUrl,
  token,
  path,
  body,
  fetcher,
}: {
  ownerUrl: string;
  token: string;
  path: string;
  body: string;
  fetcher: typeof fetch;
}): Promise<{ status: number; value: unknown } | null> {
  try {
    const response = await fetcher(`${ownerUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-trade-effect-dispatcher": "TRADE_DASHBOARD",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!text || new TextEncoder().encode(text).byteLength > MAX_OWNER_RESPONSE_BYTES) return null;
    return { status: response.status, value: parseOwnerJson(text) };
  } catch {
    return null;
  }
}

function identifiedSelector(
  value: unknown,
  request: ExploratoryReplayRunRequestV2["request"],
): ReplaySelectorV2 | null {
  if (!record(value) || !exactKeys(value, [
    "request_identity", "meaning_digest", "canonical_request_bytes",
  ]) || value.request_identity !== request.request_identity
    || typeof value.meaning_digest !== "string" || !DIGEST.test(value.meaning_digest)
    || !Array.isArray(value.canonical_request_bytes) || value.canonical_request_bytes.length === 0
    || value.canonical_request_bytes.length > MAX_OWNER_RESPONSE_BYTES
    || !value.canonical_request_bytes.every(
      (entry) => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 255,
    )) return null;
  const bytes = value.canonical_request_bytes as number[];
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    const decoded = parseOwnerJson(text);
    const canonical = normalizeExploratoryReplayOwnerRequestV2(decoded);
    if (!canonical || JSON.stringify(canonical) !== JSON.stringify(request)
      || text !== exploratoryReplayOwnerRequestBodyV2(request)) return null;
  } catch {
    return null;
  }
  return {
    request_identity: request.request_identity,
    meaning_digest: value.meaning_digest,
    canonical_request_digest: canonicalReplayRequestDigestV2(bytes),
  };
}

export async function identifyExploratoryReplayRequestV2({
  request,
  ownerUrl,
  token,
  fetcher = fetch,
}: {
  request: ExploratoryReplayRunRequestV2["request"];
  ownerUrl: string;
  token: string;
  fetcher?: typeof fetch;
}): Promise<ReplaySelectorV2 | null> {
  const result = await ownerPost({
    ownerUrl,
    token,
    path: "/v2/exploratory-replay-requests/identify",
    body: exploratoryReplayOwnerRequestBodyV2(request),
    fetcher,
  });
  return result?.status === 200 ? identifiedSelector(result.value, request) : null;
}

function unavailableOwnerRead(value: unknown, requestIdentity: string): boolean {
  return record(value) && exactKeys(value, ["projection", "readback"])
    && value.readback === null && record(value.projection)
    && exactKeys(value.projection, [
      "schema_version", "request_identity", "availability", "next_legal_action",
    ]) && value.projection.schema_version === 1
    && value.projection.request_identity === requestIdentity
    && value.projection.availability === "UNAVAILABLE"
    && value.projection.next_legal_action === "RESOLVE_OWNER_CUSTODY";
}

async function resolveOwner({
  request,
  selector,
  ownerUrl,
  token,
  fetcher,
}: {
  request: ExploratoryReplayRunRequestV2["request"];
  selector: ReplaySelectorV2;
  ownerUrl: string;
  token: string;
  fetcher: typeof fetch;
}) {
  const result = await ownerPost({
    ownerUrl,
    token,
    path: `/v2/exploratory-replay-requests/${encodeURIComponent(selector.request_identity)}/resolve`,
    body: JSON.stringify({ meaning_digest: selector.meaning_digest }),
    fetcher,
  });
  if (!result || result.status !== 200) return { state: "unknown" as const };
  const available = parseExploratoryReplayOwnerV2(
    result.value,
    selector.request_identity,
    selector.meaning_digest,
  );
  if (available?.availability === "AVAILABLE" && available.readback) {
    const normalized = normalizeExploratoryReplayOwnerRequestV2(
      (result.value as { readback?: { request?: unknown } }).readback?.request,
    );
    return normalized && JSON.stringify(normalized) === JSON.stringify(request)
      ? { state: "available" as const }
      : { state: "unknown" as const };
  }
  return unavailableOwnerRead(result.value, selector.request_identity)
    ? { state: "absent" as const }
    : { state: "unknown" as const };
}

export async function enqueueExploratoryReplayOperationV2({
  request,
  actionContext,
  environment = process.env,
  fetcher = fetch,
  routingResolver,
  nowEpochMs = Date.now(),
  store = configuredRunStoreV1(),
}: {
  request: ExploratoryReplayRunRequestV2;
  actionContext: ControlPlaneAdmissionContextV1;
  environment?: Environment;
  fetcher?: typeof fetch;
  routingResolver?: () => Promise<ProductEdgeRoutingObservationV1>;
  nowEpochMs?: number;
  store?: ExploratoryReplayQueueStoreV2 | null;
}): Promise<ExploratoryReplayOperationResponseV2> {
  const canonical = canonicalExploratoryReplayRunRequestV2(request);
  if (!canonical) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  if (!validControlPlaneAdmissionContextV1(actionContext)
    || actionContext.requestedAction !== "RUN") {
    return unavailable("EXECUTION_AUTHORIZATION_UNAVAILABLE", 503);
  }
  const target = configuredEffectDispatchTargetV1(EXPLORATORY_REPLAY_EXECUTE_OPERATION, environment);
  const owner = target && ownerConfiguration(environment, target.owner_url);
  if (!target || !owner) return unavailable("EXECUTION_CONFIGURATION_UNAVAILABLE", 503);
  if (!store) return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503);
  const admission = await admitExploratoryReplayExecutionV2({
    environment,
    nowEpochMs,
    ...(routingResolver ? { routingResolver: () => routingResolver() } : {}),
  });
  if (admission.availability !== "available") {
    return unavailable(
      admission.unavailable_reason === "DASHBOARD_ROUTING_UNAVAILABLE"
        ? "EXECUTION_ROUTING_UNAVAILABLE" : "EXECUTION_COMPATIBILITY_UNAVAILABLE",
      503,
      null,
      canonical.request.request_identity,
    );
  }
  const selector = await identifyExploratoryReplayRequestV2({
    request: canonical.request,
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    fetcher,
  });
  if (!selector) {
    return unavailable(
      "EXECUTION_PREFLIGHT_UNAVAILABLE",
      409,
      null,
      canonical.request.request_identity,
    );
  }
  const dispatchRequest: ExploratoryReplayDispatchRequestV2 = { ...canonical, selector };
  const requestDigest = effectDispatchRequestDigestV1(
    EXPLORATORY_REPLAY_EXECUTE_OPERATION,
    dispatchRequest,
  );
  if (!requestDigest) return unavailable("EXECUTION_REQUEST_INVALID", 400);
  const recoveryIdentity = {
    request_identity: selector.request_identity,
    meaning_digest: selector.meaning_digest,
  };
  try {
    await store.assertEffectDispatchSchema();
    const prior = await store.readExploratoryReplayRecovery(recoveryIdentity);
    if (prior) {
      if (prior.request_digest !== requestDigest) {
        return unavailable("EXECUTION_REQUEST_CONFLICT", 409, prior.run,
          selector.request_identity, selector.meaning_digest);
      }
      if (["queued", "running"].includes(prior.run.state)) {
        return {
          status: 202,
          envelope: {
            schema_version: 1,
            operation: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
            channel: "DASHBOARD_DISPOSABLE_EXECUTION",
            availability: "available",
            unavailable_reason: null,
            request_identity: selector.request_identity,
            meaning_digest: selector.meaning_digest,
            operational_run: operationalRunAvailableV1(prior.run),
          },
        };
      }
      return unavailable("EXECUTION_PRIOR_RUN_TERMINAL", 409, prior.run,
        selector.request_identity, selector.meaning_digest);
    }
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503, null,
      selector.request_identity, selector.meaning_digest);
  }
  try {
    const started = await store.beginExploratoryReplay({
      recoveryIdentity,
      admission,
      actionContext,
      dispatchRequest,
      dispatchTarget: target,
    });
    return {
      status: 202,
      envelope: {
        schema_version: 1,
        operation: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
        channel: "DASHBOARD_DISPOSABLE_EXECUTION",
        availability: "available",
        unavailable_reason: null,
        request_identity: selector.request_identity,
        meaning_digest: selector.meaning_digest,
        operational_run: operationalRunAvailableV1(started.run),
      },
    };
  } catch {
    return unavailable("EXECUTION_RUN_STORE_UNAVAILABLE", 503, null,
      selector.request_identity, selector.meaning_digest);
  }
}

export async function executeClaimedExploratoryReplayOperationV2({
  claim,
  environment = process.env,
  fetcher = fetch,
  store,
}: {
  claim: EffectDispatchClaimV1;
  environment?: Environment;
  fetcher?: typeof fetch;
  store: ExploratoryReplayClaimStoreV2;
}): Promise<"terminal" | "retry"> {
  if (claim.operation_id !== EXPLORATORY_REPLAY_EXECUTE_OPERATION) return "retry";
  const request = canonicalExploratoryReplayDispatchRequestV2(claim.request);
  if (!request
    || effectDispatchRequestDigestV1(claim.operation_id, request) !== claim.request_digest
    || effectDispatchTargetDigestV1(claim.operation_id, claim.frozen_target)
      !== claim.frozen_target_digest
    || claim.frozen_context !== null || claim.frozen_context_digest !== null) return "retry";
  const configuredTarget = configuredEffectDispatchTargetV1(claim.operation_id, environment);
  if (!configuredTarget
    || effectDispatchTargetDigestV1(claim.operation_id, configuredTarget)
      !== claim.frozen_target_digest) return "retry";
  const owner = ownerConfiguration(environment, configuredTarget.owner_url);
  if (!owner) return "retry";
  const recovery = await store.readExploratoryReplayRecovery({
    request_identity: request.selector.request_identity,
    meaning_digest: request.selector.meaning_digest,
  });
  if (!recovery || recovery.run.run_identity !== claim.run_identity
    || recovery.request_digest !== claim.request_digest) return "retry";
  const identified = await identifyExploratoryReplayRequestV2({
    request: request.request,
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    fetcher,
  });
  if (!identified || JSON.stringify(identified) !== JSON.stringify(request.selector)) return "retry";
  let resolved = await resolveOwner({
    request: request.request,
    selector: request.selector,
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    fetcher,
  });
  if (resolved.state === "available") {
    await store.completeExploratoryReplay({
      runIdentity: claim.run_identity,
      expectedTransitionVersion: claim.transition_version,
    });
    return "terminal";
  }
  if (resolved.state !== "absent") return "retry";
  if (recovery.submission_started || claim.claim_attempt > 1) return "retry";
  const phased = await store.recordExploratoryReplaySubmissionStarted({
    runIdentity: claim.run_identity,
    expectedTransitionVersion: claim.transition_version,
  });
  await ownerPost({
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    path: "/v2/exploratory-replay-requests",
    body: exploratoryReplayOwnerProposalBodyV2(request),
    fetcher,
  });
  resolved = await resolveOwner({
    request: request.request,
    selector: request.selector,
    ownerUrl: owner.ownerUrl,
    token: owner.token,
    fetcher,
  });
  if (resolved.state !== "available") return "retry";
  await store.completeExploratoryReplay({
    runIdentity: claim.run_identity,
    expectedTransitionVersion: phased.transition_version,
  });
  return "terminal";
}
