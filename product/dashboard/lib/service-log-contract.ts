const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const EVENT_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SEARCH = /^[^\u0000-\u001f\u007f]{0,128}$/;

export const serviceLogSourcesV1 = [
  "run_store", "dashboard_bff", "owner_gateway", "shadow_worker", "artifact_orchestrator",
  "source_research_orchestrator",
] as const;
export type ServiceLogSourceV1 = typeof serviceLogSourcesV1[number];
export const serviceLogRangesV1 = ["15m", "1h", "6h", "24h"] as const;
export type ServiceLogRangeV1 = typeof serviceLogRangesV1[number];
export const serviceLogPageSizesV1 = [20, 50, 100, 200] as const;
export type ServiceLogPageSizeV1 = typeof serviceLogPageSizesV1[number];

export type ServiceLogFilterCutV1 = {
  schema_version: 1;
  observed_at: string;
  range: ServiceLogRangeV1;
  kind: "all" | "worker" | "server";
  service: "all" | ServiceLogSourceV1;
  instance_identity: "all" | string;
  severity: "all" | "info" | "warning" | "error";
  search: string;
};

export type ServiceLogSummaryV1 = {
  error: number;
  warning: number;
  info: number;
  worker: number;
  server: number;
};

export type ServiceLogInstanceV1 = {
  schema_version: 1;
  instance_identity: string;
  instance_kind: "server" | "worker";
  readiness: "observed" | "available" | "expired";
  host_ref: null;
  services: ServiceLogSourceV1[];
  source_cut: string;
  last_observed_at: string;
};

export type ServiceLogEntryV1 = {
  schema_version: 1;
  correlation_identity: string;
  sequence: number;
  observed_at: string;
  severity: "info" | "warning" | "error";
  service: ServiceLogSourceV1;
  instance_identity: string;
  event_code: string;
};

export type ServiceLogEnvelopeV1 = {
  schema_version: 1;
  projection_version: 1;
  operation: "dashboard.service_log_gateway.read.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  completeness: "complete" | "partial_unavailable";
  observed_at: string;
  retention_limit: 512;
  filter_cut: ServiceLogFilterCutV1 | null;
  filter_cut_digest: string | null;
  summary: ServiceLogSummaryV1 | null;
  instances: ServiceLogInstanceV1[];
  selected_instance_identity: string | null;
  entries: ServiceLogEntryV1[];
  page_size: ServiceLogPageSizeV1;
  next_cursor: string | null;
};

export type ServiceLogBrowserEnvelopeV1 = ServiceLogEnvelopeV1;

export type ServiceLogFilterInputV1 = {
  observedAt?: string;
  range?: string;
  kind?: string;
  service?: string;
  instanceIdentity?: string;
  severity?: string;
  search?: string;
  pageSize?: number;
  cursor?: string;
};

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

function source(value: unknown): value is ServiceLogSourceV1 {
  return typeof value === "string" && serviceLogSourcesV1.includes(value as ServiceLogSourceV1);
}

function canonicalFilterJson(value: ServiceLogFilterCutV1) {
  return JSON.stringify({
    schema_version: 1,
    observed_at: value.observed_at,
    range: value.range,
    kind: value.kind,
    service: value.service,
    instance_identity: value.instance_identity,
    severity: value.severity,
    search: value.search,
  });
}

export function serviceLogFilterCutMatchesV1(
  actual: ServiceLogFilterCutV1,
  requested: ServiceLogFilterCutV1,
) {
  return canonicalFilterJson(actual) === canonicalFilterJson(requested);
}

