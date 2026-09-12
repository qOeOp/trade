import { createHash } from "node:crypto";

import { isRunIdentityV1 } from "./run-contract.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,96}$/;
const RECEIPT_IDENTITY = /^dashboard-control-plane-admission-v1-[0-9a-f]{64}$/;

export const controlPlaneAdmissionOperationsV1 = [
  "artifact_build.formation_execute.v1",
  "source_intake.research.submit_or_resolve.v1",
] as const;

export type ControlPlaneAdmissionOperationV1 = typeof controlPlaneAdmissionOperationsV1[number];
export type ControlPlaneAdmissionExecutionModeV1 =
  | "FRESH_RUN"
  | "CONTINUE_CLAIMED_ONCE"
  | "RESOLVE_ONLY";

export type ControlPlaneAdmissionContextV1 = {
  authorizationDigest: string;
  principalRef: string;
  requestedAction: "RUN" | "RESOLVE";
};

export type ControlPlaneAdmissionReceiptV1 = {
  schema_version: 1;
  receipt_identity: string;
  admitted_at: string;
  principal_ref: string;
  operation: ControlPlaneAdmissionOperationV1;
  requested_action: "RUN" | "RESOLVE";
  execution_mode: ControlPlaneAdmissionExecutionModeV1;
  run_identity: string;
  authorization_digest: string;
};

function compatibleMode(
  operation: ControlPlaneAdmissionOperationV1,
  executionMode: ControlPlaneAdmissionExecutionModeV1,
) {
  return operation === "artifact_build.formation_execute.v1"
    || executionMode !== "CONTINUE_CLAIMED_ONCE";
}

export function validControlPlaneAdmissionContextV1(
  value: unknown,
): value is ControlPlaneAdmissionContextV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  const keys = Object.keys(context).sort();
  return keys.join(",") === "authorizationDigest,principalRef,requestedAction"
    && typeof context.authorizationDigest === "string" && DIGEST.test(context.authorizationDigest)
    && typeof context.principalRef === "string" && PRINCIPAL.test(context.principalRef)
    && ["RUN", "RESOLVE"].includes(String(context.requestedAction));
}

export function controlPlaneAdmissionReceiptIdentityV1({
  principalRef,
  operation,
  requestedAction,
  executionMode,
  runIdentity,
  authorizationDigest,
}: {
  principalRef: string;
  operation: ControlPlaneAdmissionOperationV1;
  requestedAction: "RUN" | "RESOLVE";
  executionMode: ControlPlaneAdmissionExecutionModeV1;
  runIdentity: string;
  authorizationDigest: string;
}) {
  if (!PRINCIPAL.test(principalRef)
    || !controlPlaneAdmissionOperationsV1.includes(operation)
    || !["RUN", "RESOLVE"].includes(requestedAction)
    || !["FRESH_RUN", "CONTINUE_CLAIMED_ONCE", "RESOLVE_ONLY"].includes(executionMode)
    || !compatibleMode(operation, executionMode)
    || !isRunIdentityV1(runIdentity)
    || !DIGEST.test(authorizationDigest)) {
    throw new Error("CONTROL_PLANE_ADMISSION_INVALID");
  }
  const canonical = {
    schema_version: 1,
    principal_ref: principalRef,
    operation,
    requested_action: requestedAction,
    execution_mode: executionMode,
    run_identity: runIdentity,
    authorization_digest: authorizationDigest,
  };
  return `dashboard-control-plane-admission-v1-${createHash("sha256")
    .update(JSON.stringify(canonical)).digest("hex")}`;
}

export function parseControlPlaneAdmissionReceiptV1(
  value: unknown,
): ControlPlaneAdmissionReceiptV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const expected = [
    "schema_version", "receipt_identity", "admitted_at", "principal_ref", "operation",
    "requested_action", "execution_mode", "run_identity", "authorization_digest",
  ].sort();
  const keys = Object.keys(row).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
    || row.schema_version !== 1
    || typeof row.receipt_identity !== "string" || !RECEIPT_IDENTITY.test(row.receipt_identity)
    || typeof row.admitted_at !== "string" || !Number.isFinite(Date.parse(row.admitted_at))
    || new Date(row.admitted_at).toISOString() !== row.admitted_at
    || typeof row.principal_ref !== "string" || !PRINCIPAL.test(row.principal_ref)
    || !controlPlaneAdmissionOperationsV1.includes(row.operation as ControlPlaneAdmissionOperationV1)
    || !["RUN", "RESOLVE"].includes(String(row.requested_action))
    || !["FRESH_RUN", "CONTINUE_CLAIMED_ONCE", "RESOLVE_ONLY"].includes(String(row.execution_mode))
    || !compatibleMode(
      row.operation as ControlPlaneAdmissionOperationV1,
      row.execution_mode as ControlPlaneAdmissionExecutionModeV1,
    )
    || typeof row.run_identity !== "string" || !isRunIdentityV1(row.run_identity)
    || typeof row.authorization_digest !== "string" || !DIGEST.test(row.authorization_digest)) return null;
  try {
    const expectedIdentity = controlPlaneAdmissionReceiptIdentityV1({
      principalRef: row.principal_ref,
      operation: row.operation as ControlPlaneAdmissionOperationV1,
      requestedAction: row.requested_action as "RUN" | "RESOLVE",
      executionMode: row.execution_mode as ControlPlaneAdmissionExecutionModeV1,
      runIdentity: row.run_identity,
      authorizationDigest: row.authorization_digest,
    });
    return expectedIdentity === row.receipt_identity ? row as ControlPlaneAdmissionReceiptV1 : null;
  } catch {
    return null;
  }
}
