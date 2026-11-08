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

import type { RunChoice as Choice } from "../model/runSelection";
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

/** Automatic restoration keeps the address intent pending until its inputs arrive. */
export const restoreStage = (stage: Stage) => choose(selection.get(), { stage });

/** A new user choice supersedes a Paper link still waiting for its view or listing. */
export const chooseStage = (stage: Stage) => { forgetWanted(); restoreStage(stage); };

/** Live identities are private string IDs, never Paper's numeric IDs. No command is submitted. */
export function chooseLiveRun(id: string, candidate: string | null): void {
  forgetWanted();
  restoreLiveRun(id, candidate);
}

/** Rebinds the retained Live selection after a research view arrives; this is not a new intent. */
export function restoreLiveRun(id: string, candidate: string | null): void {
  const version = candidate && isKnown(candidate) ? candidate : null;
  if (version === null) deselect();
  else if (selection.get() !== version) select(version, { reveal: true });
  choose(version, { stage: "live", liveRun: id });
}

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

/** A phone's Runs tab: `run` on its own, whichever line it is on, with no version selected and no page
 *  opened for its line. */
export function showRun(run: PaperRun): void {
  if (selection.get() !== null) deselect();
  const tab = paperTab.get();
  if (tab !== null && tab !== "equity" && !run.symbols.includes(tab)) paperTab.set(null);
  choose(null, { stage: "paper", run: run.paper_id });
}

/** A phone's Runs tab, which draws no line: the backtest of `run`'s version (on `bundle`), on that version's page. */
export const openBacktest = (bundle: string, version: string, run: number) => window.location.assign(runHref(window.location.href, bundle, version, run, "backtest"));

/** The run the address names (`run=`, left by chooseRun opening its line) and the stage (`stage=`, left by openBacktest). */
const address = new URLSearchParams(window.location.search);
let wanted = Number(address.get("run")) || null;

/** Consumes only the pending link identity, preserving the line, snapshot and version in the address. */
function forgetWanted(): void {
  if (wanted === null) return;
  wanted = null;
  const url = new URL(window.location.href);
  url.searchParams.delete("run");
  url.searchParams.delete("stage");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Once the view is shown and the runs are listed (`runs`, null until they are): picks the run the address
 *  names, if no newer user selection has superseded it, and drops it from the address. */
export function pickWanted(runs: readonly PaperRun[] | null): void {
  if (wanted === null || runs === null || !hasView()) return;
  const run = runs.find((r) => r.paper_id === wanted);
  forgetWanted();
  if (!run) return;
  chooseRun(run);
  if (address.get("stage") === "backtest") restoreStage("backtest");
}
