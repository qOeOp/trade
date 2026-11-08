import { dateTime, type TimeZone } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { usePhone } from "../../state/phone";
import { useMemo } from "react";
import { coinsAt, MORE, type NewsItem } from "../../model/market";
import { marketCoin, newsKind, useMarketView, useNews, useSnapshot } from "../../state/market";
import { useAtom } from "../../state/atom";
import { useOnMarketPage } from "../../state/shell";
import { columns, DataTable, type Column } from "../../components/DataTable";
import { Tabs } from "../../components/Tabs";
import { TextButton } from "../../components/TextButton";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** How long ago, in the largest whole unit. */
const age = (at: number, now: number) => { const ms = Math.max(0, now - at); return ms < HOUR ? `${Math.floor(ms / MINUTE)}m` : ms < DAY ? `${Math.floor(ms / HOUR)}h` : `${Math.floor(ms / DAY)}d`; };

type Row = NewsItem & { bases: [string, string][] };
const col = columns<Row>();
const COLUMNS = (now: number, zone: TimeZone): Column<Row>[] => [
  col.accessor("at", { header: "Age", meta: { numeric: true, width: "w-14" }, enableSorting: false,
    cell: (c) => <span title={dateTime(c.getValue(), zone)} className="text-fg-faint">{age(c.getValue(), now)}</span> }) as Column<Row>,
  col.accessor("source", { header: "Source", meta: { width: "w-28" }, enableSorting: false, cell: (c) => <span className="block truncate text-fg-muted">{c.getValue()}</span> }) as Column<Row>,
  col.accessor("title", { header: "Headline", enableSorting: false,
    cell: (c) => <a href={c.row.original.link} target="_blank" rel="noreferrer" title={c.getValue()} className="block truncate hover:underline focus-visible:underline">{c.getValue()}</a> }) as Column<Row>,
  col.accessor("bases", { header: "Coins", meta: { width: "w-32" }, enableSorting: false,
    cell: (c) => (
      <span className="-mx-1 flex min-w-0 overflow-hidden">
        {(c.getValue() as Row["bases"]).map(([symbol, base]) => (
          <TextButton key={symbol} onClick={() => marketCoin.set(symbol)} className="shrink-0">{base}</TextButton>
        ))}
      </span>
    ) }) as Column<Row>,
];

/** A phone's width: its age and the whole headline, however many lines that takes. */
const PHONE_COLUMNS = (now: number, zone: TimeZone): Column<Row>[] => [COLUMNS(now, zone)[0]!,
  col.accessor("title", { header: "Headline", enableSorting: false,
    cell: (c) => <a href={c.row.original.link} target="_blank" rel="noreferrer" className="block whitespace-normal py-2">{c.getValue()}</a> }) as Column<Row>];

const KINDS = [{ id: "all", label: "All" }, { id: "news", label: "Articles" }, { id: "announcement", label: "Announcements" }] as const;

/** The News window's header: articles, announcements or both, and the level they are for with their count. */
export function NewsTools() {
  const kind = useAtom(newsKind), { scope, rows } = useHeadlines();
  return (
    <>
      <h2 className="shrink-0 font-semibold">News</h2>
      <Tabs compact label="Kind" value={kind} onChange={newsKind.set} items={KINDS} />
      {rows && <span className="ml-auto whitespace-nowrap text-dense tabular-nums text-fg-faint">{scope} · {rows.length}</span>}
    </>
  );
}

/** The last week's headlines of the Market page's level, the newest first: those naming the picked coin,
 *  else one of the level's coins, else all at the top level. Outside the Market page it says where it
 *  belongs. */
export function NewsWindow() {
  const page = useOnMarketPage(), { rows, now, scope } = useHeadlines();
  const zone = useTimeZone();
  const phone = usePhone(), cols = useMemo(() => (phone ? PHONE_COLUMNS : COLUMNS)(now, zone), [phone, now, zone]);
  if (!page) return <p className="p-4 text-fg-faint">The news of the Market page's level.</p>;
  if (!rows) return <p className="p-4 text-fg-faint">Reading the news…</p>;
  if (!rows.length) return <p className="p-4 text-fg-faint">No headlines for {scope} in the last week.</p>;
  return <DataTable data={rows} columns={cols} rowId={(r) => r.link} fixed />;
}

function useHeadlines(): { scope: string; rows: Row[] | null; now: number } {
  const snapshot = useSnapshot(), items = useNews(), kind = useAtom(newsKind), { path, coin, size } = useMarketView();
  return useMemo(() => {
    const now = Date.now();
    if (!snapshot || !items) return { scope: "", rows: null, now };
    const bases = new Map(snapshot.coins.map((c) => [c.symbol, c.base]));
    const picked = coin ? snapshot.coins.find((c) => c.symbol === coin) : undefined;
    const level = picked ? new Set([picked.symbol]) : path.length ? new Set(coinsAt(snapshot, path, size).map((c) => c.symbol)) : null;
    const rows = items.filter((i) => (kind === "all" || i.kind === kind) && (!level || i.symbols.some((s) => level.has(s))))
      .map((i) => ({ ...i, bases: i.symbols.flatMap((s): [string, string][] => { const b = bases.get(s); return b ? [[s, b]] : []; }) }));
    return { scope: picked?.base ?? path.filter((p) => p !== MORE).at(-1) ?? "All", rows, now };
  }, [snapshot, items, kind, path, coin, size]);
}
