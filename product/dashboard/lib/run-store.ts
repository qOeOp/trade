import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  ARTIFACT_FORMATION_EXECUTE_OPERATION,
  artifactFormationOperationV1,
  artifactFormationRecoveryIdentityDigestV1,
  artifactFormationRegistryEntryDigestV1,
  canonicalArtifactFormationRecoveryIdentityV1,
  type ArtifactFormationExecutionAdmissionV1,
} from "./artifact-formation-operation.ts";
import {
  operationByIdV1,
  operationRegistryEntryDigestV1,
  operationRegistryV1,
  type OperationDispatchBindingV1,
  type RegisteredOperationId,
} from "./operation-registry.ts";
import {
  isRunEventCodeV1,
  isRunIdentityV1,
  isRunTerminalCodeV1,
  type RunEventCodeV1,
  type RunTerminalCodeV1,
} from "./run-contract.ts";
import {
  SOURCE_RESEARCH_EXECUTE_OPERATION,
  canonicalSourceResearchRecoveryIdentityV1,
  sourceResearchOperationManifestDigestV1,
  sourceResearchRecoveryIdentityDigestV1,
  sourceResearchRunOperationV1,
  unavailableSourceResearchRoutingAdmissionV1,
  validSourceResearchRoutingAdmissionV1,
  type SourceResearchRoutingAdmissionV1,
} from "./source-research-run-contract.ts";
import {
  operationalCacheDeletionReceiptIdentityV1,
  parseOperationalCacheDeletionReceiptV1,
  type OperationalCacheDeletionReceiptV1,
} from "./run-cache-deletion-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_CLAIM_ATTEMPTS = 3;

export { isRunIdentityV1 } from "./run-contract.ts";

export type RunOperationalState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export type OwnerOutcomeState = "available" | "rejected" | "unknown" | "unavailable" | "not_applicable";
export type OperationalOperationId = RegisteredOperationId
  | typeof ARTIFACT_FORMATION_EXECUTE_OPERATION
  | typeof SOURCE_RESEARCH_EXECUTE_OPERATION;

export type OperationRunV1 = {
  schema_version: 1;
  run_identity: string;
  operation_id: OperationalOperationId;
  channel: "DASHBOARD_SHADOW_READ" | "DASHBOARD_DISPOSABLE_EXECUTION";
  run_kind: "owner_read" | "owner_effect";
  trigger_kind: "dashboard_bff" | "dashboard_api" | "dashboard_scheduler";
  state: RunOperationalState;
  owner_outcome_state: OwnerOutcomeState;
  recovery_identity: Record<string, string>;
  recovery_identity_digest: string;
  transition_version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  retained_until: string;
  terminal_code: RunTerminalCodeV1 | null;
};

export type OperationRunLogV1 = {
  schema_version: 1;
  run_identity: string;
  sequence: number;
  observed_at: string;
  level: "info" | "warning" | "error";
  source: "run_store" | "dashboard_bff" | "owner_gateway" | "shadow_worker"
    | "artifact_orchestrator" | "source_research_orchestrator";
  event_code: RunEventCodeV1;
};

export type RunLogLevelFilterV1 = "all" | OperationRunLogV1["level"];
export type RunLogSourceFilterV1 = "all" | OperationRunLogV1["source"];
export type RunLogPageCutV1 = {
  observed_at: string;
  retained_until: string;
  logs: OperationRunLogV1[];
  next_cursor: string | null;
};

export type RunWorkerCompatibilityV1 = {
  schema_version: 1;
  availability: "available" | "unavailable" | "not_applicable";
  unavailable_reason: string | null;
  required_operation_id: RegisteredOperationId | null;
  claim_attempt: number | null;
  worker_identity: string | null;
  worker_artifact_digest: string | null;
  worker_lease_state: "available" | "expired" | null;
  claimed_at: string | null;
  completed_at: string | null;
};

export type RunDispatchBindingV1 = {
  schema_version: 1;
  availability: "available" | "unavailable" | "not_applicable";
  unavailable_reason: string | null;
  required_operation_id: RegisteredOperationId | null;
  dependency_operation_ids: RegisteredOperationId[];
  registry_entry_digest: string | null;
  compatibility_envelope_set_digest: string | null;
};

export type OperationRunDetailCutV1 = {
  observed_at: string;
  run: OperationRunV1;
  logs: OperationRunLogV1[];
  dispatch_binding: RunDispatchBindingV1;
  worker_compatibility: RunWorkerCompatibilityV1;
  cache_deletion_receipt: OperationalCacheDeletionReceiptV1 | null;
};

export type ShadowReadClaimV1 = {
  schema_version: 1;
  run: OperationRunV1 & {
    operation_id: RegisteredOperationId;
    channel: "DASHBOARD_SHADOW_READ";
    run_kind: "owner_read";
  };
  registry_entry_digest: string;
  compatibility_envelope_set_digest: string;
  claim_token: string;
  claim_attempt: number;
  lease_expires_at: string;
};

export type ShadowWorkerV1 = {
  schema_version: 1;
  worker_identity: string;
  operation_ids: RegisteredOperationId[];
  worker_artifact_digest: string;
  lease_state: "available" | "expired";
  registered_at: string;
  last_heartbeat_at: string;
  lease_expires_at: string;
  job_count: number;
  active_job_count: number;
  last_run_identity: string | null;
  last_run_state: RunOperationalState | null;
  last_run_at: string | null;
};

export type ShadowReadScheduleV1 = {
  schema_version: 1;
  schedule_identity: string;
  schedule_digest: string;
  operation_id: RegisteredOperationId;
  recovery_identity: Record<string, string>;
  recovery_identity_digest: string;
  cadence_seconds: number;
  anchor_at: string;
  next_due_at: string;
  last_due_at: string | null;
  last_run_identity: string | null;
  created_at: string;
  updated_at: string;
};

export type ShadowScheduleReadBindingV1 = {
  schedule_identity: string;
  schedule_digest: string;
  operation_id: RegisteredOperationId;
  dispatch_binding: OperationDispatchBindingV1;
};

export type ArtifactFormationExecutionModeV1 =
  | "FRESH_RUN"
  | "CONTINUE_CLAIMED_ONCE"
  | "RESOLVE_ONLY";

export type ArtifactFormationRunStartV1 = {
  schema_version: 1;
  run: OperationRunV1;
  execution_mode: ArtifactFormationExecutionModeV1;
};

export type SourceResearchRunStartV1 = {
  schema_version: 1;
  run: OperationRunV1;
  execution_mode: "FRESH_RUN" | "RESOLVE_ONLY";
};

export type SourceResearchRecoverySnapshotV1 = {
  schema_version: 1;
  run: OperationRunV1;
  requested_action: "RUN" | "RESOLVE";
  routing: SourceResearchRoutingAdmissionV1;
  observed_phases: readonly ("SOURCE_OWNER_AVAILABLE" | "RESEARCH_OWNER_AVAILABLE")[];
};

export type RunPageV1 = {
  schema_version: 1;
  operation: "dashboard.run_store.list.v1";
  availability: "available";
  observed_at: string;
  runs: OperationRunV1[];
  next_cursor: string | null;
};

type CursorV1 = {
  schema_version: 1;
  observed_cut: string;
  created_at: string;
  run_identity: string;
  operation_id: OperationalOperationId | null;
  state: RunOperationalState | null;
};

type RunLogCursorV1 = {
  schema_version: 1;
  observed_cut: string;
  run_identity: string;
  after_sequence: number;
  level: RunLogLevelFilterV1;
  source: RunLogSourceFilterV1;
  query: string;
};

type RunRow = QueryResultRow & {
  run_identity: string;
  schema_version: number;
  operation_id: string;
  channel: string;
  run_kind: string;
  trigger_kind: string;
  state: RunOperationalState;
  owner_outcome_state: OwnerOutcomeState;
  recovery_identity_json: Record<string, string>;
  recovery_identity_digest: string;
  transition_version: string | number;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  retained_until: Date;
  terminal_code: string | null;
};

type RunLogRow = QueryResultRow & {
  run_identity: string;
  sequence: number;
  observed_at: Date;
  level: OperationRunLogV1["level"];
  source: OperationRunLogV1["source"];
  event_code: string;
};

type CacheDeletionRow = QueryResultRow & {
  run_identity: string;
  schema_version: number;
  receipt_identity: string;
  prior_state: string;
  prior_transition_version: string | number;
  principal_ref: string;
  authorization_digest: string;
  deleted_at: Date;
};

function projectCacheDeletionReceiptV1(row: CacheDeletionRow): OperationalCacheDeletionReceiptV1 {
  const receipt = {
    schema_version: row.schema_version,
    operation: "dashboard.operational_cache.delete.v1",
    receipt_identity: row.receipt_identity,
    run_identity: row.run_identity,
    prior_state: row.prior_state,
    prior_transition_version: Number(row.prior_transition_version),
    principal_ref: row.principal_ref,
    authorization_digest: row.authorization_digest,
    deleted_at: row.deleted_at.toISOString(),
  };
  const parsed = parseOperationalCacheDeletionReceiptV1(receipt);
  if (!parsed) throw new Error("RUN_CACHE_DELETION_ROW_INVALID");
  return parsed;
}

function projectRunLogRowsV1(
  rows: readonly RunLogRow[],
  runIdentity: string,
  observedAt?: Date,
): OperationRunLogV1[] {
  return rows.map((row) => {
    if (!Number.isInteger(row.sequence) || row.sequence < 1 || row.sequence > 256
      || row.run_identity !== runIdentity || !isRunIdentityV1(row.run_identity)
      || (observedAt !== undefined && row.observed_at > observedAt)
      || !["info", "warning", "error"].includes(row.level)
      || !["run_store", "dashboard_bff", "owner_gateway", "shadow_worker",
        "artifact_orchestrator", "source_research_orchestrator"]
        .includes(row.source)
      || !isRunEventCodeV1(row.event_code)) throw new Error("RUN_STORE_LOG_ROW_INVALID");
    return {
      schema_version: 1,
      run_identity: row.run_identity,
      sequence: row.sequence,
      observed_at: row.observed_at.toISOString(),
      level: row.level,
      source: row.source,
      event_code: row.event_code,
    };
  });
}

type WorkerRow = QueryResultRow & {
  worker_identity: string;
  schema_version: number;
  capabilities_json: RegisteredOperationId[];
  capabilities_digest: string;
  worker_artifact_digest: string;
  registered_at: Date;
  last_heartbeat_at: Date;
  lease_expires_at: Date;
  observed_at: Date;
  job_count: number;
  active_job_count: number;
  last_run_identity: string | null;
  last_run_state: RunOperationalState | null;
  last_run_at: Date | null;
};

function projectShadowWorkerRowsV1(rows: readonly WorkerRow[], observedAt: Date): ShadowWorkerV1[] {
  return rows.map((row) => {
    const capabilities = canonicalCapabilitiesV1(row.capabilities_json);
    if (row.schema_version !== 1 || !IDENTITY.test(row.worker_identity) || !capabilities
      || capabilityDigestV1(capabilities) !== row.capabilities_digest
      || !DIGEST.test(row.worker_artifact_digest) || !Number.isInteger(row.job_count)
      || row.job_count < 0 || !Number.isInteger(row.active_job_count)
      || row.active_job_count < 0 || row.active_job_count > row.job_count
      || (row.last_run_identity === null) !== (row.last_run_state === null)
      || (row.last_run_identity === null) !== (row.last_run_at === null)
      || (row.job_count === 0) !== (row.last_run_identity === null)
      || (row.last_run_identity !== null && (!isRunIdentityV1(row.last_run_identity)
        || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(String(row.last_run_state))
        || !(row.last_run_at instanceof Date) || row.last_run_at > observedAt))) {
      throw new Error("WORKER_ROW_INVALID");
    }
    return {
      schema_version: 1 as const,
      worker_identity: row.worker_identity,
      operation_ids: capabilities,
      worker_artifact_digest: row.worker_artifact_digest,
      lease_state: row.lease_expires_at.getTime() > observedAt.getTime()
        ? "available" as const
        : "expired" as const,
      registered_at: row.registered_at.toISOString(),
      last_heartbeat_at: row.last_heartbeat_at.toISOString(),
      lease_expires_at: row.lease_expires_at.toISOString(),
      job_count: row.job_count,
      active_job_count: row.active_job_count,
      last_run_identity: row.last_run_identity,
      last_run_state: row.last_run_state,
      last_run_at: row.last_run_at?.toISOString() ?? null,
    };
  });
}

