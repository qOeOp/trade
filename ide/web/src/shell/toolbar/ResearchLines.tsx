import { useView } from "../../model/view";
import { lineHref } from "../../lib/lines";
import { readResearchLines, type LineIndex } from "../../state/researchLines";
import { DropdownItem, DropdownLabel, DropdownLink, DropdownSeparator } from "../../components/Dropdown";

/** The preloaded index remains visible while a newer ledger head refreshes it. */
export function ResearchLines({ index }: { index: LineIndex }) {
  const { line } = useView();
  const { lines, loaded, loading, error } = index;
  return <>
    <DropdownLabel>Research lines · {loaded ? lines.length : "…"}{loaded && loading ? " · Updating…" : ""}</DropdownLabel>
    {!loaded && !error && <DropdownLabel>Reading research lines…</DropdownLabel>}
    {[...lines].reverse().map((item) => <DropdownLink key={item.name}
      href={lineHref(window.location.href, item.name)} current={item.name === line.bundle}
      hint={item.closed ? "Closed" : "Open"}>
      <span className="block font-mono">{item.name.replace(/^research-line-/, "")}</span>
      <span className="block text-small text-fg-muted">Development {item.dev_start} → {item.dev_end}</span>
    </DropdownLink>)}
    {error && <DropdownItem onSelect={() => void readResearchLines(new URLSearchParams(window.location.search).get("at"), true)} hint="Retry">
      {error}
    </DropdownItem>}
    <DropdownSeparator />
  </>;
}
