import { createHash, timingSafeEqual } from "node:crypto";

import {
  operationByIdV1,
  operationDispatchBindingForIdV1,
  type OperationDispatchBindingV1,
  type RegisteredOperationId,
} from "./operation-registry.ts";
import {
  canonicalRecoveryIdentityV1,
  type OperationRunV1,
  type PostgresRunStoreV1,
  type ShadowReadScheduleV1,
} from "./run-store.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

type SchedulerEnvironment = Record<string, string | undefined>;

export type ShadowScheduleDescriptorV1 = {
  schema_version: 1;
  operation_id: RegisteredOperationId;
  recovery_identity: Record<string, string>;
  cadence_seconds: number;
  anchor_epoch_ms: number;
};

export type BoundScheduleV1 = ShadowScheduleDescriptorV1 & {
  schedule_identity: string;
  schedule_digest: string;
  dispatch_binding: OperationDispatchBindingV1;
};

export type ConfiguredShadowScheduleSetV1 =
  | {
      state: "available";
      unavailable_reason: null;
      schedule_count: number;
      schedules: BoundScheduleV1[];
    }
  | {
      state: "unavailable";
      unavailable_reason: "SCHEDULE_SET_UNAVAILABLE" | "SCHEDULE_COMPATIBILITY_UNAVAILABLE";
      schedule_count: number;
      schedules: [];
    };

export type ShadowSchedulerTickV1 = {
  schema_version: 1;
  state: "idle" | "enqueued" | "unavailable";
  unavailable_reason: string | null;
  schedule_count: number;
  enqueued_run_identities: string[];
};

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u001f") === [...expected].sort().join("\u001f");
}

function parseDescriptor(raw: unknown): ShadowScheduleDescriptorV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, [
    "schema_version", "operation_id", "recovery_identity", "cadence_seconds", "anchor_epoch_ms",
  ]) || value.schema_version !== 1 || typeof value.operation_id !== "string"
    || !value.recovery_identity || typeof value.recovery_identity !== "object"
    || Array.isArray(value.recovery_identity) || !Number.isInteger(value.cadence_seconds)
    || Number(value.cadence_seconds) < 60 || Number(value.cadence_seconds) > 86_400
    || !Number.isSafeInteger(value.anchor_epoch_ms) || Number(value.anchor_epoch_ms) < 0) return null;
  let operationId: RegisteredOperationId;
  try {
    operationId = value.operation_id as RegisteredOperationId;
    if (operationByIdV1(operationId).effect_set.length !== 0) return null;
  } catch {
    return null;
  }
  const recovery = canonicalRecoveryIdentityV1(
    operationId,
    value.recovery_identity as Record<string, string>,
  );
  if (!recovery) return null;
  return {
    schema_version: 1,
    operation_id: operationId,
    recovery_identity: recovery,
    cadence_seconds: Number(value.cadence_seconds),
    anchor_epoch_ms: Number(value.anchor_epoch_ms),
  };
}

function descriptorOrder(left: ShadowScheduleDescriptorV1, right: ShadowScheduleDescriptorV1): number {
  return Buffer.compare(Buffer.from(JSON.stringify(left)), Buffer.from(JSON.stringify(right)));
}

export function configuredShadowSchedulesV1(
  environment: SchedulerEnvironment = process.env,
): ShadowScheduleDescriptorV1[] | null {
  const raw = environment.DASHBOARD_SHADOW_SCHEDULES_JSON;
  const declaredDigest = environment.DASHBOARD_SHADOW_SCHEDULES_DIGEST;
  if (!raw || !declaredDigest || !DIGEST.test(declaredDigest)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100) return null;
  const descriptors = parsed.map(parseDescriptor);
  if (descriptors.some((descriptor) => descriptor === null)) return null;
  const canonical = (descriptors as ShadowScheduleDescriptorV1[]).sort(descriptorOrder);
  if (new Set(canonical.map((descriptor) => sha256(JSON.stringify(descriptor)))).size
    !== canonical.length || sha256(JSON.stringify(canonical)) !== declaredDigest) return null;
  return canonical;
}

function bindSchedulesV1(
  descriptors: readonly ShadowScheduleDescriptorV1[],
  environment: SchedulerEnvironment,
  nowEpochMs: number,
): BoundScheduleV1[] | null {
  const bound: BoundScheduleV1[] = [];
  for (const descriptor of descriptors) {
    const dispatchBinding = operationDispatchBindingForIdV1(
      descriptor.operation_id,
      environment,
      nowEpochMs,
    );
    if (!dispatchBinding) return null;
    const content = { descriptor, dispatch_binding: dispatchBinding };
    const scheduleDigest = sha256(JSON.stringify(content));
    bound.push({
      ...descriptor,
      schedule_identity: `dashboard-schedule-v1-${scheduleDigest.slice("sha256:".length)}`,
      schedule_digest: scheduleDigest,
      dispatch_binding: dispatchBinding,
    });
  }
  return bound;
}

