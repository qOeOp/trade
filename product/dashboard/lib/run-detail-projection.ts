import {
  isRunEventCodeV1,
  isRunIdentityV1,
  isRunTerminalCodeV1,
  type RunEventCodeV1,
  type RunTerminalCodeV1,
} from "./run-contract.ts";
import {
  operationByIdV1,
  operationRegistryEntryDigestV1,
  type RegisteredOperationId,
} from "./operation-registry.ts";
import type {
  OperationRunDetailCutV1,
  RunDispatchBindingV1,
  RunWorkerCompatibilityV1,
} from "./run-store.ts";
import {
  projectRdOwnerViewLocatorV1,
  type RdOwnerViewLocatorV1,
} from "./rd-owner-view.ts";
import {
  parseOperationalCacheDeletionReceiptV1,
  type OperationalCacheDeletionReceiptV1,
} from "./run-cache-deletion-contract.ts";
import {
  parseOperationalCancellationReadbackV1,
  type OperationalCancellationReadbackV1,
} from "./run-cancellation-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const operationInputs = {
  "research_goal.legacy_quarantine_read.v1": ["request_identity"],
  "research_goal.shadow_resolve.v1": ["request_identity"],
  "artifact_build.shadow_resolve.v1": [
    "research_request_identity", "build_request_identity", "attempt_identity",
  ],
  "source_intake.shadow_read.v1": ["request_identity"],
  "rd_formation_catalog.shadow_read.v1": [],
  "rd_historical_custody.shadow_read.v1": [],
  "rd_iteration_timeline.shadow_read.v1": ["trial_family_identity"],
  "exploratory_replay.shadow_read.v2": ["request_identity", "meaning_digest"],
  "develop_composer.shadow_read.v2": ["request_identity"],
  "artifact_build.formation_execute.v1": [
    "research_request_identity", "build_request_identity", "attempt_identity",
  ],
  "source_intake.research.submit_or_resolve.v1": [
    "source_request_identity", "research_request_identity",
  ],
} as const;

type RunDetailOperationIdV1 = keyof typeof operationInputs;

