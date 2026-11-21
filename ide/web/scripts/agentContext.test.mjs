// What each question to the Agent says the page shows (model/agentContext.ts), and which tool calls of an answer
// fold into one line (ui/chat/toolFold.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { agentContext } = await namespace("model/agentContext.ts", { sources: [], packages: [] });
const { resolveRunSelection } = await namespace("model/runSelection.ts", { packages: [] });
const { foldable, foldNames } = await namespace("ui/chat/toolFold.ts", { sources: [], packages: [] });

// A run as /api/paper/runs lists it, and a Live run as the Live control reads it.
const paper = { paper_id: 12, candidate: "ema-12@5", source_sha256: "ab", symbols: ["BTCUSDT", "ETHUSDT"], state: "running",
  created_at: "2026-11-20T08:00:00Z", image_ref: "img", market_day: "2026-11-19", config: {}, status: null, reasons: null,
  total_return: null, max_drawdown: null };
const live = { id: "web-7", candidate: "ema-12@5", evidence: [{ source: "lifecycle", observedNs: "1000" }] };
const view = { version: "ema-12@5", line: "ema-cross", ledger_commit: "abc" };
const shown = (choice) => resolveRunSelection({ version: "ema-12@5", runs: [paper], trials: [], live: [live], choice });
const none = { chart: null, market: null };

test("on Runs the question carries the stage, its run and the chart's contract", () => {
  assert.deepEqual(agentContext("runs", view, shown({ stage: "paper", run: 12 }), { chart: "ETHUSDT", market: "SOL" }),
    { page: "runs", ...view, stage: "paper", paper_run: 12, live_run: null, coin: "ETHUSDT" });
  assert.equal(agentContext("runs", view, shown({ stage: "paper", run: 12 }), { chart: "equity", market: null }).coin, null, "Equity is no coin");
  assert.deepEqual(agentContext("runs", view, shown({ stage: "live", liveRun: "web-7" }), { chart: "BTCUSDT", market: null }),
    { page: "runs", ...view, stage: "live", paper_run: null, live_run: "web-7", coin: null });
});

test("off Runs no stage or run is said, and Market says its coin", () => {
  const picked = shown({ stage: "paper", run: 12 });
  assert.deepEqual(agentContext("research", view, picked, { chart: "BTCUSDT", market: "SOL" }),
    { page: "research", ...view, stage: null, paper_run: null, live_run: null, coin: null });
  assert.equal(agentContext("market", view, picked, { chart: "BTCUSDT", market: "SOL" }).coin, "SOL");
  assert.equal(agentContext("history", view, picked, none).stage, null);
});

// Tool parts as assistant-ui keeps an AI SDK answer's calls: the result is ide/agent's ToolOutput.
const call = (toolName, status, ok = true) => ({ type: "tool-call", toolCallId: `c-${toolName}`, toolName, args: {}, argsText: "{}",
  status: { type: status }, result: status === "complete" ? { command: `research state --ledger=r`, ok, output: {}, truncated: null } : undefined });

test("calls that answered fold; a running or failed call and the text stay apart", () => {
  assert.deepEqual(foldable(call("research_state", "complete")), ["group-reads"]);
  assert.equal(foldable(call("ledger_sql", "running")), null);
  assert.equal(foldable(call("ledger_sql", "complete", false)), null, "a refusal stays a card the user sees");
  assert.equal(foldable(call("ledger_sql", "incomplete")), null);
  assert.equal(foldable({ type: "text", text: "Run 12", status: { type: "complete" } }), null);
  assert.equal(foldNames(["research_state", "ledger_sql", "ledger_sql", "research_runs"]), "research_state, ledger_sql ×2, research_runs");
});
