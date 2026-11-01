// Number and time formatting. A missing value is a plain hyphen; a negative number takes a true minus
// sign (U+2212), as wide as the plus and set tight against the figures.
export const MISSING = "-";
const minus = (s: string) => s.replace(/^-/, "\u2212");
// A value that rounds to zero prints as 0.00%, never −0.00%.
export const pct = (v?: number | null) => (v == null ? MISSING : minus(`${(+(v * 100).toFixed(2) || 0).toFixed(2)}%`));
/** A count with its noun, plural unless one: 1 version, 3 research runs. */
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
/** A span of time, compact: 21d 4h, 3h 12m, 46m. */
export function duration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}
/** A span of time without a zero part: 3h, 3h 12m, 2d, 46m. */
export const brief = (ms: number) => duration(ms).replace(/ 0[hm]$/, "");
/** The time between two moments (ms) as a clock to the minute shows them: 04:48:50 to 05:34:10 is 46m. */
export const clockSpan = (from: number, to: number) => Math.max(0, Math.floor(to / 60_000) - Math.floor(from / 60_000)) * 60_000;
export const ratio = (v?: number | null) => (v == null ? MISSING : v.toFixed(2));
export const when = (v?: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "");
export const shortSha = (v?: string | null) => (v ? v.slice(0, 8) : MISSING);
