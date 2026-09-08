import { createHmac, timingSafeEqual } from "node:crypto";

import { Pool, type QueryResultRow } from "pg";

import {
  canonicalizeServiceLogFilterCutV1,
  compareServiceLogEntriesV1,
  serviceLogFilterCutDigestV1,
  serviceLogInstanceSourceCutDigestV1,
  serviceLogPageSizesV1,
  serviceLogSourcesV1,
  type ServiceLogEntryV1,
  type ServiceLogEnvelopeV1,
  type ServiceLogFilterCutV1,
  type ServiceLogFilterInputV1,
  type ServiceLogInstanceV1,
  type ServiceLogPageSizeV1,
  type ServiceLogSourceV1,
} from "./service-log-contract.ts";
import { isRunEventCodeV1, isRunIdentityV1 } from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const RETENTION_LIMIT = 512 as const;
const DOWNLOAD_LIMIT_BYTES = 256 * 1_024;
const LEVELS = ["info", "warning", "error"] as const;
const WORKER_SOURCES: ServiceLogSourceV1[] = ["shadow_worker", "owner_gateway"];

type LogRow = QueryResultRow & {
  correlation_identity: string;
  sequence: number;
  observed_at: Date;
  severity: ServiceLogEntryV1["severity"];
  service: ServiceLogSourceV1;
  event_code: string;
  claimed_by: string | null;
  claim_attempt: number | null;
};

type WorkerRow = QueryResultRow & { worker_identity: string; lease_expires_at: Date };

export type ServiceLogCursorV1 = {
  schema_version: 1;
  filter_cut_digest: string;
  observed_at: string;
  correlation_identity: string;
  sequence: number;
};

export type ServiceLogDownloadV1 = {
  bytes: Uint8Array;
  filter_cut_digest: string;
  row_count: number;
  truncated: boolean;
  completeness: ServiceLogEnvelopeV1["completeness"];
};

function cursorSignature(payload: string, key: string) {
  return createHmac("sha256", key).update(payload).digest();
}

