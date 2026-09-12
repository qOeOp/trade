import assert from "node:assert/strict";
import test from "node:test";

import {
  issueLocalOperatorSessionV1,
  LOCAL_OPERATOR_PRINCIPAL,
  LOCAL_OPERATOR_SESSION_TTL_SECONDS,
  readLocalOperatorSessionV1,
  verifyLocalOperatorCredentialV1,
} from "../lib/local-operator-session.ts";
import { sameOriginRequestV1, secureCookieForRequestV1 } from "../lib/local-operator-request.ts";

const LOGIN = "login-proof-0123456789-abcdefghijklmnop";
const HMAC = "session-hmac-0123456789-abcdefghijklmnop";
const NOW = 1_800_000_000;
const SESSION_IDENTITY = "86b02d30-3f0c-4ef1-b828-9153e0525bc8";

test("local credential is bounded and independent from session signing", () => {
  assert.equal(verifyLocalOperatorCredentialV1(LOGIN, LOGIN, HMAC), "available");
  assert.equal(verifyLocalOperatorCredentialV1(`${LOGIN}-wrong`, LOGIN, HMAC), "denied");
  assert.equal(verifyLocalOperatorCredentialV1(LOGIN, "short", HMAC), "configuration_unavailable");
  assert.equal(verifyLocalOperatorCredentialV1(LOGIN, LOGIN, "short"), "configuration_unavailable");
});

test("signed local session is exact, finite and invalidated by tamper or rotation", () => {
  const issued = issueLocalOperatorSessionV1({
    nowEpochSeconds: NOW,
    loginToken: LOGIN,
    hmacKey: HMAC,
    sessionIdentity: SESSION_IDENTITY,
  });
  assert.ok(issued);
  assert.equal(issued.state.principal_ref, LOCAL_OPERATOR_PRINCIPAL);
  assert.equal(
    Date.parse(issued.state.expires_at) - Date.parse(issued.state.issued_at),
    LOCAL_OPERATOR_SESSION_TTL_SECONDS * 1_000,
  );
  assert.equal(issued.token.includes(LOGIN), false);
  assert.equal(issued.token.includes(HMAC), false);

  assert.equal(readLocalOperatorSessionV1(issued.token, {
    nowEpochSeconds: NOW + 1,
    loginToken: LOGIN,
    hmacKey: HMAC,
  }).state, "authenticated");
  assert.equal(readLocalOperatorSessionV1(`${issued.token}x`, {
    nowEpochSeconds: NOW + 1,
    loginToken: LOGIN,
    hmacKey: HMAC,
  }).state, "invalid");
  assert.equal(readLocalOperatorSessionV1(issued.token, {
    nowEpochSeconds: NOW + 1,
    loginToken: `${LOGIN}-rotated`,
    hmacKey: HMAC,
  }).state, "invalid");
  assert.equal(readLocalOperatorSessionV1(issued.token, {
    nowEpochSeconds: NOW + 1,
    loginToken: LOGIN,
    hmacKey: `${HMAC}-rotated`,
  }).state, "invalid");
  assert.equal(readLocalOperatorSessionV1(issued.token, {
    nowEpochSeconds: NOW + LOCAL_OPERATOR_SESSION_TTL_SECONDS,
    loginToken: LOGIN,
    hmacKey: HMAC,
  }).state, "expired");
});

test("missing session and configuration fail closed", () => {
  assert.equal(readLocalOperatorSessionV1(undefined, { loginToken: LOGIN, hmacKey: HMAC }).state, "required");
  assert.equal(readLocalOperatorSessionV1(undefined, { loginToken: undefined, hmacKey: undefined }).state, "configuration_unavailable");
});

test("session mutations require exact same origin", () => {
  assert.equal(sameOriginRequestV1(new Request("http://127.0.0.1:3100/api/auth/session", {
    headers: { origin: "http://127.0.0.1:3100" },
  })), true);
  assert.equal(sameOriginRequestV1(new Request("http://127.0.0.1:3100/api/auth/session", {
    headers: { origin: "http://localhost:3100" },
  })), false);
  assert.equal(sameOriginRequestV1(new Request("http://127.0.0.1:3100/api/auth/session")), false);
  assert.equal(secureCookieForRequestV1(new Request("https://dashboard.local/api/auth/session")), true);
  assert.equal(secureCookieForRequestV1(new Request("http://dashboard.local/api/auth/session", {
    headers: { "x-forwarded-proto": "https" },
  })), true);
});
