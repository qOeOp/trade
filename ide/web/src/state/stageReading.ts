import { useBacktest } from "./backtest";
import { usePaperService } from "./paper";
import { useRunData } from "./runData";
import { useShown } from "./shown";

/** Whether the shown stage is still reading its trial report or paper stream: a paper run until its
 *  stream's first batch arrives (paperStream.ts `loaded`), whether or not it has readings yet. */
export function useStageReading(): boolean {
  const { stage, run } = useShown(), data = useRunData(), backtest = useBacktest(), service = usePaperService();
  if (stage === "backtest") return backtest?.kind === "reading";
  if (stage === "paper") return !!run && !(data && data.run.paper_id === run.paper_id && data.s?.loaded) && service !== "offline" && service !== "absent";
  return stage === null && service === "checking";
}
