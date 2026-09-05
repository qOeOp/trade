import { isRunIdentityV1 } from "./run-contract.ts";

export const runAuxiliaryEvidenceKindsV1 = ["metrics", "traces", "assets"] as const;

export type RunAuxiliaryEvidenceKindV1 = typeof runAuxiliaryEvidenceKindsV1[number];
export type RunAuxiliaryEvidenceStateV1 = "not_collected" | "not_captured" | "empty";

export type RunAuxiliaryEvidenceEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.run_store.auxiliary_evidence.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  run_identity: string;
  evidence_kind: RunAuxiliaryEvidenceKindV1;
  state: RunAuxiliaryEvidenceStateV1 | null;
  reason: "METRICS_PRODUCER_NOT_ADMITTED" | "HTTP_TRACE_NOT_CAPTURED"
    | "RUN_ASSET_STORE_NOT_ADMITTED" | null;
  entries: [];
};

const presentationByKindV1 = {
  metrics: {
    state: "not_collected",
    reason: "METRICS_PRODUCER_NOT_ADMITTED",
  },
  traces: {
    state: "not_captured",
    reason: "HTTP_TRACE_NOT_CAPTURED",
  },
  assets: {
    state: "empty",
    reason: "RUN_ASSET_STORE_NOT_ADMITTED",
  },
} as const satisfies Record<RunAuxiliaryEvidenceKindV1, {
  state: RunAuxiliaryEvidenceStateV1;
  reason: NonNullable<RunAuxiliaryEvidenceEnvelopeV1["reason"]>;
}>;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function availableRunAuxiliaryEvidenceEnvelopeV1({
  runIdentity,
  evidenceKind,
  observedAt,
}: {
  runIdentity: string;
  evidenceKind: RunAuxiliaryEvidenceKindV1;
  observedAt: string;
}): RunAuxiliaryEvidenceEnvelopeV1 {
  const presentation = presentationByKindV1[evidenceKind];
  return {
    schema_version: 1,
    operation: "dashboard.run_store.auxiliary_evidence.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: observedAt,
    run_identity: runIdentity,
    evidence_kind: evidenceKind,
    state: presentation.state,
    reason: presentation.reason,
    entries: [],
  };
}

export function unavailableRunAuxiliaryEvidenceEnvelopeV1({
  runIdentity,
  evidenceKind,
  reason,
  observedAt = new Date().toISOString(),
}: {
  runIdentity: string;
  evidenceKind: RunAuxiliaryEvidenceKindV1;
  reason: string;
  observedAt?: string;
}): RunAuxiliaryEvidenceEnvelopeV1 {
  return {
    schema_version: 1,
    operation: "dashboard.run_store.auxiliary_evidence.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: observedAt,
    run_identity: runIdentity,
    evidence_kind: evidenceKind,
    state: null,
    reason: null,
    entries: [],
  };
}

export function parseRunAuxiliaryEvidenceEnvelopeV1(
  value: unknown,
): RunAuxiliaryEvidenceEnvelopeV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at",
    "run_identity", "evidence_kind", "state", "reason", "entries",
  ]) || envelope.schema_version !== 1
    || envelope.operation !== "dashboard.run_store.auxiliary_evidence.v1"
    || !["available", "unavailable"].includes(String(envelope.availability))
    || !timestamp(envelope.observed_at)
    || typeof envelope.run_identity !== "string" || !isRunIdentityV1(envelope.run_identity)
    || !runAuxiliaryEvidenceKindsV1.includes(envelope.evidence_kind as RunAuxiliaryEvidenceKindV1)
    || !Array.isArray(envelope.entries) || envelope.entries.length !== 0) return null;
  if (envelope.availability === "unavailable") {
    return typeof envelope.unavailable_reason === "string" && envelope.unavailable_reason.length > 0
      && envelope.state === null && envelope.reason === null
      ? value as RunAuxiliaryEvidenceEnvelopeV1 : null;
  }
  const expected = presentationByKindV1[envelope.evidence_kind as RunAuxiliaryEvidenceKindV1];
  return envelope.unavailable_reason === null && envelope.state === expected.state
    && envelope.reason === expected.reason ? value as RunAuxiliaryEvidenceEnvelopeV1 : null;
}
