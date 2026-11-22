import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readChapter(docsRoot, source, suffix) {
  for (const file of [`${source}${suffix}.mdx`, `${source}${suffix}.md`]) {
    try { return { file, markdown: await readFile(join(docsRoot, file), 'utf8') }; } catch {}
  }
  return null;
}

/** A chapter's text and file. Chapters have one source, `<chapter>.zh.mdx`. */
export async function chapterSource(docsRoot, source) {
  const chinese = await readChapter(docsRoot, source, '.zh');
  if (!chinese) throw new Error(`Missing chapter source: ${source}.zh.mdx`);
  return chinese;
}
