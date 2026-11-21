import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";

/** One item of a right-click menu: its icon in a fixed slot, then its label. */
export function MenuItem({ icon, label, run, disabled }: { icon?: IconName; label: string; run: () => void; disabled?: boolean }) {
  return (
    <ContextMenu.Item onSelect={run} disabled={disabled}
                      className="flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection data-disabled:text-fg-faint">
      <span className="grid w-4 shrink-0 place-items-center text-icon">{icon && <Icon name={icon} />}</span>{label}
    </ContextMenu.Item>
  );
}

export const MenuSeparator = () => <ContextMenu.Separator className="my-1 h-px bg-line-strong" />;

/** A right-click menu on `children`, headed by what it acts on. */
export function Menu({ title, items, children }: { title: string; items: ReactNode; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-52 rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          <ContextMenu.Label className="truncate px-2 pb-1 pt-1.5 font-mono text-small text-fg-faint">{title}</ContextMenu.Label>
          {items}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
