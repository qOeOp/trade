import { showLineage } from "../state/editors";
import { usePaperRuns, usePaperService } from "../state/paper";
import { useOverviewService } from "../state/market";
import { showMarketPage, showRunsPage, toggleToolWindow, useShell, type Side } from "../state/shell";
import { StripeButton } from "../components/StripeButton";
import type { ToolWindow } from "./toolWindows";

/** A side stripe on the frame: the left one lists Market first while the page's server has market data
 *  (the Market page in the editor, the left tool window closed), the left tool windows, then Runs (the
 *  Runs page likewise; one of these at a time), with a green dot
 *  while a paper run runs and a red one while the paper daemon does not answer, and the bottom ones at
 *  the foot, as IntelliJ places them; the right one lists the right tool windows. */
export function Stripe({ side, windows }: { side: "left" | "right"; windows: readonly ToolWindow[] }) {
  const { open, last } = useShell();
  const offline = usePaperService() === "offline";
  const running = (usePaperRuns()?.running ?? 0) > 0;
  const overview = useOverviewService();
  const button = (w: ToolWindow) => (
    <StripeButton key={w.id} icon={w.icon} label={w.renderer.title} keys={w.shortcut?.keys}
                  active={open[w.side] === w.id} onClick={() => toggleToolWindow(w.id, w.side)} />
  );
  const at = (s: Side) => windows.filter((w) => w.side === s).map(button);
  return (
    <nav aria-label={side === "left" ? "Left tool windows" : "Right tool windows"} className="flex w-(--stripe-w) shrink-0 flex-col items-center gap-1 py-(--stripe-pad)">
      {side === "left" && (overview === "present" || overview === "offline") && (
        <StripeButton icon="tool.market" label="Market" active={last.left === "market"} dot={overview === "offline" ? "fail" : undefined}
                      onClick={() => (last.left === "market" ? showLineage() : showMarketPage())} />
      )}
      {at(side)}
      {side === "left" && (
        <StripeButton icon="tool.runs" label="Runs" keys="⌥8" active={last.left === "runs"} dot={offline ? "fail" : running ? "meets" : undefined}
                      onClick={() => (last.left === "runs" ? showLineage() : showRunsPage())} />
      )}
      {side === "left" && <div className="mt-auto flex flex-col items-center gap-1">{at("bottom")}</div>}
    </nav>
  );
}
