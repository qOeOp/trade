import type { ReactNode } from "react";
import type { LineageNode, Targets } from "../model/types";
import { ROLE } from "../model/semantics";
import { PredictionMark, RoleMark } from "../icons/marks";
import { ReadingBadge } from "./ReadingBadge";

// One version on one line, the same wherever it appears (canvas, tree, palette, status bar): role
// mark, reading badge, a fixed slot for the prediction mark, then the name, at fixed gaps. A version that
// lost eligibility has no badge, and `dim` fades all but its mark (the only red on it) to 40%.
export function VersionLine({ node, targets, children, dim = false }: {
  node: Pick<LineageNode, "id" | "role" | "prediction" | "reading">; targets: Targets | null; children?: ReactNode; dim?: boolean;
}) {
  const [name, revision] = node.id.split("@");
  const fade = dim ? "opacity-40" : "";
  return (
    <span data-version-line className="inline-flex items-center gap-(--vl-gap) whitespace-nowrap">
      <span data-part="mark" className="grid"><RoleMark role={node.role} /></span>
      {node.role !== "masked" && <ReadingBadge reading={node.reading} targets={targets} status={ROLE[node.role]?.label} />}
      <span data-part="pred" className={`grid w-(--pred-slot) shrink-0 place-items-center ${fade}`}><PredictionMark prediction={node.prediction} /></span>
      <span data-part="name" className={`font-mono text-small ${fade} ${node.role === "superseded" ? "text-fg-muted" : "text-fg"}`}>
        {name}<span className="text-fg-faint">@{revision}</span>
      </span>
      {children}
    </span>
  );
}
