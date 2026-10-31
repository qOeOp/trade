import type { MouseEvent } from "react";
import { Icon } from "../icons/Icon";
import { useAtom } from "../state/atom";
import { activeRun, startDialog, starting, startPaper, stopDialog, stopping, usePaperRuns, usePaperService } from "../state/paper";
import { Tip } from "./Tip";

/** The ▶ after a version, as IntelliJ's run mark beside a line: a click runs it on paper with its last
 *  research replay's contracts, ⌥-click asks which; on a running version it is a red ■, which asks to stop.
 *  It shows while its row or node is hovered (a `group`), and only when the page reaches a paper daemon. */
export function PaperButton({ id }: { id: string }) {
  const service = usePaperService();
  const listing = usePaperRuns();
  const pendingStart = useAtom(starting).has(id);
  const run = activeRun(listing, id);
  const pendingStop = useAtom(stopping).has(run?.paper_id ?? -1) || run?.state === "stopping";
  if (service !== "present") return null;
  const busy = pendingStart || pendingStop;
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (run) stopDialog.set(run);
    else if (e.altKey) startDialog.set(id);
    else void startPaper(id);
  };
  const label = pendingStart ? "Starting paper…" : pendingStop ? "Stopping paper…" : run ? "Stop and seal" : "Run paper";
  return (
    <Tip side="bottom" content={run || busy ? label : <span>Run paper <span className="text-fg-faint">· ⌥-click: Run paper with…</span></span>}>
      <button type="button" aria-label={label} onClick={click} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
              className={`nodrag nopan grid size-5 shrink-0 place-items-center rounded-control transition-[opacity,background-color] hover:bg-hover active:bg-pressed ${busy ? "animate-pulse opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"}`}>
        <Icon name={run ? "stop" : "run"} size={12} tone={run ? "fail" : "meets"} />
      </button>
    </Tip>
  );
}

