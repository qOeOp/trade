'use client';

import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import type { ComponentProps } from 'react';

const languages = [
  { locale: 'en', label: 'EN', ariaLabel: 'Switch language to English' },
  { locale: 'zh', label: '中文', ariaLabel: '切换为简体中文' },
] as const;

export function SiteControls({ className: _className, ...props }: ComponentProps<'div'>) {
  const { locale, onChange } = useI18n();

  return (
    <div className="ms-auto inline-flex items-center gap-1.5" {...props}>
      <div
        role="group"
        aria-label="Language / 语言"
        className="inline-flex items-center rounded-full border p-1"
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
              className={`h-6.5 min-w-8 rounded-full px-2 text-xs font-semibold transition-colors ${
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
