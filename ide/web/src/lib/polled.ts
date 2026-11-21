// The page's polls. A hidden page (a tab in the background, a locked phone) reads nothing and reads at once on
// showing again when a read came due. From the first 401 no poll asks again (transport.ts signedOut): every answer
// would be the same, and the page says to sign in instead.
import { pageFetch, signedOut } from "./transport";

/** A GET's answer: its status and JSON body (null when the body is not JSON); null when nothing answered. */
export type Answer = { status: number; ok: boolean; body: unknown } | null;

/** A running poll: `read` reads now (joining a read under way) and goes on from there; `stop` ends it until the next `read`. */
export type Poll = { read: () => Promise<void>; stop: () => void };

async function get(url: string): Promise<Answer> {
  try {
    const response = await pageFetch(url, { cache: "no-store" });
    return { status: response.status, ok: response.ok, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

/**
 * Reads `url` (a GET of the page's server, or a read of the caller's own that never throws) now, then again `ms`
 * after each read while the page shows and is signed in, and gives each answer to `map`. `ms` as a function says from
 * the answer how long to wait, or null to stop until `read` is called again.
 */
export function polled<T = Answer>(url: string | (() => Promise<T>), ms: number | ((value: T) => number | null), map: (value: T) => unknown = () => {}): Poll {
  const source = typeof url === "string" ? () => get(url) as Promise<T> : url;
  let timer: number | undefined, due = false, run = 0, reading: { run: number; done: Promise<void> } | null = null;
  const wait = () => { window.clearTimeout(timer); due = false; };
  const shown = () => { if (!document.hidden && due && !signedOut()) { due = false; void read(); } };
  const read = (): Promise<void> => {
    if (reading?.run === run) return reading.done;
    const mine = run;
    document.addEventListener("visibilitychange", shown);
    const done = (async () => {
      try {
        const value = await source();
        if (mine !== run) return;
        await map(value);
        const next = typeof ms === "number" ? ms : ms(value);
        wait();
        if (next !== null && mine === run && !signedOut()) timer = window.setTimeout(() => { if (mine !== run) return; if (document.hidden) due = true; else void read(); }, next);
      } finally {
        if (reading?.run === mine) reading = null;
      }
    })();
    reading = { run: mine, done };
    return done;
  };
  void read();
  return { read, stop: () => { run += 1; wait(); document.removeEventListener("visibilitychange", shown); } };
}
