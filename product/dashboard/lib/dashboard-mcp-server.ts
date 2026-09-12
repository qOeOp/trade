import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { preflightDisposableArtifactFormationV1 } from "./artifact-formation-client.ts";
import {
  handleArtifactFormationActionV1,
  handleDevelopComposerActionV2,
  handleExploratoryReplayActionV2,
  handleSourceResearchActionV1,
} from "./dashboard-operation-handler.ts";
import { dashboardMcpAuthorizationDigestV1 } from "./mcp-capability.ts";
import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";
import { validDevelopComposerIdentityV2 } from "./develop-composer-action-contract.ts";
import { readRunDetailGatewayV1 } from "./run-detail-gateway.ts";
import { readRunLogGatewayV1 } from "./run-log-gateway.ts";

const identity = z.string().regex(/^[A-Za-z0-9._:/-]{1,192}$/);
const replayIdentity = z.string().refine(validExploratoryReplayOpaqueIdentityV2);
const composerIdentity = z.string().refine(validDevelopComposerIdentityV2);
const digest = z.string().regex(/^(?:sha256|blake3):[0-9a-f]{64}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]*)$/).refine((value) => {
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
});
const contentIdentity = z.strictObject({ identity: replayIdentity, digest });
const versionedIdentity = z.strictObject({ identity: replayIdentity, version: replayIdentity });
const text = z.string().min(1).max(8_192).refine((value) => !/\p{Cc}/u.test(value));
const source = z.strictObject({
  request_identity: identity,
  normalized_doi: z.string().regex(/^10\.[a-z0-9./\-_;():]{1,252}$/),
  interpretation: z.strictObject({
    bounded_explanation: text,
    plausible_alternatives: z.array(text).min(1).max(16),
    differentiating_prediction: text,
    falsifier: text,
  }),
});
const research = z.strictObject({
  request_identity: identity,
  goal: z.strictObject({
    hypothesis: text,
    mechanism: text,
    falsification_question: text,
    expected_observation: text,
    required_data: z.array(text).min(1).max(64),
    cost_assumption: text,
    capacity_assumption: text,
  }),
  trial_family_proposal: z.strictObject({
    trial_budget: z.number().int().min(1).max(64),
    stop_rule: text,
    pit_rule_identity: text,
    cost_model_identity: text,
    slippage_model_identity: text,
    capacity_model_identity: text,
    independence_rationale: text,
  }),
});
const sourceResearchRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("RUN"), source, research }),
  z.strictObject({
    action: z.literal("RESOLVE"),
    source_request_identity: identity,
    research_request_identity: identity,
  }),
]);
const artifactRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("RUN"),
    build_request_identity: identity,
    attempt_identity: identity,
    research_request_identity: identity,
    identity_mode: z.literal("GENERATE"),
  }),
  z.strictObject({
    action: z.literal("RESOLVE"),
    build_request_identity: identity,
    attempt_identity: identity,
    research_request_identity: identity,
    identity_mode: z.literal("EXACT"),
  }),
]);
const exploratoryReplayRequest = z.strictObject({
  action: z.literal("RUN"),
  build_request_identity: replayIdentity,
  attempt_identity: replayIdentity,
  build_receipt_identity: replayIdentity,
  artifact_family_binding_identity: replayIdentity,
  request: z.strictObject({
    schema_version: z.literal(2),
    request_identity: replayIdentity,
    frozen_research_intent: contentIdentity,
    trial_family: contentIdentity,
    trial_family_census_frontier: contentIdentity,
    replay_authority: z.strictObject({ namespace: z.literal("EXPLORATORY") }),
    strategy_design: contentIdentity,
    strategy_plan: contentIdentity,
    artifact: contentIdentity,
    resolved_owner_inputs: contentIdentity,
    pit_scope: contentIdentity,
    pit_snapshot: contentIdentity,
    universe_selection: contentIdentity,
    correction_rule: versionedIdentity,
    market_semantics: versionedIdentity,
    replay_configuration: contentIdentity,
    models: z.strictObject({
      runtime_kernel: versionedIdentity,
      simulator: versionedIdentity,
      cost: versionedIdentity,
      slippage: versionedIdentity,
      capacity: versionedIdentity,
    }),
    runner_operational_profile: versionedIdentity,
    diagnostic_policy: versionedIdentity,
    deterministic_seed: u64,
    window: z.strictObject({
      start_event_ns: u64,
      end_event_ns_exclusive: u64,
    }).refine(({ start_event_ns, end_event_ns_exclusive }) => (
      BigInt(start_event_ns) < BigInt(end_event_ns_exclusive)
    )),
    calendar: versionedIdentity,
    session: versionedIdentity,
    time_zone: versionedIdentity,
    corporate_action_cut: contentIdentity,
    historical_membership_cut: contentIdentity,
  }),
});
const runIdentity = z.string().regex(/^dashboard-run-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

function toolResult(envelope: object, status: number) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope as Record<string, unknown>,
    isError: status >= 400,
  };
}

