// A chain of paper runs (chain.ts) as one journal for the Paper page: the earlier runs' lines first, their
// order and position ids namespaced by run so they never meet the next run's (each run's account numbers
// them afresh), a `restart` line between two runs, then the latest run's lines as its stream has them (a
// live stream resumes from those alone). Bars and closes follow on. The account carries on across the
// restarts: each later run's equity is scaled to start where the one before it ended, so the path never
// jumps back to the starting balance; the return compounds, the deepest drawdown is the joined path's from
// the first starting balance, counts add up and the start is the first run's.
import { amount, type JournalLine, type Live, type RuntimeFailure, type Seal } from "../lib/paperApi";

/** What a stream holds of one run: the Paper page's Stream has these and more. */
export type Piece = {
  paperId: number; lines: JournalLine[]; bars: JournalLine[]; closes: Record<string, [number, number][]>;
  readings: Live | null; seal: Seal | null; failures: RuntimeFailure[];
};

const START = 100_000;
const IDS = ["position_id", "client_order_id", "venue_order_id", "trade_id", "opening_order_id", "closing_order_id", "parent_order_id", "order_list_id"] as const;
const COUNTS = ["fills", "orders_submitted", "positions_closed", "missing_bars", "late_bars", "protection_gaps", "bars", "exceptions"] as const;

/** `line` with its ids as `<paper_id>/<id>`; a line with none is itself. */
export function namespaced(line: JournalLine, paperId: number): JournalLine {
  let out: JournalLine | null = null;
  for (const key of IDS) {
    const id = line[key];
    if (id == null || id === "") continue;
    out ??= { ...line };
    out[key] = `${paperId}/${String(id)}`;
  }
  if (Array.isArray(line.linked_order_ids)) (out ??= { ...line }).linked_order_ids = line.linked_order_ids.map((id) => `${paperId}/${String(id)}`);
  return out ?? line;
}
const renamed = new WeakMap<JournalLine[], JournalLine[]>();  // an earlier run's lines are final: renamed once
const namespacedLines = (p: Piece) => {
  let found = renamed.get(p.lines);
  if (!found) renamed.set(p.lines, (found = p.lines.map((l) => namespaced(l, p.paperId))));
  return found;
};

const startOf = (p: Piece) => amount(p.readings?.starting_balance_usdt) ?? START;
const endOf = (p: Piece) => amount(p.seal?.final_equity_usdt ?? p.readings?.final_equity_usdt) ?? p.readings?.equity.at(-1)?.[1] ?? null;
const startedNs = (p: Piece) => p.readings?.started_ns ?? p.seal?.started_ns ?? p.lines[0]?.wall_ns ?? null;

/** The deepest fall of `path` below its running peak, from `start`. */
export function deepestDrawdown(path: readonly (readonly [number, number])[], start: number): number {
  let peak = start, deepest = 0;
  for (const [, v] of path) { peak = Math.max(peak, v); deepest = Math.max(deepest, 1 - v / peak); }
  return deepest;
}

/** The line between two runs: when the first stopped, when the next started and why the first ended. */
function restart(stopped: Piece, started: Piece): JournalLine {
  const from = stopped.seal?.stopped_ns ?? stopped.lines.at(-1)?.wall_ns ?? 0, to = startedNs(started) ?? from;
  return { kind: "restart", wall_ns: to, from_ns: from, to_ns: to, stopped: stopped.paperId, started: started.paperId, stop_reason: stopped.seal?.stop_reason ?? null };
}

/** Days' returns of consecutive runs as one list: a day two runs share compounds. */
function daily(seals: readonly (Seal | null)[]): [string, number][] {
  const by = new Map<string, number>();
  for (const s of seals) for (const [day, r] of s?.daily_returns ?? []) by.set(day, (1 + (by.get(day) ?? 0)) * (1 + r) - 1);
  return [...by].sort(([a], [b]) => a.localeCompare(b));
}

/** `current` with the `earlier` runs of its chain (oldest first, each loaded whole) before it. */
export function joined<T extends Piece>(earlier: readonly Piece[], current: T): T {
  if (!earlier.length) return current;
  const all = [...earlier, current], first = startOf(all[0]!);
  // Each run's scale: its start maps to where the run before it ended.
  const scale: number[] = [];
  let carried = first;
  for (const p of all) { scale.push(carried / startOf(p)); carried = (endOf(p) ?? startOf(p)) * scale.at(-1)!; }
  const lines = earlier.flatMap((p, k) => [...namespacedLines(p), restart(p, all[k + 1]!)]).concat(current.lines);
  const closes: Record<string, [number, number][]> = {};
  for (const p of all) for (const [symbol, found] of Object.entries(p.closes)) closes[symbol] = [...(closes[symbol] ?? []), ...found];
  const end = endOf(current), final = end === null ? null : end * scale.at(-1)!, finalText = final === null ? null : final.toFixed(10);
  const equity = all.flatMap((p, k) => (p.readings?.equity ?? []).map(([t, v]) => [t, v * scale[k]!] as [number, number]));
  const total = final === null ? null : final / first - 1, drawdown = deepestDrawdown(equity, first);
  const sum = (pick: (p: Piece) => number) => all.reduce((n, p) => n + pick(p), 0);
  const started = startedNs(all[0]!);
  const readings: Live | null = current.readings && {
    ...current.readings, ...Object.fromEntries(COUNTS.map((key) => [key, sum((p) => p.readings?.[key] ?? 0)])),
    equity, starting_balance_usdt: all[0]!.readings?.starting_balance_usdt ?? String(first), final_equity_usdt: finalText,
    total_return: total, max_drawdown: drawdown, funding_usdt: String(sum((p) => amount(p.readings?.funding_usdt) ?? 0)), started_ns: started,
  };
  const seal: Seal | null = current.seal && {
    ...current.seal, final_equity_usdt: finalText, total_return: total, max_drawdown: drawdown,
    started_ns: started, fills: sum((p) => p.seal?.fills ?? 0), positions_closed: sum((p) => p.seal?.positions_closed ?? 0), daily_returns: daily(all.map((p) => p.seal)),
  };
  return {
    ...current, lines, bars: [...earlier.flatMap((p) => p.bars), ...current.bars], closes, readings, seal,
    failures: [...earlier.flatMap((p) => p.failures), ...current.failures],
  };
}
