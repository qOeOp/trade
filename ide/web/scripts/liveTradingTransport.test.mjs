import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib");
const ok = (data, status = 200) => new Response(JSON.stringify({ ok: true, data }), { status, headers: { "content-type": "application/json" } });
const refused = (code, status = 400) => new Response(JSON.stringify({ ok: false, error: { code, message: "Safe service message" } }), { status });
const result = (request, outcome = "effect_recorded") => ({ ...request, outcome });
async function harness(saved = new Map(), stateMode = false) {
  const calls = [], observations = [], errors = [], meta = { content: "old-nonce" };
  let count = 0, handler = () => refused("UNEXPECTED");
  const intervals = [];
  const context = createContext({
    Headers, Response, console,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`, getRandomValues: (bytes) => bytes.fill(3) },
    document: { querySelector: () => meta, hidden: false, addEventListener: () => {} },
    window: { setInterval: (callback) => intervals.push(callback), sessionStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) } },
    fetch: async (url, init) => { const call = { url, method: init.method, token: init.headers?.get?.("x-trade-paper-token"), body: init.body === undefined ? null : JSON.parse(init.body) }; calls.push(call); return handler(call); },
  });
  const modules = new Map();
  const load = (path) => {
    if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText, { identifier: path, context }));
    return modules.get(path);
  };
  const commands = load(resolve(root, stateMode ? "../state/liveTrading.ts" : "liveTradingCommands.ts"));
  await commands.link(async (name, from) => {
    if (name.startsWith(".")) return load(`${resolve(dirname(from.identifier), name)}.ts`);
    if (!modules.has(name)) {
      const values = await import(name);
      modules.set(name, new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }));
    }
    return modules.get(name);
  });
  await commands.evaluate();
  const client = stateMode ? null : commands.namespace.createLiveCommands({ onRequest: (v) => observations.push(v), onError: (e) => errors.push(e), refresh: async () => {} });
  return {
    client, state: stateMode ? commands.namespace : null, intervals, calls, observations, errors, saved, meta, handle: (next) => { handler = next; },
    pending: modules.get(resolve(root, "liveTradingPending.ts")).namespace,
    api: modules.get(resolve(root, "liveTradingApi.ts")).namespace,
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
  const id = h.calls[0].body.request_id;
  reply(ok({ request: result({ request_id: id, action: "start", target: { run_id: "run-a" } }) }));
  await first;
  assert.equal(h.pending.pendingLiveRequests().length, 0);
  assert.equal(h.observations.at(-1).outcome, "effect_recorded");
});

test("lost credential response stores only identity and reads the original outcome without replay", async () => {
  const h = await harness(); let id;
  h.handle((call) => {
    if (call.method === "POST") { id = call.body.request_id; throw new Error("fictional-secret-in-a-raw-error"); }
    return ok(result({ request_id: id, action: "credential_save", target: { credential_ref: "fictional-reference" } }));
  });
  const promise = h.client.invoke("credential_save", "/credentials", {}, () => ({ api_key: "fictional-key", api_secret: "fictional-secret" }));
  const retained = [...h.saved.values()].join("");
  assert.doesNotMatch(retained, /fictional-key|fictional-secret|api_key|api_secret|body/);
  assert.match(retained, /credential_save/);
  await promise;
  assert.deepEqual(h.calls.map((c) => c.method), ["POST", "GET"]);
  assert.equal(h.calls[1].url, `/api/live/requests/${id}`);
  assert.doesNotMatch(h.errors.map((e) => e.message).join(" "), /fictional-secret/);
  assert.equal(h.saved.size, 0);
});

test("reload and reconnect only GET unknown requests, even when the user revisits save", async () => {
  const original = await harness();
  original.handle((call) => { if (call.method === "POST") throw new Error("offline"); return refused("LIVE_REQUEST_MISSING", 404); });
  await original.client.invoke("credential_save", "/credentials", {}, () => ({ api_key: "dummy", api_secret: "dummy" }));
  const restored = await harness(original.saved);
  restored.handle(() => refused("LIVE_REQUEST_MISSING", 404));
  await restored.client.recover();
  await restored.client.recover();
  await restored.client.invoke("credential_save", "/credentials", {}, () => { throw new Error("must not recreate the secret body"); });
  assert.equal(restored.calls.length, 3);
  assert(restored.calls.every((c) => c.method === "GET" && c.body === null));
  assert.equal(restored.pending.pendingLiveRequests().length, 1);
  assert.equal(restored.observations.at(-1).outcome, "outcome_unknown");
});

test("nonce renewal is the only POST retry and preserves the complete original body", async () => {
  const h = await harness();
  h.handle((call) => h.calls.length === 1
    ? new Response("{}", { status: 403, headers: { "x-trade-paper-token": "renewed" } })
    : ok({ request: result({ request_id: call.body.request_id, action: "stop", target: { run_id: "run-a" } }) }));
  await h.client.invoke("stop", "/runs/run-a/stop", { run_id: "run-a" }, () => ({}));
  assert.deepEqual(h.calls.map((c) => c.token), ["old-nonce", "renewed"]);
  assert.deepEqual(h.calls[0].body, h.calls[1].body);
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 2);
});

test("session expiry retains the original request and never automatically resubmits", async () => {
  const h = await harness(); h.handle(() => new Response("Login", { status: 401 }));
  await h.client.invoke("preflight", "/runs/run-a/preflight", { run_id: "run-a" }, () => ({}));
  assert.deepEqual(h.calls.map((c) => c.method), ["POST", "GET"]);
  assert.equal(h.pending.pendingLiveRequests().length, 1);
  assert.equal(h.errors[0].code, "AUTH_REQUIRED");
});

test("an unrelated or malformed receipt cannot confirm the submitted request", async () => {
  const h = await harness();
  h.handle((call) => call.method === "POST" ? ok({ request: result({ request_id: "different", action: "start", target: {} }) }) : ok({}));
  await h.client.invoke("start", "/runs/run-a/start", { run_id: "run-a" }, () => ({ confirm_real_orders: "source" }));
  assert.equal(h.pending.pendingLiveRequests().length, 1);
  assert(h.observations.every((r) => r.outcome === "outcome_unknown"));
});

test("explicit local resolution uses the original request ID and never repeats its venue action", async () => {
  const h = await harness();
  h.pending.keepLiveRequest({ request_id: "original-request", action: "start", target: { run_id: "run-a" } });
  h.handle((call) => {
    assert.equal(call.url, "/api/live/requests/original-request/resolve");
    assert.deepEqual(call.body, { request_id: "original-request" });
    return ok({ request: result({ request_id: "original-request", action: "start", target: { run_id: "run-a" } }, "outcome_unknown") });
  });
  assert.equal(h.calls.length, 0);
  await h.client.resolve("original-request");
  assert.equal(h.calls.length, 1);
  assert.equal(h.pending.pendingLiveRequests()[0].action, "start");
});

test("explicit resolution accepts a durable same-ID closure with unknown action and no target", async () => {
  const h = await harness();
  h.pending.keepLiveRequest({ request_id: "unclaimed-request", action: "start", target: { run_id: "run-a" } });
  h.handle((call) => call.method === "GET" ? refused("LIVE_REQUEST_MISSING", 404) : ok({ request: {
    request_id: "unclaimed-request", action: "unknown", target: {}, outcome: "refused", code: "LIVE_REQUEST_CLOSED_UNCLAIMED",
  } }));
  await h.client.recover();
  assert.equal(h.observations.at(-1).outcome, "outcome_unknown");
  assert.equal(h.pending.pendingLiveRequests().length, 1);
  assert(h.calls.every((call) => call.method === "GET"));
  await h.client.resolve("unclaimed-request");
  assert.deepEqual(h.calls.map((call) => call.method), ["GET", "POST"]);
  assert.equal(h.calls[1].url, "/api/live/requests/unclaimed-request/resolve");
  assert.deepEqual(h.calls[1].body, { request_id: "unclaimed-request" });
  assert.equal(h.observations.at(-1).action, "unknown");
  assert.equal(h.observations.at(-1).code, "LIVE_REQUEST_CLOSED_UNCLAIMED");
  assert.equal(h.observations.at(-1).outcome, "refused");
  assert.equal(h.pending.pendingLiveRequests().length, 0);
  await h.client.recover();
  assert.equal(h.calls.length, 2, "closure must not recreate or replay the original action");
});

test("prepare run IDs fit the native limit and pending bodies discard undeclared fields", async () => {
  const h = await harness();
  assert.match(h.pending.newLiveRunId(), /^web-[a-f0-9]{19}$/);
  h.pending.keepLiveRequest({ request_id: "request-fixture", action: "prepare", target: { run_id: "run-a", api_secret: "dummy" }, body: { api_key: "dummy" } });
  assert.deepEqual(JSON.parse([...h.saved.values()][0]), [{ request_id: "request-fixture", action: "prepare", target: { run_id: "run-a" } }]);
});

test("Live bootstrap, refresh and visible polling only read; disabled deployment exposes no writes", async () => {
  const retained = { request_id: "original-request", action: "start", target: { run_id: "run-a" } };
  const h = await harness(new Map([["trade.live.pending@1", JSON.stringify([retained])]]), true);
  h.handle((call) => call.url === "/api/live" ? ok({
    availability: "ready", write_enabled: false, maintenance_enabled: false, write_reason: "Configuration incomplete", sources: [], credentials: [], runs: [],
    defaults: { budget_usdt: "90", max_loss_usdt: "2", duration_seconds: 8100, leverage: "3" },
  }) : ok(result(retained, "outcome_unknown")));
  await h.state.detectLiveTrading();
  await h.state.detectLiveTrading();
  await h.state.refreshLiveTrading();
  assert.equal(h.intervals.length, 1);
  h.intervals[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert(h.calls.every((call) => call.method === "GET" && call.body === null));
  const { view, actions } = h.state.liveTrading.get();
  assert.equal(view.notice, "Configuration incomplete");
  assert.equal(view.requests[0].outcome, "outcome_unknown");
  assert.equal(actions.start, undefined);
  assert.equal(actions.saveCredentials, undefined);
  assert.equal(typeof actions.refresh, "function");
});

test("a delayed lookup cannot turn a subsequently acknowledged request back into pending", async () => {
  const h = await harness(); let posted, queried;
  h.handle((call) => new Promise((resolve) => { if (call.method === "POST") posted = resolve; else queried = resolve; }));
  const operation = h.client.invoke("stop", "/runs/run-a/stop", { run_id: "run-a" }, () => ({}));
  const lookup = h.client.recover();
  const request = { request_id: h.calls[0].body.request_id, action: "stop", target: { run_id: "run-a" } };
  posted(ok({ request: result(request) }));
  await operation;
  queried(ok(result(request, "pending")));
  await lookup;
  assert.equal(h.observations.at(-1).outcome, "effect_recorded");
  assert.equal(h.pending.pendingLiveRequests().length, 0);
});

test("400/409 after partial effects retains the original unknown request and later clicks only GET", async () => {
  for (const status of [400, 409]) {
    const h = await harness(); let original;
    h.handle((call) => {
      if (call.method === "POST") { original = call.body.request_id; return refused("LIVE_CREDENTIAL_INCOMPLETE", status); }
      return ok(result({ request_id: original, action: "credential_save", target: { credential_ref: "recorded-version" } }, "outcome_unknown"));
    });
    await h.client.invoke("credential_save", "/credentials", {}, () => ({ api_key: "dummy-key", api_secret: "dummy-secret" }));
    assert.equal(h.pending.pendingLiveRequests()[0].request_id, original);
    assert.equal(h.observations.at(-1).outcome, "outcome_unknown");
    await h.client.invoke("credential_save", "/credentials", {}, () => { throw new Error("must not recreate an upload"); });
    assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET", "GET"]);
    assert(h.observations.every((request) => request.outcome !== "refused"));
  }
});

test("400 with a recorded effect is settled from GET as accepted, never from the HTTP error", async () => {
  const h = await harness(); let original;
  h.handle((call) => {
    if (call.method === "POST") { original = call.body.request_id; return refused("LIVE_PARTIAL_EFFECT", 400); }
    return ok(result({ request_id: original, action: "start", target: { run_id: "run-a" } }));
  });
  await h.client.invoke("start", "/runs/run-a/start", { run_id: "run-a" }, () => ({ confirm_real_orders: "source" }));
  assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET"]);
  assert.equal(h.observations.at(-1).outcome, "effect_recorded");
  assert(h.observations.every((request) => request.outcome !== "refused"));
  assert.equal(h.pending.pendingLiveRequests().length, 0);
});

test("only a same-ID durable refused receipt settles a failed POST as refused", async () => {
  const h = await harness(); let original;
  h.handle((call) => {
    if (call.method === "POST") { original = call.body.request_id; return refused("LIVE_NO_EFFECT", 400); }
    return ok({ ...result({ request_id: original, action: "preflight", target: { run_id: "run-a" } }, "refused"), code: "LIVE_NO_EFFECT" });
  });
  await h.client.invoke("preflight", "/runs/run-a/preflight", { run_id: "run-a" }, () => ({}));
  assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET"]);
  assert.equal(h.observations.at(-1).outcome, "refused");
  assert.equal(h.pending.pendingLiveRequests().length, 0);
});

test("a pre-forward 400 and a missing request never fabricate a durable refusal or new POST", async () => {
  const h = await harness();
  h.handle((call) => refused(call.method === "POST" ? "LIVE_CONFIG" : "LIVE_REQUEST_MISSING", call.method === "POST" ? 400 : 404));
  await h.client.invoke("prepare", "/runs", { run_id: "run-a" }, () => ({ config: {} }));
  await h.client.invoke("prepare", "/runs", { run_id: "run-b" }, () => { throw new Error("no replacement intent"); });
  assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET", "GET"]);
  assert.equal(h.pending.pendingLiveRequests().length, 1);
  assert.equal(h.observations.at(-1).outcome, "outcome_unknown");
});

test("a home-read failure retains explicit stop and local maintenance for a known run", async () => {
  const h = await harness(new Map(), true);
  const retainedRun = {
    run_id: "run-a", source: { source_sha256: "source", entry_class: "Strategy" }, origin_candidate: { strategy_id: "fixture", revision: "1", source_sha256: "source" },
    runtime: { digest: "sha256:fixture", platform: "linux/amd64" }, symbols: [],
    config: { budget_usdt: "90", max_loss_usdt: "2", duration_seconds: "8100", leverage: "3" },
    host: { state: "running", mode: "run", account_owned: true, exit_code: null }, stop_requested: false, terminal: null,
    custody: { released: false, release_reason: null, archived: false }, account: null, orders: null, positions: null, event_limit: 200, evidence: [], complete: false,
  };
  h.handle(() => ok({ availability: "ready", write_enabled: true, maintenance_enabled: true, write_reason: null, sources: [], credentials: [], runs: [retainedRun],
    defaults: { budget_usdt: "90", max_loss_usdt: "2", duration_seconds: 8100, leverage: "3" } }));
  await h.state.detectLiveTrading();
  h.handle((call) => call.method === "POST" ? ok({ request: result({ request_id: call.body.request_id, action: "stop", target: { run_id: "run-a" } }) }) : refused("LIVE_OBSERVATION_UNAVAILABLE", 503));
  await h.state.refreshLiveTrading();
  const { view, actions } = h.state.liveTrading.get();
  assert.equal(view.availability, "unavailable");
  assert.equal(view.runs[0].id, "run-a");
  assert.equal(actions.start, undefined);
  assert.equal(actions.prepare, undefined);
  for (const name of ["stop", "maintain", "resolveRequest"]) assert.equal(typeof actions[name], "function");
  await actions.stop("run-a");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.calls.find((call) => call.method === "POST").url, "/api/live/runs/run-a/stop");
});

test("an explicit closed receipt clears the stale missing-request notice", async () => {
  const h = await harness(new Map(), true);
  const home = { availability: "ready", write_enabled: true, maintenance_enabled: true, write_reason: null, sources: [], credentials: [], runs: [],
    defaults: { budget_usdt: "90", max_loss_usdt: "2", duration_seconds: 8100, leverage: "3" } };
  h.pending.keepLiveRequest({ request_id: "unclaimed-request", action: "credential_save", target: {} });
  h.handle((call) => call.url === "/api/live" ? ok(home) : refused("LIVE_REQUEST_MISSING", 404));
  await h.state.detectLiveTrading();
  assert.match(h.state.liveTrading.get().view.notice, /LIVE_REQUEST_MISSING/);
  h.handle((call) => call.url === "/api/live" ? ok(home) : ok({ request: {
    request_id: "unclaimed-request", action: "unknown", target: {}, outcome: "refused", code: "LIVE_REQUEST_CLOSED_UNCLAIMED",
  } }));
  await h.state.liveTrading.get().actions.resolveRequest("unclaimed-request");
  const view = h.state.liveTrading.get().view;
  assert.equal(view.request.code, "LIVE_REQUEST_CLOSED_UNCLAIMED");
  assert.doesNotMatch(view.notice ?? "", /LIVE_REQUEST_MISSING/);
  assert.equal(h.pending.pendingLiveRequests().length, 0);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
});

test("release admission never hides STOP and only the maintenance owner exposes cleanup", async () => {
  const h = await harness(new Map(), true);
  const home = { availability: "ready", write_enabled: false, maintenance_enabled: true,
    write_reason: "LIVE_RELEASE_UNAVAILABLE", sources: [], credentials: [], runs: [],
    defaults: { budget_usdt: "90", max_loss_usdt: "2", duration_seconds: 8100, leverage: "3" } };
  h.handle(() => ok(home));
  await h.state.detectLiveTrading();
  let actions = h.state.liveTrading.get().actions;
  for (const name of ["stop", "maintain", "refresh", "inspect"]) assert.equal(typeof actions[name], "function");
  for (const name of ["prepare", "start", "preflight", "reconcile", "saveCredentials", "removeCredential", "resolveRequest"]) assert.equal(actions[name], undefined);
  h.handle(() => ok({ ...home, maintenance_enabled: false }));
  await h.state.refreshLiveTrading();
  assert.equal(h.state.liveTrading.get().actions.maintain, undefined);
  h.handle((call) => call.method === "POST" ? ok({ request: result({ request_id: call.body.request_id, action: "stop", target: { run_id: "known-run" } }) }) : refused("LIVE_RELEASE_UNAVAILABLE", 503));
  await h.state.refreshLiveTrading();
  actions = h.state.liveTrading.get().actions;
  assert.equal(typeof actions.stop, "function");
  assert.equal(actions.start, undefined);
  await actions.stop("known-run");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.calls.find((call) => call.method === "POST").url, "/api/live/runs/known-run/stop");
});


test("prepare returns the original pending target rather than a new wizard run ID", async () => {
  const h = await harness();
  h.pending.keepLiveRequest({ request_id: "earlier-prepare", action: "prepare", target: { run_id: "original-run" } });
  h.handle((call) => {
    assert.equal(call.method, "GET");
    assert.equal(call.url, "/api/live/requests/earlier-prepare");
    return ok(result({ request_id: "earlier-prepare", action: "prepare", target: { run_id: "original-run" } }));
  });
  const receipt = await h.client.invoke("prepare", "/runs", { run_id: "new-random-run" }, () => { throw new Error("no new prepare body"); });
  assert.equal(receipt.request_id, "earlier-prepare");
  assert.equal(receipt.target.run_id, "original-run");
  assert.equal(receipt.outcome, "effect_recorded");
  assert.equal(h.calls.length, 1);
});

test("coalesced prepares return the same receipt while another operation finishes between them", async () => {
  const h = await harness(); let replyPrepare;
  h.handle((call) => call.url === "/api/live/runs" ? new Promise((resolve) => { replyPrepare = resolve; })
    : ok({ request: result({ request_id: call.body.request_id, action: "stop", target: { run_id: "other-run" } }) }));
  const first = h.client.invoke("prepare", "/runs", { run_id: "prepared-run" }, () => ({}));
  const second = h.client.invoke("prepare", "/runs", { run_id: "discarded-run" }, () => { throw new Error("no duplicate payload"); });
  assert.equal(first, second);
  await h.client.invoke("stop", "/runs/other-run/stop", { run_id: "other-run" }, () => ({}));
  assert.equal(h.observations.at(-1).target.run_id, "other-run");
  replyPrepare(ok({ request: result({ request_id: h.calls[0].body.request_id, action: "prepare", target: { run_id: "prepared-run" } }) }));
  const receipt = await first;
  assert.equal(receipt.action, "prepare");
  assert.equal(receipt.target.run_id, "prepared-run");
  assert.equal(await second, receipt);
  assert.equal(h.calls.filter((call) => call.url === "/api/live/runs").length, 1);
});

test("prepare recovery returns its own unknown or durable refusal without claiming preparation", async () => {
  for (const outcome of ["outcome_unknown", "refused"]) {
    const h = await harness(); let id;
    h.handle((call) => {
      if (call.method === "POST") { id = call.body.request_id; return refused("LIVE_CONFIG", 400); }
      return ok(result({ request_id: id, action: "prepare", target: { run_id: "attempted-run" } }, outcome));
    });
    const receipt = await h.client.invoke("prepare", "/runs", { run_id: "attempted-run" }, () => ({}));
    assert.equal(receipt.request_id, id);
    assert.equal(receipt.target.run_id, "attempted-run");
    assert.equal(receipt.outcome, outcome);
    assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET"]);
  }
});
