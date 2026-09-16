import { operationRegistryV1, type RegisteredOperationId } from "./operation-registry.ts";

const SCHEDULE_IDENTITY = /^dashboard-schedule-v1-[0-9a-f]{64}$/;
const RUN_IDENTITY = /^dashboard-run-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const registeredOperations = new Set(operationRegistryV1.map(({ operation_id }) => operation_id));

export type ScheduleHistoryProjectionV1 = {
  schema_version: 1;
  schedule_identity: string;
  operation_id: RegisteredOperationId;
  cadence_seconds: number;
  registered_at: string;
  last_observed_at: string | null;
  last_run_identity: string | null;
  recorded_at: string;
};

export type ScheduleHistoryEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.shadow_schedule_history.list.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  completeness: "complete" | "partial_unavailable" | null;
  retention_limit: 100;
  observed_at: string;
  schedules: ScheduleHistoryProjectionV1[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join("\u001f") === [...expected].sort().join("\u001f");
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseHistoryRow(value: unknown, observedAt: string): ScheduleHistoryProjectionV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "schedule_identity", "operation_id", "cadence_seconds", "registered_at",
    "last_observed_at", "last_run_identity", "recorded_at",
  ]) || value.schema_version !== 1 || typeof value.schedule_identity !== "string"
    || !SCHEDULE_IDENTITY.test(value.schedule_identity) || typeof value.operation_id !== "string"
    || !registeredOperations.has(value.operation_id as RegisteredOperationId)
    || !Number.isInteger(value.cadence_seconds) || Number(value.cadence_seconds) < 60
    || Number(value.cadence_seconds) > 86_400 || !canonicalTimestamp(value.registered_at)
    || (value.last_observed_at !== null && !canonicalTimestamp(value.last_observed_at))
    || (value.last_run_identity !== null
      && (typeof value.last_run_identity !== "string" || !RUN_IDENTITY.test(value.last_run_identity)))
    || !canonicalTimestamp(value.recorded_at)
    || (value.last_observed_at === null) !== (value.last_run_identity === null)) return null;
  const registeredAt = Date.parse(value.registered_at);
  const lastObservedAt = value.last_observed_at === null ? null : Date.parse(value.last_observed_at);
  const recordedAt = Date.parse(value.recorded_at);
  if (registeredAt > recordedAt || recordedAt > Date.parse(observedAt)
    || (lastObservedAt !== null && (lastObservedAt < registeredAt || lastObservedAt > recordedAt))) return null;
  return value as ScheduleHistoryProjectionV1;
}

function historyCut(row: ScheduleHistoryProjectionV1) {
  return Date.parse(row.last_observed_at ?? row.registered_at);
}

export function parseScheduleHistoryEnvelopeV1(value: unknown): ScheduleHistoryEnvelopeV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "completeness",
    "retention_limit", "observed_at", "schedules",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.shadow_schedule_history.list.v1"
    || value.retention_limit !== 100 || !canonicalTimestamp(value.observed_at)
    || !Array.isArray(value.schedules) || value.schedules.length > 100) return null;
  if (value.availability === "unavailable") {
    if (typeof value.unavailable_reason !== "string" || value.unavailable_reason.length < 1
      || value.completeness !== null || value.schedules.length !== 0) return null;
    return value as ScheduleHistoryEnvelopeV1;
  }
  if (value.availability !== "available" || value.unavailable_reason !== null
    || (value.completeness !== "complete" && value.completeness !== "partial_unavailable")
    || (value.completeness === "partial_unavailable" && value.schedules.length !== 100)) return null;
  const schedules = value.schedules.map((row) => parseHistoryRow(row, value.observed_at as string));
  if (schedules.some((row) => row === null)) return null;
  const parsed = schedules as ScheduleHistoryProjectionV1[];
  const identities = parsed.map(({ schedule_identity }) => schedule_identity);
  if (new Set(identities).size !== identities.length) return null;
  for (let index = 1; index < parsed.length; index += 1) {
    const previousCut = historyCut(parsed[index - 1]);
    const currentCut = historyCut(parsed[index]);
    if (previousCut < currentCut
      || (previousCut === currentCut && parsed[index - 1].schedule_identity >= parsed[index].schedule_identity)) return null;
  }
  return { ...(value as ScheduleHistoryEnvelopeV1), schedules: parsed };
}
