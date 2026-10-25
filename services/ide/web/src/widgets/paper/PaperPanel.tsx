import { useEffect, useMemo, useState } from "react";
import type { LineageWidget } from "../../model/types";
import { useView, useWidget } from "../../model/view";
import { fills as fillsOf, priceLines, spans as spansOf, winRate } from "../../model/paper";
import { PERIODS, type Period } from "../../lib/bars";
import { amount, symbolOf } from "../../lib/paperApi";
import { Dropdown, DropdownItem } from "../../components/Dropdown";
import { MetricStrip } from "../../components/MetricStrip";
import { Tabs, type Tab } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { paperTab, selectedRun, usePaperRuns } from "../../state/paper";
import { follow, pickedDay, useStream } from "../../state/paperStream";
import { CandleChart } from "./CandleChart";
import { EquityChart } from "./EquityChart";
import { RunStrip, useNow } from "./RunStrip";

const ALL_TABS = 6;  // a run of at most this many contracts shows a tab for each

/** The Paper panel in the editor: the run cards, the selected run's metrics, its Account tab (equity
 *  and drawdown) and a tab per contract it trades (candles with its fills, orders and positions). */
export function PaperPanel() {
  const listing = usePaperRuns();
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage@2");
  const selected = useAtom(selectedRun);
  const tab = useAtom(paperTab);
  const day = useAtom(pickedDay);
  const [period, setPeriod] = useState<Period>("15m");
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const now = useNow();
  const run = listing?.runs.find((r) => r.paper_id === selected) ?? null;
  useEffect(() => { follow(run?.paper_id ?? null, tab); }, [run?.paper_id, tab]);
  useEffect(() => { setPinned(new Set()); pickedDay.set(null); }, [run?.paper_id]);
  const stream = useStream();
  const s = stream && stream.paperId === run?.paper_id ? stream : null;
  const nodes = useMemo(() => new Map((lineage?.nodes ?? []).map((n) => [n.id, n])), [lineage]);
  const fills = useMemo(() => fillsOf(s?.lines ?? []), [s?.lines]);
  const mine = useMemo(() => fills.filter((f) => f.symbol === tab), [fills, tab]);
  const spans = useMemo(() => spansOf(fills, tab ?? ""), [fills, tab]);
  const orders = useMemo(() => priceLines(s?.state?.orders ?? [], tab ?? ""), [s?.state, tab]);
  const wins = useMemo(() => winRate(s?.lines ?? []), [s?.lines]);
  const target = view.targets?.max_drawdown ?? lineage?.targets?.max_drawdown;

  if (!listing) return <p className="grid h-full place-items-center text-dense text-fg-faint">Reading the paper runs…</p>;
  if (!listing.runs.length) {
    return <p className="grid h-full place-items-center text-dense text-fg-faint">No paper runs yet: hover a version in the graph and press ▶ to start one.</p>;
  }
  const readings = s?.readings ?? run?.live ?? null;
  const reading = run?.state === "sealed" ? run.seal : readings;
  const held = new Set((s?.state?.positions ?? []).map((p) => symbolOf(p.instrument_id)));
  const traded = new Set(fills.map((f) => f.symbol));
  const symbols = run?.symbols ?? [];
  const tabbed = symbols.filter((x) => symbols.length <= ALL_TABS || held.has(x) || traded.has(x) || pinned.has(x) || x === tab);
  const rest = symbols.filter((x) => !tabbed.includes(x));
  const tabs: Tab<string | null>[] = [{ id: null, label: "Account" }, ...tabbed.map((x) => ({ id: x, label: x, dot: held.has(x) ? "recommended" as const : undefined }))];
  const lagMs = readings?.last_bar_ns != null && run?.state === "running" ? now - readings.last_bar_ns / 1e6 : null;

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <RunStrip runs={listing.runs} nodes={nodes} target={target} />
      {run && <>
        <div className="shrink-0 px-3">
          <MetricStrip items={[
            { label: "Equity", value: amount(reading?.final_equity_usdt), format: { style: "currency", currency: "USD", maximumFractionDigits: 0 } },
            { label: "Fills", value: reading?.fills, format: { maximumFractionDigits: 0 } },
            { label: "Win rate", value: wins, format: { style: "percent", maximumFractionDigits: 1 } },
            { label: "Data lag", value: lagMs == null ? null : Math.max(0, lagMs / 1000), format: { style: "unit", unit: "second", maximumFractionDigits: 0 },
              tone: lagMs != null && lagMs > 120_000 ? "misses" : undefined },
          ]} />
        </div>
        <div className="flex h-10 shrink-0 items-center gap-2 border-y border-line px-2">
          <Tabs label="Account and contracts" items={tabs} value={tab} onChange={paperTab.set} />
          {rest.length > 0 && (
            <Dropdown label="Open a contract" trigger={<span className="text-dense text-fg-muted">+ Contract</span>}>
              {rest.map((x) => <DropdownItem key={x} onSelect={() => { setPinned(new Set([...pinned, x])); paperTab.set(x); }}>{x}</DropdownItem>)}
            </Dropdown>
          )}
          <span className="ml-auto flex items-center gap-3">
            {day && <span className="text-small text-fg-muted">{day} UTC</span>}
            {tab && <Tabs compact label="Candle period" items={PERIODS.map((p) => ({ id: p.id, label: p.id }))} value={period} onChange={setPeriod} />}
          </span>
        </div>
        <div className="min-h-0 flex-1 p-1">
          {!s?.connected && !s?.seal && <p className="px-2 py-1 text-small text-fg-faint">Connecting to the run's journal…</p>}
          {tab
            ? <CandleChart key={tab} bars={s?.bars ?? []} minutes={PERIODS.find((p) => p.id === period)!.minutes}
                           fills={mine} orders={orders} spans={spans} />
            : <EquityChart equity={readings?.equity ?? []} starting={amount(readings?.starting_balance_usdt) ?? 100_000} target={target} />}
        </div>
      </>}
    </div>
  );
}
