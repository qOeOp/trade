// The selected version's stage and paper run as the Runs page, Details, the Trades window, the toolbar
// and the status bar read them: worked out from the view, the runs listed and what was picked
// (state/stage.ts), so each reads the same answer.
import { useMemo } from "react";
import type { PaperRun } from "../lib/paperApi";
import { chainOf } from "../model/chain";
import { backtestTrial, shownRun, stageName, stageOf, type Stage } from "../model/stage";
import type { DetailWidget, Trial } from "../model/types";
import { useWidget } from "../model/view";
import { useAtom } from "./atom";
import { paperRuns } from "./paper";
import { useSelection } from "./selection";
import { choiceOf, choices } from "./stage";

export type Shown = {
  version: string | null; stage: Stage | null; trial: Trial | null; run: PaperRun | null;
  /** The run's chain, oldest first (model/chain.ts). */
  chain: PaperRun[];
  /** The stage's name: "Backtest · trial 200", "Paper · run 6". */
  name: string | null;
};

export function useShown(): Shown {
  const detail = useWidget<DetailWidget>("candidate-detail@1");
  const version = useSelection();
  const listing = useAtom(paperRuns);
  const choice = choiceOf(useAtom(choices), version);
  return useMemo(() => {
    const runs = listing?.runs ?? [];
    const trials = (version && detail?.items.find((c) => c.id === version)?.trials) || [];
    const trial = backtestTrial(trials), run = shownRun(runs, version, choice.run ?? null);
    const stage = version === null ? (run ? "paper" : null) : stageOf(choice.stage ?? null, { backtest: trial !== null, paper: run !== null });
    return { version, stage, trial, run, chain: run ? chainOf(run, runs) : [], name: stage && stageName(stage, trial, run, runs) };
  }, [detail, version, listing, choice.run, choice.stage]);
}
