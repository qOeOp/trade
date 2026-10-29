import { useEffect, useState } from "react";
import { useView } from "../../model/view";
import { lineHref, servedPage, type ResearchLine } from "../../lib/lines";
import { DropdownItem, DropdownLabel, DropdownLink, DropdownSeparator } from "../../components/Dropdown";

/** A snapshot's whole line index, including closed lines; navigating never selects or closes a ledger line. */
export function ResearchLines() {
  const { line, scope } = useView();
  const [lines, setLines] = useState<ResearchLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const commit = scope?.ledger_commit;
  const served = servedPage();
  useEffect(() => {
    if (!served || !commit) return;
    const controller = new AbortController();
    setLines(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/lines?at=${encodeURIComponent(commit)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Could not read research lines");
        if (!controller.signal.aborted) setLines(body.lines as ResearchLine[]);
      } catch (e) {
        if (!controller.signal.aborted) setError(String(e));
      }
    })();
    return () => controller.abort();
  }, [commit, served, retry]);
  if (!served) return null;
  return <>
    <DropdownLabel>Research lines · {lines?.length ?? "…"}</DropdownLabel>
    {error ? <DropdownItem onSelect={() => setRetry((n) => n + 1)} hint="Retry">{error}</DropdownItem>
      : lines === null ? <DropdownLabel>Reading research lines…</DropdownLabel>
      : [...lines].reverse().map((item) => <DropdownLink key={item.bundle}
          href={lineHref(window.location.href, item.bundle)} current={item.bundle === line.bundle}
          hint={item.closed ? "Closed" : "Open"}>
          <span className="block font-mono">{item.bundle.replace(/^research-line-/, "")}</span>
          <span className="block text-small text-fg-muted">{item.window_start} → {item.window_end}</span>
        </DropdownLink>)}
    <DropdownSeparator />
  </>;
}
