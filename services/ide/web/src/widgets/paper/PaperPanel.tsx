import { useEffect, useMemo, useState } from "react";
import type { LineageWidget } from "../../model/types";
import { useView, useWidget } from "../../model/view";
import { fills as fillsOf, heldOf, priceLines, spans as spansOf, utc, winRate } from "../../model/paper";
import { PERIODS, type Period } from "../../lib/bars";
import { pct } from "../../lib/format";
import { amount, precisions, symbolOf } from "../../lib/paperApi";
import { Dropdown, DropdownItem } from "../../components/Dropdown";
import { Tabs, type Tab } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { paperTab, selectedRun, usePaperRuns } from "../../state/paper";
import { follow, pickedDay, useStream } from "../../state/paperStream";
import { CandleChart } from "./CandleChart";
import { EquityChart } from "./EquityChart";
import { MONEY, PERCENT, RunMetrics, SIGNED } from "./RunMetrics";
import { RunStrip, useNow } from "./RunStrip";

const ALL_TABS = 6;  // a run of at most this many contracts shows a tab for each
const LATE_MS = 2 * 60_000;
const CANDLES = 60;  // the default period is the longest that still gives this many candles
const autoPeriod = (minutes: number): Period => [...PERIODS].reverse().find((p) => minutes / p.minutes >= CANDLES)?.id ?? "1m";

/** The Paper page in the editor: the run cards and the selected run's readings in one band, then its
 *  Account tab (equity and drawdown) and a tab per contract it trades (candles with its fills, orders
 *  and position). */
