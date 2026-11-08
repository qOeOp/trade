// A version's stages as the Runs page shows them: its backtest (the line's research replay), its paper
// runs. The page describes one stage at a time and one paper run of the version (a chain
// of runs, chain.ts, standing as one); what the user picked wins while it still exists.
import type { PaperRun } from "../lib/paperApi";
import { ACTIVE, createdNs, latestOf } from "./chain";
import type { Trial } from "./types";
import type { Backtest } from "./backtest";
import type { Stretch } from "./stretches";

export type Stage = "backtest" | "paper" | "live";

/** Charts use the same stage as Details and Trades. A backtest never changes a paper account's basis. */
export function chartHistory(stage: Stage, stretches: readonly Stretch[], backtest: Backtest | null): { stretches: readonly Stretch[]; backtest: Backtest | null } {
  return stage === "backtest" ? { stretches: [], backtest } : { stretches: stage === "paper" ? stretches : [], backtest: null };
}

const startedNs = (r: PaperRun) => r.seal?.started_ns ?? r.live?.started_ns ?? createdNs(r);

/** A trial the backtest stage can draw: a research replay with economic evidence (others ran on no
 *  window or market commit of this line's that the view holds). */
export const drawable = (t: Trial) => t.purpose === "research" && t.eligible === true;

/** The research replay the backtest stage draws: the one picked (`chosen`) while it can be, else the
 *  version's last one with economic evidence. */
export const backtestTrial = (trials: readonly Trial[], chosen: number | null = null): Trial | null =>
  trials.find((t) => t.trial_id === chosen && drawable(t)) ?? [...trials].reverse().find(drawable) ?? null;

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

/** The stage shown: the one picked while the version has it, else paper when it has a
 *  run, else its backtest; null when it has neither. */
export function stageOf(chosen: Stage | null, has: { backtest: boolean; paper: boolean; live?: boolean }): Stage | null {
  if (chosen && has[chosen]) return chosen;
  return has.paper ? "paper" : has.backtest ? "backtest" : null;
}

/** A run's contracts as the page names them: "BTCUSDT", "BTCUSDT, ETHUSDT", "12 contracts". */
export const contracts = (symbols: readonly string[]) => (symbols.length > 2 ? `${symbols.length} contracts` : symbols.join(", "));

/** The stage's name as the page writes it, after the version it belongs to: "Backtest · trial 200", "Paper · BTCUSDT". */
export function stageName(stage: Stage, trial: Trial | null, run: PaperRun | null): string {
  if (stage === "backtest") return `Backtest · trial ${trial?.trial_id ?? ""}`;
  if (stage === "live") return "Live";
  return `Paper · ${run ? contracts(run.symbols) : "no run"}`;
}
