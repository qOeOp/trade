import { useEffect, useMemo, useState } from "react";
import { precisions, symbolOf, type PaperRun } from "../../lib/paperApi";
import type { Account } from "../../model/account";
import { heldOf, priceLines, spans as spansOf, type Fill } from "../../model/paper";
import { Dropdown, DropdownItem } from "../../components/Dropdown";
import { Segmented, type Segment } from "../../components/Segmented";
import { TextButton } from "../../components/TextButton";
import { tradesTab, type Stream } from "../../state/paperStream";
import { useAtom } from "../../state/atom";
import { paperTab } from "../../state/paper";
import { useReconciliation } from "../../state/reconcile";
import { CandleChart } from "./CandleChart";
import { EquityChart } from "./EquityChart";

const ALL_TABS = 6;  // a run of at most this many contracts shows a segment for each

/** The chart card: a switch between the account's equity and each contract (a contract holding a
 *  position says LONG or SHORT in its colour) and "Fit position" while the contract holds one; below,
 *  the chart the switch picks, which picks its own candle period for the span in view. A run of many contracts lists those it traded or holds
 *  and opens the others from "+ Contract". */
export function ChartCard({ run, view, s, a, fills, targets }: {
  run: PaperRun; view: string; s: Stream | null; a: Account | null; fills: readonly Fill[];
  targets: { limit: number | null; annual: number | null };
}) {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [fit, setFit] = useState(0);
  useEffect(() => { setPinned(new Set()); }, [run.paper_id]);
  const live = s?.state && !s.seal ? s.state : null;
  const equity = view === "equity", symbol = equity ? "" : view;
  const mine = useMemo(() => fills.filter((f) => f.symbol === symbol), [fills, symbol]);
  const spans = useMemo(() => spansOf(fills, symbol), [fills, symbol]);
  const orders = useMemo(() => priceLines(live?.orders ?? [], symbol), [live, symbol]);
  const held = useMemo(() => heldOf(live?.positions ?? [], symbol), [live, symbol]);
  const digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const sides = new Map((live?.positions ?? []).map((p) => [symbolOf(p.instrument_id), Number(p.signed_qty) > 0]));
  const traded = new Set(fills.map((f) => f.symbol));
  const listed = run.symbols.filter((x) => run.symbols.length <= ALL_TABS || sides.has(x) || traded.has(x) || pinned.has(x) || x === view);
  const rest = run.symbols.filter((x) => !listed.includes(x));
  const items: Segment<string>[] = [{ id: "equity", label: "Equity" }, ...listed.map((x) => ({
    id: x, label: <>{x}{sides.has(x) && <span className={`text-small tracking-[0.04em] ${sides.get(x) ? "text-pnl-up" : "text-pnl-down"}`}>{sides.get(x) ? "LONG" : "SHORT"}</span>}</>,
  }))];
  const bars = s && s.symbol === symbol ? s.bars : [];
  const of = digits.get(symbol) ?? { price: 2, size: -1 };
  const startedNs = run.seal?.started_ns ?? run.live?.started_ns ?? null;
  // The replay's equity shows while the trades card shows the reconciliation it belongs to.
  const r = useReconciliation(), reconciling = useAtom(tradesTab) === "reconcile";
  const replay = useMemo(() => (reconciling && r?.paper_id === run.paper_id && r.result ? r.result.equity.replay.map(([ns, v]) => [ns, Number(v)] as [number, number]) : null), [r, run.paper_id, reconciling]);
  const openFrom = spans.find(([, to]) => to === null)?.[0] ?? null;

  return (
    <section aria-label="Chart" className="flex min-h-0 min-w-0 flex-col rounded-island bg-island">
      <div className="flex h-12 shrink-0 items-center gap-3 pl-4 pr-3">
        <Segmented label="Chart" items={items} value={view} onChange={paperTab.set} />
        {rest.length > 0 && (
          <Dropdown label="Open a contract" trigger={<span className="text-dense text-fg-muted">+ Contract</span>}>
            {rest.map((x) => <DropdownItem key={x} onSelect={() => { setPinned(new Set([...pinned, x])); paperTab.set(x); }}>{x}</DropdownItem>)}
          </Dropdown>
        )}
        <span className={`ml-auto flex items-center gap-2 ${equity ? "invisible" : ""}`}>
          <TextButton className={`h-7 whitespace-nowrap px-2 text-dense text-fg-muted ${held ? "" : "invisible"}`} onClick={() => setFit(fit + 1)}>Fit<span className="@max-[1120px]/page:hidden"> position</span></TextButton>
        </span>
      </div>
      <div className="mb-1 ml-3 mr-1 min-h-0 flex-1">
        {equity ? (
          <EquityChart path={a?.path ?? []} replay={replay} starting={a?.starting ?? 100_000} start={a?.start ?? null} annual={targets.annual} />
        ) : (
          <CandleChart key={symbol} symbol={symbol} bars={bars}
                       places={of.price < 0 ? 2 : of.price} size={of.size} fills={mine} orders={orders} held={held} openFrom={openFrom}
                       started={startedNs === null ? null : startedNs / 1e6} fit={fit} />
        )}
      </div>
    </section>
  );
}
