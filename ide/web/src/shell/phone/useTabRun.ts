import { useEffect } from "react";
import { useAtom } from "../../state/atom";
import { usePaperRuns } from "../../state/paper";
import { selection, useSelection } from "../../state/selection";
import { choiceOf, choices, showRun } from "../../state/stage";
import { runOrder } from "../../widgets/paper/RunPicker";

/** Default the phone to its own Paper run only while no explicit version stage is selected.
 *  Switching stages keeps that version's choices, including its exact Live run. */
export function useTabRun(): void {
  const runs = usePaperRuns()?.runs ?? null, allChoices = useAtom(choices), selected = useSelection();
  const picked = choiceOf(allChoices, null).run ?? null, scoped = choiceOf(allChoices, selected);
  const preserve = scoped.stage === "live" || (selected !== null && scoped.stage !== undefined);
  useEffect(() => {
    if (preserve || !runs?.length) return;
    const run = runs.find((r) => r.paper_id === picked) ?? runOrder(runs, Date.now())[0];
    if (run && (run.paper_id !== picked || selection.get() !== null)) showRun(run);
  }, [runs, picked, selected, preserve]);
}
