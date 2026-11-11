// The selected version's stage and paper run as the Runs page, Details, the Trades window, the toolbar
// and the status bar read them: worked out from the view, the runs listed and what was picked
// (state/stage.ts), so each reads the same answer.
import { useMemo } from "react";
import { resolveRunSelection, type Shown } from "../model/runSelection";
import { lineOf } from "../lib/lines";
import type { DetailWidget, LineageWidget } from "../model/types";
import { useView, useWidget } from "../model/view";
import { useAtom } from "./atom";
import { paperRuns } from "./paper";
import { useLiveTrading } from "./liveTrading";
import { useResearchLines } from "./researchLines";
import { useSelection } from "./selection";
import { choiceOf, choices } from "./stage";

/** The targets the shown stage answers to: its line's, or with no line drawn (a phone's Runs tab) those of the
 *  line its run's version is on. */
export function useTargets(): { limit: number | null; annual: number | null } {
  const view = useView(), lineage = useWidget<LineageWidget>("lineage"), { lines } = useResearchLines(), { run } = useShown();
  const t = view.targets ?? lineage?.targets ?? (run?.candidate ? lineOf(lines, run.candidate)?.targets : null) ?? null;
  return { limit: t?.max_drawdown ?? null, annual: t?.annual_return ?? null };
}

export function useShown(): Shown {
  const detail = useWidget<DetailWidget>("candidate-detail");
  const version = useSelection();
  const listing = useAtom(paperRuns);
  const live = useLiveTrading().view.runs;
  const choice = choiceOf(useAtom(choices), version);
  return useMemo(() => {
    const runs = listing?.runs ?? [];
    const trials = (version && detail?.items.find((c) => c.id === version)?.trials) || [];
    return resolveRunSelection({ version, runs, trials, live, choice });
  }, [detail, version, listing, live, choice.run, choice.liveRun, choice.stage, choice.trial]);
}
