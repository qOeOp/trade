import { isRunIdentityV1, isRunTerminalCodeV1, type RunTerminalCodeV1 } from "./run-contract.ts";
import { isRunListOperationBindingV1, isRunListOperationIdV1 } from "./run-list-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const runListKindsV2 = ["runs", "dependencies"] as const;
export const runListStatesV2 = [
  "all", "queued", "running", "succeeded", "failed", "cancelled", "unknown",
] as const;
export const runListDurationsV2 = ["any", "lt_1s", "1_10s", "10_60s", "gte_60s"] as const;
export const runListPageSizesV2 = [25, 50, 100] as const;

export type RunListKindV2 = typeof runListKindsV2[number];
export type RunListStateV2 = typeof runListStatesV2[number];
export type RunListDurationV2 = typeof runListDurationsV2[number];
export type RunListPageSizeV2 = typeof runListPageSizesV2[number];

export type RunListFilterCutV2 = {
  schema_version: 1;
  kind: RunListKindV2;
  state: RunListStateV2;
  search: string;
  duration: RunListDurationV2;
  page_size: RunListPageSizeV2;
  page: number;
};

export type RunListSummaryV2 = {
  queued: number;
  running: number;
  unknown: number;
  succeeded: number;
  cancelled: number;
  completed: number;
  failed: number;
};

export type RunListItemV2 = {
  schema_version: 1;
  run_identity: string;
  operation_id: string;
  workload_kind: RunListKindV2;
  trigger_kind: "dashboard_bff" | "dashboard_api" | "dashboard_scheduler";
  state: Exclude<RunListStateV2, "all">;
  owner_outcome_state: "available" | "rejected" | "unknown" | "unavailable" | "not_applicable";
  effective_at: string;
  started_at: string | null;
  duration_ms: number | null;
  path: string;
  principal_ref: string | null;
  tag: null;
  concurrency_key_present: null;
  terminal_code: RunTerminalCodeV1 | null;
};

export type RunListViewEnvelopeV2 = {
  schema_version: 1;
  projection_version: 2;
  operation: "dashboard.run_store.list.v2";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  completeness: "complete" | "partial_unavailable";
  observed_at: string;
  source_cut: string | null;
  snapshot: string | null;
  filter_cut: RunListFilterCutV2 | null;
  summary: RunListSummaryV2 | null;
  filtered_total: number | null;
  total_pages: number | null;
  runs: RunListItemV2[];
};

export function isRunListSearchInputV2(value: string) {
  const canonical = value.trim().toLocaleLowerCase("en-US");
  return !/[\u0000-\u001f\u007f]/u.test(canonical)
    && new TextEncoder().encode(canonical).byteLength <= 128;
}

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

function filterCut(value: unknown): value is RunListFilterCutV2 {
  return object(value) && exactKeys(value, [
    "schema_version", "kind", "state", "search", "duration", "page_size", "page",
  ]) && value.schema_version === 1
    && runListKindsV2.includes(value.kind as RunListKindV2)
    && runListStatesV2.includes(value.state as RunListStateV2)
    && typeof value.search === "string" && value.search === value.search.trim().toLocaleLowerCase("en-US")
    && isRunListSearchInputV2(value.search)
    && runListDurationsV2.includes(value.duration as RunListDurationV2)
    && runListPageSizesV2.includes(value.page_size as RunListPageSizeV2)
    && Number.isSafeInteger(value.page) && Number(value.page) >= 1;
}

function summary(value: unknown): value is RunListSummaryV2 {
  return object(value) && exactKeys(value, [
    "queued", "running", "unknown", "succeeded", "cancelled", "completed", "failed",
  ]) && Object.values(value).every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
    && value.completed === Number(value.succeeded) + Number(value.cancelled);
}

