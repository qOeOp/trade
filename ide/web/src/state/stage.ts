// What the Runs page shows of the selected version (state/selection.ts): the stage picked, the research
// replay its backtest draws and the paper run picked (model/stage.ts), each kept per version for the session, so going back to a version finds
// them as they were; and what the chart shows of the run: "equity", or a contract (null until the page
// picks one). The trades follow the chart: a contract's alone, or all on Equity.
import { lineOf, runHref } from "../lib/lines";
import type { PaperRun } from "../lib/paperApi";
import type { Stage } from "../model/stage";
import { atom } from "./atom";
import { researchLines } from "./researchLines";
import { deselect, hasView, isKnown, select, selection } from "./selection";

export type Choice = { stage?: Stage; run?: number; trial?: number };
/** Per version (the empty key: no version selected). */
export const choices = atom<ReadonlyMap<string, Choice>>(new Map());
export const paperTab = atom<string | null>(null);

const keyOf = (version: string | null) => version ?? "";
export const choiceOf = (all: ReadonlyMap<string, Choice>, version: string | null): Choice => all.get(keyOf(version)) ?? {};

function choose(version: string | null, choice: Choice): void {
  const next = new Map(choices.get());
  next.set(keyOf(version), { ...choiceOf(next, version), ...choice });
  choices.set(next);
}

/** Shows `stage` of the selected version, its paper run as it was. */
export const chooseStage = (stage: Stage) => choose(selection.get(), { stage });

/** Shows the backtest of research replay `trial` of the selected version. */
export const chooseTrial = (trial: number) => choose(selection.get(), { stage: "backtest", trial });

/** Shows `run` and the paper stage: its version becomes the selected one first. A version of another
 *  line (lib/lines.ts lineOf) opens that line's page, the run picked there (pickWanted); one of no line
 *  leaves none selected. The chart keeps Equity, or a contract the run trades. */
export function chooseRun(run: PaperRun): void {
  const version = run.candidate !== null && isKnown(run.candidate) ? run.candidate : null;
  const line = version === null && run.candidate !== null ? lineOf(researchLines.get().lines, run.candidate) : null;
  if (line && line.bundle !== new URLSearchParams(window.location.search).get("line")) {
    window.location.assign(runHref(window.location.href, line.bundle, run.candidate!, run.paper_id));
    return;
  }
  if (version === null) deselect();
  else if (selection.get() !== version) select(version, { reveal: true });
  const tab = paperTab.get();
  if (choiceOf(choices.get(), version).run !== run.paper_id && tab !== "equity" && !run.symbols.includes(tab ?? "")) paperTab.set(null);
  choose(version, { stage: "paper", run: run.paper_id });
}

/** The run the address names (`run=`, left by chooseRun opening its line). */
let wanted = Number(new URLSearchParams(window.location.search).get("run")) || null;

/** Once the view is shown and the runs are listed (`runs`, null until they are): picks the run the address
 *  names, if it is listed, and drops it from the address. */
export function pickWanted(runs: readonly PaperRun[] | null): void {
  if (wanted === null || runs === null || !hasView()) return;
  const run = runs.find((r) => r.paper_id === wanted);
  wanted = null;
  const url = new URL(window.location.href);
  url.searchParams.delete("run");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  if (run) chooseRun(run);
}
