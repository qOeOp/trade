import {
  projectOwnerReadbackV1,
  type SourceInterpretationV1,
} from "../../rd-owner-client/source_intake_v1.ts";
import {
  PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1,
  type ProductEdgeExecutionRoutingV1,
} from "./product-edge-routing-client.ts";
import {
  rdOwnerJsonOutcomeV1,
  type RdOwnerHttpTransportV1,
} from "./rd-owner-http.ts";

export const SOURCE_INTAKE_EXECUTE_OPERATION = "source_intake.execute.v1" as const;
export const SOURCE_INTAKE_EFFECT_SET_V1 = ["R_AND_D_SOURCE_INTAKE_MUTATION_V1"] as const;

export const sourceIntakeOperationV1 = {
  schema_version: 1,
  operation_id: SOURCE_INTAKE_EXECUTE_OPERATION,
  owner_operation: "source_intake.openalex_work_by_doi.submit_or_resolve.v1",
  owner_schema: "rd-source-intake-terminal-v1",
  capability: "rd.source_intake.execute",
  effect_set: SOURCE_INTAKE_EFFECT_SET_V1,
  execution_boundary: "DISPOSABLE_LOCAL",
  recovery_identity_fields: ["request_identity"],
  routing_dependency_keys: [PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1],
  orchestration_contract: {
    identity: "dashboard-source-intake-orchestrator-v1",
    run_owner_route: "POST /v1/source-intakes",
    resolve_owner_route: "GET /v1/source-intakes/{request_identity}/readback",
    resolve_effects: 0,
  },
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

export type SourceIntakeExecutionInputV1 = {
  request_identity: string;
  normalized_doi: string;
  interpretation: SourceInterpretationV1;
};

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

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DOI = /^10\.[a-z0-9./\-_;():]{1,252}$/;

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && new TextEncoder().encode(value).byteLength <= 8_192 && !/\p{Cc}/u.test(value);
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

export function validSourceIntakeExecutionInputV1(
  value: SourceIntakeExecutionInputV1,
): boolean {
  const interpretation = value?.interpretation;
  return IDENTITY.test(value?.request_identity ?? "")
    && DOI.test(value?.normalized_doi ?? "")
    && validText(interpretation?.bounded_explanation)
    && validText(interpretation?.differentiating_prediction)
    && validText(interpretation?.falsifier)
    && Array.isArray(interpretation?.plausible_alternatives)
    && interpretation.plausible_alternatives.length >= 1
    && interpretation.plausible_alternatives.length <= 16
    && interpretation.plausible_alternatives.every(validText)
    && interpretation.plausible_alternatives.slice(1).every((item, index) =>
      compareUtf8(interpretation.plausible_alternatives[index], item) < 0);
}

function unavailable(reason: string): SourceIntakeExecutionResultV1 {
  return {
    availability: "unavailable",
    unavailable_reason: reason,
    owner_response: null,
    ancestry: null,
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
      ? "/v1/source-intakes"
      : `/v1/source-intakes/${encodeURIComponent(input.request_identity)}/readback`,
    method: action === "RUN" ? "POST" : "GET",
    body: action === "RUN" ? {
      request_identity: input.request_identity,
      channel: "WINDMILL_PRODUCT_EDGE",
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
  const ownerResponse = ownerOutcome.value;
  const projection = projectOwnerReadbackV1(ownerResponse, input.request_identity) as Record<string, unknown>;
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
      request_identity: input.request_identity,
      attempt_identity: projection.binding_identity,
      terminal_receipt_identity: (receipt as Record<string, unknown>).receipt_identity as string,
    },
  };
}
