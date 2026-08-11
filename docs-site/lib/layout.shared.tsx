import { Logo } from '@/components/logo';
import { SiteControls } from '@/components/site-controls';
import type { Locale } from '@/lib/i18n';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(locale: Locale): BaseLayoutProps {
  return {
    nav: {
      url: `/${locale}`,
      title: (
        <span className="inline-flex items-center gap-2">
          <img src="/trade/icon.svg" alt="" className="size-6 dark:hidden" />
          <img src="/trade/icon-dark.svg" alt="" className="hidden size-6 dark:block" />
          <Logo aria-hidden className="h-4 w-auto" />
          <span className="sr-only">Vibe Trader</span>
        </span>
      ),
    },
    i18n: false,
    slots: {
      themeSwitch: SiteControls,
    },
    githubUrl: 'https://github.com/qOeOp/trade',
  };
}
