// A start an earlier page sent without hearing its answer is asked of the daemon on the next load and never sent
// again by itself: the daemon would resolve a resent start against the contracts and research of now.
import assert from "node:assert/strict";
import { createContext } from "node:vm";
import { test } from "node:test";
import { loader } from "./load.mjs";

class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
const atom = (value) => { const listeners = new Set(); return { get: () => value, set: (next) => { value = next; listeners.forEach((l) => l()); }, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) }; };

function storage() {
  const map = new Map();
  return { get length() { return map.size; }, key: (i) => [...map.keys()][i], getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
}

async function reload(sessionStorage, accepted) {
  const calls = [];
  const paperApi = async (path, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${path.split("?")[0]}`);
    if (path === "/health") return {};
    if (path === "/runs" && !init.method) return { runs: [], running: 0, memory: null, starting: [] };
    if (path.startsWith("/starts")) return { run: accepted ? { paper_id: 7, symbols: ["BTCUSDT"] } : null };
    return { paper_id: 7, symbols: ["BTCUSDT"] };
  };
  const context = createContext({ window: { sessionStorage, setTimeout: () => 0 }, crypto: { randomUUID: () => `${Math.random()}` } });
  const graph = loader({ context, sources: ["state/paper", "lib/pendingStarts"], packages: [], stubs: {
    "lib/agentApi": { ApiError, errorText: String }, "state/atom": { atom, useAtom: (a) => a.get() },
    "lib/paperApi": { paperApi, paperToken: () => "token" }, "lib/shared": { shared: (_, next) => next },
    "lib/whileVisible": { whileVisible: () => {} }, "model/chain": { ACTIVE: new Set() },
    "model/paperMemory": { full: () => null }, "state/phone": { phoneNow: () => false },
    "state/shell": { showRunsPage: () => {} }, "state/stage": { chooseRun: () => {}, pickWanted: () => {} },
    "state/session": { sessionRequired: atom(false) },
  } });
  const paper = await graph.namespace("state/paper.ts");
  const pending = graph.loaded("lib/pendingStarts.ts");
  return { paper, pending, calls };
}

test("an unanswered start is asked of the daemon on the next load, never posted again by itself", async () => {
  const disk = storage();
  const first = await reload(disk, false);
  const op = first.pending.pendingStart("example@1", { symbols: ["BTCUSDT"] }).op_id;
  const { paper, pending, calls } = await reload(disk, false);
  await paper.detectPaperService();
  assert.deepEqual(calls.filter((c) => c.startsWith("POST")), []);
  assert.ok(calls.includes("GET /starts"));
  assert.equal(pending.unconfirmedStarts().map((p) => p.op_id).join(), op, "kept: a click sends it again under its op_id");
  assert.equal(paper.notice.get()?.failed, true);
});

test("an unanswered start the daemon accepted is confirmed on the next load", async () => {
  const disk = storage();
  (await reload(disk, true)).pending.pendingStart("example@1", { symbols: ["BTCUSDT"] });
  const { paper, pending, calls } = await reload(disk, true);
  await paper.detectPaperService();
  assert.deepEqual(calls.filter((c) => c.startsWith("POST")), []);
  assert.equal(pending.unconfirmedStarts().length, 0);
});
