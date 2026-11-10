// The paper run shown (state/shown.ts) as the chart, Details, the Trades window and the toolbar read it,
// worked out once by the shell (useRunDriver): its stream, joined with the earlier runs of its chain
// (model/joined.ts, each with the listing's verdict on it; until they are read the run shows alone), its
// account once its readings or seal arrive (before them every figure would read as zero), what its
// closed trades say, its fills and what moved its equity; what the chart shows of it (Equity, or a contract
// of the run or of its version's backtest), and the version's stretches the chart draws (stretches.ts).
import { useEffect, useMemo } from "react";
import { symbolOf, type PaperRun } from "../lib/paperApi";
import { account, tradeStats, type Account, type TradeStats } from "../model/account";
import { bridge as bridgeOf, closedGross, type Bridge } from "../model/bridge";
import { equityMoved } from "../model/chain";
import { joined } from "../model/joined";
import { fills as fillsOf, type Fill } from "../model/paper";
import { atom, useAtom } from "./atom";
import { useBacktest } from "./backtest";
import { useEarlier } from "./paperChain";
import { follow, pickedDay, useStream, type Stream } from "./paperStream";
import { followReconciliation } from "./reconcile";
import { useShown } from "./shown";
import type { Stretch } from "../model/stretches";
import { useStretches } from "./stretches";
import { paperTab } from "./stage";

export type RunData = {
  run: PaperRun; s: Stream | null; a: Account | null; stats: TradeStats | null; fills: readonly Fill[]; bridge: Bridge | null;
  /** What the chart shows: "equity", or a contract of the run or the backtest. */
  view: string;
  stretches: readonly Stretch[];
};
const runData = atom<RunData | null>(null);
export const useRunData = () => useAtom(runData);

export function useRunDriver(): void {
  const { run, chain, stage } = useShown();
  const tab = useAtom(paperTab);
  const b = useBacktest(), tested = b?.kind === "ready" && b.b.cycles.some((c) => c.symbol === tab);
  // The run's stream follows a contract of the run only: one the backtest alone traded has no paper bars.
  // A paper run opens on a contract, the one it holds once its state says which, else its first; Equity is
  // a flat line until the chain's equity moves, so it is not shown before then.
  const flat = stage !== "backtest" && !!run?.symbols.length && !equityMoved(chain);
  const fallback = stage !== "backtest" && run?.symbols[0] ? run.symbols[0] : "equity";
  const view = (tab === "equity" && !flat) || (tab && tab !== "equity" && (stage === "backtest" ? tested : run?.symbols.includes(tab))) ? tab : fallback;
  const symbol = view !== "equity" && run?.symbols.includes(view) ? view : null;
  useEffect(() => { follow(run?.paper_id ?? null, symbol); }, [run?.paper_id, symbol]);
  useEffect(() => { pickedDay.set(null); }, [run?.paper_id]);
  useEffect(() => { followReconciliation(run?.state === "sealed" ? run.paper_id : null); }, [run?.paper_id, run?.state]);
  const stream = useStream();
  const before = chain.slice(0, -1), ids = before.map((r) => r.paper_id).join(), verdicts = before.map((r) => r.status).join();
  const earlier = useEarlier(useMemo(() => before, [ids]), symbol);
  const own = stream && stream.paperId === run?.paper_id ? stream : null;
  const s = useMemo(() => (own && earlier?.length && own.symbol === symbol
    ? joined(earlier.map((p, k) => ({ ...p, status: before[k]?.status ?? null })), own) : own), [own, earlier, verdicts, symbol]);
  const stretches = useStretches(s && s.symbol === symbol && (!before.length || s !== own) ? s : null, symbol);
  // The first view of a run: the contract it holds, once its state says which (else `fallback` above).
  useEffect(() => {
    if (tab !== null || !s?.state) return;
    const held = s.seal ? undefined : s.state.positions[0];
    if (held) paperTab.set(symbolOf(held.instrument_id));
  }, [tab, !!s?.state]);
  const a = useMemo(() => (s && (s.readings || s.seal) ? account(s.lines, s.state, s.readings, s.seal) : null), [s?.lines, s?.state, s?.readings, s?.seal]);
  const stats = useMemo(() => (a && s ? tradeStats(a, s.lines) : null), [a]);
  const fills = useMemo(() => fillsOf(s?.lines ?? []), [s?.lines]);
  const bridge = useMemo(() => (a && s ? bridgeOf(a, closedGross(s.lines)) : null), [a]);
  useEffect(() => { runData.set(run ? { run, s, a, stats, fills, bridge, view, stretches } : null); }, [run, s, a, stats, fills, bridge, view, stretches]);
}
