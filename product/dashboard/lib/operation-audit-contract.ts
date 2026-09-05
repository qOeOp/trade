import {
  isRunEventCodeV1,
  isRunIdentityV1,
  type RunEventCodeV1,
} from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const auditSourcesV1 = [
  "run_store", "dashboard_bff", "owner_gateway", "shadow_worker", "artifact_orchestrator",
  "source_research_orchestrator",
] as const;
export type AuditSourceV1 = typeof auditSourcesV1[number];

export const auditPhasesV1 = [
  "dispatch", "custody", "owner_readback", "recovery", "deployment",
] as const;
export type AuditPhaseV1 = typeof auditPhasesV1[number];

export type OperationAuditEntryV1 = {
  schema_version: 1;
  correlation_identity: string;
  sequence: number;
  observed_at: string;
  severity: "info" | "warning" | "error";
  source: AuditSourceV1;
  event_code: RunEventCodeV1;
  phase: AuditPhaseV1;
  operation_id: string;
  trigger_kind: "dashboard_bff" | "dashboard_api" | "dashboard_scheduler";
  run_kind: "owner_read" | "owner_effect";
  run_state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  owner_outcome_state: "available" | "rejected" | "unknown" | "unavailable" | "not_applicable";
};

export type OperationAuditEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.operation_audit.read.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  completeness: "complete" | "partial_unavailable";
  observed_at: string;
  retention_limit: number;
  source_cut: string | null;
  entries: OperationAuditEntryV1[];
};

export function compareOperationAuditEntriesV1(
  left: OperationAuditEntryV1,
  right: OperationAuditEntryV1,
) {
  const leftKey = `${left.observed_at}\u0000${left.correlation_identity}\u0000${String(left.sequence).padStart(3, "0")}`;
  const rightKey = `${right.observed_at}\u0000${right.correlation_identity}\u0000${String(right.sequence).padStart(3, "0")}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

export function auditPhaseForEventV1(eventCode: RunEventCodeV1): AuditPhaseV1 {
  if (["OWNER_CLAIMED", "INVOCATION_STARTED"].includes(eventCode)) return "custody";
  if (["LEASE_EXPIRED_REQUEUED", "CLAIM_LIMIT_REACHED", "MANUAL_RECONCILIATION_REQUIRED"].includes(eventCode)) return "recovery";
  if (eventCode === "DEPLOYMENT_UNAVAILABLE") return "deployment";
  if (eventCode.startsWith("OWNER_")) return "owner_readback";
  return "dispatch";
}

function parseEntry(value: unknown, observedAt: string): OperationAuditEntryV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "correlation_identity", "sequence", "observed_at", "severity", "source",
    "event_code", "phase", "operation_id", "trigger_kind", "run_kind", "run_state",
    "owner_outcome_state",
  ]) || value.schema_version !== 1 || !isRunIdentityV1(value.correlation_identity)
    || !Number.isInteger(value.sequence) || Number(value.sequence) < 1 || Number(value.sequence) > 256
    || !timestamp(value.observed_at) || Date.parse(value.observed_at) > Date.parse(observedAt)
    || !["info", "warning", "error"].includes(String(value.severity))
    || !auditSourcesV1.includes(value.source as AuditSourceV1)
    || !isRunEventCodeV1(value.event_code) || !auditPhasesV1.includes(value.phase as AuditPhaseV1)
    || value.phase !== auditPhaseForEventV1(value.event_code as RunEventCodeV1)
    || typeof value.operation_id !== "string" || !IDENTITY.test(value.operation_id)
    || !["dashboard_bff", "dashboard_api", "dashboard_scheduler"].includes(String(value.trigger_kind))
    || !["owner_read", "owner_effect"].includes(String(value.run_kind))
    || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(String(value.run_state))
    || !["available", "rejected", "unknown", "unavailable", "not_applicable"].includes(String(value.owner_outcome_state))) return null;
  return value as OperationAuditEntryV1;
}

export function parseOperationAuditEnvelopeV1(value: unknown): OperationAuditEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "completeness",
    "observed_at", "retention_limit", "source_cut", "entries",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.operation_audit.read.v1"
    || !["available", "unavailable"].includes(String(value.availability))
    || !["complete", "partial_unavailable"].includes(String(value.completeness))
    || !timestamp(value.observed_at) || !Number.isInteger(value.retention_limit)
    || Number(value.retention_limit) < 1 || Number(value.retention_limit) > 512
    || !Array.isArray(value.entries)) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.completeness === "partial_unavailable" && value.source_cut === null
      && value.entries.length === 0 ? value as OperationAuditEnvelopeV1 : null;
  }
  if (value.unavailable_reason !== null || typeof value.source_cut !== "string"
    || !DIGEST.test(value.source_cut) || value.entries.length > Number(value.retention_limit)) return null;
  const entries = value.entries.map((entry) => parseEntry(entry, value.observed_at as string));
  if (entries.some((entry) => entry === null)) return null;
  const parsed = entries as OperationAuditEntryV1[];
  const identities = new Set(parsed.map((entry) => `${entry.correlation_identity}\u0000${entry.sequence}`));
  if (identities.size !== parsed.length) return null;
  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (compareOperationAuditEntriesV1(previous, current) > 0) return null;
  }
  return { ...(value as OperationAuditEnvelopeV1), entries: parsed };
}
