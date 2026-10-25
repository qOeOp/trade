// Colour roles by name. Values live in tokens.css (light and dark); TypeScript only names them, and
// v()/wash() are the only way a colour reaches TSX or SVG.
export const SURFACE = ["frame", "island", "island-alt", "popup", "tooltip", "card-border", "hover", "pressed", "row-hover",
  "selection", "selection-inactive", "line", "line-strong", "guide", "scrim", "focus"] as const;
export const TEXT = ["fg", "fg-muted", "fg-faint", "fg-ghost", "icon"] as const;
export const DATA = ["recommended", "meets", "misses", "fail", "masked"] as const;
export const CHART = ["edge", "bar", "grid", "axis", "scope", "crosshair", "selected-mark"] as const;
export const BRAND = ["brand-deepseek", "brand-openai", "brand-anthropic"] as const;

export type SurfaceRole = (typeof SURFACE)[number];
export type TextRole = (typeof TEXT)[number];
export type DataRole = (typeof DATA)[number];
export type ChartRole = (typeof CHART)[number];
export type BrandRole = (typeof BRAND)[number];
export type ColorRole = SurfaceRole | TextRole | DataRole | ChartRole | BrandRole;

/** The CSS value of a colour role. */
export const v = (role: ColorRole) => `var(--${role})` as const;

/** A data colour at `pct` percent mixed into the island: opaque, so a label's halo can match it. */
export const tint = (role: DataRole, pct: number) => `color-mix(in oklab, var(--${role}) ${pct}%, var(--island))` as const;

/** A data colour at `pct` percent over whatever is beneath it. */
export const wash = (role: DataRole, pct: number) => `color-mix(in srgb, var(--${role}) ${pct}%, transparent)` as const;

/** The Tailwind text-colour class of a text or data role (literal, so Tailwind finds every class). */
const TEXT_CLASS: Record<TextRole | DataRole, string> = {
  fg: "text-fg", "fg-muted": "text-fg-muted", "fg-faint": "text-fg-faint", "fg-ghost": "text-fg-ghost", icon: "text-icon",
  recommended: "text-recommended", meets: "text-meets", misses: "text-misses", fail: "text-fail", masked: "text-masked",
};
export const textClass = (role: TextRole | DataRole) => TEXT_CLASS[role];

let probe: { element: HTMLSpanElement; context: CanvasRenderingContext2D } | null = null;
const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** A colour role (or a data role at `alpha`) as #rrggbbaa, for canvas libraries that cannot read CSS
 *  variables or light-dark(): resolved against the theme shown now, so read it again when it changes. */
export function canvasColor(role: ColorRole, alpha = 1): string {
  if (!probe) {
    const element = document.createElement("span");
    element.style.display = "none";
    document.body.appendChild(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    probe = { element, context: canvas.getContext("2d", { willReadFrequently: true })! };
  }
  probe.element.style.color = v(role);
  const { context } = probe;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = getComputedStyle(probe.element).color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a * alpha)}`;
}
