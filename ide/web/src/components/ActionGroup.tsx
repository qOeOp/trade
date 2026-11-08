import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import type { ColorRole } from "../theme/roles";
import { Tip } from "./Tip";

/** The main toolbar's actions held as one group, as IntelliJ's run toolbar holds its run, stop and their
 *  neighbours: no frame, wider space around the group than inside it, a faint short rule between kinds. */
export function ActionGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div role="group" aria-label="Actions" className={`flex shrink-0 items-center gap-0.5 ${className}`}>{children}</div>;
}

export const ActionRule = () => <span aria-hidden className="mx-1.5 h-3.5 w-px shrink-0 bg-line" />;

/** An action in the group: its icon with what it does to its right, `tone` colouring the icon while it is
 *  enabled (the green ▶, the red ■), `spinning` turning it while the action runs; `hint` says more on hover.
 *  aria-disabled greys it while keeping its tooltip, for an action that waits on another. */
export function ActionButton({ icon, tone, spinning = false, hint, children, className = "", ...rest }: {
  icon: IconName; tone?: ColorRole; spinning?: boolean; hint?: ReactNode; children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const off = rest.disabled || rest["aria-disabled"] === true;
  const button = (
    <button type="button" className={`inline-flex h-(--frame-control) shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2 text-dense transition-colors hover:bg-hover active:bg-pressed
      disabled:cursor-default disabled:text-fg-ghost disabled:hover:bg-transparent aria-disabled:cursor-default aria-disabled:text-fg-ghost aria-disabled:hover:bg-transparent ${className}`} {...rest}>
      <Icon name={icon} size={16} tone={off ? undefined : tone} className={spinning ? "motion-safe:animate-spin" : ""} />{children}
    </button>
  );
  return hint ? <Tip side="bottom" content={hint}>{button}</Tip> : button;
}
