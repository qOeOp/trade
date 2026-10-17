// One table drives content preparation, the i18n check and the static route check.
// This file lives in docs-site/scripts/lib; the table is generated with the document (docs/rd/entries.json):
// [slug, source under docs/ (without extension), English title, Chinese title, sidebar group]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const entries = JSON.parse(readFileSync(join(repositoryRoot, 'docs', 'rd', 'entries.json'), 'utf8'));
export const sourceBySlug = new Map(entries.map(([slug, source]) => [slug, source]));
export const groups = [
  ['chapters', 'Chapters', '章节'],
  ['design', 'Design', '设计'],
  ['appendices', 'Appendices', '附录'],
];
