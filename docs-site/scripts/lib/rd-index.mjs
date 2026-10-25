// Definition index for <Ref id> links and hover previews, built from the chapter sources at prepare time.
// Every field comes from the page: the anchor ([#…] on a heading, or an element's id), the title (the
// heading, the list item, or the map's component title for a bare <a id>), the body (the first prose
// paragraph after the anchor), the signature (the python block after a function anchor), the owner (the
// nearest enclosing anchored heading) and where (the chapter section). The id follows the anchor scheme.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SKIPPED = /^def-(mod|file|reviewer)-|-pending$/;

/** Entry id and kind for an anchor, or null when the anchor is not a definition. */
export function classify(anchor) {
  if (SKIPPED.test(anchor)) return null;
  let m = anchor.match(/^([A-Z])-(\d+(?:-\d+)*)$/);
  if (m) {
    const parts = m[2].split('-');
    return { id: `${m[1]}.${parts.join('.')}`, kind: parts.length >= 3 ? 'capability' : 'node', chapter: true };
  }
  if ((m = anchor.match(/^def-rule-([A-Z](?:-\d+)+)$/))) return { id: `rule:${m[1].replaceAll('-', '.')}`, kind: 'section' };
  if ((m = anchor.match(/^def-table-(.+)$/))) return { id: `table:${m[1].replaceAll('-', '.')}`, kind: 'table' };
  if (anchor.startsWith('impl-')) return { id: `implementation:${anchor}`, kind: 'function' };
  if ((m = anchor.match(/^def-([a-z_]+)-([a-z_0-9]+)$/))) return { id: `${m[1]}.${m[2]}`, kind: 'function', qualified: true };
  if ((m = anchor.match(/^def-([a-z_0-9]+)$/))) return { id: m[1], kind: 'node' };
  return null;
}

const unescape = (text) => text.replace(/\\([\\`*_{}[\]()<>#+\-.!|~])/g, '$1');
const plainHeading = (text) => unescape(text.replace(/`/g, '')).replace(/\s+/g, ' ').trim();
// Numbered chapter sections ("10.1 Title") keep the number in where, not in the title.
const unnumbered = (text) => text.replace(/^\d+(?:\.\d+)+\s+/, '');

/** Inline MDX reduced to the text a preview shows (code spans kept verbatim); refs show the label <Ref> renders. */
function reduce(text, label) {
  return text
    .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.startsWith('`')
        ? part
        : unescape(
            part
              .replace(/<Ref\s+id="([^"]+)"\s*\/>/g, (_, id) => label(id))
              .replace(/<Ref\s+id="[^"]+"\s*>([\s\S]*?)<\/Ref>/g, '$1')
              .replace(/<br\s*\/?>/g, ' ')
              .replace(/(?<!\\)<\/?[A-Za-z][^>]*>/g, '')
              .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/(^|[^*\w\\])\*([^*\s][^*]*)\*/g, '$1$2'),
          )
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&'),
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

const INLINE_TAG = /^<(Ref|code|span|strong|em|kbd|sup|sub|abbr)\b/;
const isProseLine = (line) => {
  const t = line.trim();
  if (!t || t.startsWith('```') || t.startsWith('|') || /^(?:[-*+]|\d+\.)\s/.test(t) || t.startsWith('>')) return false;
  return !t.startsWith('<') || INLINE_TAG.test(t);
};
const linkOnly = (text) => text.trim().match(/^\[[^\]]*\]\(([^)]*)\)$/);