export function issueServiceLogCursorV1(cursor: ServiceLogCursorV1, key: string) {
  if (Buffer.byteLength(key, "utf8") < 32) throw new Error("SERVICE_LOG_CONFIGURATION_INVALID");
  const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${payload}.${cursorSignature(payload, key).toString("base64url")}`;
}

export function parseServiceLogCursorV1(value: string | undefined, key: string, digest: string): ServiceLogCursorV1 | null {
  if (Buffer.byteLength(key, "utf8") < 32) return null;
  if (!value || value.length > 1_024) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) return null;
    const provided = Buffer.from(signature, "base64url");
    const expected = cursorSignature(payload, key);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const raw: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const parsed = raw as Record<string, unknown>;
    if (Object.keys(parsed).sort().join(",") !== "correlation_identity,filter_cut_digest,observed_at,schema_version,sequence"
      || parsed.schema_version !== 1 || parsed.filter_cut_digest !== digest
      || typeof parsed.observed_at !== "string" || !Number.isFinite(Date.parse(parsed.observed_at))
      || typeof parsed.correlation_identity !== "string" || !isRunIdentityV1(parsed.correlation_identity)
      || !Number.isInteger(parsed.sequence) || Number(parsed.sequence) < 1 || Number(parsed.sequence) > 256) return null;
    return parsed as ServiceLogCursorV1;
  } catch {
    return null;
  }
}

function rangeStart(filterCut: ServiceLogFilterCutV1) {
  const duration = { "15m": 15 * 60_000, "1h": 60 * 60_000, "6h": 6 * 60 * 60_000, "24h": 24 * 60 * 60_000 }[filterCut.range];
  return new Date(Date.parse(filterCut.observed_at) - duration);
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class PostgresServiceLogGatewayV1 {
  readonly #pool: Pool;
  readonly #serverInstanceIdentity: string;
  readonly #cursorHmacKey: string;

  constructor(
    connectionString: string,
    serverInstanceIdentity: string,
    cursorHmacKey = process.env.DASHBOARD_CURSOR_HMAC_KEY ?? process.env.DASHBOARD_TEST_CURSOR_HMAC_KEY,
  ) {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !IDENTITY.test(serverInstanceIdentity)
      || typeof cursorHmacKey !== "string" || Buffer.byteLength(cursorHmacKey, "utf8") < 32) {
      throw new Error("SERVICE_LOG_CONFIGURATION_INVALID");
    }
    this.#pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3_000 });
    this.#serverInstanceIdentity = serverInstanceIdentity;
    this.#cursorHmacKey = cursorHmacKey;
  }

  async close() { await this.#pool.end(); }

  async #readCut(input: ServiceLogFilterInputV1, pageSize: ServiceLogPageSizeV1 | 512, includeCursor: boolean) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const now = (await client.query<{ observed_at: Date }>("SELECT statement_timestamp() AS observed_at")).rows[0].observed_at;
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("SERVICE_LOG_CUT_INVALID");
      const canonical = canonicalizeServiceLogFilterCutV1(input, now.toISOString());
      const filterCut = canonical.filterCut;
      const filterDigest = await serviceLogFilterCutDigestV1(filterCut);
      const cursor = input.cursor === undefined ? null : parseServiceLogCursorV1(input.cursor, this.#cursorHmacKey, filterDigest);
      if (input.cursor !== undefined && !cursor) throw new Error("SERVICE_LOG_CURSOR_INVALID");
      if (cursor && now.getTime() - Date.parse(filterCut.observed_at) > 24 * 60 * 60_000) {
        throw new Error("SERVICE_LOG_CURSOR_EXPIRED");
      }

      const values: unknown[] = [filterCut.observed_at, rangeStart(filterCut), RETENTION_LIMIT + 1];
      const predicates = ["l.observed_at <= $1", "l.observed_at >= $2", "r.retained_until > $1"];
      const workerExpression = "l.source IN ('shadow_worker', 'owner_gateway')";
      if (filterCut.kind !== "all") predicates.push(filterCut.kind === "worker" ? workerExpression : `NOT (${workerExpression})`);
      if (filterCut.service !== "all") { values.push(filterCut.service); predicates.push(`l.source = $${values.length}`); }
      if (filterCut.severity !== "all") { values.push(filterCut.severity); predicates.push(`l.level = $${values.length}`); }
      if (filterCut.instance_identity !== "all") {
        if (filterCut.instance_identity === this.#serverInstanceIdentity) {
          predicates.push(`NOT (${workerExpression})`);
        } else {
          values.push(filterCut.instance_identity);
          predicates.push(workerExpression, `q.claimed_by = $${values.length}`);
        }
      }
      if (filterCut.search) {
        values.push(`%${filterCut.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
        predicates.push(`(lower(l.event_code) LIKE $${values.length} ESCAPE '\\'
          OR lower(l.run_identity) LIKE $${values.length} ESCAPE '\\'
          OR lower(l.source) LIKE $${values.length} ESCAPE '\\'
          OR lower(CASE WHEN ${workerExpression} THEN COALESCE(q.claimed_by, '') ELSE '${this.#serverInstanceIdentity}' END)
             LIKE $${values.length} ESCAPE '\\')`);
      }
      const rows = await client.query<LogRow>(
        `SELECT l.run_identity AS correlation_identity, l.sequence, l.observed_at,
                l.level AS severity, l.source AS service, l.event_code,
                q.claimed_by, q.claim_attempt
           FROM dashboard_operation_run_logs_v1 l
           JOIN dashboard_operation_runs_v1 r USING (run_identity)
      LEFT JOIN dashboard_shadow_dispatch_queue_v1 q USING (run_identity)
          WHERE ${predicates.join(" AND ")}
          ORDER BY l.observed_at DESC, l.run_identity DESC, l.sequence DESC
          LIMIT $3`,
        values,
      );
      const retained = rows.rows.slice(0, RETENTION_LIMIT);
      const workerIdentities = [...new Set(retained.flatMap((row) => (
        WORKER_SOURCES.includes(row.service) && row.claimed_by ? [row.claimed_by] : []
      )))];
      const workerRows = workerIdentities.length
        ? await client.query<WorkerRow>(
          `SELECT worker_identity, lease_expires_at FROM dashboard_shadow_workers_v1
            WHERE worker_identity = ANY($1::text[]) ORDER BY worker_identity`, [workerIdentities],
        ) : { rows: [] as WorkerRow[] };
      await client.query("COMMIT");

      const workers = new Map(workerRows.rows.map((row) => [row.worker_identity, row]));
      const retentionTruncated = rows.rows.length > RETENTION_LIMIT;
      let incomplete = retentionTruncated;
      const allEntries: ServiceLogEntryV1[] = [];
      for (const row of retained) {
        if (!isRunIdentityV1(row.correlation_identity) || !Number.isInteger(row.sequence)
          || row.sequence < 1 || row.sequence > 256 || !(row.observed_at instanceof Date)
          || !Number.isFinite(row.observed_at.getTime()) || row.observed_at > new Date(filterCut.observed_at)
          || !LEVELS.includes(row.severity) || !serviceLogSourcesV1.includes(row.service)
          || !isRunEventCodeV1(row.event_code)) { incomplete = true; continue; }
        const workerSource = WORKER_SOURCES.includes(row.service);
        const instanceIdentity = workerSource ? row.claimed_by : this.#serverInstanceIdentity;
        const worker = instanceIdentity ? workers.get(instanceIdentity) : undefined;
        if (!instanceIdentity || !IDENTITY.test(instanceIdentity)
          || (workerSource && row.claim_attempt !== 1)
          || (workerSource && (!worker || instanceIdentity === this.#serverInstanceIdentity
            || !(worker.lease_expires_at instanceof Date) || !Number.isFinite(worker.lease_expires_at.getTime())))) {
          incomplete = true;
          continue;
        }
        allEntries.push({
          schema_version: 1,
          correlation_identity: row.correlation_identity,
          sequence: row.sequence,
          observed_at: row.observed_at.toISOString(),
          severity: row.severity,
          service: row.service,
          instance_identity: instanceIdentity,
          event_code: row.event_code,
        });
      }
      allEntries.sort(compareServiceLogEntriesV1);
      const byInstance = new Map<string, ServiceLogEntryV1[]>();
      for (const entry of allEntries) byInstance.set(entry.instance_identity, [...(byInstance.get(entry.instance_identity) ?? []), entry]);
      const instances: ServiceLogInstanceV1[] = (await Promise.all([...byInstance].map(async ([identity, instanceEntries]) => {
        const worker = workers.get(identity);
        const sourceCutFields: Omit<ServiceLogInstanceV1, "source_cut"> = {
          schema_version: 1,
          instance_identity: identity,
          instance_kind: worker ? "worker" : "server",
          readiness: worker ? (worker.lease_expires_at > new Date(filterCut.observed_at) ? "available" : "expired") : "observed",
          host_ref: null,
          services: [...new Set(instanceEntries.map(({ service }) => service))]
            .sort((left, right) => serviceLogSourcesV1.indexOf(left) - serviceLogSourcesV1.indexOf(right)),
          last_observed_at: instanceEntries[0].observed_at,
        };
        return { ...sourceCutFields, source_cut: await serviceLogInstanceSourceCutDigestV1(sourceCutFields) };
      }))).sort((left, right) => Date.parse(right.last_observed_at) - Date.parse(left.last_observed_at)
        || left.instance_identity.localeCompare(right.instance_identity));
      const start = cursor ? allEntries.findIndex((entry) => entry.observed_at === cursor.observed_at
        && entry.correlation_identity === cursor.correlation_identity && entry.sequence === cursor.sequence) + 1 : 0;
      if (cursor && start === 0) throw new Error("SERVICE_LOG_CURSOR_EXPIRED");
      const entries = allEntries.slice(start, start + pageSize);
      const last = entries.at(-1);
      const nextCursor = includeCursor && last && start + entries.length < allEntries.length
        ? issueServiceLogCursorV1({ schema_version: 1, filter_cut_digest: filterDigest, observed_at: last.observed_at,
          correlation_identity: last.correlation_identity, sequence: last.sequence }, this.#cursorHmacKey) : null;
      return { filterCut, filterDigest, incomplete, retentionTruncated, allEntries, instances, entries, nextCursor };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async read(input: ServiceLogFilterInputV1 = {}): Promise<ServiceLogEnvelopeV1> {
    const pageSize = input.pageSize === undefined ? 50 : input.pageSize;
    if (!serviceLogPageSizesV1.includes(pageSize as ServiceLogPageSizeV1)) throw new Error("SERVICE_LOG_QUERY_INVALID");
    const { filterCut, filterDigest, incomplete, allEntries, instances, entries, nextCursor } = await this.#readCut(
      input, pageSize as ServiceLogPageSizeV1, true,
    );
    const requested = filterCut.instance_identity;
    const selected = requested !== "all" && instances.some(({ instance_identity }) => instance_identity === requested)
      ? requested : instances[0]?.instance_identity ?? null;
    return {
      schema_version: 1,
      projection_version: 1,
      operation: "dashboard.service_log_gateway.read.v1",
      availability: "available",
      unavailable_reason: null,
      completeness: incomplete ? "partial_unavailable" : "complete",
      observed_at: filterCut.observed_at,
      retention_limit: RETENTION_LIMIT,
      filter_cut: filterCut,
      filter_cut_digest: filterDigest,
      summary: {
        error: allEntries.filter(({ severity }) => severity === "error").length,
        warning: allEntries.filter(({ severity }) => severity === "warning").length,
        info: allEntries.filter(({ severity }) => severity === "info").length,
        worker: instances.filter(({ instance_kind }) => instance_kind === "worker").length,
        server: instances.filter(({ instance_kind }) => instance_kind === "server").length,
      },
      instances,
      selected_instance_identity: selected,
      entries,
      page_size: pageSize as ServiceLogPageSizeV1,
      next_cursor: nextCursor,
    };
  }

  async download(input: ServiceLogFilterInputV1): Promise<ServiceLogDownloadV1> {
    if (input.cursor !== undefined) throw new Error("SERVICE_LOG_DOWNLOAD_CURSOR_INVALID");
    const { filterDigest, incomplete, retentionTruncated, allEntries } = await this.#readCut(input, 512, false);
    const lines = ["timestamp,severity,service,instance,correlation,event"];
    let truncated = retentionTruncated;
    for (const entry of allEntries) {
      const line = [entry.observed_at, entry.severity, entry.service, entry.instance_identity,
        entry.correlation_identity, entry.event_code].map(csvCell).join(",");
      const candidate = `${lines.join("\n")}\n${line}\n`;
      if (Buffer.byteLength(candidate, "utf8") > DOWNLOAD_LIMIT_BYTES) { truncated = true; break; }
      lines.push(line);
    }
    return {
      bytes: new TextEncoder().encode(`${lines.join("\n")}\n`),
      filter_cut_digest: filterDigest,
      row_count: lines.length - 1,
      truncated,
      completeness: incomplete ? "partial_unavailable" : "complete",
    };
  }
}

let configuredGateway: PostgresServiceLogGatewayV1 | null | undefined;

export function configuredServiceLogGatewayV1() {
  if (configuredGateway !== undefined) return configuredGateway;
  const databaseUrl = process.env.DASHBOARD_DATABASE_URL;
  const serverInstanceIdentity = process.env.DASHBOARD_SERVER_INSTANCE_IDENTITY;
  const cursorHmacKey = process.env.DASHBOARD_CURSOR_HMAC_KEY;
  if (!databaseUrl && !serverInstanceIdentity && !cursorHmacKey) configuredGateway = null;
  else if (!databaseUrl || !serverInstanceIdentity || !cursorHmacKey) throw new Error("SERVICE_LOG_CONFIGURATION_INVALID");
  else configuredGateway = new PostgresServiceLogGatewayV1(databaseUrl, serverInstanceIdentity, cursorHmacKey);
  return configuredGateway;
}