export function PaperPanel() {
  const listing = usePaperRuns();
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage@2");
  const selected = useAtom(selectedRun);
  const tab = useAtom(paperTab);
  const day = useAtom(pickedDay);
  const [chosen, setChosen] = useState<Period | null>(null);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const now = useNow();
  const run = listing?.runs.find((r) => r.paper_id === selected) ?? null;
  useEffect(() => { follow(run?.paper_id ?? null, tab); }, [run?.paper_id, tab]);
  useEffect(() => { setPinned(new Set()); setChosen(null); pickedDay.set(null); }, [run?.paper_id]);
  const stream = useStream();
  const s = stream && stream.paperId === run?.paper_id ? stream : null;
  const nodes = useMemo(() => new Map((lineage?.nodes ?? []).map((n) => [n.id, n])), [lineage]);
  // A sealed run's last snapshot is history: its orders were cancelled and its positions booked at the end.
  const live = s?.state && !s.seal ? s.state : null;
  const fills = useMemo(() => fillsOf(s?.lines ?? []), [s?.lines]);
  const mine = useMemo(() => fills.filter((f) => f.symbol === tab), [fills, tab]);
  const spans = useMemo(() => spansOf(fills, tab ?? ""), [fills, tab]);
  const orders = useMemo(() => priceLines(live?.orders ?? [], tab ?? ""), [live, tab]);
  const held = useMemo(() => heldOf(live?.positions ?? [], tab ?? ""), [live, tab]);
  const digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const wins = useMemo(() => winRate(s?.lines ?? []), [s?.lines]);
  const target = view.targets?.max_drawdown ?? lineage?.targets?.max_drawdown;

  if (!listing) return <p className="grid h-full place-items-center text-dense text-fg-faint">Reading the paper runs…</p>;
  if (!listing.runs.length) {
    return <p className="grid h-full place-items-center text-dense text-fg-faint">No paper runs yet: hover a version in the graph and press ▶ to start one.</p>;
  }
  const readings = s?.readings ?? run?.live ?? null;
  const reading = run?.state === "sealed" ? run.seal : readings;
  const heldSymbols = new Set((live?.positions ?? []).map((p) => symbolOf(p.instrument_id)));
  const traded = new Set(fills.map((f) => f.symbol));
  const symbols = run?.symbols ?? [];
  const tabbed = symbols.filter((x) => symbols.length <= ALL_TABS || heldSymbols.has(x) || traded.has(x) || pinned.has(x) || x === tab);
  const rest = symbols.filter((x) => !tabbed.includes(x));
  const tabs: Tab<string | null>[] = [{ id: null, label: "Account" }, ...tabbed.map((x) => ({ id: x, label: x, dot: heldSymbols.has(x) ? "recommended" as const : undefined }))];
  const lastBar = readings?.last_bar_ns != null ? readings.last_bar_ns / 1e6 : null;
  const late = run?.state === "running" && lastBar !== null && now - lastBar > LATE_MS;
  const open = live ? (live.positions ?? []).reduce((sum, p) => sum + (amount(p.unrealized_pnl) ?? 0), 0) : null;
  const closed = (s?.lines ?? []).filter((l) => l.kind === "position" && l.type === "PositionClosed").length;
  const period = chosen ?? autoPeriod(s?.bars.length ?? 0);
  const digitsOf = digits.get(tab ?? "") ?? { price: 2, size: -1 };

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-3 pb-2 pt-1.5">
        <RunStrip runs={listing.runs} nodes={nodes} target={target} />
        {run && <RunMetrics items={[
          { label: "Equity", value: amount(reading?.final_equity_usdt), format: MONEY, suffix: " USDT" },
          { label: "Open P&L", value: open, format: SIGNED, suffix: " USDT", text: run.state === "sealed" ? "Booked at end" : undefined },
          // The run card's badge carries the return and the drawdown; the band says how much of the target it used.
          target ? { label: "Drawdown budget", text: reading?.max_drawdown == null ? undefined : `${Math.round((reading.max_drawdown / target) * 100)}% of ${pct(target)} used`,
                     warn: (reading?.max_drawdown ?? 0) > target }
            : { label: "Max drawdown", text: reading?.max_drawdown == null ? undefined : pct(reading.max_drawdown) },
          { label: "Win rate", value: closed ? wins : null, format: PERCENT, suffix: closed ? ` of ${closed}` : undefined, text: closed ? undefined : "0 closed" },
          { label: run.state === "sealed" ? "Stopped" : "Last bar", warn: late,
            text: run.state === "sealed" ? (run.seal?.stopped_ns ? `${utc(run.seal.stopped_ns / 1e6).slice(11, 16)} UTC` : undefined)
              : lastBar === null ? "Waiting" : `${utc(lastBar).slice(11, 16)} UTC${late ? ` · ${Math.round((now - lastBar) / 60_000)} min late` : ""}` },
        ]} />}
      </div>
      {run && <>
        <div className="flex h-9 shrink-0 items-end gap-2 border-b border-line px-2">
          <Tabs label="Account and contracts" items={tabs} value={tab} onChange={paperTab.set} />
          {rest.length > 0 && (
            <Dropdown label="Open a contract" trigger={<span className="text-dense text-fg-muted">+ Contract</span>}>
              {rest.map((x) => <DropdownItem key={x} onSelect={() => { setPinned(new Set([...pinned, x])); paperTab.set(x); }}>{x}</DropdownItem>)}
            </Dropdown>
          )}
          <span className="ml-auto flex items-center gap-3 self-center">
            {day && <span className="text-small text-fg-muted">{day} UTC</span>}
            {tab && <Tabs compact label="Candle period" items={PERIODS.map((p) => ({ id: p.id, label: p.id }))} value={period} onChange={setChosen} />}
          </span>
        </div>
        <div className="min-h-0 flex-1 p-1">
          {!s?.connected && !s?.seal && <p className="px-2 py-1 text-small text-fg-faint">Connecting to the run's journal…</p>}
          {tab
            ? <CandleChart key={tab} bars={s?.bars ?? []} minutes={PERIODS.find((p) => p.id === period)!.minutes} places={digitsOf.price < 0 ? 2 : digitsOf.price}
                           size={digitsOf.size} fills={mine} orders={orders} held={held} spans={spans} />
            : <EquityChart equity={readings?.equity ?? []} starting={amount(readings?.starting_balance_usdt) ?? 100_000} target={target} />}
        </div>
      </>}
    </div>
  );
}
