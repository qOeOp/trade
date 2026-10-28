import { useId, useState } from "react";
import { v, type ColorRole } from "../theme/roles";
import { useSize } from "../components/hooks/useSize";
import { Tip } from "../components/Tip";

/** A node: its name with its logos (images; none shown when they fail to load), its value as shown
 *  (`label`, in `tone`'s colour) and in full with what it is (`exact`, `note`, on hover), and its size.
 *  Its bar is `role`'s colour, and its ribbons take it at its end. */
export type SankeyNode = {
  key: string; name: string; note: string; label: string; exact: string; value: number; role: ColorRole; tone: ColorRole;
  logos: string[];
};
/** Money moving from a node on the left to one on the right, by their keys. */
export type SankeyLink = { from: string; to: string; value: number };

// As Highcharts draws a sankey: each node a bar BAR wide and its ribbons' height (at least HAIR), on one
// scale so a flow keeps its height from bar to bar, its label beside it on the outer side, SIDE from it.
// A node's slot is GAP from the next and at least ONE tall for its name and value on one row, or TWO
// tall when they stand on two lines: when the row is wider than the labels' width, or the slot is tall
// enough anyway.
const BAR = 3, HAIR = 2, SIDE = 6, GAP = 4, ONE = 16, TWO = 32;
// A label's width: Supply is monospaced, so it is its characters', a name (text-small semibold, Supply
// Medium's 0.62 em) NAME px each and a value (text-small, Regular's 0.6 em) VALUE px each, SEP apart on
// one row; a logo takes 14px, each further one 10px more (they overlap), and 4px before the name; SLACK
// keeps sub-pixel rounding from cutting a name. Labels are as wide as the widest row that fits MOST of
// the chart's width (at least LEAST), or else the widest pair of lines; a name too long for that is cut.
const NAME = 11 * 0.62, VALUE = 11 * 0.6, SEP = 6, SLACK = 2, LEAST = 48, MOST = 0.3;
const logos = (n: number) => (n ? 14 + 10 * (Math.min(n, 3) - 1) + 4 : 0);
const row = (n: SankeyNode) => logos(n.logos.length) + n.name.length * NAME + SEP + n.label.length * VALUE + SLACK;
const lines = (n: SankeyNode) => Math.max(logos(n.logos.length) + n.name.length * NAME, n.label.length * VALUE) + SLACK;
// Figma's ribbon: a band whose edges leave one node level and reach the other level, its height the same
// all along (a stroke would swell and pinch where it is steep), its curves' handles at EASE of the way.
// One thinner than THIN keeps its place on its nodes but is not drawn (a hairline across the chart).
const EASE = [0.2765, 0.7139] as const, THIN = 2;
// A ribbon runs from its left node's colour to its right one's through their mix, at BASE opacity, the
// widest drawn first; under the pointer the lit node's ribbons go to LIT and every other to DIM, and the
// other bars to FADE.
const BASE = 0.35, LIT = 0.7, DIM = 0.08, FADE = 0.4;
// Literal classes, so Tailwind finds them: a value's colour by its tone (the secondary text otherwise).
const TONE: Partial<Record<ColorRole, string>> = { "pnl-up": "text-pnl-up", "pnl-down": "text-pnl-down" };

/** The node's logos, overlapping when there are several (at most three); one shows once its image
 *  loads, and one that fails drops out. Sent with no referrer: Binance's image host refuses another
 *  site's. */
function Logos({ srcs }: { srcs: string[] }) {
  const [failed, setFailed] = useState<string[]>([]), [loaded, setLoaded] = useState<string[]>([]);
  const shown = srcs.filter((s) => !failed.includes(s)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className="flex shrink-0">
      {shown.map((s, i) => (
        <img key={s} src={s} alt="" width={14} height={14} referrerPolicy="no-referrer" onLoad={() => setLoaded((l) => [...l, s])}
             onError={() => setFailed((f) => [...f, s])} className={`size-3.5 rounded-full ${i ? "-ml-1" : ""} ${loaded.includes(s) ? "" : "hidden"}`} />
      ))}
    </span>
  );
}

