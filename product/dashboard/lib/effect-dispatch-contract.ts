import { createHash } from "node:crypto";

import {
  validSourceResearchOperationRequestV1,
  type SourceResearchOperationRequestV1,
} from "./source-research-input-contract.ts";
import {
  canonicalExploratoryReplayDispatchRequestV2,
  type ExploratoryReplayDispatchRequestV2,
} from "./exploratory-replay-action-contract.ts";
import {
  canonicalDevelopComposerDispatchRequestV2,
  type DevelopComposerDispatchRequestV2,
} from "./develop-composer-action-contract.ts";
import { DEVELOP_COMPOSER_EXECUTE_OPERATION } from "./develop-composer-operation.ts";
import { EXPLORATORY_REPLAY_EXECUTE_OPERATION } from "./exploratory-replay-operation.ts";
import { SOURCE_RESEARCH_EXECUTE_OPERATION } from "./source-research-run-contract.ts";
import { canonicalSourceResearchRunRequestV1 } from "./source-research-run-input-custody.ts";
import { disposableOwnerUrlV1 } from "./disposable-owner-target.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,96}$/;
const WORKER_IDENTITY = /^dashboard-effect-worker-v1-[0-9a-f]{64}$/;

export const effectDispatchOperationIdsV1 = [
  DEVELOP_COMPOSER_EXECUTE_OPERATION,
  EXPLORATORY_REPLAY_EXECUTE_OPERATION,
  SOURCE_RESEARCH_EXECUTE_OPERATION,
] as const;

export type EffectDispatchOperationIdV1 = typeof effectDispatchOperationIdsV1[number];
export type EffectDispatchRequestV1 =
  | DevelopComposerDispatchRequestV2
  | ExploratoryReplayDispatchRequestV2
  | SourceResearchOperationRequestV1;

export type EffectDispatchTargetV1 = {
  schema_version: 1;
  operation_id: EffectDispatchOperationIdV1;
  owner_url: string;
};

export type EffectDispatchTargetDigestsV1 = Record<EffectDispatchOperationIdV1, string>;

export type EffectDispatchClaimV1 = {
  schema_version: 1;
  run_identity: string;
  operation_id: EffectDispatchOperationIdV1;
  request: EffectDispatchRequestV1;
  request_digest: string;
  frozen_target: EffectDispatchTargetV1;
  frozen_target_digest: string;
  principal_ref: string;
  authorization_digest: string;
  admission_receipt_identity: string;
  claim_token: string;
  claim_attempt: number;
  transition_version: number;
  lease_expires_at: string;
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function canonicalEffectDispatchTargetV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): EffectDispatchTargetV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  const ownerUrl = disposableOwnerUrlV1(
    typeof target.owner_url === "string" ? target.owner_url : undefined,
  );
  if (!ownerUrl || ownerUrl !== target.owner_url || target.schema_version !== 1
    || target.operation_id !== operationId) return null;
  return exactKeys(target, ["schema_version", "operation_id", "owner_url"])
    ? { schema_version: 1, operation_id: operationId, owner_url: ownerUrl }
    : null;
}

export function configuredEffectDispatchTargetV1(
  operationId: EffectDispatchOperationIdV1,
  environment: Record<string, string | undefined>,
): EffectDispatchTargetV1 | null {
  const ownerUrl = disposableOwnerUrlV1(environment.RD_OWNER_API_URL);
  if (!ownerUrl) return null;
  return canonicalEffectDispatchTargetV1(operationId, {
    schema_version: 1,
    operation_id: operationId,
    owner_url: ownerUrl,
  });
}

export function effectDispatchTargetDigestV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): string | null {
  const target = canonicalEffectDispatchTargetV1(operationId, value);
  return target
    ? `sha256:${createHash("sha256").update(JSON.stringify(target)).digest("hex")}`
    : null;
}

