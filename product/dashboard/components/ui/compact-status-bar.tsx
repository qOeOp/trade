import { Children, cloneElement, isValidElement, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import type { StatusBadgeTone } from "./status-badge";

type CompactStatusTone = StatusBadgeTone;
type CompactStatusGroupLayout = { columns: number; weight: number };
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
  return (
    <section {...props} className={["compact-status-bar", className].filter(Boolean).join(" ")}>
      <div className="compact-status-bar-layout" data-layout={isAsymmetric ? "bento" : undefined}>
        {groups.map((group, index) => {
          const itemCount = itemCounts[index];
          if (itemCount === null) return group;
          const layout = {
            columns: isAsymmetric && itemCount <= 2 ? 1 : Math.min(itemCount, 2),
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
  const itemCount = layout?.weight ?? Math.max(Children.toArray(children).length, 1);
  const groupStyle = {
    "--compact-status-columns": layout?.columns ?? itemCount,
    "--compact-status-weight": itemCount,
  } as CSSProperties;

  return (
    <div className="compact-status-group" data-bento-columns={layout?.columns} data-item-count={itemCount} style={groupStyle}>
      <span className="compact-status-group-label"><span>{label}</span></span>
      <dl>{children}</dl>
    </div>
  );
}

export function CompactStatusItem({
  label,
  value,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: CompactStatusTone;
}) {
  return (
    <div className="compact-status-item" data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
