import { useState, type ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { Icon } from "../icons/Icon";

/** A card in an inspector, as IntelliJ's notification cards: a rounded tint on the island, a bold
 *  title with an optional count and a chevron at the right, its content below. Collapsible: open unless
 *  `open` is false, which it follows until the user opens or closes the card. */
export function Section({ title, aside, children, open: initial = true }: { title: string; aside?: ReactNode; children: ReactNode; open?: boolean }) {
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? initial;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-card border border-card-border bg-island-alt">
      <Collapsible.Trigger className="flex w-full items-center gap-2 rounded-card px-3 py-2 text-left transition-colors hover:bg-row-hover active:bg-hover">
        <span className="font-semibold text-fg">{title}</span>
        {aside != null && <span className="ml-auto text-fg-faint">{aside}</span>}
        <span className={`grid text-icon transition-transform ${aside == null ? "ml-auto" : ""} ${open ? "rotate-90" : ""}`}>
          <Icon name="chevron-right" />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="px-3 pb-3">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/** A group of cards under a muted heading; groups after the first are set off by space, not a rule (the
 *  heading already names the group). `className` positions it in a layout that sets groups side by side. */
export function CardGroup({ title, actions, children, className = "" }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-2 pt-3 not-first:pt-6 ${className}`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-h2 font-semibold text-fg">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
