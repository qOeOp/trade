import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entries, groups } from './lib/docs-entries.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '..');
const outputRoot = join(siteRoot, 'content', 'docs');
const knownRoutes = new Map(entries.map(([slug, source]) => [`${source}.md`, slug]));
const base = 'https://github.com/qOeOp/trade/blob/main/';
const description = { en: 'The research chain: candidates, registered hypotheses, comparison evidence and the trust boundaries enforced in code', zh: '研发长链：候选、登记的假设、比较证据与代码强制的信任边界' };

function rewriteLinks(markdown, sourcePath, locale) {
  return markdown.replace(/\]\((?!https?:|#|mailto:)([^)#]+)(#[^)]+)?\)/g, (match, target, fragment = '') => {
    if (target.startsWith('/')) return match;
    const resolved = resolve(dirname(join(repositoryRoot, 'docs', sourcePath)), target);
    const relative = resolved.slice(repositoryRoot.length + 1).replaceAll('\\', '/');
    const canonical = relative.replace(/\.zh\.md$/, '.md').replace(/^docs\//, '');
    const route = knownRoutes.get(canonical);
    if (route) return `](/${locale}/docs/${route === 'index' ? '' : `${route}/`}${fragment})`;
    return `](${base}${relative}${fragment})`;
  });
}

async function firstExisting(...candidates) {
  for (const candidate of candidates) {
    try { await access(join(repositoryRoot, 'docs', candidate)); return candidate; } catch {}
  }
  throw new Error(`Missing chapter source: ${candidates[0]}`);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const [slug, source, englishTitle, chineseTitle] of entries) {
  for (const [locale, suffix, title] of [['en', '', englishTitle], ['zh', '.zh', chineseTitle]]) {
    // Chapters are authored as MDX (components for capabilities, references and tables); plain Markdown still works.
    const sourcePath = await firstExisting(`${source}${suffix}.mdx`, `${source}${suffix}.md`);
    const markdown = await readFile(join(repositoryRoot, 'docs', sourcePath), 'utf8');
    const heading = markdown.match(/^# (.+)\r?\n/);
    const withoutHeading = markdown.replace(/^# .+\r?\n/, '');
    const content = rewriteLinks(withoutHeading, sourcePath, locale);
    // Page description: the half-sentence after the colon in the chapter heading, else the site description.
    const subtitle = heading ? heading[1].split(/[：:]\s*/).slice(1).join(': ').trim() : '';
    await writeFile(join(outputRoot, `${slug}${suffix}.mdx`), `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(subtitle || description[locale])}\n---\n\n${content}`);
  }
}
// Sidebar: the overview page, then one separator per group ("---title---" is the fumadocs separator syntax).
function pagesFor(locale) {
  const pages = entries.filter(([, , , , group]) => !group).map(([slug]) => slug);
  for (const [group, english, chinese] of groups) {
    const members = entries.filter((entry) => entry[4] === group).map(([slug]) => slug);
    if (members.length) pages.push(`---${locale === 'zh' ? chinese : english}---`, ...members);
  }
  return pages;
}
await writeFile(join(outputRoot, 'meta.json'), JSON.stringify({ title: 'Research Chain', pages: pagesFor('en') }, null, 2));
await writeFile(join(outputRoot, 'meta.zh.json'), JSON.stringify({ title: '研发长链', pages: pagesFor('zh') }, null, 2));
// Definition index for <Ref> hover previews, generated together with the chapters.
await mkdir(join(siteRoot, 'lib', 'generated'), { recursive: true });
await copyFile(join(repositoryRoot, 'docs', 'rd', 'rd-index.json'), join(siteRoot, 'lib', 'generated', 'rd-index.json'));
await writeFile(join(siteRoot, 'lib', 'generated', 'rd-groups.json'), JSON.stringify(groups));
await copyFile(join(repositoryRoot, 'docs', 'rd', 'entries.json'), join(siteRoot, 'lib', 'generated', 'rd-entries.json'));
await copyFile(join(repositoryRoot, 'docs', 'rd', 'map.json'), join(siteRoot, 'lib', 'generated', 'rd-map.json'));
await copyFile(join(repositoryRoot, 'docs', 'assets', 'icon.svg'), join(siteRoot, 'public', 'icon.svg'));
await copyFile(join(repositoryRoot, 'docs', 'assets', 'icon-dark.svg'), join(siteRoot, 'public', 'icon-dark.svg'));
console.log(`Prepared ${entries.length} bilingual chapters.`);
