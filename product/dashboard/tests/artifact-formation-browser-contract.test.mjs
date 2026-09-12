import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArtifactFormationBrowserStateV1,
  parseArtifactFormationPreflightBrowserStateV1,
} from "../lib/artifact-formation-browser-contract.ts";

const research = "research-request-1";
const build = "artifact-build-request-v1-1";
const attempt = "artifact-build-attempt-v1-1";

const emptyRun = {
  schema_version: 1,
  availability: "unavailable",
  unavailable_reason: "RUN_STORE_CONFIGURATION_UNAVAILABLE",
  run_identity: null,
  state: null,
  owner_outcome_state: null,
  transition_version: null,
};

const projection = {
  schema_version: 1,
  consumer_projection: {
    schema_version: 1,
    operation: "artifact_build.consumer_projection.v1",
    owner_operation: "artifact_build.submit_or_resolve.v1",
    owner_schema: "rd-artifact-build-request-v1",
  },
  resolution: "SUBMITTED_OR_UNKNOWN",
  build_request_identity: build,
  attempt_identity: attempt,
  owner_receipt: null,
  research_view: null,
  artifact_review: null,
  artifact_review_actions: null,
  trial_family_resolution: null,
  artifact_trial_family: null,
  provider_invocation: null,
  next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
};

test("preflight parser accepts only the exact disposable READY envelope", () => {
  const ready = {
    schema_version: 1,
    operation: "artifact_build.formation_execute.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    phase: "PREFLIGHT",
    availability: "available",
    unavailable_reason: null,
    research_request_identity: research,
    action_state: "READY",
  };
  assert.equal(parseArtifactFormationPreflightBrowserStateV1(ready, research)?.actionState, "READY");
  assert.equal(parseArtifactFormationPreflightBrowserStateV1({ ...ready, extra: true }, research), null);
  assert.equal(parseArtifactFormationPreflightBrowserStateV1({ ...ready, research_request_identity: "other" }, research), null);
  assert.equal(parseArtifactFormationPreflightBrowserStateV1({
    ...ready,
    availability: "unavailable",
    unavailable_reason: "EXECUTION_PREFLIGHT_UNAVAILABLE",
  }, research), null);
});

test("formation parser retains the exact attempt for unknown outcome", () => {
  const parsed = parseArtifactFormationBrowserStateV1({
    schema_version: 1,
    operation: "artifact_build.formation_execute.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    availability: "available",
    unavailable_reason: null,
    projection,
    operational_run: {
      schema_version: 1,
      availability: "available",
      unavailable_reason: null,
      run_identity: "dashboard-run-v1-11111111-1111-4111-8111-111111111111",
      state: "running",
      owner_outcome_state: "unknown",
      transition_version: 4,
    },
  }, build, attempt);
  assert.equal(parsed?.resolution, "SUBMITTED_OR_UNKNOWN");
  assert.equal(parsed?.buildRequestIdentity, build);
  assert.equal(parsed?.attemptIdentity, attempt);
});

test("formation parser fails closed on identity drift and malformed projections", () => {
  const envelope = {
    schema_version: 1,
    operation: "artifact_build.formation_execute.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    availability: "available",
    unavailable_reason: null,
    projection,
    operational_run: emptyRun,
  };
  assert.equal(parseArtifactFormationBrowserStateV1(envelope, "different", attempt), null);
  assert.equal(parseArtifactFormationBrowserStateV1({
    ...envelope,
    projection: { ...projection, extra: true },
  }, build, attempt), null);
});
