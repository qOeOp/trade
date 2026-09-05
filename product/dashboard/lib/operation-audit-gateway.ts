import { createHash } from "node:crypto";

import { Pool, type QueryResultRow } from "pg";

import {
  auditPhaseForEventV1,
  auditSourcesV1,
  compareOperationAuditEntriesV1,
  type OperationAuditEntryV1,
  type OperationAuditEnvelopeV1,
} from "./operation-audit-contract.ts";
import { isRunEventCodeV1, isRunIdentityV1 } from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const LIMIT = 512;

function sourceCut(entries: readonly OperationAuditEntryV1[]) {
  return `sha256:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
}

type AuditRow = QueryResultRow & Omit<OperationAuditEntryV1, "schema_version" | "phase" | "observed_at"> & {
  observed_at: Date;
};

export class PostgresOperationAuditGatewayV1 {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("OPERATION_AUDIT_CONFIGURATION_INVALID");
    this.#pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3_000 });
  }

  async close() { await this.#pool.end(); }

  async read(): Promise<OperationAuditEnvelopeV1> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const observedAt = (await client.query<{ observed_at: Date }>(
        "SELECT statement_timestamp() AS observed_at",
      )).rows[0].observed_at;
      const rows = await client.query<AuditRow>(
        `SELECT l.run_identity AS correlation_identity, l.sequence, l.observed_at,
                l.level AS severity, l.source, l.event_code, r.operation_id,
                r.trigger_kind, r.run_kind, r.state AS run_state, r.owner_outcome_state
           FROM dashboard_operation_run_logs_v1 l
           JOIN dashboard_operation_runs_v1 r USING (run_identity)
          WHERE l.observed_at <= $1 AND r.retained_until > $1
          ORDER BY l.observed_at DESC, l.run_identity DESC, l.sequence DESC
          LIMIT $2`,
        [observedAt, LIMIT + 1],
      );
      await client.query("COMMIT");
      let incomplete = rows.rows.length > LIMIT;
      const entries: OperationAuditEntryV1[] = [];
      for (const row of rows.rows.slice(0, LIMIT).reverse()) {
        if (!isRunIdentityV1(row.correlation_identity) || !Number.isInteger(row.sequence)
          || row.sequence < 1 || row.sequence > 256 || !(row.observed_at instanceof Date)
          || !Number.isFinite(row.observed_at.getTime()) || row.observed_at > observedAt
          || !["info", "warning", "error"].includes(row.severity)
          || !auditSourcesV1.includes(row.source) || !isRunEventCodeV1(row.event_code)
          || !IDENTITY.test(row.operation_id)
          || !["dashboard_bff", "dashboard_api", "dashboard_scheduler"].includes(row.trigger_kind)
          || !["owner_read", "owner_effect"].includes(row.run_kind)
          || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(row.run_state)
          || !["available", "rejected", "unknown", "unavailable", "not_applicable"].includes(row.owner_outcome_state)) {
          incomplete = true;
          continue;
        }
        entries.push({
          schema_version: 1,
          ...row,
          observed_at: row.observed_at.toISOString(),
          phase: auditPhaseForEventV1(row.event_code),
        });
      }
      entries.sort(compareOperationAuditEntriesV1);
      return {
        schema_version: 1,
        operation: "dashboard.operation_audit.read.v1",
        availability: "available",
        unavailable_reason: null,
        completeness: incomplete ? "partial_unavailable" : "complete",
        observed_at: observedAt.toISOString(),
        retention_limit: LIMIT,
        source_cut: sourceCut(entries),
        entries,
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
  configuredGateway = databaseUrl ? new PostgresOperationAuditGatewayV1(databaseUrl) : null;
  return configuredGateway;
}
