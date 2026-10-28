import { useId, useState } from "react";
import { v, type ColorRole } from "../theme/roles";
import { useSize } from "../components/hooks/useSize";
import { Tip } from "../components/Tip";

/** A tile: its name with its logos (images; none shown when they fail to load), its value as shown
 *  (`label`) and in full with what it is (`exact`, `note`, on hover), and its size. A `solid` tile is
 *  filled with `role` and glows, any other is grey; its ribbons end in `role`. */
export type SankeyNode = {
  key: string; name: string; note: string; label: string; exact: string; value: number; role: ColorRole; solid: boolean;
  logos: string[];
};
/** Money moving from one node to another, by their keys. */
export type SankeyLink = { from: string; to: string; value: number };

// As Figma's "Sankey chart / Basic" tiles: W wide (a name of seven capitals at the small size), GAP
// apart in a column, as tall as their values with the taller column spanning at least `least` px INSET
// in from the chart's edges; one at least MIN tall shows its value large, a shorter one small, at least
// SHORT tall. A tile's ribbons are their values' height (each at least HAIR px), SPLIT apart, together
// centred on it.
const W = 80, GAP = 4, MIN = 52, SHORT = 34, INSET = 4, HAIR = 3, SPLIT = 1;
// The hub: a BAR px bar its ribbons meet, where no ribbon passing it runs within CLEAR px, its name and value under it (CAPTION px).
const BAR = 6, CLEAR = 8, CAPTION = 30;
// Figma's ribbon: a band whose edges leave one end level and reach the other level, its height the same
// all along (a stroke would swell and pinch where it is steep), its curves' handles at EASE of the way across.
const EASE = [0.2765, 0.7139] as const;
// A ribbon's opacity straight between two filled tiles (BOTH), going from one's colour to the other's,
// or through the hub or by a grey tile (ONE), drawn under the straight ones and grey but for the last
// HOLD of its length at a filled tile. Under the pointer the lit node's ribbons go to LIT times that and
// every other to DIM.
const BOTH = 0.75, ONE = 0.4, HOLD = 0.15, LIT = 1.6, DIM = 0.25, GREY: ColorRole = "fg-ghost";
// Literal classes, so Tailwind finds them: a solid tile's fill by its colour, the net's with a glow.
const SOLID: Partial<Record<ColorRole, string>> = { "pnl-up": "bg-pnl-up", "pnl-down": "bg-pnl-down", equity: "bg-equity-fill shadow-glow shadow-equity/45" };

/** The tile's logos, each on a white chip as Figma's tiles carry their icon, overlapping when there are
 *  several (at most three); a chip shows once its image loads, and one that fails drops out. Sent with no
 *  referrer: Binance's image host refuses another site's. */
function Logos({ srcs }: { srcs: string[] }) {
  const [failed, setFailed] = useState<string[]>([]), [loaded, setLoaded] = useState<string[]>([]);
  const shown = srcs.filter((s) => !failed.includes(s)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className="flex shrink-0">
      {shown.map((s, i) => (
        <span key={s} className={`grid size-3.5 place-items-center rounded-full bg-primary-fg ${i ? "-ml-1" : ""} ${loaded.includes(s) ? "" : "hidden"}`}>
          <img src={s} alt="" width={10} height={10} referrerPolicy="no-referrer" onLoad={() => setLoaded((l) => [...l, s])}
               onError={() => setFailed((f) => [...f, s])} className="size-2.5 rounded-full" />
        </span>
      ))}
    </span>
  );
}

type Placed = { n: SankeyNode; x: number; y: number; h: number };
type Ribbon = { from: SankeyNode; to: SankeyNode; t: number; x0: number; y0: number; x1: number; y1: number };

const sum = (nodes: readonly SankeyNode[]) => nodes.reduce((s, n) => s + n.value, 0);
const tall = (nodes: readonly SankeyNode[], k: number) => nodes.reduce((s, n) => s + Math.max(SHORT, n.value * k), 0) + Math.max(0, nodes.length - 1) * GAP;
const bundle = (rs: readonly Ribbon[]) => rs.reduce((s, r) => s + r.t, 0) + Math.max(0, rs.length - 1) * SPLIT;
/** The ribbon's curve at `s` of the way along. */
function at({ x0, y0, x1, y1 }: Ribbon, s: number) {
  const [c0, c1] = EASE.map((e) => x0 + e * (x1 - x0)), u = 1 - s;
  return { x: u * u * u * x0 + 3 * u * u * s * c0! + 3 * u * s * s * c1! + s * s * s * x1, y: u * u * u * y0 + 3 * u * u * s * y0 + 3 * u * s * s * y1 + s * s * s * y1 };
}
const band = ({ x0, y0, x1, y1, t }: Ribbon) => {
  const [c0, c1] = EASE.map((e) => x0 + e * (x1 - x0)), h = t / 2;
  return `M${x0},${y0 - h}C${c0},${y0 - h} ${c1},${y1 - h} ${x1},${y1 - h}L${x1},${y1 + h}C${c1},${y1 + h} ${c0},${y0 + h} ${x0},${y0 + h}Z`;
};
/** A column's tiles stacked at `x`, centred on `height` below INSET. */
function stack(nodes: readonly SankeyNode[], x: number, k: number, height: number): Placed[] {
  let y = INSET + Math.max(0, (height - tall(nodes, k)) / 2);
  return nodes.map((n) => { const h = Math.max(SHORT, n.value * k), p = { n, x, y, h }; y += h + GAP; return p; });
}

