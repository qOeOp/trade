// What moved a paper run's equity since the start as flows, for the Performance card's Sankey: what came
// in (each contract's winning trades before fees, funding received, open profit, a net loss drawn from
// the starting balance) and where it went (each contract's losing trades before fees, fees, funding paid,
// open loss, the net kept), so that the two sides add up. Each contract's wins first cover its own
// losses; what they leave, with the other inflows, is the surplus, which pays the contracts' losses
// beyond their own wins and every other outflow.
import { amount, symbolOf, type JournalLine } from "../lib/paperApi";
import type { Account } from "./account";
import { eventMs } from "./paper";

/** What a flow is: a contract's winning or losing trades (or the rest of them together), funding, open
 *  positions, whatever the closed trades leave of the account's gross, fees, the net, or the surplus. */
export type Kind = "win" | "loss" | "funding" | "open" | "other" | "fees" | "net" | "surplus";
/** A flow's size, and the amount it stands for as the account reads it (a loss negative); the rest of
 *  the contracts together list theirs in `of`. */
export type Flow = { key: string; name: string; kind: Kind; value: number; signed: number; of?: string[] };
/** Money moving from one flow to another, by their keys. */
export type Link = { from: string; to: string; value: number };
/** The flows in and out, the surplus between them (null when nothing passes through it), the links that
 *  join them, and the decimals every flow is shown at (whole units once any reaches 100). */
export type Flows = { into: Flow[]; out: Flow[]; surplus: Flow | null; links: Link[]; total: number; dp: 0 | 2 };

const CENT = 0.005;  // smaller flows are left out, and at whole units any that would show as 0

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

/** The run's flows, naming at most `most` contracts (those that traded the most, the same on both
 *  sides), the rest as one once there are two or more of them; or null before its account has its sums
 *  or when nothing has moved. Whatever the closed trades leave of the account's gross (a position booked
 *  without a close in the journal) is Other. */
export function flows(a: Account, lines: readonly JournalLine[], most = 3): Flows | null {
  if (a.gross === null || a.net === null || a.open === null) return null;
  const trades = closedGross(lines), other = a.gross - trades.reduce((sum, t) => sum + t.gross, 0);
  const by = new Map<string, { win: number; loss: number }>();
  for (const t of trades) {
    const c = by.get(t.symbol) ?? { win: 0, loss: 0 };
    if (t.gross > 0) c.win += t.gross; else c.loss -= t.gross;
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
  // Winners largest first; losers in their winners' order (so a contract's own ribbon runs level), then
  // those that only lost, largest first; the rest last on both sides.
  const largest = (g: typeof wins, skip: readonly string[] = []) =>
    [...g].filter(([k]) => k !== "rest" && !skip.includes(k)).sort((x, y) => y[1].value - x[1].value).map(([k]) => k);
  const won = largest(wins), restLast = (g: typeof wins) => (g.has("rest") ? ["rest"] : []);
  const into = [...won, ...restLast(wins)].map(contract("win", wins)).filter((f) => f.value >= least);
  const out = [...won.filter((k) => losses.has(k)), ...largest(losses, won), ...restLast(losses)].map(contract("loss", losses)).filter((f) => f.value >= least);
  for (const [kind, name, flow, signed] of others) if (Math.abs(flow) >= least) (flow > 0 ? into : out).push({ key: kind, name, kind, value: Math.abs(flow), signed });

  // The links: each contract's wins to its own losses, the rest of its wins to the surplus, and its
  // losses beyond its wins from it; every other flow in to the surplus or out from it.
  const shown = new Set([...into, ...out].map((f) => f.key).concat("surplus")), joined = new Map<string, Link>();
  const join = (from: string, to: string, value: number) => {
    if (value <= 0 || !shown.has(from) || !shown.has(to)) return;
    const l = joined.get(`${from}>${to}`) ?? { from, to, value: 0 };
    joined.set(`${from}>${to}`, { ...l, value: l.value + value });
  };
  for (const [s, c] of by) {
    const own = Math.min(c.win, c.loss), w = `win:${group(s)}`, l = `loss:${group(s)}`;
    join(w, l, own); join(w, "surplus", c.win - own); join("surplus", l, c.loss - own);
  }
  for (const f of into) if (f.kind !== "win") join(f.key, "surplus", f.value);
  for (const f of out) if (f.kind !== "loss") join("surplus", f.key, f.value);
  const links = [...joined.values()], via = (end: "from" | "to") => links.filter((l) => l[end] === "surplus").reduce((sum, l) => sum + l.value, 0);
  const pool = Math.max(via("from"), via("to"));
  const surplus: Flow | null = pool >= least ? { key: "surplus", name: "Surplus", kind: "surplus", value: pool, signed: pool } : null;
  const total = into.reduce((sum, f) => sum + f.value, 0);
  return total >= CENT ? { into, out, surplus, links: surplus ? links : links.filter((l) => l.from !== "surplus" && l.to !== "surplus"), total, dp } : null;
}
