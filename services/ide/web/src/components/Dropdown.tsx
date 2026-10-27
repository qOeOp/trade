import { useState, type ReactNode } from "react";
import { DropdownMenu, Popover } from "radix-ui";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";

// IntelliJ's toolbar widgets: a borderless trigger (content and a chevron) that opens a popup menu.

// A toolbar widget (content and a chevron), the same at an island's 24px control size (`compact`), a
// frame icon (a square the size of the frame's controls), or inline (a breadcrumb step, no chevron).
const TRIGGER = {
  widget: "h-(--frame-control) px-2",
  compact: "h-6 px-1.5",
  icon: "size-(--frame-control) justify-center",
  inline: "px-1",
} as const;

export function Dropdown({ trigger, label, children, align = "start", variant = "widget" }: {
  trigger: ReactNode; label: string; children: ReactNode; align?: "start" | "end"; variant?: keyof typeof TRIGGER;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label={label}
        className={`inline-flex min-w-0 shrink items-center gap-1.5 rounded-control transition-colors hover:bg-hover active:bg-pressed data-[state=open]:bg-pressed ${TRIGGER[variant]}`}>
        {trigger}{(variant === "widget" || variant === "compact") && <span className="shrink-0 text-icon"><Icon name="chevron-down" size={variant === "compact" ? 12 : 16} /></span>}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={4} collisionPadding={8}
          className="z-50 max-h-[70vh] min-w-56 overflow-auto rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A toolbar widget whose popup is a panel of its own (a list to search and pick from) rather than a menu;
 *  `children` gets a function that closes it. */
export function PopoverWidget({ trigger, label, children, align = "start" }: {
  trigger: ReactNode; label: string; children: (close: () => void) => ReactNode; align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={label}
        className={`inline-flex min-w-0 shrink items-center gap-1.5 rounded-control transition-colors hover:bg-hover active:bg-pressed data-[state=open]:bg-pressed ${TRIGGER.widget}`}>
        {trigger}<span className="shrink-0 text-icon"><Icon name="chevron-down" size={16} /></span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={4} collisionPadding={8}
          className="z-50 flex max-h-[min(440px,var(--radix-popover-content-available-height))] w-max min-w-56 max-w-[min(480px,var(--radix-popover-content-available-width))] flex-col gap-px overflow-auto rounded-popup border border-popup-border bg-popup p-1 shadow-popup outline-none">
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DropdownItem({ icon, children, hint, onSelect }: { icon?: IconName; children: ReactNode; hint?: ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item onSelect={onSelect}
      className="flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection">
      <span className="grid w-4 shrink-0 place-items-center text-icon">{icon && <Icon name={icon} />}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {hint != null && <span className="shrink-0 text-fg-faint">{hint}</span>}
    </DropdownMenu.Item>
  );
}

export function DropdownRadio<T extends string>({ value, options, onChange }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {options.map((o) => (
        <DropdownMenu.RadioItem key={o.value} value={o.value}
          className="flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection">
          <span className="grid w-4 shrink-0 place-items-center text-icon">
            <DropdownMenu.ItemIndicator><Icon name="check" /></DropdownMenu.ItemIndicator>
          </span>
          {o.label}
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

export const DropdownLabel = ({ children }: { children: ReactNode }) => <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-small text-fg-faint">{children}</DropdownMenu.Label>;
export const DropdownSeparator = () => <DropdownMenu.Separator className="my-1 h-px bg-line-strong" />;

/** Facts in a menu, as label/value rows that are not actions. */
export function DropdownFacts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-2 py-1.5">
      {items.map(([k, v]) => <div key={k} className="contents"><dt className="text-fg-faint">{k}</dt><dd className="min-w-0 break-all font-mono">{v}</dd></div>)}
    </dl>
  );
}
