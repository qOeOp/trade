import { runsDot } from "../model/phoneRuns";
import { useLiveTrading } from "../state/liveTrading";
import { usePaperRuns, usePaperService } from "../state/paper";
import { useOverviewService } from "../state/market";
import { toggleToolWindow, useShell, type Side } from "../state/shell";
import { IconButton } from "../components/IconButton";
import { StripeButton } from "../components/StripeButton";
import type { IconName } from "../icons/registry";
import type { DataRole } from "../theme/roles";
import type { Action } from "./commands";
import type { ToolWindow } from "./toolWindows";

/** A side stripe on the frame: the left one lists Market first while the page's server has market data
 *  (the Market page in the editor, the left tool window closed), the left tool windows, then Runs (the
 *  Runs page likewise; one of these at a time) and Line-close history (the History page likewise), Runs with the dot
 *  the phone's Runs tab shows (model/phoneRuns.ts runsDot), and the bottom ones at
 *  the foot, as IntelliJ places them; the right one lists the right tool windows. Each stripe ends in the
 *  toggle for the side it serves: the left one in the window's lower-left corner for the bottom side,
 *  the right one in the lower-right for the right side. The pages and side toggles run the palette's
 *  commands (commands.ts), with their shortcuts. */
export function Stripe({ side, windows, actions }: { side: "left" | "right"; windows: readonly ToolWindow[]; actions: readonly Action[] }) {
  const { open, last } = useShell();
  const dot = runsDot(useLiveTrading().view.runs, usePaperRuns(), usePaperService());
  const overview = useOverviewService();
  const command = (id: string) => actions.find((a) => a.id === id);
  const button = (w: ToolWindow) => (
    <StripeButton key={w.id} icon={w.icon} label={w.renderer.title} keys={w.shortcut?.keys}
                  active={open[w.side] === w.id} onClick={() => toggleToolWindow(w.id, w.side)} />
  );
  const page = (id: "market" | "runs" | "history", icon: IconName, label: string, mark?: DataRole) => {
    const a = side === "left" && command(id);
    return a && <StripeButton icon={icon} label={label} keys={a.keys} active={last.left === id} dot={mark} onClick={a.run} />;
  };
  const at = (s: Side) => windows.filter((w) => w.side === s).map(button);
  const toggles: Side = side === "left" ? "bottom" : "right", sideToggle = command(`side:${toggles}`);
  const toggle = windows.some((w) => w.side === toggles) && sideToggle && (side === "left"
    ? <IconButton frame icon="panel-bottom" label="Bottom tool windows" keys={sideToggle.keys} onClick={sideToggle.run} />
    : <IconButton frame icon="panel-right" label="Right tool windows" keys={sideToggle.keys} onClick={sideToggle.run} />);
  return (
    <nav aria-label={side === "left" ? "Left tool windows" : "Right tool windows"} className={`flex w-(--stripe-w) shrink-0 flex-col items-center gap-1 py-(--stripe-pad) ${side === "left" ? "pl-(--frame-inset) pr-(--frame-near)" : "pl-(--frame-near) pr-(--frame-inset)"}`}>
      {page("market", "tool.market", "Market", overview === "offline" ? "fail" : undefined)}
      {at(side)}
      {page("runs", "tool.runs", "Runs", dot)}
      {page("history", "tool.history", "Line-close history")}
      <div className="mt-auto flex flex-col items-center gap-1">{side === "left" && at("bottom")}{toggle}</div>
    </nav>
  );
}