export type RunDetailInputV1 = { key: string; value: string };
export type RunDetailWithheldFieldV1 = {
  field: "recovery_identity_digest";
  reason: "INTERNAL_BINDING";
};
export type RunDetailLogV1 = {
  schema_version: 1;
  run_identity: string;
  sequence: number;
  observed_at: string;
  level: "info" | "warning" | "error";
  source: "run_store" | "dashboard_bff" | "owner_gateway" | "shadow_worker"
    | "artifact_orchestrator" | "source_research_orchestrator";
  event_code: RunEventCodeV1;
};
export type RunDetailRunV1 = {
  schema_version: 1;
  run_identity: string;
  operation_id: RunDetailOperationIdV1;
  channel: "DASHBOARD_SHADOW_READ" | "DASHBOARD_DISPOSABLE_EXECUTION";
  run_kind: "owner_read" | "owner_effect";
  trigger_kind: "dashboard_bff" | "dashboard_api" | "dashboard_scheduler";
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  owner_outcome_state: "available" | "rejected" | "unknown" | "unavailable" | "not_applicable";
  input_fields: RunDetailInputV1[];
  withheld_fields: RunDetailWithheldFieldV1[];
  transition_version: number;
  received_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  retained_until: string;
  terminal_code: RunTerminalCodeV1 | null;
  dispatch_binding: RunDispatchBindingV1;
  worker_compatibility: RunWorkerCompatibilityV1;
  owner_view: RdOwnerViewLocatorV1;
};
export type BoundedRunResultV1 = {
  schema_version: 1;
  projection: "dashboard.bounded_run_result.v1";
  run_identity: string;
  operation_id: RunDetailOperationIdV1;
  operational_state: RunDetailRunV1["state"];
  owner_outcome_state: RunDetailRunV1["owner_outcome_state"];
  terminal_code: RunTerminalCodeV1 | null;
  transition_version: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  retained_until: string;
  withheld_fields: [
    { field: "owner_payload"; reason: "OWNER_CUSTODY" },
    { field: "recovery_identity_digest"; reason: "INTERNAL_BINDING" },
  ];
};
export type RunDetailEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.run_store.detail.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  run_identity: string;
  run: RunDetailRunV1 | null;
  bounded_result: BoundedRunResultV1 | null;
  logs: RunDetailLogV1[];
  operational_cache: {
    state: "retained" | "deleted" | "expired";
    deletion_receipt: OperationalCacheDeletionReceiptV1 | null;
  } | null;
  operational_cancellation: OperationalCancellationReadbackV1 | null;
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function nullableTimestamp(value: unknown): value is string | null {
  return value === null || timestamp(value);
}
function durationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function parseWorkerCompatibility(
  value: unknown,
  operationId: RunDetailOperationIdV1,
  runKind: RunDetailRunV1["run_kind"],
  observedAt: string,
): RunWorkerCompatibilityV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const worker = value as Record<string, unknown>;
  if (!exactKeys(worker, [
    "schema_version", "availability", "unavailable_reason", "required_operation_id",
    "claim_attempt", "worker_identity", "worker_artifact_digest", "worker_lease_state",
    "claimed_at", "completed_at",
  ]) || worker.schema_version !== 1
    || !["available", "unavailable", "not_applicable"].includes(String(worker.availability))
    || !nullableTimestamp(worker.claimed_at) || !nullableTimestamp(worker.completed_at)) return null;
  if (runKind === "owner_effect") {
    return worker.availability === "not_applicable" && worker.unavailable_reason === null
      && worker.required_operation_id === null && worker.claim_attempt === null
      && worker.worker_identity === null && worker.worker_artifact_digest === null
      && worker.worker_lease_state === null && worker.claimed_at === null
      && worker.completed_at === null ? value as RunWorkerCompatibilityV1 : null;
  }
  if (worker.availability === "not_applicable" || worker.required_operation_id !== operationId
    || (worker.claim_attempt !== null && (!Number.isInteger(worker.claim_attempt)
      || Number(worker.claim_attempt) < 0 || Number(worker.claim_attempt) > 3))) return null;
  if (worker.availability === "unavailable") {
    return typeof worker.unavailable_reason === "string" && worker.worker_identity === null
      && worker.worker_artifact_digest === null && worker.worker_lease_state === null
      && worker.claimed_at === null && worker.completed_at === null
      ? value as RunWorkerCompatibilityV1 : null;
  }
  if (worker.unavailable_reason !== null || typeof worker.worker_identity !== "string"
    || !IDENTITY.test(worker.worker_identity) || typeof worker.worker_artifact_digest !== "string"
    || !DIGEST.test(worker.worker_artifact_digest)
    || !["available", "expired"].includes(String(worker.worker_lease_state))
    || !timestamp(worker.claimed_at) || Date.parse(worker.claimed_at) > Date.parse(observedAt)
    || (worker.completed_at !== null && Date.parse(worker.completed_at) > Date.parse(observedAt))) return null;
  return value as RunWorkerCompatibilityV1;
}

function parseDispatchBinding(
  value: unknown,
  operationId: RunDetailOperationIdV1,
  runKind: RunDetailRunV1["run_kind"],
): RunDispatchBindingV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const binding = value as Record<string, unknown>;
  if (!exactKeys(binding, [
    "schema_version", "availability", "unavailable_reason", "required_operation_id",
    "dependency_operation_ids", "registry_entry_digest", "compatibility_envelope_set_digest",
  ]) || binding.schema_version !== 1
    || !["available", "unavailable", "not_applicable"].includes(String(binding.availability))
    || !Array.isArray(binding.dependency_operation_ids)) return null;
  if (runKind === "owner_effect") {
    return binding.availability === "not_applicable" && binding.unavailable_reason === null
      && binding.required_operation_id === null && binding.dependency_operation_ids.length === 0
      && binding.registry_entry_digest === null && binding.compatibility_envelope_set_digest === null
      ? value as RunDispatchBindingV1 : null;
  }
  const registeredOperationId = operationId as RegisteredOperationId;
  const expectedDependencies = operationByIdV1(registeredOperationId).dependency_operation_ids;
  if (binding.availability === "not_applicable"
    || binding.required_operation_id !== registeredOperationId
    || JSON.stringify(binding.dependency_operation_ids) !== JSON.stringify(expectedDependencies)) return null;
  if (binding.availability === "unavailable") {
    return typeof binding.unavailable_reason === "string"
      && binding.registry_entry_digest === null && binding.compatibility_envelope_set_digest === null
      ? value as RunDispatchBindingV1 : null;
  }
  return binding.unavailable_reason === null
    && binding.registry_entry_digest === operationRegistryEntryDigestV1(registeredOperationId)
    && typeof binding.compatibility_envelope_set_digest === "string"
    && DIGEST.test(binding.compatibility_envelope_set_digest)
    ? value as RunDispatchBindingV1 : null;
}

