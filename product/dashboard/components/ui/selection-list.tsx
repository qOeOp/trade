import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import styles from "./selection-list.module.css";

export type SelectionListProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  children: ReactNode;
  count: ReactNode;
  label: ReactNode;
};

export function SelectionList({
  children,
  className,
  count,
  label,
  ...props
}: SelectionListProps) {
  return (
    <section
      {...props}
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-ui="selection-list"
    >
      <header className={styles.header}>
        <span>{label}</span>
        <span>{count}</span>
      </header>
      {children}
    </section>
  );
}

export type SelectionListItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  detail: ReactNode;
  meta: ReactNode;
  primary: ReactNode;
  primaryTitle?: string;
  selected?: boolean;
};

export function SelectionListItem({
  className,
  detail,
  meta,
  primary,
  primaryTitle,
  selected = false,
  type = "button",
  ...props
}: SelectionListItemProps) {
  return (
    <button
      {...props}
      className={[styles.item, className].filter(Boolean).join(" ")}
      data-selected={selected || undefined}
      type={type}
    >
      <b className={styles.primary} title={primaryTitle}>{primary}</b>
      <span className={styles.meta}>{meta}</span>
      <small className={styles.detail}>{detail}</small>
    </button>
  );
}
