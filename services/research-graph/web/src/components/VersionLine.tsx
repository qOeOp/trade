import type { ReactNode } from "react";
import type { LineageNode, Targets } from "../model/types";
import { ROLE } from "../model/semantics";
import { PredictionMark, RoleMark } from "../icons/marks";
import { ReadingBadge } from "./ReadingBadge";

// One version on one line, the same wherever it appears (canvas, tree, palette, status bar): role
// mark, reading badge, a fixed slot for the prediction mark, then the name, at fixed gaps.
export function VersionLine({ node, targets, children, dim = false }: {
  node: Pick<LineageNode, "id" | "role" | "prediction" | "reading">; targets: Targets | null; children?: ReactNode; dim?: boolean;
}) {
  const [name, revision] = node.id.split("@");
  return (
    <span data-version-line className={`inline-flex items-center gap-(--vl-gap) whitespace-nowrap ${dim ? "opacity-45" : ""}`}>
      <span data-part="mark" className="grid"><RoleMark role={node.role} /></span>
      <ReadingBadge reading={node.reading} targets={targets} status={ROLE[node.role]?.label} />
      <span data-part="pred" className="grid w-(--pred-slot) shrink-0 place-items-center"><PredictionMark prediction={node.prediction} /></span>
      <span data-part="name" className={`font-mono text-small ${node.role === "superseded" ? "text-fg-muted" : "text-fg"}`}>
        {name}<span className="text-fg-faint">@{revision}</span>
      </span>
      {children}
    </span>
  );
}
