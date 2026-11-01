import { Tip } from "../../components/Tip";
import { TextButton } from "../../components/TextButton";
import { NO_LIVE } from "../../model/stage";
import { useShown } from "../../state/shown";
import { chooseStage } from "../../state/stage";

export const LIVE = 36;  // px: the value axis's top left to the note, its ticks below it

/** Live trading on a Runs page chart, before it is authorized: two ghost lines at the top of the value
 *  axis's column (at least `width` px wide, the axis's; its ticks start below them), still while the chart pans, in the
 *  text colour while the live stage is shown. A click shows the live stage: the legend's words, the
 *  status bar and the Trades window change, the view does not. */
export function LiveNote({ width }: { width: number }) {
  const { stage, version } = useShown();
  if (!width || version === null) return null;
  return (
    <Tip content={NO_LIVE} side="left">
      <TextButton onClick={() => chooseStage("live")} style={{ minWidth: width }}
                  className={`absolute right-0 top-0 z-10 flex-col items-start gap-0 whitespace-nowrap rounded-none px-1.5 py-0.5 text-left text-small leading-4 ${stage === "live" ? "text-fg" : "text-fg-ghost"}`}>
        <span>Live · not</span><span>authorized</span>
      </TextButton>
    </Tip>
  );
}
