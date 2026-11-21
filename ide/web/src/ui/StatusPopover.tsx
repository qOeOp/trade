import type { ReactNode } from "react";
import { Popover } from "radix-ui";

/** A status bar item whose click opens its detail above it, reading the detail again each time it opens. */
export function StatusPopover({ label, onOpen, className, trigger, children }: {
  label: string; onOpen: () => void; className: string; trigger: ReactNode; children: ReactNode;
}) {
  return (
    <Popover.Root onOpenChange={(open) => { if (open) onOpen(); }}>
      <Popover.Trigger aria-label={label}
        className={`-mx-1.5 rounded-control px-1.5 transition-colors hover:bg-hover active:bg-pressed data-[state=open]:bg-pressed ${className}`}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={4} collisionPadding={8}
          className="z-50 max-h-[min(440px,var(--radix-popover-content-available-height))] w-max max-w-[min(720px,var(--radix-popover-content-available-width))] overflow-auto rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup outline-none">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A table in a status popover: its last row has no rule above the popover's own edge. */
export const StatusTable = ({ children }: { children: ReactNode }) => <div className="[&_tbody_tr:last-child_td]:border-b-0">{children}</div>;
