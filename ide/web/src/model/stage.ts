// A version's stages as the Runs page shows them: its backtest (the line's research replay), its paper
// runs and live trading. The page describes one stage at a time and one paper run of the version (a chain
// of runs, chain.ts, standing as one); what the user picked wins while it still exists.
import type { PaperRun } from "../lib/paperApi";
import { ACTIVE, chainOf, createdNs, latestOf } from "./chain";
import type { Trial } from "./types";

export type Stage = "backtest" | "paper" | "live";

const startedNs = (r: PaperRun) => r.seal?.started_ns ?? r.live?.started_ns ?? createdNs(r);

/** The research replay the backtest stage draws: the version's last one with economic evidence. */
export const backtestTrial = (trials: readonly Trial[]): Trial | null =>
  [...trials].reverse().find((t) => t.purpose === "research" && t.eligible === true) ?? null;

/** The run a version shows until one is picked: its running chain, else the run that started last. */
export function defaultRun(mine: readonly PaperRun[]): PaperRun | null {
  const running = mine.filter((r) => ACTIVE.has(r.state));
  const from = running.length ? running : mine;
  return from.reduce<PaperRun | null>((best, r) => (!best || startedNs(r) > startedNs(best) ? r : best), null);
}

/** The run shown for `version`: the one picked (`chosen`) while it is the version's, else its default;
 *  without a version only the picked run, which declares none of this line's. A run continued since
 *  stands as its chain's latest. */
export function shownRun(runs: readonly PaperRun[], version: string | null, chosen: number | null): PaperRun | null {
  const picked = runs.find((r) => r.paper_id === chosen) ?? null;
  if (version === null) return picked && latestOf(picked, runs);
  const run = picked?.candidate === version ? picked : defaultRun(runs.filter((r) => r.candidate === version));
  return run && latestOf(run, runs);
}

/** The stage shown: the one picked while the version has it (live always is), else paper when it has a
 *  run, else its backtest; null when it has neither. */
export function stageOf(chosen: Stage | null, has: { backtest: boolean; paper: boolean }): Stage | null {
  if (chosen === "live" || (chosen && has[chosen])) return chosen;
  return has.paper ? "paper" : has.backtest ? "backtest" : null;
}

/** A chain's name: its first run, kept however often the chain is continued ("run 6" for runs 6 and 7). */
export function runName(chain: readonly PaperRun[]): string {
  return `run ${chain[0]?.paper_id ?? ""}`;
}

/** The stage's name as the page writes it: "Backtest · trial 200", "Paper · run 6", "Live · not authorized". */
export function stageName(stage: Stage, trial: Trial | null, run: PaperRun | null, runs: readonly PaperRun[]): string {
  if (stage === "backtest") return `Backtest · trial ${trial?.trial_id ?? ""}`;
  if (stage === "paper") return `Paper · ${run ? runName(chainOf(run, runs)) : "no run"}`;
  return "Live · not authorized";
}
