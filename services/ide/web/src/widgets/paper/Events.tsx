import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { symbolOf, type JournalLine } from "../../lib/paperApi";
import { CATEGORIES, CATEGORY_LABEL, categoryOf, describe, eventMs, utc, utcDay, type Category } from "../../model/paper";
import { bracket, bracketStatus, grouped, lineStatus, type Status } from "../../model/events";
import { Icon } from "../../icons/Icon";
import { Chips, PillButton } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { paperTab } from "../../state/paper";
import { highlighted, pickedDay, showTime, useStream } from "../../state/paperStream";

const SHOWN = 2000;  // the latest events listed; older ones stay in the journal
// One grid for every row: chevron gutter, time, contract, category, text, status.
const GRID = "grid h-6 cursor-default grid-cols-[1rem_4.5rem_6rem_5.5rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-line pl-1.5 pr-3 transition-colors hover:bg-row-hover";
const clock = (ms: number) => utc(ms).slice(11);

function Chip({ status }: { status: Status | null }) {
  if (!status) return <span />;
  return status.failed
    ? <span className="inline-flex items-center gap-1 text-small text-fail"><Icon name="warning" size={12} />{status.text}</span>
    : <span className="text-small text-fg-faint">{status.text}</span>;
}

function Row({ line, onClick, picked, gutter, category, text, status, title }: {
  line: JournalLine; onClick: () => void; picked: boolean; gutter?: ReactNode; category?: string; text: ReactNode; status: Status | null; title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (picked) ref.current?.scrollIntoView({ block: "nearest" }); }, [picked]);
  const c = categoryOf(line);
  return (
    <div ref={ref} role="row" onClick={onClick} title={title} data-selected={picked ? "" : undefined} className={GRID}>
      <span className="grid place-items-center text-icon">{gutter}</span>
      <span className="font-mono text-small text-fg-faint">{clock(eventMs(line))}</span>
      <span className="truncate font-mono text-small">{symbolOf(line.instrument_id) || ""}</span>
      <span className={`text-small ${c === "strategy" || line.kind === "data_gap" ? "text-misses" : "text-fg-muted"}`}>{category ?? (c ? CATEGORY_LABEL[c] : "")}</span>
      <span className="truncate">{text}</span>
      <Chip status={status} />
    </div>
  );
}

/** The run's events, newest first under a row per UTC day, filtered by category and, on a contract
 *  tab, by contract (run-wide events always show); a bracket's orders fold into one row that says what
 *  it was and how it stands, a failed order marked. While the list is scrolled away from its top, new
 *  events wait behind "N new events" instead of moving it. A click shows the moment on the chart; a
 *  click on a chart marker highlights its event here. */
export function Events() {
  const s = useStream();
  const day = useAtom(pickedDay);
  const picked = useAtom(highlighted);
  const tab = useAtom(paperTab);
  const [all, setAll] = useState(false);
  const [on, setOn] = useState<ReadonlySet<Category>>(new Set(CATEGORIES));
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [held, setHeld] = useState<number | null>(null);  // the count of lines shown while scrolled away
  const host = useRef<HTMLDivElement>(null);
  const journal = s?.lines ?? [];
  useEffect(() => {
    const viewport = host.current?.closest<HTMLElement>(".overflow-auto");
    if (!viewport) return;
    const scrolled = () => setHeld((h) => (viewport.scrollTop > 4 ? h ?? journal.length : null));
    viewport.addEventListener("scroll", scrolled);
    return () => viewport.removeEventListener("scroll", scrolled);
  }, [journal.length]);
  const only = tab && !all ? tab : null;
  const lines = held === null ? journal : journal.slice(0, held);
  const events = useMemo(() => lines.filter((l) => categoryOf(l) !== null && (!only || !l.instrument_id || symbolOf(l.instrument_id) === only)), [lines, only]);
  const counts = useMemo(() => new Map(CATEGORIES.map((c) => [c, events.filter((l) => categoryOf(l) === c).length])), [events]);
  const items = useMemo(() => grouped(events.filter((l) => on.has(categoryOf(l)!) && (!day || utcDay(eventMs(l)) === day)))
    .slice(-SHOWN).reverse(), [events, on, day]);
  const waiting = held === null ? 0 : journal.slice(held).filter((l) => categoryOf(l) !== null).length;
  const pick = (line: JournalLine) => { highlighted.set(line); showTime(eventMs(line)); };
  useEffect(() => {  // a marker picked on the chart opens its bracket
    const item = picked && items.find((i) => i.children?.includes(picked));
    if (item) setOpen((o) => new Set([...o, item.key]));
  }, [picked, items]);
  if (!s) return <p className="p-3 text-dense text-fg-faint">Open a paper run in the Paper panel</p>;
  const toggle = (key: string) => setOpen(new Set(open.has(key) ? [...open].filter((k) => k !== key) : [...open, key]));
  return (
    <div ref={host} className="text-dense">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-island px-3 py-1.5">
        <Chips items={CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: counts.get(c) ?? 0 }))} on={on}
               onToggle={(c) => setOn(new Set(on.has(c) ? [...on].filter((x) => x !== c) : [...on, c]))} />
        {day && <span className="text-small text-fg-muted">{day} only</span>}
        <span className="ml-auto flex items-center gap-2">
          {waiting > 0 && <PillButton onClick={() => { host.current?.closest(".overflow-auto")?.scrollTo({ top: 0 }); setHeld(null); }}>
            <Icon name="arrow-up" size={12} />{waiting} new {waiting === 1 ? "event" : "events"}
          </PillButton>}
          {tab && <PillButton onClick={() => setAll(!all)}>{all ? `Only ${tab}` : "All contracts"}</PillButton>}
        </span>
      </div>
      {items.length === 0 && <p className="px-3 py-2 text-fg-faint">No events{day ? " that day" : ""} in the chosen categories</p>}
      {items.map((item, i) => {
        const date = utcDay(item.at), next = items[i - 1];
        const separator = !next || utcDay(next.at) !== date
          ? <div className="flex h-6 items-end border-b border-line px-3 pb-0.5 text-small font-semibold text-fg-muted">{date}</div> : null;
        const children = item.children;
        if (!children || children.length < 2) {
          return <Fragment key={item.key}>{separator}<Row line={item.line} picked={item.line === picked} onClick={() => pick(item.line)} text={describe(item.line)} status={lineStatus(item.line)} /></Fragment>;
        }
        const latest = children[children.length - 1]!;
        return (
          <Fragment key={item.key}>
            {separator}
            <Row line={latest} picked={false} onClick={() => toggle(item.key)} category="Orders" text={<>{bracket(children)} <span className="text-fg-faint">· {children.length} events</span></>}
                 status={bracketStatus(children)} title={String(item.line.order_list_id ?? "")}
                 gutter={<span className={`grid transition-transform ${open.has(item.key) ? "rotate-90" : ""}`}><Icon name="chevron-right" size={12} /></span>} />
            {open.has(item.key) && [...children].reverse().map((line, j) => (
              <Row key={j} line={line} picked={line === picked} onClick={() => pick(line)} text={<span className="pl-3 text-fg-muted">{describe(line)}</span>} status={lineStatus(line)} />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
