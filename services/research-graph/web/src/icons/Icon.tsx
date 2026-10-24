import { v, type ColorRole } from "../theme/roles";
import { ICONS, type IconName } from "./registry";

// JetBrains draws its icons in fixed greys with a light inner fill for two-tone shapes; the page
// takes the greys from the text colour and the fill from the theme, so icons follow light and dark.
const GREYS = /#(6C707E|818594|A8ADBD|CED0D6|8C8C8C)\b/gi;
const FILL = /#EBECF0\b/gi;

const BODIES = new Map<IconName, string>(
  (Object.keys(ICONS) as IconName[]).map((name) => [name, ICONS[name].svg
    .replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?svg[^>]*>/g, "")
    .replace(GREYS, "currentColor").replace(FILL, v("icon-fill"))]),
);

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
