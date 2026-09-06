import type { RegisteredOperationId } from "./operation-registry";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SCHEDULE_IDENTITY = /^dashboard-schedule-v1-[0-9a-f]{64}$/;
const RUN_IDENTITY = /^dashboard-run-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

const recoveryFields = {
  "research_goal.legacy_quarantine_read.v1": ["request_identity"],
  "research_goal.shadow_resolve.v1": ["request_identity"],
  "artifact_build.shadow_resolve.v1": [
    "research_request_identity", "build_request_identity", "attempt_identity",
  ],
  "source_intake.shadow_read.v1": ["request_identity"],
  "rd_formation_catalog.shadow_read.v1": [],
  "rd_iteration_timeline.shadow_read.v1": ["trial_family_identity"],
  "rd_historical_custody.shadow_read.v1": [],
  "exploratory_replay.shadow_read.v2": ["request_identity", "meaning_digest"],
  "develop_composer.shadow_read.v2": ["request_identity"],
} as const satisfies Record<RegisteredOperationId, readonly string[]>;

export type ScheduleProjectionV1 = {
  schema_version: 1;
  schedule_identity: string;
  schedule_digest: string;
  operation_id: keyof typeof recoveryFields;
  recovery_identity: Record<string, string>;
  recovery_identity_digest: string;
  cadence_seconds: number;
  anchor_at: string;
  next_due_at: string;
  last_due_at: string | null;
  last_run_identity: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleEnvelopeProjectionV1 = {
  schema_version: 1;
  operation: "dashboard.shadow_schedules.list.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  schedules: ScheduleProjectionV1[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u001f") === [...expected].sort().join("\u001f");
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

async function recoveryDigest(
  operationId: keyof typeof recoveryFields,
  recoveryIdentity: Record<string, unknown>,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({
    operation_id: operationId,
    recovery_identity: recoveryIdentity,
  }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function parseSchedule(
  value: unknown,
  observedAt: string,
): Promise<ScheduleProjectionV1 | null> {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "schedule_identity", "schedule_digest", "operation_id",
    "recovery_identity", "recovery_identity_digest", "cadence_seconds", "anchor_at",
    "next_due_at", "last_due_at", "last_run_identity", "created_at", "updated_at",
  ]) || value.schema_version !== 1 || typeof value.schedule_identity !== "string"
    || !SCHEDULE_IDENTITY.test(value.schedule_identity) || typeof value.schedule_digest !== "string"
    || !DIGEST.test(value.schedule_digest) || typeof value.operation_id !== "string"
    || !Object.hasOwn(recoveryFields, value.operation_id) || typeof value.recovery_identity_digest !== "string"
    || !DIGEST.test(value.recovery_identity_digest) || !Number.isInteger(value.cadence_seconds)
    || Number(value.cadence_seconds) < 60 || Number(value.cadence_seconds) > 86_400
    || !timestamp(value.anchor_at) || !timestamp(value.next_due_at)
    || (value.last_due_at !== null && !timestamp(value.last_due_at))
    || (value.last_run_identity !== null
      && (typeof value.last_run_identity !== "string" || !RUN_IDENTITY.test(value.last_run_identity)))
    || !timestamp(value.created_at) || !timestamp(value.updated_at)
    || (value.last_due_at === null) !== (value.last_run_identity === null)
    || Date.parse(value.next_due_at) < Date.parse(value.anchor_at)
    || (value.last_due_at !== null && (Date.parse(value.last_due_at) < Date.parse(value.anchor_at)
      || Date.parse(value.next_due_at) <= Date.parse(value.last_due_at)))) return null;
  const cadenceMs = Number(value.cadence_seconds) * 1_000;
  const anchorMs = Date.parse(value.anchor_at);
  const nextDueMs = Date.parse(value.next_due_at);
  const lastDueMs = value.last_due_at === null ? null : Date.parse(value.last_due_at);
  const createdMs = Date.parse(value.created_at);
  const updatedMs = Date.parse(value.updated_at);
  const observedMs = Date.parse(observedAt);
  if ((nextDueMs - anchorMs) % cadenceMs !== 0
    || (lastDueMs !== null && (lastDueMs - anchorMs) % cadenceMs !== 0)
    || (lastDueMs !== null && lastDueMs > updatedMs)
    || createdMs > updatedMs || updatedMs > observedMs) return null;
  if (!record(value.recovery_identity)) return null;
  const receivedRecovery = value.recovery_identity;
  const expected = recoveryFields[value.operation_id as keyof typeof recoveryFields];
  if (!exactKeys(receivedRecovery, expected)
    || Object.values(receivedRecovery).some(
      (identity) => typeof identity !== "string" || !IDENTITY.test(identity),
    )) return null;
  const canonicalRecovery = Object.fromEntries(
    expected.map((field) => [field, receivedRecovery[field]]),
  );
  if (await recoveryDigest(
      value.operation_id as keyof typeof recoveryFields,
      canonicalRecovery,
    ) !== value.recovery_identity_digest) return null;
  return value as ScheduleProjectionV1;
}

export async function parseScheduleEnvelopeV1(
  value: unknown,
): Promise<ScheduleEnvelopeProjectionV1 | null> {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at", "schedules",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.shadow_schedules.list.v1"
    || !timestamp(value.observed_at) || !Array.isArray(value.schedules) || value.schedules.length > 100) return null;
  if (value.availability === "unavailable") {
    if (typeof value.unavailable_reason !== "string" || value.unavailable_reason.length < 1
      || value.schedules.length !== 0) return null;
    return value as ScheduleEnvelopeProjectionV1;
  }
  if (value.availability !== "available" || value.unavailable_reason !== null
    || value.schedules.length === 0) return null;
  const schedules = await Promise.all(value.schedules.map(
    (schedule) => parseSchedule(schedule, value.observed_at as string),
  ));
  if (schedules.some((schedule) => schedule === null)) return null;
  const identities = schedules.map((schedule) => (schedule as ScheduleProjectionV1).schedule_identity);
  if (new Set(identities).size !== identities.length
    || identities.some((identity, index) => index > 0 && identities[index - 1] >= identity)) return null;
  return { ...(value as ScheduleEnvelopeProjectionV1), schedules: schedules as ScheduleProjectionV1[] };
}
