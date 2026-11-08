import { useState, type KeyboardEvent } from "react";
import { useNow } from "../../components/hooks/useNow";
import { TextButton } from "../../components/TextButton";
import { livePurposeLabel } from "../../model/liveTrading";
import { useLiveTrading } from "../../state/liveTrading";
import { openLiveWizard, showLiveRun } from "../../state/liveWorkspace";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { useShown } from "../../state/shown";
import { chooseRun, showRun } from "../../state/stage";
import { RunList, runOrder } from "../paper/RunPicker";

/** The existing toolbar/sheet picker, with distinct Paper and Live row renderers. */
export function RunMenuList({ close, phone = false }: { close: () => void; phone?: boolean }) {
  const paper = usePaperRuns()?.runs ?? [], service = usePaperService(), { run, liveRun, stage } = useShown();
  const { view } = useLiveTrading(), now = useNow(), [query, setQuery] = useState("");
  const live = view.runs.filter((item) => `${item.candidate} ${item.id}`.toLowerCase().includes(query.toLowerCase()));
  const groups = new Map<string, typeof live>();
  for (const item of [...live].reverse()) groups.set(item.candidate, [...(groups.get(item.candidate) ?? []), item]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)]?.focus();
    event.preventDefault();
  };
  return <div className="min-w-0 text-dense">
    <div className="flex items-center justify-between gap-4 border-b border-line px-2 py-2">
      <span className="font-semibold">Runs</span>
      <TextButton onClick={() => { close(); openLiveWizard(); }}>New live run…</TextButton>
    </div>
    <div className="px-2 pb-1 pt-3 text-small font-semibold text-fg-faint">Live</div>
    {view.runs.length > 8 && <input aria-label="Find a live run" placeholder="Find a live run" value={query} onChange={(event) => setQuery(event.target.value)}
      className="mx-2 mb-2 h-(--form-h) w-[calc(100%-1rem)] rounded-control bg-frame px-2 text-dense" />}
    <div role="listbox" aria-label="Live runs" onKeyDown={move}>
      {[...groups].map(([candidate, items]) => <div key={candidate}>
        <p className="truncate px-2 pb-1 pt-2 font-mono text-small text-fg-faint">{candidate}</p>
        {items.map((item) => <TextButton key={item.id} role="option" aria-selected={stage === "live" && item.id === liveRun?.id}
          onClick={() => { showLiveRun(item.id); close(); }} className="w-full flex-col items-stretch rounded-control px-3 py-2 text-left text-fg! outline-none hover:bg-hover focus:bg-selection aria-selected:bg-selection">
          <span className="flex items-center justify-between gap-3"><span className="truncate font-mono text-small">{item.id}</span><span className="shrink-0 text-small text-fg-muted">{item.host.find((fact) => fact.label === "State")?.value?.replaceAll("_", " ") ?? "Unknown"}</span></span>
          <span className="mt-0.5 block text-small text-fg-faint">{livePurposeLabel(item.purpose)}</span>
        </TextButton>)}
      </div>)}
      {!live.length && <p className="px-3 py-2 text-small text-fg-faint">{view.runs.length ? "No matching live run" : "No live runs available"}</p>}
    </div>
    <div className="mt-2 border-t border-line px-2 pb-1 pt-3 text-small font-semibold text-fg-faint">Paper</div>
    {paper.length ? <RunList anyLine={phone} order={runOrder(paper, now)} runs={paper} front={run} now={now}
      pick={(item) => { (phone ? showRun : chooseRun)(item); close(); }} />
      : <p className="px-3 py-2 text-small text-fg-faint">{service === "absent" ? "Paper runs are not served" : "No paper runs available"}</p>}
  </div>;
}