/** Splits one page into anchored regions: the anchor, its title and the lines up to the next anchor or heading. */
function regions(markdown) {
  const lines = markdown.split(/\r?\n/);
  const found = [];
  const anchoredHeadings = []; // stack of [level, text]
  let h1 = '';
  let section = '';
  let fence = false;
  let current = null;
  const close = () => { if (current) found.push(current); current = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fence = !fence;
    else if (!fence) {
      const heading = line.match(/^(#{1,6})\s+(.*?)\s*$/);
      if (heading) {
        close();
        const level = heading[1].length;
        const tagged = heading[2].match(/^(.*?)\s*\[#([^\]\s]+)\]$/);
        const text = plainHeading(tagged ? tagged[1] : heading[2]);
        if (level === 1) h1 = text;
        if (level === 2) section = text;
        while (anchoredHeadings.length && anchoredHeadings.at(-1)[0] >= level) anchoredHeadings.pop();
        const owner = anchoredHeadings.at(-1)?.[1] ?? h1;
        if (tagged) {
          current = { anchor: tagged[2], title: text, owner, section, line: i + 1, lines: [] };
          anchoredHeadings.push([level, text]);
        }
        continue;
      }
      const bare = line.match(/^\s*<a\s+id="([^"]+)"\s*\/>\s*$/);
      if (bare) {
        close();
        current = { anchor: bare[1], owner: anchoredHeadings.at(-1)?.[1] ?? h1, section, line: i + 1, lines: [] };
        continue;
      }
      const item = line.match(/^\s*<li\s+id="([^"]+)"\s*>(.*)<\/li>\s*$/);
      if (item) {
        // A list item carries everything inline: the rule text, then its links and eval as spans.
        const [head] = item[2].split(/<span\b/);
        const evals = [...item[2].matchAll(/<span className="rd-eval">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
        found.push({ anchor: item[1], title: head, inlineBody: evals.join('；'), owner: anchoredHeadings.at(-1)?.[1] ?? h1, section, line: i + 1, lines: [] });
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  close();
  return found;
}

/** First prose paragraph (outside fenced code, tables, lists, block components and divs) and first python block. */
function readRegion(lines) {
  let fence = null;
  let code = [];
  let signature;
  let depth = 0;
  let paragraph = [];
  let body;
  let first;
  const flush = () => {
    if (paragraph.length && body === undefined) {
      const text = paragraph.join('\n');
      if (!linkOnly(text) && !/^\*\*[^*]+\*\*/.test(text.trim())) body = text;
    }
    paragraph = [];
  };
  for (const line of lines) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        if (fence === 'python' && signature === undefined) signature = code.join('\n').trim();
        fence = null;
        code = [];
      } else code.push(line);
      continue;
    }
    const opening = line.match(/^\s*```(\w*)/);
    if (opening) { flush(); fence = opening[1]; continue; }
    if (first === undefined && line.trim()) first = line.trim();
    const opens = (line.match(/<div\b/g) ?? []).length;
    const closes = (line.match(/<\/div>/g) ?? []).length;
    if (depth > 0 || opens > 0) { flush(); depth = Math.max(0, depth + opens - closes); continue; }
    if (isProseLine(line) && (paragraph.length || !/^\s/.test(line))) paragraph.push(line);
    else flush();
  }
  flush();
  const bold = first?.match(/^\*\*([^*]+)\*\*$/)?.[1];
  return { body, signature, first, bold: bold && plainHeading(bold) };
}

/** Builds { zh, en } from the chapter table; throws on duplicate ids or <Ref id> without an entry. */
export async function buildRdIndex(entries, docsRoot, map) {
  const mapTitles = new Map();
  for (const chapter of map.chapters) {
    for (const fn of chapter.functions) {
      mapTitles.set(fn.path, fn.title);
      for (const component of fn.components) {
        mapTitles.set(component.path, component.title);
        for (const cap of component.caps) mapTitles.set(cap.path, cap.title);
      }
    }
  }
  const index = { zh: {}, en: {} };
  const pending = { zh: [], en: [] };
  const refs = [];
  const problems = [];
  for (const [slug, source] of entries) {
    for (const [locale, suffix] of [['en', ''], ['zh', '.zh']]) {
      let file = `${source}${suffix}.mdx`;
      let markdown;
      try { markdown = await readFile(join(docsRoot, file), 'utf8'); } catch {
        file = `${source}${suffix}.md`;
        markdown = await readFile(join(docsRoot, file), 'utf8');
      }
      for (const [, id] of markdown.matchAll(/<Ref\s+id="([^"]+)"/g)) refs.push({ id, locale, file });
      for (const region of regions(markdown)) {
        const scheme = classify(region.anchor);
        if (!scheme) continue;
        const { body, signature, first, bold } = readRegion(region.lines);
        // An anchor kept only to forward old links to the definition elsewhere is not a definition.
        const forward = first && linkOnly(first);
        if (forward && forward[1].endsWith(`#${region.anchor}`)) continue;
        const at = `${file}:${region.line}`;
        const seen = index[locale][scheme.id];
        if (seen) { problems.push(`Duplicate index id ${scheme.id}: ${seen.at} and ${at}`); continue; }
        // A bare <a id> takes its title from a bold line right after it, else from the chapter map.
        const title = scheme.qualified ? scheme.id : region.title !== undefined ? unnumbered(region.title) : bold ?? mapTitles.get(scheme.id) ?? scheme.id;
        const entry = { kind: scheme.kind, title, slug, anchor: region.anchor };
        if (signature && scheme.kind === 'function') entry.signature = signature;
        if (scheme.chapter) entry.where = region.section;
        else if (region.owner) entry.owner = region.owner;
        index[locale][scheme.id] = { ...entry, at };
        pending[locale].push([scheme.id, region.inlineBody ?? body ?? '']);
      }
    }
  }
  // Bodies and list-item titles are reduced after every entry exists, so a self-closing ref shows its label.
  for (const locale of ['zh', 'en']) {
    const label = (id) => {
      const entry = index[locale][id] ?? index.zh[id];
      if (!entry) return id;
      return (entry.kind === 'capability' || entry.kind === 'node') && entry.where ? entry.where.split('：')[0] : entry.title;
    };
    for (const [id, raw] of pending[locale]) {
      const entry = index[locale][id];
      entry.body = reduce(raw, label);
      if (entry.kind === 'section') entry.title = reduce(entry.title, label);
      delete entry.at;
    }
  }
  for (const { id, locale, file } of refs) {
    if (!index[locale][id]) problems.push(`<Ref id="${id}"> in ${file} has no index entry`);
  }
  if (problems.length) throw new Error(`Definition index:\n  ${[...new Set(problems)].join('\n  ')}`);
  return index;
}
