'use client';

import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import type { ComponentProps } from 'react';

const languages = [
  { locale: 'en', label: 'EN', ariaLabel: 'Switch language to English' },
  { locale: 'zh', label: '中文', ariaLabel: '切换为简体中文' },
] as const;

export function SiteControls({ className, ...props }: ComponentProps<'div'>) {
  const { locale, onChange } = useI18n();

  return (
    <div
      className={['ms-auto inline-flex shrink-0 flex-nowrap items-center gap-1.5 docs-site-controls', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <div
        role="group"
        aria-label="Language / 语言"
        className="inline-flex shrink-0 flex-nowrap items-center gap-0.5 whitespace-nowrap rounded-[6px] bg-[var(--frame)] p-0.5"
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
              className={`h-6 min-w-8 shrink-0 whitespace-nowrap rounded-[4px] px-2 text-xs transition-colors ${
                active
                  ? 'bg-[var(--island)] font-semibold text-fd-foreground shadow-[var(--shadow-raised)]'
                  : 'text-fd-muted-foreground hover:bg-[var(--hover)] hover:text-fd-foreground'
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
