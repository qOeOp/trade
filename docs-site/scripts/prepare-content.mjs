import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '..');
const outputRoot = join(siteRoot, 'content', 'docs');
const entries = [
  ['index', 'index', 'Trade Research Documentation', 'Trade 研究文档'],
  ['architecture', 'architecture', 'Current Architecture', '当前架构'],
  ['replay', 'plans/nautilus-upstream-poc', 'Published Nautilus Replay', 'R1 原生配对回放'],
  ['findings', 'plans/r1-native-rd-findings', 'Research Findings', '研发发现'],
];
const knownRoutes = new Map(entries.map(([slug, source]) => [`${source}.md`, slug]));
const base = 'https://github.com/qOeOp/trade/blob/main/';

function rewriteLinks(markdown, sourcePath, locale) {
  return markdown.replace(/\]\((?!https?:|#|mailto:)([^)#]+)(#[^)]+)?\)/g, (match, target, fragment = '') => {
    const resolved = resolve(dirname(join(repositoryRoot, 'docs', sourcePath)), target);
    const relative = resolved.slice(repositoryRoot.length + 1).replaceAll('\\', '/');
    const canonical = relative.replace(/\.zh\.md$/, '.md').replace(/^docs\//, '');
    const route = knownRoutes.get(canonical);
    if (route) return `](/${locale}/docs/${route === 'index' ? '' : `${route}/`}${fragment})`;
    return `](${base}${relative}${fragment})`;
  });
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const [slug, source, englishTitle, chineseTitle] of entries) {
  for (const [locale, suffix, title] of [['en', '', englishTitle], ['zh', '.zh', chineseTitle]]) {
    const sourcePath = `${source}${suffix}.md`;
    const markdown = await readFile(join(repositoryRoot, 'docs', sourcePath), 'utf8');
    const withoutHeading = markdown.replace(/^# .+\r?\n/, '');
    const content = rewriteLinks(withoutHeading, sourcePath, locale);
    await writeFile(join(outputRoot, `${slug}${suffix}.md`), `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(locale === 'zh' ? '当前 Nautilus 原生研究文档' : 'Current Nautilus native research documentation')}\n---\n\n${content}`);
  }
}
await writeFile(join(outputRoot, 'meta.json'), JSON.stringify({ title: 'Trade Research', pages: entries.map(([slug]) => slug) }, null, 2));
await writeFile(join(outputRoot, 'meta.zh.json'), JSON.stringify({ title: 'Trade 研究文档', pages: entries.map(([slug]) => slug) }, null, 2));
await copyFile(join(repositoryRoot, 'icon.svg'), join(siteRoot, 'public', 'icon.svg'));
await copyFile(join(repositoryRoot, 'icon.svg'), join(siteRoot, 'public', 'icon-dark.svg'));
console.log(`Prepared ${entries.length} bilingual chapters.`);
