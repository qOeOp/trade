import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { elbowPath } from "./geometry";

/** Parent to child as a git graph draws it (geometry.elbowPath). Stroke from base.css (.react-flow__edge-path). */
export function Elbow({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  return <BaseEdge path={elbowPath(sourceX, sourceY, targetX, targetY)} />;
}
