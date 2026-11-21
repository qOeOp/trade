import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHINESE_ONLY = '<p className="rd-translation-note">This chapter is written in Chinese only.</p>';

async function readChapter(docsRoot, source, suffix) {
  for (const file of [`${source}${suffix}.mdx`, `${source}${suffix}.md`]) {
    try { return { file, markdown: await readFile(join(docsRoot, file), 'utf8') }; } catch {}
  }
  return null;
}

/** A chapter's text and file for a locale. Chapters have one source, `<chapter>.zh.mdx`; the English page is that text
 * under a note, its links (markdown and href) staying in English. An English `<chapter>.mdx` would take its place, but
 * none is kept: a second copy of every fact drifts from the first. */
export async function chapterSource(docsRoot, source, locale) {
  const english = locale === 'en' ? await readChapter(docsRoot, source, '') : null;
  if (english) return english;
  const chinese = await readChapter(docsRoot, source, '.zh');
  if (!chinese) throw new Error(`Missing chapter source: ${source}.zh.mdx`);
  if (locale === 'zh') return chinese;
  const markdown = chinese.markdown.replace(/^(# .+\r?\n\r?\n)/, `$1${CHINESE_ONLY}\n\n\n`).replace(/(\]\(|href=")\/zh\/docs\//g, '$1/en/docs/');
  return { file: chinese.file, markdown };
}
