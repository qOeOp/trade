import { useState, type ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { Icon } from "../icons/Icon";

/** A collapsible part of an inspector: its title on the content's left edge, the chevron at the right. */
export function Section({ title, aside, children, open: initial = true }: {
  title: string; aside?: ReactNode; children: ReactNode; open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b border-line">
      <Collapsible.Trigger className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-row-hover">
        <span className="text-small font-semibold text-fg-muted">{title}</span>
        {aside != null && <span className="ml-auto text-small text-fg-faint">{aside}</span>}
        <span className={`grid text-icon transition-transform ${aside == null ? "ml-auto" : ""} ${open ? "rotate-90" : ""}`}>
          <Icon name="chevron-right" />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="px-3 pb-2.5 pt-0.5">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
