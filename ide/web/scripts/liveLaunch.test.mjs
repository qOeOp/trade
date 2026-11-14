// The Live launch page: its rows (model/liveLaunch.ts) and its start, armed by one click and sent by a second.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { namespace } from "./load.mjs";

const model = await namespace("model/liveLaunch.ts", { sources: ["model/liveLaunchText"], packages: [] });
const HASH = "c".repeat(64);
const fields = [{ id: "drawdown_brake", label: "Drawdown brake", value: "15" },
  { id: "duration_seconds", label: "Duration (seconds)", value: "8100" }, { id: "leverage", label: "Leverage", value: "3" }];
// A prepared run's settings as the server reports them: the brake as a fraction.
const config = [{ label: "Drawdown brake", value: "0.15" }, { label: "Duration (seconds)", value: "8100" }, { label: "Leverage", value: "3" }];
const found = { state: "found", replays: [{ trialId: 12, balance: "95" }], tolerance: "0.1" };
// The selected version as the Live control read it: found at the research head, its last research replay on BTCUSDT.
const source = (evidence, over = {}) => ({ candidate: "rsi@4", read: "found", sourceHash: HASH, entryClass: "Rsi", lastSymbols: ["BTCUSDT"], evidence, ...over });
const key = { ref: "abcdef0123456789", savedAt: null, selected: true, available: true, runIds: [] };
const view = (over = {}) => ({ availability: "ready", notice: null, reason: null, credentials: [key],
  planFields: fields, runs: [], requests: [], notify: { configured: true, lastSentNs: null, lastError: null, dropped: 0 }, ...over });
const checked = (over = {}) => ({ id: "web-check", candidate: "rsi@4", symbols: ["BTCUSDT"], sourceHash: HASH, config, host: [], running: false, ended: true,
  hostState: "preflight_complete", accountOwned: false, accountCheck: { state: "passed", readAt: null },
  venue: { canTrade: true, hedgeMode: true, multiAssets: true, wallet: "100", available: "98" }, ...over });
const columns = (v, c = null, extra = {}) => model.launchColumns({ view: v, source: source(found), edits: {}, checked: c, reading: null, targets: null, ...extra });
const row = (cols, id) => cols.flatMap((column) => column.rows).find((item) => item.id === id);

test("with every row passing start opens; the contracts, leverage, brake and duration are the user's to change", () => {
  const cols = columns(view(), checked());
  assert.deepEqual(cols.map((column) => column.title), ["Strategy", "Account", "Limits & start"]);
  assert.equal(model.ready(cols), true);
  assert.deepEqual(cols.flatMap((column) => column.rows).filter((item) => item.editable).map((item) => item.id),
    ["contracts", "leverage", "drawdown_brake", "duration_seconds"]);
  assert.ok(cols.flatMap((column) => column.rows).every((item) => item.editable || item.source), "every shown row says where its value comes from");
  assert.equal(row(cols, "candidate").value, "rsi@4");
  assert.equal(row(cols, "candidate").source, "Version selected in the research graph");
  assert.equal(row(cols, "contracts").source, "Last research replay of this candidate");
  assert.equal(row(cols, "duration_seconds").source, "", "a value the user types here needs no source line");
  assert.equal(row(cols, "duration_seconds").reason, null);
});

test("the duration reads in years, months, days and hours, exactly, with no upper limit", () => {
  assert.equal(model.spanText("8100"), "2 h 15 min");
  assert.equal(model.spanText("3630"), "1 h 30 s", "seconds under an hour are kept, so the shown value is the one sent");
  assert.equal(model.spanText(String(31_536_000 + 2_592_000 + 2 * 86_400)), "1 y 1 mo 2 d");
  const duration = (seconds) => row(columns(view(), checked(), { edits: { duration_seconds: seconds } }), "duration_seconds");
  for (const seconds of ["3600", "86401", String(5 * 31_536_000)]) assert.equal(duration(seconds).reason, null, seconds);
  assert.equal(duration("0").mark, "shown", "no duration: the run goes on until it is stopped");
  assert.match(duration("0").reason, /runs until you stop it/);
  assert.doesNotMatch(duration("0").reason, /IP/, "every run needs an IP-restricted key, not only one with no duration");
  assert.equal(model.ready(columns(view(), checked(), { edits: { duration_seconds: "0" } })), true);
});

