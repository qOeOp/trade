import assert from "node:assert/strict";
import { test } from "node:test";
import { argv, COMMANDS, LIMIT, outcome, productTools, type ToolName } from "./tools.ts";

const product = { root: "/opt/trade", ledger: "research", market: "market" };

// The product's read-only commands. A tool for any other command would let the model write.
const READ_ONLY = new Set(["research state", "research status", "research runs", "candidate list", "candidate show", "replay report", "ledger sql", "market coverage"]);

test("every tool runs a read-only product command", () => {
  for (const [name, spec] of Object.entries(COMMANDS)) {
    const sample = { candidate: "x@1", trial_id: 1, query: "SELECT 1", start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" };
    const [noun, verb] = (spec.argv as (i: unknown) => string[])(sample);
    assert.ok(READ_ONLY.has(`${noun} ${verb}`), `${name} runs ${noun} ${verb}`);
  }
});

test("the profiles follow the noun and verb, and options are --name=value", () => {
  assert.deepEqual(argv(product, "research_state", { line: "ema-cross", full: true } as never),
    ["research", "state", "--ledger=research", "--line=ema-cross", "--full"]);
  const runs = COMMANDS.research_runs.input.parse({ by: "sharpe_365" });
  assert.deepEqual(argv(product, "research_runs", runs as never),
    ["research", "runs", "--ledger=research", "--by=sharpe_365", "--limit=30"], "30 runs unless the model asks for more");
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

test("long JSON loses items of its largest arrays, keeps every key and says what it left out", () => {
  const runs = Array.from({ length: 400 }, (_, i) => ({ trial_id: i, note: "x".repeat(100) }));
  const big = JSON.stringify({ excluded: Array.from({ length: 50 }, (_, i) => i), comparison: { runs, measures: ["sharpe_365"] } });
  const cut = outcome("research status", { code: 0, stdout: big, stderr: "" });
  const output = cut.output as { excluded: number[]; comparison: { runs: unknown[]; measures: string[] } };
  assert.ok(JSON.stringify(output).length <= LIMIT);
  assert.equal(cut.truncated, big.length);
  assert.deepEqual(output.excluded, Array.from({ length: 50 }, (_, i) => i));
  assert.deepEqual(output.comparison.measures, ["sharpe_365"]);
  const kept = output.comparison.runs.length - 1;
  assert.deepEqual(output.comparison.runs.slice(0, kept), runs.slice(0, kept));
  assert.equal(output.comparison.runs.at(-1), `[${400 - kept} of 400 items left out to fit ${LIMIT} characters]`);
});

test("long text, or JSON with nothing to cut, keeps its first LIMIT characters", () => {
  for (const big of ["x".repeat(LIMIT * 2), JSON.stringify({ rows: "x".repeat(LIMIT * 2) })]) {
    const cut = outcome("ledger sql", { code: 0, stdout: big, stderr: "" });
    assert.equal(cut.output, big.slice(0, LIMIT));
    assert.equal(cut.truncated, big.length);
  }
});

test("a refusal reaches the model as the product's refusal JSON", async () => {
  const tools = productTools(product, async () => ({ code: 2, stdout: "", stderr: '{"code": "LEDGER_UNAVAILABLE", "message": "down"}' }));
  const result = await tools.research_status.execute!({}, { toolCallId: "1", messages: [] } as never);
  assert.deepEqual(result, { command: "research status --ledger=research", ok: false, output: { code: "LEDGER_UNAVAILABLE", message: "down" }, truncated: null });
});
