import type { HTMLAttributes, ReactNode } from "react";

import styles from "./fact-group.module.css";

export function FactGroup({
  title,
  children,
  className,
  ...props
}: {
  title: ReactNode;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section {...props} className={[styles.group, className].filter(Boolean).join(" ")}>
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

export function FactItem({
  label,
  children,
  mono = false,
  title,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  title?: string;
}) {
  const resolvedTitle = title ?? (
    typeof children === "string" || typeof children === "number" ? String(children) : undefined
  );

  return (
    <div className={styles.item}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined} title={resolvedTitle}>
        {children}
      </dd>
    </div>
  );
}

export function FactGroupSkeleton({ title, lines = 3 }: { title: ReactNode; lines?: number }) {
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      <div className={styles.skeleton} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <i key={index} />
        ))}
      </div>
    </section>
  );
}
