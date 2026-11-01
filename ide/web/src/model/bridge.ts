// What moved a paper run's equity since the start as a bridge, for the Profit and loss card: its closed
// trades before fees (each contract's winning trades, then each one's losing trades, then whatever the
// closed trades leave of the account's gross) land on the gross; funding, open positions and fees then
// land on the net. Contracts are in By contract's order (best after fees first).
import { amount, symbolOf, type JournalLine } from "../lib/paperApi";
import type { Account } from "./account";
import { eventMs } from "./paper";

/** What a step is: a contract's winning or losing trades, whatever the closed trades leave of the
 *  account's gross, funding, open positions or fees. */
export type Kind = "win" | "loss" | "other" | "funding" | "open" | "fees";
/** A step: its name (a contract's symbol) and what it moves equity by (a loss negative). */
export type Step = { key: string; name: string; kind: Kind; value: number };
/** The steps to the gross (`trades`) and from it to the net (`costs`), top to bottom, the two totals, and
 *  the decimals every amount is shown at (whole units once any reaches 100). */
export type Bridge = { trades: Step[]; gross: number; costs: Step[]; net: number; dp: 0 | 2 };

const CENT = 0.005;  // smaller steps are left out, and at whole units any that would show as 0

/** A closed trade's contract, its result after fees and before them. */
export type Gross = { symbol: string; pnl: number; gross: number };

/** Each closed trade of a paper run's journal, its result after fees (its realized P&L) and before them:
 *  that plus the commissions of the fills that built and closed it, each fill counted at its position's
 *  first close at or after it. */
export function closedGross(lines: readonly JournalLine[]): Gross[] {
  const closes = new Map<string, { symbol: string; at: number; pnl: number; gross: number }[]>(), fees: [string, number, number][] = [];
  for (const l of lines) {
    if (l.kind === "position" && l.type === "PositionClosed") {
      const id = String(l.position_id), list = closes.get(id) ?? [];
      const pnl = amount(l.realized_pnl) ?? 0;
      list.push({ symbol: symbolOf(l.instrument_id), at: eventMs(l), pnl, gross: pnl });
      closes.set(id, list);
    } else if (l.kind === "order" && l.type === "OrderFilled" && l.position_id) fees.push([String(l.position_id), eventMs(l), amount(l.commission) ?? 0]);
  }
  for (const [id, at, fee] of fees) { const close = closes.get(id)?.find((c) => c.at >= at); if (close) close.gross += fee; }
  return [...closes.values()].flat();
}

/** The account's bridge from its closed trades (`trades`), every contract by name; or null before its
 *  account has its sums or when nothing has moved. Whatever the closed trades leave of the account's gross
 *  (a position booked without a close in the journal) is Other. */
export function bridge(a: Account, trades: readonly Gross[]): Bridge | null {
  if (a.gross === null || a.net === null || a.open === null) return null;
  const other = a.gross - trades.reduce((sum, t) => sum + t.gross, 0);
  const by = new Map<string, { win: number; loss: number; pnl: number }>();
  for (const t of trades) {
    const c = by.get(t.symbol) ?? { win: 0, loss: 0, pnl: 0 };
    if (t.gross > 0) c.win += t.gross; else c.loss += t.gross;
    c.pnl += t.pnl;
    by.set(t.symbol, c);
  }
  const order = [...by.keys()].sort((x, y) => by.get(y)!.pnl - by.get(x)!.pnl);
  const contract = (kind: "win" | "loss") => (symbol: string): Step => ({ key: `${kind}:${symbol}`, name: symbol, kind, value: by.get(symbol)![kind] });
  const steps = [...order.map(contract("win")), ...order.map(contract("loss")), { key: "other", name: "Other", kind: "other" as const, value: other },
    { key: "funding", name: "Funding", kind: "funding" as const, value: a.funding }, { key: "open", name: "Open", kind: "open" as const, value: a.open },
    { key: "fees", name: "Fees", kind: "fees" as const, value: -a.fees }];
  const biggest = Math.max(Math.abs(a.gross), Math.abs(a.net), ...steps.map((f) => Math.abs(f.value)));
  const dp = biggest >= 100 ? 0 : 2, least = dp ? CENT : 0.5;
  const shown = steps.filter((f) => Math.abs(f.value) >= least), toGross: readonly Kind[] = ["win", "loss", "other"];
  if (!shown.length && Math.abs(a.net) < CENT) return null;
  return { trades: shown.filter((f) => toGross.includes(f.kind)), gross: a.gross, costs: shown.filter((f) => !toGross.includes(f.kind)), net: a.net, dp };
}
