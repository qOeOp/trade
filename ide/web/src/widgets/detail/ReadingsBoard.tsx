import type { ReactNode } from "react";
import { Tip } from "../../components/Tip";

const STEPS = 5;  // the drawdown track is graduated in fifths of the limit

/** One target: its reading, what the target asks, the verdict and what follows from it. */
export type Tile = { name: string; tip?: string; value: ReactNode; context?: string; track?: { used: number; now: number };
              verdict?: boolean | null; says?: readonly [string, string]; notes?: readonly string[]; stale?: boolean };
export type Cell = { name: string; value: ReactNode; stale?: boolean };

/** The deepest drawdown so far (quiet) and the drawdown now (in the text colour) along a track to the
 *  limit, graduated in fifths, its end marked in the missed-target colour. */
function Track({ used, now }: { used: number; now: number }) {
  return (
    <div className="relative h-1.5">
      <div className="absolute inset-0 flex gap-px overflow-hidden rounded-full">
        {Array.from({ length: STEPS }, (_, i) => {
          const fill = (part: number) => `${Math.max(0, Math.min(1, part * STEPS - i)) * 100}%`;
          return (
            <span key={i} className="relative flex-1 bg-grid">
              <span className="absolute inset-y-0 left-0 bg-fg-muted/45" style={{ width: fill(used) }} />
              <span className="absolute inset-y-0 left-0 bg-fg" style={{ width: fill(now) }} />
            </span>
          );
        })}
      </div>
      <span className="absolute -top-0.75 right-0 h-3 w-0.5 rounded-full bg-misses" />
    </div>
  );
}

/** A target's verdict word in its colour, then its notes. */
function notesOf(t: Tile): ReactNode[] {
  const said = t.says && t.verdict != null ? t.says[t.verdict ? 0 : 1] : null;
  return [...said ? [<span className={t.verdict ? "text-meets" : "text-misses"}>{said}</span>] : [], ...t.notes ?? []];
}

/** Narrow (the inspector, the phone card): the targets as three tiles, each read top to bottom, over the
 *  other readings three to a row, each name above its value, all on the same three columns. */
function Tiles({ tiles, cells }: { tiles: readonly Tile[]; cells: readonly Cell[] }) {
  return (
    <>
      <div className="grid grid-cols-3 items-start gap-x-3 border-t border-line-strong py-2">
        {tiles.map((t) => (
          <div key={t.name} className={`flex min-w-0 flex-col ${t.stale ? "invisible" : ""}`}>
            <Tip content={t.tip}><span className="truncate text-fg-muted">{t.name}</span></Tip>
            <span className="mt-0.5 whitespace-nowrap text-value tabular-nums">{t.value}</span>
            {t.context && <span className="truncate text-small text-fg-faint">{t.context}</span>}
            {/* the track's row is kept in every tile, so the verdicts under it stand level */}
            <div className="mt-1.5 mb-0.5 h-1.5">{t.track && <Track {...t.track} />}</div>
            {notesOf(t).length > 0 && <p className="mt-1 text-small text-fg-faint">{notesOf(t).map((note, i) => <span key={i} className="block">{note}</span>)}</p>}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line-strong pt-2 pb-3">
        {cells.map((c) => (
          <div key={c.name} className={`min-w-0 ${c.stale ? "invisible" : ""}`}>
            <div className="truncate text-small text-fg-faint">{c.name}</div>
            <div className="mt-0.5 truncate text-ui tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Wide: each target a line, its name at the left and its value with what the target asks at the right
 *  edge, the verdict and its notes on one line under it; the other readings in cells divided by rules,
 *  three to a row, name at the left and value at the cell's right edge. Every cell has its rule on the
 *  left; the grid is pulled out by a cell's padding and the rule and clipped, so each row's first cell
 *  starts at the card's edge and its last value ends at it, where the targets' values end. */
function Lines({ tiles, cells }: { tiles: readonly Tile[]; cells: readonly Cell[] }) {
  return (
    <>
      {/* One grid for every line: the values end on one edge and what the targets ask on the card's. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] divide-y divide-line border-t border-line-strong">
        {tiles.map((t) => (
          <div key={t.name} className={`col-span-full grid grid-cols-subgrid items-baseline py-1.5 ${t.stale ? "invisible" : ""}`}>
            <Tip content={t.tip}><span className="truncate text-fg-muted">{t.name}</span></Tip>
            <span className="pl-3 text-right whitespace-nowrap tabular-nums">{t.value}</span>
            <span className="pl-1.5 text-right whitespace-nowrap text-fg-faint">{t.context}</span>
            {t.track && <div className="col-span-full mt-1.5 mb-0.5"><Track {...t.track} /></div>}
            {notesOf(t).length > 0 && <p className="col-span-full mt-1 text-small text-fg-faint">{notesOf(t).map((note, i) => <span key={i}>{i > 0 && " · "}{note}</span>)}</p>}
          </div>
        ))}
      </div>
      <div className="overflow-hidden border-t border-line-strong pb-1.5"><div className="-mx-3"><div className="-ml-px grid grid-cols-3">
        {cells.map((c) => (
          <div key={c.name} className={`flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-l border-line-strong px-3 py-1.5 ${c.stale ? "invisible" : ""}`}>
            <span className="shrink-0 text-fg-muted">{c.name}</span>
            <span className="ml-auto whitespace-nowrap tabular-nums">{c.value}</span>
          </div>
        ))}
      </div></div></div>
    </>
  );
}

/** The card's readings as tiles, or as lines once the card is 42rem wide (a widened inspector). Each form
 *  keeps its own sizes; the width only chooses which one stands. */
export function Board({ tiles, cells }: { tiles: readonly Tile[]; cells: readonly Cell[] }) {
  return (
    <div data-readings className="@container">
      <div className="@2xl:hidden"><Tiles tiles={tiles} cells={cells} /></div>
      <div className="hidden @2xl:block"><Lines tiles={tiles} cells={cells} /></div>
    </div>
  );
}
