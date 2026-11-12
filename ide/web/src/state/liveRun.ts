/** Live's Runs data owner. Views receive observations/actions; mounting only reads the chosen run. */
import { useEffect } from "react";
import type { LiveRun, LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import type { LineageWidget, Targets } from "../model/types";
import { useView, useWidget } from "../model/view";
import { lineOf } from "../lib/lines";
import { useResearchLines } from "./researchLines";
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
  // The launch page is drawn even where Live cannot take a run, greyed, saying why.
  const first = !run || draft?.version === version;
  const paper = usePaperRuns()?.runs ?? [], choice = choiceOf(useAtom(choices), version);
  useEffect(() => { if (run && actions.inspect) void actions.inspect(run.id); }, [run?.id, actions.inspect]);
  const paperAvailable = paper.some((item) => version ? item.candidate === version : item.paper_id === choice.run);
  return { run, version, view, actions, first, backtestAvailable: trial !== null, paperAvailable };
}

/** A Live candidate's research reading and the targets of its line, as the drawn research graph has them (null where
 *  it does not draw the candidate), for the launch page's target rows. */
export function useLaunchReading(candidate: string | null): { reading: { annual_return: number | null; max_drawdown: number | null } | null; targets: Targets | null } {
  const view = useView(), lineage = useWidget<LineageWidget>("lineage"), { lines } = useResearchLines();
  const reading = candidate ? lineage?.nodes.find((node) => node.id === candidate)?.reading ?? null : null;
  const targets = (candidate ? lineOf(lines, candidate)?.targets : null) ?? (reading ? lineage?.targets ?? view.targets : null) ?? null;
  return { reading, targets };
}
