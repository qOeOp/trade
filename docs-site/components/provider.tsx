'use client';

import SearchDialog from '@/components/search';
import { i18nProviderProps, type Locale } from '@/lib/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';

export function Provider({ children, locale }: { children: ReactNode; locale: Locale }) {
  return (
    <RootProvider search={{ SearchDialog }} i18n={i18nProviderProps(locale)}>
      {children}
    </RootProvider>
  );
}
