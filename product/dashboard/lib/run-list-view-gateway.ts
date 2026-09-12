import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import pg from "pg";

import { isRunListOperationBindingV1, isRunListOperationIdV1 } from "./run-list-contract.ts";
import {
  isRunListSearchInputV2,
  runListDurationsV2,
  runListKindsV2,
  runListPageSizesV2,
  runListStatesV2,
  type RunListDurationV2,
  type RunListFilterCutV2,
  type RunListItemV2,
  type RunListKindV2,
  type RunListPageSizeV2,
  type RunListStateV2,
  type RunListSummaryV2,
  type RunListViewEnvelopeV2,
} from "./run-list-view-contract.ts";
import { isRunIdentityV1, isRunTerminalCodeV1, type RunTerminalCodeV1 } from "./run-contract.ts";

const { Pool } = pg;
const RETENTION_LIMIT = 512;
const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,192}$/;

type RunListRow = pg.QueryResultRow & {
  run_identity: string;
  operation_id: string;
  run_kind: "owner_read" | "owner_effect";
  trigger_kind: RunListItemV2["trigger_kind"];
  state: RunListItemV2["state"];
  owner_outcome_state: RunListItemV2["owner_outcome_state"];
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  terminal_code: string | null;
  principal_ref: string | null;
};

type SnapshotV2 = {
  schema_version: 1;
  observed_at: string;
  filter_digest: string;
  source_cut: string;
};

export type RunListViewInputV2 = {
  kind?: string;
  state?: string;
  search?: string;
  duration?: string;
  pageSize?: number;
  page?: number;
  snapshot?: string;
};

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function sign(payload: string, key: string) {
  return createHmac("sha256", key).update(payload, "ascii").digest("base64url");
}

