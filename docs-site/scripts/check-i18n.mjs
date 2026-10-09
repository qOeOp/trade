import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedPages } from './lib/docs-pages.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '..');
const { english, chinese } = await publishedPages();
for (const page of english) {
  if (!chinese.has(page)) throw new Error(`Missing Chinese chapter: ${page}`);
  const source = { index: 'index', architecture: 'architecture', replay: 'plans/nautilus-upstream-poc', findings: 'plans/r1-native-rd-findings' }[page.replace(/\.md$/, '')];
  await access(join(repositoryRoot, 'docs', `${source}.md`));
  await access(join(repositoryRoot, 'docs', `${source}.zh.md`));
}
console.log(`Localization check passed: ${english.size} bilingual chapters.`);
