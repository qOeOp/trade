import { isRunEventCodeV1, isRunIdentityV1, type RunEventCodeV1 } from "./run-contract.ts";

export const runLogLevelsV1 = ["all", "info", "warning", "error"] as const;
export const runLogSourcesV1 = [
  "all", "run_store", "dashboard_bff", "owner_gateway", "shadow_worker", "artifact_orchestrator",
  "source_research_orchestrator",
] as const;

export type RunLogLevelV1 = typeof runLogLevelsV1[number];
export type RunLogSourceV1 = typeof runLogSourcesV1[number];
export type RunLogFilterV1 = { level: RunLogLevelV1; source: RunLogSourceV1; query: string };
export type RunLogEntryV1 = {
  schema_version: 1;
  run_identity: string;
  sequence: number;
  observed_at: string;
  level: Exclude<RunLogLevelV1, "all">;
  source: Exclude<RunLogSourceV1, "all">;
  event_code: RunEventCodeV1;
};
export type RunLogEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.run_logs.page.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  run_identity: string;
  filters: RunLogFilterV1;
  page_limit: number;
  retained_until: string | null;
  logs: RunLogEntryV1[];
  next_cursor: string | null;
};

const REASON = /^[A-Z][A-Z0-9_]{1,95}$/;
const QUERY = /^[A-Za-z0-9._:/ -]{0,64}$/;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function canonicalRunLogFilterV1(value: unknown): RunLogFilterV1 | null {
  if (!object(value) || !exactKeys(value, ["level", "source", "query"])
    || !runLogLevelsV1.includes(value.level as RunLogLevelV1)
    || !runLogSourcesV1.includes(value.source as RunLogSourceV1)
    || typeof value.query !== "string" || !QUERY.test(value.query)
    || value.query !== value.query.trim().toLowerCase()) return null;
  return value as RunLogFilterV1;
}

function parseEntry(value: unknown, runIdentity: string, observedAt: string): RunLogEntryV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "run_identity", "sequence", "observed_at", "level", "source", "event_code",
  ]) || value.schema_version !== 1 || value.run_identity !== runIdentity
    || !Number.isInteger(value.sequence) || Number(value.sequence) < 1 || Number(value.sequence) > 256
    || !timestamp(value.observed_at) || Date.parse(value.observed_at) > Date.parse(observedAt)
    || !runLogLevelsV1.slice(1).includes(value.level as Exclude<RunLogLevelV1, "all">)
    || !runLogSourcesV1.slice(1).includes(value.source as Exclude<RunLogSourceV1, "all">)
    || !isRunEventCodeV1(value.event_code)) return null;
  return value as RunLogEntryV1;
}

export function parseRunLogEnvelopeV1(value: unknown): RunLogEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at",
    "run_identity", "filters", "page_limit", "retained_until", "logs", "next_cursor",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.run_logs.page.v1"
    || !timestamp(value.observed_at) || !isRunIdentityV1(value.run_identity)
    || !canonicalRunLogFilterV1(value.filters) || !Number.isInteger(value.page_limit)
    || Number(value.page_limit) < 1 || Number(value.page_limit) > 256 || !Array.isArray(value.logs)) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && REASON.test(value.unavailable_reason)
      && value.retained_until === null && value.logs.length === 0 && value.next_cursor === null
      ? value as RunLogEnvelopeV1 : null;
  }
  if (value.availability !== "available" || value.unavailable_reason !== null
    || !timestamp(value.retained_until)
    || (value.next_cursor !== null && (typeof value.next_cursor !== "string"
      || value.next_cursor.length < 32 || value.next_cursor.length > 1_024))) return null;
  const logs = value.logs.map((entry) => parseEntry(entry, value.run_identity as string, value.observed_at as string));
  if (logs.some((entry) => entry === null)) return null;
  const parsed = logs as RunLogEntryV1[];
  if (parsed.some((entry, index) => index > 0 && parsed[index - 1].sequence >= entry.sequence)
    || (value.next_cursor !== null && parsed.length !== value.page_limit)) return null;
  return { ...(value as RunLogEnvelopeV1), logs: parsed };
}

export function runLogSearchParamsV1(filters: RunLogFilterV1, cursor?: string): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.level !== "all") search.set("level", filters.level);
  if (filters.source !== "all") search.set("source", filters.source);
  if (filters.query) search.set("query", filters.query);
  if (cursor) search.set("cursor", cursor);
  return search;
}

export function serializeRunLogDownloadV1(envelope: RunLogEnvelopeV1): string | null {
  const parsed = parseRunLogEnvelopeV1(envelope);
  if (!parsed || parsed.availability !== "available" || parsed.next_cursor !== null) return null;
  return [
    "# dashboard bounded run log v1",
    `# run_identity\t${parsed.run_identity}`,
    `# observed_at\t${parsed.observed_at}`,
    `# retained_until\t${parsed.retained_until}`,
    `# filters\tlevel=${parsed.filters.level};source=${parsed.filters.source};query=${parsed.filters.query}`,
    "sequence\tobserved_at\tlevel\tsource\tevent_code",
    ...parsed.logs.map((entry) => [
      entry.sequence, entry.observed_at, entry.level, entry.source, entry.event_code,
    ].join("\t")),
    "",
  ].join("\n");
}
