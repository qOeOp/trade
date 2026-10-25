import { v, type ColorRole } from "../theme/roles";
import { BRANDS, type BrandName } from "./brands";
import { ICONS, type IconName } from "./registry";

// Lucide draws on a 24-unit grid in strokes of the current colour. The stroke is chosen per size so
// every icon draws one pixel wide, as the Islands UI icons do: 2 units at 12px, 1.5 at 16 and 1.2 at 20.
const STROKE = { 12: 2, 16: 1.5, 20: 1.2 } as const;
const BODIES = new Map<IconName, string>((Object.keys(ICONS) as IconName[]).map((name) =>
  [name, ICONS[name].svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?svg[^>]*>/g, "").trim()]));

/** An icon in the text colour, or in `tone`. */
export function Icon({ name, size = 16, tone, className = "" }: { name: IconName; size?: 12 | 16 | 20; tone?: ColorRole; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE[size]}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`inline-block shrink-0 ${className}`}
         style={tone ? { color: v(tone) } : undefined}
         dangerouslySetInnerHTML={{ __html: BODIES.get(name) ?? "" }} />
  );
}

const BRAND_BODIES = new Map<BrandName, string>((Object.keys(BRANDS) as BrandName[]).map((name) =>
  [name, BRANDS[name].replace(/<title>[\s\S]*?<\/title>/g, "").replace(/<\/?svg[^>]*>/g, "").trim()]));

/** A model provider's mark, filled in the text colour or in `tone`. */
export function BrandMark({ name, size = 16, tone, className = "" }: { name: BrandName; size?: 12 | 16 | 20; tone?: ColorRole; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden
         className={`inline-block shrink-0 ${className}`} style={tone ? { color: v(tone) } : undefined}
         dangerouslySetInnerHTML={{ __html: BRAND_BODIES.get(name) ?? "" }} />
  );
}
