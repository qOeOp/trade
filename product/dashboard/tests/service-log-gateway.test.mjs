import assert from "node:assert/strict";
import test from "node:test";

import {
  issueServiceLogCursorV1,
  parseServiceLogCursorV1,
  PostgresServiceLogGatewayV1,
} from "../lib/service-log-gateway.ts";

const key = "service-log-cursor-test-key-material-v1";
const digest = `sha256:${"a".repeat(64)}`;
const cursor = {
  schema_version: 1,
  filter_cut_digest: digest,
  observed_at: "2026-09-08T03:59:00.000Z",
  correlation_identity: "dashboard-run-v1-12345678-1234-4123-8123-123456789abc",
  sequence: 2,
};

test("service-log cursor is HMAC sealed and bound to one exact filter-cut digest", () => {
  const encoded = issueServiceLogCursorV1(cursor, key);
  assert.deepEqual(parseServiceLogCursorV1(encoded, key, digest), cursor);
  assert.equal(parseServiceLogCursorV1(encoded, key, `sha256:${"b".repeat(64)}`), null);
  const [payload, signature] = encoded.split(".");
  const tampered = `${payload}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  assert.equal(parseServiceLogCursorV1(tampered, key, digest), null);
  assert.equal(parseServiceLogCursorV1(encoded, "short", digest), null);
});

test("service-log gateway configuration fails before a database call", () => {
  assert.throws(() => new PostgresServiceLogGatewayV1(
    "postgres://localhost/trade", "invalid identity with spaces", key,
  ), { message: "SERVICE_LOG_CONFIGURATION_INVALID" });
  assert.throws(() => new PostgresServiceLogGatewayV1(
    "https://localhost/trade", "dashboard-server-1", key,
  ), { message: "SERVICE_LOG_CONFIGURATION_INVALID" });
  assert.throws(() => new PostgresServiceLogGatewayV1(
    "postgres://localhost/trade", "dashboard-server-1", "short",
  ), { message: "SERVICE_LOG_CONFIGURATION_INVALID" });
});