function parseInputFields(value: unknown, operationId: RunDetailOperationIdV1): RunDetailInputV1[] | null {
  if (!Array.isArray(value)) return null;
  const expected = operationInputs[operationId];
  if (value.length !== expected.length) return null;
  const parsed = value.map((field, index) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return null;
    const record = field as Record<string, unknown>;
    return exactKeys(record, ["key", "value"]) && record.key === expected[index]
      && typeof record.value === "string" && IDENTITY.test(record.value)
      ? record as RunDetailInputV1 : null;
  });
  return parsed.some((field) => field === null) ? null : parsed as RunDetailInputV1[];
}

function parseRun(value: unknown, envelope: RunDetailEnvelopeV1): RunDetailRunV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  if (!exactKeys(run, [
    "schema_version", "run_identity", "operation_id", "channel", "run_kind", "trigger_kind",
    "state", "owner_outcome_state", "input_fields", "withheld_fields", "transition_version",
    "received_at", "started_at", "completed_at", "duration_ms", "retained_until", "terminal_code",
    "dispatch_binding", "worker_compatibility", "owner_view",
  ]) || run.schema_version !== 1 || run.run_identity !== envelope.run_identity
    || typeof run.operation_id !== "string" || !(run.operation_id in operationInputs)
    || ((run.operation_id === "artifact_build.formation_execute.v1"
      || run.operation_id === "source_intake.research.submit_or_resolve.v1")
      !== (run.channel === "DASHBOARD_DISPOSABLE_EXECUTION" && run.run_kind === "owner_effect"))
    || (run.operation_id !== "artifact_build.formation_execute.v1"
      && run.operation_id !== "source_intake.research.submit_or_resolve.v1"
      && (run.channel !== "DASHBOARD_SHADOW_READ" || run.run_kind !== "owner_read"))
    || !["dashboard_bff", "dashboard_api", "dashboard_scheduler"].includes(String(run.trigger_kind))
    || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(String(run.state))
    || !["available", "rejected", "unknown", "unavailable", "not_applicable"]
      .includes(String(run.owner_outcome_state)) || !Number.isSafeInteger(run.transition_version)
    || Number(run.transition_version) < 1 || !timestamp(run.received_at)
    || !nullableTimestamp(run.started_at) || !nullableTimestamp(run.completed_at)
    || !timestamp(run.retained_until)
    || (run.terminal_code !== null && !isRunTerminalCodeV1(run.terminal_code))) return null;
  const operationId = run.operation_id as RunDetailOperationIdV1;
  const inputs = parseInputFields(run.input_fields, operationId);
  if (!inputs || !Array.isArray(run.withheld_fields) || run.withheld_fields.length !== 1
    || JSON.stringify(run.withheld_fields[0])
      !== JSON.stringify({ field: "recovery_identity_digest", reason: "INTERNAL_BINDING" })) return null;
  const received = Date.parse(run.received_at as string);
  const started = run.started_at === null ? null : Date.parse(run.started_at as string);
  const completed = run.completed_at === null ? null : Date.parse(run.completed_at as string);
  const observed = Date.parse(envelope.observed_at);
  const retained = Date.parse(run.retained_until as string);
  const terminal = ["succeeded", "failed", "cancelled", "unknown"].includes(String(run.state));
  const cancelledBeforeStart = run.state === "cancelled" && started === null;
  if (received > observed || retained <= received
    || (started === null && run.state !== "queued" && !cancelledBeforeStart)
    || (run.state === "queued" && started !== null)
    || terminal !== (completed !== null) || (started !== null && started < received)
    || (completed !== null && ((started !== null && completed < started) || completed > observed))
    || run.duration_ms !== durationMs(run.started_at as string | null, run.completed_at as string | null)) {
    return null;
  }
  const worker = parseWorkerCompatibility(run.worker_compatibility, operationId,
    run.run_kind as RunDetailRunV1["run_kind"], envelope.observed_at);
  const dispatchBinding = parseDispatchBinding(run.dispatch_binding, operationId,
    run.run_kind as RunDetailRunV1["run_kind"]);
  const ownerView = projectRdOwnerViewLocatorV1(operationId, inputs);
  return worker && dispatchBinding && ownerView
    && JSON.stringify(run.owner_view) === JSON.stringify(ownerView)
    ? { ...(run as RunDetailRunV1), input_fields: inputs, dispatch_binding: dispatchBinding,
      worker_compatibility: worker, owner_view: ownerView }
    : null;
}

