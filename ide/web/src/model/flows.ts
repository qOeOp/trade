// What moved a paper run's equity since the start as flows, for the Profit and loss card's Sankey: what came
// in (each contract's winning trades before fees, funding received, open profit, a net loss drawn from
// the starting balance) and where it went (each contract's losing trades before fees, fees, funding paid,
// open loss, the net kept), so that the two sides add up. Into lists the contracts in By contract's order
// (best after fees first), then the other inflows; out lists the same the other way up, the net first
// and the contracts last, so that what is kept runs along the top and what is lost falls to the foot.
// Each contract's wins first cover its own losses; what is left of each flow in then fills what is left
// of the flows out, the contracts' losses before the other outflows and the net last.
import { amount, symbolOf, type JournalLine } from "../lib/paperApi";
import type { Account } from "./account";
import { eventMs } from "./paper";

/** What a flow is: a contract's winning or losing trades (or the rest of them together), funding, open
 *  positions, whatever the closed trades leave of the account's gross, fees, or the net. */
export type Kind = "win" | "loss" | "funding" | "open" | "other" | "fees" | "net";
/** A flow's size, and the amount it stands for as the account reads it (a loss negative); the rest of
 *  the contracts together list theirs in `of`. */
export type Flow = { key: string; name: string; kind: Kind; value: number; signed: number; of?: string[] };
/** Money moving from a flow in to a flow out, by their keys. */
export type Link = { from: string; to: string; value: number };
/** The flows in and out, top to bottom, the links that join them, and the decimals every flow is shown
 *  at (whole units once any reaches 100). */
export type Flows = { into: Flow[]; out: Flow[]; links: Link[]; total: number; dp: 0 | 2 };

const CENT = 0.005;  // smaller flows are left out, and at whole units any that would show as 0

/** Each closed trade's result after fees (its realized P&L) and before them: that plus the commissions of
 *  the fills that built and closed it, each fill counted at its position's first close at or after it. */
function closedGross(lines: readonly JournalLine[]) {
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

/** The run's flows, naming at most `most` contracts (those that traded the most, the same on both
 *  sides), the rest as one once there are two or more of them; or null before its account has its sums
 *  or when nothing has moved. Whatever the closed trades leave of the account's gross (a position booked
 *  without a close in the journal) is Other. */
export function flows(a: Account, lines: readonly JournalLine[], most = 3): Flows | null {
  if (a.gross === null || a.net === null || a.open === null) return null;
  const trades = closedGross(lines), other = a.gross - trades.reduce((sum, t) => sum + t.gross, 0);
  const by = new Map<string, { win: number; loss: number; pnl: number }>();
  for (const t of trades) {
    const c = by.get(t.symbol) ?? { win: 0, loss: 0, pnl: 0 };
    if (t.gross > 0) c.win += t.gross; else c.loss -= t.gross;
    c.pnl += t.pnl;
    by.set(t.symbol, c);
  }
  // The other flows, each as it moves equity (in when positive) and as the account reads it; the net
  // closes the sums: kept at the right, or at the left drawn from the starting balance.
  const others: [Kind, string, number, number][] = [["other", "Other", other, other], ["funding", "Funding", a.funding, a.funding],
    ["open", "Open", a.open, a.open], ["fees", "Fees", -a.fees, -a.fees], ["net", "Net", -a.net, a.net]];
  const biggest = Math.max(...[...by.values()].flatMap((c) => [c.win, c.loss]), ...others.map(([, , f]) => Math.abs(f)));
  const dp = biggest >= 100 ? 0 : 2, least = dp ? CENT : 0.5;

  // Each side's contracts by name, the rest under one key.
  const ranked = [...by].sort((x, y) => y[1].win + y[1].loss - (x[1].win + x[1].loss)).map(([s]) => s);
  const named = new Set(ranked.length <= most + 1 ? ranked : ranked.slice(0, most));
  const group = (s: string) => (named.has(s) ? s : "rest");
  const sums = (side: "win" | "loss") => {
    const g = new Map<string, { value: number; of: string[] }>();
    for (const [s, c] of by) if (c[side] > 0) { const x = g.get(group(s)) ?? { value: 0, of: [] }; x.value += c[side]; x.of.push(s); g.set(group(s), x); }
    return g;
  };
  const wins = sums("win"), losses = sums("loss");
  const contract = (side: "win" | "loss", g: Map<string, { value: number; of: string[] }>) => (key: string): Flow => {
    const x = g.get(key)!;
    return { key: `${side}:${key}`, name: key === "rest" ? `+${x.of.length}` : key, kind: side, value: x.value, signed: side === "win" ? x.value : -x.value,
             ...(key === "rest" ? { of: x.of } : {}) };
  };
  // The contracts on both sides in one order, By contract's (best after fees first), the rest last: a
  // contract's own ribbon then runs level.
  const pnl = (k: string) => by.get(k)!.pnl;
  const order = [...new Set([...wins.keys(), ...losses.keys()])].filter((k) => k !== "rest").sort((x, y) => pnl(y) - pnl(x)).concat("rest");
  const into = order.filter((k) => wins.has(k)).map(contract("win", wins)).filter((f) => f.value >= least);
  const out = order.filter((k) => losses.has(k)).map(contract("loss", losses)).filter((f) => f.value >= least);
  for (const [kind, name, flow, signed] of others) if (Math.abs(flow) >= least) (flow > 0 ? into : out).push({ key: kind, name, kind, value: Math.abs(flow), signed });

  // The links: each contract's wins to its own losses; then what is left of each flow in, top to bottom,
  // fills what is left of the flows out, top to bottom, leaving out shares smaller than any flow shown.
  // The flows left out leave the two sides apart by up to their sum, so a flow no link reaches then joins
  // the other side's last flow (the net, unless it is too small to show) with its whole value.
  const shown = new Set([...into, ...out].map((f) => f.key)), joined = new Map<string, Link>(), used = new Map<string, number>();
  const join = (from: string, to: string, value: number) => {
    if (value <= 0 || !shown.has(from) || !shown.has(to)) return;
    const l = joined.get(`${from}>${to}`) ?? { from, to, value: 0 };
    joined.set(`${from}>${to}`, { ...l, value: l.value + value });
    for (const k of [from, to]) used.set(k, (used.get(k) ?? 0) + value);
  };
  for (const [s, c] of by) join(`win:${group(s)}`, `loss:${group(s)}`, Math.min(c.win, c.loss));
  const left = (fs: Flow[]) => fs.map((f) => ({ key: f.key, value: f.value - (used.get(f.key) ?? 0) }));
  const ins = left(into), outs = left(out);
  for (let i = 0, j = 0; i < ins.length && j < outs.length;) {
    const from = ins[i]!, to = outs[j]!, share = Math.min(from.value, to.value);
    if (share >= least) join(from.key, to.key, share);
    from.value -= share; to.value -= share;
    if (from.value < least) i++;
    if (to.value < least) j++;
  }
  for (const f of into) if (!used.has(f.key)) join(f.key, out.at(-1)?.key ?? "", f.value);
  for (const f of out) if (!used.has(f.key)) join(into.at(-1)?.key ?? "", f.key, f.value);
  const total = into.reduce((sum, f) => sum + f.value, 0);
  return total >= CENT ? { into, out: out.reverse(), links: [...joined.values()], total, dp } : null;
}
