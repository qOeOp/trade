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
  ['start', 'Start', '开始'],
  ['begin', 'I. How research starts', '一、研究怎样开始'],
  ['iterate', 'II. One iteration', '二、一轮迭代'],
  ['close', 'III. Wrap-up and foundation', '三、收尾与底座'],
  ['design', 'IV. Platform architecture', '四、平台架构'],
  ['code', '4.1 Code', '4.1 Code｜代码', 'design'],
  ['database', '4.2 Database', '4.2 Database｜数据库', 'design'],
  ['skill', '4.3 Skill', '4.3 Skill｜研究技能', 'design'],
  ['appendices', 'Appendices', '附录'],
];
