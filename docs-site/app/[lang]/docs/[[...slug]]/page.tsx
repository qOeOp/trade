import { getMDXComponents } from '@/components/mdx';
import { i18n, isLocale } from '@/lib/i18n';
import { absoluteSiteUrl } from '@/lib/metadata';
import { source } from '@/lib/source';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';

export default async function Page(props: PageProps<'/[lang]/docs/[[...slug]]'>) {
  const params = await props.params;
  if (!isLocale(params.lang)) notFound();
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<'/[lang]/docs/[[...slug]]'>,
): Promise<Metadata> {
  const params = await props.params;
  if (!isLocale(params.lang)) notFound();
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const languages = Object.fromEntries(
    i18n.languages.flatMap((locale) => {
      const translation = source.getPage(params.slug, locale);
      if (!translation) return [];
      return [[locale === 'zh' ? 'zh-CN' : locale, absoluteSiteUrl(translation.url)]];
    }),
  );

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: absoluteSiteUrl(page.url),
      languages,
    },
  };
}
