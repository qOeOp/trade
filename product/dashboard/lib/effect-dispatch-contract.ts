import { createHash } from "node:crypto";

import type { ArtifactBuildExecutionRequestV1 } from "../../rd-owner-client/artifact_build_v1.ts";
import {
  validVerifiedS1ConsumerContextV1,
  type VerifiedS1ConsumerContextV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
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
import {
  ARTIFACT_FORMATION_EXECUTE_OPERATION,
  canonicalArtifactFormationRecoveryIdentityV1,
} from "./artifact-formation-operation.ts";
import { SOURCE_RESEARCH_EXECUTE_OPERATION } from "./source-research-run-contract.ts";
import { canonicalSourceResearchRunRequestV1 } from "./source-research-run-input-custody.ts";
import { disposableOwnerUrlV1 } from "./disposable-owner-target.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,96}$/;
const WORKER_IDENTITY = /^dashboard-effect-worker-v1-[0-9a-f]{64}$/;

export const effectDispatchOperationIdsV1 = [
  ARTIFACT_FORMATION_EXECUTE_OPERATION,
  DEVELOP_COMPOSER_EXECUTE_OPERATION,
  EXPLORATORY_REPLAY_EXECUTE_OPERATION,
  SOURCE_RESEARCH_EXECUTE_OPERATION,
] as const;

export type EffectDispatchOperationIdV1 = typeof effectDispatchOperationIdsV1[number];
export type EffectDispatchRequestV1 =
  | ArtifactBuildExecutionRequestV1
  | DevelopComposerDispatchRequestV2
  | ExploratoryReplayDispatchRequestV2
  | SourceResearchOperationRequestV1;

export type EffectDispatchTargetV1 =
  | {
    schema_version: 1;
    operation_id: typeof SOURCE_RESEARCH_EXECUTE_OPERATION
      | typeof DEVELOP_COMPOSER_EXECUTE_OPERATION
      | typeof EXPLORATORY_REPLAY_EXECUTE_OPERATION;
    owner_url: string;
  }
  | {
    schema_version: 1;
    operation_id: typeof ARTIFACT_FORMATION_EXECUTE_OPERATION;
    owner_url: string;
    provider_url: string;
    provider_model: string;
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
  frozen_context: VerifiedS1ConsumerContextV1 | null;
  frozen_context_digest: string | null;
  principal_ref: string;
  authorization_digest: string;
  admission_receipt_identity: string;
  claim_token: string;
  claim_attempt: number;
  transition_version: number;
  lease_expires_at: string;
};

export function canonicalEffectDispatchContextV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): VerifiedS1ConsumerContextV1 | null {
  if (operationId !== ARTIFACT_FORMATION_EXECUTE_OPERATION) return null;
  try {
    if (!validVerifiedS1ConsumerContextV1(value)) return null;
  } catch {
    return null;
  }
  return {
    schema_version: 1,
    request_identity: value.request_identity,
    intent_identity: value.intent_identity,
    intent_semantic_digest: value.intent_semantic_digest,
    trial_family_identity: value.trial_family_identity,
    trial_family_root_digest: value.trial_family_root_digest,
    census_frontier_identity: value.census_frontier_identity,
    census_frontier_digest: value.census_frontier_digest,
    valid_through_epoch_ms: value.valid_through_epoch_ms,
  };
}

export function effectDispatchContextDigestV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): string | null {
  const context = canonicalEffectDispatchContextV1(operationId, value);
  return context
    ? `sha256:${createHash("sha256").update(JSON.stringify(context)).digest("hex")}`
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function canonicalProviderUrlV1(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const value = new URL(raw);
    if (value.protocol !== "https:" || value.username || value.password
      || value.search || value.hash) return null;
    return value.toString();
  } catch {
    return null;
  }
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
  if (operationId === SOURCE_RESEARCH_EXECUTE_OPERATION
    || operationId === DEVELOP_COMPOSER_EXECUTE_OPERATION
    || operationId === EXPLORATORY_REPLAY_EXECUTE_OPERATION) {
    return exactKeys(target, ["schema_version", "operation_id", "owner_url"])
      ? { schema_version: 1, operation_id: operationId, owner_url: ownerUrl }
      : null;
  }
  const providerUrl = canonicalProviderUrlV1(target.provider_url);
  const providerModel = target.provider_model;
  if (!exactKeys(target, [
    "schema_version", "operation_id", "owner_url", "provider_url", "provider_model",
  ]) || !providerUrl || providerUrl !== target.provider_url
    || typeof providerModel !== "string" || !PRINCIPAL.test(providerModel)) return null;
  return {
    schema_version: 1,
    operation_id: operationId,
    owner_url: ownerUrl,
    provider_url: providerUrl,
    provider_model: providerModel,
  };
}

export function configuredEffectDispatchTargetV1(
  operationId: EffectDispatchOperationIdV1,
  environment: Record<string, string | undefined>,
): EffectDispatchTargetV1 | null {
  const ownerUrl = disposableOwnerUrlV1(environment.RD_OWNER_API_URL);
  if (!ownerUrl) return null;
  if (operationId === SOURCE_RESEARCH_EXECUTE_OPERATION
    || operationId === DEVELOP_COMPOSER_EXECUTE_OPERATION
    || operationId === EXPLORATORY_REPLAY_EXECUTE_OPERATION) {
    return canonicalEffectDispatchTargetV1(operationId, {
      schema_version: 1,
      operation_id: operationId,
      owner_url: ownerUrl,
    });
  }
  return canonicalEffectDispatchTargetV1(operationId, {
    schema_version: 1,
    operation_id: operationId,
    owner_url: ownerUrl,
    provider_url: environment.RD_EXECUTION_AGENT_PROVIDER_URL
      ?? "https://api.deepseek.com/chat/completions",
    provider_model: environment.RD_EXECUTION_AGENT_MODEL ?? "deepseek-chat",
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

export function validArtifactFormationDispatchRequestV1(
  value: unknown,
): value is ArtifactBuildExecutionRequestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return exactKeys(request, [
    "action", "attempt_identity", "build_request_identity",
    "identity_mode", "research_request_identity",
  ])
    && request.action === "RUN" && request.identity_mode === "GENERATE"
    && typeof request.research_request_identity === "string"
    && typeof request.build_request_identity === "string"
    && typeof request.attempt_identity === "string"
    && canonicalArtifactFormationRecoveryIdentityV1({
      research_request_identity: request.research_request_identity,
      build_request_identity: request.build_request_identity,
      attempt_identity: request.attempt_identity,
    }) !== null;
}

export function validEffectDispatchRequestV1(
  operationId: EffectDispatchOperationIdV1,
  value: unknown,
): value is EffectDispatchRequestV1 {
  try {
    if (operationId === ARTIFACT_FORMATION_EXECUTE_OPERATION) {
      return validArtifactFormationDispatchRequestV1(value);
    }
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
  if (operationId === ARTIFACT_FORMATION_EXECUTE_OPERATION) {
    const request = value as ArtifactBuildExecutionRequestV1;
    return {
      action: "RUN",
      build_request_identity: request.build_request_identity,
      attempt_identity: request.attempt_identity,
      research_request_identity: request.research_request_identity,
      identity_mode: "GENERATE",
    };
  }
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
