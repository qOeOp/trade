import { isRunIdentityV1 } from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,96}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const AUDIT_IDENTITY = /^dashboard-operation-audit-v1-[0-9a-f]{64}$/;
const RECEIPT_IDENTITY = /^dashboard-(?:operational-(?:cancellation|cache-deletion)|control-plane-admission)-v1-[0-9a-f]{64}$/;
const SEARCH = /^[^\u0000-\u001f\u007f]{0,128}$/;

export const operationAuditRangesV1 = ["24h", "7d", "30d", "all"] as const;
export type OperationAuditRangeV1 = typeof operationAuditRangesV1[number];
export const operationAuditOperationsV1 = [
  "artifact_build.formation_execute.v1",
  "dashboard.dependency.cancel.queued.v1",
  "dashboard.operational_cache.delete.v1",
  "develop_composer.submit_or_resolve.v2",
  "exploratory_replay.submit_or_resolve.v2",
  "source_intake.research.submit_or_resolve.v1",
] as const;
export type OperationAuditOperationV1 = typeof operationAuditOperationsV1[number];
export const operationAuditOutcomesV1 = ["succeeded", "failed", "denied", "unknown"] as const;
export type OperationAuditOutcomeV1 = typeof operationAuditOutcomesV1[number];
export const operationAuditPageSizesV1 = [20, 50, 100] as const;
export type OperationAuditPageSizeV1 = typeof operationAuditPageSizesV1[number];

export type OperationAuditEntryV1 = {
  schema_version: 1;
  audit_identity: string;
  observed_at: string;
  principal_ref: string;
  operation: OperationAuditOperationV1;
  action_kind: "execute" | "update" | "delete";
  outcome: OperationAuditOutcomeV1;
  target_kind: "operation_run";
  target_identity: string;
  correlation_identity: string;
  receipt_identity: string;
  authorization_digest: string;
};

export type OperationAuditFilterCutV1 = {
  schema_version: 1;
  observed_at: string;
  range: OperationAuditRangeV1;
  principal_ref: "all" | string;
  operation: "all" | OperationAuditOperationV1;
  outcome: "all" | OperationAuditOutcomeV1;
  search: string;
};

export type OperationAuditSummaryV1 = {
  execute: number;
  create_update: number;
  delete: number;
  succeeded: number;
  failed_denied: number;
};

export type OperationAuditPageV1 = {
  schema_version: 1;
  projection_version: 1;
  operation: "dashboard.operation_audit.read.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  completeness: "complete" | "partial_unavailable";
  observed_at: string;
  retention_limit: 512;
  source_cut: string | null;
  filter_cut: OperationAuditFilterCutV1 | null;
  filter_cut_digest: string | null;
  summary: OperationAuditSummaryV1 | null;
  principals: string[];
  operations: OperationAuditOperationV1[];
  entries: OperationAuditEntryV1[];
  page_size: OperationAuditPageSizeV1;
  next_cursor: string | null;
};

export type OperationAuditDetailV1 = {
  schema_version: 1;
  projection_version: 1;
  operation: "dashboard.operation_audit.detail.read.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  completeness: "complete" | "partial_unavailable";
  observed_at: string;
  source_cut: string | null;
  entry: OperationAuditEntryV1 | null;
  timeline: OperationAuditEntryV1[];
};

