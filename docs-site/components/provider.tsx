'use client';

import SearchDialog from '@/components/search';
import { i18nProviderProps, isLocale, type Locale } from '@/lib/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

function isLocaleHomePath(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  return !segments.includes('docs') && segments.length <= 2;
}

function localeHomeUrl(locale: Locale) {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (isLocale(segments.at(-1) ?? '')) segments.pop();
  return `/${[...segments, locale].join('/')}/${window.location.search}${window.location.hash}`;
}

export function Provider({ children, locale }: { children: ReactNode; locale: Locale }) {
  const pathname = usePathname();
  const [activeLocale, setActiveLocale] = useState(locale);
  const isHome = isLocaleHomePath(pathname);

  useEffect(() => setActiveLocale(locale), [locale]);

  useEffect(() => {
    const syncFromLocation = () => {
      const nextLocale = window.location.pathname.split('/').filter(Boolean).at(-1) ?? '';
      if (isLocale(nextLocale)) setActiveLocale(nextLocale);
    };
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  useEffect(() => {
    document.documentElement.lang = activeLocale === 'zh' ? 'zh-CN' : 'en';
  }, [activeLocale]);

  const switchHomeLocale = useCallback((nextLocale: string) => {
    if (!isLocale(nextLocale) || nextLocale === activeLocale) return;
    setActiveLocale(nextLocale);
    window.history.pushState(null, '', localeHomeUrl(nextLocale));
  }, [activeLocale]);

  const i18n = i18nProviderProps(activeLocale);
  return (
    <RootProvider
      search={{ SearchDialog }}
      i18n={isHome ? { ...i18n, onLocaleChange: switchHomeLocale } : i18n}
    >
      {children}
    </RootProvider>
  );
}
