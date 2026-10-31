// What the view model's states mean on the page: labels, hints and which colour role each takes.
// Colour roles are named, never valued, here (theme/roles.ts maps them).
import type { Prediction, Role, Targets } from "./types";

// `short` is the label inside a version's reading badge when it has no readings to show.
export const ROLE: Record<Role, { label: string; short: string; hint: string }> = {
  recommended: { label: "Recommended", short: "Recommended", hint: "The version the latest recommendation judgment recommends" },
  superseded: { label: "Superseded", short: "Superseded", hint: "Has economic evidence, but the latest recommendation judgment does not recommend it" },
  masked: { label: "Ineligible", short: "Ineligible", hint: "Its runs no longer carry economic evidence (a failed source review or the like)" },
  precheck_failed: { label: "Precheck or review failed", short: "Failed", hint: "No research run; its review failed" },
  unrun: { label: "Not replayed", short: "Not run", hint: "No research run" },
};

export const PREDICTION: Record<Prediction, { label: string; tone: "meets" | "misses" | "fg-muted" | "fg-faint" }> = {
  held: { label: "Predictions held", tone: "meets" },
  failed: { label: "Predictions failed", tone: "misses" },
  mixed: { label: "Predictions partly held", tone: "fg-muted" },
  none: { label: "Predictions not judged", tone: "fg-faint" },
};

export type Reading = { annual_return: number | null; max_drawdown: number | null };

/** Whether a reading meets its target: null when either is unknown. */
export function meets(value: number | null | undefined, target: number | null | undefined, higher: boolean): boolean | null {
  if (value == null || target == null) return null;
  return higher ? value >= target : value <= target;
}

export function verdict(reading: Reading, targets: Targets | null) {
  return { ret: meets(reading.annual_return, targets?.annual_return, true), dd: meets(reading.max_drawdown, targets?.max_drawdown, false) };
}

/** A reading's text colour: marked only when it misses its target. */
export const tone = (ok: boolean | null): "misses" | "fg" => (ok === false ? "misses" : "fg");

export const PURPOSE: Record<string, string> = { research: "Research", precheck: "Precheck", explore: "Explore", validation: "Validation" };