export type OperationAuditFilterInputV1 = {
  observedAt?: string;
  range?: string;
  principalRef?: string;
  operation?: string;
  outcome?: string;
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

function uniqueSorted(values: readonly string[]) {
  return new Set(values).size === values.length
    && values.every((value, index) => index === 0 || values[index - 1] < value);
}

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hashed = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(hashed)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function operationAuditIdentityForReceiptV1(receiptIdentity: string) {
  if (!RECEIPT_IDENTITY.test(receiptIdentity)) throw new Error("OPERATION_AUDIT_RECEIPT_INVALID");
  return `dashboard-operation-audit-v1-${receiptIdentity.slice(-64)}`;
}

export async function operationAuditFilterCutDigestV1(value: OperationAuditFilterCutV1) {
  return digest(value);
}

export async function operationAuditSourceCutV1(entries: readonly OperationAuditEntryV1[]) {
  return digest(entries);
}

export function canonicalizeOperationAuditFilterCutV1(
  input: OperationAuditFilterInputV1 = {},
  serverObservedAt = new Date().toISOString(),
): { filterCut: OperationAuditFilterCutV1; pageSize: OperationAuditPageSizeV1; cursor?: string } {
  if (!timestamp(serverObservedAt)) throw new Error("OPERATION_AUDIT_CUT_INVALID");
  const observedAt = input.observedAt ?? serverObservedAt;
  const range = input.range ?? "7d";
  const principalRef = input.principalRef ?? "all";
  const operation = input.operation ?? "all";
  const outcome = input.outcome ?? "all";
  const search = (input.search ?? "").trim().toLocaleLowerCase("en-US");
  const pageSize = input.pageSize ?? 50;
  if (!timestamp(observedAt) || Date.parse(observedAt) > Date.parse(serverObservedAt)
    || !operationAuditRangesV1.includes(range as OperationAuditRangeV1)
    || (principalRef !== "all" && !PRINCIPAL.test(principalRef))
    || (operation !== "all" && !operationAuditOperationsV1.includes(operation as OperationAuditOperationV1))
    || (outcome !== "all" && !operationAuditOutcomesV1.includes(outcome as OperationAuditOutcomeV1))
    || !SEARCH.test(search) || new TextEncoder().encode(search).byteLength > 128
    || !operationAuditPageSizesV1.includes(pageSize as OperationAuditPageSizeV1)
    || (input.cursor !== undefined && (input.cursor.length < 1 || input.cursor.length > 1_024))) {
    throw new Error("OPERATION_AUDIT_QUERY_INVALID");
  }
  return {
    filterCut: {
      schema_version: 1,
      observed_at: observedAt,
      range: range as OperationAuditRangeV1,
      principal_ref: principalRef,
      operation: operation as OperationAuditFilterCutV1["operation"],
      outcome: outcome as OperationAuditFilterCutV1["outcome"],
      search,
    },
    pageSize: pageSize as OperationAuditPageSizeV1,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

function rangeStart(cut: OperationAuditFilterCutV1) {
  if (cut.range === "all") return Number.NEGATIVE_INFINITY;
  const duration = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 }[cut.range];
  return Date.parse(cut.observed_at) - duration;
}

export function compareOperationAuditEntriesV1(left: OperationAuditEntryV1, right: OperationAuditEntryV1) {
  const time = Date.parse(right.observed_at) - Date.parse(left.observed_at);
  if (time !== 0) return time;
  return left.audit_identity < right.audit_identity ? 1 : left.audit_identity > right.audit_identity ? -1 : 0;
}

export function parseOperationAuditEntryV1(value: unknown): OperationAuditEntryV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "audit_identity", "observed_at", "principal_ref", "operation",
    "action_kind", "outcome", "target_kind", "target_identity", "correlation_identity",
    "receipt_identity", "authorization_digest",
  ]) || value.schema_version !== 1 || typeof value.audit_identity !== "string"
    || !AUDIT_IDENTITY.test(value.audit_identity) || !timestamp(value.observed_at)
    || typeof value.principal_ref !== "string" || !PRINCIPAL.test(value.principal_ref)
    || !operationAuditOperationsV1.includes(value.operation as OperationAuditOperationV1)
    || !["execute", "update", "delete"].includes(String(value.action_kind))
    || (value.operation === "artifact_build.formation_execute.v1" && value.action_kind !== "execute")
    || (value.operation === "exploratory_replay.submit_or_resolve.v2"
      && value.action_kind !== "execute")
    || (value.operation === "develop_composer.submit_or_resolve.v2"
      && value.action_kind !== "execute")
    || (value.operation === "source_intake.research.submit_or_resolve.v1" && value.action_kind !== "execute")
    || (value.operation === "dashboard.dependency.cancel.queued.v1" && value.action_kind !== "update")
    || (value.operation === "dashboard.operational_cache.delete.v1" && value.action_kind !== "delete")
    || !operationAuditOutcomesV1.includes(value.outcome as OperationAuditOutcomeV1)
    || value.target_kind !== "operation_run" || !isRunIdentityV1(value.target_identity)
    || value.correlation_identity !== value.target_identity
    || typeof value.receipt_identity !== "string" || !RECEIPT_IDENTITY.test(value.receipt_identity)
    || operationAuditIdentityForReceiptV1(value.receipt_identity) !== value.audit_identity
    || typeof value.authorization_digest !== "string" || !DIGEST.test(value.authorization_digest)) return null;
  return value as OperationAuditEntryV1;
}

