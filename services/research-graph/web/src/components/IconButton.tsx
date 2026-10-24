import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { Kbd } from "./Kbd";
import { Tip } from "./Tip";

type Props = { icon: IconName; label: string; keys?: string; active?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

/** A 24px icon action in IntelliJ's manner: no border, a hover and a pressed fill, its label as a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ icon, label, keys, active, className = "", ...rest }, ref) {
  return (
    <Tip side="bottom" content={<span className="inline-flex items-center gap-2">{label}{keys && <Kbd>{keys}</Kbd>}</span>}>
      <button ref={ref} type="button" aria-label={label} aria-pressed={active}
              className={`grid size-6 shrink-0 place-items-center rounded-control transition-colors hover:bg-hover active:bg-pressed ${active ? "bg-pressed text-fg" : "text-icon"} ${className}`}
              {...rest}>
        <Icon name={icon} />
      </button>
    </Tip>
  );
});
