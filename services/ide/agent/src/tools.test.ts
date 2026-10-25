import assert from "node:assert/strict";
import { test } from "node:test";
import { argv, COMMANDS, LIMIT, outcome, productTools, type ToolName } from "./tools.ts";

const product = { root: "/opt/trade", ledger: "research", market: "market" };

// The product's read-only commands. A tool for any other command would let the model write.
const READ_ONLY = new Set(["research state", "research status", "candidate list", "candidate show", "replay report", "ledger sql", "market coverage"]);

test("every tool runs a read-only product command", () => {
  for (const [name, spec] of Object.entries(COMMANDS)) {
    const sample = { candidate: "x@1", trial_id: 1, query: "SELECT 1", start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" };
    const [noun, verb] = (spec.argv as (i: unknown) => string[])(sample);
    assert.ok(READ_ONLY.has(`${noun} ${verb}`), `${name} runs ${noun} ${verb}`);
  }
});

test("the profiles follow the noun and verb, and options are --name=value", () => {
  assert.deepEqual(argv(product, "research_state", { line: "research-line-ema", full: true } as never),
    ["research", "state", "--ledger=research", "--line=research-line-ema", "--full"]);
  assert.deepEqual(argv(product, "market_coverage", { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z", symbols: ["BTCUSDT"] } as never),
    ["market", "coverage", "--ledger=research", "--market=market", "--start=2026-01-01T00:00:00Z", "--end=2026-02-01T00:00:00Z", "--symbols", "BTCUSDT"]);
});

test("input that could read as an option is refused", () => {
  const refused: [ToolName, unknown][] = [
    ["ledger_sql", { query: "-- comment\nSELECT 1" }],
    ["candidate_show", { candidate: "--at=x@1" }],
    ["research_status", { at: "-x" }],
    ["market_coverage", { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z", symbols: ["--help"] }],
  ];
  for (const [name, input] of refused) assert.equal(COMMANDS[name].input.safeParse(input).success, false, `${name} ${JSON.stringify(input)}`);
});

test("a long answer is cut and says how long it was", () => {
  const big = JSON.stringify({ rows: "x".repeat(LIMIT * 2) });
  const cut = outcome("ledger sql", { code: 0, stdout: big, stderr: "" });
  assert.equal((cut.output as string).length, LIMIT);
  assert.equal(cut.truncated, big.length);
});

test("a refusal reaches the model as the product's refusal JSON", async () => {
  const tools = productTools(product, async () => ({ code: 2, stdout: "", stderr: '{"code": "LEDGER_UNAVAILABLE", "message": "down"}' }));
  const result = await tools.research_status.execute!({}, { toolCallId: "1", messages: [] } as never);
  assert.deepEqual(result, { command: "research status --ledger=research", ok: false, output: { code: "LEDGER_UNAVAILABLE", message: "down" }, truncated: null });
});