function parseLog(value: unknown, envelope: RunDetailEnvelopeV1): RunDetailLogV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const log = value as Record<string, unknown>;
  if (!exactKeys(log, [
    "schema_version", "run_identity", "sequence", "observed_at", "level", "source", "event_code",
  ]) || log.schema_version !== 1 || log.run_identity !== envelope.run_identity
    || !Number.isInteger(log.sequence) || Number(log.sequence) < 1 || Number(log.sequence) > 256
    || !timestamp(log.observed_at) || Date.parse(log.observed_at) > Date.parse(envelope.observed_at)
    || !["info", "warning", "error"].includes(String(log.level))
    || !["run_store", "dashboard_bff", "owner_gateway", "shadow_worker",
      "artifact_orchestrator", "source_research_orchestrator"]
      .includes(String(log.source)) || !isRunEventCodeV1(log.event_code)) return null;
  return log as RunDetailLogV1;
}

export function parseBoundedRunResultV1(value: unknown): BoundedRunResultV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (!exactKeys(result, [
    "schema_version", "projection", "run_identity", "operation_id", "operational_state",
    "owner_outcome_state", "terminal_code", "transition_version", "started_at", "completed_at",
    "duration_ms", "retained_until", "withheld_fields",
  ]) || result.schema_version !== 1 || result.projection !== "dashboard.bounded_run_result.v1"
    || !isRunIdentityV1(result.run_identity) || typeof result.operation_id !== "string"
    || !(result.operation_id in operationInputs)
    || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"]
      .includes(String(result.operational_state))
    || !["available", "rejected", "unknown", "unavailable", "not_applicable"]
      .includes(String(result.owner_outcome_state))
    || (result.terminal_code !== null && !isRunTerminalCodeV1(result.terminal_code))
    || !Number.isSafeInteger(result.transition_version) || Number(result.transition_version) < 1
    || !nullableTimestamp(result.started_at) || !nullableTimestamp(result.completed_at)
    || !timestamp(result.retained_until)
    || result.duration_ms !== durationMs(result.started_at as string | null, result.completed_at as string | null)
    || JSON.stringify(result.withheld_fields) !== JSON.stringify([
      { field: "owner_payload", reason: "OWNER_CUSTODY" },
      { field: "recovery_identity_digest", reason: "INTERNAL_BINDING" },
    ])) return null;
  const terminal = ["succeeded", "failed", "cancelled", "unknown"].includes(String(result.operational_state));
  const cancelledBeforeStart = result.operational_state === "cancelled" && result.started_at === null;
  if ((result.started_at === null && result.operational_state !== "queued" && !cancelledBeforeStart)
    || (result.operational_state === "queued" && result.started_at !== null)
    || terminal !== (result.completed_at !== null)
    || (result.completed_at !== null && result.started_at !== null
      && Date.parse(result.completed_at as string) < Date.parse(result.started_at as string))
    || (result.started_at !== null && Date.parse(result.retained_until as string)
      <= Date.parse(result.started_at as string))) return null;
  return result as BoundedRunResultV1;
}

