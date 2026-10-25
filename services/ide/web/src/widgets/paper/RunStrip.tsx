import { useEffect, useState } from "react";
import type { LineageNode } from "../../model/types";
import type { PaperRun } from "../../lib/paperApi";
import { pct, when } from "../../lib/format";
import { Dropdown, DropdownItem, DropdownLabel } from "../../components/Dropdown";
import { health, RunCard } from "../../components/RunCard";
import { ACTIVE, paperTab, selectedRun } from "../../state/paper";
import { useAtom } from "../../state/atom";

/** The time now, read again every `ms`, for readings that age (a bar's lateness). */
export function useNow(ms = 5000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

/** The panel's top row: a card per run not yet sealed (and the sealed one open, if any), then the sealed
 *  runs folded into "Stopped N", newest first; picking one opens it read-only. */
export function RunStrip({ runs, nodes, target }: { runs: readonly PaperRun[]; nodes: ReadonlyMap<string, LineageNode>; target: number | null | undefined }) {
  const selected = useAtom(selectedRun);
  const now = useNow();
  const stopped = runs.filter((r) => !ACTIVE.has(r.state)).reverse();
  const shown = runs.filter((r) => ACTIVE.has(r.state) || r.paper_id === selected);
  const open = (id: number) => { selectedRun.set(id); paperTab.set(null); };
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-3 pb-2 pt-1">
      {shown.map((run) => (
        <RunCard key={run.paper_id} run={run} node={nodes.get(run.candidate ?? "")} selected={run.paper_id === selected}
                 target={target} now={now} onSelect={() => open(run.paper_id)} />
      ))}
      {stopped.length > 0 && (
        <Dropdown label="Stopped paper runs" trigger={<span className="text-dense text-fg-muted">Stopped {stopped.length}</span>}>
          <DropdownLabel>Sealed runs · open one read-only</DropdownLabel>
          {stopped.map((run) => (
            <DropdownItem key={run.paper_id} onSelect={() => open(run.paper_id)}
                          hint={<span className={health(run, now).tone === "fail" ? "text-fail" : ""}>{pct(run.total_return)}</span>}>
              <span className="font-mono">{run.candidate}</span> <span className="text-fg-faint">· run {run.paper_id} · {when(run.created_at)}</span>
            </DropdownItem>
          ))}
        </Dropdown>
      )}
    </div>
  );
}
