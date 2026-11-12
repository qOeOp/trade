import type { LineageWidget, SummaryWidget } from "../../model/types";
import { useWidget } from "../../model/view";
import { select } from "../../state/selection";
import { Dropdown, DropdownItem, DropdownLabel } from "../../components/Dropdown";
import { VersionLine } from "../../components/VersionLine";
import { plural } from "../../lib/format";

/** The current recommendation, as IntelliJ's run-configuration widget; the menu lists every version
 *  the recommendation has rested on, latest first, and choosing one selects it. A recommended version whose
 *  latest research run has since lost its evidence stays named, marked ineligible now (CF-08). */
export function RecommendationWidget() {
  const summary = useWidget<SummaryWidget>("summary");
  const lineage = useWidget<LineageWidget>("lineage");
  if (!summary?.recommended || !lineage) return null;
  const nodes = new Map(lineage.nodes.map((n) => [n.id, n]));
  const history = [...lineage.trail].reverse();
  const ineligible = summary.status === "masked";
  return (
    <Dropdown label={ineligible ? "Last recommended, ineligible now" : "Recommended"}
              trigger={<><span className="truncate font-mono">{summary.recommended}</span>
                {ineligible && <span className="shrink-0 text-small text-misses-fg">Ineligible now</span>}</>}>
      {ineligible && <p className="max-w-80 px-2 py-1.5 text-small text-fg-muted">
        The latest recommendation names {summary.recommended}, but its latest research run no longer carries economic evidence.</p>}
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