function parseFilterCut(value: unknown, observedAt: string): OperationAuditFilterCutV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "observed_at", "range", "principal_ref", "operation", "outcome", "search",
  ]) || value.schema_version !== 1 || value.observed_at !== observedAt || !timestamp(value.observed_at)
    || !operationAuditRangesV1.includes(value.range as OperationAuditRangeV1)
    || typeof value.principal_ref !== "string" || (value.principal_ref !== "all" && !PRINCIPAL.test(value.principal_ref))
    || typeof value.operation !== "string"
    || (value.operation !== "all" && !operationAuditOperationsV1.includes(value.operation as OperationAuditOperationV1))
    || typeof value.outcome !== "string"
    || (value.outcome !== "all" && !operationAuditOutcomesV1.includes(value.outcome as OperationAuditOutcomeV1))
    || typeof value.search !== "string" || value.search !== value.search.trim().toLocaleLowerCase("en-US")
    || !SEARCH.test(value.search) || new TextEncoder().encode(value.search).byteLength > 128) return null;
  return value as OperationAuditFilterCutV1;
}

function entryMatchesCut(entry: OperationAuditEntryV1, cut: OperationAuditFilterCutV1) {
  const searchable = `${entry.target_identity}\u0000${entry.correlation_identity}`.toLocaleLowerCase("en-US");
  return Date.parse(entry.observed_at) <= Date.parse(cut.observed_at)
    && Date.parse(entry.observed_at) >= rangeStart(cut)
    && (cut.principal_ref === "all" || cut.principal_ref === entry.principal_ref)
    && (cut.operation === "all" || cut.operation === entry.operation)
    && (cut.outcome === "all" || cut.outcome === entry.outcome)
    && (!cut.search || searchable.includes(cut.search));
}

function parseSummary(value: unknown): OperationAuditSummaryV1 | null {
  if (!object(value) || !exactKeys(value, ["execute", "create_update", "delete", "succeeded", "failed_denied"])) return null;
  if (Object.values(value).some((count) => !Number.isSafeInteger(count) || Number(count) < 0)) return null;
  return value as OperationAuditSummaryV1;
}

