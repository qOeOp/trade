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
/** Dollars, compact: $1.56T, $820M, $4.1K; `digits` after the point (two by default). */
export function usd(v?: number | null, digits = 2): string {
  if (v == null) return MISSING;
  const [d, unit] = ([[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const).find(([d]) => Math.abs(v) >= d) ?? [1, ""];
  return minus(`$${+(v / d).toFixed(digits)}${unit}`);
}
/** A price to four significant figures, never in exponent form: 109,420, 3.412, 0.00001234. */
export const price = (v?: number | null) => (v == null ? MISSING
  : v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toLocaleString("en-US", { maximumSignificantDigits: 4 }));
/** A change already in percent, signed: +2.41%, −0.80%; zero unsigned. */
export const change = (v?: number | null, digits = 2) => {
  if (v == null) return MISSING;
  const s = (+v.toFixed(digits) || 0).toFixed(digits);
  return minus(`${+s > 0 ? "+" : ""}${s}%`);
};
/** A funding rate (a fraction per period) in percent to four places: 0.0100%. */
export const funding = (v?: number | null) => (v == null ? MISSING : minus(`${(+(v * 100).toFixed(4) || 0).toFixed(4)}%`));
