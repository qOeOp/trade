import type { Metadata } from 'next';

const origin = 'https://qoeop.github.io';

export const siteMetadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: 'Trade Research Documentation',
    template: '%s | Trade Research',
  },
  description: 'Documentation for the Trade Research research and trading platform.',
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