test("where Live is not answering every column is still drawn, each row failing in plain words, never a code", () => {
  const closed = view({ availability: "unavailable", reason: "LIVE_UNAVAILABLE", credentials: [], planFields: [], notify: null });
  const cols = columns(closed);
  assert.equal(cols.length, 3);
  assert.equal(model.ready(cols), false);
  assert.match(model.unavailableReason(closed), /Live is not answering for this IDE/);
  assert.equal(row(cols, "leverage").reason, "Waits for Live (see above).", "the reason is said once, above the columns");
  assert.equal(row(cols, "alone").mark, "fail");
  assert.doesNotMatch(JSON.stringify(cols), /LIVE_[A-Z_]+/);
  assert.match(model.checkBlocker({ view: closed, source: null }, false), /not answering/);
  assert.doesNotMatch(model.unavailableReason({ ...closed, reason: "LIVE_SOMETHING_NEW" }), /LIVE_/);
  for (const code of ["LIVE_SOMETHING_NEW", "LIVE_SOURCE_MISSING", "LIVE_SYMBOLS", "LIVE_UNIVERSE"]) assert.doesNotMatch(model.refusalText(code), /LIVE_/);
});

test("the candidate is the selected version: none selected, one Live cannot run, or one still being read holds back the check", () => {
  const none = columns(view(), null, { source: null });
  assert.equal(row(none, "candidate").mark, "fail");
  assert.match(row(none, "candidate").reason, /Select a version in the research graph/);
  assert.match(model.checkBlocker({ view: view(), source: null, edits: {} }, true), /Select a version/);
  const absent = source(null, { read: "absent", sourceHash: null, entryClass: null, lastSymbols: null });
  assert.equal(row(columns(view(), null, { source: absent }), "source").mark, "fail");
  assert.match(row(columns(view(), null, { source: absent }), "candidate").reason, /does not hold it, or its source does not load/);
  assert.match(model.checkBlocker({ view: view(), source: absent, edits: {} }, true), /cannot run live/);
  const reading = source(null, { read: "reading", sourceHash: null, entryClass: null, lastSymbols: null });
  assert.equal(row(columns(view(), null, { source: reading }), "candidate").mark, "wait");
  assert.match(model.checkBlocker({ view: view(), source: reading, edits: {} }, true), /Waiting for the candidate/);
});

