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
          className="z-50 max-h-[70vh] min-w-56 max-w-(--radix-dropdown-menu-content-available-width) overflow-auto rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A toolbar widget whose popup is a panel of its own (a list to search and pick from) rather than a menu;
 *  `children` gets a function that closes it. */
export function PopoverWidget({ trigger, label, children }: {
  trigger: ReactNode; label: string; children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={label}
        className={`inline-flex min-w-0 shrink items-center gap-1.5 rounded-control transition-colors hover:bg-hover active:bg-pressed data-[state=open]:bg-pressed ${TRIGGER.widget}`}>
        {trigger}<span className="shrink-0 text-icon"><Icon name="chevron-down" size={16} /></span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} collisionPadding={8}
          className="z-50 flex max-h-[min(440px,var(--radix-popover-content-available-height))] w-max min-w-56 max-w-[min(480px,var(--radix-popover-content-available-width))] flex-col gap-px overflow-auto rounded-popup border border-popup-border bg-popup p-1 shadow-popup outline-none">
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** `onHighlight` follows the item's highlight, by pointer or keys alike (Radix focuses the highlighted item);
 *  `name` and `description` name it for assistive technology when its visible text is drawn (Typing.tsx Retype). */
export function DropdownItem({ icon, children, hint, onSelect, onHighlight, name, description }: {
  icon?: IconName; children: ReactNode; hint?: ReactNode; onSelect: () => void; onHighlight?: (on: boolean) => void;
  name?: string; description?: string;
}) {
  return (
    <DropdownMenu.Item onSelect={onSelect} aria-label={name} aria-description={description} onFocus={onHighlight && (() => onHighlight(true))} onBlur={onHighlight && (() => onHighlight(false))}
      className="flex cursor-default items-center gap-2 rounded-control min-h-6 px-2 py-0.5 outline-none data-highlighted:bg-selection">
      <span className="grid w-4 shrink-0 place-items-center text-icon">{icon && <Icon name={icon} />}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {hint != null && <span className="shrink-0 text-fg-faint">{hint}</span>}
    </DropdownMenu.Item>
  );
}

/** A navigation item stays a real link, including open-in-new-tab and keyboard navigation. */
export function DropdownLink({ href, children, hint, current = false }: {
  href: string; children: ReactNode; hint?: ReactNode; current?: boolean;
}) {
  return <DropdownMenu.Item asChild>
    <a href={href} aria-current={current ? "page" : undefined}
       className="flex items-center gap-2 rounded-control min-h-6 px-2 py-0.5 outline-none data-highlighted:bg-selection">
      <span className="grid w-4 shrink-0 place-items-center text-icon">{current && <Icon name="check" />}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {hint != null && <span className="shrink-0 text-fg-faint">{hint}</span>}
    </a>
  </DropdownMenu.Item>;
}

export function DropdownRadio<T extends string>({ value, options, onChange }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {options.map((o) => (
        <DropdownMenu.RadioItem key={o.value} value={o.value}
          className="flex cursor-default items-center gap-2 rounded-control min-h-6 px-2 py-0.5 outline-none data-highlighted:bg-selection">
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
      {items.map(([k, v]) => <div key={k} className="contents"><dt className="text-fg-faint">{k}</dt><dd className="min-w-0 wrap-anywhere font-mono">{v}</dd></div>)}
    </dl>
  );
}

// Menu rows that line up as columns: the grid (`cols`, a grid-template-columns class) sets the columns, its first
// one the check column; a label row and each link row span all of them as a subgrid, so every cell of a column
// starts at the same x whatever the other rows hold. A row's px-2 is absorbed by the grid's edge tracks, so the first
// track is the 8px padding plus the 16px check column.
const GRID_ROW = "col-span-full grid grid-cols-subgrid rounded-control px-2";
export const DropdownGrid = ({ cols, children }: { cols: string; children: ReactNode }) => <div className={`grid ${cols}`}>{children}</div>;
/** A row of column headers, not a menu item; its first cell sits over the check column. `sticky` keeps it in view
 *  while the menu scrolls, at the menu's edge over its 4px padding (`-top-1`), so no row shows above it. */
export const DropdownGridLabel = ({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) =>
  <DropdownMenu.Label className={`${GRID_ROW} items-start pb-1 pt-1.5 text-small text-fg-faint ${sticky ? "sticky -top-1 z-10 bg-popup" : ""}`}><span />{children}</DropdownMenu.Label>;
/** A navigation row of the grid, a real link like DropdownLink. */
export function DropdownGridLink({ href, current = false, children }: { href: string; current?: boolean; children: ReactNode }) {
  return <DropdownMenu.Item asChild>
    <a href={href} aria-current={current ? "page" : undefined}
       className={`${GRID_ROW} h-(--row-h) items-center outline-none data-highlighted:bg-selection`}>
      <span className="grid place-items-center text-icon">{current && <Icon name="check" />}</span>
      {children}
    </a>
  </DropdownMenu.Item>;
}
export const DropdownGridSeparator = () => <DropdownMenu.Separator className="col-span-full my-1 h-px bg-line-strong" />;
