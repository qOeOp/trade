import type { HTMLAttributes, LiHTMLAttributes, ReactNode } from "react";

export type TimelineListProps = HTMLAttributes<HTMLOListElement> & {
  children: ReactNode;
};

export function TimelineList({ children, className, ...props }: TimelineListProps) {
  return (
    <ol {...props} className={["timeline-list", className].filter(Boolean).join(" ")}>
      {children}
    </ol>
  );
}

export type TimelineItemProps = Omit<LiHTMLAttributes<HTMLLIElement>, "children"> & {
  description?: ReactNode;
  descriptionTitle?: string;
  eyebrow: ReactNode;
  index: ReactNode;
  meta?: ReactNode;
  primary: ReactNode;
  primaryTitle?: string;
  status?: ReactNode;
};

export function TimelineItem({
  className,
  description,
  descriptionTitle,
  eyebrow,
  index,
  meta,
  primary,
  primaryTitle,
  status,
  ...props
}: TimelineItemProps) {
  return (
    <li {...props} className={["timeline-event", className].filter(Boolean).join(" ")}>
      <span className="timeline-event-index">{index}</span>
      <div className="timeline-event-copy">
        <span>{eyebrow}</span>
        <b title={primaryTitle}>{primary}</b>
        {description ? <small title={descriptionTitle}>{description}</small> : null}
      </div>
      {meta ? <span className="timeline-event-meta">{meta}</span> : null}
      {status ? <span className="timeline-event-status">{status}</span> : null}
    </li>
  );
}
