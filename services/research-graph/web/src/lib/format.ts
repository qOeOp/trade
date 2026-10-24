// Number and time formatting. A missing value is a plain hyphen.
export const MISSING = "-";
export const pct = (v?: number | null) => (v == null ? MISSING : `${(v * 100).toFixed(2)}%`);
/** A percentage without trailing zeros, for round values such as targets: 20%, 12.5%. */
export const pctShort = (v?: number | null) => (v == null ? MISSING : `${+(v * 100).toFixed(2)}%`);
export const ratio = (v?: number | null) => (v == null ? MISSING : v.toFixed(2));
export const when = (v?: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "");
export const shortSha = (v?: string | null) => (v ? v.slice(0, 8) : MISSING);
