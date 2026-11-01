import { useEffect, useMemo, useState } from "react";
import { precisions, symbolOf, type PaperRun } from "../../lib/paperApi";
import type { Account } from "../../model/account";
import { cyclesHeld } from "../../model/backtest";
import { heldOf, heldUnion, priceLines, restartsOf, spans as spansOf, warmupAt, type Fill, type Restart } from "../../model/paper";
import { useView } from "../../model/view";
import { backtestNote, type Loaded } from "../../state/backtest";
import { barsNote, useBacktestBars } from "../../state/backtestBars";
import type { Stretch } from "../../model/stretches";
import { leadOf } from "./backtestCandles";
import { eventsOf } from "./candleEvents";
import { Dropdown, DropdownItem } from "../../components/Dropdown";
import { Segmented, type Segment } from "../../components/Segmented";
import { TextButton } from "../../components/TextButton";
import { tradesTab, type Stream } from "../../state/paperStream";
import { useAtom } from "../../state/atom";
import { paperTab } from "../../state/stage";
import { useReconciliation } from "../../state/reconcile";
import { CandleChart } from "./CandleChart";
import { EquityChart } from "./EquityChart";
import { continuous, stretchName } from "./equityStretches";

const ALL_TABS = 6;  // a run of at most this many contracts shows a segment for each

/** The chart card: a switch between the account's equity and each contract of the shown run (a contract
 *  holding a position says LONG or SHORT in its colour) and "Fit position" while the contract holds one;
 *  below, the chart the switch picks, of every stretch of the version one after another: on Equity its
 *  backtest (`backtest` of `trial`, shown when `testing`) unless it would end after the paper runs start,
 *  then the paper runs (`stretches`); on a contract the backtest's daily bars of the line's market commit
 *  and its cycles (backtestCandles.ts), then the paper runs' candles at a period picked for the span in
 *  view. The contracts are the run's, then those only the backtest traded. A run of many contracts lists
 *  those it or the backtest traded or holds and opens the others from "+ Contract". The charts keep their view per version, contract and stretches (`remembers`), and show
 *  only once the shown run's chain is read. */
