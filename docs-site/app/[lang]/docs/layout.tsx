import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { isLocale } from '@/lib/i18n';
import { notFound } from 'next/navigation';

export default async function Layout({ children, params }: LayoutProps<'/[lang]/docs'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
      {children}
    </DocsLayout>
  );
}
