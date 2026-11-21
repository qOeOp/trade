import type { ReactNode } from "react";
import { HoverCard } from "radix-ui";

/** The element a hover panel opens from, wherever it sits inside `HoverPanel` (a menu may wrap it). */
export const HoverTrigger = ({ children }: { children: ReactNode }) => <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>;

/** A panel that opens to the right of its trigger while the pointer rests on it. */
export function HoverPanel({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <HoverCard.Root openDelay={250} closeDelay={120}>
      {children}
      <HoverCard.Portal>
        <HoverCard.Content side="right" align="start" sideOffset={12} collisionPadding={8} avoidCollisions={false}
          className="enter z-50 w-[min(20rem,var(--radix-hover-card-content-available-width))] max-h-(--radix-hover-card-content-available-height) overflow-auto rounded-popup border border-popup-border bg-popup p-3 shadow-popup outline-none">
          {panel}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