type Placed = { n: SankeyNode; y: number; h: number };
type Ribbon = { from: SankeyNode; to: SankeyNode; t: number; y0: number; y1: number };
type Least = (n: SankeyNode) => number;

const sum = (nodes: readonly SankeyNode[]) => nodes.reduce((s, n) => s + n.value, 0);
const tall = (nodes: readonly SankeyNode[], k: number, least: Least) =>
  nodes.reduce((s, n) => s + Math.max(least(n), n.value * k), 0) + Math.max(0, nodes.length - 1) * GAP;

/** The px a unit of value takes so that the taller column, each slot at its least, is `height`. */
function scale(columns: readonly SankeyNode[][], height: number, least: Least) {
  let lo = 0, hi = height / Math.max(...columns.map(sum), 1e-9);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (columns.every((c) => tall(c, mid, least) <= height)) lo = mid; else hi = mid; }
  return lo;
}

/** A column's slots stacked from the top. */
function stack(nodes: readonly SankeyNode[], k: number, least: Least): Placed[] {
  let y = 0;
  return nodes.map((n) => { const p = { n, y, h: Math.max(least(n), n.value * k) }; y += p.h + GAP; return p; });
}

/** Both columns on one scale, and each bar's ribbons stacked on it in the order of the nodes at their
 *  other ends (top to bottom, so ribbons from one bar do not cross), centred on its slot. */
function layout(into: SankeyNode[], out: SankeyNode[], given: SankeyLink[], height: number, least: Least) {
  const k = scale([into, out], height, least), left = stack(into, k, least), right = stack(out, k, least);
  const at = new Map([...left, ...right].map((p) => [p.n.key, p]));
  const ribbons: Ribbon[] = given.flatMap((l) => {
    const a = at.get(l.from), b = at.get(l.to);
    return a && b ? [{ from: a.n, to: b.n, t: l.value * k, y0: 0, y1: 0 }] : [];
  });
  const middle = (n: SankeyNode) => { const p = at.get(n.key)!; return p.y + p.h / 2; };
  for (const [side, own] of [[left, true], [right, false]] as const) {
    for (const p of side) {
      const mine = ribbons.filter((r) => (own ? r.from : r.to) === p.n);
      mine.sort((a, b) => middle(own ? a.to : a.from) - middle(own ? b.to : b.from));
      let y = p.y + (p.h - mine.reduce((s, r) => s + r.t, 0)) / 2;
      for (const r of mine) { if (own) r.y0 = y + r.t / 2; else r.y1 = y + r.t / 2; y += r.t; }
    }
  }
  return { k, left, right, ribbons };
}

/** The ribbon from x0 to x1 as a band `t` tall all along. */
function band({ t, y0, y1 }: Ribbon, x0: number, x1: number) {
  const [c0, c1] = EASE.map((e) => x0 + e * (x1 - x0)), h = t / 2;
  return `M${x0},${y0 - h}C${c0},${y0 - h} ${c1},${y1 - h} ${x1},${y1 - h}L${x1},${y1 + h}C${c1},${y1 + h} ${c0},${y0 + h} ${x0},${y0 + h}Z`;
}

/** A node's label beside its bar: its name and value on one row, or on two lines, flush with the bar;
 *  under the pointer or the keyboard its tooltip says what it is, its full value and its share. */
