'use client';

import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import type { ComponentProps } from 'react';

export function SiteControls({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={[
        'docs-site-controls ms-auto inline-flex shrink-0 flex-nowrap items-center gap-1.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <ThemeSwitch />
    </div>
  );
}
