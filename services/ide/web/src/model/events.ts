// The Events list's rows: lines in time order, the orders of one bracket (or other order list) folded
// under one row that says what the bracket was and how it stands.
import { amount, fixed, symbolOf, type JournalLine, type Precision } from "../lib/paperApi";
import { eventMs, last, word } from "./paper";

export type Item = { line: JournalLine; children?: JournalLine[]; key: string; at: number };
/** A row's status, if it has one: failed (denied, rejected) stands out; the rest is quiet. */
export type Status = { text: string; failed: boolean };

const FAILED = new Set(["Denied", "Rejected"]);
const WORKING = new Set(["Initialized", "Submitted", "Accepted", "Released", "Triggered"]);
const status = (line: JournalLine): string => String(line.type ?? "").replace(/^Order/, "");

/** Each event a row, or a bracket's events under one; rows sit at their (latest) event's time, oldest first. */
export function grouped(lines: readonly JournalLine[]): Item[] {
  const list = new Map<string, string>();
  for (const l of lines) if (l.kind === "order" && l.order_list_id && l.client_order_id) list.set(String(l.client_order_id), String(l.order_list_id));
  const groups = new Map<string, Item>();
  const out: Item[] = [];
  lines.forEach((line, i) => {
    const id = line.kind === "order" ? list.get(String(line.client_order_id)) : undefined;
    if (!id) { out.push({ line, key: `l${i}`, at: eventMs(line) }); return; }
    const group = groups.get(id);
    if (group) { group.children!.push(line); group.at = Math.max(group.at, eventMs(line)); }
    else { const item = { line, children: [line], key: `g${id}`, at: eventMs(line) }; groups.set(id, item); out.push(item); }
  });
  return out.sort((a, b) => a.at - b.at);
}

/** A bracket's legs from their orders' first events: the entry, its target and its stop. */
function legs(children: readonly JournalLine[]) {
  const first = new Map<string, JournalLine>();
  for (const l of children) if (l.client_order_id && l.order_type && !first.has(String(l.client_order_id))) first.set(String(l.client_order_id), l);
  const all = [...first.values()];
  return {
    all, entry: all.find((l) => !l.reduce_only), stop: all.find((l) => last(l.order_type).includes("STOP")),
    target: all.find((l) => l.reduce_only && !last(l.order_type).includes("STOP")),
  };
}

/** A bracket in words, in the contract's decimals: "Bracket · Buy 0.010 market · TP 81,190.50 · SL 79,582.70". */
export function bracket(children: readonly JournalLine[], digits: ReadonlyMap<string, Precision>): string {
  const { all, entry, stop, target } = legs(children);
  const d = digits.get(symbolOf(children[0]?.instrument_id)) ?? { price: -1, size: -1 };
  const parts = [all.length > 1 && stop && target ? "Bracket" : "Order list"];
  if (entry) parts.push(`${word(entry.order_side)} ${fixed(entry.quantity, d.size) ?? ""} ${word(entry.order_type).toLowerCase()}${amount(entry.price) != null ? ` @ ${fixed(entry.price, d.price)}` : ""}`);
  if (target) parts.push(`TP ${fixed(target.price, d.price)}`);
  if (stop) parts.push(`SL ${fixed(stop.trigger_price, d.price)}`);
  return parts.join(" · ");
}

/** How a bracket stands: a failure of any leg; else closed by its target or stop once one fills, open
 *  while its entry is filled and its exits work, canceled once nothing works, or its entry's status. */
export function bracketStatus(children: readonly JournalLine[]): Status {
  const failed = children.find((l) => FAILED.has(status(l)));
  if (failed) return { text: status(failed), failed: true };
  const { entry, stop, target } = legs(children);
  const latest = (leg: JournalLine | undefined) => leg && status([...children].reverse().find((l) => l.client_order_id === leg.client_order_id)!);
  if (latest(target) === "Filled") return { text: "Closed by TP", failed: false };
  if (latest(stop) === "Filled") return { text: "Closed by SL", failed: false };
  const exits = [stop, target].filter(Boolean).map(latest);
  if (latest(entry) === "Filled") return { text: exits.length && exits.every((s) => s === "Canceled") ? "Canceled" : "Open", failed: false };
  const now = latest(entry) ?? status(children[children.length - 1]!);
  return { text: WORKING.has(now) ? "Working" : now, failed: false };
}

/** A single order line's status chip, when it is one. */
export const lineStatus = (line: JournalLine): Status | null => (line.kind === "order" && FAILED.has(status(line)) ? { text: status(line), failed: true } : null);
