// The Live launch page: its rows (model/liveLaunch.ts) and its start, armed by one click and sent by a second.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { namespace } from "./load.mjs";

const model = await namespace("model/liveLaunch.ts", { sources: ["model/liveLaunchText"], packages: [] });
const HASH = "c".repeat(64);
const fields = [{ id: "budget_usdt", label: "Budget (USDT)", value: "90" }, { id: "max_loss_usdt", label: "Loss threshold (USDT)", value: "2" },
  { id: "duration_seconds", label: "Duration (seconds)", value: "8100" }, { id: "leverage", label: "Leverage", value: "3" }];
const config = fields.map((field) => ({ label: field.label, value: field.value }));
const found = { state: "found", replays: [{ trialId: 12, balance: "95" }], tolerance: "0.1" };
const source = (evidence) => ({ id: "s", candidate: "rsi@4", sourceHash: HASH, entryClass: "Rsi", purpose: "natural", ...evidence === undefined ? {} : { evidence } });
const key = { ref: "abcdef0123456789", savedAt: null, selected: true, available: true, runIds: [] };
const view = (over = {}) => ({ availability: "ready", preview: false, notice: null, reason: null, symbols: ["BTCUSDT"], credentials: [key], sources: [source(found)],
  planFields: fields, runs: [], request: null, notify: { configured: true, lastSentNs: null, lastError: null, dropped: 0 }, ...over });
const checked = (over = {}) => ({ id: "web-check", candidate: "rsi@4", sourceHash: HASH, config, host: [], running: false, ended: true,
  hostState: "preflight_complete", accountOwned: false, accountCheck: { state: "passed", readAt: null },
  venue: { canTrade: true, hedgeMode: true, multiAssets: true, wallet: "100", available: "98" }, ...over });
const columns = (v, c = null, extra = {}) => model.launchColumns({ view: v, source: v.sources[0] ?? null, edits: {}, checked: c, reading: null, targets: null, ...extra });
const row = (cols, id) => cols.flatMap((column) => column.rows).find((item) => item.id === id);

test("with every row passing start opens; of the run settings only the duration is the user's to change", () => {
  const cols = columns(view(), checked());
  assert.deepEqual(cols.map((column) => column.title), ["Strategy", "Account", "Limits & start"]);
  assert.equal(model.ready(cols), true);
  assert.deepEqual(cols.flatMap((column) => column.rows).filter((item) => item.editable).map((item) => item.id), ["duration_seconds"]);
  assert.ok(cols.flatMap((column) => column.rows).every((item) => item.source), "every row says where its value comes from");
  assert.equal(row(cols, "duration_seconds").reason, "2 h 15 min, then the run stops on its own.");
});

test("where Live is not set up every column is still drawn, each row failing in plain words, never a code", () => {
  const closed = view({ availability: "unavailable", reason: "LIVE_UNAVAILABLE", sources: [], credentials: [], planFields: [], symbols: null, notify: null });
  const cols = columns(closed);
  assert.equal(cols.length, 3);
  assert.equal(model.ready(cols), false);
  assert.match(model.unavailableReason(closed), /Live is not set up for this IDE/);
  assert.equal(row(cols, "candidate").reason, "Waits for Live (see above).", "the reason is said once, above the columns");
  assert.equal(row(cols, "alone").mark, "fail");
  assert.doesNotMatch(JSON.stringify(cols), /LIVE_[A-Z_]+/);
  assert.match(model.checkBlocker({ view: closed, source: null }, false), /not set up/);
  assert.doesNotMatch(model.unavailableReason({ ...closed, reason: "LIVE_SOMETHING_NEW" }), /LIVE_/);
  assert.doesNotMatch(model.refusalText("LIVE_SOMETHING_NEW"), /LIVE_/);
});

test("with no saved key the API key row fails, saying where to save one, and the account check waits for it", () => {
  const v = view({ credentials: [] }), cols = columns(v);
  assert.equal(row(cols, "key").mark, "fail");
  assert.match(row(cols, "key").reason, /Save a Binance Futures API key \(no withdrawals\) in Settings/);
  assert.match(model.checkBlocker({ view: v, source: v.sources[0] }, true), /Save an API key/);
  assert.equal(model.ready(cols), false);
});

