import type { Locale } from '@/lib/i18n';
import { docsTree } from '@/lib/source';
import type * as PageTree from 'fumadocs-core/page-tree';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';

export const homeTitle: Record<Locale, string> = {
  en: 'Research Chain',
  zh: '研发长链',
};

export const homeDescription: Record<Locale, string> = {
  en: 'The research chain: candidates, registered hypotheses, comparison evidence and the trust boundaries enforced in code.',
  zh: '研发长链：候选、登记的假设、比较证据与代码强制的信任边界。',
};

type DirectorySection = {
  title?: PageTree.Node['name'];
  items: PageTree.Item[];
};

function directorySections(tree: PageTree.Root): DirectorySection[] {
  const sections: DirectorySection[] = [];
  let current: DirectorySection = { items: [] };

  for (const node of tree.children) {
    if (node.type === 'separator') {
      if (current.title !== undefined || current.items.length > 0) sections.push(current);
      current = { title: node.name, items: [] };
    } else if (node.type === 'page') {
      current.items.push(node);
    } else if (node.type === 'folder') {
      for (const child of node.children) {
        if (child.type === 'page') current.items.push(child);
      }
    }
  }
  if (current.title !== undefined || current.items.length > 0) sections.push(current);
  return sections;
}

export function HomePageContent({ locale }: { locale: Locale }) {
  const tree = docsTree(locale);
  const sections = directorySections(tree);

  return (
    <DocsPage toc={[]} tableOfContentPopover={{ enabled: false }}>
      <DocsTitle>{homeTitle[locale]}</DocsTitle>
      <DocsDescription>{homeDescription[locale]}</DocsDescription>
      <DocsBody className="flex flex-col gap-6">
        {sections.map((section, index) => (
          <section key={index} className="flex flex-col gap-3">
            {section.title ? <h2 className="!my-0 text-lg font-semibold">{section.title}</h2> : null}
            <Cards>
              {section.items.map((item) => (
                <Card key={item.url} href={item.url} title={item.name}>
                  {item.description && item.description !== homeDescription[locale].replace(/[.。]$/, '')
                    ? item.description
                    : null}
                </Card>
              ))}
            </Cards>
          </section>
        ))}
      </DocsBody>
    </DocsPage>
  );
}