function actionContext(authInfo: AuthInfo, action: "RUN" | "RESOLVE") {
  return {
    authorizationDigest: dashboardMcpAuthorizationDigestV1(authInfo.token),
    principalRef: authInfo.clientId,
    requestedAction: action,
  };
}

export function createDashboardMcpServerV1(authInfo: AuthInfo): McpServer {
  const server = new McpServer({ name: "trade-dashboard", version: "1.0.0" });
  server.registerTool("dashboard_artifact_preflight_v1", {
    description: "Read the exact current Artifact Formation preflight for one Research request.",
    inputSchema: z.strictObject({ research_request_identity: identity }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async ({ research_request_identity }) => {
    const result = await preflightDisposableArtifactFormationV1({ researchRequestIdentity: research_request_identity });
    return toolResult(result.envelope, result.status);
  });
  server.registerTool("dashboard_artifact_action_v1", {
    description: "Enqueue one admitted Artifact RUN or perform an effect-free exact RESOLVE.",
    inputSchema: artifactRequest,
  }, async (request) => {
    const result = await handleArtifactFormationActionV1({
      request,
      actionContext: actionContext(authInfo, request.action),
    });
    return toolResult(result.envelope, result.status);
  });
  server.registerTool("dashboard_source_research_action_v1", {
    description: "Enqueue one admitted ordered Source/Research RUN or perform an effect-free exact RESOLVE.",
    inputSchema: sourceResearchRequest,
  }, async (request) => {
    const result = await handleSourceResearchActionV1({
      request,
      actionContext: actionContext(authInfo, request.action),
    });
    return toolResult(result.envelope, result.status);
  });
  server.registerTool("dashboard_exploratory_replay_action_v2", {
    description: "Enqueue one admitted lossless Replay V2 Owner request submission-or-resolution run.",
    inputSchema: exploratoryReplayRequest,
  }, async (request) => {
    const result = await handleExploratoryReplayActionV2({
      request,
      actionContext: actionContext(authInfo, "RUN"),
    });
    return toolResult(result.envelope, result.status);
  });
  server.registerTool("dashboard_develop_composer_action_v2", {
    description: "Enqueue one admitted Develop Composer projection-resolve-submit-if-absent run.",
    inputSchema: z.strictObject({
      action: z.literal("RUN"),
      research_request_locator: composerIdentity,
    }),
  }, async (request) => {
    const result = await handleDevelopComposerActionV2({
      request,
      actionContext: actionContext(authInfo, "RUN"),
    });
    return toolResult(result.envelope, result.status);
  });
  server.registerTool("dashboard_run_detail_read_v1", {
    description: "Read one exact bounded operational RunStore detail.",
    inputSchema: z.strictObject({ run_identity: runIdentity }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async ({ run_identity }) => {
    const result = await readRunDetailGatewayV1(run_identity);
    return toolResult(result.envelope, result.status);
  });
  server.registerTool("dashboard_run_logs_read_v1", {
    description: "Read one exact bounded page of code-only operational logs.",
    inputSchema: z.strictObject({
      run_identity: runIdentity,
      level: z.enum(["all", "info", "warning", "error"]).default("all"),
      source: z.enum([
        "all", "run_store", "dashboard_bff", "owner_gateway", "shadow_worker",
        "artifact_orchestrator", "source_research_orchestrator", "effect_worker",
      ]).default("all"),
      query: z.string().max(160).default(""),
      cursor: z.string().min(32).max(1_024).optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async ({ run_identity, level, source: logSource, query, cursor }) => {
    const search = new URLSearchParams({ level, source: logSource, query });
    if (cursor) search.set("cursor", cursor);
    const result = await readRunLogGatewayV1({ runIdentity: run_identity, search });
    return toolResult(result.envelope, result.status);
  });
  return server;
}
