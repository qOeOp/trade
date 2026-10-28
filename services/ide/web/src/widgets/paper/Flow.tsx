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

// A node's colour (the trades' and the net's tiles filled with it, the rest grey) and what it is.
const LOOK: Record<Kind, { role: ColorRole; solid: boolean; note: (into: boolean) => string }> = {
  win: { role: "pnl-up", solid: true, note: () => "winning trades before fees" },
  loss: { role: "pnl-down", solid: true, note: () => "losing trades before fees" },
  funding: { role: "fg-ghost", solid: false, note: (i) => (i ? "Funding received" : "Funding paid") },
  open: { role: "fg-ghost", solid: false, note: (i) => (i ? "Open positions in profit" : "Open positions at a loss") },
  other: { role: "fg-ghost", solid: false, note: () => "Booked without a close in the journal" },
  fees: { role: "fg-ghost", solid: false, note: () => "Fees on every fill" },
  net: { role: "equity", solid: true, note: (i) => (i ? "Net loss, drawn from the starting balance" : "Net profit kept") },
};

/** A contract by its base asset (BTCUSDT → BTC, 1000PEPEUSDT → PEPE), as tiles name it. */
const base = (symbol: string) => symbol.replace(/(USDT|USDC|USD)$/, "").replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, "") || symbol;
// Binance's own coin logos, by base asset, from the static assets its site loads (no API; an asset
// listed only as futures may have none, and its tile then shows no logo).
const logo = (symbol: string) => `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(base(symbol))}.png`;

// Every node at the flows' precision. A contract's tile carries its coin's logo, the rest of the
// contracts' tile theirs; the others carry none.
const node = (dp: number) => (f: Item, into: boolean): SankeyNode => {
  const look = LOOK[f.kind], contract = (f.kind === "win" || f.kind === "loss") && !f.of;
  return {
    key: f.key, name: contract ? base(f.name) : f.name, note: `${contract ? f.name : f.of?.join(", ") ?? ""} ${look.note(into)}`.trim(),
    label: signed(f.signed, dp) ?? MISSING, exact: `${signed(f.signed)} USDT`, value: f.value,
    role: look.role, solid: look.solid, logos: (contract ? [f.name] : f.of ?? []).map(logo),
  };
};

function Informer({ name, value, children }: { name: string; value: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-small font-semibold text-fg-muted">{name}</div>
      <div className="mt-0.5 truncate text-h1 tabular-nums text-fg">{value}</div>
      <div className="truncate text-small text-fg-faint">{children}</div>
    </div>
  );
}

/** The run's flows on tiles, and under them its closed trades' result before fees (with the fees' share
 *  of it) and the net (with the return). */
export function PnlFlow({ a, f }: { a: Account; f: Flows }) {
  const at = node(f.dp);
  const all = [...f.into, ...f.out].map((x) => `${x.name} ${signed(x.signed)}`).join(", ");
  const share = a.gross !== null && a.gross > 0 && a.fees > 0 ? `fees took ${Math.round((a.fees / a.gross) * 100)}%` : "closed, before fees";
  const ret = a.ret === null ? MISSING : `${a.ret > 0 ? "↑" : a.ret < 0 ? "↓" : ""}${(Math.abs(a.ret) * 100).toFixed(2)}%`;
  return (
    <div className="flex flex-col gap-4">
      <Sankey into={f.into.map((x) => at(x, true))} out={f.out.map((x) => at(x, false))} links={f.links} label={`Profit and loss since the start: ${all}`} />
      <div className="grid grid-cols-2 gap-3">
        <Informer name="Gross" value={signed(a.gross)}>{share}</Informer>
        <Informer name="Net" value={signed(a.net)}>
          <span className={`font-semibold ${pnlClass(a.ret)}`}>{ret}</span> {fixed(a.equity, 2) ?? MISSING} USDT</Informer>
      </div>
    </div>
  );
}
