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
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider locale="en">
          <DocsLayout tree={docsTree('en')} {...baseOptions('en')}>
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  );
}
