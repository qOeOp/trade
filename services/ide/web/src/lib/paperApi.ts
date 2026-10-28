// The paper daemon (python -m cli.main paper serve) under /api/paper, reached through the page's own
// server. Its refusals are { code, message }, as the product's are. A POST carries the token the page's
// server put in the page, without which that server refuses it.
import { ApiError } from "./agentApi";

export type RunState = "running" | "stopping" | "ended" | "unsealed" | "sealed";
/** What a seal computes, from the journal so far (paper/serve.py live_readings). */
export type Live = {
  total_return: number | null; max_drawdown: number; final_equity_usdt: string | null; funding_usdt: string;
  fills: number; orders_submitted: number; positions_closed: number; missing_bars: number; late_bars: number;
  protection_gaps: number; started_ns: number | null; bars: number; last_bar_ns: number | null;
  starting_balance_usdt: string; equity: [number, number][];
  /** How often the strategy raised so far: the runner rewrites its records at each power of two, so the
   *  true count is below twice this; a sealed run's stream gives the final one. */
  exceptions: number;
};
/** One distinct exception the strategy raised (engine/run.py runtime-failure-v2): where, what, how often
 *  and its first traceback. `instrument_id` is "unconstructed" before a strategy exists, "various" for
 *  the record that counts the ones past the first hundred. */
export type RuntimeFailure = {
  stage: string; exception_type: string; instrument_id: string; code: string | null; message: string;
  traceback: string; count: number;
};
/** The stored seal.json (ledger/paper.py readings). */
export type Seal = {
  status: "complete" | "invalid"; reasons: string[]; total_return: number | null; max_drawdown: number;
  final_equity_usdt: string | null; fills: number; started_ns: number | null; stopped_ns: number | null;
  stop_reason: string | null; daily_returns: [string, number][]; positions_closed: number;
};
export type PaperRun = {
  paper_id: number; candidate: string | null; source_sha256: string; symbols: string[]; state: RunState;
  created_at: string; image_ref: string; market_commit: string; config: Record<string, unknown>;
  status: "complete" | "invalid" | null; reasons: string[] | null; total_return: number | null; max_drawdown: number | null;
  live?: Live; seal?: Seal;
};
export type Listing = { runs: PaperRun[]; running: number; limit: number; starting: string[] };

/** One journal line (engine/paper.py): its kind, wall clock and the kind's own fields. */
export type JournalLine = { kind: string; wall_ns: number; [field: string]: unknown };
export type OpenOrder = {
  client_order_id: string; instrument_id: string; side: string; type: string; quantity: string;
  price: string; trigger_price: string; reduce_only: boolean;
};
export type OpenPosition = {
  position_id: string; instrument_id: string; signed_qty: string; avg_px_open: string; mark: string | null;
  unrealized_pnl: string | null; realized_pnl: string;
};
/** state.json: the account at the last minute, with its open positions and working orders. */
export type PaperState = {
  minute_ns: number; balance_total: string | null; balance_free: string | null; unrealized_pnl: string | null;
  positions: OpenPosition[]; orders: OpenOrder[];
};

/** The token the page's server puts in the page when it has a paper daemon (`--paper`); empty without one. */
export const paperToken = () => document.querySelector<HTMLMetaElement>('meta[name="trade-paper-token"]')?.content ?? "";

/** One JSON request to the paper daemon; throws its refusal as an ApiError. */
export async function paperApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/paper${path}`, {
      method: init.method ?? "GET", cache: "no-store",
      headers: init.method === "POST" ? { "content-type": "application/json", "x-trade-paper-token": paperToken() } : undefined,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new ApiError("PAPER_UNAVAILABLE", String(error));
  }
  const body = await response.json().catch(() => ({ code: "PAPER_FAILED", message: `${response.status} ${response.statusText}` }));
  if (!response.ok) throw new ApiError(body.code ?? "PAPER_FAILED", body.message ?? "");
  return body as T;
}

/** What a page holds of a run's journal, for its stream to leave out: its first `lines` lines but bars,
 *  the last written at `last` (wall ns), and the bars (or every contract's closes) up to `bars` (ns). */
export type Resume = { lines: number; last: number; bars: number };

export const streamUrl = (paperId: number, symbol: string | null, resume: Resume | null = null) => {
  const query = new URLSearchParams({ ...(symbol ? { symbol } : {}), ...(resume ? { lines: `${resume.lines}`, last: `${resume.last}`, bars: `${resume.bars}` } : {}) });
  return `/api/paper/runs/${paperId}/stream${query.size ? `?${query}` : ""}`;
};

/** A Nautilus money or quantity text ("99990.12 USDT", "0.010") as a number. */
export const amount = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(String(value).split(" ")[0]);
  return Number.isFinite(n) ? n : null;
};

/** A price as text without binary noise (Nautilus's average prices are floats: 86396.99999999999 → 86397). */
export const priceText = (value: unknown): string => {
  const n = amount(value);
  return n == null ? String(value ?? "") : String(Number(n.toPrecision(12)));
};

/** BTCUSDT-PERP.BINANCE → BTCUSDT. */
export const symbolOf = (instrument: unknown) => String(instrument ?? "").split("-")[0] ?? "";

const places = (v: unknown): number => {
  const m = /^-?\d+(?:\.(\d+))?$/.exec(String(v ?? "").split(" ")[0] ?? "");
  return m ? m[1]?.length ?? 0 : -1;
};
/** A contract's price and size decimals, -1 where the journal has not shown one yet. */
export type Precision = { price: number; size: number };
/** Each contract's decimals as the journal prints them: bars and accepted orders carry the instrument's
 *  precision (average prices are floats and say nothing; a denied or rejected order may carry any). */
export function precisions(lines: readonly JournalLine[]): Map<string, Precision> {
  const out = new Map<string, Precision>();
  const failed = new Set(lines.filter((l) => l.type === "OrderDenied" || l.type === "OrderRejected").map((l) => l.client_order_id));
  for (const l of lines) {
    if ((l.kind !== "bar" && l.kind !== "order") || (l.kind === "order" && failed.has(l.client_order_id))) continue;
    const symbol = symbolOf(l.instrument_id), p = out.get(symbol) ?? { price: -1, size: -1 };
    for (const key of l.kind === "bar" ? ["close"] : ["price", "trigger_price", "last_px"]) p.price = Math.max(p.price, places(l[key]));
    if (l.kind === "order") p.size = Math.max(p.size, places(l.quantity), places(l.last_qty));
    out.set(symbol, p);
  }
  return out;
}
/** A number with thousands separators and `digits` decimals (unknown: as few as it needs, up to 8). */
export const fixed = (value: unknown, digits = -1): string | null => {
  const n = amount(value);
  if (n == null) return null;
  let f = numbers.get(digits);
  if (!f) numbers.set(digits, (f = new Intl.NumberFormat("en-US", digits < 0 ? { maximumFractionDigits: 8 } : { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(n);
};
const numbers = new Map<number, Intl.NumberFormat>();  // one formatter a number of decimals, kept
