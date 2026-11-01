// The market import's status-bar line (model/marketImport.ts), read from the status `market follow` writes:
// the worst condition is named, in the order the healthcheck would fail, and skipped months are not one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

const module = new SourceTextModule(ts.transpileModule(
  readFileSync(new URL("../src/model/marketImport.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText);
await module.link(() => { throw new Error("model/marketImport.ts imports nothing"); });
await module.evaluate();
const { position, rows, summary } = module.namespace;

const AT = "2026-11-02T00:30:00+00:00";
const caught = { state: "caught_up", rows: 0, commits: [] };
const status = (kinds = {}, extra = {}) => ({
  at: AT, next_round: "2026-11-03T00:30:00+00:00", round_refusal: null, publish_refusal: null, publish_failing_since: null,
  kinds: {
    bars: { scope: { ...caught, through: "2026-11-01" } },
    metrics: { BTCUSDT: { ...caught, missing_from: null, missing_days: 0 }, ...kinds.metrics },
    quotes: { BTCUSDT: { ...caught, next_month: "2026-11", skipped: [] }, ETHUSDT: { ...caught, next_month: "2026-11", skipped: [] }, ...kinds.quotes },
    trades: { BTCUSDT: { ...caught, next_month: "2026-11", skipped: [] }, ...kinds.trades },
  },
  ...extra,
});
const line = (s, { stale = false, read = "2026-11-02T01:00:00+00:00" } = {}) => summary({ read_at: read, stale, status: s });

test("a healthy service is caught up, and a round running says so", () => {
  assert.deepEqual(line(status()), { text: "Market: caught up", tone: null, running: false });
  assert.equal(line(status({}, { running_since: AT })).running, true);
  assert.deepEqual(line({ at: AT, running_since: AT }), { text: "Market: first round", tone: null, running: true });
  const skipped = status({ trades: { SOLUSDT: { ...caught, next_month: "2026-11", skipped: ["2025-07"] } } });
  assert.equal(line(skipped).text, "Market: caught up", "a skipped month is not a failure");
});

test("the worst condition is named first", () => {
  const waiting = { quotes: { BTCUSDT: { state: "waiting", next_month: "2026-10" } } };
  assert.deepEqual(line(status(waiting)), { text: "Market: waiting quotes 2026-10 (archive not out)", tone: null, running: false });
  const lagging = { ...waiting, trades: { ETHUSDT: { state: "lagging", next_month: "2026-09" } } };
  assert.deepEqual(line(status(lagging)), { text: "Market: lagging trades 2026-09", tone: "misses", running: false });
  const unknown = Object.fromEntries(Object.entries(status().kinds).map(([k, e]) => [k, Object.fromEntries(Object.keys(e).map((c) => [c, { state: "unknown" }]))]));
  assert.deepEqual(line({ ...status(), kinds: unknown, round_refusal: { code: "MARKET_UNREACHABLE" } }).text, "Market: unknown — MARKET_UNREACHABLE");
  const stopped = { ...lagging, metrics: { SOLUSDT: { state: "stopped", refusal: { code: "NO_HISTORY" } } },
                    quotes: { SOLUSDT: { state: "stopped", refusal: { code: "SCHEMA_MISMATCH" } } } };
  assert.deepEqual(line(status(stopped)), { text: "Market: stopped — NO_HISTORY +1", tone: "fail", running: false });
  assert.deepEqual(line(status(stopped), { stale: true, read: "2026-11-03T07:45:00+00:00" }).text, "Market: no round for 31 h");
});

test("publishes refused are named only after the healthcheck's 26 hours", () => {
  const failing = status({}, { publish_refusal: { code: "PUBLISH_FAILED" }, publish_failing_since: "2026-11-01T00:30:00+00:00" });
  assert.equal(line(failing).text, "Market: caught up");
  assert.deepEqual(line(failing, { read: "2026-11-02T03:00:00+00:00" }), { text: "Market: publish refused — PUBLISH_FAILED", tone: "fail", running: false });
});

test("the table lists bars, metrics, quotes and trades, each contract in order", () => {
  assert.deepEqual(rows(status()).map((r) => `${r.kind}/${r.contract}`),
    ["bars/scope", "metrics/BTCUSDT", "quotes/BTCUSDT", "quotes/ETHUSDT", "trades/BTCUSDT"]);
});

test("bars name the last day they hold: the status's through is an exclusive end", () => {
  assert.equal(position({ state: "caught_up", through: "2026-11-01" }), "through 2026-10-31");
  assert.equal(position({ state: "caught_up", through: "2026-01-01" }), "through 2025-12-31");
  assert.equal(line(status({}, { kinds: { bars: { scope: { state: "lagging", through: "2026-10-28" } } } })).text, "Market: lagging bars through 2026-10-27");
});
