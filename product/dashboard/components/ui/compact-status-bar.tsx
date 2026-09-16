import { Children, cloneElement, isValidElement, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import type { StatusBadgeTone } from "./status-badge";

type CompactStatusTone = StatusBadgeTone;
type CompactStatusGroupLayout = {
  columns: number;
  itemCount: number;
  placement?: "tall" | "stacked";
  weight: number;
};
type CompactStatusGroupProps = { label: ReactNode; children: ReactNode; layout?: CompactStatusGroupLayout };

function groupItemCount(node: ReactNode) {
  if (!isValidElement<CompactStatusGroupProps>(node) || node.type !== CompactStatusGroup) return null;
  return Math.max(Children.toArray(node.props.children).length, 1);
}

export function CompactStatusBar({
  children,
  className,
  ...props
}: { children: ReactNode } & HTMLAttributes<HTMLElement>) {
  const groups = Children.toArray(children);
  const itemCounts = groups.map(groupItemCount);
  const concreteCounts = itemCounts.filter((count): count is number => count !== null);
  const isAsymmetric = new Set(concreteCounts).size > 1;
  const pairedBento = concreteCounts.length === 3
    && concreteCounts.filter((count) => count === 2).length === 1
    && concreteCounts.filter((count) => count === 1).length === 2;
  return (
    <section {...props} className={["compact-status-bar", className].filter(Boolean).join(" ")}>
      <div className="compact-status-bar-layout" data-layout={isAsymmetric ? "bento" : undefined}
        data-bento-pattern={pairedBento ? "2-1-1" : undefined}>
        {groups.map((group, index) => {
          const itemCount = itemCounts[index];
          if (itemCount === null) return group;
          const layout: CompactStatusGroupLayout = {
            columns: isAsymmetric && itemCount <= 2 ? 1 : Math.min(itemCount, 2),
            itemCount,
            placement: pairedBento ? (itemCount === 2 ? "tall" : "stacked") : undefined,
            weight: isAsymmetric ? 1 + Math.log2(itemCount) : itemCount,
          };
          return cloneElement(group as ReactElement<CompactStatusGroupProps>, { layout });
        })}
      </div>
    </section>
  );
}

export function CompactStatusGroup({
  label,
  children,
  layout,
}: CompactStatusGroupProps) {
  const itemCount = layout?.itemCount ?? Math.max(Children.toArray(children).length, 1);
  const weight = layout?.weight ?? itemCount;
  const groupStyle = {
    "--compact-status-columns": layout?.columns ?? itemCount,
    "--compact-status-weight": weight,
  } as CSSProperties;

  return (
    <div className="compact-status-group" data-bento-columns={layout?.columns}
      data-bento-placement={layout?.placement} data-item-count={itemCount} style={groupStyle}>
      <span className="compact-status-group-label"><span>{label}</span></span>
      <dl>{children}</dl>
    </div>
  );
}

type CompactStatusItemProps = {
  label: ReactNode;
  value: ReactNode;
  tone?: CompactStatusTone;
} & (
  | { href: string; actionLabel: string }
  | { href?: never; actionLabel?: never }
);

export function CompactStatusItem({
  label,
  value,
  tone = "neutral",
  href,
  actionLabel,
}: CompactStatusItemProps) {
  return (
    <div className="compact-status-item" data-interactive={href ? true : undefined} data-tone={tone}>
      <dt>{label}</dt>
      <dd>
        {value}
        {href ? <Link className="compact-status-item-link" href={href} aria-label={actionLabel}>
          <span className="sr-only">{actionLabel}</span>
        </Link> : null}
      </dd>
    </div>
  );
}
