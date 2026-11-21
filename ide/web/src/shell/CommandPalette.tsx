import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Command } from "cmdk";
import { ACTIVE } from "../model/chain";
import type { LineageWidget } from "../model/types";
import { useAtom } from "../state/atom";
import { select, useSelection } from "../state/selection";
import { paletteOpen } from "../state/shell";
import { startDialog, starting, stopDialog, usePaperRuns, usePaperService } from "../state/paper";
import { plural } from "../lib/format";
import { Kbd } from "../components/Kbd";
import { SCRIM } from "../components/dialog";
import { VersionLine } from "../components/VersionLine";
import type { Action } from "./commands";

const ITEM = "flex cursor-pointer items-center gap-3 rounded-control px-2 py-1";
const versionValue = (n: LineageWidget["nodes"][number]) => `${n.id} ${n.trials.join(" ")} ${n.change ?? ""}`;

/** ⌘K: jump to any version by name or by what it changed, or run a command. "Run paper…" opens a second
 *  page, as cmdk's nested pages: the versions not running paper to pick from, the selected one first;
 *  Backspace on an empty query goes back. */
export function CommandPalette({ lineage, actions }: { lineage?: LineageWidget; actions: readonly Action[] }) {
  const open = useAtom(paletteOpen), selected = useSelection();
  const [page, setPage] = useState<"paper" | null>(null), [query, setQuery] = useState("");
  useEffect(() => { if (!open) { setPage(null); setQuery(""); } }, [open]);
  const nodes = useMemo(() => [...(lineage?.nodes ?? [])].sort((a, b) => (b.x ?? -1) - (a.x ?? -1)), [lineage]);
  const close = (run: () => void) => () => { paletteOpen.set(false); run(); };
  const paper = usePaperService() === "present";
  const runs = usePaperRuns()?.runs.filter((r) => ACTIVE.has(r.state)) ?? [];
  const busy = new Set([...runs.map((r) => r.candidate), ...useAtom(starting).keys()]);
  const idle = nodes.filter((n) => !busy.has(n.id)), first = idle.find((n) => n.id === selected);
  const pickable = first ? [first, ...idle.filter((n) => n !== first)] : idle;
  const back = (e: KeyboardEvent) => { if (page && !query && e.key === "Backspace") { e.preventDefault(); setPage(null); } };
  return (
    <Command.Dialog open={open} onOpenChange={paletteOpen.set} label="Go to a version or run a command" onKeyDown={back}
                    overlayClassName={SCRIM}
                    contentClassName="fixed left-1/2 top-[14%] z-50 w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-popup border border-popup-border bg-popup shadow-popup">
      <Command.Input value={query} onValueChange={setQuery} placeholder={page ? "Run paper on which version…" : "Version, change or command…"} autoFocus
                     className="w-full border-b border-line bg-transparent px-3 py-2 text-ui outline-none" />
      <Command.List className="max-h-96 overflow-auto p-1 text-dense">
        {page === "paper" ? (<>
          <Command.Empty className="px-3 py-6 text-center text-fg-faint">No matching version that is not running paper</Command.Empty>
          <Command.Group heading="Run paper on">
            {pickable.map((n) => (
              <Command.Item key={n.id} value={versionValue(n)} onSelect={close(() => startDialog.set(n.id))} className={ITEM}>
                <VersionLine node={n} targets={lineage?.targets ?? null} />
                <span className="min-w-0 flex-1 truncate text-small text-fg-faint">{n === first && <span className="text-fg-muted">Selected · </span>}{n.change}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </>) : (<>
        <Command.Empty className="px-3 py-6 text-center text-fg-faint">No matching version or command</Command.Empty>
        <Command.Group heading="Commands">
          {actions.filter((a) => a.id !== "palette").map((a) => (
            <Command.Item key={a.id} onSelect={close(a.run)} className="flex cursor-pointer items-center rounded-control px-2 py-1.5 text-fg-muted">
              {a.label}{a.keys && <span className="ml-auto"><Kbd>{a.keys}</Kbd></span>}
            </Command.Item>
          ))}
        </Command.Group>
        {paper && (
          <Command.Group heading="Paper">
            {runs.map((r) => (
              <Command.Item key={`stop:${r.paper_id}`} value={`Stop paper: ${r.candidate}`} onSelect={close(() => stopDialog.set(r))}
                            className="flex cursor-pointer items-center rounded-control px-2 py-1.5 text-fg-muted">Stop paper: {r.candidate}</Command.Item>
            ))}
            {idle.length > 0 && (
              <Command.Item key="run" value="Run paper…" onSelect={() => { setPage("paper"); setQuery(""); }}
                            className="flex cursor-pointer items-center rounded-control px-2 py-1.5 text-fg-muted">
                Run paper…<span className="ml-auto text-small text-fg-faint">{plural(idle.length, "version")} not running</span>
              </Command.Item>
            )}
          </Command.Group>
        )}
        <Command.Group heading={`Versions · ${nodes.length}`}>
          {nodes.map((n) => (
            <Command.Item key={n.id} value={versionValue(n)} onSelect={close(() => select(n.id, { reveal: true }))} className={ITEM}>
              <VersionLine node={n} targets={lineage?.targets ?? null} />
              <span className="min-w-0 flex-1 truncate text-small text-fg-faint">{n.change}</span>
            </Command.Item>
          ))}
        </Command.Group>
        </>)}
      </Command.List>
    </Command.Dialog>
  );
}