export function canonicalEffectDispatchTargetDigestsV1(
  value: unknown,
): EffectDispatchTargetDigestsV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const digests = value as Record<string, unknown>;
  if (!exactKeys(digests, effectDispatchOperationIdsV1)
    || effectDispatchOperationIdsV1.some((operationId) => !DIGEST.test(
      typeof digests[operationId] === "string" ? digests[operationId] : "",
    ))) return null;
  return Object.fromEntries(effectDispatchOperationIdsV1.map((operationId) => [
    operationId,
    digests[operationId] as string,
  ])) as EffectDispatchTargetDigestsV1;
}

export function configuredEffectDispatchTargetDigestsV1(
  environment: Record<string, string | undefined>,
): EffectDispatchTargetDigestsV1 | null {
  const entries = effectDispatchOperationIdsV1.map((operationId) => {
    const target = configuredEffectDispatchTargetV1(operationId, environment);
    return target ? [operationId, effectDispatchTargetDigestV1(operationId, target)] : null;
  });
  if (entries.some((entry) => entry === null || entry[1] === null)) return null;
  return canonicalEffectDispatchTargetDigestsV1(Object.fromEntries(
    entries as [EffectDispatchOperationIdV1, string][],
  ));
}

export function validEffectDispatchRequestV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): value is EffectDispatchRequestV1 {
  try {
    if (operationId === EXPLORATORY_REPLAY_EXECUTE_OPERATION) {
      return canonicalExploratoryReplayDispatchRequestV2(value) !== null;
    }
    if (operationId === DEVELOP_COMPOSER_EXECUTE_OPERATION) {
      return canonicalDevelopComposerDispatchRequestV2(value) !== null;
    }
    return validSourceResearchOperationRequestV1(value as SourceResearchOperationRequestV1)
      && (value as SourceResearchOperationRequestV1).action === "RUN";
  } catch {
    return false;
  }
}

export function canonicalEffectDispatchRequestV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): EffectDispatchRequestV1 | null {
  if (!validEffectDispatchRequestV1(operationId, value)) return null;
  if (operationId === EXPLORATORY_REPLAY_EXECUTE_OPERATION) {
    return canonicalExploratoryReplayDispatchRequestV2(value);
  }
  if (operationId === DEVELOP_COMPOSER_EXECUTE_OPERATION) {
    return canonicalDevelopComposerDispatchRequestV2(value);
  }
  const request = value as Extract<SourceResearchOperationRequestV1, { action: "RUN" }>;
  return canonicalSourceResearchRunRequestV1(request);
}

export function effectDispatchRequestDigestV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): string | null {
  const request = canonicalEffectDispatchRequestV1(operationId, value);
  if (!request) return null;
  return `sha256:${createHash("sha256").update(JSON.stringify({
    schema_version: 1,
    operation_id: operationId,
    request,
  })).digest("hex")}`;
}

export function boundEffectWorkerIdentityV1({
  configuredIdentity,
  operationIds,
  workerCapability,
  workerArtifactDigest,
}: {
  configuredIdentity: string;
  operationIds: readonly EffectDispatchOperationIdV1[];
  workerCapability: string;
  workerArtifactDigest: string;
}): string | null {
  if (!PRINCIPAL.test(configuredIdentity)
    || Buffer.byteLength(workerCapability, "utf8") < 32
    || Buffer.byteLength(workerCapability, "utf8") > 4_096
    || !DIGEST.test(workerArtifactDigest)
    || operationIds.length !== effectDispatchOperationIdsV1.length
    || new Set(operationIds).size !== operationIds.length
    || effectDispatchOperationIdsV1.some((operationId) => !operationIds.includes(operationId))) {
    return null;
  }
  const digest = createHash("sha256").update(JSON.stringify({
    schema_version: 1,
    configured_identity: configuredIdentity,
    operation_ids: [...operationIds].sort(),
    worker_artifact_digest: workerArtifactDigest,
    worker_capability_digest: `sha256:${createHash("sha256")
      .update(workerCapability).digest("hex")}`,
  })).digest("hex");
  const identity = `dashboard-effect-worker-v1-${digest}`;
  return WORKER_IDENTITY.test(identity) ? identity : null;
}
