import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
  operationDispatchBindingForIdV1,
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "./operation-registry.ts";
import { resolveExploratoryReplayShadowV2 } from "./exploratory-replay-readback-client.ts";
import {
  resolveArtifactShadowV1,
  resolveResearchShadowV1,
  resolveSourceIntakeShadowV1,
} from "./rd-shadow-client.ts";
import { resolveRdFormationCatalogShadowV1 } from "./rd-formation-catalog-client.ts";
import { resolveHistoricalCustodyShadowV1 } from "./rd-historical-custody-client.ts";
import { resolveRdIterationTimelineShadowV1 } from "./rd-iteration-timeline-client.ts";
import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import type {
  OperationRunV1,
  PostgresRunStoreV1,
  ShadowReadClaimV1,
} from "./run-store.ts";
import type { RunTerminalCodeV1 } from "./run-contract.ts";
import { ownerOutcomeForShadowResultV1 } from "./shadow-run-journal.ts";

type Fetcher = typeof fetch;
type WorkerEnvironment = Record<string, string | undefined>;

export type ShadowDispatchExecutionV1 = {
  schema_version: 1;
  run: OperationRunV1;
  owner_outcome_state: OperationRunV1["owner_outcome_state"];
  terminal_code: RunTerminalCodeV1;
};

export async function executeClaimedShadowReadV1({
  claim,
  workerIdentity,
  store,
  environment = process.env,
  fetcher = fetch,
  nowEpochMs = Date.now(),
  clock = Date.now,
}: {
  claim: ShadowReadClaimV1;
  workerIdentity: string;
  store: Pick<PostgresRunStoreV1, "completeClaimedRead">;
  environment?: WorkerEnvironment;
  fetcher?: Fetcher;
  nowEpochMs?: number;
  clock?: () => number;
}): Promise<ShadowDispatchExecutionV1> {
  const currentBinding = operationDispatchBindingForIdV1(
    claim.run.operation_id,
    environment,
    nowEpochMs,
  );
  if (!currentBinding || claim.registry_entry_digest !== currentBinding.registry_entry_digest
    || claim.compatibility_envelope_set_digest
      !== currentBinding.compatibility_envelope_set_digest) {
    const run = await store.completeClaimedRead({
      runIdentity: claim.run.run_identity,
      workerIdentity,
      claimToken: claim.claim_token,
      expectedTransitionVersion: claim.run.transition_version,
      operationalState: "failed",
      ownerOutcomeState: "unavailable",
      terminalCode: "DEPLOYMENT_UNAVAILABLE",
    });
    return {
      schema_version: 1,
      run,
      owner_outcome_state: "unavailable",
      terminal_code: "DEPLOYMENT_UNAVAILABLE",
    };
  }

  const recovery = claim.run.recovery_identity;
  const owner = ownerApiTargetForOperationV1(claim.run.operation_id, environment);
  const baseUrl = owner.baseUrl;
  const token = owner.token;
  const result = claim.run.operation_id === RESEARCH_SHADOW_RESOLVE_OPERATION
    ? await resolveResearchShadowV1({
      requestIdentity: recovery.request_identity,
      baseUrl,
      token,
      fetcher,
    })
    : claim.run.operation_id === RD_FORMATION_CATALOG_SHADOW_READ_OPERATION
      ? await resolveRdFormationCatalogShadowV1({ baseUrl, token, fetcher, now: clock })
      : claim.run.operation_id === RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION
        ? await resolveHistoricalCustodyShadowV1({ baseUrl, token, fetcher, now: clock })
      : claim.run.operation_id === RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION
        ? await resolveRdIterationTimelineShadowV1({
          trialFamilyIdentity: recovery.trial_family_identity,
          baseUrl,
          token,
          fetcher,
          now: clock,
        })
      : claim.run.operation_id === SOURCE_INTAKE_SHADOW_READ_OPERATION
      ? await resolveSourceIntakeShadowV1({
        requestIdentity: recovery.request_identity,
        baseUrl,
        token,
        fetcher,
      })
      : claim.run.operation_id === ARTIFACT_SHADOW_RESOLVE_OPERATION
        ? await resolveArtifactShadowV1({
          researchRequestIdentity: recovery.research_request_identity,
          buildRequestIdentity: recovery.build_request_identity,
          attemptIdentity: recovery.attempt_identity,
          baseUrl,
          token,
          fetcher,
        })
        : claim.run.operation_id === EXPLORATORY_REPLAY_SHADOW_READ_OPERATION
          ? await resolveExploratoryReplayShadowV2({
            requestIdentity: recovery.request_identity,
            meaningDigest: recovery.meaning_digest,
            baseUrl,
            token,
            fetcher,
          })
        : null;
  if (!result) throw new Error("DISPATCH_OPERATION_UNREGISTERED");
  const outcome = ownerOutcomeForShadowResultV1(result);
  const run = await store.completeClaimedRead({
    runIdentity: claim.run.run_identity,
    workerIdentity,
    claimToken: claim.claim_token,
    expectedTransitionVersion: claim.run.transition_version,
    ownerOutcomeState: outcome.state,
    terminalCode: outcome.terminalCode,
  });
  return {
    schema_version: 1,
    run,
    owner_outcome_state: outcome.state,
    terminal_code: outcome.terminalCode,
  };
}
