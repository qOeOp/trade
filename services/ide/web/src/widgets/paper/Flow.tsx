// The Performance card's profit and loss (Performance.tsx): what moved equity since the start as flows
// (model/flows.ts) on tiles, as Figma's "Sankey chart / Large size / Basic" lays it out, with the closed
// trades' result before fees and the net under it.
import type { ReactNode } from "react";
import { fixed } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import type { Account } from "../../model/account";
import type { Flow as Item, Flows, Kind } from "../../model/flows";
import { pnlClass, type ColorRole } from "../../theme/roles";
import { Sankey, type SankeyNode } from "../Sankey";
import { signed } from "./performanceParts";

// What a tile is.
const NOTE: Record<Kind, (into: boolean) => string> = {
  win: () => "winning trades before fees",
  loss: () => "losing trades before fees",
  funding: (i) => (i ? "Funding received" : "Funding paid"),
  open: (i) => (i ? "Open positions in profit" : "Open positions at a loss"),
  other: () => "Booked without a close in the journal",
  fees: () => "Fees on every fill",
  net: (i) => (i ? "Net loss, drawn from the starting balance" : "Net profit kept"),
};
// A tile's value in the profit or loss colour by its sign, as every amount on the page; its ribbons in
// that colour for the trades and the net, grey for the rest.
const tone = (n: number): ColorRole => (n > 0 ? "pnl-up" : n < 0 ? "pnl-down" : "fg-muted");
const GREY: readonly Kind[] = ["funding", "open", "other", "fees"];

/** A contract by its base asset (BTCUSDT → BTC, 1000PEPEUSDT → PEPE), as tiles name it. */
const base = (symbol: string) => symbol.replace(/(USDT|USDC|USD)$/, "").replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, "") || symbol;
// Binance's own coin logos, by base asset, from the static assets its site loads (no API; an asset
// listed only as futures may have none, and its tile then shows no logo).
const logo = (symbol: string) => `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(base(symbol))}.png`;

// Every tile at one precision: whole units once any flow reaches 100, cents otherwise, and cents for a
// flow under one unit (whole units would read it as 0). A contract's tile carries its coin's logo, the
// rest of the contracts' tile theirs; the others carry none.
const tile = (dp: number) => (f: Item, into: boolean): SankeyNode => {
  const contract = (f.kind === "win" || f.kind === "loss") && !f.of;
  return {
    key: `${into ? "in" : "out"}.${f.key}`, name: contract ? base(f.name) : f.name, note: `${contract ? f.name : f.of?.join(", ") ?? ""} ${NOTE[f.kind](into)}`.trim(),
    label: signed(f.signed, f.value < 1 ? 2 : dp) ?? MISSING, exact: `${signed(f.signed)} USDT`, value: f.value,
    role: GREY.includes(f.kind) ? "fg-faint" : tone(f.signed), tone: tone(f.signed), logos: (contract ? [f.name] : f.of ?? []).map(logo),
  };
};

function Informer({ name, value, children }: { name: string; value: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-small font-semibold text-fg-muted">{name}</div>
      <div className="mt-0.5 truncate text-value tabular-nums text-fg">{value}</div>
      <div className="truncate text-small text-fg-faint">{children}</div>
    </div>
  );
}

/** The run's flows on tiles, and under them its closed trades' result before fees (with the fees' share
 *  of it) and the net (with the return). */
export function PnlFlow({ a, f }: { a: Account; f: Flows }) {
  const dp = [...f.into, ...f.out].some((x) => x.value >= 100) ? 0 : 2, at = tile(dp);
  const all = [...f.into, ...f.out].map((x) => `${x.name} ${signed(x.signed)}`).join(", ");
  const share = a.gross !== null && a.gross > 0 && a.fees > 0 ? `fees took ${Math.round((a.fees / a.gross) * 100)}%` : "closed, before fees";
  const ret = a.ret === null ? MISSING : `${a.ret > 0 ? "↑" : a.ret < 0 ? "↓" : ""}${(Math.abs(a.ret) * 100).toFixed(2)}%`;
  return (
    <div className="flex flex-col gap-3">
      <Sankey into={f.into.map((x) => at(x, true))} out={f.out.map((x) => at(x, false))} label={`Profit and loss since the start: ${all}`} />
      <div className="grid grid-cols-2 gap-3">
        <Informer name="Gross" value={signed(a.gross)}>{share}</Informer>
        <Informer name="Net" value={signed(a.net)}>
          <span className={`font-semibold ${pnlClass(a.ret)}`}>{ret}</span> {fixed(a.equity, 2) ?? MISSING} USDT</Informer>
      </div>
    </div>
  );
}
