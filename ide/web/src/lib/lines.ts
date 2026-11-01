/** A line change retains a pinned ledger snapshot, but drops the previous graph's scope and selection. */
export function lineHref(href: string, bundle: string): string {
  const url = new URL(href);
  url.searchParams.set("line", bundle);
  url.searchParams.delete("since");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

/** The page on line `bundle` with `version` selected and, on the Runs page, paper run `run` picked
 *  (`run=`, which the page drops once it has picked it). */
export function runHref(href: string, bundle: string, version: string, run: number): string {
  const url = new URL(lineHref(href, bundle), href);
  url.searchParams.set("run", String(run));
  return `${url.pathname}${url.search}#${encodeURI(version)}`;
}

/** `versions`: the versions its research graph draws. */
export type ResearchLine = {
  bundle: string; start: string; window_start: string; window_end: string; closed: boolean; versions: string[];
};

/** The line whose graph draws `version`: the newest open one, else the newest. */
export function lineOf(lines: readonly ResearchLine[], version: string): ResearchLine | null {
  const holding = lines.filter((l) => l.versions.includes(version));
  return holding.filter((l) => !l.closed).at(-1) ?? holding.at(-1) ?? null;
}

/** Rendered files are self-contained and have no service to ask. */
export function servedPage(): boolean {
  return document.getElementById("research-graph-view")?.textContent?.trim() === "null";
}
