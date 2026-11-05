import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { entries } from './docs-entries.mjs';

const TRANSLATION_PENDING = '<p className="rd-translation-note">English translation pending: this page shows the Chinese source text.</p>';

async function readChapter(docsRoot, source, suffix) {
  for (const file of [`${source}${suffix}.mdx`, `${source}${suffix}.md`]) {
    try { return { file, markdown: await readFile(join(docsRoot, file), 'utf8') }; } catch {}
  }
  return null;
}

/** A chapter's text and file for a locale. With no English file the English page is the Chinese source under a note, its links staying in English. */
export async function chapterSource(docsRoot, source, locale) {
  const english = locale === 'en' ? await readChapter(docsRoot, source, '') : null;
  if (english) return english;
  const chinese = await readChapter(docsRoot, source, '.zh');
  if (!chinese) throw new Error(`Missing chapter source: ${source}.zh.mdx`);
  if (locale === 'zh') return chinese;
  const markdown = chinese.markdown.replace(/^(# .+\r?\n\r?\n)/, `$1${TRANSLATION_PENDING}\n\n\n`).replaceAll('](/zh/docs/', '](/en/docs/');
  return { file: chinese.file, markdown };
}

export async function publishedPages() {
  const pages = entries.map(([slug]) => `${slug}.md`);
  return { english: new Set(pages), chinese: new Set(pages) };
}
