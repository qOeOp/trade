// What the Runs page shows of the selected version (state/selection.ts): the stage picked and the paper
// run picked (model/stage.ts), each kept per version for the session, so going back to a version finds
// them as they were; and what the chart shows of the run: "equity", or a contract (null until the page
// picks one). The trades follow the chart: a contract's alone, or all on Equity.
import type { PaperRun } from "../lib/paperApi";
import type { Stage } from "../model/stage";
import { atom } from "./atom";
import { deselect, isKnown, select, selection } from "./selection";

export type Choice = { stage?: Stage; run?: number };
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

/** Shows `run` and the paper stage: its version becomes the selected one first, or none when the run
 *  declares no version of this line. */
export function chooseRun(run: PaperRun): void {
  const version = run.candidate !== null && isKnown(run.candidate) ? run.candidate : null;
  if (version === null) deselect();
  else if (selection.get() !== version) select(version, { reveal: true });
  if (choiceOf(choices.get(), version).run !== run.paper_id) paperTab.set(null);
  choose(version, { stage: "paper", run: run.paper_id });
}
