import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import styles from "./journey-progress.module.css";

export type JourneyStageState = "complete" | "current" | "pending" | "warning" | "blocked";

export type JourneyStage = Readonly<{
  id: string;
  label: ReactNode;
  detail: ReactNode;
  state: JourneyStageState;
}>;

export function JourneyProgress({
  eyebrow = "Progress",
  summary,
  stages,
  className,
  style,
  ...props
}: {
  eyebrow?: ReactNode;
  summary: ReactNode;
  stages: readonly JourneyStage[];
} & Omit<HTMLAttributes<HTMLElement>, "children">) {
  return (
    <section
      {...props}
      className={[styles.journey, className].filter(Boolean).join(" ")}
      data-ui="journey-progress"
      style={{ ...style, "--journey-stage-count": stages.length } as CSSProperties}
    >
      <header className={styles.heading}>
        <span>{eyebrow}</span>
        <strong>{summary}</strong>
      </header>
      <ol className={styles.stages}>
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className={styles.stage}
            data-state={stage.state}
            aria-current={stage.state === "current" ? "step" : undefined}
          >
            <span className={styles.marker} aria-hidden="true">
              {stage.state === "complete" ? "✓" : String(index + 1).padStart(2, "0")}
            </span>
            <span className={styles.copy}>
              <b>{stage.label}</b>
              <small>{stage.detail}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
