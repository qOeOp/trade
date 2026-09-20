import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";
import {
  dedicatedDashboardReadApiTargetV1,
  ownerApiTargetForOperationV1,
} from "../lib/owner-api-target.ts";

test("Dedicated Dashboard reads never borrow write-side configuration", () => {
  assert.deepEqual(dedicatedDashboardReadApiTargetV1({
    RD_OWNER_API_URL: "http://owner-write:8080",
    RD_OWNER_API_TOKEN: "write-token",
  }), { baseUrl: undefined, token: undefined });
});

test("Formation, Iteration and Historical custody use the consolidated Dashboard reader", () => {
  const environment = {
    RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082",
    RD_DASHBOARD_OWNER_READ_API_TOKEN: "dashboard-token",
    // Historical custody used to read a pair of its own, and the deployed composition left that
    // pair empty, so it fell through to the write API. Naming the write API here keeps that
    // fall-through from coming back unnoticed: it must not be chosen while the read pair is whole.
    RD_OWNER_API_URL: "http://owner-write:8080",
    RD_OWNER_API_TOKEN: "write-token",
  };
  for (const operation of [
    RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
    RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
    RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  ]) {
    assert.deepEqual(ownerApiTargetForOperationV1(operation, environment), {
      baseUrl: "http://dashboard-read:8082",
      token: "dashboard-token",
    });
  }
});

test("Artifact shadow read uses only the atomic consolidated Dashboard read target", () => {
  assert.deepEqual(ownerApiTargetForOperationV1(ARTIFACT_SHADOW_RESOLVE_OPERATION, {
    RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082",
    RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-token",
    RD_OWNER_API_URL: "http://owner-write:8080",
    RD_OWNER_API_TOKEN: "write-token",
  }), { baseUrl: "http://dashboard-read:8082", token: "read-token" });

  assert.deepEqual(ownerApiTargetForOperationV1(ARTIFACT_SHADOW_RESOLVE_OPERATION, {
    RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082",
    RD_OWNER_API_URL: "http://owner-write:8080",
    RD_OWNER_API_TOKEN: "write-token",
  }), { baseUrl: "http://dashboard-read:8082", token: undefined });

  assert.deepEqual(ownerApiTargetForOperationV1(ARTIFACT_SHADOW_RESOLVE_OPERATION, {
    RD_OWNER_API_URL: "http://owner-write:8080",
    RD_OWNER_API_TOKEN: "write-token",
  }), { baseUrl: "http://owner-write:8080", token: "write-token" });
});
