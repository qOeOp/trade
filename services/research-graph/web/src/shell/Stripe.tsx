import { toggleToolWindow, useShell, type Side } from "../state/shell";
import { StripeButton } from "../components/StripeButton";
import type { ToolWindow } from "./toolWindows";

/** A side stripe on the frame: the left one lists the left tool windows at the top and the bottom
 *  ones at the foot, as IntelliJ places them; the right one lists the right tool windows. */
export function Stripe({ side, windows }: { side: "left" | "right"; windows: readonly ToolWindow[] }) {
  const { open } = useShell();
  const button = (w: ToolWindow) => (
    <StripeButton key={w.id} icon={w.icon} label={w.renderer.title} keys={w.shortcut?.keys}
                  active={open[w.side] === w.id} onClick={() => toggleToolWindow(w.id, w.side)} />
  );
  const at = (s: Side) => windows.filter((w) => w.side === s).map(button);
  return (
    <nav aria-label={side === "left" ? "Left tool windows" : "Right tool windows"} className="flex w-(--stripe-w) shrink-0 flex-col items-center gap-1 py-(--stripe-pad)">
      {at(side)}
      {side === "left" && <div className="mt-auto flex flex-col items-center gap-1">{at("bottom")}</div>}
    </nav>
  );
}
