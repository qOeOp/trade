const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const serviceLogSourcesV1 = [
  "run_store", "dashboard_bff", "owner_gateway", "shadow_worker", "artifact_orchestrator",
  "source_research_orchestrator",
] as const;
export type ServiceLogSourceV1 = typeof serviceLogSourcesV1[number];

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
  operation: "dashboard.service_log_gateway.read.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  completeness: "complete" | "partial_unavailable";
  observed_at: string;
  retention_limit: number;
  instances: ServiceLogInstanceV1[];
  entries: ServiceLogEntryV1[];
};

export function compareServiceLogEntriesV1(left: ServiceLogEntryV1, right: ServiceLogEntryV1) {
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

function source(value: unknown): value is ServiceLogSourceV1 {
  return typeof value === "string" && serviceLogSourcesV1.includes(value as ServiceLogSourceV1);
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
    || !timestamp(value.last_observed_at) || Date.parse(value.last_observed_at) > Date.parse(observedAt)) return null;
  if ((value.instance_kind === "server") !== (value.readiness === "observed")) return null;
  return value as ServiceLogInstanceV1;
}

function parseEntry(value: unknown, observedAt: string): ServiceLogEntryV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "correlation_identity", "sequence", "observed_at", "severity",
    "service", "instance_identity", "event_code",
  ]) || value.schema_version !== 1 || typeof value.correlation_identity !== "string"
    || !IDENTITY.test(value.correlation_identity) || !Number.isInteger(value.sequence)
    || Number(value.sequence) < 1 || Number(value.sequence) > 256
    || !timestamp(value.observed_at) || Date.parse(value.observed_at) > Date.parse(observedAt)
    || !["info", "warning", "error"].includes(String(value.severity)) || !source(value.service)
    || typeof value.instance_identity !== "string" || !IDENTITY.test(value.instance_identity)
    || typeof value.event_code !== "string" || !IDENTITY.test(value.event_code)) return null;
  return value as ServiceLogEntryV1;
}

export function parseServiceLogEnvelopeV1(value: unknown): ServiceLogEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "completeness",
    "observed_at", "retention_limit", "instances", "entries",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.service_log_gateway.read.v1"
    || !["available", "unavailable"].includes(String(value.availability))
    || !["complete", "partial_unavailable"].includes(String(value.completeness))
    || !timestamp(value.observed_at) || !Number.isInteger(value.retention_limit)
    || Number(value.retention_limit) < 1 || Number(value.retention_limit) > 512
    || !Array.isArray(value.instances) || !Array.isArray(value.entries)) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.completeness === "partial_unavailable"
      && value.instances.length === 0 && value.entries.length === 0
      ? value as ServiceLogEnvelopeV1 : null;
  }
  if (value.unavailable_reason !== null) return null;
  const instances = value.instances.map((entry) => parseInstance(entry, value.observed_at as string));
  const entries = value.entries.map((entry) => parseEntry(entry, value.observed_at as string));
  if (instances.some((entry) => entry === null) || entries.some((entry) => entry === null)
    || entries.length > Number(value.retention_limit)) return null;
  const identities = new Set((instances as ServiceLogInstanceV1[]).map((entry) => entry.instance_identity));
  if (identities.size !== instances.length
    || (entries as ServiceLogEntryV1[]).some((entry) => !identities.has(entry.instance_identity))) return null;
  const parsedEntries = entries as ServiceLogEntryV1[];
  const entryIdentities = new Set(parsedEntries.map((entry) => (
    `${entry.correlation_identity}\u0000${entry.sequence}`
  )));
  if (entryIdentities.size !== parsedEntries.length) return null;
  for (let index = 1; index < parsedEntries.length; index += 1) {
    const previous = parsedEntries[index - 1];
    const current = parsedEntries[index];
    if (compareServiceLogEntriesV1(previous, current) > 0) return null;
  }
  for (const instance of instances as ServiceLogInstanceV1[]) {
    const instanceEntries = parsedEntries.filter((entry) => entry.instance_identity === instance.instance_identity);
    if (instanceEntries.length < 1) return null;
    const services = [...new Set(instanceEntries.map(({ service }) => service))]
      .sort((left, right) => serviceLogSourcesV1.indexOf(left) - serviceLogSourcesV1.indexOf(right));
    if (services.length !== instance.services.length
      || services.some((entry, index) => entry !== instance.services[index])
      || instance.last_observed_at !== instanceEntries.at(-1)?.observed_at) return null;
  }
  return { ...(value as ServiceLogEnvelopeV1), instances: instances as ServiceLogInstanceV1[], entries: entries as ServiceLogEntryV1[] };
}
