import { Segmented } from "../../components/Segmented";
import type { PaperRun } from "../../lib/paperApi";
import { lineOf } from "../../lib/lines";
import { useResearchLines } from "../../state/researchLines";
import { useShown } from "../../state/shown";
import { chooseStage, openBacktest } from "../../state/stage";

/** One stage selector for Runs, including when Live has no chart series. */
export function RunStages({ backtest, paper, loose = null }: { backtest: boolean; paper: boolean; loose?: PaperRun | null }) {
  const { stage } = useShown(), { lines } = useResearchLines();
  const away = loose?.candidate ? lineOf(lines, loose.candidate) : null;
  return <Segmented label="Stage" value={stage ?? "paper"} onChange={(next) => {
    if (next === "backtest" && !backtest && away && loose) openBacktest(away.bundle, loose.candidate!, loose.paper_id);
    else chooseStage(next);
  }} items={[
    { id: "backtest", label: "Backtest", disabled: !backtest && !away, hint: "No backtest" },
    { id: "paper", label: "Paper", disabled: !paper, hint: "No paper run" },
    { id: "live", label: "Live" },
  ]} />;
}