export function configuredBoundShadowSchedulesV1(
  environment: SchedulerEnvironment = process.env,
  nowEpochMs = Date.now(),
): BoundScheduleV1[] | null {
  const result = configuredShadowScheduleSetV1(environment, nowEpochMs);
  return result.state === "available" ? result.schedules : null;
}

export function configuredShadowScheduleSetV1(
  environment: SchedulerEnvironment = process.env,
  nowEpochMs = Date.now(),
): ConfiguredShadowScheduleSetV1 {
  const descriptors = configuredShadowSchedulesV1(environment);
  if (!descriptors) {
    return {
      state: "unavailable",
      unavailable_reason: "SCHEDULE_SET_UNAVAILABLE",
      schedule_count: 0,
      schedules: [],
    };
  }
  const schedules = bindSchedulesV1(descriptors, environment, nowEpochMs);
  if (!schedules) {
    return {
      state: "unavailable",
      unavailable_reason: "SCHEDULE_COMPATIBILITY_UNAVAILABLE",
      schedule_count: descriptors.length,
      schedules: [],
    };
  }
  return {
    state: "available",
    unavailable_reason: null,
    schedule_count: schedules.length,
    schedules,
  };
}

function schedulerConfigurationAvailable(environment: SchedulerEnvironment): boolean {
  const identity = environment.DASHBOARD_SCHEDULER_ID;
  const token = environment.DASHBOARD_SCHEDULER_TOKEN;
  const artifactDigest = environment.DASHBOARD_SCHEDULER_ARTIFACT_DIGEST;
  const configuredCapabilityDigest = environment.DASHBOARD_SCHEDULER_CAPABILITY_DIGEST;
  if (typeof identity !== "string" || !IDENTITY.test(identity)
    || typeof token !== "string" || Buffer.byteLength(token, "utf8") < 32
    || Buffer.byteLength(token, "utf8") > 4_096
    || typeof artifactDigest !== "string" || !DIGEST.test(artifactDigest)
    || artifactDigest !== environment.DASHBOARD_ARTIFACT_DIGEST
    || typeof configuredCapabilityDigest !== "string" || !DIGEST.test(configuredCapabilityDigest)) {
    return false;
  }
  const expected = schedulerCapabilityDigestV1(identity, token, artifactDigest);
  const expectedBytes = Buffer.from(expected);
  const configuredBytes = Buffer.from(configuredCapabilityDigest);
  return expectedBytes.length === configuredBytes.length
    && timingSafeEqual(expectedBytes, configuredBytes);
}

export function schedulerCapabilityDigestV1(
  schedulerIdentity: string,
  schedulerToken: string,
  schedulerArtifactDigest: string,
): string {
  return sha256(JSON.stringify({
    schema_version: 1,
    scheduler_identity: schedulerIdentity,
    scheduler_token_digest: sha256(schedulerToken),
    scheduler_artifact_digest: schedulerArtifactDigest,
  }));
}

export async function runShadowSchedulerTickV1({
  store,
  environment = process.env,
  nowEpochMs = Date.now(),
}: {
  store: Pick<PostgresRunStoreV1, "tickScheduledRead">;
  environment?: SchedulerEnvironment;
  nowEpochMs?: number;
}): Promise<ShadowSchedulerTickV1> {
  if (!schedulerConfigurationAvailable(environment)) {
    return {
      schema_version: 1,
      state: "unavailable",
      unavailable_reason: "SCHEDULER_CONFIGURATION_UNAVAILABLE",
      schedule_count: 0,
      enqueued_run_identities: [],
    };
  }
  const configured = configuredShadowScheduleSetV1(environment, nowEpochMs);
  if (configured.state === "unavailable") {
    return {
      schema_version: 1,
      state: "unavailable",
      unavailable_reason: configured.unavailable_reason,
      schedule_count: configured.schedule_count,
      enqueued_run_identities: [],
    };
  }
  const schedules = configured.schedules;
  const enqueued: string[] = [];
  for (const schedule of schedules) {
    const result: { schedule: ShadowReadScheduleV1; run: OperationRunV1 | null }
      = await store.tickScheduledRead({
        scheduleIdentity: schedule.schedule_identity,
        scheduleDigest: schedule.schedule_digest,
        operationId: schedule.operation_id,
        recoveryIdentity: schedule.recovery_identity,
        cadenceSeconds: schedule.cadence_seconds,
        anchorEpochMs: schedule.anchor_epoch_ms,
        dispatchBinding: schedule.dispatch_binding,
      });
    if (result.run) enqueued.push(result.run.run_identity);
  }
  return {
    schema_version: 1,
    state: enqueued.length > 0 ? "enqueued" : "idle",
    unavailable_reason: null,
    schedule_count: schedules.length,
    enqueued_run_identities: enqueued,
  };
}
