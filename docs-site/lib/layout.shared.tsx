import { Logo } from '@/components/logo';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2">
          <img src="/trade/icon.svg" alt="" className="size-6 dark:hidden" />
          <img src="/trade/icon-dark.svg" alt="" className="hidden size-6 dark:block" />
          <Logo aria-hidden className="h-4 w-auto" />
          <span className="sr-only">Vibe Trader</span>
        </span>
      ),
    },
    githubUrl: 'https://github.com/qOeOp/trade',
  };
}
