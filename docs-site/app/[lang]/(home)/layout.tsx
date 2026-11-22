import { isLocale } from '@/lib/i18n';
import { baseOptions } from '@/lib/layout.shared';
import { docsTree } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { notFound } from 'next/navigation';

export default async function Layout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <DocsLayout tree={docsTree(lang)} {...baseOptions(lang)}>
      {children}
    </DocsLayout>
  );
}