export async function serviceLogFilterCutDigestV1(value: ServiceLogFilterCutV1) {
  const bytes = new TextEncoder().encode(canonicalFilterJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function serviceLogInstanceSourceCutDigestV1(
  value: Omit<ServiceLogInstanceV1, "source_cut">,
) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    schema_version: value.schema_version,
    instance_identity: value.instance_identity,
    instance_kind: value.instance_kind,
    readiness: value.readiness,
    host_ref: value.host_ref,
    services: value.services,
    last_observed_at: value.last_observed_at,
  }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function canonicalizeServiceLogFilterCutV1(
  input: ServiceLogFilterInputV1 = {},
  serverObservedAt = new Date().toISOString(),
): { filterCut: ServiceLogFilterCutV1; pageSize: ServiceLogPageSizeV1; cursor?: string } {
  if (!timestamp(serverObservedAt)) throw new Error("SERVICE_LOG_CUT_INVALID");
  const observedAt = input.observedAt ?? serverObservedAt;
  const range = input.range ?? "1h";
  const kind = input.kind ?? "all";
  const service = input.service ?? "all";
  const instanceIdentity = input.instanceIdentity ?? "all";
  const severity = input.severity ?? "all";
  const search = (input.search ?? "").trim().toLocaleLowerCase("en-US");
  const pageSize = input.pageSize ?? 50;
  if (!timestamp(observedAt) || Date.parse(observedAt) > Date.parse(serverObservedAt)
    || !serviceLogRangesV1.includes(range as ServiceLogRangeV1)
    || !["all", "worker", "server"].includes(kind)
    || (service !== "all" && !source(service))
    || (instanceIdentity !== "all" && !IDENTITY.test(instanceIdentity))
    || !["all", "info", "warning", "error"].includes(severity)
    || !SEARCH.test(search) || new TextEncoder().encode(search).byteLength > 128
    || !serviceLogPageSizesV1.includes(pageSize as ServiceLogPageSizeV1)
    || (input.cursor !== undefined && (input.cursor.length < 1 || input.cursor.length > 1_024))) {
    throw new Error("SERVICE_LOG_QUERY_INVALID");
  }
  return {
    filterCut: {
      schema_version: 1,
      observed_at: observedAt,
      range: range as ServiceLogRangeV1,
      kind: kind as ServiceLogFilterCutV1["kind"],
      service: service as ServiceLogFilterCutV1["service"],
      instance_identity: instanceIdentity,
      severity: severity as ServiceLogFilterCutV1["severity"],
      search,
    },
    pageSize: pageSize as ServiceLogPageSizeV1,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

export function compareServiceLogEntriesV1(left: ServiceLogEntryV1, right: ServiceLogEntryV1) {
  const time = Date.parse(right.observed_at) - Date.parse(left.observed_at);
  if (time !== 0) return time;
  if (left.correlation_identity !== right.correlation_identity) {
    return left.correlation_identity < right.correlation_identity ? 1 : -1;
  }
  return right.sequence - left.sequence;
}

function parseFilterCut(value: unknown, observedAt: string): ServiceLogFilterCutV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "observed_at", "range", "kind", "service", "instance_identity", "severity", "search",
  ]) || value.schema_version !== 1 || !timestamp(value.observed_at) || value.observed_at !== observedAt
    || !serviceLogRangesV1.includes(value.range as ServiceLogRangeV1)
    || !["all", "worker", "server"].includes(String(value.kind))
    || (value.service !== "all" && !source(value.service))
    || typeof value.instance_identity !== "string"
    || (value.instance_identity !== "all" && !IDENTITY.test(value.instance_identity))
    || !["all", "info", "warning", "error"].includes(String(value.severity))
    || typeof value.search !== "string" || value.search !== value.search.trim().toLocaleLowerCase("en-US")
    || !SEARCH.test(value.search) || new TextEncoder().encode(value.search).byteLength > 128) return null;
  return value as ServiceLogFilterCutV1;
}

function rangeStart(filterCut: ServiceLogFilterCutV1) {
  const duration = { "15m": 15 * 60_000, "1h": 60 * 60_000, "6h": 6 * 60 * 60_000, "24h": 24 * 60 * 60_000 }[filterCut.range];
  return Date.parse(filterCut.observed_at) - duration;
}

function parseInstance(value: unknown, observedAt: string): ServiceLogInstanceV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "instance_identity", "instance_kind", "readiness", "host_ref",
    "services", "source_cut", "last_observed_at",
  ]) || value.schema_version !== 1 || typeof value.instance_identity !== "string"
    || !IDENTITY.test(value.instance_identity)
    || !["server", "worker"].includes(String(value.instance_kind))
    || !["observed", "available", "expired"].includes(String(value.readiness))
    || value.host_ref !== null || !Array.isArray(value.services) || !value.services.every(source)
    || new Set(value.services).size !== value.services.length || value.services.length < 1
    || typeof value.source_cut !== "string" || !DIGEST.test(value.source_cut)
    || !timestamp(value.last_observed_at)
    || Date.parse(value.last_observed_at) > Date.parse(observedAt)) return null;
  if ((value.instance_kind === "server") !== (value.readiness === "observed")) return null;
  return value as ServiceLogInstanceV1;
}

function parseEntry(value: unknown, filterCut: ServiceLogFilterCutV1): ServiceLogEntryV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "correlation_identity", "sequence", "observed_at", "severity",
    "service", "instance_identity", "event_code",
  ]) || value.schema_version !== 1 || typeof value.correlation_identity !== "string"
    || !IDENTITY.test(value.correlation_identity) || !Number.isInteger(value.sequence)
    || Number(value.sequence) < 1 || Number(value.sequence) > 256
    || !timestamp(value.observed_at) || Date.parse(value.observed_at) > Date.parse(filterCut.observed_at)
    || Date.parse(value.observed_at) < rangeStart(filterCut)
    || !["info", "warning", "error"].includes(String(value.severity)) || !source(value.service)
    || typeof value.instance_identity !== "string" || !IDENTITY.test(value.instance_identity)
    || typeof value.event_code !== "string" || !EVENT_CODE.test(value.event_code)) return null;
  const searchable = [value.event_code, value.correlation_identity, value.service, value.instance_identity]
    .join("\u0000").toLocaleLowerCase("en-US");
  if ((filterCut.kind !== "all" && filterCut.kind !== (value.service === "shadow_worker" || value.service === "owner_gateway" ? "worker" : "server"))
    || (filterCut.service !== "all" && filterCut.service !== value.service)
    || (filterCut.instance_identity !== "all" && filterCut.instance_identity !== value.instance_identity)
    || (filterCut.severity !== "all" && filterCut.severity !== value.severity)
    || (filterCut.search && !searchable.includes(filterCut.search))) return null;
  return value as ServiceLogEntryV1;
}

