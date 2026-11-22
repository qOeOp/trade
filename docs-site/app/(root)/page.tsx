import { getMDXComponents } from '@/components/mdx';
import { absoluteSiteUrl } from '@/lib/metadata';
import { source } from '@/lib/source';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export function generateMetadata(): Metadata {
  const page = source.getPage([], 'zh');
  return {
    title: page?.data.title,
    description: page?.data.description,
    alternates: {
      canonical: absoluteSiteUrl('/zh/docs'),
    },
  };
}

export default function RootPage() {
  const page = source.getPage([], 'zh');
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents('zh', { a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  );
}
