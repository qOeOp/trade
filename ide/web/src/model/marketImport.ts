// The market-import service's status as `/api/market-import` answers it: the file `market follow` writes
// (market/follow.py, run_round and follow), the time the page's server read it and whether its round is
// older than 26 hours. The status bar's one line and the table's rows are read from it as they are.

export type Refusal = { code: string; message?: string };
export type Entry = {
  state: "caught_up" | "waiting" | "lagging" | "stopped" | "unknown";
  refusal?: Refusal; retry?: Refusal;
  through?: string; missing_from?: string | null; missing_days?: number; next_month?: string; skipped?: string[];
};
export type Status = {
  at: string; running_since?: string; next_round?: string; last_closed_day?: string;
  kinds?: Record<string, Record<string, Entry>>;
  round_refusal?: Refusal | null; publish_refusal?: Refusal | null; publish_failing_since?: string | null;
  published?: unknown;
};
export type Reply = { read_at: string; stale: boolean; status: Status };
export type Tone = "fail" | "misses" | null;
export type Row = { kind: string; contract: string; entry: Entry };

const KINDS = ["bars", "metrics", "quotes", "trades"];
// The order a waiting or lagging entry is named in: a month of quotes or trades before a day.
const NAMED = ["quotes", "trades", "metrics", "bars"];
const STALE_MS = 26 * 3600_000;  // market.follow.STALE

export function rows(status: Status): Row[] {
  const kinds = status.kinds ?? {};
  return [...KINDS, ...Object.keys(kinds).filter((k) => !KINDS.includes(k))].flatMap((kind) =>
    Object.entries(kinds[kind] ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([contract, entry]) => ({ kind, contract, entry })));
}

/** Where an entry is: the next month of quotes or trades, the first missing day of metrics, bars' last day. */
export function position(entry: Entry): string {
  if (entry.next_month) return entry.next_month;
  if (entry.missing_from) return `from ${entry.missing_from}${entry.missing_days ? ` · ${entry.missing_days} d` : ""}`;
  return entry.through ? `through ${entry.through}` : "";
}

const codes = (refusals: (Refusal | undefined)[]) => {
  const found = [...new Set(refusals.flatMap((r) => (r?.code ? [r.code] : [])))];
  return found.length ? `${found[0]}${found.length > 1 ? ` +${found.length - 1}` : ""}` : "";
};

function first(all: Row[], state: Entry["state"]): string {
  const row = all.filter((r) => r.entry.state === state)
    .sort((a, b) => NAMED.indexOf(a.kind) - NAMED.indexOf(b.kind) || position(a.entry).localeCompare(position(b.entry)))[0];
  return row ? `${row.kind} ${position(row.entry)}`.trim() : "";
}

/** Publishes have been refused for longer than the healthcheck allows. */
export const publishOverdue = (reply: Reply) =>
  !!reply.status.publish_failing_since && Date.parse(reply.read_at) - Date.parse(reply.status.publish_failing_since) > STALE_MS;

/** The status bar's line: the first of no round for a day, stopped, publishes refused for a day, unknown,
 *  lagging, waiting and caught up that holds, with whether a round is running. Skipped months are not
 *  named here, as the healthcheck does not count them. */
export function summary(reply: Reply): { text: string; tone: Tone; running: boolean } {
  const { status } = reply, all = rows(status), running = !!status.running_since;
  const has = (state: Entry["state"]) => all.some((r) => r.entry.state === state);
  if (reply.stale) {
    const hours = Math.floor((Date.parse(reply.read_at) - Date.parse(status.at)) / 3600_000);
    return { text: `Market: no round for ${hours} h`, tone: "fail", running };
  }
  if (has("stopped")) return { text: `Market: stopped — ${codes(all.filter((r) => r.entry.state === "stopped").map((r) => r.entry.refusal))}`, tone: "fail", running };
  if (publishOverdue(reply))
    return { text: `Market: publish refused — ${status.publish_refusal?.code ?? "PUBLISH_FAILED"}`, tone: "fail", running };
  if (has("unknown")) return { text: `Market: unknown — ${status.round_refusal?.code ?? "NO_LISTING"}`, tone: "fail", running };
  if (has("lagging")) return { text: `Market: lagging ${first(all, "lagging")}`, tone: "misses", running };
  if (has("waiting")) return { text: `Market: waiting ${first(all, "waiting")} (archive not out)`, tone: null, running };
  return { text: all.length ? "Market: caught up" : running ? "Market: first round" : "Market: no contracts", tone: null, running };
}
