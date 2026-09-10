import type { HTMLAttributes, ReactNode } from "react";

import styles from "./fact-group.module.css";

export function FactGroup({
  title,
  eyebrow,
  description,
  leading,
  trailing,
  headerDensity = "compact",
  children,
  className,
  ...props
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  headerDensity?: "compact" | "detailed";
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section
      {...props}
      className={[styles.group, className].filter(Boolean).join(" ")}
      data-header-density={headerDensity}
      data-ui="fact-group"
    >
      <header className={styles.header}>
        {leading ? <span className={styles.leading}>{leading}</span> : null}
        <div className={styles.headerCopy}>
          {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
          <h3>{title}</h3>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
      </header>
      <dl>{children}</dl>
    </section>
  );
}

export function FactGroupGrid({
  children,
  layout = "equal",
  className,
  ...props
}: {
  children: ReactNode;
  layout?: "equal" | "pair" | "weighted";
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={[styles.grid, className].filter(Boolean).join(" ")}
      data-layout={layout}
      data-ui="fact-group-grid"
    >
      {children}
    </div>
  );
}

export function FactItem({
  label,
  children,
  mono = false,
  align = "start",
  tone = "neutral",
  title,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  align?: "start" | "end";
  tone?: "neutral" | "unavailable";
  title?: string;
}) {
  const resolvedTitle = title ?? (
    typeof children === "string" || typeof children === "number" ? String(children) : undefined
  );

  return (
    <div className={styles.item} data-align={align} data-tone={tone}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined} title={resolvedTitle}>
        {children}
      </dd>
    </div>
  );
}

export function FactGroupSkeleton({ title, lines = 3 }: { title: ReactNode; lines?: number }) {
  return (
    <section className={styles.group} data-header-density="compact">
      <header className={styles.header}>
        <div className={styles.headerCopy}><h3>{title}</h3></div>
      </header>
      <div className={styles.skeleton} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <i key={index} />
        ))}
      </div>
    </section>
  );
}

export function FactGroupSkeletonGrid({
  titles,
  layout = "equal",
  ...props
}: {
  titles: readonly string[];
  layout?: "equal" | "weighted";
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <FactGroupGrid {...props} layout={layout}>
      {titles.map((title) => <FactGroupSkeleton key={title} title={title} />)}
    </FactGroupGrid>
  );
}
