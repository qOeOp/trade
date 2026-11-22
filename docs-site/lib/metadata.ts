import type { Metadata } from 'next';

const origin = 'https://qoeop.github.io';

export const siteMetadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: '研发长链',
    template: '%s | 研发长链',
  },
  description: '研发长链：候选谱系、预先登记的假设、配对比较证据与代码强制的信任边界。',
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
