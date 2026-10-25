import { useEffect, useMemo, useRef, useState } from "react";
import { symbolOf, type JournalLine } from "../../lib/paperApi";
import { CATEGORIES, CATEGORY_LABEL, categoryOf, describe, eventMs, utc, utcDay, type Category } from "../../model/paper";
import { Icon } from "../../icons/Icon";
import { Chips, PillButton } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { highlighted, pickedDay, showTime, useStream } from "../../state/paperStream";

const SHOWN = 2000;  // the latest events listed; older ones stay in the journal
type Item = { line: JournalLine; children?: JournalLine[]; key: string; at: number };

/** The orders of one bracket (or other order list) under one row, from the lists their first events
 *  name; a group sits where its latest event does. */
function grouped(lines: readonly JournalLine[]): Item[] {
  const list = new Map<string, string>();
  for (const l of lines) if (l.kind === "order" && l.order_list_id && l.client_order_id) list.set(String(l.client_order_id), String(l.order_list_id));
  const groups = new Map<string, Item>();
  const out: Item[] = [];
  lines.forEach((line, i) => {
    const id = line.kind === "order" ? list.get(String(line.client_order_id)) : undefined;
    if (!id) { out.push({ line, key: `l${i}`, at: i }); return; }
    const group = groups.get(id);
    if (group) { group.children!.push(line); group.at = i; }
    else { const item = { line, children: [line], key: `g${id}`, at: i }; groups.set(id, item); out.push(item); }
  });
  return out.sort((a, b) => a.at - b.at);
}

function Row({ line, onPick, picked, indent = false }: { line: JournalLine; onPick: () => void; picked: boolean; indent?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (picked) ref.current?.scrollIntoView({ block: "nearest" }); }, [picked]);
  const category = categoryOf(line);
  return (
    <div ref={ref} role="row" onClick={onPick} data-selected={picked ? "" : undefined}
         className={`grid h-6 cursor-default grid-cols-[9.5rem_6rem_5.5rem_minmax(0,1fr)] items-center gap-2 border-b border-line px-3 transition-colors hover:bg-row-hover ${picked ? "bg-selection" : ""}`}>
      <span className="font-mono text-small text-fg-faint">{utc(eventMs(line))}</span>
      <span className="truncate font-mono text-small">{symbolOf(line.instrument_id) || ""}</span>
      <span className={`text-small ${category === "strategy" || line.kind === "data_gap" ? "text-misses" : "text-fg-muted"}`}>{category ? CATEGORY_LABEL[category] : ""}</span>
      <span className={`truncate ${indent ? "pl-4" : ""}`}>{describe(line)}</span>
    </div>
  );
}

/** The run's events, newest first, filtered by category; a bracket's orders fold into one row. While the
 *  list is scrolled away from its top, new events wait behind "N new events" instead of moving it. A
 *  click shows the moment on the chart; a click on a chart marker highlights its event here. */
export function Events() {
  const s = useStream();
  const day = useAtom(pickedDay);
  const picked = useAtom(highlighted);
  const [on, setOn] = useState<ReadonlySet<Category>>(new Set(CATEGORIES));
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [held, setHeld] = useState<number | null>(null);  // the count of lines shown while scrolled away
  const host = useRef<HTMLDivElement>(null);
  const all = s?.lines ?? [];
  useEffect(() => {
    const viewport = host.current?.closest<HTMLElement>(".overflow-auto");
    if (!viewport) return;
    const scrolled = () => setHeld((h) => (viewport.scrollTop > 4 ? h ?? all.length : null));
    viewport.addEventListener("scroll", scrolled);
    return () => viewport.removeEventListener("scroll", scrolled);
  }, [all.length]);
  const lines = held === null ? all : all.slice(0, held);
  const events = useMemo(() => lines.filter((l) => categoryOf(l) !== null), [lines]);
  const counts = useMemo(() => new Map(CATEGORIES.map((c) => [c, events.filter((l) => categoryOf(l) === c).length])), [events]);
  const items = useMemo(() => grouped(events.filter((l) => on.has(categoryOf(l)!) && (!day || utcDay(eventMs(l)) === day)))
    .slice(-SHOWN).reverse(), [events, on, day]);
  const waiting = held === null ? 0 : all.slice(held).filter((l) => categoryOf(l) !== null).length;
  const pick = (line: JournalLine) => { highlighted.set(line); showTime(eventMs(line)); };
  useEffect(() => {  // a marker picked on the chart opens its bracket
    const item = picked && items.find((i) => i.children?.includes(picked));
    if (item) setOpen((o) => new Set([...o, item.key]));
  }, [picked, items]);
  if (!s) return <p className="p-3 text-dense text-fg-faint">Open a paper run in the Paper panel</p>;
  return (
    <div ref={host} className="text-dense">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-island px-3 py-1.5">
        <Chips items={CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: counts.get(c) ?? 0 }))} on={on}
               onToggle={(c) => setOn(new Set(on.has(c) ? [...on].filter((x) => x !== c) : [...on, c]))} />
        {day && <span className="text-small text-fg-muted">{day} only</span>}
        {waiting > 0 && <span className="ml-auto"><PillButton onClick={() => { host.current?.closest(".overflow-auto")?.scrollTo({ top: 0 }); setHeld(null); }}>
          <Icon name="arrow-up" size={12} />{waiting} new {waiting === 1 ? "event" : "events"}
        </PillButton></span>}
      </div>
      {items.length === 0 && <p className="px-3 py-2 text-fg-faint">No events{day ? " that day" : ""} in the chosen categories</p>}
      {items.map((item) => item.children && item.children.length > 1 ? (
        <div key={item.key}>
          <div role="row" onClick={() => setOpen(new Set(open.has(item.key) ? [...open].filter((k) => k !== item.key) : [...open, item.key]))}
               className="flex h-6 cursor-default items-center gap-1 border-b border-line px-2 transition-colors hover:bg-row-hover">
            <span className={`grid text-icon transition-transform ${open.has(item.key) ? "rotate-90" : ""}`}><Icon name="chevron-right" size={12} /></span>
            <span className="font-mono text-small text-fg-faint">{utc(eventMs(item.children[item.children.length - 1]!))}</span>
            <span className="ml-2 font-mono text-small">{symbolOf(item.line.instrument_id)}</span>
            <span className="ml-2 truncate">Order list {String(item.line.order_list_id ?? "")} · {item.children.length} events · {describe(item.children[item.children.length - 1]!)}</span>
          </div>
          {open.has(item.key) && [...item.children].reverse().map((line, i) => <Row key={i} line={line} indent picked={line === picked} onPick={() => pick(line)} />)}
        </div>
      ) : <Row key={item.key} line={item.line} picked={item.line === picked} onPick={() => pick(item.line)} />)}
    </div>
  );
}
