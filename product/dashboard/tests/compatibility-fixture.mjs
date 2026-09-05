import { createHash } from "node:crypto";

import { registryEntryDigestV1 } from "../lib/compatibility-envelope.ts";
import {
  operationManifestV1,
  operationRegistryV1,
} from "../lib/operation-registry.ts";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function compatibleEnvironmentV1({
  operationIds = operationRegistryV1.map(({ operation_id }) => operation_id),
  extraManifests = [],
  nowEpochMs = 1_788_067_200_000,
} = {}) {
  const dashboardDigest = digest("dashboard-artifact-v1");
  const workerDigest = digest("dashboard-shadow-worker-v1");
  const ownerDigest = digest("rd-owner-api-v1");
  const manifests = [
    ...operationIds.map((operationId) => operationManifestV1(operationId)),
    ...extraManifests,
  ];
  const envelopes = manifests.map((manifest) => {
    return {
      schema_version: 1,
      operation_id: manifest.operation_id,
      registry_entry_digest: registryEntryDigestV1(manifest),
      owner_operation: manifest.owner_operation,
      owner_schema: manifest.owner_schema,
      effect_set: [...manifest.effect_set],
      channels: [...manifest.channels],
      dependency_operation_ids: [...manifest.dependency_operation_ids],
      dashboard_artifact_digest: dashboardDigest,
      worker_artifact_digest: workerDigest,
      owner_api_artifact_digest: ownerDigest,
      owner_probe_receipt_digest: digest("owner-probe-receipt-v1"),
      observed_at_epoch_ms: nowEpochMs - 1_000,
      valid_through_epoch_ms: nowEpochMs + 600_000,
    };
  }).sort((left, right) => Buffer.compare(
    Buffer.from(left.operation_id),
    Buffer.from(right.operation_id),
  ));
  const canonical = JSON.stringify(envelopes);
  return {
    nowEpochMs,
    envelopes,
    environment: {
      DASHBOARD_COMPATIBILITY_ENVELOPES_JSON: canonical,
      DASHBOARD_COMPATIBILITY_ENVELOPES_DIGEST: digest(canonical),
      DASHBOARD_ARTIFACT_DIGEST: dashboardDigest,
      DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST: workerDigest,
      RD_OWNER_API_ARTIFACT_DIGEST: ownerDigest,
      DASHBOARD_SHADOW_WORKER_ID: "dashboard-shadow-worker-1",
      DASHBOARD_SHADOW_WORKER_TOKEN: "worker-capability-token-that-is-at-least-thirty-two-bytes",
      DASHBOARD_OPERATOR_API_TOKEN: "operator-capability-token-that-is-at-least-thirty-two-bytes",
      RD_OWNER_API_URL: "http://rd-owner.test:8080",
      RD_OWNER_API_TOKEN: "owner-token",
    },
  };
}
