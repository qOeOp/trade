import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import type { ColorRole } from "../theme/roles";
import { Kbd } from "./Kbd";
import { Tip } from "./Tip";

type Props = { icon: IconName; label: string; keys?: string; active?: boolean; frame?: boolean; glyph?: 16 | 20; primary?: boolean; tone?: ColorRole; spinning?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

const LOOK = {
  plain: "hover:bg-hover active:bg-pressed disabled:text-fg-ghost disabled:hover:bg-transparent disabled:active:bg-transparent " +
         "aria-disabled:cursor-default aria-disabled:text-fg-ghost aria-disabled:hover:bg-transparent aria-disabled:active:bg-transparent",
  primary: "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-pressed disabled:bg-primary-disabled disabled:text-primary-disabled-fg",
} as const;

/** An icon action in IntelliJ's manner: no border, a hover and a pressed fill, its label as a tooltip;
 *  24px with a 16px icon in an island header, or on the frame (`frame`) the frame's control size.
 *  `glyph` sets the icon's size apart from the frame's, for an outline icon beside a filled one;
 *  `primary` fills it blue, as a form's default button (a message box's Send); `tone` colours the icon,
 *  as IntelliJ's run and stop buttons, while it is enabled. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ icon, label, keys, active, frame = false, glyph, primary = false, tone, spinning = false, className = "", ...rest }, ref) {
  return (
    <Tip side="bottom" content={<span className="inline-flex items-center gap-2">{label}{keys && <Kbd>{keys}</Kbd>}</span>}>
      <button ref={ref} type="button" aria-label={label} aria-pressed={active}
              className={`grid shrink-0 place-items-center ${frame ? "size-(--frame-control)" : "size-6"} rounded-control transition-colors disabled:cursor-default ${LOOK[primary ? "primary" : "plain"]} ${primary ? "" : active ? "bg-pressed text-fg" : "text-icon"} ${className}`}
              {...rest}>
        <Icon name={icon} size={glyph ?? (frame ? 20 : 16)} tone={rest.disabled || rest["aria-disabled"] ? undefined : tone}
          className={spinning ? "text-icon motion-safe:animate-spin" : ""} />
      </button>
    </Tip>
  );
});
