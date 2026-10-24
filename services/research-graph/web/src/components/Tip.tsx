import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "radix-ui";

/** A tooltip on any element: 500ms before the first, instant for its neighbours (Provider in App). */
export function Tip({ content, children, side = "top" }: {
  content: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right";
}) {
  if (content == null || content === "") return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} collisionPadding={8}
                         className="enter z-50 max-w-md rounded-popup border border-popup-border bg-tooltip px-2 py-1.5 text-dense text-fg shadow-lg">
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
