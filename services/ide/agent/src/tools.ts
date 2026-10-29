// The agent's tools: the product's read-only commands and nothing else. This list is the trust
// boundary: what the model can do is decided here, not by its prompt. Each tool builds an argument
// list from validated input (options as --name=value, never through a shell) and runs the product's
// command line on the reader profile; in the Docker image the service file holds only reader
// accounts, so the database itself refuses a write.
import { execFile } from "node:child_process";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

export type Product = { root: string; ledger: string; market: string | null };
export type Run = (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
export type ToolOutput = { command: string; ok: boolean; output: unknown; truncated: number | null };

export const LIMIT = 20_000;  // characters of output the model sees from one call

const ref = z.string().regex(/^[\w./@-]{1,100}$/).refine((s) => !s.startsWith("-"), "must not start with -");
const at = ref.optional().describe("ledger commit, tag or branch (default: the head)");
const line = z.string().regex(/^research-line-[\w-]{1,100}$/).optional().describe("research line bundle (default: the only open line; name one when several are open)");
const flag = (name: string, on: boolean | undefined) => (on ? [`--${name}`] : []);
const opt = (name: string, value: string | number | undefined) => (value === undefined ? [] : [`--${name}=${value}`]);

/** Each tool's command and how its input becomes arguments (exported for the tests). */
export const COMMANDS = {
  research_state: {
    description: "A research line (default: the only open one): its record, targets and current judgments with read-time facts; with no line named it lists the open lines. Start here.",
    input: z.object({ line, at, full: z.boolean().optional().describe("every interpretation and the candidate list") }),
    argv: (i: { line?: string; at?: string; full?: boolean }) => ["research", "state", ...opt("line", i.line), ...opt("at", i.at), ...flag("full", i.full)],
  },
  research_status: {
    description: "Research fact counts and the line's comparison table of versions and their readings.",
    input: z.object({ line, at }),
    argv: (i: { line?: string; at?: string }) => ["research", "status", ...opt("line", i.line), ...opt("at", i.at)],
  },
  candidate_list: {
    description: "Every published strategy candidate (ID@N versions).",
    input: z.object({ at }),
    argv: (i: { at?: string }) => ["candidate", "list", ...opt("at", i.at)],
  },
  candidate_show: {
    description: "One candidate version: its description, parent, difference from the parent and source hash. The source text itself: ledger_sql \"SELECT CAST(source AS CHAR) AS source FROM candidate WHERE strategy_id='ID' AND revision=N\".",
    input: z.object({ candidate: z.string().regex(/^[\w.-]{1,80}@\d{1,6}$/).describe("ID@N"), at }),
    argv: (i: { candidate: string; at?: string }) => ["candidate", "show", `--candidate=${i.candidate}`, ...opt("at", i.at)],
  },
  replay_report: {
    description: "A trial's sealed replay result: readings, metrics and report measures; optionally its drill-down tables.",
    input: z.object({
      trial_id: z.number().int().positive(), at,
      tables: z.boolean().optional(), account: z.boolean().optional(), exposures: z.boolean().optional(),
    }),
    argv: (i: { trial_id: number; at?: string; tables?: boolean; account?: boolean; exposures?: boolean }) =>
      ["replay", "report", `--trial-id=${i.trial_id}`, ...opt("at", i.at), ...flag("tables", i.tables), ...flag("account", i.account), ...flag("exposures", i.exposures)],
  },
  ledger_sql: {
    description: "One read-only SQL statement (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH, TABLE or VALUES) on the research ledger with the reader account. Use SHOW TABLES and DESCRIBE before writing a query.",
    input: z.object({ query: z.string().min(1).max(4000).refine((q) => !q.trimStart().startsWith("-"), "must not start with - (drop leading comments)"), at }),
    argv: (i: { query: string; at?: string }) => ["ledger", "sql", ...opt("at", i.at), i.query.trim()],
  },
  market_coverage: {
    description: "Per-contract market data coverage facts over an interval at a market commit.",
    input: z.object({
      start: z.string().regex(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/).describe("UTC ISO-8601 with Z"),
      end: z.string().regex(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/).describe("UTC ISO-8601 with Z"),
      symbols: z.array(z.string().regex(/^[A-Z0-9]{2,30}$/)).max(50).optional().describe("Binance symbols (default: every universe member)"),
      at: ref.optional().describe("market commit, tag or branch (default: the head)"),
    }),
    argv: (i: { start: string; end: string; symbols?: string[]; at?: string }) =>
      ["market", "coverage", `--start=${i.start}`, `--end=${i.end}`, ...opt("at", i.at), ...(i.symbols?.length ? ["--symbols", ...i.symbols] : [])],
  },
} as const;

export type ToolName = keyof typeof COMMANDS;

/** The full argument list for the product's command line, with the profiles this service reads. */
export function argv(product: Product, name: ToolName, input: never): string[] {
  const args = (COMMANDS[name].argv as (i: unknown) => string[])(input);
  const profiles = [`--ledger=${product.ledger}`, ...(name === "market_coverage" && product.market ? [`--market=${product.market}`] : [])];
  return [...args.slice(0, 2), ...profiles, ...args.slice(2)];
}

export const runProduct = (product: Product): Run => (args) => new Promise((resolve) => {
  execFile("uv", ["run", "--frozen", "--project", product.root, "python", "-m", "cli.main", ...args],
    { cwd: product.root, timeout: 180_000, maxBuffer: 256 * 1024 * 1024 },
    (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }));
});

/** A command's answer as the model sees it: its JSON, or its refusal, cut to LIMIT characters. */
export function outcome(command: string, done: { code: number; stdout: string; stderr: string }): ToolOutput {
  const text = (done.code ? done.stderr || done.stdout : done.stdout).trim();
  let output: unknown = text;
  try { output = JSON.parse(text); } catch { /* not JSON: keep the text */ }
  const compact = typeof output === "string" ? output : JSON.stringify(output);
  if (compact.length <= LIMIT) return { command, ok: done.code === 0, output, truncated: null };
  return { command, ok: done.code === 0, output: compact.slice(0, LIMIT), truncated: compact.length };
}

export function productTools(product: Product, run: Run = runProduct(product)): ToolSet {
  const tools: ToolSet = {};
  for (const name of Object.keys(COMMANDS) as ToolName[]) {
    const spec = COMMANDS[name];
    tools[name] = tool({
      description: spec.description,
      inputSchema: spec.input as z.ZodType<Record<string, unknown>>,
      execute: async (input) => {
        const args = argv(product, name, input as never);
        return outcome(args.join(" "), await run(args));
      },
    });
  }
  return tools;
}
