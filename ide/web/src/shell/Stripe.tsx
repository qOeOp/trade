import { showLineage } from "../state/editors";
import { usePaperRuns, usePaperService } from "../state/paper";
import { useOverviewService } from "../state/market";
import { showMarketPage, showRunsPage, toggleSide, toggleToolWindow, useShell, type Side } from "../state/shell";
import { IconButton } from "../components/IconButton";
import { StripeButton } from "../components/StripeButton";
import type { ToolWindow } from "./toolWindows";

/** A side stripe on the frame: the left one lists Market first while the page's server has market data
 *  (the Market page in the editor, the left tool window closed), the left tool windows, then Runs (the
 *  Runs page likewise; one of these at a time), with a green dot
 *  while a paper run runs and a red one while the paper daemon does not answer, and the bottom ones at
 *  the foot, as IntelliJ places them; the right one lists the right tool windows. Each stripe ends in the
 *  toggle for the side it serves: the left one in the window's lower-left corner for the bottom side,
 *  the right one in the lower-right for the right side. */
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
  const toggles: Side = side === "left" ? "bottom" : "right";
  const toggle = windows.some((w) => w.side === toggles) && (side === "left"
    ? <IconButton frame icon="panel-bottom" label="Bottom tool windows" keys="⌘J" onClick={() => toggleSide("bottom")} />
    : <IconButton frame icon="panel-right" label="Right tool windows" keys="⌘B" onClick={() => toggleSide("right")} />);
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
      <div className="mt-auto flex flex-col items-center gap-1">{side === "left" && at("bottom")}{toggle}</div>
    </nav>
  );
}
