import { Provider } from '@/components/provider';
import { i18n, isLocale } from '@/lib/i18n';
import { siteMetadata } from '@/lib/metadata';
import { notFound } from 'next/navigation';
import '../global.css';

export const metadata = siteMetadata;
export const dynamicParams = false;

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export default async function Layout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <html lang={lang === 'zh' ? 'zh-CN' : 'en'} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider locale={lang}>{children}</Provider>
      </body>
    </html>
  );
}
