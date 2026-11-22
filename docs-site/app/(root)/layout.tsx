import { Provider } from '@/components/provider';
import { baseOptions } from '@/lib/layout.shared';
import { siteMetadata } from '@/lib/metadata';
import { docsTree } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import '../global.css';

export const metadata = siteMetadata;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider locale="zh">
          <DocsLayout tree={docsTree('zh')} {...baseOptions('zh')}>
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  );
}
