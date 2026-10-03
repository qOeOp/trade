import { publishedPages } from './lib/docs-pages.mjs';

const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right));

const { english, chinese } = await publishedPages();
const orphaned = sorted([...chinese].filter((path) => !english.has(path)));
if (orphaned.length > 0) {
  throw new Error(`Chinese documents without an English source:\n${orphaned.join('\n')}`);
}

console.log(
  `Localization check passed: ${english.size} English, ${chinese.size} Chinese pages (zh is frozen; English is authoritative).`,
);
