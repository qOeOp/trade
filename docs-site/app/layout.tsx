import { Provider } from '@/components/provider';
import type { Metadata } from 'next';
import './global.css';

export const metadata: Metadata = {
  title: {
    default: 'Vibe Trader Documentation',
    template: '%s | Vibe Trader',
  },
  description: 'Documentation for the Vibe Trader research and trading platform.',
  icons: {
    icon: [
      { url: '/trade/icon.svg', media: '(prefers-color-scheme: light)' },
      { url: '/trade/icon-dark.svg', media: '(prefers-color-scheme: dark)' },
    ],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
