import { createHash } from "node:crypto";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OPERATION_ID = /^[a-z][a-z0-9_.-]{0,127}$/;
const MAX_OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type CompatibilityBoundOperationV1 = {
  schema_version: 1;
  operation_id: string;
  owner_operation: string;
  owner_schema: string;
  capability: string;
  effect_set: readonly string[];
  dependency_operation_ids: readonly string[];
  channels: readonly string[];
};

export type OperationDeploymentStateV1 = {
  deployment_state: "available";
  compatibility_envelope_digest: string;
  compatibility_observed_at_epoch_ms: number;
  compatibility_valid_through_epoch_ms: number;
  deployment_unavailable_reason: null;
} | {
  deployment_state: "unavailable";
  compatibility_envelope_digest: null;
  compatibility_observed_at_epoch_ms: null;
  compatibility_valid_through_epoch_ms: null;
  deployment_unavailable_reason:
    | "COMPATIBILITY_ENVELOPE_UNAVAILABLE"
    | "COMPATIBILITY_ENVELOPE_INVALID"
    | "COMPATIBILITY_ENVELOPE_EXPIRED"
    | "COMPONENT_DIGEST_MISMATCH";
};

type CompatibilityEnvelopeV1 = {
  schema_version: 1;
  operation_id: string;
  registry_entry_digest: string;
  owner_operation: string;
  owner_schema: string;
  effect_set: string[];
  channels: string[];
  dependency_operation_ids: string[];
  dashboard_artifact_digest: string;
  worker_artifact_digest: string;
  owner_api_artifact_digest: string;
  owner_probe_receipt_digest: string;
  observed_at_epoch_ms: number;
  valid_through_epoch_ms: number;
};

type DeploymentEnvironment = Record<string, string | undefined>;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function canonicalEnvelope(value: unknown): CompatibilityEnvelopeV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, [
    "schema_version", "operation_id", "registry_entry_digest", "owner_operation", "owner_schema",
    "effect_set", "channels", "dependency_operation_ids", "dashboard_artifact_digest", "worker_artifact_digest",
    "owner_api_artifact_digest", "owner_probe_receipt_digest", "observed_at_epoch_ms", "valid_through_epoch_ms",
  ]) || envelope.schema_version !== 1 || typeof envelope.operation_id !== "string"
    || !OPERATION_ID.test(envelope.operation_id) || typeof envelope.owner_operation !== "string"
    || typeof envelope.owner_schema !== "string" || !Array.isArray(envelope.effect_set)
    || !envelope.effect_set.every((item) => typeof item === "string")
    || !Array.isArray(envelope.channels) || !envelope.channels.every((item) => typeof item === "string")
    || !Array.isArray(envelope.dependency_operation_ids)
    || !envelope.dependency_operation_ids.every(
      (item) => typeof item === "string" && OPERATION_ID.test(item),
    )
    || new Set(envelope.dependency_operation_ids).size !== envelope.dependency_operation_ids.length
    || ![envelope.registry_entry_digest, envelope.dashboard_artifact_digest,
      envelope.worker_artifact_digest, envelope.owner_api_artifact_digest,
      envelope.owner_probe_receipt_digest].every(
      (item) => typeof item === "string" && DIGEST.test(item),
    ) || !Number.isSafeInteger(envelope.observed_at_epoch_ms)
    || !Number.isSafeInteger(envelope.valid_through_epoch_ms)) return null;
  return {
    schema_version: 1,
    operation_id: envelope.operation_id,
    registry_entry_digest: envelope.registry_entry_digest as string,
    owner_operation: envelope.owner_operation,
    owner_schema: envelope.owner_schema,
    effect_set: [...envelope.effect_set] as string[],
    channels: [...envelope.channels] as string[],
    dependency_operation_ids: [...envelope.dependency_operation_ids] as string[],
    dashboard_artifact_digest: envelope.dashboard_artifact_digest as string,
    worker_artifact_digest: envelope.worker_artifact_digest as string,
    owner_api_artifact_digest: envelope.owner_api_artifact_digest as string,
    owner_probe_receipt_digest: envelope.owner_probe_receipt_digest as string,
    observed_at_epoch_ms: envelope.observed_at_epoch_ms as number,
    valid_through_epoch_ms: envelope.valid_through_epoch_ms as number,
  };
}

