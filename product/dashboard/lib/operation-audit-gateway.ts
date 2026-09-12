import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  canonicalizeOperationAuditFilterCutV1,
  operationAuditOperationsV1,
  parseOperationAuditEntryV1,
  type OperationAuditDetailV1,
  type OperationAuditEntryV1,
  type OperationAuditFilterCutV1,
  type OperationAuditFilterInputV1,
  type OperationAuditOperationV1,
  type OperationAuditPageV1,
  type OperationAuditSummaryV1,
} from "./operation-audit-contract.ts";

const AUDIT_IDENTITY = /^dashboard-operation-audit-v1-[0-9a-f]{64}$/;
const RETENTION_LIMIT = 512;

type AuditRow = QueryResultRow & Omit<OperationAuditEntryV1, "schema_version" | "observed_at"> & {
  schema_version: number;
  observed_at: Date;
};

type AuditCursorV1 = {
  schema_version: 1;
  filter_cut_digest: string;
  observed_at: string;
  last_observed_at: string;
  last_audit_identity: string;
  seen: number;
};

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function sourceCut(entries: readonly OperationAuditEntryV1[]) {
  return digest(entries);
}

function encodeCursor(cursor: AuditCursorV1, key: string) {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeCursor(value: string, key: string): AuditCursorV1 | null {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  if (signature.length !== expected.length
    || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuditCursorV1;
    if (!parsed || parsed.schema_version !== 1 || typeof parsed.filter_cut_digest !== "string"
      || typeof parsed.observed_at !== "string" || typeof parsed.last_observed_at !== "string"
      || !Number.isFinite(Date.parse(parsed.observed_at)) || !Number.isFinite(Date.parse(parsed.last_observed_at))
      || typeof parsed.last_audit_identity !== "string" || !AUDIT_IDENTITY.test(parsed.last_audit_identity)
      || !Number.isSafeInteger(parsed.seen) || parsed.seen < 1 || parsed.seen > RETENTION_LIMIT) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rangeStart(cut: OperationAuditFilterCutV1) {
  if (cut.range === "all") return null;
  const duration = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 }[cut.range];
  return new Date(Date.parse(cut.observed_at) - duration).toISOString();
}

function rowToEntry(row: AuditRow): OperationAuditEntryV1 {
  const parsed = parseOperationAuditEntryV1({
    ...row,
    schema_version: row.schema_version,
    observed_at: row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at,
  });
  if (!parsed) throw new Error("OPERATION_AUDIT_ROW_INVALID");
  return parsed;
}

function basePredicate(cut: OperationAuditFilterCutV1) {
  const values: unknown[] = [cut.observed_at];
  const predicates = ["observed_at <= $1::timestamptz"];
  const start = rangeStart(cut);
  if (start) {
    values.push(start);
    predicates.push(`observed_at >= $${values.length}::timestamptz`);
  }
  if (cut.principal_ref !== "all") {
    values.push(cut.principal_ref);
    predicates.push(`principal_ref = $${values.length}`);
  }
  if (cut.operation !== "all") {
    values.push(cut.operation);
    predicates.push(`operation = $${values.length}`);
  }
  if (cut.outcome !== "all") {
    values.push(cut.outcome);
    predicates.push(`outcome = $${values.length}`);
  }
  if (cut.search) {
    const escaped = cut.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    values.push(`%${escaped}%`);
    predicates.push(`(lower(target_identity) LIKE $${values.length} ESCAPE '\\' OR lower(correlation_identity) LIKE $${values.length} ESCAPE '\\')`);
  }
  return { values, predicates };
}

async function observedAt(client: PoolClient) {
  return (await client.query<{ observed_at: Date }>(
    "SELECT statement_timestamp() AS observed_at",
  )).rows[0].observed_at;
}

export class PostgresOperationAuditGatewayV1 {
  readonly #pool: Pool;
  readonly #cursorHmacKey: string;

  constructor(connectionString: string, cursorHmacKey: string) {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)
      || Buffer.byteLength(cursorHmacKey, "utf8") < 32) {
      throw new Error("OPERATION_AUDIT_CONFIGURATION_INVALID");
    }
    this.#pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3_000 });
    this.#cursorHmacKey = cursorHmacKey;
  }

  async close() { await this.#pool.end(); }

  async assertSchema() {
    const result = await this.#pool.query<{ audit: string | null }>(
      "SELECT to_regclass('public.dashboard_operation_audit_v1')::text AS audit",
    );
    if (!result.rows[0]?.audit) throw new Error("OPERATION_AUDIT_SCHEMA_UNAVAILABLE");
  }

  async read(input: OperationAuditFilterInputV1 = {}): Promise<OperationAuditPageV1> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const serverObservedAt = await observedAt(client);
      const { filterCut, pageSize, cursor: encodedCursor } = canonicalizeOperationAuditFilterCutV1(
        input,
        serverObservedAt.toISOString(),
      );
      const filterCutDigest = digest(filterCut);
      const cursor = encodedCursor ? decodeCursor(encodedCursor, this.#cursorHmacKey) : null;
      if (encodedCursor && !cursor) throw new Error("OPERATION_AUDIT_CURSOR_INVALID");
      if (cursor && (cursor.filter_cut_digest !== filterCutDigest
        || cursor.observed_at !== filterCut.observed_at)) {
        throw new Error("OPERATION_AUDIT_CURSOR_FILTER_MISMATCH");
      }
      const base = basePredicate(filterCut);
      const eligibleSql = `SELECT schema_version, audit_identity, observed_at, principal_ref,
                                  operation, action_kind, outcome, target_kind, target_identity,
                                  correlation_identity, receipt_identity, authorization_digest
                             FROM dashboard_operation_audit_v1
                            WHERE ${base.predicates.join(" AND ")}
                            ORDER BY observed_at DESC, audit_identity DESC
                            LIMIT ${RETENTION_LIMIT + 1}`;
      const eligibleRows = await client.query<AuditRow>(eligibleSql, base.values);
      const incomplete = eligibleRows.rows.length > RETENTION_LIMIT;
      const eligible = eligibleRows.rows.slice(0, RETENTION_LIMIT);
      let pageRows = eligible;
      if (cursor) {
        const lastTime = Date.parse(cursor.last_observed_at);
        pageRows = eligible.filter((row) => row.observed_at.getTime() < lastTime
          || (row.observed_at.getTime() === lastTime && row.audit_identity < cursor.last_audit_identity));
      }
      const hasNext = pageRows.length > pageSize;
      pageRows = pageRows.slice(0, pageSize);
      const entries = pageRows.map(rowToEntry);
      const allEntries = eligible.map(rowToEntry);
      const summary: OperationAuditSummaryV1 = {
        execute: allEntries.filter(({ action_kind }) => action_kind === "execute").length,
        create_update: allEntries.filter(({ action_kind }) => action_kind === "update").length,
        delete: allEntries.filter(({ action_kind }) => action_kind === "delete").length,
        succeeded: allEntries.filter(({ outcome }) => outcome === "succeeded").length,
        failed_denied: allEntries.filter(({ outcome }) => outcome === "failed" || outcome === "denied").length,
      };
      const optionBase = basePredicate({ ...filterCut, principal_ref: "all", operation: "all", outcome: "all", search: "" });
      const options = await client.query<{ principal_ref: string; operation: OperationAuditOperationV1 }>(
        `SELECT DISTINCT principal_ref, operation
           FROM dashboard_operation_audit_v1
          WHERE ${optionBase.predicates.join(" AND ")}`,
        optionBase.values,
      );
      await client.query("COMMIT");
      const last = entries.at(-1);
      const seen = (cursor?.seen ?? 0) + entries.length;
      return {
        schema_version: 1,
        projection_version: 1,
        operation: "dashboard.operation_audit.read.v1",
        availability: "available",
        unavailable_reason: null,
        completeness: incomplete ? "partial_unavailable" : "complete",
        observed_at: filterCut.observed_at,
        retention_limit: RETENTION_LIMIT,
        source_cut: sourceCut(entries),
        filter_cut: filterCut,
        filter_cut_digest: filterCutDigest,
        summary,
        principals: [...new Set(options.rows.map(({ principal_ref }) => principal_ref))].sort(),
        operations: [...new Set(options.rows.map(({ operation }) => operation))]
          .filter((operation) => operationAuditOperationsV1.includes(operation)).sort(),
        entries,
        page_size: pageSize,
        next_cursor: hasNext && last && seen < RETENTION_LIMIT ? encodeCursor({
          schema_version: 1,
          filter_cut_digest: filterCutDigest,
          observed_at: filterCut.observed_at,
          last_observed_at: last.observed_at,
          last_audit_identity: last.audit_identity,
          seen,
        }, this.#cursorHmacKey) : null,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readDetail(auditIdentity: string): Promise<OperationAuditDetailV1> {
    if (!AUDIT_IDENTITY.test(auditIdentity)) throw new Error("OPERATION_AUDIT_IDENTITY_INVALID");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const cut = await observedAt(client);
      const selected = await client.query<AuditRow>(
        `SELECT schema_version, audit_identity, observed_at, principal_ref, operation,
                action_kind, outcome, target_kind, target_identity, correlation_identity,
                receipt_identity, authorization_digest
           FROM dashboard_operation_audit_v1
          WHERE audit_identity = $1 AND observed_at <= $2`,
        [auditIdentity, cut],
      );
      if (!selected.rows[0]) throw new Error("AUDIT_EVENT_NOT_FOUND");
      const entry = rowToEntry(selected.rows[0]);
      const timelineRows = await client.query<AuditRow>(
        `SELECT schema_version, audit_identity, observed_at, principal_ref, operation,
                action_kind, outcome, target_kind, target_identity, correlation_identity,
                receipt_identity, authorization_digest
           FROM dashboard_operation_audit_v1
          WHERE correlation_identity = $1 AND observed_at <= $2
          ORDER BY observed_at, audit_identity
          LIMIT 257`,
        [entry.correlation_identity, cut],
      );
      if (timelineRows.rows.length > 256) throw new Error("OPERATION_AUDIT_TIMELINE_BOUND");
      const timeline = timelineRows.rows.map(rowToEntry);
      await client.query("COMMIT");
      return {
        schema_version: 1,
        projection_version: 1,
        operation: "dashboard.operation_audit.detail.read.v1",
        availability: "available",
        unavailable_reason: null,
        completeness: "complete",
        observed_at: cut.toISOString(),
        source_cut: sourceCut(timeline),
        entry,
        timeline,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

let configuredGateway: PostgresOperationAuditGatewayV1 | null | undefined;

export function configuredOperationAuditGatewayV1() {
  if (configuredGateway !== undefined) return configuredGateway;
  const databaseUrl = process.env.DASHBOARD_DATABASE_URL;
  const cursorKey = process.env.DASHBOARD_CURSOR_HMAC_KEY;
  configuredGateway = databaseUrl && cursorKey
    ? new PostgresOperationAuditGatewayV1(databaseUrl, cursorKey)
    : null;
  return configuredGateway;
}
