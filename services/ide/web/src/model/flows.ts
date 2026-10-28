// What moved a paper run's equity since the start as flows through one sum, for the Performance card's
// Sankey: what came in (each contract's winning trades before fees, funding received, open profit, and a
// net loss drawn from the starting balance) and where it went (each contract's losing trades before
// fees, fees, funding paid, open loss, and the net kept), so that the two sides add up.
import { amount, symbolOf, type JournalLine } from "../lib/paperApi";
import type { Account } from "./account";
import { eventMs } from "./paper";

/** What a flow is: a contract's winning or losing trades (or the rest of them together), funding, open
 *  positions, whatever the closed trades leave of the account's gross, fees, or the net. */
export type Kind = "win" | "loss" | "funding" | "open" | "other" | "fees" | "net";
/** A flow's size, and the amount it stands for as the account reads it (a loss negative); the rest of
 *  the contracts together list theirs in `of`. */
export type Flow = { key: string; name: string; kind: Kind; value: number; signed: number; of?: string[] };
export type Flows = { into: Flow[]; out: Flow[]; total: number };

const CENT = 0.005;  // smaller flows are left out

/** Each closed trade's result before fees: its realized P&L (fees included) plus the commissions of the
 *  fills that built and closed it, each fill counted at its position's first close at or after it. */
function closedGross(lines: readonly JournalLine[]) {
  const closes = new Map<string, { symbol: string; at: number; gross: number }[]>(), fees: [string, number, number][] = [];
  for (const l of lines) {
    if (l.kind === "position" && l.type === "PositionClosed") {
      const id = String(l.position_id), list = closes.get(id) ?? [];
      list.push({ symbol: symbolOf(l.instrument_id), at: eventMs(l), gross: amount(l.realized_pnl) ?? 0 });
      closes.set(id, list);
    } else if (l.kind === "order" && l.type === "OrderFilled" && l.position_id) fees.push([String(l.position_id), eventMs(l), amount(l.commission) ?? 0]);
  }
  for (const [id, at, fee] of fees) { const close = closes.get(id)?.find((c) => c.at >= at); if (close) close.gross += fee; }
  return [...closes.values()].flat();
}

/** One side's contracts, largest first: winning (sign 1) or losing (−1) trades together, the ones past
 *  the `most` largest as one row once there are two or more of them. */
function contracts(trades: ReturnType<typeof closedGross>, sign: 1 | -1, most: number): Flow[] {
  const by = new Map<string, number>();
  for (const t of trades) if (t.gross * sign > 0) by.set(t.symbol, (by.get(t.symbol) ?? 0) + Math.abs(t.gross));
  const rows = [...by].filter(([, v]) => v >= CENT).sort((a, b) => b[1] - a[1])
    .map(([symbol, value]): Flow => ({ key: `${sign}${symbol}`, name: symbol, kind: sign > 0 ? "win" : "loss", value, signed: sign * value }));
  if (rows.length <= most + 1) return rows;
  const rest = rows.slice(most), value = rest.reduce((sum, r) => sum + r.value, 0);
  return [...rows.slice(0, most), { key: `${sign}rest`, name: `+${rest.length}`, kind: rows[0]!.kind, value, signed: sign * value, of: rest.map((r) => r.name) }];
}

/** The run's flows, naming at most `most` contracts a side, or null before its account has its sums or
 *  when nothing has moved. Whatever the closed trades leave of the account's gross (a position booked
 *  without a close in the journal) is Other. */
export function flows(a: Account, lines: readonly JournalLine[], most = 3): Flows | null {
  if (a.gross === null || a.net === null || a.open === null) return null;
  const trades = closedGross(lines), other = a.gross - trades.reduce((sum, t) => sum + t.gross, 0);
  const into: Flow[] = contracts(trades, 1, most), out: Flow[] = contracts(trades, -1, most);
  // A flow in (positive) or out, read as `signed`.
  const add = (kind: Kind, name: string, flow: number, signed = flow) => {
    if (Math.abs(flow) >= CENT) (flow > 0 ? into : out).push({ key: kind, name, kind, value: Math.abs(flow), signed });
  };
  add("other", "Other", other);
  add("funding", "Funding", a.funding);
  add("open", "Open", a.open);
  add("fees", "Fees", -a.fees);
  // The net closes the sums: kept at the right, or at the left drawn from the starting balance.
  add("net", "Net", -a.net, a.net);
  const total = into.reduce((sum, f) => sum + f.value, 0);
  return total >= CENT ? { into, out, total } : null;
}
