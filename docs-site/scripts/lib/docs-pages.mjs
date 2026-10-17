import { entries } from './docs-entries.mjs';

export async function publishedPages() {
  const pages = entries.map(([slug]) => `${slug}.md`);
  return { english: new Set(pages), chinese: new Set(pages) };
}
