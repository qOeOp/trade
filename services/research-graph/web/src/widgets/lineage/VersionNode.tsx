import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LineageNode, Targets } from "../../model/types";
import { PREDICTION, ROLE, verdict } from "../../model/semantics";
import { pct } from "../../lib/format";
import { RoleMark } from "../../icons/marks";
import { hoverProps } from "../../state/linking";
import { useIsSelected } from "../../state/selection";
import { Tip } from "../../components/Tip";
import { VersionLine } from "../../components/VersionLine";
import { VersionMenu } from "../../components/VersionMenu";
import { MARK_CENTRE } from "./geometry";

export type VersionData = LineageNode & { targets: Targets | null };

function NodeTip({ data }: { data: VersionData }) {
  const ok = verdict(data.reading, data.targets);
  return (
    <div className="space-y-1">
      <div className="font-mono font-semibold">{data.id}</div>
      <div className="flex items-center gap-1.5 text-fg-muted">
        <RoleMark role={data.role} size={12} />{ROLE[data.role]?.label}
        {data.prediction !== "none" && <span>· {PREDICTION[data.prediction].label}</span>}
      </div>
      {data.reading.annual_return != null && (
        <div className="font-mono">年化 <span className={ok.ret === false ? "text-misses" : ""}>{pct(data.reading.annual_return)}</span>
          {"  "}回撤 <span className={ok.dd === false ? "text-misses" : ""}>{pct(data.reading.max_drawdown)}</span></div>
      )}
      {data.change && <div className="line-clamp-3 text-fg-faint">{data.change}</div>}
    </div>
  );
}

/** A version on the canvas: its VersionLine, selectable, wrapped in red when it lost eligibility. */
export const VersionNode = memo(function VersionNode({ data }: NodeProps<Node<VersionData>>) {
  const selected = useIsSelected(data.id);
  const masked = data.role === "masked";
  return (
    // The context menu takes the node's box and the tooltip its line, so each has its own element.
    <VersionMenu id={data.id}>
      <div {...hoverProps(data.id)} data-selected={selected ? "" : undefined}
           className={`flex items-center rounded-control px-1 py-0.5 transition-colors ${masked && !selected ? "bg-[color-mix(in_srgb,var(--fail)_13%,transparent)]" : ""}`}>
        <Handle type="target" position={Position.Left} className="!opacity-0" />
        <Tip content={<NodeTip data={data} />} side="bottom">
          <span className="inline-flex"><VersionLine node={data} targets={data.targets} dim={masked} /></span>
        </Tip>
        <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: MARK_CENTRE }} />
      </div>
    </VersionMenu>
  );
});