export function ChartCard({ version, run, view, s, a, fills, stretches, targets, trial, backtest, testing, paper }: {
  version: string | null; run: PaperRun | null; view: string; s: Stream | null; a: Account | null; fills: readonly Fill[]; stretches: readonly Stretch[];
  targets: { limit: number | null; annual: number | null }; trial: number | null; backtest: Loaded | null; testing: boolean;
  /** What the legend says of the paper runs when there are none to draw. */
  paper: string | null;
}) {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [fit, setFit] = useState(0);
  useEffect(() => { setPinned(new Set()); }, [run?.paper_id]);
  const live = s?.state && !s.seal ? s.state : null;
  const equity = view === "equity", symbol = equity ? "" : view;
  const mine = useMemo(() => fills.filter((f) => f.symbol === symbol), [fills, symbol]);
  // The shown chain's restarts (model/joined.ts), the same while the chain is.
  const joins = useMemo(() => JSON.stringify(restartsOf(s?.lines ?? [])), [s?.lines]);
  const restarts = useMemo<Restart[]>(() => JSON.parse(joins), [joins]);
  const ready = backtest?.kind === "ready" ? backtest.b : null, paperFrom = stretches[0]?.piece.readings?.equity[0]?.[0];
  // The backtest drawn: one ending before the paper runs start; on Equity, one with a starting balance.
  const fits = ready && (paperFrom === undefined || ready.window[1] <= paperFrom / 1e6) ? ready : null, drawn = fits?.starting != null ? fits : null;
  const ours = !equity && (run?.symbols.includes(symbol) ?? false), market = useView().line.market_commit ?? null;
  const daily = useBacktestBars(fits && !equity ? symbol : "", fits, market);
  const lead = useMemo(() => (fits && !equity && trial !== null ? leadOf(fits, trial, symbol, daily, testing) : null), [fits, equity, trial, symbol, daily, testing]);
  const late = ready && !fits ? `Backtest · trial ${trial} ends after the paper runs start, not drawn` : null;
  const said = equity || !ready ? backtestNote(backtest, trial ?? 0) ?? late : late ?? (lead ? barsNote(daily) : "Not traded in backtest");
  const note = [trial === null ? null : said, paper].filter(Boolean).join(" · ") || null;
  const line = useMemo(() => continuous(equity ? stretches : [], targets.annual, true, drawn, testing), [stretches, targets.annual, equity, drawn, testing]);
  const remembers = `${version ?? ""}:${symbol}:${(drawn && equity) || lead ? `trial ${trial},` : ""}${stretches.map((x) => x.chain[0]!.paper_id).join()}`;
  // The contract's candles over every stretch, and the offline stretches inside each chain.
  const bars = useMemo(() => (ours ? stretches.flatMap((x) => x.piece.bars) : []), [ours, stretches]);
  const breaks = useMemo(() => stretches.flatMap((x) => restartsOf(x.piece.lines)), [stretches]);
  const parts = useMemo(() => [...(lead ? [lead.span] : []), ...(ours ? stretches : []).flatMap(({ chain, piece: { bars: own }, selected, run: r }) => (own.length
    ? [{ label: stretchName(chain), run: r, selected, from: Number(own[0]!.ts_event) / 1e9, to: Number(own.at(-1)!.ts_event) / 1e9 }] : []))], [lead, ours, stretches]);
  const spans = useMemo(() => spansOf(fills, symbol, restarts), [fills, symbol, restarts]);
  const orders = useMemo(() => priceLines(live?.orders ?? [], symbol), [live, symbol]);
  const held = useMemo(() => heldOf(live?.positions ?? [], symbol), [live, symbol]);
  const digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const events = useMemo(() => (ours ? eventsOf(s?.lines ?? [], symbol) : []), [s?.lines, symbol, ours]);
  const sides = new Map((live?.positions ?? []).map((p) => [symbolOf(p.instrument_id), Number(p.signed_qty) > 0]));
  const tested = [...new Set(ready?.cycles.map((c) => c.symbol))].filter((x) => !run?.symbols.includes(x)).sort();
  const traded = new Set([...fills.map((f) => f.symbol), ...(ready?.cycles.map((c) => c.symbol) ?? [])]);
  const symbols = [...(run?.symbols ?? []), ...tested];
  const listed = symbols.filter((x) => symbols.length <= ALL_TABS || sides.has(x) || traded.has(x) || pinned.has(x) || x === view);
  const rest = symbols.filter((x) => !listed.includes(x));
  const items: Segment<string>[] = [{ id: "equity", label: "Equity" }, ...listed.map((x) => ({
    id: x, label: <>{x}{sides.has(x) && <span className={`text-small tracking-[0.04em] ${sides.get(x) ? "text-pnl-up" : "text-pnl-down"}`}>{sides.get(x) ? "LONG" : "SHORT"}</span>}</>,
  }))];
  const of = digits.get(symbol) ?? { price: 2, size: -1 };
  const startedNs = run?.seal?.started_ns ?? run?.live?.started_ns ?? null;
  // While an unsealed run waits for its daily warm-up (before it writes any state), the empty charts say when it starts.
  const warmup = useMemo(() => { const at = s && !s.seal ? warmupAt(s.lines) : null; return at !== null && at > Date.now() ? at : null; }, [s?.seal, s?.lines]);
  // The replay's equity shows while the Trades window shows the reconciliation it belongs to.
  const r = useReconciliation(), reconciling = useAtom(tradesTab) === "reconcile";
  const replay = useMemo(() => (reconciling && run && r?.paper_id === run.paper_id && r.result ? r.result.equity.replay.map(([ns, v]) => [ns, Number(v)] as [number, number]) : null), [r, run?.paper_id, reconciling]);
  const openFrom = spans.find(([, to]) => to === null)?.[0] ?? null;
  // The equity chart's closes and the stretches any contract held a position, in seconds: the shown
  // stretch's, the backtest's cycles or the paper run's fills.
  const trades = testing ? drawn?.cycles : a?.trades;
  const closes = useMemo(() => (trades ?? []).map((t) => ({ id: t.id, time: t.closed / 1000, pnl: t.pnl ?? 0 })), [trades]);
  const holding = useMemo(() => (testing ? cyclesHeld(drawn?.cycles ?? []) : a?.start == null ? [] : heldUnion(fills, a.start, a.end, restarts))
    .map(([x, y]) => [x / 1000, y / 1000] as [number, number]), [testing, drawn, fills, a?.start, a?.end, restarts]);

  return (
    <section aria-label="Chart" className="flex min-h-0 min-w-0 flex-col rounded-island bg-island">
      <div className="flex h-(--header-h) shrink-0 items-center gap-3 pl-4 pr-3">
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
        {/* Until the shown run's chain is read whole, so its stretch never shows in part and then grows. */}
        {run && !stretches.some((x) => x.chain.some((r) => r.paper_id === run.paper_id)) ? <p className="grid h-full place-items-center text-dense text-fg-faint">Reading the paper runs…</p>
          : equity ? (
          <EquityChart key={remembers} line={line} remembers={remembers} replay={replay} annual={targets.annual} limit={targets.limit} closes={closes} held={holding} warmup={warmup} note={note} />
        ) : (
          <CandleChart key={remembers} remembers={remembers} symbol={symbol} bars={bars} lead={lead} note={note} stretches={parts}
                       places={of.price < 0 ? 2 : of.price} size={of.size} fills={mine} orders={orders} held={held} events={events} live={live !== null} restarts={breaks} openFrom={openFrom}
                       started={startedNs === null ? null : startedNs / 1e6} warmup={warmup} fit={fit} />
        )}
      </div>
    </section>
  );
}
