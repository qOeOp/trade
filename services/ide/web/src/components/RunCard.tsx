import { ContextMenu } from "radix-ui";
import type { LineageNode } from "../model/types";
import type { PaperRun } from "../lib/paperApi";
import { pct } from "../lib/format";
import { copyText } from "../lib/clipboard";
import { Icon } from "../icons/Icon";
import { RoleMark } from "../icons/marks";
import { openSource, showLineage } from "../state/editors";
import { requestFocus } from "../state/linking";
import { ACTIVE, startPaper, stopDialog } from "../state/paper";
import { select } from "../state/selection";
import type { DataRole } from "../theme/roles";
import { ReadingBadge } from "./ReadingBadge";
import { Tip } from "./Tip";

const LAG_MS = 2 * 60_000;  // a one-minute bar this late makes the run's dot yellow
const DOT: Record<DataRole, string> = { recommended: "bg-recommended", meets: "bg-meets", misses: "bg-misses", fail: "bg-fail", masked: "bg-masked" };
const ITEM = "flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-highlighted:bg-selection";

/** A run's health as its dot's colour and words: running, data late, stopping, failed or ended. */
export function health(run: PaperRun, now: number): { tone: DataRole; text: string } {
  const lastBar = run.live?.last_bar_ns != null ? run.live.last_bar_ns / 1e6 : null;
  if (run.state === "running") {
    if (lastBar !== null && now - lastBar > LAG_MS) return { tone: "misses", text: `No bar for ${Math.round((now - lastBar) / 60_000)} min` };
    return { tone: "meets", text: lastBar === null ? "Running, waiting for the first bar" : "Running" };
  }
  if (run.state === "stopping") return { tone: "misses", text: "Stopping" };
  if (run.state !== "sealed") return { tone: "fail", text: "Ended, not sealed yet" };
  return run.status === "invalid" ? { tone: "fail", text: `Invalid: ${(run.reasons ?? []).join(", ")}` } : { tone: "masked", text: "Complete" };
}

/** One paper run as a card, one line like a version row: the version's mark with the run's health dot,
 *  its name, its readings as the graph's badge (return since the start · max drawdown, marked past the
 *  line's drawdown target), a warning when the run lost bars or protection, and ⏸ (stop and seal), or ↻ to
 *  run the same contracts again once it ended. Right-click for the version's actions. */
export function RunCard({ run, node, selected, target, now, onSelect }: {
  run: PaperRun; node: LineageNode | undefined; selected: boolean; target: number | null | undefined; now: number; onSelect: () => void;
}) {
  const id = run.candidate ?? "";
  const [name, revision] = id.split("@");
  const reading = run.state === "sealed" ? run.seal ?? run : run.live;
  const state = health(run, now);
  const active = ACTIVE.has(run.state);
  const gaps = (run.live?.protection_gaps ?? 0) + (run.live?.missing_bars ?? 0);
  const locate = () => { select(id); showLineage(); requestFocus(id); };
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div role="button" tabIndex={0} aria-pressed={selected} data-selected={selected ? "" : undefined} onClick={onSelect}
             onKeyDown={(e) => { if (e.key === "Enter") onSelect(); }}
             className={`flex h-8 shrink-0 cursor-default items-center gap-2 rounded-control border pl-2 pr-1 outline-none transition-colors hover:bg-row-hover ${selected ? "border-transparent" : "border-line"}`}>
          <Tip content={state.text}>
            <span className="relative grid"><RoleMark role={node?.role ?? null} />
              <span className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-2 ring-island ${DOT[state.tone]} ${run.state === "stopping" ? "animate-pulse" : ""}`} />
            </span>
          </Tip>
          <span className="font-mono text-small text-fg">{name}<span className="text-fg-faint">@{revision}</span></span>
          <Tip content={`Return since the start · max drawdown${target ? ` (target ${pct(target)})` : ""}`}>
            <span className="inline-flex"><ReadingBadge reading={{ annual_return: reading?.total_return ?? null, max_drawdown: reading?.max_drawdown ?? null }}
                                                         targets={{ max_drawdown: target ?? null }} status="Waiting" /></span>
          </Tip>
          {gaps > 0 && <Tip content={`${run.live?.missing_bars ?? 0} missing bars · ${run.live?.protection_gaps ?? 0} protection gaps`}>
            <span className="inline-flex items-center gap-0.5 text-small text-misses"><Icon name="warning" size={12} />{gaps}</span>
          </Tip>}
          <Tip content={active ? "Stop and seal" : "Run again with the same contracts"}>
            <button type="button" aria-label={active ? "Stop and seal" : "Run again"} disabled={run.state === "stopping"}
                    onClick={(e) => { e.stopPropagation(); if (active) stopDialog.set(run); else void startPaper(id, { symbols: run.symbols }); }}
                    className="grid size-6 place-items-center rounded-control text-icon transition-colors hover:bg-hover active:bg-pressed disabled:opacity-40">
              <Icon name={active ? "pause" : "retry"} size={12} />
            </button>
          </Tip>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-52 rounded-popup border border-popup-border bg-popup p-1 text-dense shadow-popup">
          <ContextMenu.Label className="truncate px-2 pb-1 pt-1.5 font-mono text-small text-fg-faint">{id} · run {run.paper_id}</ContextMenu.Label>
          {active && <ContextMenu.Item className={ITEM} onSelect={() => stopDialog.set(run)}><Icon name="pause" />Stop and seal…</ContextMenu.Item>}
          <ContextMenu.Item className={ITEM} onSelect={locate}><Icon name="locate" />Locate version in graph</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => openSource(id)}><Icon name="file.python" />Open source</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => void copyText(String(run.paper_id))}><Icon name="copy" />Copy run id</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
