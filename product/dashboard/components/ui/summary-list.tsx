import type { HTMLAttributes, ReactNode } from "react";
import styles from "./summary-list.module.css";

export function SummaryList({
  children,
  className,
  ...props
}: { children: ReactNode } & HTMLAttributes<HTMLUListElement>) {
  return (
    <ul {...props} className={[styles.list, className].filter(Boolean).join(" ")}>
      {children}
    </ul>
  );
}

export function SummaryItem({
  eyebrow,
  title,
  description,
  leading,
  trailing,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className={styles.item}>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <div className={styles.copy}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </li>
  );
}