type RunWorkerBindingRow = QueryResultRow & {
  schema_version: number;
  registry_entry_digest: string | null;
  compatibility_envelope_set_digest: string | null;
  claim_attempt: number;
  claimed_by: string | null;
  claimed_at: Date | null;
  completed_at: Date | null;
  capabilities_json: RegisteredOperationId[] | null;
  capabilities_digest: string | null;
  worker_artifact_digest: string | null;
  lease_expires_at: Date | null;
};

type ScheduleRow = QueryResultRow & {
  schedule_identity: string;
  schema_version: number;
  schedule_digest: string;
  operation_id: string;
  recovery_identity_json: Record<string, string>;
  recovery_identity_digest: string;
  cadence_seconds: number;
  anchor_at: Date;
  next_due_at: Date;
  registry_entry_digest: string;
  compatibility_envelope_set_digest: string;
  last_due_at: Date | null;
  last_run_identity: string | null;
  created_at: Date;
  updated_at: Date;
};

function exactKeys(value: Record<string, string>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function canonicalRecoveryIdentityV1(
  operationId: OperationalOperationId,
  recoveryIdentity: Record<string, string>,
): Record<string, string> | null {
  if (operationId === ARTIFACT_FORMATION_EXECUTE_OPERATION) {
    return canonicalArtifactFormationRecoveryIdentityV1(recoveryIdentity);
  }
  if (operationId === SOURCE_RESEARCH_EXECUTE_OPERATION) {
    return canonicalSourceResearchRecoveryIdentityV1(recoveryIdentity);
  }
  const operation = operationByIdV1(operationId);
  if (!exactKeys(recoveryIdentity, operation.recovery_identity_fields)) return null;
  const canonical: Record<string, string> = {};
  for (const field of operation.recovery_identity_fields) {
    const value = recoveryIdentity[field];
    if (!IDENTITY.test(value)) return null;
    canonical[field] = value;
  }
  return canonical;
}

export function recoveryIdentityDigestV1(
  operationId: OperationalOperationId,
  recoveryIdentity: Record<string, string>,
): string | null {
  if (operationId === ARTIFACT_FORMATION_EXECUTE_OPERATION) {
    return artifactFormationRecoveryIdentityDigestV1(recoveryIdentity);
  }
  if (operationId === SOURCE_RESEARCH_EXECUTE_OPERATION) {
    return sourceResearchRecoveryIdentityDigestV1(recoveryIdentity);
  }
  const canonical = canonicalRecoveryIdentityV1(operationId, recoveryIdentity);
  if (!canonical) return null;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ operation_id: operationId, recovery_identity: canonical }))
    .digest("hex")}`;
}

function capabilityDigestV1(operationIds: readonly RegisteredOperationId[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(operationIds)).digest("hex")}`;
}

function canonicalDispatchBindingV1(
  operationId: RegisteredOperationId,
  binding: OperationDispatchBindingV1,
): OperationDispatchBindingV1 | null {
  if (!binding || Object.keys(binding).sort().join(",")
      !== "compatibility_envelope_set_digest,registry_entry_digest"
    || !DIGEST.test(binding.registry_entry_digest)
    || !DIGEST.test(binding.compatibility_envelope_set_digest)
    || binding.registry_entry_digest !== operationRegistryEntryDigestV1(operationId)) return null;
  return {
    registry_entry_digest: binding.registry_entry_digest,
    compatibility_envelope_set_digest: binding.compatibility_envelope_set_digest,
  };
}

function workerCapabilityDigestV1(capability: string): string | null {
  if (Buffer.byteLength(capability, "utf8") < 32 || Buffer.byteLength(capability, "utf8") > 4_096) return null;
  return `sha256:${createHash("sha256").update(capability).digest("hex")}`;
}

function sha256Token(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validOwnerOutcomeState(value: unknown): value is OwnerOutcomeState {
  return typeof value === "string"
    && ["available", "rejected", "unknown", "unavailable", "not_applicable"].includes(value);
}

function canonicalCapabilitiesV1(values: readonly RegisteredOperationId[]): RegisteredOperationId[] | null {
  const selected = new Set(values);
  if (selected.size !== values.length || selected.size < 1) return null;
  const canonical = operationRegistryOrderV1().filter((operationId) => selected.has(operationId));
  if (canonical.length !== selected.size
    || canonical.some((operationId) => operationByIdV1(operationId).effect_set.length !== 0)) return null;
  return canonical;
}

function operationRegistryOrderV1(): RegisteredOperationId[] {
  return operationRegistryV1.map(({ operation_id }) => operation_id);
}

function record(row: RunRow): OperationRunV1 {
  if (!operationalOperationId(row.operation_id)) throw new Error("RUN_STORE_ROW_INVALID");
  const operationId = row.operation_id;
  const recovery = canonicalRecoveryIdentityV1(
    operationId,
    row.recovery_identity_json,
  );
  const effectRun = operationId === ARTIFACT_FORMATION_EXECUTE_OPERATION
    || operationId === SOURCE_RESEARCH_EXECUTE_OPERATION;
  if (!isRunIdentityV1(row.run_identity) || row.schema_version !== 1
    || row.channel !== (effectRun ? "DASHBOARD_DISPOSABLE_EXECUTION" : "DASHBOARD_SHADOW_READ")
    || row.run_kind !== (effectRun ? "owner_effect" : "owner_read")
    || !["dashboard_bff", "dashboard_api", "dashboard_scheduler"].includes(row.trigger_kind)
    || !runState(row.state)
    || !["available", "rejected", "unknown", "unavailable", "not_applicable"]
      .includes(row.owner_outcome_state)
    || !recovery || (row.terminal_code !== null && !isRunTerminalCodeV1(row.terminal_code))
    || recoveryIdentityDigestV1(operationId, recovery)
      !== row.recovery_identity_digest) throw new Error("RUN_STORE_ROW_INVALID");
  const transitionVersion = Number(row.transition_version);
  if (!Number.isSafeInteger(transitionVersion) || transitionVersion < 1) {
    throw new Error("RUN_STORE_ROW_INVALID");
  }
  return {
    schema_version: 1,
    run_identity: row.run_identity,
    operation_id: operationId,
    channel: effectRun ? "DASHBOARD_DISPOSABLE_EXECUTION" : "DASHBOARD_SHADOW_READ",
    run_kind: effectRun ? "owner_effect" : "owner_read",
    trigger_kind: row.trigger_kind as OperationRunV1["trigger_kind"],
    state: row.state,
    owner_outcome_state: row.owner_outcome_state,
    recovery_identity: recovery,
    recovery_identity_digest: row.recovery_identity_digest,
    transition_version: transitionVersion,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
    retained_until: row.retained_until.toISOString(),
    terminal_code: row.terminal_code,
  };
}

function shadowReadRecord(row: RunRow): ShadowReadClaimV1["run"] {
  const value = record(row);
  if (value.operation_id === ARTIFACT_FORMATION_EXECUTE_OPERATION
    || value.operation_id === SOURCE_RESEARCH_EXECUTE_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ" || value.run_kind !== "owner_read") {
    throw new Error("SHADOW_READ_ROW_INVALID");
  }
  return value as ShadowReadClaimV1["run"];
}

function cursorSignature(payload: string, key: string): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

function encodeCursor(cursor: CursorV1, key: string): string {
  const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${payload}.${cursorSignature(payload, key).toString("base64url")}`;
}

function decodeCursor(value: string | undefined, key: string): CursorV1 | null {
  if (!value || value.length > 1_024) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) return null;
    const provided = Buffer.from(signature, "base64url");
    const expected = cursorSignature(payload, key);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cursor = parsed as Record<string, unknown>;
    if (Object.keys(cursor).sort().join(",")
        !== "created_at,observed_cut,operation_id,run_identity,schema_version,state"
      || cursor.schema_version !== 1 || typeof cursor.observed_cut !== "string"
      || typeof cursor.created_at !== "string" || typeof cursor.run_identity !== "string"
      || (cursor.operation_id !== null
        && !operationalOperationId(cursor.operation_id))
      || (cursor.state !== null && !runState(cursor.state))
      || !isRunIdentityV1(cursor.run_identity)
      || !Number.isFinite(Date.parse(cursor.observed_cut))
      || !Number.isFinite(Date.parse(cursor.created_at))) return null;
    return cursor as CursorV1;
  } catch {
    return null;
  }
}

function encodeRunLogCursor(cursor: RunLogCursorV1, key: string): string {
  const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${payload}.${cursorSignature(payload, key).toString("base64url")}`;
}

function decodeRunLogCursor(value: string | undefined, key: string): RunLogCursorV1 | null {
  if (!value || value.length > 1_024) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) return null;
    const provided = Buffer.from(signature, "base64url");
    const expected = cursorSignature(payload, key);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cursor = parsed as Record<string, unknown>;
    if (Object.keys(cursor).sort().join(",")
        !== "after_sequence,level,observed_cut,query,run_identity,schema_version,source"
      || cursor.schema_version !== 1 || !isRunIdentityV1(cursor.run_identity)
      || typeof cursor.observed_cut !== "string" || !Number.isFinite(Date.parse(cursor.observed_cut))
      || !Number.isInteger(cursor.after_sequence) || Number(cursor.after_sequence) < 1
      || Number(cursor.after_sequence) > 255
      || !["all", "info", "warning", "error"].includes(String(cursor.level))
      || !["all", "run_store", "dashboard_bff", "owner_gateway", "shadow_worker",
        "artifact_orchestrator", "source_research_orchestrator"]
        .includes(String(cursor.source))
      || typeof cursor.query !== "string" || !/^[A-Za-z0-9._:/ -]{0,64}$/.test(cursor.query)) return null;
    return cursor as RunLogCursorV1;
  } catch {
    return null;
  }
}

function operationRegistryId(value: unknown): value is RegisteredOperationId {
  if (typeof value !== "string") return false;
  try {
    operationByIdV1(value as RegisteredOperationId);
    return true;
  } catch {
    return false;
  }
}

function operationalOperationId(value: unknown): value is OperationalOperationId {
  return value === ARTIFACT_FORMATION_EXECUTE_OPERATION
    || value === SOURCE_RESEARCH_EXECUTE_OPERATION
    || operationRegistryId(value);
}

function operationalEffectSet(operationId: OperationalOperationId): readonly string[] {
  if (operationId === ARTIFACT_FORMATION_EXECUTE_OPERATION) {
    return artifactFormationOperationV1.effect_set;
  }
  if (operationId === SOURCE_RESEARCH_EXECUTE_OPERATION) {
    return sourceResearchRunOperationV1.effect_set;
  }
  return operationByIdV1(operationId).effect_set;
}

function operationalRecoveryFields(operationId: OperationalOperationId): readonly string[] {
  if (operationId === ARTIFACT_FORMATION_EXECUTE_OPERATION) {
    return artifactFormationOperationV1.recovery_identity_fields;
  }
  if (operationId === SOURCE_RESEARCH_EXECUTE_OPERATION) {
    return sourceResearchRunOperationV1.recovery_identity_fields;
  }
  return operationByIdV1(operationId).recovery_identity_fields;
}

