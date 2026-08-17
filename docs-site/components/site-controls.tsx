'use client';

import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';

const languages = [
  { locale: 'en', label: 'EN', ariaLabel: 'Switch language to English' },
  { locale: 'zh', label: '中文', ariaLabel: '切换为简体中文' },
] as const;

export function SiteControls({ className, ...props }: ComponentProps<'div'>) {
  const { locale, onChange } = useI18n();
  const pathname = usePathname();
  const isDocsRoute = pathname.split('/').includes('docs');
  const inheritedClassName = isDocsRoute ? undefined : className;

  return (
    <div
      className={[
        'ms-auto inline-flex shrink-0 flex-nowrap items-center gap-1.5',
        isDocsRoute ? 'docs-site-controls' : inheritedClassName,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {!isDocsRoute && (
        <Link
          href={`/${locale}/docs/guide`}
          className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full bg-fd-primary px-4 text-xs font-semibold text-fd-primary-foreground shadow-sm transition-opacity hover:opacity-85"
        >
          {locale === 'zh' ? '开始使用' : 'Get started'}
        </Link>
      )}
      <div
        role="group"
        aria-label="Language / 语言"
        className="inline-flex shrink-0 flex-nowrap items-center whitespace-nowrap rounded-full border p-1"
      >
        {languages.map((language) => {
          const active = locale === language.locale;

          return (
            <button
              key={language.locale}
              type="button"
              aria-label={language.ariaLabel}
              aria-pressed={active}
              onClick={() => {
                if (!active) onChange?.(language.locale);
              }}
              className={`h-6.5 min-w-8 shrink-0 whitespace-nowrap rounded-full px-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-fd-accent text-fd-accent-foreground'
                  : 'text-fd-muted-foreground hover:text-fd-accent-foreground'
              }`}
            >
              {language.label}
            </button>
          );
        })}
      </div>
      <ThemeSwitch />
    </div>
  );
}
