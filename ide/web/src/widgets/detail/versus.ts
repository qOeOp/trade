// The readings of a version's comparison with its control, as the Versus control section shows them.
import { signedPct } from "../../lib/format";
import type { Candidate } from "../../model/types";

/** A difference and its interval, signed: ["+3.20%", "−1.10% to +7.50%"]; the interval null without one, null without the difference. */
export function withInterval(value?: number | null, interval?: readonly number[] | null): [string, string | null] | null {
  if (value == null) return null;
  return [signedPct(value), interval?.length === 2 ? `${signedPct(interval[0])} to ${signedPct(interval[1])}` : null];
}

/** A daily alpha difference with its standard error, in percent a day: +0.012% ± 0.008% a day. */
export function perDay(value?: number | null, se?: number | null): string | null {
  if (value == null) return null;
  return `${signedPct(value, 3)}${se == null ? "" : ` ± ${(se * 100).toFixed(3)}%`} a day`;
}

/** The version of the view whose runs include the control trial, so naming that trial can select it; null when none does. */
export const controlVersion = (items: readonly Candidate[], trial?: number | null): string | null =>
  trial == null ? null : items.find((c) => (c.trials ?? []).some((t) => t.trial_id === trial))?.id ?? null;
