import { MISSING } from "./format";

/** A day and a year of 365 days, in seconds and in ms: the pace and annual return compound over that year. */
export const DAY_S = 86_400, DAY_MS = DAY_S * 1000, YEAR_S = 365 * DAY_S, YEAR_MS = YEAR_S * 1000;
/** The start (s) of a UTC day, 2026-11-10. */
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

/** Display-only conversions. Epochs, UTC business days and backend calculations never change. */
export const TIME_ZONE_LABEL = {
  UTC: "UTC", "America/New_York": "New York", "Asia/Shanghai": "China", "Asia/Tokyo": "Japan",
} as const;
export type TimeZone = keyof typeof TIME_ZONE_LABEL;
export const TIME_ZONES = Object.keys(TIME_ZONE_LABEL) as TimeZone[];
export const isTimeZone = (value: unknown): value is TimeZone => typeof value === "string" && TIME_ZONES.includes(value as TimeZone);

const formats = new Map<string, Intl.DateTimeFormat>();
export function timeFormatter(zone: TimeZone, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([zone, options]);
  let result = formats.get(key);
  if (!result) formats.set(key, result = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone, hourCycle: "h23" }));
  return result;
}

/** Legacy ledger datetime strings are UTC; date-only business keys are deliberately not instants. */
export function utcInstant(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  const canonical = value.replace(" ", "T").replace(/\.(\d{3})\d+/, ".$1");
  const ms = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(canonical) ? canonical : `${canonical}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Drop sub-millisecond precision only after integer division, never by first rounding a large Number. */
export function nsMilliseconds(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const ms = Number(BigInt(value) / 1_000_000n);
  return Number.isSafeInteger(ms) && ms <= 8_640_000_000_000_000 ? ms : null;
}

const DATE_PARTS = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
const CLOCK_PARTS = { hour: "2-digit", minute: "2-digit", second: "2-digit" } as const;
const validInstant = (ms: number | null | undefined): ms is number => ms != null && Number.isFinite(ms) && Math.abs(ms) <= 8_640_000_000_000_000;
const parts = (ms: number, zone: TimeZone, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(timeFormatter(zone, options).formatToParts(ms).map((part) => [part.type, part.value]));

export function displayDay(ms: number, zone: TimeZone): string {
  if (!validInstant(ms)) return MISSING;
  const p = parts(ms, zone, DATE_PARTS);
  return `${p.year}-${p.month}-${p.day}`;
}
export function clockTime(ms: number, zone: TimeZone, seconds = false): string {
  if (!validInstant(ms)) return MISSING;
  const p = parts(ms, zone, CLOCK_PARTS);
  return `${p.hour}:${p.minute}${seconds ? `:${p.second}` : ""}`;
}
export function zoneOffset(ms: number, zone: TimeZone): string {
  return zone === "UTC" ? "UTC" : parts(ms, zone, { timeZoneName: "shortOffset" }).timeZoneName!;
}
/** Offset belongs to this instant: New York's two repeated 01:30 times remain distinguishable. */
export function dateTime(ms: number | null | undefined, zone: TimeZone = "UTC", precision: "minute" | "second" | "millisecond" = "second"): string {
  if (!validInstant(ms)) return MISSING;
  const fraction = precision === "millisecond" ? `.${String(new Date(ms).getUTCMilliseconds()).padStart(3, "0")}` : "";
  return `${displayDay(ms, zone)} ${clockTime(ms, zone, precision !== "minute")}${fraction} ${zoneOffset(ms, zone)}`;
}
export const utcDayRange = (day: string, zone: TimeZone) => {
  const start = utcInstant(`${day}T00:00:00Z`);
  return start === null ? MISSING : `${dateTime(start, zone, "minute")} → ${dateTime(start + DAY_MS, zone, "minute")}`;
};
