// The Events list's rows: lines in time order, the orders of one bracket (or other order list) folded
// under one row that says what the bracket was and how it stands.
import { amount, priceText, type JournalLine } from "../lib/paperApi";
import { eventMs, last } from "./paper";

export type Item = { line: JournalLine; children?: JournalLine[]; key: string; at: number };
/** A row's status, if it has one: failed (denied, rejected) stands out; the rest is quiet. */
export type Status = { text: string; failed: boolean };

const FAILED = new Set(["Denied", "Rejected"]);
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

/** A bracket in words from its orders' first events: "Bracket · Buy 0.01 market · TP 101.86 · SL 99.84". */
export function bracket(children: readonly JournalLine[]): string {
  const first = new Map<string, JournalLine>();
  for (const l of children) if (l.client_order_id && l.order_type && !first.has(String(l.client_order_id))) first.set(String(l.client_order_id), l);
  const legs = [...first.values()];
  const entry = legs.find((l) => !l.reduce_only), stop = legs.find((l) => last(l.order_type).includes("STOP")), target = legs.find((l) => l.reduce_only && !last(l.order_type).includes("STOP"));
  const parts = [legs.length > 1 && stop && target ? "Bracket" : "Order list"];
  if (entry) parts.push(`${last(entry.order_side) === "BUY" ? "Buy" : "Sell"} ${String(entry.quantity ?? "")} ${last(entry.order_type).toLowerCase().replace("_", " ")}${amount(entry.price) != null ? ` @ ${priceText(entry.price)}` : ""}`);
  if (target) parts.push(`TP ${priceText(target.price)}`);
  if (stop) parts.push(`SL ${priceText(stop.trigger_price)}`);
  return parts.join(" · ");
}

/** A bracket's standing: a failure of any leg, else its entry's latest status. */
export function bracketStatus(children: readonly JournalLine[]): Status {
  const failed = children.find((l) => FAILED.has(status(l)));
  if (failed) return { text: status(failed), failed: true };
  const entry = children.find((l) => l.order_type && !l.reduce_only);
  const latest = [...children].reverse().find((l) => entry && l.client_order_id === entry.client_order_id);
  return { text: latest ? status(latest) : status(children[children.length - 1]!), failed: false };
}

/** A single order line's status chip, when it is one. */
export const lineStatus = (line: JournalLine): Status | null => (line.kind === "order" && FAILED.has(status(line)) ? { text: status(line), failed: true } : null);
