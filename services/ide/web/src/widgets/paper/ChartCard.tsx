import { useEffect, useMemo, useState } from "react";
import { PERIODS, type Period } from "../../lib/bars";
import { precisions, symbolOf, type PaperRun } from "../../lib/paperApi";
import type { Account } from "../../model/account";
import { heldOf, priceLines, spans as spansOf, type Fill } from "../../model/paper";
import { Dropdown, DropdownItem } from "../../components/Dropdown";
import { Segmented, type Segment } from "../../components/Segmented";
import { TextButton } from "../../components/TextButton";
import type { Stream } from "../../state/paperStream";
import { paperTab } from "../../state/paper";
import { CandleChart } from "./CandleChart";
import { EquityChart } from "./EquityChart";

const ALL_TABS = 6;  // a run of at most this many contracts shows a segment for each
const CANDLES = 60;  // the default period is the longest that still gives this many candles
const autoPeriod = (minutes: number): Period => [...PERIODS].reverse().find((p) => minutes / p.minutes >= CANDLES)?.id ?? "1m";
const needs = (minutes: number) => (minutes >= 1440 ? `${(2 * minutes) / 1440} days` : minutes >= 60 ? `${(2 * minutes) / 60} h` : `${2 * minutes} min`);

/** The chart card: a switch between the account's equity and each contract (a contract holding a
 *  position says LONG or SHORT in its colour), the candle period, and "Fit position" while the contract
 *  holds one; below, the chart the switch picks. A run of many contracts lists those it traded or holds
 *  and opens the others from "+ Contract". */
export function ChartCard({ run, view, s, a, fills, targets }: {
  run: PaperRun; view: string; s: Stream | null; a: Account | null; fills: readonly Fill[];
  targets: { limit: number | null; annual: number | null };
}) {
  const [chosen, setChosen] = useState<Period | null>(null);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [fit, setFit] = useState(0);
  useEffect(() => { setChosen(null); setPinned(new Set()); }, [run.paper_id]);
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
  const minutes = bars.length;
  const period = chosen ?? autoPeriod(minutes);
  const of = digits.get(symbol) ?? { price: 2, size: -1 };
  const startedNs = run.seal?.started_ns ?? run.live?.started_ns ?? null;
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
          <Segmented quiet label="Candle period" value={period} onChange={setChosen}
                     items={PERIODS.map((p) => {
                       const short = p.minutes > 1 && minutes < 2 * p.minutes;
                       return { id: p.id, label: p.id, disabled: short, hint: short ? `Needs ${needs(p.minutes)} of bars` : undefined };
                     })} />
          <span aria-hidden className={`h-4 w-px bg-line-strong ${held ? "" : "invisible"}`} />
          <TextButton className={`h-7 whitespace-nowrap px-2 text-dense text-fg-muted ${held ? "" : "invisible"}`} onClick={() => setFit(fit + 1)}>Fit<span className="@max-[1120px]/page:hidden"> position</span></TextButton>
        </span>
      </div>
      <div className="mb-1 ml-3 mr-1 min-h-0 flex-1">
        {equity ? (
          <EquityChart path={a?.path ?? []} starting={a?.starting ?? 100_000} start={a?.start ?? null} limit={targets.limit} annual={targets.annual} />
        ) : (
          <CandleChart key={symbol} symbol={symbol} bars={bars} minutes={PERIODS.find((p) => p.id === period)!.minutes}
                       places={of.price < 0 ? 2 : of.price} size={of.size} fills={mine} orders={orders} held={held} openFrom={openFrom}
                       started={startedNs === null ? null : startedNs / 1e6} fit={fit} />
        )}
      </div>
    </section>
  );
}
