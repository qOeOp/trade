'use client';

import SearchDialog from '@/components/search';
import { i18nProviderProps, isLocale, type Locale } from '@/lib/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, type ReactNode } from 'react';

export function Provider({ children, locale }: { children: ReactNode; locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();
  const isDocsRoute = pathname.split('/').includes('docs');

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const switchRootLocale = useCallback((nextLocale: string) => {
    if (!isLocale(nextLocale) || nextLocale === locale) return;
    router.push(`/${nextLocale}/docs/`);
  }, [locale, router]);

  const i18n = i18nProviderProps(locale);
  return (
    <RootProvider
      search={{ SearchDialog }}
      i18n={isDocsRoute ? i18n : { ...i18n, onLocaleChange: switchRootLocale }}
    >
      {children}
    </RootProvider>
  );
}
