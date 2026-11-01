// Paper runs joined into one: a run is running or stopped, and starting a candidate again on the same
// contracts carries on where it stopped, however it stopped (by the user, its duration, a crash, a Docker or
// host restart, after which the paper daemon starts it again itself: paper/serve.py seal_found), unless it
// is invalid (the listing's verdict, ending.ts): its evidence is untrusted, so nothing joins onto it. Nothing
// is stored for the link: a run continues the candidate's valid run before it on the same contracts when it
// was created after that one stopped. The chain's latest run stands for it; its return compounds across the
// runs, each run's account picking up where the one before it ended.
import { clockSpan } from "../lib/format";
import { amount, type PaperRun } from "../lib/paperApi";
import { ending, hasReturn, type Gap } from "./ending";

const START = 100_000;  // USDT: a run's starting balance where its readings do not say

/** When the run was created (ns): the ledger writes UTC without a zone. */
export function createdNs(run: PaperRun): number {
  const text = run.created_at.trim().replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`) * 1e6;
}

const sameContracts = (a: PaperRun, b: PaperRun) => { const set = new Set(a.symbols); return set.size === new Set(b.symbols).size && b.symbols.every((x) => set.has(x)); };
const kin = (a: PaperRun, b: PaperRun) => a.candidate !== null && a.candidate === b.candidate && sameContracts(a, b);

/** The candidate's run on the same contracts just before `run` by paper id, if any. */
function previous(run: PaperRun, runs: readonly PaperRun[]): PaperRun | null {
  let found: PaperRun | null = null;
  for (const r of runs) if (kin(r, run) && r.paper_id < run.paper_id && (!found || r.paper_id > found.paper_id)) found = r;
  return found;
}

/** Whether `b` continues `a`: `a` is sealed and not invalid, and `b` is the same candidate's next run on
 *  the same contracts, created after `a` stopped. */
export function continues(a: PaperRun, b: PaperRun, runs: readonly PaperRun[]): boolean {
  const stopped = a.state === "sealed" && a.status !== "invalid" ? a.seal?.stopped_ns ?? null : null;
  return stopped !== null && previous(b, runs)?.paper_id === a.paper_id && createdNs(b) > stopped;
}

/** The run that continues `run`, if one does. */
export function successor(run: PaperRun, runs: readonly PaperRun[]): PaperRun | null {
  let next: PaperRun | null = null;
  for (const r of runs) if (kin(r, run) && r.paper_id > run.paper_id && (!next || r.paper_id < next.paper_id)) next = r;
  return next && continues(run, next, runs) ? next : null;
}
/** Whether another run continues `run`: the list leaves it out, its chain's latest run standing for it. */
export const isContinued = (run: PaperRun, runs: readonly PaperRun[]) => successor(run, runs) !== null;
/** Whether starting `run`'s candidate again on its contracts now would continue it: it is sealed and not
 *  invalid, and no later run of the candidate on them exists. */
export const continuable = (run: PaperRun, runs: readonly PaperRun[]) =>
  run.state === "sealed" && run.status !== "invalid" && !runs.some((r) => kin(r, run) && r.paper_id > run.paper_id);

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

/** A run's return as the listing reads it: its seal's once sealed (none when it ran on no data or its seal
 *  has no final equity), else its live reading. */
export const runReturn = (run: PaperRun) =>
  (run.state === "sealed" ? (hasReturn(run.seal) ? run.seal!.total_return : null) : run.live?.total_return ?? null);
/** A run's starting balance. */
export const startOf = (run: PaperRun) => amount(run.live?.starting_balance_usdt ?? run.seal?.starting_balance_usdt) ?? START;

/** The chain's return: each run's compounded, ∏(1 + rₖ) − 1; null while no run has one. */
export function chainReturn(chain: readonly PaperRun[]): number | null {
  const found = chain.map(runReturn);
  return found.every((r) => r === null) ? null : found.reduce<number>((g, r) => g * (1 + (r ?? 0)), 1) - 1;
}

/** When the chain's first run started (ns), once it has. */
export const chainStart = (chain: readonly PaperRun[]): number | null => chain[0]?.seal?.started_ns ?? chain[0]?.live?.started_ns ?? null;

/** How long the chain was paused and offline (ms), each gap from a run's stop to the start of the run after
 *  it, to the minute, by how the run before it ended (ending.ts); a kind it never had is left out. */
export function chainGaps(chain: readonly PaperRun[]): Partial<Record<Gap, number>> {
  const gaps: Partial<Record<Gap, number>> = {};
  for (let k = 1; k < chain.length; k++) {
    const before = chain[k - 1]!, stopped = before.seal?.stopped_ns, next = chain[k]!, started = next.live?.started_ns ?? next.seal?.started_ns ?? createdNs(next);
    const gap = ending(before).gap;
    if (stopped != null) gaps[gap] = (gaps[gap] ?? 0) + clockSpan(stopped / 1e6, started / 1e6);
  }
  return gaps;
}

/** The chain's equity, given its latest run's `equity`: the first run's starting balance grown by each
 *  earlier run's return and the latest run's equity over its own start. */
export function chainEquity(chain: readonly PaperRun[], equity: number | null): number | null {
  if (equity === null || !chain.length) return null;
  const latest = chain.at(-1)!, before = chain.slice(0, -1).reduce((g, r) => g * (1 + (runReturn(r) ?? 0)), 1);
  return startOf(chain[0]!) * before * (equity / startOf(latest));
}
