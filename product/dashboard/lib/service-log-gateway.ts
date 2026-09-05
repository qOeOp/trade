import { createHash } from "node:crypto";

import { Pool, type QueryResultRow } from "pg";

import {
  compareServiceLogEntriesV1,
  serviceLogSourcesV1,
  type ServiceLogEntryV1,
  type ServiceLogEnvelopeV1,
  type ServiceLogInstanceV1,
  type ServiceLogSourceV1,
} from "./service-log-contract.ts";
import { isRunEventCodeV1, isRunIdentityV1 } from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const LIMIT = 512;
const LEVELS = ["info", "warning", "error"] as const;

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

type WorkerRow = QueryResultRow & {
  worker_identity: string;
  lease_expires_at: Date;
};

export class PostgresServiceLogGatewayV1 {
  readonly #pool: Pool;
  readonly #serverInstanceIdentity: string;

  constructor(connectionString: string, serverInstanceIdentity: string) {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !IDENTITY.test(serverInstanceIdentity)) {
      throw new Error("SERVICE_LOG_CONFIGURATION_INVALID");
    }
    this.#pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3_000 });
    this.#serverInstanceIdentity = serverInstanceIdentity;
  }

  async close() { await this.#pool.end(); }

  async read({ observedAt: requestedObservedAt }: { observedAt?: string } = {}): Promise<ServiceLogEnvelopeV1> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const cut = await client.query<{ observed_at: Date }>("SELECT statement_timestamp() AS observed_at");
      const currentObservedAt = cut.rows[0].observed_at;
      const requested = requestedObservedAt === undefined ? null : new Date(requestedObservedAt);
      if (requested && (!Number.isFinite(requested.getTime())
        || requested.toISOString() !== requestedObservedAt
        || requested > currentObservedAt)) {
        throw new Error("SERVICE_LOG_CUT_INVALID");
      }
      const observedAt = requested ?? currentObservedAt;
      const rows = await client.query<LogRow>(
        `SELECT l.run_identity AS correlation_identity, l.sequence, l.observed_at,
                l.level AS severity, l.source AS service, l.event_code,
                q.claimed_by, q.claim_attempt
           FROM dashboard_operation_run_logs_v1 l
           JOIN dashboard_operation_runs_v1 r USING (run_identity)
      LEFT JOIN dashboard_shadow_dispatch_queue_v1 q USING (run_identity)
          WHERE l.observed_at <= $1 AND r.retained_until > $1
          ORDER BY l.observed_at DESC, l.run_identity DESC, l.sequence DESC
          LIMIT $2`,
        [observedAt, LIMIT + 1],
      );
      const selected = rows.rows.slice(0, LIMIT);
      const workerIdentities = [...new Set(selected.flatMap((row) => (
        ["shadow_worker", "owner_gateway"].includes(row.service) && row.claimed_by ? [row.claimed_by] : []
      )))];
      const workerRows = workerIdentities.length
        ? await client.query<WorkerRow>(
          `SELECT worker_identity, lease_expires_at
             FROM dashboard_shadow_workers_v1
            WHERE worker_identity = ANY($1::text[])
            ORDER BY worker_identity`,
          [workerIdentities],
        ) : { rows: [] as WorkerRow[] };
      await client.query("COMMIT");

      const workers = new Map(workerRows.rows.map((row) => [row.worker_identity, row]));
      let incomplete = rows.rows.length > LIMIT;
      const entries: ServiceLogEntryV1[] = [];
      for (const row of selected.reverse()) {
        if (!isRunIdentityV1(row.correlation_identity) || !Number.isInteger(row.sequence)
          || row.sequence < 1 || row.sequence > 256
          || !(row.observed_at instanceof Date) || !Number.isFinite(row.observed_at.getTime())
          || row.observed_at > observedAt || !LEVELS.includes(row.severity)
          || !serviceLogSourcesV1.includes(row.service) || !isRunEventCodeV1(row.event_code)) {
          incomplete = true;
          continue;
        }
        const workerSource = row.service === "shadow_worker" || row.service === "owner_gateway";
        const instanceIdentity = workerSource ? row.claimed_by : this.#serverInstanceIdentity;
        const worker = instanceIdentity ? workers.get(instanceIdentity) : undefined;
        if (!instanceIdentity || !IDENTITY.test(instanceIdentity)
          || (row.service === "shadow_worker" && row.claim_attempt !== 1)
          || (workerSource && (!worker || instanceIdentity === this.#serverInstanceIdentity
            || !(worker.lease_expires_at instanceof Date)
            || !Number.isFinite(worker.lease_expires_at.getTime())))) {
          incomplete = true;
          continue;
        }
        entries.push({
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
      entries.sort(compareServiceLogEntriesV1);
      const byInstance = new Map<string, ServiceLogEntryV1[]>();
      for (const entry of entries) byInstance.set(entry.instance_identity, [...(byInstance.get(entry.instance_identity) ?? []), entry]);
      const instances: ServiceLogInstanceV1[] = [...byInstance].map(([identity, instanceEntries]): ServiceLogInstanceV1 => {
        const worker = workers.get(identity);
        const services = [...new Set(instanceEntries.map(({ service }) => service))]
          .sort((left, right) => serviceLogSourcesV1.indexOf(left) - serviceLogSourcesV1.indexOf(right));
        return {
          schema_version: 1,
          instance_identity: identity,
          instance_kind: worker ? "worker" : "server",
          readiness: worker ? (worker.lease_expires_at > observedAt ? "available" : "expired") : "observed",
          host_ref: null,
          services,
          source_cut: digest(instanceEntries),
          last_observed_at: instanceEntries.at(-1)?.observed_at ?? observedAt.toISOString(),
        };
      }).sort((left, right) => left.instance_identity < right.instance_identity
        ? -1 : left.instance_identity > right.instance_identity ? 1 : 0);
      return {
        schema_version: 1,
        operation: "dashboard.service_log_gateway.read.v1",
        availability: "available",
        unavailable_reason: null,
        completeness: incomplete ? "partial_unavailable" : "complete",
        observed_at: observedAt.toISOString(),
        retention_limit: LIMIT,
        instances,
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

function digest(entries: ServiceLogEntryV1[]) {
  return `sha256:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
}

let configuredGateway: PostgresServiceLogGatewayV1 | null | undefined;

export function configuredServiceLogGatewayV1() {
  if (configuredGateway !== undefined) return configuredGateway;
  const databaseUrl = process.env.DASHBOARD_DATABASE_URL;
  const serverInstanceIdentity = process.env.DASHBOARD_SERVER_INSTANCE_IDENTITY;
  if (!databaseUrl && !serverInstanceIdentity) configuredGateway = null;
  else if (!databaseUrl || !serverInstanceIdentity) throw new Error("SERVICE_LOG_CONFIGURATION_INVALID");
  else configuredGateway = new PostgresServiceLogGatewayV1(databaseUrl, serverInstanceIdentity);
  return configuredGateway;
}
