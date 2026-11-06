import { useEffect, useMemo, useState } from "react";
import { precisions, symbolOf, type PaperRun } from "../../lib/paperApi";
import type { Account } from "../../model/account";
import { chartHistory } from "../../model/stage";
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
import { Typing } from "../../components/Typing";
import { tradesTab, type Stream } from "../../state/paperStream";
import { useAtom } from "../../state/atom";
import { paperTab } from "../../state/stage";
import { useReconciliation } from "../../state/reconcile";
import { CandleChart } from "./CandleChart";
import { EquityChart } from "./EquityChart";
import { Observation } from "./Observation";
import { continuous, stretchName } from "./equityStretches";

const ALL_TABS = 6;  // a run of at most this many contracts shows a segment for each

/** The chart card follows the selected stage: the backtest's equity, daily bars and cycles, or the
 *  paper account's equity, candles and fills. Contracts come from that stage only. A contract holding
 *  a paper position says LONG or SHORT and offers "Fit position"; large universes open extra contracts
 *  from "+ Contract". The charts keep their view per stage, version, contract and stretches, and show
 *  only once what they draw is read (the paper chain, backtest, or a contract's daily bars), a
 *  line typing itself out in their place meanwhile, so a switch never shows an empty chart that then fills. */
export function ChartCard({ version, run, view, s, a, fills, stretches: history, targets, trial, backtest, testing, paper }: {
  version: string | null; run: PaperRun | null; view: string; s: Stream | null; a: Account | null; fills: readonly Fill[]; stretches: readonly Stretch[];
  targets: { limit: number | null; annual: number | null }; trial: number | null; backtest: Loaded | null; testing: boolean;
  /** What the legend says of the paper runs when there are none to draw. */
  paper: string | null;
}) {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [fit, setFit] = useState(0);
  useEffect(() => { setPinned(new Set()); }, [run?.paper_id]);
  const live = !testing && s?.state && !s.seal ? s.state : null;
  const equity = view === "equity", symbol = equity ? "" : view;
  const mine = useMemo(() => testing ? [] : fills.filter((f) => f.symbol === symbol), [fills, symbol, testing]);
  // The shown chain's restarts (model/joined.ts), the same while the chain is.
  const joins = useMemo(() => JSON.stringify(restartsOf(s?.lines ?? [])), [s?.lines]);
  const restarts = useMemo<Restart[]>(() => JSON.parse(joins), [joins]);
  const { stretches, backtest: ready } = useMemo(() => chartHistory(testing ? "backtest" : "paper", history, backtest?.kind === "ready" ? backtest.b : null), [testing, history, backtest]);
  const drawn = ready?.starting != null ? ready : null;
  const ours = !testing && !equity && (run?.symbols.includes(symbol) ?? false), market = useView().line.market_commit ?? null;
  const daily = useBacktestBars(ready && !equity ? symbol : "", ready, market);
  const lead = useMemo(() => (ready && !equity && trial !== null ? leadOf(ready, trial, symbol, daily, testing) : null), [ready, equity, trial, symbol, daily, testing]);
  const said = equity || !ready ? backtestNote(backtest, trial ?? 0) : lead ? barsNote(daily) : "Not traded in backtest";
  const note = [!testing || trial === null ? null : said, paper].filter(Boolean).join(" · ") || null;
  const reading = !testing && run && !stretches.some((x) => x.chain.some((r) => r.paper_id === run.paper_id)) ? "Reading the paper runs…"
    : testing && trial !== null && backtest?.kind === "reading" ? backtestNote(backtest, trial) : daily?.kind === "reading" ? barsNote(daily) : null;
  const line = useMemo(() => continuous(equity ? stretches : [], targets.annual, true, drawn, testing), [stretches, targets.annual, equity, drawn, testing]);
  const remembers = `${testing ? "backtest" : "paper"}:${version ?? ""}:${symbol}:${(drawn && equity) || lead ? `trial ${trial},` : ""}${stretches.map((x) => x.chain[0]!.paper_id).join()}`;
  // The contract's candles over every stretch, and the offline stretches inside each chain.
  const bars = useMemo(() => (ours ? stretches.flatMap((x) => x.piece.bars) : []), [ours, stretches]);
  const breaks = useMemo<Restart[]>(() => stretches.flatMap((x) => {
    const seams = restartsOf(x.piece.lines), at = x.piece.seal?.stopped_ns;
    return at == null ? seams : [...seams, { from: at / 1e6, to: at / 1e6, gap: "offline" as const, lead: "Run ended", resumed: "" }];
  }), [stretches]);
  const parts = useMemo(() => [...(lead ? [lead.span] : []), ...(ours ? stretches : []).flatMap(({ chain, piece: { bars: own }, selected, run: r }) => (own.length
    ? [{ label: stretchName(chain), run: r, selected, from: Number(own[0]!.ts_event) / 1e9, to: Number(own.at(-1)!.ts_event) / 1e9 }] : []))], [lead, ours, stretches]);
  const spans = useMemo(() => spansOf(fills, symbol, restarts), [fills, symbol, restarts]);
  const orders = useMemo(() => priceLines(live?.orders ?? [], symbol), [live, symbol]);
  const held = useMemo(() => heldOf(live?.positions ?? [], symbol), [live, symbol]);
  const digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const events = useMemo(() => (ours ? eventsOf(s?.lines ?? [], symbol) : []), [s?.lines, symbol, ours]);
  const sides = new Map((live?.positions ?? []).map((p) => [symbolOf(p.instrument_id), Number(p.signed_qty) > 0]));
  const traded = new Set([...fills.map((f) => f.symbol), ...(ready?.cycles.map((c) => c.symbol) ?? [])]);
  const symbols = testing ? [...new Set(ready?.cycles.map((c) => c.symbol))].sort() : [...(run?.symbols ?? [])];
  const listed = symbols.filter((x) => symbols.length <= ALL_TABS || sides.has(x) || traded.has(x) || pinned.has(x) || x === view);
  const rest = symbols.filter((x) => !listed.includes(x));
  const items: Segment<string>[] = [{ id: "equity", label: "Equity" }, ...listed.map((x) => ({
    id: x, label: <>{x}{sides.has(x) && <span className={`text-small tracking-[0.04em] ${sides.get(x) ? "text-pnl-up" : "text-pnl-down"}`}>{sides.get(x) ? "LONG" : "SHORT"}</span>}</>,
  }))];
  const of = digits.get(symbol) ?? { price: 2, size: -1 };
  const startedNs = run?.seal?.started_ns ?? run?.live?.started_ns ?? null;
  // While an unsealed run waits for its daily warm-up (before it writes any state), the empty charts say when it starts.
  const warmup = useMemo(() => { const at = !testing && s && !s.seal ? warmupAt(s.lines) : null; return at !== null && at > Date.now() ? at : null; }, [testing, s?.seal, s?.lines]);
  // The replay's equity shows while the Trades window shows the reconciliation it belongs to.
  const r = useReconciliation(), reconciling = useAtom(tradesTab) === "reconcile";
  const replay = useMemo(() => (!testing && reconciling && run && r?.paper_id === run.paper_id && r.result ? r.result.equity.replay.map(([ns, v]) => [ns, Number(v)] as [number, number]) : null), [testing, r, run?.paper_id, reconciling]);
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
      {!testing && run && s && <Observation run={run} s={s} />}
      <div className="mb-1 ml-3 mr-1 min-h-0 flex-1">
        {/* Until the shown run's chain is read whole, so its stretch never shows in part and then grows. */}
        {reading ? <div className="grid h-full place-items-center"><Typing text={reading} busy className="text-dense text-fg-faint" /></div>
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
