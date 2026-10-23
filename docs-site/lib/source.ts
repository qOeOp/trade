import { loader } from 'fumadocs-core/source';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { defineDocs } from 'fumadocs-mdx/macro';
import { i18n } from '@/lib/i18n';
import type * as PageTree from 'fumadocs-core/page-tree';
import entries from '@/lib/generated/rd-entries.json';
import groups from '@/lib/generated/rd-groups.json';
import type { Locale } from '@/lib/i18n';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

export const source = loader({
  baseUrl: '/docs',
  i18n,
  source: docs.toFumadocsSource(),
});

/** Group the existing routes without moving pages or duplicating their definitions. */
export function docsTree(locale: Locale): PageTree.Root {
  const original = source.getPageTree(locale);
  const pages = (group: string): PageTree.Item[] => entries
    .filter((entry) => entry[4] === group)
    .map(([slug]) => {
      const page = source.getPage(slug === 'index' ? [] : [slug], locale)!;
      return { type: 'page', name: page.data.title, url: page.url };
    });
  const children: PageTree.Node[] = pages('');
  for (const [id, en, zh, parent] of groups) {
    if (parent) continue;
    children.push({ type: 'separator', name: locale === 'zh' ? zh : en }, ...pages(id));
    for (const [childId, childEn, childZh, childParent] of groups) {
      if (childParent !== id) continue;
      children.push({ type: 'folder', name: locale === 'zh' ? childZh : childEn,
        defaultOpen: true, children: pages(childId) });
    }
  }
  return { ...original, children };
}
