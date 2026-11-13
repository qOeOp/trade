/** Read-only selection shared by Runs, Details, Trades and both shell layouts.
 * Navigation keeps its existing per-version choice shape; this projection never writes it. */
import type { PaperRun } from "../lib/paperApi";
import type { LiveRun } from "./liveTrading";
import type { Trial } from "./types";
import { chainOf } from "./chain";
import { shownLiveRun } from "./liveRunSelection";
import { backtestTrial, shownRun, stageName, stageOf, type Stage } from "./stage";

export type RunChoice = { stage?: Stage; run?: number; liveRun?: string; trial?: number };
type Available = { version: string | null; trial: Trial | null; liveRun: LiveRun | null; name: string | null };
/** Stage is the discriminant. Live has a private string identity and never a Paper stream/chain. */
export type Shown = Available & (
  | { stage: "live"; run: null; chain: [] }
  | { stage: "backtest" | "paper" | null; run: PaperRun | null; chain: PaperRun[] }
);

export function resolveRunSelection({ version, runs, trials, live, choice }: {
  version: string | null; runs: readonly PaperRun[]; trials: readonly Trial[]; live: readonly LiveRun[]; choice: RunChoice;
}): Shown {
  const trial = backtestTrial(trials, choice.trial ?? null), run = shownRun(runs, version, choice.run ?? null);
  const liveRun = shownLiveRun(live, version, choice.liveRun);
  if (choice.stage === "live") return { version, stage: "live", trial, run: null, liveRun, chain: [], name: liveRun ? `Live · ${liveRun.id}` : "Live" };
  const stage = version === null ? (run ? "paper" : null) : stageOf(choice.stage ?? null, { backtest: trial !== null, paper: run !== null });
  return { version, stage, trial, run, liveRun, chain: run ? chainOf(run, runs) : [], name: stage && stageName(stage, trial, run) };
}
