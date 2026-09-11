"use client";

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ChangeEventHandler,
  ReactNode,
} from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { InterfaceIcons, type DashboardIcon } from "./iconography";

export type TableFilterSection = {
  id: string;
  label: string;
  selected: string;
  items: readonly { value: string; label: ReactNode; icon?: DashboardIcon }[];
  onSelect: (value: string) => void;
};

export type FilterControlDensity = "default" | "compact";
export type FilterActionVariant = "primary" | "secondary" | "ghost" | "warning" | "danger" | "outline";

export function TableFilterMenu({
  label,
  sections,
  density = "default",
}: {
  label: string;
  sections: readonly TableFilterSection[];
  density?: FilterControlDensity;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="table-filter-menu" data-density={density} role="group" aria-label={label}>
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
  density = "default",
}: {
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  maxLength?: number;
  density?: FilterControlDensity;
}) {
  return (
    <label className="filter-search" data-density={density}>
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
  density = "default",
  ...props
}: {
  children: ReactNode;
  variant?: FilterActionVariant;
  density?: FilterControlDensity;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} data-variant={variant} data-density={density}
    className={["filter-action", className].filter(Boolean).join(" ")}>{children}</button>;
}

export function FilterLink({
  children,
  className,
  disabled = false,
  href,
  variant = "primary",
  density = "default",
  ...props
}: {
  children: ReactNode;
  disabled?: boolean;
  variant?: FilterActionVariant;
  density?: FilterControlDensity;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const sharedProps = {
    ...props,
    "data-variant": variant,
    "data-density": density,
    className: ["filter-action", className].filter(Boolean).join(" "),
    "aria-disabled": disabled || undefined,
  };
  const usesClientNavigation = typeof href === "string"
    && href.startsWith("/")
    && !href.startsWith("//")
    && !props.download
    && props.target !== "_blank";
  return usesClientNavigation
    ? <Link {...sharedProps} href={href}>{children}</Link>
    : <a {...sharedProps} href={href}>{children}</a>;
}

export function FilterToggle({
  children,
  checked,
  onChange,
  density = "default",
}: {
  children: ReactNode;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  density?: FilterControlDensity;
}) {
  return <label className="filter-toggle" data-density={density}>
    <input type="checkbox" checked={checked} onChange={onChange} />{children}
  </label>;
}
