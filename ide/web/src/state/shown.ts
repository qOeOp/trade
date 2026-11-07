// The selected version's stage and paper run as the Runs page, Details, the Trades window, the toolbar
// and the status bar read them: worked out from the view, the runs listed and what was picked
// (state/stage.ts), so each reads the same answer.
import { useMemo } from "react";
import type { PaperRun } from "../lib/paperApi";
import type { LiveRun } from "../model/liveTrading";
import { shownLiveRun } from "../model/liveRunSelection";
import { chainOf } from "../model/chain";
import { backtestTrial, shownRun, stageName, stageOf, type Stage } from "../model/stage";
import { lineOf } from "../lib/lines";
import type { DetailWidget, LineageWidget, Trial } from "../model/types";
import { useView, useWidget } from "../model/view";
import { useAtom } from "./atom";
import { paperRuns } from "./paper";
import { useLiveTrading } from "./liveTrading";
import { useResearchLines } from "./researchLines";
import { useSelection } from "./selection";
import { choiceOf, choices } from "./stage";

export type Shown = {
  version: string | null; stage: Stage | null; trial: Trial | null; run: PaperRun | null;
  liveRun: LiveRun | null;
  /** The run's chain, oldest first (model/chain.ts). */
  chain: PaperRun[];
  /** The stage's name: "Backtest · trial 200", "Paper · run 6". */
  name: string | null;
};

/** The targets the shown stage answers to: its line's, or with no line drawn (a phone's Runs tab) those of the
 *  line its run's version is on. */
export function useTargets(): { limit: number | null; annual: number | null } {
  const view = useView(), lineage = useWidget<LineageWidget>("lineage@2"), { lines } = useResearchLines(), { run } = useShown();
  const t = view.targets ?? lineage?.targets ?? (run?.candidate ? lineOf(lines, run.candidate)?.targets : null) ?? null;
  return { limit: t?.max_drawdown ?? null, annual: t?.annual_return ?? null };
}

export function useShown(): Shown {
  const detail = useWidget<DetailWidget>("candidate-detail@1");
  const version = useSelection();
  const listing = useAtom(paperRuns);
  const live = useLiveTrading().view.runs;
  const choice = choiceOf(useAtom(choices), version);
  return useMemo(() => {
    const runs = listing?.runs ?? [];
    const trials = (version && detail?.items.find((c) => c.id === version)?.trials) || [];
    const trial = backtestTrial(trials, choice.trial ?? null), run = shownRun(runs, version, choice.run ?? null);
    const liveRun = shownLiveRun(live, version, choice.liveRun);
    if (choice.stage === "live") return { version, stage: "live" as const, trial, run: null, liveRun, chain: [], name: liveRun ? `Live · ${liveRun.id}` : "Live" };
    const stage = version === null ? (run ? "paper" : null) : stageOf(choice.stage ?? null, { backtest: trial !== null, paper: run !== null });
    return { version, stage, trial, run, liveRun, chain: run ? chainOf(run, runs) : [], name: stage && stageName(stage, trial, run, runs) };
  }, [detail, version, listing, live, choice.run, choice.liveRun, choice.stage, choice.trial]);
}
