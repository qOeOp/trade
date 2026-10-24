import { BaseEdge, type EdgeProps } from "@xyflow/react";

/** Parent to child as a git graph draws it: straight down from the parent's mark to the child's row,
 *  one rounded corner, then straight on to the child. Stroke from base.css (.react-flow__edge-path). */
export function Elbow({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const r = Math.max(0, Math.min(7, Math.abs(targetY - sourceY) / 2, Math.abs(targetX - sourceX) / 2));
  const dir = targetX >= sourceX ? 1 : -1;
  const path = Math.abs(targetY - sourceY) < 1
    ? `M${sourceX} ${targetY} H${targetX}`
    : `M${sourceX} ${sourceY} V${targetY - r} Q${sourceX} ${targetY} ${sourceX + dir * r} ${targetY} H${targetX}`;
  return <BaseEdge path={path} />;
}
