// Number and time formatting. A missing value is a plain hyphen; a negative number takes a true minus
// sign (U+2212), as wide as the plus and set tight against the figures.
export const MISSING = "-";
const minus = (s: string) => s.replace(/^-/, "\u2212");
export const pct = (v?: number | null) => (v == null ? MISSING : minus(`${(v * 100).toFixed(2)}%`));
export const ratio = (v?: number | null) => (v == null ? MISSING : v.toFixed(2));
export const when = (v?: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "");
export const shortSha = (v?: string | null) => (v ? v.slice(0, 8) : MISSING);