export async function parseOperationAuditPageV1(
  value: unknown,
  receivedAt = new Date().toISOString(),
): Promise<OperationAuditPageV1 | null> {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "projection_version", "operation", "availability", "unavailable_reason",
    "completeness", "observed_at", "retention_limit", "source_cut", "filter_cut",
    "filter_cut_digest", "summary", "principals", "operations", "entries", "page_size", "next_cursor",
  ]) || value.schema_version !== 1 || value.projection_version !== 1
    || value.operation !== "dashboard.operation_audit.read.v1"
    || !["available", "unavailable"].includes(String(value.availability))
    || !["complete", "partial_unavailable"].includes(String(value.completeness))
    || !timestamp(receivedAt) || !timestamp(value.observed_at)
    || Date.parse(value.observed_at) > Date.parse(receivedAt) || value.retention_limit !== 512
    || !operationAuditPageSizesV1.includes(value.page_size as OperationAuditPageSizeV1)
    || !Array.isArray(value.principals) || !Array.isArray(value.operations) || !Array.isArray(value.entries)
    || (value.next_cursor !== null && (typeof value.next_cursor !== "string" || value.next_cursor.length > 1_024))) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.completeness === "partial_unavailable" && value.source_cut === null
      && value.filter_cut === null && value.filter_cut_digest === null && value.summary === null
      && value.principals.length === 0 && value.operations.length === 0 && value.entries.length === 0
      && value.next_cursor === null ? value as OperationAuditPageV1 : null;
  }
  if (value.unavailable_reason !== null || typeof value.source_cut !== "string" || !DIGEST.test(value.source_cut)
    || typeof value.filter_cut_digest !== "string" || !DIGEST.test(value.filter_cut_digest)) return null;
  const filterCut = parseFilterCut(value.filter_cut, value.observed_at as string);
  const summary = parseSummary(value.summary);
  if (!filterCut || !summary || await operationAuditFilterCutDigestV1(filterCut) !== value.filter_cut_digest) return null;
  const principals = value.principals as unknown[];
  const operations = value.operations as unknown[];
  if (!principals.every((item) => typeof item === "string" && PRINCIPAL.test(item))
    || !uniqueSorted(principals as string[]) || !operations.every((item) => operationAuditOperationsV1.includes(item as OperationAuditOperationV1))
    || !uniqueSorted(operations as string[])) return null;
  const entries = value.entries.map(parseOperationAuditEntryV1);
  if (entries.some((entry) => entry === null) || entries.length > Number(value.page_size)) return null;
  const parsed = entries as OperationAuditEntryV1[];
  if (new Set(parsed.map(({ audit_identity }) => audit_identity)).size !== parsed.length
    || new Set(parsed.map(({ receipt_identity }) => receipt_identity)).size !== parsed.length
    || parsed.some((entry) => !entryMatchesCut(entry, filterCut))
    || parsed.some((entry, index) => index > 0 && compareOperationAuditEntriesV1(parsed[index - 1], entry) > 0)
    || await operationAuditSourceCutV1(parsed) !== value.source_cut) return null;
  return { ...(value as OperationAuditPageV1), entries: parsed };
}

export async function parseOperationAuditDetailV1(
  value: unknown,
  receivedAt = new Date().toISOString(),
): Promise<OperationAuditDetailV1 | null> {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "projection_version", "operation", "availability", "unavailable_reason",
    "completeness", "observed_at", "source_cut", "entry", "timeline",
  ]) || value.schema_version !== 1 || value.projection_version !== 1
    || value.operation !== "dashboard.operation_audit.detail.read.v1"
    || !["available", "unavailable"].includes(String(value.availability))
    || !["complete", "partial_unavailable"].includes(String(value.completeness))
    || !timestamp(receivedAt) || !timestamp(value.observed_at)
    || Date.parse(value.observed_at) > Date.parse(receivedAt) || !Array.isArray(value.timeline)) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.completeness === "partial_unavailable" && value.source_cut === null
      && value.entry === null && value.timeline.length === 0 ? value as OperationAuditDetailV1 : null;
  }
  if (value.unavailable_reason !== null || typeof value.source_cut !== "string" || !DIGEST.test(value.source_cut)) return null;
  const entry = parseOperationAuditEntryV1(value.entry);
  const timeline = value.timeline.map(parseOperationAuditEntryV1);
  if (!entry || timeline.some((item) => item === null) || timeline.length > 256) return null;
  const parsed = timeline as OperationAuditEntryV1[];
  if (!parsed.some(({ audit_identity }) => audit_identity === entry.audit_identity)
    || parsed.some(({ correlation_identity }) => correlation_identity !== entry.correlation_identity)
    || new Set(parsed.map(({ audit_identity }) => audit_identity)).size !== parsed.length
    || parsed.some((item, index) => index > 0 && compareOperationAuditEntriesV1(parsed[index - 1], item) < 0)
    || await operationAuditSourceCutV1(parsed) !== value.source_cut) return null;
  return { ...(value as OperationAuditDetailV1), entry, timeline: parsed };
}
