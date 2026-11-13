// A strategy's paper record: every run of one version on one set of contracts, the chains (model/chain.ts)
// and the starts that failed between them, read as one history. The run picker lists a strategy once and
// shows this beside it.
import { clockSpan } from "../lib/format";
import type { PaperRun } from "../lib/paperApi";
import { ACTIVE, began, chainStart, continues } from "./chain";
import { ending, type Ending } from "./ending";

/** What makes runs one strategy: the version and the contracts it trades; a run with no version is its own. */
export const strategyKey = (run: PaperRun) => (run.candidate === null ? `#${run.paper_id}` : `${run.candidate} ${[...run.symbols].sort().join(",")}`);

/** The runs of `run`'s strategy, oldest first. */
export const strategyRuns = (run: PaperRun, all: readonly PaperRun[]) =>
  all.filter((r) => strategyKey(r) === strategyKey(run)).sort((a, b) => a.paper_id - b.paper_id);

/** The run that stands for each strategy: its latest active run, else its latest that started, else its latest. */
export function strategyHeads(all: readonly PaperRun[]): PaperRun[] {
  const heads = new Map<string, PaperRun>(), rank = (r: PaperRun) => (ACTIVE.has(r.state) ? 2 : began(r) ? 1 : 0);
  for (const r of [...all].sort((a, b) => a.paper_id - b.paper_id)) {
    const k = strategyKey(r), at = heads.get(k);
    if (!at || rank(r) >= rank(at)) heads.set(k, r);
  }
  return [...heads.values()].sort((a, b) => a.paper_id - b.paper_id);
}

/** The runs the picker lists: each strategy's head, and any other run of it not sealed yet (left over from
 *  a stop that has not finished, it still needs its own Resume or Stop and seal), oldest first. */
export function strategyRows(all: readonly PaperRun[]): PaperRun[] {
  const heads = strategyHeads(all);
  return [...heads, ...all.filter((r) => ACTIVE.has(r.state) && !heads.includes(r))].sort((a, b) => a.paper_id - b.paper_id);
}

/** Whether `row` is the row to mark for the shown run `front`: it is that run, or `front` is not a row and is
 *  one of `row`'s strategy's runs. */
export const rowShows = (row: PaperRun, front: PaperRun | null, all: readonly PaperRun[]) =>
  !!front && (row.paper_id === front.paper_id || (!strategyRows(all).some((r) => r.paper_id === front.paper_id) && strategyKey(row) === strategyKey(front)));

/** When a run started and stopped (ms); a run that never started has neither. */
export const startedMs = (run: PaperRun): number | null => { const ns = chainStart([run]); return ns === null ? null : ns / 1e6; };
const stoppedMs = (run: PaperRun): number | null => (run.state === "sealed" && run.seal?.stopped_ns ? run.seal.stopped_ns / 1e6 : null);

/** One step of a history: a run that started (`end` once sealed; a run that stopped before its first bar is a
 *  failed start), the stretch from one's stop to the next
 *  one's start (`idle` when the later one began a new account rather than continuing, `failed` the starts
 *  that failed in it; none while the one before has not stopped), or a failed start with no stretch around
 *  it. Times in ms, stretches to the minute as a clock shows them. */
export type Step =
  | { kind: "run"; run: PaperRun; from: number | null; to: number | null; end: Ending | null }
  | { kind: "gap"; gap: "paused" | "offline" | "idle"; from: number | null; ms: number | null; lead: string; failed: PaperRun[] }
  | { kind: "unstarted"; run: PaperRun };

type History = {
  runs: number; failed: number; stops: number; paused: number; offline: number;
  /** Newest first. */
  steps: Step[];
};

/** Whether a run's start failed: it never started, or it stopped before its first bar (ending.ts). */
const failedStart = (run: PaperRun) => !began(run) || (run.state === "sealed" && ending(run).kind === "unstarted");

/** The history of a strategy's runs (`runs`, oldest first; `all`, the whole listing, says which continue). */
export function historyOf(runs: readonly PaperRun[], all: readonly PaperRun[]): History {
  const steps: Step[] = [];
  const unstarted = (run: PaperRun): Step => ({ kind: "unstarted", run });
  let prev: PaperRun | null = null, waiting: PaperRun[] = [], started = 0, paused = 0, offline = 0;
  for (const run of runs) {
    if (failedStart(run)) { waiting.push(run); continue; }
    started++;
    const from = startedMs(run);
    const at = prev && stoppedMs(prev);
    if (prev && at !== null) {
      const end = ending(prev), ms = from !== null ? clockSpan(at, from) : null;
      const gap = continues(prev, run, all) ? end.gap : "idle";
      if (ms !== null && gap === "paused") paused += ms;
      if (ms !== null && gap === "offline") offline += ms;
      steps.push({ kind: "gap", gap, from: at, ms, lead: end.lead, failed: waiting });
    } else steps.push(...waiting.map(unstarted));
    waiting = [];
    steps.push({ kind: "run", run, from, to: stoppedMs(run), end: run.state === "sealed" ? ending(run) : null });
    prev = run;
  }
  steps.push(...waiting.map(unstarted));
  const failed = runs.filter(failedStart).length, stops = runs.filter((r) => !failedStart(r) && r.state === "sealed").length;
  return { runs: started, failed, stops, paused, offline, steps: steps.reverse() };
}
