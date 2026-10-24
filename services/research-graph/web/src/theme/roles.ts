// Colour roles by name. Values live in tokens.css (light and dark); TypeScript only names them, and
// v()/wash() are the only way a colour reaches TSX or SVG.
export const SURFACE = ["frame", "island", "island-alt", "popup", "tooltip", "hover", "pressed", "row-hover",
  "selection", "selection-inactive", "line", "line-strong", "guide", "scrim"] as const;
export const TEXT = ["fg", "fg-muted", "fg-faint", "fg-ghost", "icon"] as const;
export const DATA = ["recommended", "meets", "misses", "fail", "masked"] as const;
export const CHART = ["edge", "bar", "grid", "axis", "scope", "crosshair"] as const;

export type SurfaceRole = (typeof SURFACE)[number];
export type TextRole = (typeof TEXT)[number];
export type DataRole = (typeof DATA)[number];
export type ChartRole = (typeof CHART)[number];
export type ColorRole = SurfaceRole | TextRole | DataRole | ChartRole;

/** The CSS value of a colour role. */
export const v = (role: ColorRole) => `var(--${role})` as const;

/** A data colour at `pct` percent over whatever is beneath it. */
export const wash = (role: DataRole, pct: number) => `color-mix(in srgb, var(--${role}) ${pct}%, transparent)` as const;

/** The Tailwind text-colour class of a text or data role (literal, so Tailwind finds every class). */
const TEXT_CLASS: Record<TextRole | DataRole, string> = {
  fg: "text-fg", "fg-muted": "text-fg-muted", "fg-faint": "text-fg-faint", "fg-ghost": "text-fg-ghost", icon: "text-icon",
  recommended: "text-recommended", meets: "text-meets", misses: "text-misses", fail: "text-fail", masked: "text-masked",
};
export const textClass = (role: TextRole | DataRole) => TEXT_CLASS[role];
