import { HomePageContent, homeContent } from '@/components/home-page';
import { absoluteSiteUrl } from '@/lib/metadata';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  description: homeContent.en.description,
  alternates: {
    canonical: absoluteSiteUrl('/en'),
    languages: {
      en: absoluteSiteUrl('/en'),
      'zh-CN': absoluteSiteUrl('/zh'),
    },
  },
};

export default function RootPage() {
  return <HomePageContent locale="en" />;
}
