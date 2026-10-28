import { useState, type ReactNode, type Ref } from "react";
import { Collapsible } from "radix-ui";
import { Icon } from "../icons/Icon";

const FRAME = "rounded-card border border-card-border bg-island-alt";

/** A card in an inspector, as IntelliJ's notification cards: a rounded tint on the island, a bold
 *  title with an optional count and a chevron at the right, its content below. Collapsible: open at
 *  first unless `open` is false, or as `control` says when its owner keeps the state. */
export function Section({ title, aside, children, open: initial = true, control, ref }: {
  title: string; aside?: ReactNode; children: ReactNode; open?: boolean; control?: [boolean, (open: boolean) => void]; ref?: Ref<HTMLDivElement>;
}) {
  const own = useState(initial), [open, setOpen] = control ?? own;
  return (
    <Collapsible.Root ref={ref} open={open} onOpenChange={setOpen} className={FRAME}>
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

/** A card as Section draws it that always stays open, its title no control. */
export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={FRAME}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="font-semibold text-fg">{title}</span>
        {aside != null && <span className="ml-auto text-fg-faint">{aside}</span>}
      </div>
      <div className="px-3 pb-3">{children}</div>
    </section>
  );
}

/** A group of cards under a muted heading; groups after the first are set off by space, not a rule (the
 *  heading already names the group). `className` positions it in a layout that sets groups side by side. */
export function CardGroup({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-2 pt-3 not-first:pt-6 ${className}`}>
      <h3 className="px-1 text-h2 font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}
