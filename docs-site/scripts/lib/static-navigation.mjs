import { parseFragment } from 'parse5';

function elementMarkup(body, openingMarker, closingTag) {
  const start = body.indexOf(openingMarker);
  if (start < 0) return null;
  const end = body.indexOf(closingTag, start);
  if (end < 0) return null;
  return body.slice(start, end + closingTag.length);
}

export function navigationMarkup({ body, parentRoute, localeHomeRoute }) {
  if (parentRoute === localeHomeRoute) return elementMarkup(body, '<main', '</main>');
  return elementMarkup(body, '<aside id="nd-sidebar"', '</aside>');
}

export function containsNavigationHref(markup, route) {
  if (!markup) return false;
  const root = parseFragment(markup);
  let found = false;

  function visit(node, inert = false) {
    if (found || node.nodeName === '#comment') return;
    const attributes = new Map((node.attrs ?? []).map(({ name, value }) => [name, value]));
    const classes = new Set((attributes.get('class') ?? '').split(/\s+/).filter(Boolean));
    const style = attributes.get('style') ?? '';
    const clipped =
      /(?:^|;)\s*clip\s*:\s*rect\(\s*0(?:px)?(?:\s*,?\s*0(?:px)?){3}\s*\)\s*(?:;|$)/i.test(style) ||
      /(?:^|;)\s*clip-path\s*:\s*inset\(\s*(?:50|100)%\s*\)\s*(?:;|$)/i.test(style);
    const offscreen =
      /(?:^|;)\s*(?:left|right|top|bottom)\s*:\s*-\d{3,}(?:px|rem|vw|vh)\s*(?:;|$)/i.test(style) ||
      /(?:^|;)\s*transform\s*:[^;]*translate(?:3d|x|y)?\([^;]*-\d{3,}(?:px|rem|vw|vh)/i.test(style);
    const zeroArea =
      /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/i.test(style) &&
      /(?:^|;)\s*width\s*:\s*0(?:px)?\s*(?:;|$)/i.test(style) &&
      /(?:^|;)\s*height\s*:\s*0(?:px)?\s*(?:;|$)/i.test(style);
    const cssHidden =
      ['hidden', 'invisible', 'collapse', 'sr-only', 'pointer-events-none'].some((className) => classes.has(className)) ||
      /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/i.test(style) ||
      /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)\s*(?:;|$)/i.test(style) ||
      /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)/i.test(style) ||
      /(?:^|;)\s*pointer-events\s*:\s*none\s*(?:;|$)/i.test(style) ||
      clipped ||
      offscreen ||
      zeroArea;
    const blocked =
      inert ||
      attributes.has('hidden') ||
      attributes.has('inert') ||
      attributes.get('aria-hidden') === 'true' ||
      attributes.has('disabled') ||
      attributes.get('aria-disabled') === 'true' ||
      cssHidden;
    if (['script', 'style', 'template'].includes(node.tagName)) return;
    if (
      !blocked &&
      node.tagName === 'a' &&
      attributes.get('href') === route
    ) {
      found = true;
      return;
    }
    for (const child of node.childNodes ?? []) visit(child, blocked);
  }

  visit(root);
  return found;
}
