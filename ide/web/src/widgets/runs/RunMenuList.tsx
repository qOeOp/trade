import { useState, type KeyboardEvent } from "react";
import { useNow } from "../../components/hooks/useNow";
import { FilterChips } from "../../components/FilterChips";
import { Segmented } from "../../components/Segmented";
import { TextButton } from "../../components/TextButton";
import { Icon } from "../../icons/Icon";
import { ACTIVE } from "../../model/chain";
import { livePurposeLabel, type LiveRun } from "../../model/liveTrading";
import { useLiveTrading } from "../../state/liveTrading";
import { showLiveRun } from "../../state/liveWorkspace";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { useShown } from "../../state/shown";
import { chooseRun, showRun } from "../../state/stage";
import { RunList, runOrder } from "../paper/RunPicker";

type Kind = "live" | "paper";
type Phase = "all" | "active" | "waiting" | "ended";
// A live run executes, has ended, or was prepared and not started; a paper run runs or is sealed.
const livePhase = (r: LiveRun): Phase => (r.running ? "active" : r.ended ? "ended" : "waiting");
const PHASES: Record<Kind, readonly [Phase, string][]> = {
  live: [["all", "All"], ["active", "Running"], ["waiting", "Not started"], ["ended", "Ended"]],
  paper: [["all", "All"], ["active", "Running"], ["ended", "Sealed"]],
};

/** The toolbar/sheet picker of runs to show. On top, beside its title, a box finding a run by version or ID
 *  (Enter shows the first match); under it the list it shows (Live or Paper, the shown stage's first) and its
 *  phases, each with its count; under them the runs, grouped by version. A live run is set up from the Live
 *  stage of a chosen version, not here. Both lists, whole, are also laid out unseen and zero high, so the
 *  picker is as wide as the wider of them and switching lists, phases or searching never changes its width. */
export function RunMenuList({ close, phone = false }: { close: () => void; phone?: boolean }) {
  const paper = usePaperRuns()?.runs ?? [], service = usePaperService(), { run, liveRun, stage } = useShown();
  const { view } = useLiveTrading(), now = useNow();
  const [kind, setKind] = useState<Kind>(stage === "live" ? "live" : "paper"), [phase, setPhase] = useState<Phase>("all"), [query, setQuery] = useState("");
  const order = runOrder(paper, now);
  const paperPhase = (state: string): Phase => (ACTIVE.has(state) ? "active" : "ended");
  const counts = (k: Kind, p: Phase) => k === "live" ? view.runs.filter((r) => p === "all" || livePhase(r) === p).length
    : order.filter((r) => p === "all" || paperPhase(r.state) === p).length;
  const chips = (k: Kind, value: Phase) => <FilterChips label="Phase" value={value} onChange={setPhase} items={PHASES[k].map(([id, name]) => ({ id, label: name, count: counts(k, id) }))} />;
  const find = query.trim().toLowerCase();
  const liveList = (live: readonly LiveRun[]) => {
    const groups = new Map<string, LiveRun[]>();
    for (const item of [...live].reverse()) groups.set(item.candidate, [...(groups.get(item.candidate) ?? []), item]);
    return <div role="listbox" aria-label="Live runs">
      {[...groups].map(([candidate, items]) => <div key={candidate}>
        <p className="truncate px-2 pb-1 pt-2 font-mono text-small text-fg-faint">{candidate} · {items.length}</p>
        {items.map((item) => <TextButton key={item.id} role="option" aria-selected={stage === "live" && item.id === liveRun?.id}
          onClick={() => { showLiveRun(item.id); close(); }} className="w-full flex-col items-stretch rounded-control px-3 py-2 text-left text-fg! outline-none hover:bg-hover focus:bg-selection aria-selected:bg-selection">
          <span className="flex items-center justify-between gap-3"><span className="truncate font-mono text-small">{item.id}</span><span className="shrink-0 text-small text-fg-muted">{item.host.find((fact) => fact.label === "State")?.value?.replaceAll("_", " ") ?? "Unknown"}</span></span>
          <span className="mt-0.5 block text-small text-fg-faint">{livePurposeLabel(item.purpose)}</span>
        </TextButton>)}
      </div>)}
      {!live.length && <p className="px-3 py-2 text-small text-fg-faint">{view.runs.length ? "No live run matches" : "No live runs available"}</p>}
    </div>;
  };
  const paperList = (shown: typeof order, q: string) => paper.length
    ? <RunList anyLine={phone} query={q} order={shown} runs={paper} front={run} now={now} pick={(item) => { (phone ? showRun : chooseRun)(item); close(); }} />
    : <p className="px-3 py-2 text-small text-fg-faint">{service === "absent" ? "Paper runs are not served" : "No paper runs available"}</p>;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)]?.focus();
    event.preventDefault();
  };
  const switchKind = (k: Kind) => { setKind(k); setPhase("all"); };
  return <div className="min-w-0 text-dense">
    <div data-run-menu onKeyDown={move}>
      <div className="sticky top-0 z-20 space-y-2 border-b border-line bg-popup px-2 pb-2">
        <div className="flex items-center gap-3 pt-2">
          <span className="shrink-0 font-semibold">Runs</span>
          <label className="flex h-(--form-h) min-w-0 flex-1 items-center gap-1.5 rounded-control border border-line-strong bg-island px-2 focus-within:border-focus">
            <span className="flex text-fg-faint"><Icon name="search" size={12} /></span>
            <input autoFocus={!phone} aria-label={kind === "live" ? "Find a live run" : "Find a paper run"} value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={kind === "live" ? "Version or run ID" : "Version or run number"}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.closest("[data-run-menu]")?.querySelector<HTMLElement>("[role=option]")?.click(); }}
              className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-ghost" />
          </label>
        </div>
        <Segmented label="Runs to list" value={kind} onChange={switchKind} items={[
          { id: "live", label: <>Live <span className="text-fg-faint">{view.runs.length}</span></> },
          { id: "paper", label: <>Paper <span className="text-fg-faint">{order.length}</span></> }]} />
        {chips(kind, phase)}
      </div>
      <div className="pt-1">
        {kind === "live" ? liveList(view.runs.filter((r) => (phase === "all" || livePhase(r) === phase) && `${r.candidate} ${r.id}`.toLowerCase().includes(find)))
          : paperList(order.filter((r) => phase === "all" || paperPhase(r.state) === phase), query)}
      </div>
    </div>
    <div aria-hidden inert className="invisible h-0 overflow-hidden">
      <div className="px-2">{chips("live", "all")}</div>{liveList(view.runs)}
      <div className="px-2">{chips("paper", "all")}</div>{paperList(order, "")}
    </div>
  </div>;
}