function item(value: unknown, observedAt: string, kind: RunListKindV2): value is RunListItemV2 {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "run_identity", "operation_id", "workload_kind", "trigger_kind", "state",
    "owner_outcome_state", "effective_at", "started_at", "duration_ms", "path", "principal_ref",
    "tag", "concurrency_key_present", "terminal_code",
  ]) || value.schema_version !== 1 || !isRunIdentityV1(value.run_identity)
    || !isRunListOperationIdV1(value.operation_id)
    || value.workload_kind !== kind
    || typeof value.trigger_kind !== "string"
    || !["dashboard_bff", "dashboard_api", "dashboard_scheduler"].includes(value.trigger_kind)
    || typeof value.state !== "string"
    || !runListStatesV2.slice(1).includes(value.state as Exclude<RunListStateV2, "all">)
    || !isRunListOperationBindingV1(
      value.operation_id,
      kind === "runs" ? "owner_effect" : "owner_read",
      value.trigger_kind,
    )
    || typeof value.owner_outcome_state !== "string"
    || !["available", "rejected", "unknown", "unavailable", "not_applicable"].includes(value.owner_outcome_state)
    || !instant(value.effective_at) || Date.parse(value.effective_at) > Date.parse(observedAt)
    || !(value.started_at === null || (instant(value.started_at) && Date.parse(value.started_at) <= Date.parse(observedAt)))
    || !(value.duration_ms === null || (Number.isSafeInteger(value.duration_ms) && Number(value.duration_ms) >= 0))
    || value.path !== value.operation_id
    || !(value.principal_ref === null || (typeof value.principal_ref === "string" && IDENTITY.test(value.principal_ref)))
    || value.tag !== null || value.concurrency_key_present !== null
    || !(value.terminal_code === null || isRunTerminalCodeV1(value.terminal_code))) return false;
  const terminal = ["succeeded", "failed", "cancelled", "unknown"].includes(String(value.state));
  const queued = value.state === "queued";
  const cancelledBeforeStart = value.state === "cancelled"
    && value.started_at === null && value.duration_ms === null;
  const hasTiming = value.started_at !== null && value.duration_ms !== null;
  return (queued ? value.started_at === null && value.duration_ms === null : (cancelledBeforeStart || hasTiming))
    && (value.started_at === null || value.effective_at === value.started_at)
    && (value.started_at === null || Number(value.duration_ms) <= Date.parse(observedAt) - Date.parse(value.started_at))
    && (terminal || value.terminal_code === null);
}

function durationMatches(value: number | null, filter: RunListDurationV2) {
  if (filter === "any") return true;
  if (value === null) return false;
  if (filter === "lt_1s") return value < 1_000;
  if (filter === "1_10s") return value >= 1_000 && value < 10_000;
  if (filter === "10_60s") return value >= 10_000 && value < 60_000;
  return value >= 60_000;
}

function filterCutsEqual(left: RunListFilterCutV2, right: RunListFilterCutV2) {
  return left.schema_version === right.schema_version && left.kind === right.kind && left.state === right.state
    && left.search === right.search && left.duration === right.duration
    && left.page_size === right.page_size && left.page === right.page;
}

export function runListViewMatchesFilterV2(
  value: RunListViewEnvelopeV2 | null,
  expected: RunListFilterCutV2,
): value is RunListViewEnvelopeV2 & { availability: "available"; filter_cut: RunListFilterCutV2 } {
  return value?.availability === "available"
    && value.filter_cut !== null
    && filterCutsEqual(value.filter_cut, expected);
}

