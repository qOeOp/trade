// The paper run shown (state/shown.ts) as the chart, Details, the Trades window and the toolbar read it,
// worked out once by the shell (useRunDriver): its stream, joined with the earlier runs of its chain
// (model/joined.ts, each with the listing's verdict on it; until they are read the run shows alone), its
// account once its readings or seal arrive (before them every figure would read as zero), what its
// closed trades say, its fills and what moved its equity; and what the chart shows of it.
import { useEffect, useMemo } from "react";
import { symbolOf, type PaperRun } from "../lib/paperApi";
import { account, tradeStats, type Account, type TradeStats } from "../model/account";
import { flows as flowsOf, type Flows } from "../model/flows";
import { joined } from "../model/joined";
import { fills as fillsOf, type Fill } from "../model/paper";
import { atom, useAtom } from "./atom";
import { useEarlier } from "./paperChain";
import { follow, pickedDay, useStream, type Stream } from "./paperStream";
import { followReconciliation } from "./reconcile";
import { useShown } from "./shown";
import { paperTab } from "./stage";

export type RunData = {
  run: PaperRun; s: Stream | null; a: Account | null; stats: TradeStats | null; fills: readonly Fill[]; flows: Flows | null;
  /** What the chart shows: "equity", or a contract of the run. */
  view: string;
};
const runData = atom<RunData | null>(null);
export const useRunData = () => useAtom(runData);

export function useRunDriver(): void {
  const { run, chain } = useShown();
  const tab = useAtom(paperTab);
  const view = tab === "equity" || (tab && run?.symbols.includes(tab)) ? tab : "equity", symbol = view === "equity" ? null : view;
  useEffect(() => { follow(run?.paper_id ?? null, symbol); }, [run?.paper_id, symbol]);
  useEffect(() => { pickedDay.set(null); }, [run?.paper_id]);
  useEffect(() => { followReconciliation(run?.state === "sealed" ? run.paper_id : null); }, [run?.paper_id, run?.state]);
  const stream = useStream();
  const before = chain.slice(0, -1), ids = before.map((r) => r.paper_id).join(), verdicts = before.map((r) => r.status).join();
  const earlier = useEarlier(useMemo(() => before.map((r) => r.paper_id), [ids]), symbol);
  const own = stream && stream.paperId === run?.paper_id ? stream : null;
  const s = useMemo(() => (own && earlier?.length && own.symbol === symbol
    ? joined(earlier.map((p, k) => ({ ...p, status: before[k]?.status ?? null })), own) : own), [own, earlier, verdicts, symbol]);
  // The first view of a run: the contract it holds, once its state says which.
  useEffect(() => {
    if (tab !== null || !s?.state) return;
    const held = s.seal ? undefined : s.state.positions[0];
    paperTab.set(held ? symbolOf(held.instrument_id) : "equity");
  }, [tab, !!s?.state]);
  const a = useMemo(() => (s && (s.readings || s.seal) ? account(s.lines, s.state, s.readings, s.seal) : null), [s?.lines, s?.state, s?.readings, s?.seal]);
  const stats = useMemo(() => (a && s ? tradeStats(a, s.lines) : null), [a]);
  const fills = useMemo(() => fillsOf(s?.lines ?? []), [s?.lines]);
  // Two contracts a side by name fit the Performance tiles.
  const flows = useMemo(() => (a && s ? flowsOf(a, s.lines, 2) : null), [a]);
  useEffect(() => { runData.set(run ? { run, s, a, stats, fills, flows, view } : null); }, [run, s, a, stats, fills, flows, view]);
}