test("contracts are typed as words, default to the last research replay's, and invalid ones hold back the check", () => {
  const two = columns(view(), checked(), { edits: { contracts: "btcusdt, ETHUSDT" } });
  assert.equal(row(two, "contracts").mark, "pass");
  assert.equal(row(two, "contracts").source, "", "typed here, so no source line");
  assert.match(row(two, "contracts").reason, /One strategy instance on each contract/);
  assert.match(row(two, "leverage").reason, /each contract's leverage/);
  assert.deepEqual(model.launchSymbols(source(found), { contracts: "btcusdt, ETHUSDT" }), ["BTCUSDT", "ETHUSDT"]);
  assert.equal(row(columns(view()), "contracts").reason, null);
  for (const text of ["", "BTCUSDT, BTCUSDT", "BTCUSD", "BTC-USDT"]) {
    const bad = { view: view(), source: source(found), edits: { contracts: text }, checked: null, reading: null, targets: null };
    assert.equal(row(model.launchColumns(bad), "contracts").mark, "fail", text);
    assert.match(model.checkBlocker(bad, true), /valid contracts/, text);
  }
  const fresh = source(null, { lastSymbols: null }), cols = columns(view(), null, { source: fresh });
  assert.equal(row(cols, "contracts").value, null);
  assert.match(row(cols, "contracts").reason, /No research replay of this candidate to take them from/);
});

test("leverage is a whole number from 1 to 125, its default from the Live settings", () => {
  const leverage = (value) => row(columns(view(), checked(), { edits: { leverage: value } }), "leverage");
  assert.deepEqual(["1", "20", "125", "0", "126", "2.5", "x"].map((value) => leverage(value).mark), ["pass", "pass", "pass", "fail", "fail", "fail", "fail"]);
  assert.equal(row(columns(view()), "leverage").source, "Default 3×");
});

test("with no saved key the API key row fails, saying where to save one, and the account check waits for it", () => {
  const v = view({ credentials: [] }), cols = columns(v);
  assert.equal(row(cols, "key").mark, "fail");
  assert.match(row(cols, "key").reason, /Save a Binance Futures API key \(no withdrawals, restricted to this server's IP\) in Settings/);
  assert.match(model.checkBlocker({ view: v, source: source(found), edits: {} }, true), /Save an API key/);
  assert.equal(model.ready(cols), false);
});

test("missing replay evidence fails its row, says the Agent replays the candidate, and holds back the account check", () => {
  const missing = source({ state: "missing", replays: [], tolerance: "0.1" }), cols = columns(view(), checked(), { source: missing });
  assert.equal(row(cols, "evidence").mark, "fail");
  assert.match(row(cols, "evidence").reason, /The Agent runs one at your wallet's balance/);
  assert.match(model.checkBlocker({ view: view(), source: missing, edits: {} }, true), /replay evidence/);
  assert.equal(model.ready(cols), false);
  for (const state of ["checking", "unknown"]) assert.equal(row(columns(view(), null, { source: source({ state, replays: [], tolerance: "0.1" }) }), "evidence").mark, "wait");
});

test("the account rows answer from the check: modes, funds, and a replay that started near the wallet", () => {
  assert.equal(row(columns(view()), "hedge").mark, "wait", "nothing observed before the check");
  assert.match(row(columns(view(), checked({ venue: { ...checked().venue, hedgeMode: false } })), "hedge").reason, /needs hedge mode/);
  const floor = (wallet, available) => row(columns(view(), checked({ venue: { ...checked().venue, wallet, available } })), "budget");
  assert.deepEqual([floor("50", "50").value, floor("50", "50").mark], ["42.50", "pass"], "85% of the wallet, greyed, not a choice");
  assert.equal(floor("50", "40").mark, "fail", "more than is available");
  assert.equal(floor("118", "118").mark, "fail", "the first trial's floor is at most 100 USDT");
  assert.equal(row(columns(view()), "budget").mark, "wait");
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
  const brake = (percent) => row(columns(view(), checked(), { edits: { drawdown_brake: percent } }), "drawdown_brake").mark;
  assert.deepEqual(["10", "15", "15.5", "0", "x"].map(brake), ["pass", "pass", "fail", "fail", "fail"], "only tighter than the target");
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
    "state/liveRun": { useLaunchReading: () => ({ reading: null, targets: null }),
      useLiveSource: (version) => version ? source(null, { candidate: version }) : null, useLiveEvidence: (read, symbols) => read && symbols ? found : null },
    "state/liveWorkspace": { FRESH_DRAFT: { version: null, edits: {}, preparedId: null }, liveDraft: { get: () => state.draft, set: (next) => { state.draft = next; } },
      useLiveDraft: () => state.draft, openLiveCredentials: () => {}, showLiveRun: (id) => state.shown.push(id) },
  } });
  return (props) => { cursor = 0; return exports.LiveLaunch(props); };
}
const all = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
const named = (tree, name) => all(tree).find((node) => node.type?.name === name);
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the first click arms the start in place; the second starts the checked run with its source as the confirmation", async () => {
  const state = { draft: { version: "rsi@4", edits: {}, preparedId: "web-check" }, shown: [] }, calls = [];
  const render = await page(state);
  const actions = { prepare: async (input) => { calls.push(["prepare", input.candidate, input.symbols, input.values.duration_seconds]); return { outcome: "effect_recorded", target: { run_id: "web-new" } }; },
    preflight: async (id) => { calls.push(["preflight", id]); return { outcome: "effect_recorded", target: { run_id: id } }; },
    start: async (id, confirm) => { calls.push(["start", id, confirm]); return { outcome: "effect_recorded", target: { run_id: id } }; } };
  const props = { version: "rsi@4", view: view({ runs: [checked()] }), actions };
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

  // Other contracts prepare a run on them first; a refused start is said plainly and shows no run.
  state.draft = { ...state.draft, edits: { contracts: "ethusdt" } }; calls.length = 0; state.shown.length = 0;
  actions.start = async (id, confirm) => { calls.push(["start", id, confirm]); return { outcome: "refused", code: "LIVE_ACCOUNT_OWNED", target: { run_id: id } }; };
  named(render(props), "LiveLaunchStart").props.start();
  await settle();
  assert.deepEqual(calls, [["prepare", "rsi@4", ["ETHUSDT"], "8100"], ["start", "web-new", HASH]]);
  assert.deepEqual(state.shown, []);
  const after = named(render(props), "LiveLaunchStart").props;
  assert.match(after.refused, /Another Live run still holds the account/, "a refused start is said at Start, not in a banner");
  assert.equal(after.armed, false);
});

test("check account prepares the selected version on its contracts and asks for its account check, never a start", async () => {
  const state = { draft: null, shown: [] }, calls = [];
  const render = await page(state);
  const actions = { prepare: async (input) => { calls.push(`prepare ${input.candidate} ${input.symbols.join(",")}`); return { outcome: "effect_recorded", target: { run_id: "web-check" } }; },
    preflight: async (id) => { calls.push(`preflight ${id}`); return { outcome: "effect_recorded", target: { run_id: id } }; }, start: async () => { calls.push("start"); } };
  const props = { version: "rsi@4", view: view(), actions };
  const button = (tree) => all(tree).find((node) => node.type?.name === "FormButton" && /Check/.test(String(node.props.children)));
  button(render(props)).props.onClick();
  await settle();
  assert.deepEqual(calls, ["prepare rsi@4 BTCUSDT", "preflight web-check"]);
  assert.equal(state.draft.preparedId, "web-check");
  assert.equal(state.draft.version, "rsi@4");
  const waiting = named(render(props), "LiveLaunchStart").props;
  assert.equal(waiting.ready, false, "start waits for the check's answer");
  assert.deepEqual(waiting.waiting, ["Account"], "the line names the column still waiting, not each row");

  // Typing the default contracts back is no edit.
  named(render(props), "LiveLaunchColumn").props.edit("contracts", "BTCUSDT");
  assert.deepEqual(state.draft.edits, {});
});
