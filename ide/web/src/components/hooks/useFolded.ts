// The versions the lineage's fold hides now (model/lineageTree.ts compactLineage, as the canvas and the version tree
// draw it), so the charts under it can follow the fold. Charts leave these versions' runs out of what they draw but
// count them and keep them in what they compute, so the fold never hides how many runs the line has tried.
import { useMemo } from "react";
import { compactLineage } from "../../model/lineageTree";
import type { LineageWidget } from "../../model/types";
import { useWidget } from "../../model/view";
import { expandedBranches, lineageMode, useExpandedBranches, useLineageMode } from "../../state/linking";
import { useSelection } from "../../state/selection";

const NONE: ReadonlySet<string> = new Set();

export function useFolded(): ReadonlySet<string> {
  const lineage = useWidget<LineageWidget>("lineage"), mode = useLineageMode(), expanded = useExpandedBranches(), selected = useSelection();
  return useMemo(() => {
    if (!lineage) return NONE;
    const { widget, hiddenCount } = compactLineage(lineage, mode, selected, expanded);
    if (!hiddenCount) return NONE;
    const kept = new Set(widget.nodes.map((n) => n.id));
    return new Set(lineage.nodes.flatMap((n) => (kept.has(n.id) ? [] : [n.id])));
  }, [lineage, mode, selected, expanded]);
}

/** Every version shown again, as the lineage's "Expand all". */
export const unfold = () => { lineageMode.set("all"); expandedBranches.set(new Set()); };
