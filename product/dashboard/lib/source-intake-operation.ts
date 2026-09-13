import {
  projectOwnerReadbackV1,
} from "../../rd-owner-client/source_intake_v1.ts";
import {
  PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1,
  type ProductEdgeExecutionRoutingV1,
} from "./product-edge-routing-client.ts";
import {
  rdOwnerJsonOutcomeV1,
  type RdOwnerHttpTransportV1,
} from "./rd-owner-http.ts";
import {
  validSourceIntakeExecutionInputV1,
  type SourceIntakeExecutionInputV1,
} from "./source-research-input-contract.ts";

export { validSourceIntakeExecutionInputV1 } from "./source-research-input-contract.ts";
export type { SourceIntakeExecutionInputV1 } from "./source-research-input-contract.ts";

export const SOURCE_INTAKE_EXECUTE_OPERATION = "source_intake.execute.v1" as const;
export const SOURCE_INTAKE_EFFECT_SET_V1 = ["R_AND_D_SOURCE_INTAKE_MUTATION_V1"] as const;

export const sourceIntakeOperationV1 = {
  schema_version: 1,
  operation_id: SOURCE_INTAKE_EXECUTE_OPERATION,
  owner_operation: "source_intake.openalex_work_by_doi.submit_or_resolve.v2",
  owner_schema: "rd-source-intake-terminal-v1",
  capability: "rd.source_intake.execute",
  effect_set: SOURCE_INTAKE_EFFECT_SET_V1,
  dependency_operation_ids: [],
  execution_boundary: "DISPOSABLE_LOCAL",
  recovery_identity_fields: ["request_identity"],
  routing_dependency_keys: [PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1],
  orchestration_contract: {
    identity: "dashboard-source-intake-orchestrator-v1",
    run_owner_route: "POST /v2/source-intakes",
    resolve_owner_route: "GET /v1/source-intakes/{request_identity}/readback",
    resolve_effects: 0,
  },
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

export type SourceIntakeExecutionResultV1 = {
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  owner_response: Record<string, unknown> | null;
  ancestry: {
    request_identity: string;
    attempt_identity: string;
    terminal_receipt_identity: string;
  } | null;
};

function unavailable(reason: string): SourceIntakeExecutionResultV1 {
  return {
    availability: "unavailable",
    unavailable_reason: reason,
    owner_response: null,
    ancestry: null,
  };
}

function availableReadback(
  ownerResponse: Record<string, unknown>,
  requestIdentity: string,
): SourceIntakeExecutionResultV1 {
  const projection = projectOwnerReadbackV1(ownerResponse, requestIdentity) as Record<string, unknown>;
  const receipt = projection.receipt;
  if (projection.resolution !== "RETRIEVED"
    || typeof projection.binding_identity !== "string"
    || receipt === null || typeof receipt !== "object" || Array.isArray(receipt)
    || typeof (receipt as Record<string, unknown>).receipt_identity !== "string") {
    return unavailable("SOURCE_TERMINAL_UNAVAILABLE");
  }
  return {
    availability: "available",
    unavailable_reason: null,
    owner_response: ownerResponse,
    ancestry: {
      request_identity: requestIdentity,
      attempt_identity: projection.binding_identity,
      terminal_receipt_identity: (receipt as Record<string, unknown>).receipt_identity as string,
    },
  };
}

export async function executeSourceIntakeOperationV1({
  action,
  input,
  transport,
  routing,
}: {
  action: "RUN" | "RESOLVE";
  input: SourceIntakeExecutionInputV1;
  transport: RdOwnerHttpTransportV1;
  routing: ProductEdgeExecutionRoutingV1;
}): Promise<SourceIntakeExecutionResultV1> {
  if (!validSourceIntakeExecutionInputV1(input)) {
    return unavailable("SOURCE_EXECUTION_REQUEST_INVALID");
  }
  if (action === "RUN"
    && (routing.state !== "ACTIVE" || routing.dispatcher !== "TRADE_DASHBOARD")) {
    return unavailable("SOURCE_EXECUTION_ROUTING_UNAVAILABLE");
  }
  const ownerOutcome = await rdOwnerJsonOutcomeV1({
    transport,
    path: action === "RUN"
      ? "/v2/source-intakes"
      : `/v1/source-intakes/${encodeURIComponent(input.request_identity)}/readback`,
    method: action === "RUN" ? "POST" : "GET",
    body: action === "RUN" ? {
      request_identity: input.request_identity,
      normalized_doi: input.normalized_doi,
      interpretation: input.interpretation,
    } : undefined,
    tradeDashboardDispatcher: action === "RUN",
  });
  if (ownerOutcome.state === "ABSENT") {
    return unavailable(action === "RESOLVE"
      ? "SOURCE_OWNER_ABSENT"
      : "SOURCE_OWNER_RESPONSE_UNAVAILABLE");
  }
  if (ownerOutcome.state === "UNKNOWN") {
    return unavailable("SOURCE_OWNER_UNKNOWN");
  }
  if (ownerOutcome.state !== "AVAILABLE") return unavailable("SOURCE_OWNER_RESPONSE_UNAVAILABLE");
  return availableReadback(ownerOutcome.value, input.request_identity);
}

export async function resolveSourceIntakeOperationV1({
  requestIdentity,
  transport,
}: {
  requestIdentity: string;
  transport: RdOwnerHttpTransportV1;
}): Promise<SourceIntakeExecutionResultV1> {
  if (!/^[A-Za-z0-9._:/-]{1,192}$/.test(requestIdentity)) {
    return unavailable("SOURCE_EXECUTION_REQUEST_INVALID");
  }
  const ownerOutcome = await rdOwnerJsonOutcomeV1({
    transport,
    path: `/v1/source-intakes/${encodeURIComponent(requestIdentity)}/readback`,
    method: "GET",
  });
  if (ownerOutcome.state === "ABSENT") return unavailable("SOURCE_OWNER_ABSENT");
  if (ownerOutcome.state === "UNKNOWN") return unavailable("SOURCE_OWNER_UNKNOWN");
  if (ownerOutcome.state !== "AVAILABLE") return unavailable("SOURCE_OWNER_RESPONSE_UNAVAILABLE");
  return availableReadback(ownerOutcome.value, requestIdentity);
}
