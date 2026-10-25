import { showLineage } from "../state/editors";
import { usePaperRuns, usePaperService } from "../state/paper";
import { showPaperPanel, toggleToolWindow, useShell, type Side } from "../state/shell";
import { StripeButton } from "../components/StripeButton";
import type { ToolWindow } from "./toolWindows";

/** A side stripe on the frame: the left one lists the left tool windows at the top (and Paper, which
 *  turns the editor into the Paper panel, with a green dot while a run runs) and the bottom ones at the
 *  foot, as IntelliJ places them; the right one lists the right tool windows. */
export function Stripe({ side, windows }: { side: "left" | "right"; windows: readonly ToolWindow[] }) {
  const { open, last } = useShell();
  const paper = usePaperService() === "present";
  const running = (usePaperRuns()?.running ?? 0) > 0;
  const button = (w: ToolWindow) => (
    <StripeButton key={w.id} icon={w.icon} label={w.renderer.title} keys={w.shortcut?.keys}
                  active={open[w.side] === w.id} onClick={() => toggleToolWindow(w.id, w.side)} />
  );
  const at = (s: Side) => windows.filter((w) => w.side === s).map(button);
  return (
    <nav aria-label={side === "left" ? "Left tool windows" : "Right tool windows"} className="flex w-(--stripe-w) shrink-0 flex-col items-center gap-1 py-(--stripe-pad)">
      {at(side)}
      {side === "left" && paper && (
        <StripeButton icon="tool.paper" label="Paper" keys="⌥8" active={last.left === "paper"} dot={running ? "meets" : undefined}
                      onClick={() => (last.left === "paper" ? showLineage() : showPaperPanel())} />
      )}
      {side === "left" && <div className="mt-auto flex flex-col items-center gap-1">{at("bottom")}</div>}
    </nav>
  );
}
