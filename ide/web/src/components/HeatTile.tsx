import type { CSSProperties, ReactNode } from "react";
import { change, funding, price, usd } from "../lib/format";
import { fillRole, inkRoles, step } from "../model/heat";
import { capOf, type Coin, type Color, type Node } from "../model/market";
import { corners, tileStyle } from "../model/ripple/layout";
import type { Tile } from "../model/ripple/split";
import { v } from "../theme/roles";

export type TileFrame = { width: number; height: number; maxArea: number; minArea: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const shown = (x: number | null, color: Color, digits = 2) => (color === "change24h" ? change(x, digits) : funding(x));
const metric = (c: Coin, color: Color) => (color === "change24h" ? c.change24h : c.funding);
/** A group's funding weighted by market cap, the rate its money pays. */
function capFunding(coins: readonly Coin[]): number | null {
  let sum = 0, weight = 0;
  for (const c of coins) if (c.funding !== null && capOf(c) > 0) { sum += c.funding * capOf(c); weight += capOf(c); }
  return weight ? sum / weight : null;
}

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="grid grid-cols-[auto_auto] justify-between gap-2.5"><span className="opacity-85">{label}</span><span>{value}</span></div>
);

/** One coin's rows: its money, and the other colour metric than the tiles show. */
function coinRows(c: Coin, color: Color, rows: number) {
  const all: [string, string][] = [["Market cap", usd(c.marketCap)], ["FDV", usd(c.fdv)], ["Volume 24h", usd(c.volume24h)],
    color === "change24h" ? ["Funding", funding(c.funding)] : ["Change 24h", change(c.change24h)]];
  return all.slice(0, Math.min(rows, 4)).map(([l, x]) => <Stat key={l} label={l} value={x} />);
}

/** A group's leaders by market cap, each with its share of the group as a bar (a figure under 3%). */
function leaders(n: Node, color: Color, count: number) {
  return [...n.coins].sort((a, b) => capOf(b) - capOf(a)).slice(0, count).map((c) => {
    const share = n.cap > 0 ? (capOf(c) / n.cap) * 100 : 0;
    return (
      <div key={c.symbol} className="grid grid-cols-[minmax(2.75rem,4.5rem)_minmax(0,1fr)_auto] items-center gap-2.5 leading-tight">
        <span className="truncate">{c.base}</span>
        {share >= 3 ? <i className="block h-1 rounded-full bg-current opacity-40" style={{ width: `${share.toFixed(1)}%` }} />
          : <span className="text-small opacity-75">{share < 1 ? "<1" : share.toFixed(0)}%</span>}
        <span>{shown(metric(c, color), color, 1)}</span>
      </div>
    );
  });
}

/** A group's totals under its leaders, when the tile has room for both. */
const groupStats = (n: Node) => (
  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-current/15 pt-3">
    {([["Volume 24h", usd(n.coins.reduce((a, c) => a + c.volume24h, 0))], ["Funding", funding(capFunding(n.coins))],
       ["Coins", `${n.coins.length}`], ["FDV", usd(n.coins.reduce((a, c) => a + (c.fdv ?? capOf(c)), 0))]] as const).map(([l, x]) => (
      <div key={l} className="flex flex-col gap-px"><span className="text-small opacity-85">{l}</span><b className="font-medium">{x}</b></div>
    ))}
  </div>
);

/** One tile of the Market heatmap, styled by its size as vibe-trading's are: the name and the colour
 *  metric's badge on top; a coin's price and money, or a group's leaders and totals, as room allows; a
 *  group's market cap, median and up and down counts at the foot. A group opens a level, a coin selects. */
export function HeatTile({ tile, frame, color, hovered, selected, onPick }: {
  tile: Tile<Node>; frame: TileFrame; color: Color; hovered: boolean; selected: boolean; onPick: () => void;
}) {
  const n = tile.data, { width: w, height: h } = tile, k = step(n.value, color);
  const style0 = tileStyle(w, h, n.name, frame.maxArea, frame.minArea), [ink, badge] = inkRoles(k);
  // "+N more" is a folder, not a coin: its name never outgrows a mid-sized tile's.
  const st = n.kind === "more" ? { ...style0, nameSize: Math.min(style0.nameSize, 17) } : style0;
  const valueSize = clamp(st.nameSize * 0.55, 10, 13), lineSize = clamp(valueSize, 10.5, 12.5);
  const rows = Math.floor((h - 2 * st.pad - st.nameSize * 1.3 - 44) / 19);
  let mid: ReactNode = null, sub: ReactNode = null, foot: ReactNode = null;
  if (n.kind === "coin") {
    const c = n.coins[0]!;
    if (rows >= 2 && w > 150) mid = coinRows(c, color, rows);
    if (h > 70 && w > 90) sub = <div className="mt-0.5 truncate opacity-85">{price(c.price)}{!mid && ` · ${usd(n.cap)}`}{w > 200 && ` · ${c.name}`}</div>;
  } else {
    if (rows >= 1 && w > 130) {
      const withStats = w > 240 && (rows >= 10 || rows - Math.min(n.coins.length, 8) >= 3);
      mid = <>{leaders(n, color, Math.min(withStats ? rows - 4 : rows, 8))}{withStats && groupStats(n)}</>;
    }
    if (w > 150 && h > 80) foot = `${usd(n.cap, 1)}${w > 220 ? ` · median ${shown(n.median, color, 1)}` : ""} · ${n.up}↑ ${n.down}↓`;
    else if (w > 90 && h > 60) foot = usd(n.cap, 1);
  }
  const style: CSSProperties = {
    left: tile.x, top: tile.y, width: w, height: h, borderRadius: corners(tile.x, tile.y, w, h, frame.width, frame.height),
    background: v(fillRole(k)), color: v(ink), borderColor: v("heat-edge"), padding: st.pad, fontSize: valueSize,
  };
  const ring = selected ? "z-10 ring-2 ring-inset ring-fg" : hovered ? "z-10 shadow-popup ring-1 ring-inset ring-fg/50" : "";
  return (
    <button type="button" aria-label={`${n.name} ${shown(n.value, color)}`} onClick={onPick} style={style}
            className={`absolute flex flex-col overflow-hidden border text-left transition-[left,top,width,height] duration-300 ease-out ${ring}`}>
      <div className={`flex min-w-0 justify-between gap-2 ${st.vertical ? "flex-col items-start" : "items-baseline"}`}>
        <span className="min-w-0 truncate leading-tight" style={{ fontSize: st.nameSize, fontWeight: st.nameWeight }}>
          {n.name}{n.kind !== "coin" && w > 90 && <span className="ml-1 font-normal opacity-60">›</span>}
        </span>
        <span className="ml-auto shrink-0 whitespace-nowrap rounded-card font-semibold leading-snug"
              style={{ background: v(badge), fontSize: Math.max(11, st.nameSize * 0.62), padding: `${st.badgePad[0]}px ${st.badgePad[1]}px` }}>
          {shown(n.value, color, w > 80 ? 2 : 1)}
        </span>
      </div>
      {sub}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden pt-2.5 pb-1.5" style={{ fontSize: lineSize }}>{mid}</div>
      {foot && <div className="mt-auto whitespace-nowrap opacity-85">{foot}</div>}
    </button>
  );
}
