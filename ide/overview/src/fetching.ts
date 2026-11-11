// Requests to one public host: JSON over GET with a timeout (or, for a host whose market data answers only
// POST, a read-only query posted as JSON), a feed's text, and a pause the host itself asks for. A 429
// (too many requests) or 418 (Binance's ban after ignoring 429s) pauses every request to that host for
// its Retry-After, at least a minute, so one source cannot get the others refused. A host with a weight
// cap (Binance's) also waits for the next minute once the weight it reports used this minute reaches the
// cap: the paper daemon and the market import call Binance from the same address and keep the rest.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 20_000;
const MIN_PAUSE_S = 60;

const MINUTE_MS = 60_000;

export class Host {
  base: string; pausedUntil = 0;
  private fetch: Fetch; private now: () => number; private weightCap: number | null;
  private used = 0; private minute = -1;
  constructor(base: string, fetchImpl: Fetch = fetch, now: () => number = Date.now, weightCap: number | null = null) {
    this.base = base; this.fetch = fetchImpl; this.now = now; this.weightCap = weightCap;
  }

  /** Milliseconds until requests may go again, 0 when they may now. */
  wait(): number { return Math.max(0, this.pausedUntil - this.now()); }

  /** GETs `path`, or POSTs `query` there as JSON when one is given. */
  async json<T>(path: string, query?: object): Promise<T> {
    const init: RequestInit = query ? { method: "POST", body: JSON.stringify(query), headers: { accept: "application/json", "content-type": "application/json" } }
      : { headers: { accept: "application/json" } };
    return await (await this.request(path, init)).json() as T;
  }

  /** GETs `path` as text: an RSS or Atom feed. */
  async text(path: string): Promise<string> {
    return await (await this.request(path, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9" } })).text();
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (this.wait() > 0) throw new HttpError(429, `${this.base} paused for ${Math.ceil(this.wait() / 1000)} s`);
    if (this.weightCap !== null && this.used >= this.weightCap && Math.floor(this.now() / MINUTE_MS) === this.minute) {
      await sleep((this.minute + 1) * MINUTE_MS - this.now());
    }
    const response = await this.fetch(this.base + path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const weight = Number(response.headers.get("x-mbx-used-weight-1m"));
    if (weight > 0) { this.used = weight; this.minute = Math.floor(this.now() / MINUTE_MS); }
    if (response.status === 429 || response.status === 418) {
      const seconds = Math.max(MIN_PAUSE_S, Number(response.headers.get("retry-after")) || 0);
      this.pausedUntil = this.now() + seconds * 1000;
      throw new HttpError(response.status, `${this.base} answered ${response.status}, paused ${seconds} s`);
    }
    if (!response.ok) throw new HttpError(response.status, `${this.base}${path.split("?")[0]} answered ${response.status}`);
    return response;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `task` every `ms` from its start, for ever. A task of `host` also waits out that host's pause (its 429 or
 *  418); a task of any other source does not. */
export async function every(ms: number, task: () => Promise<void>, host?: Host, wait = sleep): Promise<never> {
  for (;;) { const started = Date.now(); await task(); await wait(Math.max(ms - (Date.now() - started), 0) + (host?.wait() ?? 0)); }
}
