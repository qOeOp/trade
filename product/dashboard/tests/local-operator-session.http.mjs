import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import test from "node:test";

import { issueLocalOperatorSessionV1 } from "../lib/local-operator-session.ts";

const LOGIN = "http-login-proof-0123456789-abcdefghijklmnop";
const HMAC = "http-session-hmac-0123456789-abcdefghijklmnop";
const EFFECT_BEARER = "http-effect-bearer-0123456789-abcdefghijklmnop";

async function unusedPort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Dashboard exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/health/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Dashboard health timeout");
}

async function withDashboard(configuration, callback) {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn("npm", ["start", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN: configuration?.login ?? "",
      DASHBOARD_SESSION_HMAC_KEY: configuration?.hmac ?? "",
      DASHBOARD_OPERATOR_API_TOKEN: EFFECT_BEARER,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8_000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8_000); });
  try {
    await waitForHealth(origin, child);
    await callback(origin);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${logs}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

test("local operator session protects page and API end to end", async () => {
  await withDashboard({ login: LOGIN, hmac: HMAC }, async (origin) => {
    const page = await fetch(`${origin}/operations/`, { redirect: "manual" });
    assert.equal(page.status, 307);
    assert.match(page.headers.get("location") ?? "", /\/login\/?\?return_to=%2Foperations%2F&state=required/u);

    const api = await fetch(`${origin}/api/operations/runs/`, { redirect: "manual" });
    assert.equal(api.status, 401);

    const deniedOrigin = await fetch(`${origin}/api/auth/session/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: LOGIN }),
    });
    assert.equal(deniedOrigin.status, 403);

    const deniedCredential = await fetch(`${origin}/api/auth/session/`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ credential: `${LOGIN}-wrong` }),
    });
    assert.equal(deniedCredential.status, 401);
    assert.equal(deniedCredential.headers.get("set-cookie"), null);

    const login = await fetch(`${origin}/api/auth/session/`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ credential: LOGIN }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /trade_dashboard_session_v1=/u);
    assert.match(setCookie, /HttpOnly/iu);
    assert.match(setCookie, /SameSite=Strict/iu);
    assert.match(setCookie, /Path=\//iu);
    assert.match(setCookie, /Max-Age=28800/iu);
    assert.doesNotMatch(setCookie, /Secure/iu);
    const cookie = setCookie.split(";", 1)[0];

    const authenticated = await fetch(`${origin}/settings/access/`, { headers: { cookie }, redirect: "manual" });
    assert.equal(authenticated.status, 200);
    const session = await fetch(`${origin}/api/auth/session/`, { headers: { cookie } });
    assert.equal((await session.json()).authenticated, true);

    const loginProofAsEffectBearer = await fetch(`${origin}/api/operations/runs/`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${LOGIN}`,
        cookie,
        "content-type": "application/json",
        origin,
      },
      body: "{}",
    });
    assert.equal(loginProofAsEffectBearer.status, 401);
    assert.equal((await loginProofAsEffectBearer.json()).unavailable_reason, "OPERATOR_CAPABILITY_DENIED");

    const tampered = await fetch(`${origin}/operations/`, { headers: { cookie: `${cookie}x` }, redirect: "manual" });
    assert.equal(tampered.status, 307);
    assert.match(tampered.headers.get("set-cookie") ?? "", /Max-Age=0/iu);

    const expired = issueLocalOperatorSessionV1({
      nowEpochSeconds: Math.floor(Date.now() / 1_000) - 28_801,
      loginToken: LOGIN,
      hmacKey: HMAC,
    });
    assert.ok(expired);
    const expiredPage = await fetch(`${origin}/operations/`, {
      headers: { cookie: `trade_dashboard_session_v1=${expired.token}` },
      redirect: "manual",
    });
    assert.equal(expiredPage.status, 307);
    assert.match(expiredPage.headers.get("location") ?? "", /state=expired/u);
    const expiredLogin = await fetch(new URL(expiredPage.headers.get("location"), origin));
    assert.match(await expiredLogin.text(), /Session expired/u);

    const logout = await fetch(`${origin}/api/auth/session/`, {
      method: "DELETE",
      headers: { cookie, origin },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/iu);
  });
});

test("missing session configuration is a public login state and protected API 503", async () => {
  await withDashboard(null, async (origin) => {
    const session = await fetch(`${origin}/api/auth/session/`);
    assert.equal(session.status, 503);
    assert.equal((await session.json()).state, "configuration_unavailable");
    const api = await fetch(`${origin}/api/operations/runs/`, { redirect: "manual" });
    assert.equal(api.status, 503);
    const page = await fetch(`${origin}/operations/`, { redirect: "manual" });
    assert.equal(page.status, 307);
    assert.match(page.headers.get("location") ?? "", /state=configuration_unavailable/u);
    const unavailableLogin = await fetch(new URL(page.headers.get("location"), origin));
    const unavailableHtml = await unavailableLogin.text();
    assert.match(unavailableHtml, /Local access unavailable/u);
    assert.doesNotMatch(unavailableHtml, /Sign in required/u);
  });
});
