import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { TipArrow } from "../icons/marks";

/** Every tooltip's box, Radix's here and the charts' own (ChartTip): Element Plus's tooltip. */
export const TIP_BOX = "rounded-control border border-tooltip-border bg-tooltip px-3 py-1.5 text-dense leading-5 text-tooltip-fg drop-shadow-tooltip";

/** A tooltip on any element: 500ms before the first, instant for its neighbours (Provider in App). The box is
 *  positioned so the arrow sits on its padding edge, over its border. */
export function Tip({ content, children, side = "top" }: {
  content: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right";
}) {
  if (content == null || content === "") return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={10} collisionPadding={8} arrowPadding={8}
                         className={`enter relative z-50 max-w-md ${TIP_BOX}`}>
          {content}
          <Tooltip.Arrow asChild><TipArrow /></Tooltip.Arrow>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
