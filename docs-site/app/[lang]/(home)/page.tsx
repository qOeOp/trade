import { HomePageContent, homeContent } from '@/components/home-page';
import { isLocale, type Locale } from '@/lib/i18n';
import { absoluteSiteUrl } from '@/lib/metadata';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return <HomePageContent locale={lang} />;
}

export async function generateMetadata({ params }: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return {
    description: homeContent[lang].description,
    alternates: {
      canonical: absoluteSiteUrl(`/${lang}`),
      languages: {
        en: absoluteSiteUrl('/en'),
        'zh-CN': absoluteSiteUrl('/zh'),
      },
    },
  };
}
