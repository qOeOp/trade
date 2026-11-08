/** Live's Runs data owner. Views receive observations/actions; mounting only reads the chosen run. */
import { useEffect } from "react";
import type { LiveRun, LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import { useAtom } from "./atom";
import { useLiveTrading } from "./liveTrading";
import { useLiveDraft } from "./liveWorkspace";
import { usePaperRuns } from "./paper";
import { useShown } from "./shown";
import { choices, choiceOf } from "./stage";

export type LiveRunView = { run: LiveRun | null; actions: LiveTradingActions };
export type LiveCanvasView = LiveRunView & {
  version: string | null; view: LiveTradingView; first: boolean; backtestAvailable: boolean; paperAvailable: boolean;
};

export function useLiveRunView(): LiveRunView {
  const { liveRun: run } = useShown(), { actions } = useLiveTrading();
  return { run, actions };
}

export function useLiveCanvas(): LiveCanvasView {
  const { liveRun: run, version, trial } = useShown(), { view, actions } = useLiveTrading(), draft = useLiveDraft();
  const first = view.sources.length > 0 && (draft?.version === version || !run);
  const paper = usePaperRuns()?.runs ?? [], choice = choiceOf(useAtom(choices), version);
  useEffect(() => { if (run && actions.inspect) void actions.inspect(run.id); }, [run?.id, actions.inspect]);
  const paperAvailable = paper.some((item) => version ? item.candidate === version : item.paper_id === choice.run);
  return { run, version, view, actions, first, backtestAvailable: trial !== null, paperAvailable };
}
