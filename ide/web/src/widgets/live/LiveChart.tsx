import { useEffect, useMemo, useState } from "react";
import { TextButton } from "../../components/TextButton";
import { Typing } from "../../components/Typing";
import { fetchMinutes, type FetchedMinutes } from "../../lib/minutesApi";
import type { JournalLine } from "../../lib/paperApi";
import { liveChart } from "../../model/liveChart";
import type { LiveRun } from "../../model/liveTrading";
import { CandleChart } from "../paper/CandleChart";

const NONE: never[] = [];
const MINUTE = 60_000;

/** One contract of a live run as the paper chart draws one: Binance's public one-minute candles around the run
 *  and its own native fills as arrows, unnetted, so no position box. Live keeps no equity series, so there
 *  is no equity view; while the run executes the minutes are read again each minute. Mounted per run and contract. */
export function LiveChart({ run, symbol }: { run: LiveRun; symbol: string | null }) {
  const [now, setNow] = useState(() => Date.now()), [tries, setTries] = useState(0);
  const plan = useMemo(() => liveChart(run, now, symbol), [run, now, symbol]);
  const [read, setRead] = useState<{ key: string; got: FetchedMinutes } | null>(null);
  // The last window read whole: kept drawn while the next is read, and when a read fails.
  const [drawn, setDrawn] = useState<{ head: string; bars: JournalLine[] } | null>(null);
  const key = plan ? `${plan.symbol}:${plan.from}:${plan.to}` : "", head = plan ? `${plan.symbol}:${plan.from}` : "";
  useEffect(() => {
    if (!plan?.running) return;
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, [plan?.running]);
  useEffect(() => {
    if (!plan) return;
    let current = true;
    void fetchMinutes(plan.symbol, plan.from, plan.to).then((got) => {
      if (!current) return;
      setRead({ key, got });
      if (got.kind === "bars") setDrawn({ head, bars: got.bars });
    });
    return () => { current = false; };
  }, [key, tries]);
  if (!plan) return <p className="grid h-full place-items-center px-3 text-dense text-fg-faint">No order or account observation places this run in time yet.</p>;
  const bars = drawn?.head === head ? drawn.bars : null, failed = read?.key === key && read.got.kind === "absent" ? read.got.message : null;
  if (!bars && !failed) return <div className="grid h-full place-items-center text-dense text-fg-faint"><Typing text={`Reading ${plan.symbol} minutes…`} busy /></div>;
  if (!bars) return <div className="grid h-full place-items-center px-3 text-center text-dense text-fg-faint">
    <p>{plan.symbol} minutes are unavailable here · {failed} <TextButton onClick={() => setTries((n) => n + 1)}>Retry</TextButton></p>
  </div>;
  const note = `Binance public 1m · native fills, no equity series in Live${failed ? ` · last read failed: ${failed}` : ""}`;
  return <CandleChart remembers={`live:${run.id}:${plan.symbol}`} symbol={plan.symbol} bars={bars} lead={null} note={note} stretches={NONE}
    places={plan.places} size={plan.size} fills={plan.fills} boxes={false} orders={NONE} held={null} events={NONE} live={plan.running}
    restarts={NONE} openFrom={null} started={null} fit={0} />;
}
