import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [proxy, layout, login, access, sessionRoute, healthRoute, navigation, compose, readme, english, chinese] = await Promise.all([
  readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/(dashboard)/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/local-operator-login.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/local-operator-access.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/session/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/navigation.js", import.meta.url), "utf8"),
  readFile(new URL("../../rd-workbench/docker-compose.yml", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
  readFile(new URL("../../../docs/guide/dashboard.md", import.meta.url), "utf8"),
  readFile(new URL("../../../docs/guide/dashboard.zh.md", import.meta.url), "utf8"),
]);

test("browser session guard has only the admitted public endpoints", () => {
  assert.match(proxy, /PUBLIC_PATHS = new Set\(\["\/login", "\/api\/auth\/session", "\/api\/health"\]\)/u);
  assert.match(proxy, /PUBLIC_ASSETS = new Set\(\["\/icon\.svg", "\/favicon\.ico"\]\)/u);
  assert.doesNotMatch(proxy, /\\\.\[a-z0-9\]/u);
  assert.match(proxy, /readLocalOperatorSessionV1/u);
  assert.match(proxy, /status: state\.state === "configuration_unavailable" \? 503 : 401/u);
  assert.match(layout, /readLocalOperatorSessionV1/u);
  assert.match(layout, /redirect\(`\/login\?state=\$\{session\.state\}`\)/u);
});

test("login is a real local credential surface without fake account providers", () => {
  assert.match(login, /fetch\("\/api\/auth\/session"/u);
  assert.match(login, /function admittedInitialState[\s\S]+Object\.hasOwn\(copyByState, value\)/u);
  assert.match(login, /method: "POST"/u);
  assert.match(login, /type="password"/u);
  assert.doesNotMatch(login, /Google|GitHub|create an account|Terms of Service/u);
  assert.match(sessionRoute, /httpOnly: true/u);
  assert.match(sessionRoute, /sameSite: "strict"/u);
  assert.match(sessionRoute, /sameOriginRequestV1/u);
  assert.match(sessionRoute, /SESSION_CREDENTIAL_DENIED/u);
});

test("Access reuses shared atoms and keeps non-session authority unavailable", () => {
  assert.match(navigation, /"\/settings\/access"[\s\S]+IMPLEMENTATION_ADMITTED - LOCAL_SESSION_READ_ONLY/u);
  for (const atom of ["PanelFrame", "PanelFrameHeader", "PanelFrameBody", "FactGroupGrid", "FactGroup", "FactItem", "StatusBadge", "Button"]) {
    assert.match(access, new RegExp(`<${atom}\\b`, "u"));
  }
  assert.match(access, /Operator Authorization[\s\S]+unavailable/u);
  assert.match(access, /Transport token[\s\S]+not admitted/u);
  assert.match(access, /PanelFrameInfoFact label="Session identity"/u);
  assert.doesNotMatch(access, /Issue narrow|Revoke token|Select replacement/u);
});

test("Compose scopes session secrets to web and uses a zero-data health route", () => {
  assert.equal(compose.match(/^\s{6}DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN:/gmu)?.length, 1);
  assert.equal(compose.match(/^\s{6}DASHBOARD_SESSION_HMAC_KEY:/gmu)?.length, 1);
  assert.match(compose, /dashboard-web:[\s\S]+DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN:[\s\S]+DASHBOARD_SESSION_HMAC_KEY:[\s\S]+fetch\('http:\/\/127\.0\.0\.1:3100\/api\/health\/'\)/u);
  assert.match(healthRoute, /schema_version: 1, status: "ok"/u);
  assert.doesNotMatch(healthRoute, /Owner|RunStore|database|Windmill/u);
});

test("bilingual architecture and package boundary admit the same narrow slice", () => {
  assert.match(english, /## Bounded admission: local operator browser session[\s\S]+DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN[\s\S]+DASHBOARD_SESSION_HMAC_KEY/u);
  assert.match(chinese, /## 有界准入：本地 Operator 浏览器会话[\s\S]+DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN[\s\S]+DASHBOARD_SESSION_HMAC_KEY/u);
  assert.match(readme, /browser session is not an effect capability/u);
  assert.match(readme, /DASHBOARD_OPERATOR_API_TOKEN.*independently required/u);
});
