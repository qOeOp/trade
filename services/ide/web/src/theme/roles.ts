// Colour roles by name. Values live in tokens.css (light and dark); TypeScript only names them, and
// v()/wash() are the only way a colour reaches TSX or SVG.
export const SURFACE = ["frame", "island", "island-alt", "popup", "tooltip", "card-border", "hover", "pressed", "row-hover",
  "selection", "selection-inactive", "line", "line-strong", "guide", "scrim", "focus"] as const;
export const TEXT = ["fg", "fg-muted", "fg-faint", "fg-ghost", "icon"] as const;
export const DATA = ["recommended", "meets", "misses", "fail", "masked"] as const;
export const CHART = ["edge", "bar", "grid", "axis", "scope", "crosshair", "selected-mark",
  "candle-up", "candle-down", "pnl-up", "pnl-down", "equity", "event", "line-shadow"] as const;
export const BRAND = ["brand-deepseek", "brand-openai", "brand-anthropic"] as const;

export type SurfaceRole = (typeof SURFACE)[number];
export type TextRole = (typeof TEXT)[number];
export type DataRole = (typeof DATA)[number];
export type ChartRole = (typeof CHART)[number];
export type BrandRole = (typeof BRAND)[number];
export type ColorRole = SurfaceRole | TextRole | DataRole | ChartRole | BrandRole;

/** The CSS value of a colour role. */
export const v = (role: ColorRole) => `var(--${role})` as const;

/** A colour at `pct` percent mixed into the island: opaque, so a label's halo can match it. */
export const tint = (role: ColorRole, pct: number) => `color-mix(in oklab, var(--${role}) ${pct}%, var(--island))` as const;

/** A data colour at `pct` percent over whatever is beneath it. */
export const wash = (role: DataRole, pct: number) => `color-mix(in srgb, var(--${role}) ${pct}%, transparent)` as const;

/** The Tailwind text-colour class of a text or data role (literal, so Tailwind finds every class). */
const TEXT_CLASS: Record<TextRole | DataRole, string> = {
  fg: "text-fg", "fg-muted": "text-fg-muted", "fg-faint": "text-fg-faint", "fg-ghost": "text-fg-ghost", icon: "text-icon",
  recommended: "text-recommended", meets: "text-meets", misses: "text-misses", fail: "text-fail", masked: "text-masked",
};
export const textClass = (role: TextRole | DataRole) => TEXT_CLASS[role];
/** The class of a signed amount's text: profit, loss, or the secondary colour at zero or unknown. */
export const pnlClass = (n: number | null | undefined) => (n == null || n === 0 ? "text-fg-muted" : n > 0 ? "text-pnl-up" : "text-pnl-down");

let probe: { element: HTMLSpanElement; context: CanvasRenderingContext2D } | null = null;
const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** A colour role (or a data role at `alpha`) as #rrggbbaa, for canvas libraries that cannot read CSS
 *  variables or light-dark(): resolved against the theme shown now, so read it again when it changes. */
export const canvasColor = (role: ColorRole, alpha = 1) => resolve(v(role), alpha);
/** tint() as #rrggbbaa, for a canvas label that sits on a level's own colour. */
export const canvasTint = (role: ColorRole, pct: number) => resolve(tint(role, pct));

// Resolved values by theme shown, colour and alpha: resolving reads the page's style and a pixel back.
const resolved = new Map<string, string>();
let dark: MediaQueryList | null = null;

function resolve(css: string, alpha = 1): string {
  dark ??= matchMedia("(prefers-color-scheme: dark)");
  const key = `${document.documentElement.getAttribute("data-theme") ?? (dark.matches ? "dark" : "light")} ${alpha} ${css}`;
  let found = resolved.get(key);
  if (found === undefined) resolved.set(key, (found = read(css, alpha)));
  return found;
}

function read(css: string, alpha: number): string {
  if (!probe) {
    const element = document.createElement("span");
    element.style.display = "none";
    document.body.appendChild(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    probe = { element, context: canvas.getContext("2d", { willReadFrequently: true })! };
  }
  probe.element.style.color = css;
  const { context } = probe;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = getComputedStyle(probe.element).color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a * alpha)}`;
}