export function parseRunListViewEnvelopeV2(value: unknown): RunListViewEnvelopeV2 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "projection_version", "operation", "availability", "unavailable_reason",
    "completeness", "observed_at", "source_cut", "snapshot", "filter_cut", "summary",
    "filtered_total", "total_pages", "runs",
  ]) || value.schema_version !== 1 || value.projection_version !== 2
    || value.operation !== "dashboard.run_store.list.v2"
    || !["available", "unavailable"].includes(String(value.availability))
    || !["complete", "partial_unavailable"].includes(String(value.completeness))
    || !instant(value.observed_at) || !Array.isArray(value.runs)) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.completeness === "partial_unavailable" && value.source_cut === null
      && value.snapshot === null && value.filter_cut === null && value.summary === null
      && value.filtered_total === null && value.total_pages === null && value.runs.length === 0
      ? value as RunListViewEnvelopeV2 : null;
  }
  if (value.unavailable_reason !== null || value.completeness !== "complete"
    || typeof value.source_cut !== "string" || !DIGEST.test(value.source_cut)
    || typeof value.snapshot !== "string" || value.snapshot.length < 32 || value.snapshot.length > 4_096
    || !filterCut(value.filter_cut) || !summary(value.summary)
    || !Number.isSafeInteger(value.filtered_total) || Number(value.filtered_total) < 0
    || !Number.isSafeInteger(value.total_pages) || Number(value.total_pages) < 1) return null;
  const cut = value.filter_cut;
  const parsedSummary = value.summary as RunListSummaryV2;
  const total = Number(value.filtered_total);
  const pages = Math.max(1, Math.ceil(total / cut.page_size));
  if (value.total_pages !== pages || cut.page > pages || value.runs.length > cut.page_size
    || (total === 0 && value.runs.length !== 0)
    || (total > 0 && value.runs.length !== Math.min(cut.page_size, total - ((cut.page - 1) * cut.page_size)))) return null;
  const runs = value.runs as unknown[];
  if (!runs.every((run) => item(run, value.observed_at as string, cut.kind))) return null;
  const parsed = runs as RunListItemV2[];
  if (new Set(parsed.map(({ run_identity }) => run_identity)).size !== parsed.length
    || parsed.some((run) => cut.state !== "all" && run.state !== cut.state)
    || parsed.some((run) => !durationMatches(run.duration_ms, cut.duration))
    || parsed.some((run) => cut.search !== ""
      && !run.operation_id.toLocaleLowerCase("en-US").includes(cut.search)
      && !run.run_identity.toLocaleLowerCase("en-US").includes(cut.search))
    || parsed.some((run, index) => index > 0 && parsed[index - 1].effective_at < run.effective_at)) return null;
  const pageCounts = {
    queued: parsed.filter(({ state }) => state === "queued").length,
    running: parsed.filter(({ state }) => state === "running").length,
    unknown: parsed.filter(({ state }) => state === "unknown").length,
    succeeded: parsed.filter(({ state }) => state === "succeeded").length,
    cancelled: parsed.filter(({ state }) => state === "cancelled").length,
    failed: parsed.filter(({ state }) => state === "failed").length,
  };
  if (Object.entries(pageCounts).some(([key, count]) => count > parsedSummary[key as keyof RunListSummaryV2])) return null;
  const summaryTotal = parsedSummary.queued + parsedSummary.running + parsedSummary.unknown
    + parsedSummary.succeeded + parsedSummary.cancelled + parsedSummary.failed;
  const filteredSummaryCount = cut.state === "all" ? summaryTotal : parsedSummary[cut.state];
  if ((cut.state === "all" && total !== summaryTotal)
    || (cut.state !== "all" && total !== filteredSummaryCount)) return null;
  return value as RunListViewEnvelopeV2;
}

export function admitRunListViewResponseV2(
  value: unknown,
  expectation: {
    response_ok: boolean;
    filter_cut: RunListFilterCutV2;
    expected_snapshot?: string;
  },
): RunListViewEnvelopeV2 | null {
  const parsed = parseRunListViewEnvelopeV2(value);
  if (!parsed || (parsed.availability === "available" && !expectation.response_ok)) return null;
  if (parsed.availability === "unavailable") return parsed;
  return parsed.filter_cut && filterCutsEqual(parsed.filter_cut, expectation.filter_cut)
    && (expectation.expected_snapshot === undefined || parsed.snapshot === expectation.expected_snapshot)
    ? parsed : null;
}