function encodeSnapshot(value: SnapshotV2, key: string) {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

function decodeSnapshot(value: string, key: string): SnapshotV2 | null {
  if (value.length < 32 || value.length > 4_096) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(sign(parts[0], key), "base64url");
    const decoded = Buffer.from(parts[0], "base64url");
    if (supplied.toString("base64url") !== parts[1]
      || decoded.toString("base64url") !== parts[0]
      || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
    if (Object.keys(parsed).sort().join(",") !== "filter_digest,observed_at,schema_version,source_cut"
      || parsed.schema_version !== 1
      || typeof parsed.observed_at !== "string" || new Date(parsed.observed_at).toISOString() !== parsed.observed_at
      || typeof parsed.filter_digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(parsed.filter_digest)
      || typeof parsed.source_cut !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(parsed.source_cut)) return null;
    return parsed as SnapshotV2;
  } catch {
    return null;
  }
}

export function canonicalRunListViewFilterV2(input: RunListViewInputV2 = {}): RunListFilterCutV2 {
  const kind = input.kind ?? "runs";
  const state = input.state ?? "all";
  const search = (input.search ?? "").trim().toLocaleLowerCase("en-US");
  const duration = input.duration ?? "any";
  const pageSize = input.pageSize ?? 50;
  const page = input.page ?? 1;
  if (!runListKindsV2.includes(kind as RunListKindV2)
    || !runListStatesV2.includes(state as RunListStateV2)
    || !isRunListSearchInputV2(search)
    || !runListDurationsV2.includes(duration as RunListDurationV2)
    || !runListPageSizesV2.includes(pageSize as RunListPageSizeV2)
    || !Number.isSafeInteger(page) || page < 1) throw new Error("RUN_LIST_QUERY_INVALID");
  return {
    schema_version: 1,
    kind: kind as RunListKindV2,
    state: state as RunListStateV2,
    search,
    duration: duration as RunListDurationV2,
    page_size: pageSize as RunListPageSizeV2,
    page,
  };
}

function durationMilliseconds(row: RunListRow) {
  if (!row.started_at) return null;
  return Math.max(0, (row.finished_at ?? row.updated_at).getTime() - row.started_at.getTime());
}

function durationMatches(value: number | null, filter: RunListDurationV2) {
  if (filter === "any") return true;
  if (value === null) return false;
  if (filter === "lt_1s") return value < 1_000;
  if (filter === "1_10s") return value >= 1_000 && value < 10_000;
  if (filter === "10_60s") return value >= 10_000 && value < 60_000;
  return value >= 60_000;
}

function projectRow(row: RunListRow, kind: RunListKindV2): RunListItemV2 {
  if (!isRunIdentityV1(row.run_identity) || !isRunListOperationIdV1(row.operation_id)
    || !["dashboard_bff", "dashboard_api", "dashboard_scheduler"].includes(row.trigger_kind)
    || !isRunListOperationBindingV1(
      row.operation_id,
      kind === "runs" ? "owner_effect" : "owner_read",
      row.trigger_kind,
    )
    || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(row.state)
    || !["available", "rejected", "unknown", "unavailable", "not_applicable"].includes(row.owner_outcome_state)
    || (row.terminal_code !== null && !isRunTerminalCodeV1(row.terminal_code))
    || (row.principal_ref !== null && !PRINCIPAL.test(row.principal_ref))) {
    throw new Error("RUN_LIST_ROW_INVALID");
  }
  const duration = durationMilliseconds(row);
  return {
    schema_version: 1,
    run_identity: row.run_identity,
    operation_id: row.operation_id,
    workload_kind: kind,
    trigger_kind: row.trigger_kind,
    state: row.state,
    owner_outcome_state: row.owner_outcome_state,
    effective_at: (row.started_at ?? row.created_at).toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    duration_ms: duration,
    path: row.operation_id,
    principal_ref: row.principal_ref,
    tag: null,
    concurrency_key_present: null,
    terminal_code: row.terminal_code as RunTerminalCodeV1 | null,
  };
}

function summarize(rows: readonly RunListItemV2[]): RunListSummaryV2 {
  const succeeded = rows.filter(({ state }) => state === "succeeded").length;
  const cancelled = rows.filter(({ state }) => state === "cancelled").length;
  return {
    queued: rows.filter(({ state }) => state === "queued").length,
    running: rows.filter(({ state }) => state === "running").length,
    unknown: rows.filter(({ state }) => state === "unknown").length,
    succeeded,
    cancelled,
    completed: succeeded + cancelled,
    failed: rows.filter(({ state }) => state === "failed").length,
  };
}

export class PostgresRunListViewGatewayV2 {
  readonly #pool: pg.Pool;
  readonly #cursorKey: string;

  constructor(connectionString: string, cursorKey: string) {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || Buffer.byteLength(cursorKey, "utf8") < 32) {
      throw new Error("RUN_LIST_CONFIGURATION_INVALID");
    }
    this.#pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3_000 });
    this.#cursorKey = cursorKey;
  }

  async close() { await this.#pool.end(); }

  async assertSchema() {
    const result = await this.#pool.query<{ runs: string | null; admissions: string | null; queue: string | null }>(
      `SELECT to_regclass('public.dashboard_operation_runs_v1')::text AS runs,
              to_regclass('public.dashboard_control_plane_admission_receipts_v1')::text AS admissions,
              to_regclass('public.dashboard_effect_dispatch_queue_v1')::text AS queue`,
    );
    if (!result.rows[0]?.runs || !result.rows[0]?.admissions || !result.rows[0]?.queue) {
      throw new Error("RUN_LIST_SCHEMA_UNAVAILABLE");
    }
  }

  async read(input: RunListViewInputV2 = {}): Promise<RunListViewEnvelopeV2> {
    const filterCut = canonicalRunListViewFilterV2(input);
    const stableFilter = { ...filterCut, page: 1 };
    const filterDigest = sha256(stableFilter);
    const prior = input.snapshot ? decodeSnapshot(input.snapshot, this.#cursorKey) : null;
    if (input.snapshot && !prior) throw new Error("RUN_LIST_SNAPSHOT_INVALID");
    if (prior && prior.filter_digest !== filterDigest) throw new Error("RUN_LIST_SNAPSHOT_FILTER_MISMATCH");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const observedAt = prior?.observed_at ?? (await client.query<{ observed_at: Date }>(
        "SELECT clock_timestamp() AS observed_at",
      )).rows[0].observed_at.toISOString();
      const runKind = filterCut.kind === "runs" ? "owner_effect" : "owner_read";
      const values: unknown[] = [observedAt, runKind];
      const predicates = ["r.created_at <= $1::timestamptz", "r.run_kind = $2"];
      if (filterCut.search) {
        values.push(`%${filterCut.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
        predicates.push(`(lower(r.operation_id) LIKE $${values.length} ESCAPE '\\'
          OR lower(r.run_identity) LIKE $${values.length} ESCAPE '\\')`);
      }
      const result = await client.query<RunListRow>(
        `SELECT r.run_identity, r.operation_id, r.run_kind, r.trigger_kind, r.state,
                r.owner_outcome_state, r.created_at, r.updated_at, r.started_at,
                r.finished_at, r.terminal_code,
                COALESCE(q.principal_ref, admission.principal_ref) AS principal_ref
           FROM dashboard_operation_runs_v1 r
           LEFT JOIN dashboard_effect_dispatch_queue_v1 q USING (run_identity)
           LEFT JOIN LATERAL (
             SELECT principal_ref
               FROM dashboard_control_plane_admission_receipts_v1 receipt
              WHERE receipt.run_identity = r.run_identity
              ORDER BY admitted_at, receipt_identity
              LIMIT 1
           ) admission ON true
          WHERE ${predicates.join(" AND ")}
          ORDER BY COALESCE(r.started_at, r.created_at) DESC, r.run_identity ASC
          LIMIT ${RETENTION_LIMIT + 1}`,
        values,
      );
      if (result.rows.length > RETENTION_LIMIT) throw new Error("RUN_LIST_RETENTION_BOUND");
      const projected = result.rows.map((row) => projectRow(row, filterCut.kind))
        .filter((row) => durationMatches(row.duration_ms, filterCut.duration));
      const sourceCut = sha256(projected);
      if (prior && prior.source_cut !== sourceCut) throw new Error("RUN_LIST_SNAPSHOT_STALE");
      const filtered = filterCut.state === "all"
        ? projected : projected.filter(({ state }) => state === filterCut.state);
      const totalPages = Math.max(1, Math.ceil(filtered.length / filterCut.page_size));
      if (filterCut.page > totalPages) throw new Error("RUN_LIST_PAGE_INVALID");
      const offset = (filterCut.page - 1) * filterCut.page_size;
      const snapshot = encodeSnapshot({
        schema_version: 1,
        observed_at: observedAt,
        filter_digest: filterDigest,
        source_cut: sourceCut,
      }, this.#cursorKey);
      await client.query("COMMIT");
      return {
        schema_version: 1,
        projection_version: 2,
        operation: "dashboard.run_store.list.v2",
        availability: "available",
        unavailable_reason: null,
        completeness: "complete",
        observed_at: observedAt,
        source_cut: sourceCut,
        snapshot,
        filter_cut: filterCut,
        summary: summarize(projected),
        filtered_total: filtered.length,
        total_pages: totalPages,
        runs: filtered.slice(offset, offset + filterCut.page_size),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

let configuredGateway: PostgresRunListViewGatewayV2 | null | undefined;

export function configuredRunListViewGatewayV2() {
  if (configuredGateway !== undefined) return configuredGateway;
  const databaseUrl = process.env.DASHBOARD_DATABASE_URL;
  const cursorKey = process.env.DASHBOARD_CURSOR_HMAC_KEY;
  configuredGateway = databaseUrl && cursorKey ? new PostgresRunListViewGatewayV2(databaseUrl, cursorKey) : null;
  return configuredGateway;
}
