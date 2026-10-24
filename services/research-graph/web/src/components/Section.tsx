import { useState, type ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { Icon } from "../icons/Icon";

/** A card in an inspector, as IntelliJ's notification cards: a rounded tint on the island, a bold
 *  title with an optional count and a chevron at the right, its content below. Collapsible. */
export function Section({ title, aside, children, open: initial = true }: {
  title: string; aside?: ReactNode; children: ReactNode; open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-popup bg-island-alt">
      <Collapsible.Trigger className="flex w-full items-center gap-2 rounded-popup px-3 py-2 text-left transition-colors hover:bg-row-hover">
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

/** A group of cards under a muted heading; groups after the first are set off by a rule. */
export function CardGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-line pt-3 not-first:border-t">
      <h3 className="px-1 text-fg-faint">{title}</h3>
      {children}
    </section>
  );
}
