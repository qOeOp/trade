import { useEffect } from "react";
import { useView } from "../../model/view";
import { lineHref } from "../../lib/lines";
import { readResearchLines, type LineIndex } from "../../state/researchLines";
import { followReadings, useLineReadings } from "../../state/researchReadings";
import { DropdownItem, DropdownLabel, DropdownLink, DropdownSeparator } from "../../components/Dropdown";
import { ReadingBadge } from "../../components/ReadingBadge";

/** The preloaded index remains visible while a newer ledger head refreshes it. Each line shows its recommendation
 *  as the phone's Research tab does (GET /api/readings), read only while the menu is open: Radix mounts the menu's
 *  content only then. */
export function ResearchLines({ index }: { index: LineIndex }) {
  const { line } = useView();
  const { lines, loaded, loading, error } = index;
  const { lines: readings } = useLineReadings();
  useEffect(() => { followReadings(true); return () => followReadings(false); }, []);
  return <>
    <DropdownLabel>Research lines · {loaded ? lines.length : "…"}{loaded && loading ? " · Updating…" : ""}</DropdownLabel>
    {!loaded && !error && <DropdownLabel>Reading research lines…</DropdownLabel>}
    {[...lines].reverse().map((item) => {
      const r = readings[item.name];
      return <DropdownLink key={item.name}
        href={lineHref(window.location.href, item.name)} current={item.name === line.bundle}
        hint={item.closed ? "Closed" : "Open"}>
        <span className="flex min-w-0 items-center gap-2">
          <ReadingBadge reading={r && r.eligible !== false ? r : null} targets={item.targets ?? null}
                        status={r?.eligible === false ? "Ineligible" : r === null ? "None" : undefined} />
          <span className="min-w-0 truncate font-mono">{item.name.replace(/^research-line-/, "")}</span>
        </span>
        <span className="block text-small text-fg-muted">Development {item.dev_start} → {item.dev_end}
          {r && <> · <span className="font-mono">{r.recommended}</span></>}</span>
      </DropdownLink>;
    })}
    {error && <DropdownItem onSelect={() => void readResearchLines(new URLSearchParams(window.location.search).get("at"), true)} hint="Retry">
      {error}
    </DropdownItem>}
    <DropdownSeparator />
  </>;
}
