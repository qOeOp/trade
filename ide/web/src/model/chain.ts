// Paper runs joined across restarts. A Docker or host restart ends a run (sealed with stop reason SIGTERM
// or KILLED and nothing else wrong, or only STOPPED_BEFORE_START), and the paper daemon starts the same
// candidate on the same contracts again as a new run with a fresh account (paper/serve.py seal_found).
// Nothing is stored for the link: a run continues the one before it when that one ended so, it is the
// candidate's next run, on the same contracts, created after the other stopped. The chain's latest run
// stands for it; its return compounds across the runs, each run's account picking up where the one before
// it ended.
import { clockSpan } from "../lib/format";
import { amount, type PaperRun } from "../lib/paperApi";

const RESTARTED = new Set(["SIGTERM", "KILLED"]);
const START = 100_000;  // USDT: a run's starting balance where its readings do not say

/** When the run was created (ns): the ledger writes UTC without a zone. */
export function createdNs(run: PaperRun): number {
  const text = run.created_at.trim().replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`) * 1e6;
}

/** The candidate's run just before `run` by paper id, if any. */
function previous(run: PaperRun, runs: readonly PaperRun[]): PaperRun | null {
  let found: PaperRun | null = null;
  for (const r of runs) if (r.candidate === run.candidate && r.paper_id < run.paper_id && (!found || r.paper_id > found.paper_id)) found = r;
  return found;
}

/** Whether `b` continues `a`: `a` was ended by a restart with nothing else wrong, and `b` is the same
 *  candidate's next run, on the same contracts, created after `a` stopped. */
export function continues(a: PaperRun, b: PaperRun, runs: readonly PaperRun[]): boolean {
  const seal = a.seal, reasons = seal?.reasons ?? [];
  if (a.state !== "sealed" || !seal || !RESTARTED.has(seal.stop_reason ?? "")) return false;
  if (reasons.length > 1 || (reasons.length === 1 && reasons[0] !== "STOPPED_BEFORE_START")) return false;
  if (a.candidate === null || b.candidate !== a.candidate || previous(b, runs)?.paper_id !== a.paper_id) return false;
  const same = new Set(a.symbols);
  if (same.size !== new Set(b.symbols).size || !b.symbols.every((s) => same.has(s))) return false;
  return seal.stopped_ns !== null && createdNs(b) > seal.stopped_ns;
}

/** The run that continues `run`, if one does. */
export function successor(run: PaperRun, runs: readonly PaperRun[]): PaperRun | null {
  let next: PaperRun | null = null;
  for (const r of runs) if (r.candidate === run.candidate && r.paper_id > run.paper_id && (!next || r.paper_id < next.paper_id)) next = r;
  return next && continues(run, next, runs) ? next : null;
}
/** Whether another run continues `run`: the list leaves it out, its chain's latest run standing for it. */
export const isContinued = (run: PaperRun, runs: readonly PaperRun[]) => successor(run, runs) !== null;

/** The chain ending at `run`, oldest first (`run` alone when it continues none). */
export function chainOf(run: PaperRun, runs: readonly PaperRun[]): PaperRun[] {
  const chain = [run];
  for (let before = previous(run, runs); before && continues(before, chain[0]!, runs); before = previous(before, runs)) chain.unshift(before);
  return chain;
}

/** The latest run of the chain `run` belongs to. */
export function latestOf(run: PaperRun, runs: readonly PaperRun[]): PaperRun {
  let at = run;
  for (let next = successor(at, runs); next; next = successor(at, runs)) at = next;
  return at;
}

/** A run's return as the listing reads it: its seal's once sealed, else its live reading. */
export const runReturn = (run: PaperRun) => (run.state === "sealed" ? run.seal?.total_return ?? run.total_return : run.live?.total_return ?? null);
/** A run's starting balance. */
export const startOf = (run: PaperRun) => amount(run.live?.starting_balance_usdt ?? run.seal?.starting_balance_usdt) ?? START;

/** The chain's return: each run's compounded, ∏(1 + rₖ) − 1; null while no run has one. */
export function chainReturn(chain: readonly PaperRun[]): number | null {
  const found = chain.map(runReturn);
  return found.every((r) => r === null) ? null : found.reduce<number>((g, r) => g * (1 + (r ?? 0)), 1) - 1;
}

/** When the chain's first run started (ns), once it has. */
export const chainStart = (chain: readonly PaperRun[]): number | null => chain[0]?.seal?.started_ns ?? chain[0]?.live?.started_ns ?? null;

/** How long the chain was offline (ms): from each run's stop to the start of the run after it, to the minute. */
export function chainOffline(chain: readonly PaperRun[]): number {
  let ms = 0;
  for (let k = 1; k < chain.length; k++) {
    const stopped = chain[k - 1]!.seal?.stopped_ns, next = chain[k]!, started = next.live?.started_ns ?? next.seal?.started_ns ?? createdNs(next);
    if (stopped != null) ms += clockSpan(stopped / 1e6, started / 1e6);
  }
  return ms;
}

/** The chain's equity, given its latest run's `equity`: the first run's starting balance grown by each
 *  earlier run's return and the latest run's equity over its own start. */
export function chainEquity(chain: readonly PaperRun[], equity: number | null): number | null {
  if (equity === null || !chain.length) return null;
  const latest = chain.at(-1)!, before = chain.slice(0, -1).reduce((g, r) => g * (1 + (runReturn(r) ?? 0)), 1);
  return startOf(chain[0]!) * before * (equity / startOf(latest));
}