/** Where the ribbons run: both columns' tiles at `k` px a unit (the taller column `least` px at its
 *  values, taller where tiles stand at SHORT), each tile's ribbons stacked on it (those straight to the
 *  other column first, by where they go), and the hub at the height nearest its ribbons' tiles where
 *  none of the straight ribbons pass it, its ribbons stacked on it in their tiles' order. */
function layout(into: SankeyNode[], out: SankeyNode[], hub: SankeyNode | null, given: SankeyLink[], width: number, least: number) {
  const k = least / Math.max(sum(into), sum(out), 1e-9), inner = Math.max(least, tall(into, k), tall(out, k));
  const left = stack(into, INSET, k, inner), right = stack(out, width - W - INSET, k, inner), tiles = new Map([...left, ...right].map((p) => [p.n.key, p]));
  const x0 = INSET + W, x1 = width - INSET - W, xm = width / 2;
  const ribbons = given.flatMap((l) => {
    const from = l.from === hub?.key ? hub : tiles.get(l.from)?.n, to = l.to === hub?.key ? hub : tiles.get(l.to)?.n;
    return from && to ? [{ from, to, t: Math.max(HAIR, l.value * k), x0: from === hub ? xm + BAR / 2 : x0, y0: 0, x1: to === hub ? xm - BAR / 2 : x1, y1: 0 }] : [];
  });
  const middle = (p: Placed) => p.y + p.h / 2;
  for (const p of [...left, ...right]) {
    const own = p.x < xm, mine = ribbons.filter((r) => (own ? r.from : r.to) === p.n);
    const other = (r: Ribbon) => { const q = tiles.get((own ? r.to : r.from).key); return q ? middle(q) : Infinity; };
    mine.sort((a, b) => other(a) - other(b));
    let y = p.y + (p.h - bundle(mine)) / 2;
    for (const r of mine) { if (own) r.y0 = y + r.t / 2; else r.y1 = y + r.t / 2; y += r.t + SPLIT; }
  }
  let height = inner + 2 * INSET, bar: { y: number; h: number } | null = null;
  const through = ribbons.filter((r) => r.from === hub || r.to === hub);
  if (hub && through.length) {
    const ins = through.filter((r) => r.to === hub).sort((a, b) => a.y0 - b.y0), outs = through.filter((r) => r.from === hub).sort((a, b) => a.y1 - b.y1);
    const h = Math.max(bundle(ins), bundle(outs)), ends = [...ins.map((r) => [r.y0, r.t]), ...outs.map((r) => [r.y1, r.t])];
    const ideal = ends.reduce((s, [y, t]) => s + y! * t!, 0) / ends.reduce((s, [, t]) => s + t!, 0) - h / 2;
    // What the straight ribbons cover where the hub stands, and the free height nearest the ideal.
    const taken = ribbons.filter((r) => !through.includes(r)).flatMap((r) => {
      const ys = Array.from({ length: 65 }, (_, i) => at(r, i / 64)).filter((p) => Math.abs(p.x - xm) <= BAR / 2 + CLEAR).map((p) => p.y);
      return ys.length ? [[Math.min(...ys) - r.t / 2 - CLEAR, Math.max(...ys) + r.t / 2 + CLEAR] as const] : [];
    });
    const free = (y: number) => y >= INSET && taken.every(([a, b]) => y + h <= a || y >= b);
    const top = [ideal, ...taken.flatMap(([a, b]) => [a - h, b])].filter(free).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0]
      ?? Math.max(INSET, ...taken.map(([, b]) => b));
    bar = { y: top, h };
    let y = top + (h - bundle(ins)) / 2;
    for (const r of ins) { r.y1 = y + r.t / 2; y += r.t + SPLIT; }
    y = top + (h - bundle(outs)) / 2;
    for (const r of outs) { r.y0 = y + r.t / 2; y += r.t + SPLIT; }
    height = Math.max(height, top + h + CAPTION + INSET);
  }
  return { left, right, ribbons, bar, xm, height };
}

const tip = (n: SankeyNode, total: number) => (
  <div className="flex flex-col gap-0.5"><span>{n.note}</span>
    <span className="tabular-nums text-fg-muted">{n.exact} <span className="text-fg-faint">· {Math.round((n.value / total) * 100)}% of the flow</span></span></div>
);