function projectBoundedRunResultV1(run: OperationRunDetailCutV1["run"]): BoundedRunResultV1 {
  return {
    schema_version: 1,
    projection: "dashboard.bounded_run_result.v1",
    run_identity: run.run_identity,
    operation_id: run.operation_id as RunDetailOperationIdV1,
    operational_state: run.state,
    owner_outcome_state: run.owner_outcome_state,
    terminal_code: run.terminal_code,
    transition_version: run.transition_version,
    started_at: run.started_at,
    completed_at: run.finished_at,
    duration_ms: durationMs(run.started_at, run.finished_at),
    retained_until: run.retained_until,
    withheld_fields: [
      { field: "owner_payload", reason: "OWNER_CUSTODY" },
      { field: "recovery_identity_digest", reason: "INTERNAL_BINDING" },
    ],
  };
}

export function serializeBoundedRunResultV1(value: unknown): string | null {
  const result = parseBoundedRunResultV1(value);
  return result ? `${JSON.stringify(result, null, 2)}\n` : null;
}

export function projectRunDetailEnvelopeV1(detail: OperationRunDetailCutV1): RunDetailEnvelopeV1 {
  const fields = operationInputs[detail.run.operation_id as RunDetailOperationIdV1];
  if (!fields) throw new Error("RUN_DETAIL_OPERATION_UNAVAILABLE");
  const inputFields = fields.map((key) => ({ key, value: detail.run.recovery_identity[key] }));
  const ownerView = projectRdOwnerViewLocatorV1(detail.run.operation_id, inputFields);
  if (!ownerView) throw new Error("RUN_DETAIL_OWNER_VIEW_UNAVAILABLE");
  const cacheExpired = Date.parse(detail.run.retained_until) <= Date.parse(detail.observed_at);
  return {
    schema_version: 1,
    operation: "dashboard.run_store.detail.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: detail.observed_at,
    run_identity: detail.run.run_identity,
    run: {
      schema_version: 1,
      run_identity: detail.run.run_identity,
      operation_id: detail.run.operation_id,
      channel: detail.run.channel,
      run_kind: detail.run.run_kind,
      trigger_kind: detail.run.trigger_kind,
      state: detail.run.state,
      owner_outcome_state: detail.run.owner_outcome_state,
      input_fields: inputFields,
      withheld_fields: [{ field: "recovery_identity_digest", reason: "INTERNAL_BINDING" }],
      transition_version: detail.run.transition_version,
      received_at: detail.run.created_at,
      started_at: detail.run.started_at,
      completed_at: detail.run.finished_at,
      duration_ms: durationMs(detail.run.started_at, detail.run.finished_at),
      retained_until: detail.run.retained_until,
      terminal_code: detail.run.terminal_code,
      dispatch_binding: detail.dispatch_binding,
      worker_compatibility: detail.worker_compatibility,
      owner_view: ownerView,
    },
    bounded_result: detail.cache_deletion_receipt || cacheExpired ? null : projectBoundedRunResultV1(detail.run),
    logs: detail.cache_deletion_receipt || cacheExpired ? [] : detail.logs,
    operational_cache: detail.cache_deletion_receipt ? {
      state: "deleted",
      deletion_receipt: detail.cache_deletion_receipt,
    } : cacheExpired ? {
      state: "expired",
      deletion_receipt: null,
    } : {
      state: "retained",
      deletion_receipt: null,
    },
    operational_cancellation: detail.operational_cancellation,
  };
}

