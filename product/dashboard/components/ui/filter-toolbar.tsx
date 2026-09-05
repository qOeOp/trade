"use client";

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ChangeEventHandler,
  ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { InterfaceIcons, type DashboardIcon } from "./iconography";

export type TableFilterSection = {
  id: string;
  label: string;
  selected: string;
  items: readonly { value: string; label: ReactNode; icon?: DashboardIcon }[];
  onSelect: (value: string) => void;
};

export function TableFilterMenu({
  label,
  sections,
}: {
  label: string;
  sections: readonly TableFilterSection[];
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="table-filter-menu" role="group" aria-label={label}>
      {sections.map((section) => (
        <motion.label key={section.id} className="table-filter-select"
          whileTap={reduceMotion ? undefined : { scale: 0.985 }} transition={{ duration: 0.12 }}>
          <span className="sr-only">{section.label}</span>
          <select aria-label={section.label} value={section.selected}
            onChange={(event) => section.onSelect(event.target.value)}>
            {section.items.map((item) => (
              <option key={item.value} value={item.value}>
                {typeof item.label === "string" || typeof item.label === "number" ? item.label : item.value}
              </option>
            ))}
          </select>
          <InterfaceIcons.expand aria-hidden="true" size={13} />
        </motion.label>
      ))}
    </div>
  );
}

export function TableToolbar({
  filter,
  children,
}: {
  filter?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="filter-toolbar table-toolbar">
      <div className="filter-toolbar-group">{filter}</div>
      <div className="filter-toolbar-group" data-align="end">{children}</div>
    </div>
  );
}

export function FilterTabs({
  label,
  items,
  selected,
  onSelect,
  variant = "buttons",
}: {
  label: string;
  items: readonly { value: string; label: ReactNode; icon?: DashboardIcon }[];
  selected: string;
  onSelect: (value: string) => void;
  variant?: "buttons" | "rail";
}) {
  return (
    <div className="filter-tabs" data-variant={variant} aria-label={label}>
      {items.map((item) => {
        const Icon = item.icon;
        return <button type="button" key={item.value} aria-pressed={selected === item.value}
          onClick={() => onSelect(item.value)}>
          {Icon ? <Icon aria-hidden="true" size={14} /> : null}
          <span>{item.label}</span>
        </button>;
      })}
    </div>
  );
}

export function FilterSearch({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  maxLength?: number;
}) {
  return (
    <label className="filter-search">
      <InterfaceIcons.search aria-hidden="true" size={15} />
      <span className="sr-only">{label}</span>
      <input value={value} onChange={onChange} placeholder={placeholder} maxLength={maxLength} />
    </label>
  );
}

export function FilterButton({
  children,
  className,
  variant = "primary",
  ...props
}: { children: ReactNode; variant?: "primary" | "outline" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} data-variant={variant}
    className={["filter-action", className].filter(Boolean).join(" ")}>{children}</button>;
}

export function FilterLink({
  children,
  className,
  disabled = false,
  ...props
}: {
  children: ReactNode;
  disabled?: boolean;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} className={["filter-action", className].filter(Boolean).join(" ")}
    aria-disabled={disabled || undefined}>{children}</a>;
}

export function FilterToggle({
  children,
  checked,
  onChange,
}: {
  children: ReactNode;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return <label className="filter-toggle"><input type="checkbox" checked={checked} onChange={onChange} />{children}</label>;
}
