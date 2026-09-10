import type { HTMLAttributes, ReactNode } from "react";

import styles from "./inline-notice.module.css";

export function InlineNotice({
  icon,
  title,
  children,
  tone = "neutral",
  density = "regular",
  className,
  ...props
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  tone?: "neutral" | "warning";
  density?: "compact" | "regular" | "spacious";
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section
      {...props}
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-density={density}
      data-tone={tone}
      data-ui="inline-notice"
    >
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      <div className={styles.copy}>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </section>
  );
}