test("missing replay evidence fails its row, says the Agent replays the candidate, and holds back the account check", () => {
  const v = view({ sources: [source({ state: "missing", replays: [], tolerance: "0.1" })] }), cols = columns(v, checked());
  assert.equal(row(cols, "evidence").mark, "fail");
  assert.match(row(cols, "evidence").reason, /The Agent runs one at your wallet's balance/);
  assert.match(model.checkBlocker({ view: v, source: v.sources[0] }, true), /replay evidence/);
  assert.equal(model.ready(cols), false);
  for (const state of ["checking", "unknown"]) assert.equal(row(columns(view({ sources: [source({ state, replays: [], tolerance: "0.1" })] })), "evidence").mark, "wait");
});

test("an older Live service, reporting no evidence or contracts, neither blocks on them nor claims they pass", () => {
  const cols = columns(view({ sources: [source()], symbols: null }), checked());
  for (const id of ["evidence", "contracts", "near"]) assert.equal(row(cols, id).mark, "shown", id);
  assert.equal(model.ready(cols), true);
  assert.equal(model.checkBlocker({ view: view({ sources: [source()] }), source: source() }, true), null);
});

test("the account rows answer from the check: modes, funds, and a replay that started near the wallet", () => {
  assert.equal(row(columns(view()), "hedge").mark, "wait", "nothing observed before the check");
  assert.match(row(columns(view(), checked({ venue: { ...checked().venue, hedgeMode: false } })), "hedge").reason, /needs hedge mode/);
  assert.equal(row(columns(view(), checked({ venue: { ...checked().venue, wallet: "50", available: "50" } })), "budget_usdt").mark, "fail");
  const far = columns(view(), checked({ venue: { ...checked().venue, wallet: "200", available: "200" } }));
  assert.equal(row(far, "near").mark, "fail");
  assert.match(row(far, "near").reason, /within 10\.0% of the 200 USDT wallet\. The Agent replays/);
  assert.equal(row(columns(view(), checked({ accountCheck: { state: "failed", readAt: null } })), "withdraw").mark, "fail");
});

test("targets are shown with their answer but never hold back the start; another run on the account does", () => {
  const cols = columns(view(), checked(), { reading: { annual_return: 0.1, max_drawdown: 0.3 }, targets: { max_drawdown: 0.2, annual_return: 0.2 } });
  for (const id of ["Max drawdown", "Annual return"]) { assert.equal(row(cols, id).mark, "fail"); assert.equal(row(cols, id).required, false); }
  assert.equal(model.ready(cols), true);
  const other = { ...checked(), id: "web-other", running: true, hostState: "running" };
  const busy = columns(view({ runs: [other] }), checked());
  assert.match(row(busy, "alone").reason, /web-other still holds the account/);
  assert.equal(model.ready(busy), false);
  assert.equal(row(columns(view(), checked(), { edits: { duration_seconds: "1.5" } }), "duration_seconds").mark, "fail");
});

// The page with deterministic hooks: no effects, its own state slots, every element it returns inspected as props.
async function page(state) {
  const slots = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = initial; return [slots[at], (value) => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }]; },
    useRef(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useEffect() {},
  };
  const exports = await namespace("widgets/live/LiveLaunch.tsx", { stubs: {
    react: hooks, "icons/Icon": { Icon: () => null }, "components/IconButton": { IconButton: () => null },
    "components/LiveFacts": { LiveRequestStatus: () => null },
    "state/liveRun": { useLaunchReading: () => ({ reading: null, targets: null }) },
    "state/liveWorkspace": { FRESH_DRAFT: { version: null, chosen: null, edits: {}, preparedId: null }, liveDraft: { get: () => state.draft, set: (next) => { state.draft = next; } },
      useLiveDraft: () => state.draft, openLiveCredentials: () => {}, showLiveRun: (id) => state.shown.push(id) },
  } });
  return (props) => { cursor = 0; return exports.LiveLaunch(props); };
}
const all = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
const named = (tree, name) => all(tree).find((node) => node.type?.name === name);
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the first click arms the start in place; the second starts the checked run with its source as the confirmation", async () => {
  const state = { draft: { version: null, chosen: null, edits: {}, preparedId: "web-check" }, shown: [] }, calls = [];
  const render = await page(state);
  const actions = { prepare: async (input) => { calls.push(["prepare", input.values.duration_seconds]); return { outcome: "effect_recorded", target: { run_id: "web-new" } }; },
    preflight: async (id) => { calls.push(["preflight", id]); return { outcome: "effect_recorded", target: { run_id: id } }; },
    start: async (id, confirm) => { calls.push(["start", id, confirm]); return { outcome: "effect_recorded", target: { run_id: id } }; } };
  const props = { version: null, view: view({ runs: [checked()] }), actions };
  let start = named(render(props), "LiveLaunchStart").props;
  assert.equal(start.ready, true);
  assert.equal(start.armed, false);
  start.arm();
  start = named(render(props), "LiveLaunchStart").props;
  assert.equal(start.armed, true);
  assert.deepEqual(calls, [], "arming sends nothing");
  start.start();
  await settle();
  assert.deepEqual(calls, [["start", "web-check", HASH]], "the run whose account was checked starts as it is");
  assert.deepEqual(state.shown, ["web-check"]);

  // A changed duration prepares a run with it first; a refused start is said plainly and shows no run.
  state.draft = { ...state.draft, edits: { duration_seconds: "3600" } }; calls.length = 0; state.shown.length = 0;
  actions.start = async (id, confirm) => { calls.push(["start", id, confirm]); return { outcome: "refused", code: "LIVE_ACCOUNT_OWNED", target: { run_id: id } }; };
  named(render(props), "LiveLaunchStart").props.start();
  await settle();
  assert.deepEqual(calls, [["prepare", "3600"], ["start", "web-new", HASH]]);
  assert.deepEqual(state.shown, []);
  assert.match(JSON.stringify(all(render(props)).map((node) => node.props?.children)), /Another Live run still holds the account/);
});

test("check account reuses the run it prepared and asks for its account check, never a start", async () => {
  const state = { draft: null, shown: [] }, calls = [];
  const render = await page(state);
  const actions = { prepare: async () => { calls.push("prepare"); return { outcome: "effect_recorded", target: { run_id: "web-check" } }; },
    preflight: async (id) => { calls.push(`preflight ${id}`); return { outcome: "effect_recorded", target: { run_id: id } }; }, start: async () => { calls.push("start"); } };
  const props = { version: null, view: view(), actions };
  const button = (tree) => all(tree).find((node) => node.type?.name === "FormButton" && /Check/.test(String(node.props.children)));
  button(render(props)).props.onClick();
  await settle();
  assert.deepEqual(calls, ["prepare", "preflight web-check"]);
  assert.equal(state.draft.preparedId, "web-check");
  assert.equal(named(render(props), "LiveLaunchStart").props.ready, false, "start waits for the check's answer");
});
