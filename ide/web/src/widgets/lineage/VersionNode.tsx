import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LineageNode, Targets } from "../../model/types";
import type { FoldBar } from "../../model/lineageTree";
import { ROLE } from "../../model/semantics";
import { RoleMark } from "../../icons/marks";
import { hoverProps, toggleBranch } from "../../state/linking";
import { useIsSelected } from "../../state/selection";
import { Tip } from "../../ui/Tip";
import { TextButton } from "../../ui/TextButton";
import { VersionLine } from "../VersionLine";
import { VersionMenu } from "../runs/VersionMenu";
import { PaperButton } from "../paper/PaperButton";
import { MARK_CENTRE } from "./geometry";

export type VersionData = LineageNode & { targets: Targets | null };
export type FoldData = FoldBar & { targets: Targets | null };

// Its role and change; the prediction mark says its own on hover.
function NodeTip({ data }: { data: VersionData }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-fg-muted">
        <RoleMark role={data.role} size={12} />{ROLE[data.role]?.label}
      </div>
      {data.change && <div className="line-clamp-3 text-fg-faint">{data.change}</div>}
    </div>
  );
}

/** A version on the canvas: its VersionLine with full name, selectable, faded when it lost eligibility;
 *  with a paper daemon, ▶ (or ■ while it runs on paper) after its name on hover. */
export const VersionNode = memo(function VersionNode({ data }: NodeProps<Node<VersionData>>) {
  const selected = useIsSelected(data.id);
  const masked = data.role === "masked";
  return (
    <VersionMenu id={data.id}>
      <div {...hoverProps(data.id)} data-selected={selected ? "" : undefined}
           className="group relative flex items-center gap-1 rounded-control px-1 py-0.5 transition-colors">
        <Handle type="target" position={Position.Left} className="!opacity-0" />
        <Tip content={<NodeTip data={data} />} side="bottom">
          <span className="inline-flex"><VersionLine node={data} targets={data.targets} dim={masked} /></span>
        </Tip>
        <PaperButton id={data.id} />
        <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: MARK_CENTRE }} />
      </div>
    </VersionMenu>
  );
});

/** An inline collapsible fold bar grouping contiguous unpassed strategies on the lineage canvas. */
export const FoldNode = memo(function FoldNode({ data }: NodeProps<Node<FoldData>>) {
  const preview = data.nodes.slice(0, 8);
  const rest = data.nodes.length - preview.length;
  return (
    <div className="relative flex items-center">
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Tip side="bottom" content={
        <div className="space-y-1">
          <div className="font-semibold text-fg">
            {data.expanded ? "Click to fold back" : `Click to expand ${data.nodes.length} unpassed strategies`}
            {data.summary && <span className="font-normal text-fg-muted"> ({data.summary})</span>}
          </div>
          <div className="flex flex-col gap-0.5 pt-0.5">
            {preview.map((n) => <VersionLine key={n.id} node={n} targets={data.targets} dim={n.role === "masked"} />)}
            {rest > 0 && <div className="text-small text-fg-faint">… and {rest} more</div>}
          </div>
        </div>
      }>
        <TextButton size="inline" active={data.expanded}
                    onClick={(e) => { e.stopPropagation(); toggleBranch(data.id); }}
                    className="border border-dashed border-line-strong bg-well/90 px-2 !text-small !text-fg-muted hover:border-fg-faint hover:!text-fg">
          <span className="text-fg">{data.expanded ? "▾" : "▸"}</span>
          <span className="font-medium text-fg">{data.expanded ? `Fold ${data.nodes.length} unpassed` : `${data.nodes.length} unpassed folded`}</span>
          <span className="font-mono text-fg-faint">· {data.rangeLabel}</span>
        </TextButton>
      </Tip>
    </div>
  );
});