export function parseRunDetailEnvelopeV1(value: unknown): RunDetailEnvelopeV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at",
    "run_identity", "run", "bounded_result", "logs", "operational_cache", "operational_cancellation",
  ]) || envelope.schema_version !== 1 || envelope.operation !== "dashboard.run_store.detail.v1"
    || !["available", "unavailable"].includes(String(envelope.availability))
    || !isRunIdentityV1(envelope.run_identity) || !timestamp(envelope.observed_at)
    || !Array.isArray(envelope.logs)) return null;
  const typedEnvelope = envelope as RunDetailEnvelopeV1;
  if (envelope.availability === "unavailable") {
    return typeof envelope.unavailable_reason === "string" && envelope.run === null
      && envelope.bounded_result === null && envelope.logs.length === 0
      && envelope.operational_cache === null && envelope.operational_cancellation === null
      ? typedEnvelope : null;
  }
  if (envelope.unavailable_reason !== null) return null;
  const run = parseRun(envelope.run, typedEnvelope);
  const logs = envelope.logs.map((entry) => parseLog(entry, typedEnvelope));
  if (!run || logs.some((entry) => entry === null)
    || !envelope.operational_cache || typeof envelope.operational_cache !== "object"
    || Array.isArray(envelope.operational_cache)
    || !exactKeys(envelope.operational_cache as Record<string, unknown>, ["state", "deletion_receipt"])) return null;
  const cache = envelope.operational_cache as Record<string, unknown>;
  const cancellation = parseOperationalCancellationReadbackV1(
    envelope.operational_cancellation,
    envelope.run_identity as string,
    envelope.observed_at as string,
  );
  if (!cancellation) return null;
  if ((cancellation.state === "pending" && (
    run.state !== "queued"
    || cancellation.action_envelope?.transition_version !== run.transition_version
    || run.worker_compatibility.availability !== "unavailable"
    || run.worker_compatibility.unavailable_reason !== "RUN_WORKER_NOT_CLAIMED"
  )) || (cancellation.state === "receipt" && (
    run.state !== "cancelled"
    || cancellation.receipt?.transition_version !== run.transition_version
  ))) return null;
  if (cache.state === "deleted") {
    const receipt = parseOperationalCacheDeletionReceiptV1(cache.deletion_receipt);
    if (!receipt || receipt.run_identity !== run.run_identity
      || !["succeeded", "failed", "cancelled", "unknown"].includes(run.state)
      || receipt.prior_state !== run.state
      || receipt.prior_transition_version !== run.transition_version
      || envelope.bounded_result !== null || envelope.logs.length !== 0) return null;
    return { ...typedEnvelope, run, bounded_result: null, logs: [], operational_cache: {
      state: "deleted", deletion_receipt: receipt,
    }, operational_cancellation: cancellation };
  }
  if (cache.state === "expired") {
    if (cache.deletion_receipt !== null
      || Date.parse(run.retained_until) > Date.parse(typedEnvelope.observed_at)
      || envelope.bounded_result !== null || envelope.logs.length !== 0) return null;
    return { ...typedEnvelope, run, bounded_result: null, logs: [], operational_cache: {
      state: "expired", deletion_receipt: null,
    }, operational_cancellation: cancellation };
  }
  if (cache.state !== "retained" || cache.deletion_receipt !== null) return null;
  if (Date.parse(run.retained_until) <= Date.parse(typedEnvelope.observed_at)) return null;
  const boundedResult = parseBoundedRunResultV1(envelope.bounded_result);
  if (!boundedResult
    || boundedResult.run_identity !== run.run_identity
    || boundedResult.operation_id !== run.operation_id
    || boundedResult.operational_state !== run.state
    || boundedResult.owner_outcome_state !== run.owner_outcome_state
    || boundedResult.terminal_code !== run.terminal_code
    || boundedResult.transition_version !== run.transition_version
    || boundedResult.started_at !== run.started_at
    || boundedResult.completed_at !== run.completed_at
    || boundedResult.duration_ms !== run.duration_ms
    || boundedResult.retained_until !== run.retained_until) return null;
  const sequences = logs.map((entry) => (entry as RunDetailLogV1).sequence);
  if (new Set(sequences).size !== sequences.length
    || sequences.some((sequence, index) => index > 0 && sequence <= sequences[index - 1])) return null;
  return { ...typedEnvelope, run, bounded_result: boundedResult, logs: logs as RunDetailLogV1[],
    operational_cache: { state: "retained", deletion_receipt: null },
    operational_cancellation: cancellation };
}
