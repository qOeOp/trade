import type { LineageWidget, SummaryWidget } from "../../model/types";
import { useWidget } from "../../model/view";
import { RoleMark } from "../../icons/marks";
import { select } from "../../state/selection";
import { Dropdown, DropdownItem, DropdownLabel } from "../../components/Dropdown";
import { VersionLine } from "../../components/VersionLine";
import { plural } from "../../lib/format";

/** The current recommendation, as IntelliJ's run-configuration widget; the menu lists every version
 *  the recommendation has rested on, latest first, and choosing one selects it. */
export function RecommendationWidget() {
  const summary = useWidget<SummaryWidget>("summary@1");
  const lineage = useWidget<LineageWidget>("lineage@2");
  if (!summary?.recommended || !lineage) return null;
  const nodes = new Map(lineage.nodes.map((n) => [n.id, n]));
  const history = [...lineage.trail].reverse();
  return (
    <Dropdown label="Recommended" trigger={<span className="inline-flex min-w-0 items-center gap-1.5"><RoleMark role="recommended" size={12} />
      <span className="truncate font-mono">{summary.recommended}</span></span>}>
      <DropdownLabel>Recommended versions · newest first</DropdownLabel>
      {history.map((t, i) => {
        const node = nodes.get(t.candidate);
        return node && (
          <DropdownItem key={`${t.candidate}-${i}`} onSelect={() => select(t.candidate, { reveal: true })}
                        hint={`from trial ${t.x0 == null ? "-" : Math.floor(t.x0)} · ${plural(t.judgments.length, "judgment")}`}>
            <VersionLine node={node} targets={lineage.targets} />
          </DropdownItem>
        );
      })}
    </Dropdown>
  );
}
