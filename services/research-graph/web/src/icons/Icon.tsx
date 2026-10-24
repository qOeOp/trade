import { v, type ColorRole } from "../theme/roles";
import { ICONS, type IconName } from "./registry";

// JetBrains draws its icons in fixed greys with a light inner fill for two-tone shapes and an accent
// on status icons; the page takes the greys from the text colour and the rest from the theme, so icons
// follow light and dark.
const GREYS = /#(6C707E|818594|A8ADBD|CED0D6|8C8C8C)\b/gi;
const FILL = /#EBECF0\b/gi;
// Status icons carry one accent each; they take the page's data colours instead.
const STATUS: readonly [RegExp, string][] = [
  [/#4682FA\b/gi, v("recommended")], [/#55A76A\b/gi, v("meets")], [/#FFAF0F\b/gi, v("misses")], [/#DB5C5C\b/gi, v("fail")],
];

function recolour(svg: string): string {
  const body = svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?svg[^>]*>/g, "").replace(GREYS, "currentColor").replace(FILL, v("icon-fill"));
  return STATUS.reduce((b, [re, to]) => b.replace(re, to), body);
}

const BODIES = new Map<IconName, string>((Object.keys(ICONS) as IconName[]).map((name) => [name, recolour(ICONS[name].svg)]));

export function Icon({ name, size = 16, tone, className = "" }: {
  name: IconName; size?: 12 | 16 | 20; tone?: ColorRole; className?: string;
}) {
  const box = ICONS[name].size;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} fill="none" aria-hidden
         className={`inline-block shrink-0 ${className}`} style={tone ? { color: v(tone) } : undefined}
         dangerouslySetInnerHTML={{ __html: BODIES.get(name) ?? "" }} />
  );
}