function canonicalSet(envelopes: CompatibilityEnvelopeV1[]): string {
  return JSON.stringify([...envelopes].sort((left, right) => (
    Buffer.compare(Buffer.from(left.operation_id), Buffer.from(right.operation_id))
  )));
}

function unavailable(
  reason: Exclude<OperationDeploymentStateV1["deployment_unavailable_reason"], null>,
): OperationDeploymentStateV1 {
  return {
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: reason,
  };
}

export function registryEntryDigestV1(operation: CompatibilityBoundOperationV1): string {
  return sha256(JSON.stringify(operation));
}

export function operationDeploymentStateV1(
  operation: CompatibilityBoundOperationV1,
  environment: DeploymentEnvironment = process.env,
  nowEpochMs = Date.now(),
): OperationDeploymentStateV1 {
  const raw = environment.DASHBOARD_COMPATIBILITY_ENVELOPES_JSON;
  const declaredSetDigest = environment.DASHBOARD_COMPATIBILITY_ENVELOPES_DIGEST;
  if (!raw && !declaredSetDigest) return unavailable("COMPATIBILITY_ENVELOPE_UNAVAILABLE");
  if (!raw || !declaredSetDigest || !DIGEST.test(declaredSetDigest)) {
    return unavailable("COMPATIBILITY_ENVELOPE_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unavailable("COMPATIBILITY_ENVELOPE_INVALID");
  }
  if (!Array.isArray(parsed)) return unavailable("COMPATIBILITY_ENVELOPE_INVALID");
  const envelopes = parsed.map(canonicalEnvelope);
  if (envelopes.some((entry) => entry === null)) return unavailable("COMPATIBILITY_ENVELOPE_INVALID");
  const canonical = envelopes as CompatibilityEnvelopeV1[];
  if (new Set(canonical.map((entry) => entry.operation_id)).size !== canonical.length
    || sha256(canonicalSet(canonical)) !== declaredSetDigest) {
    return unavailable("COMPATIBILITY_ENVELOPE_INVALID");
  }
  const envelope = canonical.find((entry) => entry.operation_id === operation.operation_id);
  if (!envelope) return unavailable("COMPATIBILITY_ENVELOPE_UNAVAILABLE");
  if (envelope.observed_at_epoch_ms > nowEpochMs
    || envelope.valid_through_epoch_ms <= nowEpochMs
    || envelope.valid_through_epoch_ms <= envelope.observed_at_epoch_ms
    || envelope.valid_through_epoch_ms - envelope.observed_at_epoch_ms > MAX_OBSERVATION_WINDOW_MS) {
    return unavailable("COMPATIBILITY_ENVELOPE_EXPIRED");
  }
  if (envelope.registry_entry_digest !== registryEntryDigestV1(operation)
    || envelope.owner_operation !== operation.owner_operation
    || envelope.owner_schema !== operation.owner_schema
    || JSON.stringify(envelope.effect_set) !== JSON.stringify(operation.effect_set)
    || JSON.stringify(envelope.channels) !== JSON.stringify(operation.channels)
    || JSON.stringify(envelope.dependency_operation_ids)
      !== JSON.stringify(operation.dependency_operation_ids)) {
    return unavailable("COMPATIBILITY_ENVELOPE_INVALID");
  }
  if (envelope.dashboard_artifact_digest !== environment.DASHBOARD_ARTIFACT_DIGEST
    || envelope.worker_artifact_digest !== environment.DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST
    || envelope.owner_api_artifact_digest !== environment.RD_OWNER_API_ARTIFACT_DIGEST) {
    return unavailable("COMPONENT_DIGEST_MISMATCH");
  }
  return {
    deployment_state: "available",
    compatibility_envelope_digest: sha256(JSON.stringify(envelope)),
    compatibility_observed_at_epoch_ms: envelope.observed_at_epoch_ms,
    compatibility_valid_through_epoch_ms: envelope.valid_through_epoch_ms,
    deployment_unavailable_reason: null,
  };
}
