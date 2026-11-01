// Requests to one public host: JSON over GET with a timeout, and a pause the host itself asks for. A 429
// (too many requests) or 418 (Binance's ban after ignoring 429s) pauses every request to that host for
// its Retry-After, at least a minute, so one source cannot get the others refused.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 20_000;
const MIN_PAUSE_S = 60;

export class Host {
  base: string; pausedUntil = 0;
  private fetch: Fetch; private now: () => number;
  constructor(base: string, fetchImpl: Fetch = fetch, now: () => number = Date.now) {
    this.base = base; this.fetch = fetchImpl; this.now = now;
  }

  /** Milliseconds until requests may go again, 0 when they may now. */
  wait(): number { return Math.max(0, this.pausedUntil - this.now()); }

  async json<T>(path: string): Promise<T> {
    if (this.wait() > 0) throw new HttpError(429, `${this.base} paused for ${Math.ceil(this.wait() / 1000)} s`);
    const response = await this.fetch(this.base + path, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
    if (response.status === 429 || response.status === 418) {
      const seconds = Math.max(MIN_PAUSE_S, Number(response.headers.get("retry-after")) || 0);
      this.pausedUntil = this.now() + seconds * 1000;
      throw new HttpError(response.status, `${this.base} answered ${response.status}, paused ${seconds} s`);
    }
    if (!response.ok) throw new HttpError(response.status, `${this.base}${path.split("?")[0]} answered ${response.status}`);
    return await response.json() as T;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
