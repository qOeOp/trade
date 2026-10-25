import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { precisions, symbolOf, type JournalLine } from "../../lib/paperApi";
import { CATEGORIES, CATEGORY_LABEL, categoryOf, describe, eventMs, utc, utcDay } from "../../model/paper";
import { bracket, bracketStatus, grouped, lineStatus, type Status } from "../../model/events";
import { Icon } from "../../icons/Icon";
import { Chips, PillButton } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { highlighted, pickedDay, showTime, shownCategories, useStream } from "../../state/paperStream";

const SHOWN = 2000;  // the latest events listed; older ones stay in the journal
// One grid for every row: chevron gutter, time, contract, category, text with its status.
const GRID = "grid h-9 cursor-default grid-cols-[1rem_3rem_6rem_5.5rem_minmax(0,1fr)] items-center gap-2 border-t border-line pl-3 pr-5 transition-colors hover:bg-row-hover";
const clock = (ms: number) => utc(ms).slice(11, 16);
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The run's events of the contract in scope (run-wide events always show). */
function useScoped(lines: readonly JournalLine[], only: string | null) {
  return useMemo(() => lines.filter((l) => categoryOf(l) !== null && (!only || !l.instrument_id || symbolOf(l.instrument_id) === only)), [lines, only]);
}

/** The events' filter: a chip per category with its count. */
export function EventsTools({ only }: { only: string | null }) {
  const s = useStream();
  const on = useAtom(shownCategories);
  const events = useScoped(s?.lines ?? [], only);
  const counts = useMemo(() => new Map(CATEGORIES.map((c) => [c, events.filter((l) => categoryOf(l) === c).length])), [events]);
  return (
    <Chips items={CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: counts.get(c) ?? 0 }))} on={on}
           onToggle={(c) => shownCategories.set(new Set(on.has(c) ? [...on].filter((x) => x !== c) : [...on, c]))} />
  );
}

/** A row's status as a small chip after its text; a failure in the fail colour with its icon. */
function Chip({ status }: { status: Status | null }) {
  if (!status) return null;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-badge border px-1.5 text-small leading-4 ${status.failed ? "border-fail text-fail" : "border-line-strong text-fg-muted"}`}>
      {status.failed && <Icon name="warning" size={12} />}{status.text}
    </span>
  );
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
      <span className="flex min-w-0 items-center gap-2"><span className="truncate">{text}</span><Chip status={status} /></span>
    </div>
  );
}

/** The run's events, newest first under a row per UTC day, filtered by the header's categories and
 *  contract the chart shows; a bracket's orders fold into one row that says what it was and how it stands, a
 *  failed order marked. While the list is scrolled away from its top, new events wait behind "N new
 *  events" instead of moving it. A click shows the moment on the chart; a click on a chart marker
 *  highlights its event here. */
export function Events({ only }: { only: string | null }) {
  const s = useStream();
  const day = useAtom(pickedDay);
  const picked = useAtom(highlighted);
  const on = useAtom(shownCategories);
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
  const events = useScoped(held === null ? journal : journal.slice(0, held), only);
  const digits = useMemo(() => precisions(journal), [journal]);
  const items = useMemo(() => grouped(events.filter((l) => on.has(categoryOf(l)!) && (!day || utcDay(eventMs(l)) === day)))
    .slice(-SHOWN).reverse(), [events, on, day]);
  const waiting = held === null ? 0 : journal.slice(held).filter((l) => categoryOf(l) !== null).length;
  const pick = (line: JournalLine) => { highlighted.set(line); showTime(eventMs(line)); };
  useEffect(() => {  // a marker picked on the chart opens its bracket
    const item = picked && items.find((i) => i.children?.includes(picked));
    if (item) setOpen((o) => new Set([...o, item.key]));
  }, [picked, items]);
  if (!s) return null;
  const toggle = (key: string) => setOpen(new Set(open.has(key) ? [...open].filter((k) => k !== key) : [...open, key]));
  return (
    <div ref={host} className="text-dense">
      {(waiting > 0 || day) && (
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-island px-3 py-1">
          {day && <span className="text-small text-fg-muted">{day} only</span>}
          {waiting > 0 && <span className="ml-auto"><PillButton onClick={() => { host.current?.closest(".overflow-auto")?.scrollTo({ top: 0 }); setHeld(null); }}>
            <Icon name="arrow-up" size={12} />{waiting} new {waiting === 1 ? "event" : "events"}
          </PillButton></span>}
        </div>
      )}
      {items.length === 0 && <p className="px-3 py-2 text-fg-faint">No events{day ? " that day" : ""} in the chosen categories</p>}
      {items.map((item, i) => {
        const date = utcDay(item.at), next = items[i - 1];
        const separator = !next || utcDay(next.at) !== date
          ? <div className="flex h-8 items-end border-t border-line px-5 pb-1 text-small font-medium text-fg-muted">{DAY.format(item.at).replace(",", "")}</div> : null;
        const children = item.children;
        if (!children || children.length < 2) {
          return <Fragment key={item.key}>{separator}<Row line={item.line} picked={item.line === picked} onClick={() => pick(item.line)} text={describe(item.line, digits)} status={lineStatus(item.line)} /></Fragment>;
        }
        const latest = children[children.length - 1]!;
        return (
          <Fragment key={item.key}>
            {separator}
            <Row line={latest} picked={false} onClick={() => toggle(item.key)} category="Orders" text={<>{bracket(children, digits)} <span className="text-fg-faint">· {children.length} events</span></>}
                 status={bracketStatus(children)} title={String(item.line.order_list_id ?? "")}
                 gutter={<span className={`grid transition-transform ${open.has(item.key) ? "rotate-90" : ""}`}><Icon name="chevron-right" size={12} /></span>} />
            {open.has(item.key) && [...children].reverse().map((line, j) => (
              <Row key={j} line={line} picked={line === picked} onClick={() => pick(line)} text={<span className="pl-3 text-fg-muted">{describe(line, digits)}</span>} status={lineStatus(line)} />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