function runState(value: unknown): value is RunOperationalState {
  return typeof value === "string"
    && ["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(value);
}

function scheduleRecord(row: ScheduleRow): ShadowReadScheduleV1 {
  const operationId = row.operation_id as RegisteredOperationId;
  operationByIdV1(operationId);
  const recovery = canonicalRecoveryIdentityV1(operationId, row.recovery_identity_json);
  if (!/^dashboard-schedule-v1-[0-9a-f]{64}$/.test(row.schedule_identity)
    || row.schema_version !== 1 || !DIGEST.test(row.schedule_digest) || !recovery
    || recoveryIdentityDigestV1(operationId, recovery) !== row.recovery_identity_digest
    || !Number.isInteger(row.cadence_seconds) || row.cadence_seconds < 60
    || row.cadence_seconds > 86_400 || !DIGEST.test(row.registry_entry_digest)
    || !DIGEST.test(row.compatibility_envelope_set_digest)
    || row.next_due_at.getTime() < row.anchor_at.getTime()
    || ((row.last_due_at === null) !== (row.last_run_identity === null))
    || (row.last_run_identity !== null && !isRunIdentityV1(row.last_run_identity))) {
    throw new Error("SCHEDULE_ROW_INVALID");
  }
  return {
    schema_version: 1,
    schedule_identity: row.schedule_identity,
    schedule_digest: row.schedule_digest,
    operation_id: operationId,
    recovery_identity: recovery,
    recovery_identity_digest: row.recovery_identity_digest,
    cadence_seconds: row.cadence_seconds,
    anchor_at: row.anchor_at.toISOString(),
    next_due_at: row.next_due_at.toISOString(),
    last_due_at: row.last_due_at?.toISOString() ?? null,
    last_run_identity: row.last_run_identity,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function appendLog(
  client: PoolClient,
  runIdentity: string,
  level: "info" | "warning" | "error",
  source: OperationRunLogV1["source"],
  eventCode: RunEventCodeV1,
) {
  if (!isRunEventCodeV1(eventCode)) throw new Error("RUN_LOG_CODE_INVALID");
  const sequence = await client.query<{ sequence: number }>(
    `SELECT COALESCE(MAX(sequence), 0)::int + 1 AS sequence
       FROM dashboard_operation_run_logs_v1
      WHERE run_identity = $1`,
    [runIdentity],
  );
  const next = sequence.rows[0]?.sequence;
  if (!Number.isInteger(next) || next < 1 || next > 256) throw new Error("RUN_LOG_BOUND");
  await client.query(
    `INSERT INTO dashboard_operation_run_logs_v1
       (run_identity, sequence, level, source, event_code, metadata)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
    [runIdentity, next, level, source, eventCode],
  );
}

async function recoverExpiredClaims(client: PoolClient) {
  const expired = await client.query<RunRow & { claim_attempt: number }>(
    `SELECT r.*, q.claim_attempt
       FROM dashboard_shadow_dispatch_queue_v1 q
       JOIN dashboard_operation_runs_v1 r USING (run_identity)
      WHERE r.state = 'running' AND q.completed_at IS NULL
        AND q.lease_expires_at <= clock_timestamp()
      ORDER BY q.lease_expires_at, q.run_identity
      LIMIT 16
      FOR UPDATE OF q, r SKIP LOCKED`,
  );
  for (const row of expired.rows) {
    if (row.claim_attempt >= MAX_CLAIM_ATTEMPTS) {
      await client.query(
        `UPDATE dashboard_operation_runs_v1
            SET state = 'unknown', owner_outcome_state = 'unknown', terminal_code = 'CLAIM_LIMIT_REACHED',
                transition_version = transition_version + 1, updated_at = clock_timestamp(),
                finished_at = clock_timestamp()
          WHERE run_identity = $1 AND state = 'running'`,
        [row.run_identity],
      );
      await client.query(
        `UPDATE dashboard_shadow_dispatch_queue_v1
            SET completed_at = clock_timestamp()
          WHERE run_identity = $1 AND completed_at IS NULL`,
        [row.run_identity],
      );
      await appendLog(client, row.run_identity, "error", "run_store", "CLAIM_LIMIT_REACHED");
    } else {
      await client.query(
        `UPDATE dashboard_operation_runs_v1
            SET state = 'queued', owner_outcome_state = 'unknown', terminal_code = NULL,
                transition_version = transition_version + 1, updated_at = clock_timestamp(),
                started_at = NULL, finished_at = NULL
          WHERE run_identity = $1 AND state = 'running'`,
        [row.run_identity],
      );
      await client.query(
        `UPDATE dashboard_shadow_dispatch_queue_v1
            SET claimed_by = NULL, claim_token_digest = NULL, lease_expires_at = NULL
          WHERE run_identity = $1 AND completed_at IS NULL`,
        [row.run_identity],
      );
      await appendLog(client, row.run_identity, "warning", "run_store", "LEASE_EXPIRED_REQUEUED");
    }
  }
}

export class PostgresRunStoreV1 {
  readonly #pool: Pool;
  readonly #cursorHmacKey: string;

  constructor(connectionString: string, cursorHmacKey: string) {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("RUN_STORE_CONFIGURATION_INVALID");
    }
    if (Buffer.byteLength(cursorHmacKey, "utf8") < 32) {
      throw new Error("RUN_STORE_CONFIGURATION_INVALID");
    }
    this.#pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 3_000 });
    this.#cursorHmacKey = cursorHmacKey;
  }

  async close() {
    await this.#pool.end();
  }

  async assertSchema() {
    const result = await this.#pool.query<{
      runs: string | null;
      logs: string | null;
      workers: string | null;
      queue: string | null;
      schedules: string | null;
      cache_deletions: string | null;
      queue_binding_columns: string | number;
    }>(
      `SELECT to_regclass('public.dashboard_operation_runs_v1')::text AS runs,
              to_regclass('public.dashboard_operation_run_logs_v1')::text AS logs,
              to_regclass('public.dashboard_shadow_workers_v1')::text AS workers,
              to_regclass('public.dashboard_shadow_dispatch_queue_v1')::text AS queue,
              to_regclass('public.dashboard_shadow_read_schedules_v1')::text AS schedules,
              to_regclass('public.dashboard_operation_run_cache_deletions_v1')::text AS cache_deletions,
              (SELECT COUNT(*)
                 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'dashboard_shadow_dispatch_queue_v1'
                  AND column_name IN (
                    'registry_entry_digest', 'compatibility_envelope_set_digest'
                  )) AS queue_binding_columns`,
    );
    if (!result.rows[0]?.runs || !result.rows[0]?.logs
      || !result.rows[0]?.workers || !result.rows[0]?.queue || !result.rows[0]?.schedules
      || !result.rows[0]?.cache_deletions
      || Number(result.rows[0]?.queue_binding_columns) !== 2) {
      throw new Error("RUN_STORE_SCHEMA_UNAVAILABLE");
    }
  }

  async assertArtifactFormationSchema() {
    await this.assertSchema();
    const result = await this.#pool.query<{ artifact_bindings: string | null }>(
      `SELECT to_regclass(
        'public.dashboard_artifact_formation_run_bindings_v1'
      )::text AS artifact_bindings`,
    );
    if (!result.rows[0]?.artifact_bindings) throw new Error("RUN_STORE_SCHEMA_UNAVAILABLE");
  }

  async beginArtifactFormation({
    action,
    recoveryIdentity,
    admission,
    existingRecoveryOnly = false,
  }: {
    action: "RUN" | "RESOLVE";
    recoveryIdentity: Record<string, string>;
    admission: Extract<ArtifactFormationExecutionAdmissionV1, { availability: "available" }>;
    existingRecoveryOnly?: boolean;
  }): Promise<ArtifactFormationRunStartV1> {
    const canonical = canonicalArtifactFormationRecoveryIdentityV1(recoveryIdentity);
    const recoveryDigest = artifactFormationRecoveryIdentityDigestV1(recoveryIdentity);
    const routing = admission.routing;
    const validAdmission = DIGEST.test(admission.registry_entry_digest)
      && admission.registry_entry_digest === artifactFormationRegistryEntryDigestV1()
      && DIGEST.test(admission.compatibility_envelope_digest)
      && (((action === "RUN" && !existingRecoveryOnly) && routing.state === "ACTIVE"
        && routing.dispatcher === "TRADE_DASHBOARD"
        && IDENTITY.test(routing.binding_identity)
        && DIGEST.test(routing.binding_digest)
        && Number.isSafeInteger(routing.generation) && routing.generation > 0)
      || ((action === "RESOLVE" || existingRecoveryOnly) && routing.state === "UNAVAILABLE"
        && routing.dispatcher === "NONE"));
    if (!canonical || !recoveryDigest || !validAdmission) {
      throw new Error("ARTIFACT_FORMATION_SUBMISSION_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [recoveryDigest]);
      const active = await client.query<RunRow & { continuation_count: number }>(
        `SELECT r.*, b.continuation_count
           FROM dashboard_operation_runs_v1 r
           JOIN dashboard_artifact_formation_run_bindings_v1 b USING (run_identity)
          WHERE r.operation_id = $1 AND r.recovery_identity_digest = $2
            AND r.state IN ('queued', 'running')
          FOR UPDATE OF r, b`,
        [ARTIFACT_FORMATION_EXECUTE_OPERATION, recoveryDigest],
      );
      const current = active.rows[0];
      if (current) {
        const continueOnce = action === "RUN" && current.continuation_count === 0;
        if (continueOnce) {
          const continued = await client.query(
            `UPDATE dashboard_artifact_formation_run_bindings_v1
                SET continuation_count = 1, updated_at = clock_timestamp()
              WHERE run_identity = $1 AND continuation_count = 0`,
            [current.run_identity],
          );
          if (continued.rowCount !== 1) throw new Error("ARTIFACT_FORMATION_RECOVERY_CONFLICT");
        }
        await client.query("COMMIT");
        return {
          schema_version: 1,
          run: record(current),
          execution_mode: continueOnce ? "CONTINUE_CLAIMED_ONCE" : "RESOLVE_ONLY",
        };
      }
      if (existingRecoveryOnly) throw new Error("ARTIFACT_FORMATION_RECOVERY_CONFLICT");
      const runIdentity = `dashboard-run-v1-${randomUUID()}`;
      const inserted = await client.query<RunRow>(
        `INSERT INTO dashboard_operation_runs_v1
           (run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
            owner_outcome_state, recovery_identity_json, recovery_identity_digest,
            transition_version, started_at)
         VALUES ($1, 1, $2, 'DASHBOARD_DISPOSABLE_EXECUTION', 'owner_effect',
                 'dashboard_bff', 'running', 'unknown', $3::jsonb, $4, 1, clock_timestamp())
         RETURNING *`,
        [runIdentity, ARTIFACT_FORMATION_EXECUTE_OPERATION, JSON.stringify(canonical), recoveryDigest],
      );
      await client.query(
        `INSERT INTO dashboard_artifact_formation_run_bindings_v1
           (run_identity, schema_version, requested_action, registry_entry_digest,
            compatibility_envelope_digest, routing_state, routing_dispatcher,
            routing_binding_identity, routing_binding_digest, routing_generation)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [runIdentity, action, admission.registry_entry_digest,
          admission.compatibility_envelope_digest, routing.state, routing.dispatcher,
          routing.binding_identity, routing.binding_digest, routing.generation],
      );
      await appendLog(client, runIdentity, "info", "artifact_orchestrator", "RUN_STARTED");
      await client.query("COMMIT");
      return { schema_version: 1, run: record(inserted.rows[0]), execution_mode: "FRESH_RUN" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveArtifactFormation(
    recoveryIdentity: Record<string, string>,
  ): Promise<OperationRunV1 | null> {
    const recoveryDigest = artifactFormationRecoveryIdentityDigestV1(recoveryIdentity);
    if (!canonicalArtifactFormationRecoveryIdentityV1(recoveryIdentity) || !recoveryDigest) {
      throw new Error("ARTIFACT_FORMATION_RECOVERY_INVALID");
    }
    const result = await this.#pool.query<RunRow>(
      `SELECT * FROM dashboard_operation_runs_v1
        WHERE operation_id = $1 AND recovery_identity_digest = $2
          AND state IN ('queued', 'running')
        ORDER BY created_at DESC, run_identity DESC LIMIT 1`,
      [ARTIFACT_FORMATION_EXECUTE_OPERATION, recoveryDigest],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async recordArtifactFormationPhase({
    runIdentity,
    expectedTransitionVersion,
    phase,
  }: {
    runIdentity: string;
    expectedTransitionVersion: number;
    phase: "OWNER_CLAIMED" | "INVOCATION_STARTED";
  }): Promise<OperationRunV1> {
    if (!isRunIdentityV1(runIdentity) || !Number.isSafeInteger(expectedTransitionVersion)
      || expectedTransitionVersion < 1) throw new Error("ARTIFACT_FORMATION_PHASE_INVALID");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<RunRow>(
        `SELECT r.* FROM dashboard_operation_runs_v1 r
           JOIN dashboard_artifact_formation_run_bindings_v1 b USING (run_identity)
          WHERE r.run_identity = $1 FOR UPDATE OF r`,
        [runIdentity],
      );
      const current = locked.rows[0];
      if (!current || current.operation_id !== ARTIFACT_FORMATION_EXECUTE_OPERATION
        || current.state !== "running") throw new Error("ARTIFACT_FORMATION_PHASE_CONFLICT");
      const events = await client.query<{ event_code: string }>(
        `SELECT event_code FROM dashboard_operation_run_logs_v1
          WHERE run_identity = $1 AND event_code IN ('OWNER_CLAIMED', 'INVOCATION_STARTED')`,
        [runIdentity],
      );
      const observed = new Set(events.rows.map(({ event_code }) => event_code));
      if (observed.has(phase)) {
        await client.query("COMMIT");
        return record(current);
      }
      if (Number(current.transition_version) !== expectedTransitionVersion
        || (phase === "INVOCATION_STARTED" && !observed.has("OWNER_CLAIMED"))) {
        throw new Error("ARTIFACT_FORMATION_PHASE_CONFLICT");
      }
      const updated = await client.query<RunRow>(
        `UPDATE dashboard_operation_runs_v1
            SET transition_version = transition_version + 1, updated_at = clock_timestamp()
          WHERE run_identity = $1 AND state = 'running' AND transition_version = $2
          RETURNING *`,
        [runIdentity, expectedTransitionVersion],
      );
      if (updated.rowCount !== 1) throw new Error("ARTIFACT_FORMATION_PHASE_CONFLICT");
      await appendLog(client, runIdentity, "info", "artifact_orchestrator", phase);
      await client.query("COMMIT");
      return record(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeArtifactFormation({
    runIdentity,
    expectedTransitionVersion,
    ownerOutcomeState,
    terminalCode,
  }: {
    runIdentity: string;
    expectedTransitionVersion: number;
    ownerOutcomeState: "available" | "rejected" | "unknown" | "unavailable";
    terminalCode:
      | "OWNER_AVAILABLE"
      | "OWNER_REJECTED"
      | "OWNER_UNKNOWN"
      | "OWNER_UNAVAILABLE"
      | "MANUAL_RECONCILIATION_REQUIRED";
  }): Promise<OperationRunV1> {
    const terminalState = terminalCode === "OWNER_AVAILABLE" ? "succeeded"
      : terminalCode === "OWNER_UNKNOWN" || terminalCode === "MANUAL_RECONCILIATION_REQUIRED"
        ? "unknown" : "failed";
    if (!isRunIdentityV1(runIdentity) || !Number.isSafeInteger(expectedTransitionVersion)
      || expectedTransitionVersion < 1
      || (terminalCode === "MANUAL_RECONCILIATION_REQUIRED" && ownerOutcomeState !== "unknown")) {
      throw new Error("ARTIFACT_FORMATION_COMPLETION_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<RunRow>(
        `UPDATE dashboard_operation_runs_v1
            SET state = $2, owner_outcome_state = $3, terminal_code = $4,
                transition_version = transition_version + 1,
                updated_at = clock_timestamp(), finished_at = clock_timestamp()
          WHERE run_identity = $1 AND operation_id = $5 AND state = 'running'
            AND transition_version = $6
          RETURNING *`,
        [runIdentity, terminalState, ownerOutcomeState, terminalCode,
          ARTIFACT_FORMATION_EXECUTE_OPERATION, expectedTransitionVersion],
      );
      if (updated.rowCount !== 1) throw new Error("ARTIFACT_FORMATION_COMPLETION_CONFLICT");
      await appendLog(
        client,
        runIdentity,
        terminalState === "succeeded" ? "info" : terminalState === "unknown" ? "warning" : "error",
        "artifact_orchestrator",
        terminalCode,
      );
      await client.query("COMMIT");
      return record(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async assertSourceResearchSchema() {
    await this.assertSchema();
    const result = await this.#pool.query<{ source_research_bindings: string | null }>(
      `SELECT to_regclass(
        'public.dashboard_source_research_run_bindings_v1'
      )::text AS source_research_bindings`,
    );
    if (!result.rows[0]?.source_research_bindings) {
      throw new Error("RUN_STORE_SCHEMA_UNAVAILABLE");
    }
  }

  async findActiveSourceResearch(
    recoveryIdentity: Record<string, string>,
  ): Promise<OperationRunV1 | null> {
    const recoveryDigest = sourceResearchRecoveryIdentityDigestV1(recoveryIdentity);
    if (!canonicalSourceResearchRecoveryIdentityV1(recoveryIdentity) || !recoveryDigest) {
      throw new Error("SOURCE_RESEARCH_RECOVERY_INVALID");
    }
    const result = await this.#pool.query<RunRow>(
      `SELECT * FROM dashboard_operation_runs_v1
        WHERE operation_id = $1 AND recovery_identity_digest = $2
          AND state IN ('queued', 'running')
        ORDER BY created_at DESC, run_identity DESC LIMIT 1`,
      [SOURCE_RESEARCH_EXECUTE_OPERATION, recoveryDigest],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async readSourceResearchRecovery(
    recoveryIdentity: Record<string, string>,
  ): Promise<SourceResearchRecoverySnapshotV1 | null> {
    const recoveryDigest = sourceResearchRecoveryIdentityDigestV1(recoveryIdentity);
    if (!canonicalSourceResearchRecoveryIdentityV1(recoveryIdentity) || !recoveryDigest) {
      throw new Error("SOURCE_RESEARCH_RECOVERY_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await client.query<RunRow & {
        requested_action: "RUN" | "RESOLVE";
        source_routing_state: "ACTIVE" | "UNAVAILABLE";
        source_routing_dispatcher: "TRADE_DASHBOARD" | "NONE";
        source_routing_binding_identity: string | null;
        source_routing_binding_digest: string | null;
        source_routing_generation: string | number | null;
        research_routing_state: "ACTIVE" | "UNAVAILABLE";
        research_routing_dispatcher: "TRADE_DASHBOARD" | "NONE";
        research_routing_binding_identity: string | null;
        research_routing_binding_digest: string | null;
        research_routing_generation: string | number | null;
      }>(
        `SELECT r.*, b.requested_action,
                b.source_routing_state, b.source_routing_dispatcher,
                b.source_routing_binding_identity, b.source_routing_binding_digest,
                b.source_routing_generation,
                b.research_routing_state, b.research_routing_dispatcher,
                b.research_routing_binding_identity, b.research_routing_binding_digest,
                b.research_routing_generation
          FROM dashboard_operation_runs_v1 r
           JOIN dashboard_source_research_run_bindings_v1 b USING (run_identity)
          WHERE r.operation_id = $1 AND r.recovery_identity_digest = $2
          ORDER BY r.created_at DESC, r.run_identity DESC LIMIT 1`,
        [SOURCE_RESEARCH_EXECUTE_OPERATION, recoveryDigest],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const logs = await client.query<{ event_code: string }>(
        `SELECT event_code FROM dashboard_operation_run_logs_v1
          WHERE run_identity = $1
            AND event_code IN ('SOURCE_OWNER_AVAILABLE', 'RESEARCH_OWNER_AVAILABLE')
          ORDER BY sequence`,
        [row.run_identity],
      );
      await client.query("COMMIT");
      let routing: SourceResearchRoutingAdmissionV1;
      if (row.requested_action === "RUN") {
        if (row.source_routing_state !== "ACTIVE"
          || row.source_routing_dispatcher !== "TRADE_DASHBOARD"
          || !row.source_routing_binding_identity || !row.source_routing_binding_digest
          || row.research_routing_state !== "ACTIVE"
          || row.research_routing_dispatcher !== "TRADE_DASHBOARD"
          || !row.research_routing_binding_identity || !row.research_routing_binding_digest) {
          throw new Error("SOURCE_RESEARCH_RECOVERY_INVALID");
        }
        routing = {
          source: {
            state: "ACTIVE", dispatcher: "TRADE_DASHBOARD",
            binding_identity: row.source_routing_binding_identity,
            binding_digest: row.source_routing_binding_digest,
            generation: Number(row.source_routing_generation),
          },
          research: {
            state: "ACTIVE", dispatcher: "TRADE_DASHBOARD",
            binding_identity: row.research_routing_binding_identity,
            binding_digest: row.research_routing_binding_digest,
            generation: Number(row.research_routing_generation),
          },
        };
      } else {
        routing = unavailableSourceResearchRoutingAdmissionV1();
      }
      if (!validSourceResearchRoutingAdmissionV1(row.requested_action, routing)) {
        throw new Error("SOURCE_RESEARCH_RECOVERY_INVALID");
      }
      return {
        schema_version: 1,
        run: record(row),
        requested_action: row.requested_action,
        routing,
        observed_phases: logs.rows.map(({ event_code }) => event_code) as
          SourceResearchRecoverySnapshotV1["observed_phases"],
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async beginSourceResearch({
    action,
    recoveryIdentity,
    routing,
    existingRecoveryOnly = false,
  }: {
    action: "RUN" | "RESOLVE";
    recoveryIdentity: Record<string, string>;
    routing: SourceResearchRoutingAdmissionV1;
    existingRecoveryOnly?: boolean;
  }): Promise<SourceResearchRunStartV1> {
    const canonical = canonicalSourceResearchRecoveryIdentityV1(recoveryIdentity);
    const recoveryDigest = sourceResearchRecoveryIdentityDigestV1(recoveryIdentity);
    if (!canonical || !recoveryDigest || !validSourceResearchRoutingAdmissionV1(action, routing)) {
      throw new Error("SOURCE_RESEARCH_SUBMISSION_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [recoveryDigest]);
      const prior = await client.query<RunRow>(
        `SELECT r.* FROM dashboard_operation_runs_v1 r
           JOIN dashboard_source_research_run_bindings_v1 b USING (run_identity)
          WHERE r.operation_id = $1 AND r.recovery_identity_digest = $2
          ORDER BY r.created_at DESC, r.run_identity DESC
          LIMIT 1 FOR UPDATE OF r, b`,
        [SOURCE_RESEARCH_EXECUTE_OPERATION, recoveryDigest],
      );
      const current = prior.rows[0];
      if (current && ["queued", "running"].includes(current.state)) {
        await client.query("COMMIT");
        return { schema_version: 1, run: record(current), execution_mode: "RESOLVE_ONLY" };
      }
      if (current && (existingRecoveryOnly || action === "RUN")) {
        throw new Error("SOURCE_RESEARCH_IDENTITY_REUSED");
      }
      if (existingRecoveryOnly) throw new Error("SOURCE_RESEARCH_RECOVERY_CONFLICT");
      const runIdentity = `dashboard-run-v1-${randomUUID()}`;
      const inserted = await client.query<RunRow>(
        `INSERT INTO dashboard_operation_runs_v1
           (run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
            owner_outcome_state, recovery_identity_json, recovery_identity_digest,
            transition_version, started_at)
         VALUES ($1, 1, $2, 'DASHBOARD_DISPOSABLE_EXECUTION', 'owner_effect',
                 'dashboard_bff', 'running', 'unknown', $3::jsonb, $4, 1, clock_timestamp())
         RETURNING *`,
        [runIdentity, SOURCE_RESEARCH_EXECUTE_OPERATION, JSON.stringify(canonical), recoveryDigest],
      );
      const source = routing.source;
      const research = routing.research;
      await client.query(
        `INSERT INTO dashboard_source_research_run_bindings_v1
           (run_identity, schema_version, requested_action, operation_manifest_digest,
            source_routing_state, source_routing_dispatcher, source_routing_binding_identity,
            source_routing_binding_digest, source_routing_generation,
            research_routing_state, research_routing_dispatcher, research_routing_binding_identity,
            research_routing_binding_digest, research_routing_generation)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [runIdentity, action, sourceResearchOperationManifestDigestV1(),
          source.state, source.dispatcher, source.binding_identity, source.binding_digest,
          source.generation, research.state, research.dispatcher, research.binding_identity,
          research.binding_digest, research.generation],
      );
      await appendLog(client, runIdentity, "info", "source_research_orchestrator", "RUN_STARTED");
      await client.query("COMMIT");
      return { schema_version: 1, run: record(inserted.rows[0]), execution_mode: "FRESH_RUN" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordSourceResearchPhase({
    runIdentity,
    expectedTransitionVersion,
    phase,
  }: {
    runIdentity: string;
    expectedTransitionVersion: number;
    phase: "SOURCE_OWNER_AVAILABLE" | "RESEARCH_OWNER_AVAILABLE";
  }): Promise<OperationRunV1> {
    if (!isRunIdentityV1(runIdentity) || !Number.isSafeInteger(expectedTransitionVersion)
      || expectedTransitionVersion < 1) throw new Error("SOURCE_RESEARCH_PHASE_INVALID");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<RunRow>(
        `SELECT r.* FROM dashboard_operation_runs_v1 r
           JOIN dashboard_source_research_run_bindings_v1 b USING (run_identity)
          WHERE r.run_identity = $1 FOR UPDATE OF r`,
        [runIdentity],
      );
      const current = locked.rows[0];
      if (!current || current.operation_id !== SOURCE_RESEARCH_EXECUTE_OPERATION
        || current.state !== "running") throw new Error("SOURCE_RESEARCH_PHASE_CONFLICT");
      const events = await client.query<{ event_code: string }>(
        `SELECT event_code FROM dashboard_operation_run_logs_v1
          WHERE run_identity = $1
            AND event_code IN ('SOURCE_OWNER_AVAILABLE', 'RESEARCH_OWNER_AVAILABLE')`,
        [runIdentity],
      );
      const observed = new Set(events.rows.map(({ event_code }) => event_code));
      if (observed.has(phase)) {
        await client.query("COMMIT");
        return record(current);
      }
      if (Number(current.transition_version) !== expectedTransitionVersion
        || (phase === "RESEARCH_OWNER_AVAILABLE"
          && !observed.has("SOURCE_OWNER_AVAILABLE"))) {
        throw new Error("SOURCE_RESEARCH_PHASE_CONFLICT");
      }
      const updated = await client.query<RunRow>(
        `UPDATE dashboard_operation_runs_v1
            SET transition_version = transition_version + 1, updated_at = clock_timestamp()
          WHERE run_identity = $1 AND state = 'running' AND transition_version = $2
          RETURNING *`,
        [runIdentity, expectedTransitionVersion],
      );
      if (updated.rowCount !== 1) throw new Error("SOURCE_RESEARCH_PHASE_CONFLICT");
      await appendLog(client, runIdentity, "info", "source_research_orchestrator", phase);
      await client.query("COMMIT");
      return record(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeSourceResearch({
    runIdentity,
    expectedTransitionVersion,
    ownerOutcomeState,
  }: {
    runIdentity: string;
    expectedTransitionVersion: number;
    ownerOutcomeState: "available" | "rejected";
  }): Promise<OperationRunV1> {
    if (!isRunIdentityV1(runIdentity) || !Number.isSafeInteger(expectedTransitionVersion)
      || expectedTransitionVersion < 1) throw new Error("SOURCE_RESEARCH_COMPLETION_INVALID");
    const terminalCode = ownerOutcomeState === "available" ? "OWNER_AVAILABLE" : "OWNER_REJECTED";
    const terminalState = ownerOutcomeState === "available" ? "succeeded" : "failed";
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const phases = await client.query<{ event_code: string }>(
        `SELECT event_code FROM dashboard_operation_run_logs_v1
          WHERE run_identity = $1
            AND event_code IN ('SOURCE_OWNER_AVAILABLE', 'RESEARCH_OWNER_AVAILABLE')
          FOR SHARE`,
        [runIdentity],
      );
      const observed = new Set(phases.rows.map(({ event_code }) => event_code));
      if (!observed.has("SOURCE_OWNER_AVAILABLE") || !observed.has("RESEARCH_OWNER_AVAILABLE")) {
        throw new Error("SOURCE_RESEARCH_COMPLETION_CONFLICT");
      }
      const updated = await client.query<RunRow>(
        `UPDATE dashboard_operation_runs_v1
            SET state = $2, owner_outcome_state = $3, terminal_code = $4,
                transition_version = transition_version + 1,
                updated_at = clock_timestamp(), finished_at = clock_timestamp()
          WHERE run_identity = $1 AND operation_id = $5 AND state = 'running'
            AND transition_version = $6
          RETURNING *`,
        [runIdentity, terminalState, ownerOutcomeState, terminalCode,
          SOURCE_RESEARCH_EXECUTE_OPERATION, expectedTransitionVersion],
      );
      if (updated.rowCount !== 1) throw new Error("SOURCE_RESEARCH_COMPLETION_CONFLICT");
      await appendLog(
        client,
        runIdentity,
        terminalState === "succeeded" ? "info" : "error",
        "source_research_orchestrator",
        terminalCode,
      );
      await client.query("COMMIT");
      return record(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async registerShadowWorker({
    workerIdentity,
    operationIds,
    workerCapability,
    workerArtifactDigest,
    leaseMilliseconds = 30_000,
  }: {
    workerIdentity: string;
    operationIds: readonly RegisteredOperationId[];
    workerCapability: string;
    workerArtifactDigest: string;
    leaseMilliseconds?: number;
  }): Promise<void> {
    const capabilities = canonicalCapabilitiesV1(operationIds);
    const workerCapabilityDigest = workerCapabilityDigestV1(workerCapability);
    if (!IDENTITY.test(workerIdentity) || !capabilities || !workerCapabilityDigest
      || !DIGEST.test(workerArtifactDigest) || !Number.isSafeInteger(leaseMilliseconds)
      || leaseMilliseconds < 5_000 || leaseMilliseconds > 300_000) {
      throw new Error("WORKER_REGISTRATION_INVALID");
    }
    const result = await this.#pool.query(
      `INSERT INTO dashboard_shadow_workers_v1
         (worker_identity, schema_version, capabilities_json, capabilities_digest,
          worker_artifact_digest, worker_capability_digest, lease_expires_at)
       VALUES ($1, 1, $2::jsonb, $3, $4, $5, clock_timestamp() + $6::int * interval '1 millisecond')
       ON CONFLICT (worker_identity) DO UPDATE
         SET last_heartbeat_at = clock_timestamp(),
             lease_expires_at = clock_timestamp() + $6::int * interval '1 millisecond'
       WHERE dashboard_shadow_workers_v1.capabilities_digest = EXCLUDED.capabilities_digest
         AND dashboard_shadow_workers_v1.worker_artifact_digest = EXCLUDED.worker_artifact_digest
         AND dashboard_shadow_workers_v1.worker_capability_digest = EXCLUDED.worker_capability_digest
       RETURNING worker_identity`,
      [workerIdentity, JSON.stringify(capabilities), capabilityDigestV1(capabilities),
        workerArtifactDigest, workerCapabilityDigest, leaseMilliseconds],
    );
    if (result.rowCount !== 1) throw new Error("WORKER_REGISTRATION_CONFLICT");
  }

  async heartbeatShadowWorker({
    workerIdentity,
    workerCapability,
    leaseMilliseconds = 30_000,
  }: {
    workerIdentity: string;
    workerCapability: string;
    leaseMilliseconds?: number;
  }): Promise<void> {
    const workerCapabilityDigest = workerCapabilityDigestV1(workerCapability);
    if (!IDENTITY.test(workerIdentity) || !workerCapabilityDigest
      || !Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 5_000
      || leaseMilliseconds > 300_000) throw new Error("WORKER_HEARTBEAT_INVALID");
    const result = await this.#pool.query(
      `UPDATE dashboard_shadow_workers_v1
          SET last_heartbeat_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + $3::int * interval '1 millisecond'
        WHERE worker_identity = $1 AND worker_capability_digest = $2
        RETURNING worker_identity`,
      [workerIdentity, workerCapabilityDigest, leaseMilliseconds],
    );
    if (result.rowCount !== 1) throw new Error("WORKER_UNAVAILABLE");
  }

  async #readShadowWorkerCut(
    workerIdentity: string | null,
  ): Promise<{ observed_at: string; workers: ShadowWorkerV1[] }> {
    const result = await this.#pool.query<WorkerRow>(
      `SELECT worker_identity, schema_version, capabilities_json, capabilities_digest,
              worker_artifact_digest, registered_at, last_heartbeat_at, lease_expires_at,
              cut.observed_at, stats.job_count, stats.active_job_count,
              stats.last_run_identity, stats.last_run_state, stats.last_run_at
         FROM dashboard_shadow_workers_v1 w
   CROSS JOIN (SELECT statement_timestamp() AS observed_at) cut
    LEFT JOIN LATERAL (
               SELECT COUNT(*)::int AS job_count,
                      COUNT(*) FILTER (WHERE r.state = 'running' AND q.completed_at IS NULL)::int
                        AS active_job_count,
                      (ARRAY_AGG(r.run_identity ORDER BY q.claimed_at DESC, r.run_identity DESC))[1]
                        AS last_run_identity,
                      (ARRAY_AGG(r.state ORDER BY q.claimed_at DESC, r.run_identity DESC))[1]
                        AS last_run_state,
                      (ARRAY_AGG(q.claimed_at ORDER BY q.claimed_at DESC, r.run_identity DESC))[1]
                        AS last_run_at
                 FROM dashboard_shadow_dispatch_queue_v1 q
                 JOIN dashboard_operation_runs_v1 r USING (run_identity)
                WHERE q.claimed_by = w.worker_identity
              ) stats ON TRUE
        WHERE ($1::text IS NULL OR w.worker_identity = $1)
        ORDER BY worker_identity
        LIMIT $2`,
      [workerIdentity, workerIdentity === null ? 100 : 1],
    );
    const observedAt = result.rows[0]?.observed_at ?? (await this.#pool.query<{ observed_at: Date }>(
      "SELECT clock_timestamp() AS observed_at",
    )).rows[0].observed_at;
    const workers = projectShadowWorkerRowsV1(result.rows, observedAt);
    return { observed_at: observedAt.toISOString(), workers };
  }

  async listShadowWorkers(): Promise<{ observed_at: string; workers: ShadowWorkerV1[] }> {
    return this.#readShadowWorkerCut(null);
  }

  async readShadowWorker(
    workerIdentity: string,
  ): Promise<{ observed_at: string; worker: ShadowWorkerV1 | null }> {
    if (!IDENTITY.test(workerIdentity)) throw new Error("WORKER_IDENTITY_INVALID");
    const cut = await this.#readShadowWorkerCut(workerIdentity);
    return { observed_at: cut.observed_at, worker: cut.workers[0] ?? null };
  }

  async enqueueRead(
    operationId: RegisteredOperationId,
    recoveryIdentity: Record<string, string>,
    dispatchBinding: OperationDispatchBindingV1,
  ): Promise<OperationRunV1> {
    const canonical = canonicalRecoveryIdentityV1(operationId, recoveryIdentity);
    const digest = recoveryIdentityDigestV1(operationId, recoveryIdentity);
    const binding = canonicalDispatchBindingV1(operationId, dispatchBinding);
    if (!canonical || !digest || !binding
      || operationByIdV1(operationId).effect_set.length !== 0) {
      throw new Error("RUN_STORE_SUBMISSION_INVALID");
    }
    const runIdentity = `dashboard-run-v1-${randomUUID()}`;
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<RunRow>(
        `INSERT INTO dashboard_operation_runs_v1
           (run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
            owner_outcome_state, recovery_identity_json, recovery_identity_digest, transition_version)
         VALUES ($1, 1, $2, 'DASHBOARD_SHADOW_READ', 'owner_read', 'dashboard_api', 'queued',
                 'unknown', $3::jsonb, $4, 1)
         RETURNING *`,
        [runIdentity, operationId, JSON.stringify(canonical), digest],
      );
      await client.query(
        `INSERT INTO dashboard_shadow_dispatch_queue_v1
           (run_identity, schema_version, registry_entry_digest, compatibility_envelope_set_digest)
         VALUES ($1, 1, $2, $3)`,
        [runIdentity, binding.registry_entry_digest, binding.compatibility_envelope_set_digest],
      );
      await appendLog(client, runIdentity, "info", "run_store", "RUN_QUEUED");
      await client.query("COMMIT");
      return record(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async tickScheduledRead({
    scheduleIdentity,
    scheduleDigest,
    operationId,
    recoveryIdentity,
    cadenceSeconds,
    anchorEpochMs,
    dispatchBinding,
  }: {
    scheduleIdentity: string;
    scheduleDigest: string;
    operationId: RegisteredOperationId;
    recoveryIdentity: Record<string, string>;
    cadenceSeconds: number;
    anchorEpochMs: number;
    dispatchBinding: OperationDispatchBindingV1;
  }): Promise<{ schedule: ShadowReadScheduleV1; run: OperationRunV1 | null }> {
    const canonical = canonicalRecoveryIdentityV1(operationId, recoveryIdentity);
    const recoveryDigest = recoveryIdentityDigestV1(operationId, recoveryIdentity);
    const binding = canonicalDispatchBindingV1(operationId, dispatchBinding);
    if (!/^dashboard-schedule-v1-[0-9a-f]{64}$/.test(scheduleIdentity)
      || !DIGEST.test(scheduleDigest) || !canonical || !recoveryDigest || !binding
      || operationByIdV1(operationId).effect_set.length !== 0
      || !Number.isInteger(cadenceSeconds) || cadenceSeconds < 60 || cadenceSeconds > 86_400
      || !Number.isSafeInteger(anchorEpochMs) || anchorEpochMs < 0) {
      throw new Error("SCHEDULE_SUBMISSION_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO dashboard_shadow_read_schedules_v1
           (schedule_identity, schema_version, schedule_digest, operation_id,
            recovery_identity_json, recovery_identity_digest, cadence_seconds, anchor_at,
            next_due_at, registry_entry_digest, compatibility_envelope_set_digest)
         VALUES ($1, 1, $2, $3, $4::jsonb, $5, $6, to_timestamp($7::double precision / 1000),
                 to_timestamp($7::double precision / 1000), $8, $9)
         ON CONFLICT (schedule_identity) DO NOTHING`,
        [scheduleIdentity, scheduleDigest, operationId, JSON.stringify(canonical), recoveryDigest,
          cadenceSeconds, anchorEpochMs, binding.registry_entry_digest,
          binding.compatibility_envelope_set_digest],
      );
      const locked = await client.query<ScheduleRow & { observed_at: Date }>(
        `SELECT *, clock_timestamp() AS observed_at
           FROM dashboard_shadow_read_schedules_v1
          WHERE schedule_identity = $1
          FOR UPDATE`,
        [scheduleIdentity],
      );
      const current = locked.rows[0];
      if (!current || current.schedule_digest !== scheduleDigest
        || current.operation_id !== operationId
        || current.recovery_identity_digest !== recoveryDigest
        || current.cadence_seconds !== cadenceSeconds
        || current.anchor_at.getTime() !== anchorEpochMs
        || current.registry_entry_digest !== binding.registry_entry_digest
        || current.compatibility_envelope_set_digest
          !== binding.compatibility_envelope_set_digest) {
        throw new Error("SCHEDULE_BINDING_CONFLICT");
      }
      if (current.next_due_at.getTime() > current.observed_at.getTime()) {
        await client.query("COMMIT");
        return { schedule: scheduleRecord(current), run: null };
      }
      const scheduledFor = current.next_due_at;
      const cadenceMs = cadenceSeconds * 1_000;
      const elapsed = current.observed_at.getTime() - scheduledFor.getTime();
      const nextDue = new Date(scheduledFor.getTime() + (Math.floor(elapsed / cadenceMs) + 1) * cadenceMs);
      if (!Number.isFinite(nextDue.getTime()) || nextDue.getTime() <= current.observed_at.getTime()) {
        throw new Error("SCHEDULE_TIME_INVALID");
      }
      const runIdentity = `dashboard-run-v1-${randomUUID()}`;
      const inserted = await client.query<RunRow>(
        `INSERT INTO dashboard_operation_runs_v1
           (run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
            owner_outcome_state, recovery_identity_json, recovery_identity_digest, transition_version)
         VALUES ($1, 1, $2, 'DASHBOARD_SHADOW_READ', 'owner_read', 'dashboard_scheduler', 'queued',
                 'unknown', $3::jsonb, $4, 1)
         RETURNING *`,
        [runIdentity, operationId, JSON.stringify(canonical), recoveryDigest],
      );
      await client.query(
        `INSERT INTO dashboard_shadow_dispatch_queue_v1
           (run_identity, schema_version, registry_entry_digest, compatibility_envelope_set_digest)
         VALUES ($1, 1, $2, $3)`,
        [runIdentity, binding.registry_entry_digest, binding.compatibility_envelope_set_digest],
      );
      await appendLog(client, runIdentity, "info", "run_store", "RUN_QUEUED");
      const updated = await client.query<ScheduleRow>(
        `UPDATE dashboard_shadow_read_schedules_v1
            SET last_due_at = $2, last_run_identity = $3, next_due_at = $4,
                updated_at = clock_timestamp()
          WHERE schedule_identity = $1
          RETURNING *`,
        [scheduleIdentity, scheduledFor, runIdentity, nextDue],
      );
      await client.query("COMMIT");
      return { schedule: scheduleRecord(updated.rows[0]), run: record(inserted.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listScheduledReads(): Promise<{ observed_at: string; schedules: ShadowReadScheduleV1[] }> {
    const result = await this.#pool.query<ScheduleRow & { observed_at: Date }>(
      `SELECT *, clock_timestamp() AS observed_at
         FROM dashboard_shadow_read_schedules_v1
        ORDER BY schedule_identity
        LIMIT 100`,
    );
    const observedAt = result.rows[0]?.observed_at ?? (await this.#pool.query<{ observed_at: Date }>(
      "SELECT clock_timestamp() AS observed_at",
    )).rows[0].observed_at;
    return {
      observed_at: observedAt.toISOString(),
      schedules: result.rows.map(scheduleRecord),
    };
  }

  async readBoundScheduledReads(
    bindings: readonly ShadowScheduleReadBindingV1[],
  ): Promise<{ observed_at: string; schedules: ShadowReadScheduleV1[] }> {
    if (bindings.length < 1 || bindings.length > 100) throw new Error("SCHEDULE_QUERY_INVALID");
    const identities = new Set<string>();
    const expected = new Map<string, ShadowScheduleReadBindingV1>();
    for (const binding of bindings) {
      const dispatch = canonicalDispatchBindingV1(binding.operation_id, binding.dispatch_binding);
      if (!/^dashboard-schedule-v1-[0-9a-f]{64}$/.test(binding.schedule_identity)
        || !DIGEST.test(binding.schedule_digest) || !dispatch
        || identities.has(binding.schedule_identity)) throw new Error("SCHEDULE_QUERY_INVALID");
      identities.add(binding.schedule_identity);
      expected.set(binding.schedule_identity, { ...binding, dispatch_binding: dispatch });
    }
    const result = await this.#pool.query<ScheduleRow & { observed_at: Date }>(
      `SELECT *, clock_timestamp() AS observed_at
         FROM dashboard_shadow_read_schedules_v1
        WHERE schedule_identity = ANY($1::text[])
        ORDER BY schedule_identity`,
      [[...identities]],
    );
    if (result.rows.length !== bindings.length) throw new Error("SCHEDULE_REGISTRATION_UNAVAILABLE");
    const schedules = result.rows.map((row) => {
      const binding = expected.get(row.schedule_identity);
      if (!binding || row.schedule_digest !== binding.schedule_digest
        || row.operation_id !== binding.operation_id
        || row.registry_entry_digest !== binding.dispatch_binding.registry_entry_digest
        || row.compatibility_envelope_set_digest
          !== binding.dispatch_binding.compatibility_envelope_set_digest) {
        throw new Error("SCHEDULE_BINDING_CONFLICT");
      }
      return scheduleRecord(row);
    });
    return {
      observed_at: result.rows[0].observed_at.toISOString(),
      schedules,
    };
  }

  async claimNextRead({
    workerIdentity,
    workerCapability,
    leaseMilliseconds = 30_000,
  }: {
    workerIdentity: string;
    workerCapability: string;
    leaseMilliseconds?: number;
  }): Promise<ShadowReadClaimV1 | null> {
    const workerCapabilityDigest = workerCapabilityDigestV1(workerCapability);
    if (!IDENTITY.test(workerIdentity) || !workerCapabilityDigest
      || !Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 5_000
      || leaseMilliseconds > 300_000) throw new Error("WORKER_CLAIM_INVALID");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await recoverExpiredClaims(client);
      const worker = await client.query<{ capabilities_json: RegisteredOperationId[] }>(
        `SELECT capabilities_json
           FROM dashboard_shadow_workers_v1
          WHERE worker_identity = $1 AND worker_capability_digest = $2
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE`,
        [workerIdentity, workerCapabilityDigest],
      );
      const capabilities = canonicalCapabilitiesV1(worker.rows[0]?.capabilities_json ?? []);
      if (!capabilities) throw new Error("WORKER_UNAVAILABLE");
      let current: (RunRow & {
        claim_attempt: number;
        registry_entry_digest: string | null;
        compatibility_envelope_set_digest: string | null;
      }) | undefined;
      let binding: OperationDispatchBindingV1 | null = null;
      for (let invalidCount = 0; invalidCount < 32; invalidCount += 1) {
        const queued = await client.query<RunRow & {
          claim_attempt: number;
          registry_entry_digest: string | null;
          compatibility_envelope_set_digest: string | null;
        }>(
        `SELECT r.*, q.claim_attempt, q.registry_entry_digest,
                q.compatibility_envelope_set_digest
           FROM dashboard_shadow_dispatch_queue_v1 q
           JOIN dashboard_operation_runs_v1 r USING (run_identity)
          WHERE r.state = 'queued' AND q.completed_at IS NULL
            AND r.operation_id = ANY($1::text[])
          ORDER BY q.enqueued_at, q.run_identity
          LIMIT 1
          FOR UPDATE OF q, r SKIP LOCKED`,
        [capabilities],
        );
        current = queued.rows[0];
        if (!current) break;
        binding = canonicalDispatchBindingV1(current.operation_id as RegisteredOperationId, {
          registry_entry_digest: current.registry_entry_digest ?? "",
          compatibility_envelope_set_digest: current.compatibility_envelope_set_digest ?? "",
        });
        if (binding) break;
        const quarantined = await client.query(
          `UPDATE dashboard_operation_runs_v1
              SET state = 'failed', owner_outcome_state = 'unavailable',
                  terminal_code = 'DEPLOYMENT_UNAVAILABLE',
                  transition_version = transition_version + 1,
                  started_at = clock_timestamp(), updated_at = clock_timestamp(),
                  finished_at = clock_timestamp()
            WHERE run_identity = $1 AND state = 'queued'
            RETURNING run_identity`,
          [current.run_identity],
        );
        if (quarantined.rowCount !== 1) throw new Error("WORKER_CLAIM_CONFLICT");
        await appendLog(
          client,
          current.run_identity,
          "warning",
          "shadow_worker",
          "DEPLOYMENT_UNAVAILABLE",
        );
        current = undefined;
      }
      if (!current || !binding) {
        await client.query("COMMIT");
        return null;
      }
      const claimToken = `${randomUUID()}.${randomUUID()}`;
      const claimTokenDigest = sha256Token(claimToken);
      const queue = await client.query<{ claim_attempt: number; lease_expires_at: Date }>(
        `UPDATE dashboard_shadow_dispatch_queue_v1
            SET claim_attempt = claim_attempt + 1, claimed_by = $2, claim_token_digest = $3,
                claimed_at = clock_timestamp(),
                lease_expires_at = clock_timestamp() + $4::int * interval '1 millisecond'
          WHERE run_identity = $1 AND claim_attempt < 3 AND completed_at IS NULL
          RETURNING claim_attempt, lease_expires_at`,
        [current.run_identity, workerIdentity, claimTokenDigest, leaseMilliseconds],
      );
      if (queue.rowCount !== 1) throw new Error("WORKER_CLAIM_CONFLICT");
      const updated = await client.query<RunRow>(
        `UPDATE dashboard_operation_runs_v1
            SET state = 'running', transition_version = transition_version + 1,
                started_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE run_identity = $1 AND state = 'queued' AND transition_version = $2
          RETURNING *`,
        [current.run_identity, Number(current.transition_version)],
      );
      if (updated.rowCount !== 1) throw new Error("WORKER_CLAIM_CONFLICT");
      await appendLog(client, current.run_identity, "info", "shadow_worker", "RUN_CLAIMED");
      await client.query("COMMIT");
      return {
        schema_version: 1,
        run: shadowReadRecord(updated.rows[0]),
        registry_entry_digest: binding.registry_entry_digest,
        compatibility_envelope_set_digest: binding.compatibility_envelope_set_digest,
        claim_token: claimToken,
        claim_attempt: queue.rows[0].claim_attempt,
        lease_expires_at: queue.rows[0].lease_expires_at.toISOString(),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeClaimedRead({
    runIdentity,
    workerIdentity,
    claimToken,
    expectedTransitionVersion,
    operationalState = "succeeded",
    ownerOutcomeState,
    terminalCode,
  }: {
    runIdentity: string;
    workerIdentity: string;
    claimToken: string;
    expectedTransitionVersion: number;
    operationalState?: "succeeded" | "failed";
    ownerOutcomeState: OwnerOutcomeState;
    terminalCode: RunTerminalCodeV1;
  }): Promise<OperationRunV1> {
    if (!isRunIdentityV1(runIdentity) || !IDENTITY.test(workerIdentity)
      || !Number.isSafeInteger(expectedTransitionVersion) || expectedTransitionVersion < 1
      || !["succeeded", "failed"].includes(operationalState)
      || !validOwnerOutcomeState(ownerOutcomeState) || !isRunTerminalCodeV1(terminalCode)) {
      throw new Error("WORKER_COMPLETION_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<RunRow & {
        claimed_by: string;
        claim_token_digest: string;
        completed_at: Date | null;
        claim_lease_expires_at: Date;
        worker_lease_expires_at: Date;
        observed_at: Date;
      }>(
        `SELECT r.*, q.claimed_by, q.claim_token_digest, q.completed_at,
                q.lease_expires_at AS claim_lease_expires_at,
                w.lease_expires_at AS worker_lease_expires_at,
                clock_timestamp() AS observed_at
           FROM dashboard_operation_runs_v1 r
           JOIN dashboard_shadow_dispatch_queue_v1 q USING (run_identity)
           JOIN dashboard_shadow_workers_v1 w ON w.worker_identity = q.claimed_by
          WHERE r.run_identity = $1
          FOR UPDATE OF r, q, w`,
        [runIdentity],
      );
      const current = locked.rows[0];
      if (!current || current.state !== "running" || current.completed_at
        || Number(current.transition_version) !== expectedTransitionVersion
        || current.claimed_by !== workerIdentity
        || current.claim_token_digest !== sha256Token(claimToken)
        || current.claim_lease_expires_at.getTime() <= current.observed_at.getTime()
        || current.worker_lease_expires_at.getTime() <= current.observed_at.getTime()) {
        throw new Error("WORKER_COMPLETION_CONFLICT");
      }
      const updated = await client.query<RunRow>(
        `UPDATE dashboard_operation_runs_v1
            SET state = $2, owner_outcome_state = $3, terminal_code = $4,
                transition_version = transition_version + 1, updated_at = clock_timestamp(),
                finished_at = clock_timestamp()
          WHERE run_identity = $1 AND state = 'running' AND transition_version = $5
          RETURNING *`,
        [runIdentity, operationalState, ownerOutcomeState, terminalCode, expectedTransitionVersion],
      );
      if (updated.rowCount !== 1) throw new Error("WORKER_COMPLETION_CONFLICT");
      await client.query(
        `UPDATE dashboard_shadow_dispatch_queue_v1
            SET completed_at = clock_timestamp()
          WHERE run_identity = $1 AND completed_at IS NULL`,
        [runIdentity],
      );
      await appendLog(
        client,
        runIdentity,
        ownerOutcomeState === "unavailable" ? "warning" : "info",
        "owner_gateway",
        terminalCode,
      );
      await client.query("COMMIT");
      return record(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async beginRead(
    operationId: RegisteredOperationId,
    recoveryIdentity: Record<string, string>,
  ): Promise<OperationRunV1> {
    const canonical = canonicalRecoveryIdentityV1(operationId, recoveryIdentity);
    const digest = recoveryIdentityDigestV1(operationId, recoveryIdentity);
    if (!canonical || !digest || operationByIdV1(operationId).effect_set.length !== 0) {
      throw new Error("RUN_STORE_SUBMISSION_INVALID");
    }
    const runIdentity = `dashboard-run-v1-${randomUUID()}`;
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<RunRow>(
        `INSERT INTO dashboard_operation_runs_v1
         (run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
            owner_outcome_state, recovery_identity_json, recovery_identity_digest, transition_version,
            started_at)
         VALUES ($1, 1, $2, 'DASHBOARD_SHADOW_READ', 'owner_read', 'dashboard_bff', 'running',
                 'unknown', $3::jsonb, $4, 1, clock_timestamp())
         RETURNING *`,
        [runIdentity, operationId, JSON.stringify(canonical), digest],
      );
      await appendLog(client, runIdentity, "info", "run_store", "RUN_STARTED");
      await client.query("COMMIT");
      return record(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeRead({
    runIdentity,
    expectedTransitionVersion,
    ownerOutcomeState,
    terminalCode,
  }: {
    runIdentity: string;
    expectedTransitionVersion: number;
    ownerOutcomeState: OwnerOutcomeState;
    terminalCode: RunTerminalCodeV1;
  }): Promise<OperationRunV1> {
    if (!isRunIdentityV1(runIdentity) || !Number.isSafeInteger(expectedTransitionVersion)
      || expectedTransitionVersion < 1 || !validOwnerOutcomeState(ownerOutcomeState)
      || !isRunTerminalCodeV1(terminalCode)) {
      throw new Error("RUN_STORE_TRANSITION_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<RunRow>(
        "SELECT * FROM dashboard_operation_runs_v1 WHERE run_identity = $1 FOR UPDATE",
        [runIdentity],
      );
      const current = locked.rows[0];
      if (!current || current.state !== "running"
        || Number(current.transition_version) !== expectedTransitionVersion) {
        throw new Error("RUN_STORE_TRANSITION_CONFLICT");
      }
      const updated = await client.query<RunRow>(
        `UPDATE dashboard_operation_runs_v1
            SET state = 'succeeded', owner_outcome_state = $2, terminal_code = $3,
                transition_version = transition_version + 1, updated_at = clock_timestamp(),
                finished_at = clock_timestamp()
          WHERE run_identity = $1 AND state = 'running' AND transition_version = $4
          RETURNING *`,
        [runIdentity, ownerOutcomeState, terminalCode, expectedTransitionVersion],
      );
      if (updated.rowCount !== 1) throw new Error("RUN_STORE_TRANSITION_CONFLICT");
      await appendLog(
        client,
        runIdentity,
        ownerOutcomeState === "unavailable" ? "warning" : "info",
        "owner_gateway",
        terminalCode,
      );
      await client.query("COMMIT");
      return record(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getRun(runIdentity: string): Promise<OperationRunV1 | null> {
    if (!isRunIdentityV1(runIdentity)) throw new Error("RUN_STORE_IDENTITY_INVALID");
    const result = await this.#pool.query<RunRow>(
      "SELECT * FROM dashboard_operation_runs_v1 WHERE run_identity = $1",
      [runIdentity],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async getRunLogs(runIdentity: string): Promise<OperationRunLogV1[]> {
    if (!isRunIdentityV1(runIdentity)) throw new Error("RUN_STORE_IDENTITY_INVALID");
    const result = await this.#pool.query<RunLogRow>(
      `SELECT run_identity, sequence, observed_at, level, source, event_code
         FROM dashboard_operation_run_logs_v1
        WHERE run_identity = $1
        ORDER BY sequence
        LIMIT 256`,
      [runIdentity],
    );
    return projectRunLogRowsV1(result.rows, runIdentity);
  }

  async readRunLogPage({
    runIdentity,
    level,
    source,
    query,
    cursor,
    limit = 64,
  }: {
    runIdentity: string;
    level: RunLogLevelFilterV1;
    source: RunLogSourceFilterV1;
    query: string;
    cursor?: string;
    limit?: number;
  }): Promise<RunLogPageCutV1 | null> {
    if (!isRunIdentityV1(runIdentity) || !["all", "info", "warning", "error"].includes(level)
      || !["all", "run_store", "dashboard_bff", "owner_gateway", "shadow_worker",
        "artifact_orchestrator", "source_research_orchestrator"]
        .includes(source)
      || !/^[A-Za-z0-9._:/ -]{0,64}$/.test(query) || query !== query.trim().toLowerCase()
      || !Number.isInteger(limit) || limit < 1 || limit > 256) throw new Error("RUN_LOG_REQUEST_INVALID");
    const decoded = cursor ? decodeRunLogCursor(cursor, this.#cursorHmacKey) : null;
    if (cursor && !decoded) throw new Error("RUN_LOG_CURSOR_INVALID");
    if (decoded && (decoded.run_identity !== runIdentity || decoded.level !== level
      || decoded.source !== source || decoded.query !== query)) throw new Error("RUN_LOG_CURSOR_FILTER_MISMATCH");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const now = (await client.query<{ observed_at: Date }>(
        "SELECT clock_timestamp() AS observed_at",
      )).rows[0].observed_at;
      const observedAt = decoded ? new Date(decoded.observed_cut) : now;
      if (!Number.isFinite(observedAt.getTime()) || observedAt > now) throw new Error("RUN_LOG_CURSOR_INVALID");
      const runResult = await client.query<{ retained_until: Date; created_at: Date }>(
        `SELECT retained_until, created_at
           FROM dashboard_operation_runs_v1
          WHERE run_identity = $1 AND created_at <= $2`,
        [runIdentity, observedAt],
      );
      const run = runResult.rows[0];
      if (!run) {
        await client.query("COMMIT");
        return null;
      }
      if (run.retained_until <= observedAt) throw new Error("OPERATIONAL_DATA_EXPIRED");
      const deletion = await client.query(
        `SELECT 1 FROM dashboard_operation_run_cache_deletions_v1
          WHERE run_identity = $1`,
        [runIdentity],
      );
      if (deletion.rowCount === 1) throw new Error("OPERATIONAL_CACHE_DELETED");
      const afterSequence = decoded?.after_sequence ?? 0;
      const result = await client.query<RunLogRow>(
        `SELECT run_identity, sequence, observed_at, level, source, event_code
           FROM dashboard_operation_run_logs_v1
          WHERE run_identity = $1 AND observed_at <= $2 AND sequence > $3
            AND ($4::text = 'all' OR level = $4)
            AND ($5::text = 'all' OR source = $5)
            AND ($6::text = '' OR lower(source || ' ' || event_code || ' ' || sequence::text)
                 LIKE '%' || $6 || '%')
          ORDER BY sequence
          LIMIT $7`,
        [runIdentity, observedAt, afterSequence, level, source, query, limit + 1],
      );
      const projected = projectRunLogRowsV1(result.rows, runIdentity, observedAt);
      const hasMore = projected.length > limit;
      const logs = projected.slice(0, limit);
      const last = logs.at(-1);
      await client.query("COMMIT");
      return {
        observed_at: observedAt.toISOString(),
        retained_until: run.retained_until.toISOString(),
        logs,
        next_cursor: hasMore && last ? encodeRunLogCursor({
          schema_version: 1,
          observed_cut: observedAt.toISOString(),
          run_identity: runIdentity,
          after_sequence: last.sequence,
          level,
          source,
          query,
        }, this.#cursorHmacKey) : null,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async readRunDetail(runIdentity: string): Promise<OperationRunDetailCutV1 | null> {
    if (!isRunIdentityV1(runIdentity)) throw new Error("RUN_STORE_IDENTITY_INVALID");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const observedAt = (await client.query<{ observed_at: Date }>(
        "SELECT clock_timestamp() AS observed_at",
      )).rows[0].observed_at;
      const runResult = await client.query<RunRow>(
        "SELECT * FROM dashboard_operation_runs_v1 WHERE run_identity = $1",
        [runIdentity],
      );
      if (!runResult.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const run = record(runResult.rows[0]);
      const cacheExpired = runResult.rows[0].retained_until <= observedAt;
      const deletionResult = await client.query<CacheDeletionRow>(
        `SELECT run_identity, schema_version, receipt_identity, prior_state,
                prior_transition_version, principal_ref, authorization_digest, deleted_at
           FROM dashboard_operation_run_cache_deletions_v1
          WHERE run_identity = $1`,
        [runIdentity],
      );
      const cacheDeletionReceipt = deletionResult.rows[0]
        ? projectCacheDeletionReceiptV1(deletionResult.rows[0])
        : null;
      const logResult = cacheDeletionReceipt || cacheExpired
        ? { rows: [] as RunLogRow[] } : await client.query<RunLogRow>(
        `SELECT run_identity, sequence, observed_at, level, source, event_code
           FROM dashboard_operation_run_logs_v1
          WHERE run_identity = $1 AND observed_at <= $2
          ORDER BY sequence
          LIMIT 256`,
        [runIdentity, observedAt],
      );
      const logs = projectRunLogRowsV1(logResult.rows, runIdentity, observedAt);

      let dispatchBinding: RunDispatchBindingV1;
      let workerCompatibility: RunWorkerCompatibilityV1 | null = null;
      if (run.run_kind === "owner_effect") {
        dispatchBinding = {
          schema_version: 1,
          availability: "not_applicable",
          unavailable_reason: null,
          required_operation_id: null,
          dependency_operation_ids: [],
          registry_entry_digest: null,
          compatibility_envelope_set_digest: null,
        };
        workerCompatibility = {
          schema_version: 1,
          availability: "not_applicable",
          unavailable_reason: null,
          required_operation_id: null,
          claim_attempt: null,
          worker_identity: null,
          worker_artifact_digest: null,
          worker_lease_state: null,
          claimed_at: null,
          completed_at: null,
        };
      } else {
        const binding = (await client.query<RunWorkerBindingRow>(
          `SELECT q.schema_version, q.registry_entry_digest, q.compatibility_envelope_set_digest,
                  q.claim_attempt, q.claimed_by, q.claimed_at, q.completed_at,
                  w.capabilities_json, w.capabilities_digest, w.worker_artifact_digest,
                  w.lease_expires_at
             FROM dashboard_shadow_dispatch_queue_v1 q
        LEFT JOIN dashboard_shadow_workers_v1 w ON w.worker_identity = q.claimed_by
            WHERE q.run_identity = $1`,
          [runIdentity],
        )).rows[0];
        const operationId = run.operation_id as RegisteredOperationId;
        const descriptor = operationByIdV1(operationId);
        const dependencyOperationIds = [...descriptor.dependency_operation_ids];
        if (!binding) {
          dispatchBinding = {
            schema_version: 1,
            availability: "unavailable",
            unavailable_reason: "RUN_DISPATCH_BINDING_UNAVAILABLE",
            required_operation_id: operationId,
            dependency_operation_ids: dependencyOperationIds,
            registry_entry_digest: null,
            compatibility_envelope_set_digest: null,
          };
          workerCompatibility = {
            schema_version: 1,
            availability: "unavailable",
            unavailable_reason: "RUN_DISPATCH_BINDING_UNAVAILABLE",
            required_operation_id: operationId,
            claim_attempt: null,
            worker_identity: null,
            worker_artifact_digest: null,
            worker_lease_state: null,
            claimed_at: null,
            completed_at: null,
          };
        } else if (binding.schema_version !== 1 || !Number.isInteger(binding.claim_attempt)
          || binding.claim_attempt < 0 || binding.claim_attempt > MAX_CLAIM_ATTEMPTS
          || typeof binding.registry_entry_digest !== "string"
          || !DIGEST.test(binding.registry_entry_digest)
          || typeof binding.compatibility_envelope_set_digest !== "string"
          || !DIGEST.test(binding.compatibility_envelope_set_digest)) {
          throw new Error("RUN_WORKER_BINDING_INVALID");
        } else {
          const registryMatches = binding.registry_entry_digest
            === operationRegistryEntryDigestV1(operationId);
          dispatchBinding = registryMatches ? {
            schema_version: 1,
            availability: "available",
            unavailable_reason: null,
            required_operation_id: operationId,
            dependency_operation_ids: dependencyOperationIds,
            registry_entry_digest: binding.registry_entry_digest,
            compatibility_envelope_set_digest: binding.compatibility_envelope_set_digest,
          } : {
            schema_version: 1,
            availability: "unavailable",
            unavailable_reason: "RUN_DISPATCH_REGISTRY_DRIFT",
            required_operation_id: operationId,
            dependency_operation_ids: dependencyOperationIds,
            registry_entry_digest: null,
            compatibility_envelope_set_digest: null,
          };
        }
        if (binding && binding.claimed_by === null) {
          workerCompatibility = {
            schema_version: 1,
            availability: "unavailable",
            unavailable_reason: "RUN_WORKER_NOT_CLAIMED",
            required_operation_id: operationId,
            claim_attempt: binding.claim_attempt,
            worker_identity: null,
            worker_artifact_digest: null,
            worker_lease_state: null,
            claimed_at: null,
            completed_at: null,
          };
        } else if (binding) {
          const claimedBy = binding.claimed_by;
          const capabilities = binding.capabilities_json
            ? canonicalCapabilitiesV1(binding.capabilities_json)
            : null;
          if (!claimedBy || !IDENTITY.test(claimedBy) || !capabilities
            || capabilityDigestV1(capabilities) !== binding.capabilities_digest
            || !capabilities.includes(operationId)
            || !binding.worker_artifact_digest || !DIGEST.test(binding.worker_artifact_digest)
            || !(binding.lease_expires_at instanceof Date)
            || !(binding.claimed_at instanceof Date)
            || binding.claimed_at > observedAt
            || (binding.completed_at !== null
              && (!(binding.completed_at instanceof Date) || binding.completed_at > observedAt))) {
            throw new Error("RUN_WORKER_BINDING_INVALID");
          }
          workerCompatibility = {
            schema_version: 1,
            availability: "available",
            unavailable_reason: null,
            required_operation_id: run.operation_id as RegisteredOperationId,
            claim_attempt: binding.claim_attempt,
            worker_identity: claimedBy,
            worker_artifact_digest: binding.worker_artifact_digest,
            worker_lease_state: binding.lease_expires_at > observedAt ? "available" : "expired",
            claimed_at: binding.claimed_at.toISOString(),
            completed_at: binding.completed_at?.toISOString() ?? null,
          };
        }
      }
      if (!workerCompatibility) throw new Error("RUN_WORKER_BINDING_INVALID");
      await client.query("COMMIT");
      return {
        observed_at: observedAt.toISOString(),
        run,
        logs,
        dispatch_binding: dispatchBinding,
        worker_compatibility: workerCompatibility,
        cache_deletion_receipt: cacheDeletionReceipt,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteOperationalCache({
    runIdentity,
    expectedTransitionVersion,
    authorizationDigest,
    principalRef = "local_operator",
  }: {
    runIdentity: string;
    expectedTransitionVersion: number;
    authorizationDigest: string;
    principalRef?: string;
  }): Promise<OperationalCacheDeletionReceiptV1> {
    if (!isRunIdentityV1(runIdentity) || !Number.isSafeInteger(expectedTransitionVersion)
      || expectedTransitionVersion < 1 || !DIGEST.test(authorizationDigest)
      || !/^[A-Za-z0-9._:/-]{1,96}$/.test(principalRef)) {
      throw new Error("RUN_CACHE_DELETION_REQUEST_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const runResult = await client.query<RunRow>(
        "SELECT * FROM dashboard_operation_runs_v1 WHERE run_identity = $1 FOR UPDATE",
        [runIdentity],
      );
      const row = runResult.rows[0];
      if (!row) throw new Error("RUN_NOT_FOUND");
      const existing = await client.query<CacheDeletionRow>(
        `SELECT run_identity, schema_version, receipt_identity, prior_state,
                prior_transition_version, principal_ref, authorization_digest, deleted_at
           FROM dashboard_operation_run_cache_deletions_v1
          WHERE run_identity = $1`,
        [runIdentity],
      );
      if (existing.rows[0]) {
        const receipt = projectCacheDeletionReceiptV1(existing.rows[0]);
        await client.query("COMMIT");
        return receipt;
      }
      const run = record(row);
      if (!["succeeded", "failed", "cancelled", "unknown"].includes(run.state)) {
        throw new Error("RUN_CACHE_DELETION_NOT_TERMINAL");
      }
      if (run.transition_version !== expectedTransitionVersion) {
        throw new Error("RUN_CACHE_DELETION_TRANSITION_MISMATCH");
      }
      const deletedAt = (await client.query<{ deleted_at: Date }>(
        "SELECT clock_timestamp() AS deleted_at",
      )).rows[0].deleted_at;
      const unsigned = {
        schema_version: 1 as const,
        operation: "dashboard.operational_cache.delete.v1" as const,
        run_identity: runIdentity,
        prior_state: run.state as OperationalCacheDeletionReceiptV1["prior_state"],
        prior_transition_version: run.transition_version,
        principal_ref: principalRef,
        authorization_digest: authorizationDigest,
        deleted_at: deletedAt.toISOString(),
      };
      const receiptIdentity = operationalCacheDeletionReceiptIdentityV1(unsigned);
      const inserted = await client.query<CacheDeletionRow>(
        `INSERT INTO dashboard_operation_run_cache_deletions_v1
           (run_identity, schema_version, receipt_identity, prior_state,
            prior_transition_version, principal_ref, authorization_digest, deleted_at)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
         RETURNING run_identity, schema_version, receipt_identity, prior_state,
                   prior_transition_version, principal_ref, authorization_digest, deleted_at`,
        [runIdentity, receiptIdentity, run.state, run.transition_version,
          principalRef, authorizationDigest, deletedAt],
      );
      const receipt = projectCacheDeletionReceiptV1(inserted.rows[0]);
      await client.query("COMMIT");
      return receipt;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listRuns({
    limit = DEFAULT_LIMIT,
    cursor,
    operationId,
    state,
  }: {
    limit?: number;
    cursor?: string;
    operationId?: OperationalOperationId;
    state?: RunOperationalState;
  } = {}): Promise<RunPageV1> {
    const boundedLimit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
    const decoded = cursor ? decodeCursor(cursor, this.#cursorHmacKey) : null;
    if (cursor && !decoded) throw new Error("RUN_STORE_CURSOR_INVALID");
    if (operationId && !operationalOperationId(operationId)) throw new Error("RUN_STORE_FILTER_INVALID");
    if (decoded && (decoded.operation_id !== (operationId ?? null) || decoded.state !== (state ?? null))) {
      throw new Error("RUN_STORE_CURSOR_FILTER_MISMATCH");
    }
    const observedCut = decoded?.observed_cut ?? (await this.#pool.query<{ observed_cut: Date }>(
      "SELECT clock_timestamp() AS observed_cut",
    )).rows[0].observed_cut.toISOString();
    const values: unknown[] = [observedCut, boundedLimit + 1];
    const predicates = ["created_at <= $1::timestamptz"];
    if (decoded) {
      values.push(decoded.created_at, decoded.run_identity);
      predicates.push(`(created_at, run_identity) < ($3::timestamptz, $4::text)`);
    }
    if (operationId) {
      values.push(operationId);
      predicates.push(`operation_id = $${values.length}`);
    }
    if (state) {
      values.push(state);
      predicates.push(`state = $${values.length}`);
    }
    const result = await this.#pool.query<RunRow>(
      `SELECT * FROM dashboard_operation_runs_v1
        WHERE ${predicates.join(" AND ")}
        ORDER BY created_at DESC, run_identity DESC
        LIMIT $2`,
      values,
    );
    const hasMore = result.rows.length > boundedLimit;
    const selected = result.rows.slice(0, boundedLimit).map(record);
    const last = selected.at(-1);
    return {
      schema_version: 1,
      operation: "dashboard.run_store.list.v1",
      availability: "available",
      observed_at: observedCut,
      runs: selected,
      next_cursor: hasMore && last ? encodeCursor({
        schema_version: 1,
        observed_cut: observedCut,
        created_at: last.created_at,
        run_identity: last.run_identity,
        operation_id: operationId ?? null,
        state: state ?? null,
      }, this.#cursorHmacKey) : null,
    };
  }
}

let configuredStore: PostgresRunStoreV1 | null | undefined;

export function configuredRunStoreV1(): PostgresRunStoreV1 | null {
  if (configuredStore !== undefined) return configuredStore;
  const connectionString = process.env.DASHBOARD_DATABASE_URL;
  const cursorHmacKey = process.env.DASHBOARD_CURSOR_HMAC_KEY;
  if (!connectionString && !cursorHmacKey) configuredStore = null;
  else if (!connectionString || !cursorHmacKey) throw new Error("RUN_STORE_CONFIGURATION_INVALID");
  else configuredStore = new PostgresRunStoreV1(connectionString, cursorHmacKey);
  return configuredStore;
}
