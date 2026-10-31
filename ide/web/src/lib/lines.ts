/** A line change retains a pinned ledger snapshot, but drops the previous graph's scope and selection. */
export function lineHref(href: string, bundle: string): string {
  const url = new URL(href);
  url.searchParams.set("line", bundle);
  url.searchParams.delete("since");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

export type ResearchLine = {
  bundle: string; start: string; window_start: string; window_end: string; closed: boolean;
};

/** Rendered files are self-contained and have no service to ask. */
export function servedPage(): boolean {
  return document.getElementById("research-graph-view")?.textContent?.trim() === "null";
}