function Label({ p, x, w, two, right, total, dim, onHover }: {
  p: Placed; x: number; w: number; two: boolean; right: boolean; total: number; dim: boolean; onHover: (n: SankeyNode | null) => void;
}) {
  const { n } = p;
  return (
    <Tip content={<div className="flex flex-col gap-0.5"><span>{n.note}</span>
      <span className="tabular-nums text-fg-muted">{n.exact} <span className="text-fg-faint">· {Math.round((n.value / total) * 100)}% of the flow</span></span></div>}>
      <div tabIndex={0} aria-label={`${n.name}: ${n.note} ${n.exact}`} onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onBlur={() => onHover(null)}
           className={`absolute flex outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-focus
                       ${two ? `flex-col justify-center gap-0.5 ${right ? "items-start" : "items-end"}` : `items-center gap-1.5 ${right ? "justify-start" : "justify-end"}`}
                       ${dim ? "opacity-60" : ""}`}
           style={{ left: x, top: p.y, width: w, height: p.h }}>
        <span className="flex min-w-0 max-w-full items-center gap-1">
          <Logos srcs={n.logos} />
          <span className="truncate text-small font-semibold leading-3.5 text-fg-muted">{n.name}</span>
        </span>
        <span className={`shrink-0 text-small leading-3.5 tabular-nums ${TONE[n.tone] ?? "text-fg-muted"}`}>{n.label}</span>
      </div>
    </Tip>
  );
}

/** What flows in (the left nodes) and out (the right nodes), each column adding up to the same total,
 *  joined by `links`. Under the pointer or the keyboard a node and its ribbons light up and the rest
 *  recede. `height` tall, taller only when a column's slots at their least need it. */
export function Sankey({ into, out, links, label, height: wanted = 140 }: {
  into: SankeyNode[]; out: SankeyNode[]; links: SankeyLink[]; label: string; height?: number;
}) {
  const [ref, { width }] = useSize();
  const [lit, setLit] = useState<SankeyNode | null>(null);
  const id = useId();
  const all = [...into, ...out], most = width * MOST;
  const text = Math.min(most, Math.max(LEAST, ...all.map(row).filter((r) => r <= most), ...all.filter((n) => row(n) > most).map(lines)));
  const least: Least = (n) => (row(n) <= text ? ONE : TWO);
  const height = Math.max(wanted, ...[into, out].map((c) => tall(c, 0, least))), total = sum(into);
  const { k, left, right, ribbons } = layout(into, out, links, height, least);
  const x0 = text + SIDE + BAR, x1 = width - x0;
  const labels = (side: Placed[], right: boolean) => side.map((p) => (
    <Label key={p.n.key} p={p} x={right ? width - text : 0} w={text} two={p.h >= TWO || row(p.n) > text} right={right} total={total}
           dim={lit !== null && lit !== p.n} onHover={setLit} />
  ));
  return (
    <div ref={ref} role="group" aria-label={label} className="relative w-full" style={{ height }} onMouseLeave={() => setLit(null)}>
      {width > 0 && <>
        <svg width={width} height={height} className="absolute inset-0 block" aria-hidden>
          {ribbons.filter((r) => r.t >= THIN).sort((a, b) => b.t - a.t).map((r, i) => {
            const g = `${id}${i}`, a = v(r.from.role), b = v(r.to.role);
            return (
              <g key={`${r.from.key}>${r.to.key}`}>
                <linearGradient id={g} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1={0} y2={0}>
                  <stop offset={0} stopColor={a} /><stop offset={0.5} stopColor={`color-mix(in oklab, ${a}, ${b})`} /><stop offset={1} stopColor={b} />
                </linearGradient>
                <path d={band(r, x0, x1)} fill={`url(#${g})`} className="transition-opacity"
                      opacity={lit === null ? BASE : lit === r.from || lit === r.to ? LIT : DIM} />
              </g>
            );
          })}
          {[...left.map((p) => [p, x0 - BAR] as const), ...right.map((p) => [p, x1] as const)].map(([p, x]) => {
            const bar = Math.max(HAIR, p.n.value * k);
            return <rect key={p.n.key} x={x} y={p.y + (p.h - bar) / 2} width={BAR} height={bar} rx={BAR / 2} fill={v(p.n.role)}
                         opacity={lit !== null && lit !== p.n ? FADE : 1} className="transition-opacity" />;
          })}
        </svg>
        {labels(left, false)}{labels(right, true)}
      </>}
    </div>
  );
}
