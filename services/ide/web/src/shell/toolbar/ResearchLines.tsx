import { useView } from "../../model/view";
import { lineHref, servedPage } from "../../lib/lines";
import { readResearchLines, type LineIndex } from "../../state/researchLines";
import { DropdownItem, DropdownLabel, DropdownLink, DropdownSeparator } from "../../components/Dropdown";

/** The preloaded index remains visible while a newer ledger head refreshes it. */
export function ResearchLines({ index }: { index: LineIndex }) {
  const { line } = useView();
  if (!servedPage()) return null;
  const { lines, loaded, loading, error } = index;
  return <>
    <DropdownLabel>Research lines · {loaded ? lines.length : "…"}{loaded && loading ? " · Updating…" : ""}</DropdownLabel>
    {!loaded && !error && <DropdownLabel>Reading research lines…</DropdownLabel>}
    {[...lines].reverse().map((item) => <DropdownLink key={item.bundle}
      href={lineHref(window.location.href, item.bundle)} current={item.bundle === line.bundle}
      hint={item.closed ? "Closed" : "Open"}>
      <span className="block font-mono">{item.bundle.replace(/^research-line-/, "")}</span>
      <span className="block text-small text-fg-muted">{item.window_start} → {item.window_end}</span>
    </DropdownLink>)}
    {error && <DropdownItem onSelect={() => void readResearchLines(new URLSearchParams(window.location.search).get("at"), true)} hint="Retry">
      {error}
    </DropdownItem>}
    <DropdownSeparator />
  </>;
}
