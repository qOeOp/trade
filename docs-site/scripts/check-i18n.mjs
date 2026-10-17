import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedPages } from './lib/docs-pages.mjs';
import { sourceBySlug } from './lib/docs-entries.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '..');
async function accessEither(...candidates) {
  for (const candidate of candidates) {
    try { await access(join(repositoryRoot, 'docs', candidate)); return; } catch {}
  }
  throw new Error(`Missing chapter source: ${candidates[0]}`);
}
const { english, chinese } = await publishedPages();
for (const page of english) {
  if (!chinese.has(page)) throw new Error(`Missing Chinese chapter: ${page}`);
  const source = sourceBySlug.get(page.replace(/\.md$/, ''));
  if (!source) throw new Error(`Unknown chapter: ${page}`);
  await accessEither(`${source}.mdx`, `${source}.md`);
  await accessEither(`${source}.zh.mdx`, `${source}.zh.md`);
}
console.log(`Localization check passed: ${english.size} bilingual chapters.`);
