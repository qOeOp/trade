import type { Metadata } from 'next';

const origin = 'https://qoeop.github.io';

export const siteMetadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: 'Vibe Trading Documentation',
    template: '%s | Vibe Trading',
  },
  description: 'Documentation for the Vibe Trading research and trading platform.',
  icons: {
    icon: [
      { url: '/trade/icon.svg', media: '(prefers-color-scheme: light)' },
      { url: '/trade/icon-dark.svg', media: '(prefers-color-scheme: dark)' },
    ],
  },
};

export function absoluteSiteUrl(pathname: string): string {
  return new URL(`/trade${pathname}`, origin).toString();
}
