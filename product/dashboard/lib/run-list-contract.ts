import { isRunIdentityV1, isRunTerminalCodeV1, type RunTerminalCodeV1 } from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const operationIds = [
  "research_goal.legacy_quarantine_read.v1",
  "research_goal.shadow_resolve.v1",
  "artifact_build.shadow_resolve.v1",
  "source_intake.shadow_read.v1",
  "rd_formation_catalog.shadow_read.v1",
  "rd_historical_custody.shadow_read.v1",
  "rd_iteration_timeline.shadow_read.v1",
  "exploratory_replay.shadow_read.v2",
  "develop_composer.shadow_read.v2",
  "artifact_build.formation_execute.v1",
  "source_intake.research.submit_or_resolve.v1",
] as const;

type RunListOperationIdV1 = typeof operationIds[number];

export type RunListItemV1 = {
  schema_version: 1;
  run_identity: string;
  operation_id: RunListOperationIdV1;
  channel: "DASHBOARD_SHADOW_READ" | "DASHBOARD_DISPOSABLE_EXECUTION";
  run_kind: "owner_read" | "owner_effect";
  trigger_kind: "dashboard_bff" | "dashboard_api" | "dashboard_scheduler";
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  owner_outcome_state: "available" | "rejected" | "unknown" | "unavailable" | "not_applicable";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  terminal_code: RunTerminalCodeV1 | null;
};

export type RunListBrowserEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.run_store.list.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  runs: RunListItemV1[];
  next_cursor: string | null;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function instant(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || instant(value);
}

function item(value: unknown): value is RunListItemV1 {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "run_identity", "operation_id", "channel", "run_kind", "trigger_kind", "state",
    "owner_outcome_state", "created_at", "started_at", "finished_at", "duration_ms", "terminal_code",
  ])) return false;
  if (value.schema_version !== 1 || !isRunIdentityV1(value.run_identity)
    || typeof value.operation_id !== "string"
    || !operationIds.includes(value.operation_id as RunListOperationIdV1)
    || !["DASHBOARD_SHADOW_READ", "DASHBOARD_DISPOSABLE_EXECUTION"].includes(String(value.channel))
    || !["owner_read", "owner_effect"].includes(String(value.run_kind))
    || !["dashboard_bff", "dashboard_api", "dashboard_scheduler"].includes(String(value.trigger_kind))
    || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(String(value.state))
    || !["available", "rejected", "unknown", "unavailable", "not_applicable"].includes(String(value.owner_outcome_state))
    || !instant(value.created_at) || !nullableInstant(value.started_at) || !nullableInstant(value.finished_at)
    || !(value.duration_ms === null || (typeof value.duration_ms === "number"
      && Number.isSafeInteger(value.duration_ms) && value.duration_ms >= 0))
    || !(value.terminal_code === null || isRunTerminalCodeV1(value.terminal_code))) return false;
  const effectRun = value.operation_id === "artifact_build.formation_execute.v1"
    || value.operation_id === "source_intake.research.submit_or_resolve.v1";
  return effectRun === (value.channel === "DASHBOARD_DISPOSABLE_EXECUTION" && value.run_kind === "owner_effect")
    && (effectRun || (value.channel === "DASHBOARD_SHADOW_READ" && value.run_kind === "owner_read"))
    && (value.trigger_kind !== "dashboard_scheduler" || !effectRun);
}

export function parseRunListBrowserEnvelopeV1(value: unknown): RunListBrowserEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at", "runs", "next_cursor",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.run_store.list.v1"
    || !["available", "unavailable"].includes(String(value.availability)) || !instant(value.observed_at)
    || !Array.isArray(value.runs) || value.runs.length > 100 || !value.runs.every(item)
    || (value.next_cursor !== null && (typeof value.next_cursor !== "string"
      || value.next_cursor.length < 1 || value.next_cursor.length > 4096))) {
    return null;
  }
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.runs.length === 0 && value.next_cursor === null ? value as RunListBrowserEnvelopeV1 : null;
  }
  const runs = value.runs as RunListItemV1[];
  const identities = new Set(runs.map((run) => run.run_identity));
  const ordered = runs.every((run, index) => {
    const observed = Date.parse(value.observed_at as string);
    const created = Date.parse(run.created_at);
    const started = run.started_at === null ? null : Date.parse(run.started_at);
    const finished = run.finished_at === null ? null : Date.parse(run.finished_at);
    const terminal = ["succeeded", "failed", "cancelled", "unknown"].includes(run.state);
    const cancelledBeforeStart = run.state === "cancelled" && started === null;
    if (created > observed || (started !== null && (started < created || started > observed))
      || (finished !== null && (finished < created
        || (started !== null && finished < started) || finished > observed))
      || (started === null && run.state !== "queued" && !cancelledBeforeStart)
      || (run.state === "queued" && started !== null)
      || terminal !== (finished !== null)
      || (cancelledBeforeStart && (run.channel !== "DASHBOARD_SHADOW_READ"
        || run.run_kind !== "owner_read" || run.owner_outcome_state !== "unknown"
        || run.duration_ms !== null || run.terminal_code !== null))
      || (!cancelledBeforeStart && (started === null) !== (run.duration_ms === null))
      || (finished !== null && started !== null && run.duration_ms !== finished - started)
      || (!terminal && run.terminal_code !== null)) return false;
    const prior = runs[index - 1];
    // PostgreSQL applies the database collation to the run_identity tie-breaker,
    // while JavaScript string comparison is code-point based. The cursor remains
    // database-owned; the browser only needs to reject time-order regressions.
    return !prior || prior.created_at >= run.created_at;
  });
  return value.unavailable_reason === null && identities.size === runs.length && ordered
    ? value as RunListBrowserEnvelopeV1 : null;
}
