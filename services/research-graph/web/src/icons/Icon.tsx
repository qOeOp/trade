import { v, type ColorRole } from "../theme/roles";
import { ICONS, type IconName } from "./registry";

// Lucide draws on a 24-unit grid in strokes of the current colour. The page draws them thin, as the
// Islands UI does: 1.25 units at 16 and 20px (0.83 and 1.04px), 1.5 at 12px so small ones stay legible.
const STROKE = { 12: 1.5, 16: 1.25, 20: 1.25 } as const;
const BODIES = new Map<IconName, string>((Object.keys(ICONS) as IconName[]).map((name) =>
  [name, ICONS[name].svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?svg[^>]*>/g, "").trim()]));

/** An icon in the text colour, or in `tone` (a status icon's own role when none is given). */
export function Icon({ name, size = 16, tone, className = "" }: { name: IconName; size?: 12 | 16 | 20; tone?: ColorRole; className?: string }) {
  const icon = ICONS[name];
  const colour = tone ?? ("tone" in icon ? icon.tone : undefined);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE[size]}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`inline-block shrink-0 ${className}`}
         style={colour ? { color: v(colour) } : undefined}
         dangerouslySetInnerHTML={{ __html: BODIES.get(name) ?? "" }} />
  );
}
