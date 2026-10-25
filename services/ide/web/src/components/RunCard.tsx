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

/** One paper run as a card: the version's mark with the run's health dot, its name, return and
 *  drawdown (with the drawdown's share of the target under it), and ⏸, or ↻ to run the same
 *  contracts again once it ended. Right-click for the version's actions. */
export function RunCard({ run, node, selected, target, now, onSelect }: {
  run: PaperRun; node: LineageNode | undefined; selected: boolean; target: number | null | undefined; now: number; onSelect: () => void;
}) {
  const id = run.candidate ?? "";
  const [name, revision] = id.split("@");
  const reading = run.state === "sealed" ? run.seal ?? run : run.live;
  const dd = reading?.max_drawdown ?? null;
  const state = health(run, now);
  const active = ACTIVE.has(run.state);
  const locate = () => { select(id); showLineage(); requestFocus(id); };
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div role="button" tabIndex={0} aria-pressed={selected} onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter") onSelect(); }}
             className={`flex h-12 shrink-0 cursor-default items-center gap-2.5 rounded-card border px-2.5 outline-none transition-colors hover:bg-row-hover ${selected ? "border-focus bg-island" : "border-line-strong"}`}>
          <Tip content={state.text}>
            <span className="relative grid"><RoleMark role={node?.role ?? null} />
              <span className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-2 ring-island ${DOT[state.tone]} ${run.state === "stopping" ? "animate-pulse" : ""}`} />
            </span>
          </Tip>
          <span className="font-mono text-small text-fg">{name}<span className="text-fg-faint">@{revision}</span></span>
          <span className="flex flex-col items-end leading-tight">
            <span className="text-dense">{pct(reading?.total_return)}</span>
            <span className="text-small text-fg-faint">{dd == null ? "-" : pct(-dd)}</span>
            {target ? (
              <span className="mt-0.5 h-0.5 w-10 overflow-hidden rounded-full bg-line" title={`Drawdown ${pct(dd)} of the ${pct(target)} target`}>
                <span className={`block h-full ${dd != null && dd > target ? "bg-misses" : "bg-fg-faint"}`} style={{ width: `${Math.min(100, ((dd ?? 0) / target) * 100)}%` }} />
              </span>
            ) : null}
          </span>
          <Tip content={active ? "Stop paper" : "Run again with the same contracts"}>
            <button type="button" aria-label={active ? "Stop paper" : "Run again"} disabled={run.state === "stopping"}
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
          {active && <ContextMenu.Item className={ITEM} onSelect={() => stopDialog.set(run)}><Icon name="pause" />Stop paper…</ContextMenu.Item>}
          <ContextMenu.Item className={ITEM} onSelect={locate}><Icon name="locate" />Locate version in graph</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => openSource(id)}><Icon name="file.python" />Open source</ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => void copyText(String(run.paper_id))}><Icon name="copy" />Copy run id</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