function parseSummary(value: unknown): ServiceLogSummaryV1 | null {
  if (!object(value) || !exactKeys(value, ["error", "warning", "info", "worker", "server"])) return null;
  for (const count of Object.values(value)) {
    if (!Number.isSafeInteger(count) || Number(count) < 0) return null;
  }
  return value as ServiceLogSummaryV1;
}

export async function parseServiceLogBrowserEnvelopeV1(
  value: unknown,
  receivedAt = new Date().toISOString(),
): Promise<ServiceLogBrowserEnvelopeV1 | null> {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "projection_version", "operation", "availability", "unavailable_reason", "completeness",
    "observed_at", "retention_limit", "filter_cut", "filter_cut_digest", "summary", "instances",
    "selected_instance_identity", "entries", "page_size", "next_cursor",
  ]) || value.schema_version !== 1 || value.projection_version !== 1
    || value.operation !== "dashboard.service_log_gateway.read.v1"
    || !["available", "unavailable"].includes(String(value.availability))
    || !["complete", "partial_unavailable"].includes(String(value.completeness))
    || !timestamp(receivedAt) || !timestamp(value.observed_at)
    || Date.parse(value.observed_at) > Date.parse(receivedAt) || value.retention_limit !== 512
    || !serviceLogPageSizesV1.includes(value.page_size as ServiceLogPageSizeV1)
    || !Array.isArray(value.instances) || !Array.isArray(value.entries)
    || (value.next_cursor !== null && (typeof value.next_cursor !== "string" || value.next_cursor.length > 1_024))) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.completeness === "partial_unavailable" && value.filter_cut === null
      && value.filter_cut_digest === null && value.summary === null && value.instances.length === 0
      && value.selected_instance_identity === null && value.entries.length === 0 && value.next_cursor === null
      ? value as ServiceLogBrowserEnvelopeV1 : null;
  }
  if (value.unavailable_reason !== null || typeof value.filter_cut_digest !== "string"
    || !DIGEST.test(value.filter_cut_digest)) return null;
  const filterCut = parseFilterCut(value.filter_cut, value.observed_at as string);
  if (!filterCut || await serviceLogFilterCutDigestV1(filterCut) !== value.filter_cut_digest) return null;
  const summary = parseSummary(value.summary);
  const instances = value.instances.map((entry) => parseInstance(entry, value.observed_at as string));
  const entries = value.entries.map((entry) => parseEntry(entry, filterCut));
  if (!summary || instances.some((entry) => entry === null) || entries.some((entry) => entry === null)
    || entries.length > Number(value.page_size)) return null;
  const parsedInstances = instances as ServiceLogInstanceV1[];
  const parsedEntries = entries as ServiceLogEntryV1[];
  const identities = new Set(parsedInstances.map((entry) => entry.instance_identity));
  if (identities.size !== parsedInstances.length || parsedEntries.some((entry) => !identities.has(entry.instance_identity))) return null;
  for (const instance of parsedInstances) {
    const { source_cut: sourceCut, ...sourceCutFields } = instance;
    if (await serviceLogInstanceSourceCutDigestV1(sourceCutFields) !== sourceCut) return null;
  }
  const instanceByIdentity = new Map(parsedInstances.map((instance) => [instance.instance_identity, instance]));
  if (parsedEntries.some((entry) => {
    const instance = instanceByIdentity.get(entry.instance_identity);
    const workerService = entry.service === "shadow_worker" || entry.service === "owner_gateway";
    return !instance || !instance.services.includes(entry.service)
      || Date.parse(entry.observed_at) > Date.parse(instance.last_observed_at)
      || workerService !== (instance.instance_kind === "worker");
  })) return null;
  const entryIdentities = new Set(parsedEntries.map((entry) => `${entry.correlation_identity}\u0000${entry.sequence}`));
  if (entryIdentities.size !== parsedEntries.length) return null;
  for (let index = 1; index < parsedEntries.length; index += 1) {
    if (compareServiceLogEntriesV1(parsedEntries[index - 1], parsedEntries[index]) > 0) return null;
  }
  const selected = value.selected_instance_identity;
  if ((selected !== null && (typeof selected !== "string" || !identities.has(selected)))
    || (parsedInstances.length === 0) !== (selected === null)
    || summary.error < parsedEntries.filter(({ severity }) => severity === "error").length
    || summary.warning < parsedEntries.filter(({ severity }) => severity === "warning").length
    || summary.info < parsedEntries.filter(({ severity }) => severity === "info").length
    || summary.worker !== parsedInstances.filter(({ instance_kind }) => instance_kind === "worker").length
    || summary.server !== parsedInstances.filter(({ instance_kind }) => instance_kind === "server").length) return null;
  return value as ServiceLogBrowserEnvelopeV1;
}

export const parseServiceLogEnvelopeV1 = parseServiceLogBrowserEnvelopeV1;