function Tile({ p, total, dim, onHover }: { p: Placed; total: number; dim: boolean; onHover: (n: SankeyNode | null) => void }) {
  const { n } = p, solid = n.solid ? SOLID[n.role] : undefined, short = p.h < MIN;
  return (
    <Tip content={tip(n, total)}>
      <div tabIndex={0} aria-label={`${n.name}: ${n.note} ${n.exact}`} onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onBlur={() => onHover(null)}
           className={`absolute flex flex-col justify-between overflow-hidden rounded-popup outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-focus
                       ${short ? "px-1.5 py-1" : "p-1.5"} ${solid ? `${solid} text-primary-fg` : "bg-pressed text-fg"} ${dim ? "opacity-60" : ""}`}
           style={{ left: p.x, top: p.y, width: W, height: p.h }}>
        <span className="flex min-w-0 items-center gap-1">
          <Logos srcs={n.logos} />
          <span className="truncate text-small font-semibold uppercase leading-none tracking-wider">{n.name}</span>
        </span>
        <span className={`truncate leading-none tabular-nums ${short ? "text-dense font-semibold" : "text-h2 tracking-tighter"}`}>{n.label}</span>
      </div>
    </Tip>
  );
}

/** The hub as a grey bar its ribbons meet, its name and value under it. */
function Hub({ n, x, y, h, total, dim, onHover }: { n: SankeyNode; x: number; y: number; h: number; total: number; dim: boolean; onHover: (n: SankeyNode | null) => void }) {
  return (
    <>
      <Tip content={tip(n, total)}>
        <div tabIndex={0} aria-label={`${n.name}: ${n.note} ${n.exact}`} onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onBlur={() => onHover(null)}
             className={`absolute grid justify-center rounded-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-focus ${dim ? "opacity-60" : ""}`}
             style={{ left: x - BAR / 2 - CLEAR, top: y, width: BAR + 2 * CLEAR, height: h }}>
          <i className="block h-full rounded-full bg-fg-faint" style={{ width: BAR }} />
        </div>
      </Tip>
      <div className={`pointer-events-none absolute flex -translate-x-1/2 flex-col items-center rounded-sm bg-island-alt px-1 leading-none transition-opacity ${dim ? "opacity-60" : ""}`}
           style={{ left: x, top: y + h + 4 }}>
        <span className="text-small font-semibold uppercase tracking-wider text-fg-muted">{n.name}</span>
        <span className="mt-1 text-small tabular-nums text-fg">{n.label}</span>
      </div>
    </>
  );
}

/** What flows in (the left tiles) and out (the right tiles), each column adding up to the same total,
 *  joined by `links`: straight across, or through the `hub` between the columns. As the tiles of Figma's
 *  "Sankey chart / Basic" widgets draw it. Under the pointer or the keyboard a node and its ribbons
 *  light up and the rest recede; its tooltip says what it is, its full value and its share of the flow.
 *  At least `least` tall, taller when tiles at their least height or the hub need it. */
export function Sankey({ into, out, hub, links, label, least = 240 }: {
  into: SankeyNode[]; out: SankeyNode[]; hub: SankeyNode | null; links: SankeyLink[]; label: string; least?: number;
}) {
  const [ref, { width }] = useSize();
  const [lit, setLit] = useState<SankeyNode | null>(null);
  const id = useId();
  const total = sum(into);
  const { left, right, ribbons, bar, xm, height } = layout(into, out, hub, links, width, least);
  return (
    <div ref={ref} role="group" aria-label={label} className="relative w-full" style={{ height }} onMouseLeave={() => setLit(null)}>
      {width > 0 && <>
        <svg width={width} height={height} className="absolute inset-0 block" aria-hidden>
          {[...ribbons].sort((a, b) => Number(a.from.solid && a.to.solid) - Number(b.from.solid && b.to.solid)).map((r, i) => {
            const both = r.from.solid && r.to.solid, on = lit === null ? 1 : lit === r.from || lit === r.to ? LIT : DIM, g = `${id}${i}`;
            const stops: [number, ColorRole][] = [[0, r.from.solid ? r.from.role : GREY], [1, r.to.solid ? r.to.role : GREY]];
            if (!both && r.from.solid) stops.splice(1, 0, [HOLD, GREY]);
            else if (!both && r.to.solid) stops.splice(1, 0, [1 - HOLD, GREY]);
            return (
              <g key={g}>
                <linearGradient id={g} gradientUnits="userSpaceOnUse" x1={r.x0} x2={r.x1} y1={0} y2={0}>
                  {stops.map(([o, c]) => <stop key={o} offset={o} stopColor={v(c)} />)}
                </linearGradient>
                <path d={band(r)} fill={`url(#${g})`} opacity={Math.min(1, (both ? BOTH : ONE) * on)} />
              </g>
            );
          })}
        </svg>
        {[...left, ...right].map((p) => <Tile key={p.n.key} p={p} total={total} onHover={setLit} dim={lit !== null && lit !== p.n} />)}
        {hub && bar && <Hub n={hub} x={xm} y={bar.y} h={bar.h} total={total} onHover={setLit} dim={lit !== null && lit !== hub} />}
      </>}
    </div>
  );
}
