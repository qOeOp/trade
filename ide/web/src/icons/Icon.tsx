import { v, type ColorRole } from "../theme/roles";
import { BRANDS, type BrandName } from "./brands";
import { ICONS, type IconName } from "./registry";

// Icons draw on a 24-unit grid (or their own `grid`) in strokes of the current colour. The stroke is chosen
// per size so every icon draws one pixel wide, as the Islands UI icons do: 2 units of 24 at 12px, 1.5 at 16
// and 1.2 at 20, scaled to the icon's grid.
const STROKE = { 12: 2, 16: 1.5, 20: 1.2 } as const;
// One object per body: React writes the markup again whenever it is handed a new one, even an equal one.
const BODIES = new Map<IconName, { __html: string }>((Object.keys(ICONS) as IconName[]).map((name) =>
  [name, { __html: ICONS[name].svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?svg[^>]*>/g, "").trim() }]));
const EMPTY = { __html: "" };
const grid = (name: IconName): number => (ICONS[name] as { grid?: number }).grid ?? 24;

/** An icon in the text colour, or in `tone`. */
export function Icon({ name, size = 16, tone, className = "" }: { name: IconName; size?: 12 | 16 | 20; tone?: ColorRole; className?: string }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${grid(name)} ${grid(name)}`} fill="none" stroke="currentColor"
         strokeWidth={STROKE[size] * grid(name) / 24}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`inline-block shrink-0 ${className}`}
         style={tone ? { color: v(tone) } : undefined}
         dangerouslySetInnerHTML={BODIES.get(name) ?? EMPTY} />
  );
}

const BRAND_BODIES = new Map<BrandName, { __html: string }>((Object.keys(BRANDS) as BrandName[]).map((name) =>
  [name, { __html: BRANDS[name].replace(/<title>[\s\S]*?<\/title>/g, "").replace(/<\/?svg[^>]*>/g, "").trim() }]));

/** A model provider's mark, filled in the text colour or in `tone`. */
export function BrandMark({ name, size = 16, tone }: { name: BrandName; size?: 12 | 16 | 20; tone?: ColorRole }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden
         className="inline-block shrink-0" style={tone ? { color: v(tone) } : undefined}
         dangerouslySetInnerHTML={BRAND_BODIES.get(name) ?? EMPTY} />
  );
}
