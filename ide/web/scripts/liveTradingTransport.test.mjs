import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { loader } from "./load.mjs";

const ok = (data, status = 200) => new Response(JSON.stringify({ ok: true, data }), { status, headers: { "content-type": "application/json" } });
const refused = (code, status = 400) => new Response(JSON.stringify({ ok: false, error: { code, message: "Safe service message" } }), { status });
const done = (call, action, subject = {}) => ok({ request_id: call.body.request_id, action, ...subject });
async function harness(saved = new Map(), stateMode = false) {
  const calls = [], observations = [], errors = [], meta = { content: "old-nonce" };
  let count = 0, handler = () => refused("UNEXPECTED");
  const timers = [];
  const context = createContext({
    Headers, Response, console,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`, getRandomValues: (bytes) => bytes.fill(3) },
    document: { querySelector: () => meta, hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
    window: { setTimeout: (callback) => timers.push(callback), clearTimeout: () => {}, sessionStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) } },
    fetch: async (url, init) => { const call = { url, method: init.method, token: init.headers?.get?.("x-trade-paper-token"), body: init.body === undefined ? null : JSON.parse(init.body) }; calls.push(call); return handler(call); },
  });
  const graph = loader({ context });
  const commands = await graph.namespace(stateMode ? "state/liveTrading.ts" : "lib/liveTradingCommands.ts");
  const client = stateMode ? null : commands.createLiveCommands({ onRequest: (v) => observations.push(v), onError: (e) => errors.push(e), refresh: async () => {} });
  return {
    client, commands, state: stateMode ? commands : null, timers, calls, observations, errors, saved, meta, handle: (next) => { handler = next; },
    api: graph.loaded("lib/liveTradingApi.ts"),
  };
}

test("Live double-click shares one POST with the explicitly confirmed source hash", async () => {
  const h = await harness(); let reply;
  h.handle(() => new Promise((resolve) => { reply = resolve; }));
  const first = h.client.invoke("start", "/runs/run-a/start", { run_id: "run-a" }, () => ({ confirm_real_orders: "exact-source-hash" }));
  const second = h.client.invoke("start", "/runs/run-a/start", { run_id: "run-a" }, () => { throw new Error("second payload must not run"); });
  assert.equal(first, second);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.confirm_real_orders, "exact-source-hash");
  reply(done(h.calls[0], "start", { run_id: "run-a" }));
  assert.equal((await first).outcome, "effect_recorded");
  assert.equal(h.observations.at(-1).outcome, "effect_recorded");
});

test("a save with no reply stores nothing, sends nothing by itself, and Send again repeats it once with its ID", async () => {
  const h = await harness();
  h.handle(() => { throw new Error("fictional-secret-in-a-raw-error"); });
  const lost = await h.client.invoke("credential_save", "/credentials", {}, () => ({ api_key: "fictional-key", api_secret: "fictional-secret" }));
  assert.equal(lost.outcome, "no_reply");
  assert.equal(h.saved.size, 0);
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.errors.map((e) => e.message).join(" ") + JSON.stringify(h.observations), /fictional-key|fictional-secret/);
  h.handle((call) => done(call, "credential_save", { credential_ref: "fictional-reference" }));
  const again = await h.client.resend(lost.request_id);
  assert.deepEqual(h.calls[1].body, h.calls[0].body);
  assert.equal(again.request_id, lost.request_id);
  assert.equal(again.outcome, "effect_recorded");
  assert.equal(again.target.credential_ref, "fictional-reference");
  assert.equal(await h.client.resend(lost.request_id), null, "a reply drops the body");
  assert.equal(h.calls.length, 2);
});

test("nonce renewal is the only POST retry and preserves the complete original body", async () => {
  const h = await harness();
  h.handle((call) => h.calls.length === 1
    ? new Response("{}", { status: 403, headers: { "x-trade-paper-token": "renewed" } })
    : done(call, "stop", { run_id: "run-a" }));
  await h.client.invoke("stop", "/runs/run-a/stop", { run_id: "run-a" }, () => ({}));
  assert.deepEqual(h.calls.map((c) => c.token), ["old-nonce", "renewed"]);
  assert.deepEqual(h.calls[0].body, h.calls[1].body);
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 2);
});

test("session expiry, an unreadable reply, a foreign receipt or Live's unconfirmed record is no reply, never resent by itself", async () => {
  const cases = [() => new Response("Login", { status: 401 }), () => new Response("not json", { status: 200 }),
    () => ok({ request_id: "web-different", action: "preflight", run_id: "run-a" }), () => refused("LIVE_RECORD_UNAVAILABLE", 500)];
  for (const reply of cases) {
    const h = await harness(); h.handle(reply);
    const request = await h.client.invoke("preflight", "/runs/run-a/preflight", { run_id: "run-a" }, () => ({}));
    assert.equal(request.outcome, "no_reply");
    assert.equal(h.calls.length, 1);
  }
});

test("a refusal is Live's answer: no Send again holds its body", async () => {
  for (const status of [400, 409, 503]) {
    const h = await harness(); h.handle(() => refused("LIVE_REQUEST_CONFLICT", status));
    const request = await h.client.invoke("credential_save", "/credentials", {}, () => ({ api_key: "dummy-key", api_secret: "dummy-secret" }));
    assert.equal(request.outcome, "refused");
    assert.equal(request.code, "LIVE_REQUEST_CONFLICT");
    assert.equal(await h.client.resend(request.request_id), null);
    assert.equal(h.calls.length, 1);
  }
});

test("a new click is a new request, and once Live does it an earlier one with no reply is dropped", async () => {
  const dropped = [], h = await harness();
  const client = h.commands.createLiveCommands({ onRequest: () => {}, onDrop: (id) => dropped.push(id), onError: () => {}, refresh: async () => {} });
  h.handle(() => { throw new Error("offline"); });
  const lost = await client.invoke("stop", "/runs/run-a/stop", { run_id: "run-a" }, () => ({}));
  h.handle((call) => done(call, "stop", { run_id: "run-a" }));
  const next = await client.invoke("stop", "/runs/run-a/stop", { run_id: "run-a" }, () => ({}));
  assert.notEqual(next.request_id, lost.request_id);
  assert.equal(next.outcome, "effect_recorded");
  assert.deepEqual(dropped, [lost.request_id]);
  assert.equal(await client.resend(lost.request_id), null);
});

test("prepare run IDs fit the native limit", async () => {
  const h = await harness();
  assert.match(h.commands.newLiveRunId(), /^web-[a-f0-9]{19}$/);
});

test("Live bootstrap, refresh and visible polling only read; disabled deployment exposes no writes", async () => {
  const h = await harness(new Map(), true);
  h.handle((call) => call.url === "/api/live" ? ok({
    availability: "ready", write_enabled: false, maintenance_enabled: false, write_reason: "Configuration incomplete", credentials: [], runs: [],
    defaults: { drawdown_brake: "0.15", duration_seconds: 8100, leverage: "3" }, notify: { configured: false, last_sent_ns: null, last_error: null, dropped: 0 },
  }) : refused("UNEXPECTED"));
  await h.state.detectLiveTrading();
  await h.state.detectLiveTrading();
  await h.state.refreshLiveTrading();
  assert.equal(h.timers.length, 1);
  h.timers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert(h.calls.every((call) => call.method === "GET" && call.body === null));
  const { view, actions } = h.state.liveTrading.get();
  assert.equal(view.notice, "Configuration incomplete");
  assert.equal(view.requests.length, 0);
  assert.equal(actions.start, undefined);
  assert.equal(actions.saveCredentials, undefined);
  assert.equal(typeof actions.refresh, "function");
});

test("a home-read failure retains explicit stop and local maintenance for a known run", async () => {
  const h = await harness(new Map(), true);
  const retainedRun = {
    run_id: "run-a", source: { source_sha256: "source", entry_class: "Strategy" }, candidate: { strategy_id: "fixture", revision: "1" },
    runtime: { digest: "sha256:fixture", platform: "linux/amd64" }, symbols: [],
    config: { drawdown_brake: "0.15", duration_seconds: "8100", leverage: "3" },
    host: { state: "running", mode: "run", account_owned: true, exit_code: null }, stop_requested: false, terminal: null,
    custody: { released: false, release_reason: null, archived: false }, account: null, orders: null, positions: null, event_limit: 200, evidence: [], complete: false,
  };
  h.handle(() => ok({ availability: "ready", write_enabled: true, maintenance_enabled: true, write_reason: null, credentials: [], runs: [retainedRun],
    defaults: { drawdown_brake: "0.15", duration_seconds: 8100, leverage: "3" }, notify: { configured: false, last_sent_ns: null, last_error: null, dropped: 0 } }));
  await h.state.detectLiveTrading();
  h.handle((call) => call.method === "POST" ? done(call, "stop", { run_id: "run-a" }) : refused("LIVE_OBSERVATION_UNAVAILABLE", 503));
  await h.state.refreshLiveTrading();
  const { view, actions } = h.state.liveTrading.get();
  assert.equal(view.availability, "unavailable");
  assert.equal(view.runs[0].id, "run-a");
  assert.equal(actions.start, undefined);
  assert.equal(actions.prepare, undefined);
  for (const name of ["stop", "maintain", "resend"]) assert.equal(typeof actions[name], "function");
  await actions.stop("run-a");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.calls.find((call) => call.method === "POST").url, "/api/live/runs/run-a/stop");
});

test("release admission never hides STOP and only the maintenance owner exposes cleanup", async () => {
  const h = await harness(new Map(), true);
  const home = { availability: "ready", write_enabled: false, maintenance_enabled: true,
    write_reason: "LIVE_RELEASE_UNAVAILABLE", credentials: [], runs: [],
    defaults: { drawdown_brake: "0.15", duration_seconds: 8100, leverage: "3" }, notify: { configured: false, last_sent_ns: null, last_error: null, dropped: 0 } };
  h.handle(() => ok(home));
  await h.state.detectLiveTrading();
  let actions = h.state.liveTrading.get().actions;
  for (const name of ["stop", "maintain", "resend", "refresh", "inspect"]) assert.equal(typeof actions[name], "function");
  for (const name of ["prepare", "start", "preflight", "reconcile", "saveCredentials", "removeCredential"]) assert.equal(actions[name], undefined);
  h.handle(() => ok({ ...home, maintenance_enabled: false }));
  await h.state.refreshLiveTrading();
  assert.equal(h.state.liveTrading.get().actions.maintain, undefined);
  h.handle((call) => call.method === "POST" ? done(call, "stop", { run_id: "known-run" }) : refused("LIVE_RELEASE_UNAVAILABLE", 503));
  await h.state.refreshLiveTrading();
  actions = h.state.liveTrading.get().actions;
  assert.equal(typeof actions.stop, "function");
  assert.equal(actions.start, undefined);
  await actions.stop("known-run");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.calls.find((call) => call.method === "POST").url, "/api/live/runs/known-run/stop");
});


test("coalesced prepares return the same receipt while another operation finishes between them", async () => {
  const h = await harness(); let replyPrepare;
  h.handle((call) => call.url === "/api/live/runs" ? new Promise((resolve) => { replyPrepare = resolve; }) : done(call, "stop", { run_id: "other-run" }));
  const first = h.client.invoke("prepare", "/runs", { run_id: "prepared-run" }, () => ({}));
  const second = h.client.invoke("prepare", "/runs", { run_id: "discarded-run" }, () => { throw new Error("no duplicate payload"); });
  assert.equal(first, second);
  await h.client.invoke("stop", "/runs/other-run/stop", { run_id: "other-run" }, () => ({}));
  assert.equal(h.observations.at(-1).target.run_id, "other-run");
  replyPrepare(done(h.calls[0], "prepare", { run_id: "prepared-run", credential_ref: "a".repeat(32) }));
  const receipt = await first;
  assert.equal(receipt.action, "prepare");
  assert.equal(receipt.target.run_id, "prepared-run");
  assert.equal(await second, receipt);
  assert.equal(h.calls.filter((call) => call.url === "/api/live/runs").length, 1);
});
