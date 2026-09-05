export const RUN_IDENTITY_V1_PATTERN =
  /^dashboard-run-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const RUN_TERMINAL_CODES_V1 = [
  "CLAIM_LIMIT_REACHED",
  "DEPLOYMENT_UNAVAILABLE",
  "OWNER_AVAILABLE",
  "OWNER_REJECTED",
  "OWNER_UNKNOWN",
  "OWNER_UNAVAILABLE",
  "MANUAL_RECONCILIATION_REQUIRED",
] as const;

export type RunTerminalCodeV1 = typeof RUN_TERMINAL_CODES_V1[number];

export const RUN_EVENT_CODES_V1 = [
  "RUN_QUEUED",
  "RUN_CLAIMED",
  "RUN_STARTED",
  "LEASE_EXPIRED_REQUEUED",
  "OWNER_CLAIMED",
  "INVOCATION_STARTED",
  "SOURCE_OWNER_AVAILABLE",
  "RESEARCH_OWNER_AVAILABLE",
  ...RUN_TERMINAL_CODES_V1,
] as const;

export type RunEventCodeV1 = typeof RUN_EVENT_CODES_V1[number];

export function isRunIdentityV1(value: unknown): value is string {
  return typeof value === "string" && RUN_IDENTITY_V1_PATTERN.test(value);
}

export function isRunTerminalCodeV1(value: unknown): value is RunTerminalCodeV1 {
  return typeof value === "string"
    && (RUN_TERMINAL_CODES_V1 as readonly string[]).includes(value);
}

export function isRunEventCodeV1(value: unknown): value is RunEventCodeV1 {
  return typeof value === "string"
    && (RUN_EVENT_CODES_V1 as readonly string[]).includes(value);
}
