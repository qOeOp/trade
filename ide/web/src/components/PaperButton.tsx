import type { MouseEvent } from "react";
import { Icon } from "../icons/Icon";
import { useAtom } from "../state/atom";
import { activeRun, full, startDialog, starting, startPaper, stopDialog, stopping, usePaperRuns, usePaperService } from "../state/paper";
import { usePhone } from "../state/phone";
import { useNow } from "./hooks/useNow";
import { waited } from "./PaperStartStatus";
import { Tip } from "./Tip";

/** The ▶ after a version, as IntelliJ's run mark beside a line: a click runs it on paper with its last
 *  research replay's contracts, ⌥-click asks which; on a running version it is a red ■, which asks to stop.
 *  It shows while its row or node is hovered (a `group`), and only when the page reaches a paper daemon. */
export function PaperButton({ id }: { id: string }) {
  const service = usePaperService(), phone = usePhone();
  const listing = usePaperRuns();
  const since = useAtom(starting).get(id), pendingStart = since !== undefined;
  const run = activeRun(listing, id), limit = full(listing);
  const pendingStop = useAtom(stopping).has(run?.paper_id ?? -1) || run?.state === "stopping";
  if (service !== "present" || phone) return null;
  const busy = pendingStart || pendingStop;
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (run) stopDialog.set(run);
    else if (e.altKey) startDialog.set(id);
    else void startPaper(id);
  };
  const label = pendingStart ? "Starting paper…" : pendingStop ? "Stopping paper…" : run ? "Stop and seal" : "Run paper";
  const tip = pendingStart ? <Waiting since={since} />
    : run || busy ? label : limit ? `${limit}; stop one first` : <span>Run paper <span className="text-fg-faint">· ⌥-click: Run paper with…</span></span>;
  return (
    <Tip side="bottom" content={tip}>
      <button type="button" aria-label={label} aria-busy={busy} aria-disabled={busy} onClick={click} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
              className={`nodrag nopan grid size-5 shrink-0 place-items-center rounded-control transition-[opacity,background-color] ${busy ? "cursor-progress opacity-100" : "opacity-0 hover:bg-hover active:bg-pressed focus-visible:opacity-100 group-hover:opacity-100"} ${pendingStop ? "animate-pulse" : ""}`}>
        {pendingStart ? <Spinner /> : <Icon name={run ? "stop" : "run"} size={12} tone={run ? "fail" : limit ? undefined : "meets"} />}
      </button>
    </Tip>
  );
}


/** A turning ring, a still clock under reduced motion: the ▶ while its start is in flight. */
function Spinner({ size = 12 }: { size?: 12 | 16 }) {
  return <><Icon name="loading" size={size} className="text-icon motion-safe:animate-spin motion-reduce:hidden" />
    <Icon name="history" size={size} className="text-icon motion-safe:hidden" /></>;
}

/** The tip of a ▶ whose start is in flight: how long it has waited and what the server is doing. */
function Waiting({ since }: { since: number }) {
  const now = useNow(1000);
  return <span>Starting paper · {waited(now - since)} <span className="text-fg-faint">· preparing image and containers; the Runs page opens when it is accepted</span></span>;
}
